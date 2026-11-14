// `<split-view>` and its sidebar, the same on every toolkit: the components, what of them goes back
// into layout, and the source lists a toolkit draws.
//
// - NgNativeSplitView holds the sidebar pane (NgNativeSidebar) then the content pane
//   (NgNativeSplitContent). The first split view in a window is the window's (on macOS its
//   NSSplitViewController, with the full-height sidebar); one inside another split view, a modal or a
//   tabs host is a plain split view in the content.
// - Each pane is a container of its own (input.h), sized by the toolkit: the size it reports goes
//   back to the pane's shadow node as state, which lays it out at that size.
// - NgNativeSidebarSection and NgNativeSidebarItem are model objects: neighbouring sections in one
//   parent are one source list, which the toolkit draws in their place. An item with children is a
//   custom row, which the toolkit puts in a cell and whose width it reports as state. Yoga gives a
//   section its title row's height and each row at least kSidebarRowHeight, so the space a source
//   list takes in layout is the space it draws in.
#pragma once

#include "ngn/view-tree.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ngn {

extern const char SplitViewComponentName[];
extern const char SidebarComponentName[];
extern const char SplitContentComponentName[];
extern const char SidebarSectionComponentName[];
extern const char SidebarItemComponentName[];

// A source list's row, and a titled section's title row, in points.
constexpr facebook::react::Float kSidebarRowHeight = 28;
constexpr facebook::react::Float kSidebarHeaderHeight = 28;
// The sidebar's width before its toolkit or its autosave says otherwise.
constexpr facebook::react::Float kSidebarDefaultWidth = 240;

class SplitPaneProps final : public facebook::react::ViewProps {
 public:
  SplitPaneProps() = default;
  SplitPaneProps(
      const facebook::react::PropsParserContext &context,
      const SplitPaneProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  // The sidebar's own; the content pane has none of them.
  bool collapsed{false};
  // 0 for no bound.
  facebook::react::Float paneMinWidth{0};
  facebook::react::Float paneMaxWidth{0};
  std::string autosaveName;
};

// The size the toolkit gives a pane, or a custom row's width (height unused). Zero until it reports.
struct SplitPaneState {
  facebook::react::Size size{};
};

template <const char *Name>
using SplitPaneShadowNode = facebook::react::
    ConcreteViewShadowNode<Name, SplitPaneProps, facebook::react::ViewEventEmitter, SplitPaneState>;

// A view sized by its toolkit (a pane, a tab's screen): it takes the size its state says,
// positioned absolutely, since its container places it.
template <class ShadowNodeT>
class ToolkitSizedComponentDescriptor final : public facebook::react::ConcreteComponentDescriptor<ShadowNodeT> {
  using Base = facebook::react::ConcreteComponentDescriptor<ShadowNodeT>;

 public:
  using Base::Base;
  void adopt(facebook::react::ShadowNode &shadowNode) const override {
    const auto &state = static_cast<const typename ShadowNodeT::ConcreteState &>(*shadowNode.getState()).getData();
    if (state.size.width > 0 && state.size.height > 0) {
      auto &layoutable = static_cast<facebook::react::YogaLayoutableShadowNode &>(shadowNode);
      layoutable.setPositionType(YGPositionTypeAbsolute);
      layoutable.setSize(state.size);
    }
    Base::adopt(shadowNode);
  }
};

template <const char *Name>
using SplitPaneComponentDescriptor = ToolkitSizedComponentDescriptor<SplitPaneShadowNode<Name>>;

using SidebarComponentDescriptor = SplitPaneComponentDescriptor<SidebarComponentName>;
using SplitContentComponentDescriptor = SplitPaneComponentDescriptor<SplitContentComponentName>;

class SplitViewShadowNode final : public facebook::react::ConcreteViewShadowNode<SplitViewComponentName> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};
using SplitViewComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SplitViewShadowNode>;

class SidebarSectionProps final : public facebook::react::ViewProps {
 public:
  SidebarSectionProps() = default;
  SidebarSectionProps(
      const facebook::react::PropsParserContext &context,
      const SidebarSectionProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  std::string title;
  bool collapsible{false};
};

// Whether the user folded the section away with its disclosure.
struct SidebarSectionState {
  bool collapsed{false};
};

class SidebarSectionShadowNode final : public facebook::react::ConcreteViewShadowNode<
                                           SidebarSectionComponentName,
                                           SidebarSectionProps,
                                           facebook::react::ViewEventEmitter,
                                           SidebarSectionState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
  // A titled section starts with its title row; a collapsed one is only that.
  void applySourceListLayout() const;
};

class SidebarSectionComponentDescriptor final
    : public facebook::react::ConcreteComponentDescriptor<SidebarSectionShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;
  void adopt(facebook::react::ShadowNode &shadowNode) const override;
};

class SidebarItemProps final : public facebook::react::ViewProps {
 public:
  SidebarItemProps() = default;
  SidebarItemProps(
      const facebook::react::PropsParserContext &context,
      const SidebarItemProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  std::string label;
  std::string badge;
  std::string sfSymbol;
  std::string drawable;
  bool selected{false};
};

class SidebarItemShadowNode final : public facebook::react::ConcreteViewShadowNode<
                                        SidebarItemComponentName,
                                        SidebarItemProps,
                                        facebook::react::ViewEventEmitter,
                                        SplitPaneState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
  // At least a row's height, and the width of the cell it is drawn in once the toolkit says.
  void applySourceListLayout() const;
};

class SidebarItemComponentDescriptor final
    : public facebook::react::ConcreteComponentDescriptor<SidebarItemShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;
  void adopt(facebook::react::ShadowNode &shadowNode) const override;
};

// A source list as the toolkit draws it.
struct SidebarRow {
  Tag tag{-1};
  std::string label;
  std::string badge;
  std::string sfSymbol;
  bool selected{false};
  // An item with children: the toolkit hosts its views in the row.
  bool custom{false};
  bool operator==(const SidebarRow &) const = default;
};

struct SidebarGroup {
  Tag tag{-1};
  // Empty for a section with no title row: its rows sit at the top level.
  std::string title;
  bool collapsible{false};
  std::vector<SidebarRow> rows;
  bool operator==(const SidebarGroup &) const = default;
};

struct SourceList {
  std::vector<SidebarGroup> groups;
  bool operator==(const SourceList &) const = default;
};

// The source lists among `parent`'s children: one for each run of neighbouring sections.
std::vector<SourceList> sourceLists(const ViewTree &tree, Tag parent);

// Whether a click on `chain` (a hit test from a custom row's root, root first) is for the row's
// content rather than for selecting the row: something under the root takes it, a focusable view
// (a pressable, a control) or a text input.
bool rowContentTakesClick(const ViewTree &tree, const std::vector<Tag> &chain);

// What the split views and source lists of a surface became in a transaction, kept by the
// mounting manager as ScreenStacks is.
class Sidebars {
 public:
  void childrenChanged(const ViewTree &tree, Tag parent);
  void propsChanged(const ViewTree &tree, Tag tag);
  void deleted(Tag tag);

  // A split view, or a tabs host (tabs-host.h), which draws as one with its tabs as the sidebar.
  struct SplitView {
    Tag tag{-1};
    // The window's own split view, or a plain one in the content.
    bool window{false};
    bool operator==(const SplitView &) const = default;
  };
  struct Lists {
    Tag parent{-1};
    std::vector<SourceList> lists;
    bool operator==(const Lists &) const = default;
  };
  struct Changes {
    // Split views mounted since the last call, outermost first.
    std::vector<SplitView> splitViews;
    // Parents whose source lists changed, with what they are now (empty when none is left).
    std::vector<Lists> lists;
  };
  Changes settle(const ViewTree &tree, SurfaceId surfaceId);

 private:
  std::unordered_set<Tag> dirtyParents_;
  std::vector<Tag> newSplits_;
  // Split views already sent: each is decided once, when it first mounts in its surface.
  std::unordered_set<Tag> placed_;
  std::unordered_map<Tag, std::vector<SourceList>> lists_;
  // The window's split view of each surface.
  std::unordered_map<SurfaceId, Tag> windowSplits_;
};

// The sidebar's collapsed state between the app's prop and the toolkit's own toggles (the title
// bar button, View > Show Sidebar, a drag that shuts it).
class SidebarCollapse {
 public:
  // The prop changed: what the toolkit must be set to, if anything.
  std::optional<bool> propChanged(bool collapsed);
  // The toolkit's state changed: whether to tell the app, which it does when the app's prop
  // says otherwise.
  bool toolkitChanged(bool collapsed);

 private:
  bool prop_{false};
  bool toolkit_{false};
};

// Sizes reported as the toolkit lays out (every step of a divider drag), coalesced so layout hears
// each view's latest at most once per display frame.
class FrameSizes {
 public:
  // Whether this is the first report since the last flush: the toolkit then asks for a flush on
  // the next frame.
  bool report(Tag tag, facebook::react::Size size);
  // The sizes that changed since the last flush, the latest of each.
  std::vector<std::pair<Tag, facebook::react::Size>> flush();
  void forget(Tag tag);

 private:
  std::unordered_map<Tag, facebook::react::Size> pending_;
  std::unordered_map<Tag, facebook::react::Size> applied_;
};

} // namespace ngn
