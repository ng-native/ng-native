#include "ngn/mounting-manager.h"

#include "ngn/accessibility.h"

#include <chrono>

#include "ngn/desktop-modal.h"
#include "ngn/native-controls.h"
#include "ngn/split-view.h"
#include "ngn/camera.h"
#include "ngn/expo-image.h"
#include "ngn/symbol.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/FBReactNativeSpec/ComponentDescriptors.h>
#include <react/renderer/components/image/ImageComponentDescriptor.h>
#include <react/renderer/components/iostextinput/TextInputComponentDescriptor.h>
#include <react/renderer/components/text/ParagraphComponentDescriptor.h>
#include <react/renderer/components/text/RawTextComponentDescriptor.h>
#include <react/renderer/components/text/TextComponentDescriptor.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;

namespace ngn {

MountingManager::MountingManager(
    std::shared_ptr<MountingBackend> backend,
    std::shared_ptr<DesktopPropsSink> desktopProps,
    std::unique_ptr<ScreenStacks> screens,
    std::unique_ptr<SafeAreas> safeAreas,
    std::unique_ptr<TabsHosts> tabs)
    : backend_(std::move(backend)),
      desktopProps_(std::move(desktopProps)),
      liveRegions_(tree_, [](const ShadowView &view) { return paragraphText(view); }),
      screens_(screens ? std::move(screens) : std::make_unique<ScreenStacks>()),
      safeAreas_(safeAreas ? std::move(safeAreas) : std::make_unique<SafeAreas>()),
      tabs_(tabs ? std::move(tabs) : std::make_unique<TabsHosts>()) {
  components_ = {
      concreteComponentDescriptorProvider<DesktopViewComponentDescriptor>(),
      concreteComponentDescriptorProvider<ParagraphComponentDescriptor>(),
      concreteComponentDescriptorProvider<TextComponentDescriptor>(),
      concreteComponentDescriptorProvider<RawTextComponentDescriptor>(),
      concreteComponentDescriptorProvider<DesktopScrollViewComponentDescriptor>(),
      concreteComponentDescriptorProvider<TextInputComponentDescriptor>(),
      concreteComponentDescriptorProvider<ImageComponentDescriptor>(),
      concreteComponentDescriptorProvider<DesktopModalComponentDescriptor>(),
      concreteComponentDescriptorProvider<NativeButtonComponentDescriptor>(),
      concreteComponentDescriptorProvider<SwitchControlComponentDescriptor>(),
      concreteComponentDescriptorProvider<ActivityIndicatorControlComponentDescriptor>(),
      concreteComponentDescriptorProvider<SegmentedControlComponentDescriptor>(),
      concreteComponentDescriptorProvider<DatePickerComponentDescriptor>(),
      concreteComponentDescriptorProvider<SplitViewComponentDescriptor>(),
      concreteComponentDescriptorProvider<SidebarComponentDescriptor>(),
      concreteComponentDescriptorProvider<SplitContentComponentDescriptor>(),
      concreteComponentDescriptorProvider<SidebarSectionComponentDescriptor>(),
      concreteComponentDescriptorProvider<SidebarItemComponentDescriptor>(),
      concreteComponentDescriptorProvider<SymbolComponentDescriptor>(),
      concreteComponentDescriptorProvider<ExpoImageComponentDescriptor>(),
      concreteComponentDescriptorProvider<CameraComponentDescriptor>(),
      concreteComponentDescriptorProvider<UnimplementedNativeViewComponentDescriptor>(),
  };
  for (auto &provider : backend_->componentProviders()) {
    components_.push_back(std::move(provider));
  }
  for (const auto &provider : components_) {
    componentNames_.insert(provider.name);
  }
}

void MountingManager::executeMount(SurfaceId surfaceId, MountingTransaction &&transaction) {
  // The JS thread. A toolkit's views belong to its UI thread, whose queue runs tasks in the order
  // they were posted, which keeps transactions in commit order.
  auto mutations = std::make_shared<const ShadowViewMutationList>(transaction.getMutations());
  if (onCommit) {
    const auto &telemetry = transaction.getTelemetry();
    auto start = telemetry.getCommitStartTime();
    auto end = telemetry.getCommitEndTime();
    if (start != kTelemetryUndefinedTimePoint && end != kTelemetryUndefinedTimePoint && end >= start) {
      onCommit(surfaceId, std::chrono::duration<double, std::milli>(end - start).count());
    }
  }
  std::weak_ptr<MountingManager> weak = weak_from_this();
  backend_->runOnUiThread([weak, surfaceId, mutations] {
    if (auto self = weak.lock()) {
      self->apply(surfaceId, *mutations);
    }
  });
}

void MountingManager::ensureRoot(SurfaceId surfaceId, Tag tag) {
  if (tag != surfaceId || tree_.contains(tag)) {
    return;
  }
  // Fabric never creates a surface's root view with a mutation; it is made the first time a
  // mutation names it, and the backend attaches it to the surface's main container.
  ShadowView root;
  root.componentName = "RootView";
  root.surfaceId = surfaceId;
  root.tag = tag;
  root.layoutMetrics.frame = {};
  tree_.create(root);
  backend_->createView(root);
}

void MountingManager::apply(SurfaceId surfaceId, const ShadowViewMutationList &mutations) {
  for (const auto &m : mutations) {
    switch (m.type) {
      case ShadowViewMutation::Create: {
        const auto &view = m.newChildShadowView;
        tree_.create(view);
        liveRegions_.update(view);
        safeAreas_->created(view);
        backend_->createView(view);
        svgs_.changed(tree_, view.tag);
        reportDesktopProps(view, nullptr);
        tabs_->propsChanged(tree_, view.tag);
        break;
      }
      case ShadowViewMutation::Delete:
        screens_->deleted(m.oldChildShadowView.tag);
        sidebars_.deleted(m.oldChildShadowView.tag);
        tabs_->deleted(m.oldChildShadowView.tag);
        safeAreas_->deleted(m.oldChildShadowView.tag);
        svgs_.deleted(m.oldChildShadowView.tag);
        liveRegions_.remove(m.oldChildShadowView.tag);
        tree_.destroy(m.oldChildShadowView.tag);
        backend_->deleteView(surfaceId, m.oldChildShadowView.tag);
        break;
      case ShadowViewMutation::Insert:
        ensureRoot(surfaceId, m.parentTag);
        tree_.insert(m.parentTag, m.newChildShadowView.tag, m.index);
        backend_->insertChild(surfaceId, m.parentTag, m.newChildShadowView.tag, m.index);
        screens_->childrenChanged(tree_, m.parentTag);
        sidebars_.childrenChanged(tree_, m.parentTag);
        tabs_->childrenChanged(tree_, m.parentTag);
        svgs_.changed(tree_, m.parentTag);
        break;
      case ShadowViewMutation::Remove:
        tree_.remove(m.parentTag, m.oldChildShadowView.tag);
        backend_->removeChild(surfaceId, m.parentTag, m.oldChildShadowView.tag, m.index);
        screens_->childrenChanged(tree_, m.parentTag);
        sidebars_.childrenChanged(tree_, m.parentTag);
        tabs_->childrenChanged(tree_, m.parentTag);
        svgs_.changed(tree_, m.parentTag);
        break;
      case ShadowViewMutation::Update: {
        const auto &old = m.oldChildShadowView;
        const auto &view = m.newChildShadowView;
        ensureRoot(surfaceId, view.tag);
        tree_.update(view);
        // React Native iOS's order: event emitter, props, state, then layout.
        if (old.eventEmitter != view.eventEmitter) {
          backend_->updateEventEmitter(view);
        }
        if (old.props != view.props) {
          backend_->updateProps(view);
          reportDesktopProps(view, &old);
          liveRegions_.update(view);
          sidebars_.propsChanged(tree_, view.tag);
          tabs_->propsChanged(tree_, view.tag);
          screens_->propsChanged(tree_, view.tag);
          svgs_.changed(tree_, view.tag);
        }
        if (old.state != view.state) {
          backend_->updateState(view);
        }
        if (old.layoutMetrics != view.layoutMetrics) {
          backend_->updateLayout(view);
        }
        break;
      }
      default:
        break;
    }
  }
  for (const auto &change : screens_->settle(tree_)) {
    backend_->setCovered(surfaceId, change.tag, change.covered);
  }
  for (const auto &change : screens_->takePresented()) {
    backend_->setPresented(surfaceId, change.tag, change.covered);
  }
  applyTabs(surfaceId);
  safeAreasSettled_ = !safeAreas_->settle(tree_);
  auto sidebars = sidebars_.settle(tree_, surfaceId);
  for (const auto &split : sidebars.splitViews) {
    backend_->setSplitView(surfaceId, split.tag, split.window);
  }
  for (const auto &lists : sidebars.lists) {
    backend_->setSourceLists(surfaceId, lists.parent, lists.lists);
  }
  for (auto &drawing : svgs_.settle(tree_)) {
    backend_->setSvgDrawing(surfaceId, drawing.svg, std::move(drawing.document));
  }
  auto header = screens_->frontHeader(tree_, surfaceId);
  auto known = frontHeaders_.find(surfaceId);
  if (known == frontHeaders_.end() ? header.has_value() : known->second != header) {
    frontHeaders_[surfaceId] = header;
    backend_->setFrontHeader(surfaceId, header);
  }
  for (const auto &announcement : liveRegions_.didMount(surfaceId)) {
    backend_->announce(surfaceId, announcement);
  }
  backend_->didMount(surfaceId);
  if (afterMount_) {
    afterMount_(surfaceId);
  }
}

void MountingManager::applyTabs(SurfaceId surfaceId) {
  auto changes = tabs_->settle(tree_);
  for (const auto &change : changes.covered) {
    backend_->setCovered(surfaceId, change.tag, change.covered);
  }
  for (const auto &host : changes.hosts) {
    backend_->setSourceLists(surfaceId, host.host, {host.list});
  }
}

void MountingManager::chooseTab(SurfaceId surfaceId, Tag host, Tag screen) {
  tabs_->userSelect(tree_, host, screen);
  applyTabs(surfaceId);
}

void MountingManager::setContainerInsets(Tag root, const ContainerInsets &insets) {
  safeAreas_->setContainer(root, insets);
  if (safeAreas_->settle(tree_)) {
    safeAreasSettled_ = false;
  }
}

void MountingManager::removeContainerInsets(Tag root) {
  safeAreas_->removeContainer(root);
}

void MountingManager::reportDesktopProps(const ShadowView &view, const ShadowView *old) {
  if (!desktopProps_ || !view.props) {
    return;
  }
  auto props = desktopProps(*view.props);
  auto before = old && old->props ? desktopProps(*old->props) : DesktopProps{};
  if (props != before) {
    desktopProps_->updateDesktopProps(view.surfaceId, view.tag, props);
  }
}

void MountingManager::dispatchCommand(const ShadowView &view, const std::string &name, const folly::dynamic &args) {
  Tag tag = view.tag;
  std::weak_ptr<MountingManager> weak = weak_from_this();
  backend_->runOnUiThread([weak, tag, name, args] {
    if (auto self = weak.lock()) {
      self->backend_->dispatchCommand(tag, name, args);
    }
  });
}

void MountingManager::setAfterMountCallback(std::function<void(SurfaceId)> &&onAfterMount) {
  afterMount_ = std::move(onAfterMount);
}

ComponentRegistryFactory MountingManager::getComponentRegistryFactory() {
  auto registry = std::make_shared<ComponentDescriptorProviderRegistry>();
  for (const auto &provider : components_) {
    registry->add(provider);
  }
  return [registry](const EventDispatcher::Weak &eventDispatcher, const std::shared_ptr<const ContextContainer> &context) {
    return registry->createComponentDescriptorRegistry({eventDispatcher, context, nullptr});
  };
}

bool MountingManager::hasComponent(const std::string &name) {
  return name == "RootView" || componentNames_.contains(name);
}

} // namespace ngn
