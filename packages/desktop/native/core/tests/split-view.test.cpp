#include "fake-backend.h"
#include "helpers.h"
#include "ngn/desktop-view-props.h"
#include "ngn/mounting-manager.h"
#include "ngn/split-view.h"

#include <doctest/doctest.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

const std::shared_ptr<const ContextContainer> &context() {
  static auto shared = std::make_shared<const ContextContainer>();
  return shared;
}

template <class Descriptor>
const Descriptor &descriptor() {
  static Descriptor d{{{}, context(), nullptr}};
  return d;
}

template <class Descriptor>
Props::Shared props(dynamic raw) {
  PropsParserContext parserContext{1, *context()};
  return descriptor<Descriptor>().cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
}

// A shadow node of `Descriptor` with `raw` props, the state `data` (or the initial one) and
// `children`.
template <class Descriptor>
std::shared_ptr<ShadowNode> node(
    Tag tag,
    dynamic raw,
    std::vector<std::shared_ptr<const ShadowNode>> children = {},
    std::optional<typename Descriptor::ConcreteShadowNode::ConcreteStateData> data = std::nullopt) {
  const auto &d = descriptor<Descriptor>();
  auto p = props<Descriptor>(std::move(raw));
  auto family = d.createFamily({.tag = tag, .surfaceId = 1, .instanceHandle = nullptr});
  auto initial = d.createInitialState(p, family);
  State::Shared state = initial;
  if (data) {
    using ConcreteState = typename Descriptor::ConcreteShadowNode::ConcreteState;
    state = std::make_shared<const ConcreteState>(
        std::make_shared<const typename ConcreteState::Data>(*data), *initial);
  }
  return d.createShadowNode(
      {.props = p,
       .children = std::make_shared<const std::vector<std::shared_ptr<const ShadowNode>>>(std::move(children)),
       .state = state},
      family);
}

// Lays `root` out at `size` and answers each child's frame.
std::vector<Rect> layOut(const std::shared_ptr<ShadowNode> &root, Size size) {
  auto &layoutable = static_cast<YogaLayoutableShadowNode &>(*root);
  LayoutConstraints constraints{.minimumSize = size, .maximumSize = size};
  layoutable.layoutTree(LayoutContext{}, constraints);
  std::vector<Rect> frames;
  for (const auto &child : root->getChildren()) {
    frames.push_back(static_cast<const LayoutableShadowNode &>(*child).getLayoutMetrics().frame);
  }
  return frames;
}

using Lines = std::vector<std::string>;

struct Fixture {
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(backend, backend);

  // The backend's calls but the views' own: what the source lists and split views became.
  Lines mount(ShadowViewMutationList mutations) {
    backend->calls.clear();
    mounting->executeMount(1, MountingTransaction(1, 1, std::move(mutations), {}));
    backend->drain();
    Lines out;
    for (const auto &line : backend->calls) {
      if (line.starts_with("lists") || line.starts_with("split")) {
        out.push_back(line);
      }
    }
    return out;
  }
};

// Only what the split views became.
Lines splits(const Lines &lines) {
  Lines out;
  for (const auto &line : lines) {
    if (line.starts_with("split")) {
      out.push_back(line);
    }
  }
  return out;
}

ShadowView section(Tag tag, dynamic raw) {
  return shadowView(tag, ngn::SidebarSectionComponentName, {}, props<ngn::SidebarSectionComponentDescriptor>(raw));
}

ShadowView item(Tag tag, dynamic raw) {
  return shadowView(tag, ngn::SidebarItemComponentName, {}, props<ngn::SidebarItemComponentDescriptor>(raw));
}

ShadowViewMutationList add(Tag parent, std::vector<ShadowView> children, int from = 0) {
  ShadowViewMutationList out;
  for (const auto &child : children) {
    out.push_back(ShadowViewMutation::CreateMutation(child));
  }
  for (size_t i = 0; i < children.size(); i++) {
    out.push_back(ShadowViewMutation::InsertMutation(parent, children[i], from + static_cast<int>(i)));
  }
  return out;
}

ShadowViewMutationList operator+(ShadowViewMutationList a, const ShadowViewMutationList &b) {
  a.insert(a.end(), b.begin(), b.end());
  return a;
}

} // namespace


TEST_CASE("the sidebar's props are read under their pane names") {
  const auto &sidebar = static_cast<const ngn::SplitPaneProps &>(*props<ngn::SidebarComponentDescriptor>(
      dynamic::object("collapsed", true)("paneMinWidth", 180)("paneMaxWidth", 400)("autosaveName", "main")));
  CHECK(sidebar.collapsed);
  CHECK(sidebar.paneMinWidth == 180);
  CHECK(sidebar.paneMaxWidth == 400);
  CHECK(sidebar.autosaveName == "main");

  const auto &row = static_cast<const ngn::SidebarItemProps &>(*props<ngn::SidebarItemComponentDescriptor>(
      dynamic::object("label", "Inbox")("badge", "3")("sfSymbol", "tray")("drawable", "ic_inbox")("selected", true)));
  CHECK(row.label == "Inbox");
  CHECK(row.badge == "3");
  CHECK(row.sfSymbol == "tray");
  CHECK(row.drawable == "ic_inbox");
  CHECK(row.selected);

  const auto &group = static_cast<const ngn::SidebarSectionProps &>(
      *props<ngn::SidebarSectionComponentDescriptor>(dynamic::object("title", "Mailboxes")("collapsible", true)));
  CHECK(group.title == "Mailboxes");
  CHECK(group.collapsible);
}

TEST_CASE("a pane is laid out at the size its toolkit reports, and by its style before that") {
  auto sidebar = node<ngn::SidebarComponentDescriptor>(3, dynamic::object("height", 50));
  auto content = node<ngn::SplitContentComponentDescriptor>(4, dynamic::object("flex", 1));
  auto split = node<ngn::SplitViewComponentDescriptor>(2, dynamic::object(), {sidebar, content});
  auto before = layOut(split, {1000, 700});
  CHECK(before[0].size.height == 50);
  CHECK(before[1].size == Size{1000, 650});

  auto sized = node<ngn::SidebarComponentDescriptor>(
      3, dynamic::object("height", 50), {}, ngn::SplitPaneState{.size = {260, 700}});
  auto rest = node<ngn::SplitContentComponentDescriptor>(
      4, dynamic::object("flex", 1), {}, ngn::SplitPaneState{.size = {739, 700}});
  auto after = layOut(node<ngn::SplitViewComponentDescriptor>(2, dynamic::object(), {sized, rest}), {1000, 700});
  CHECK(after[0].size == Size{260, 700});
  CHECK(after[1].size == Size{739, 700});
}

TEST_CASE("a source list takes in layout the rows it draws") {
  auto rows = [](Tag first) {
    return std::vector<std::shared_ptr<const ShadowNode>>{
        node<ngn::SidebarItemComponentDescriptor>(first, dynamic::object("label", "Inbox")),
        node<ngn::SidebarItemComponentDescriptor>(first + 1, dynamic::object("label", "Sent")),
    };
  };
  auto titled = node<ngn::SidebarSectionComponentDescriptor>(3, dynamic::object("title", "Mail"), rows(4));
  auto untitled = node<ngn::SidebarSectionComponentDescriptor>(6, dynamic::object(), rows(7));
  auto frames = layOut(node<ngn::SplitViewComponentDescriptor>(2, dynamic::object(), {titled, untitled}), {240, 700});
  CHECK(frames[0].size.height == ngn::kSidebarHeaderHeight + 2 * ngn::kSidebarRowHeight);
  CHECK(frames[1].size.height == 2 * ngn::kSidebarRowHeight);
  CHECK(frames[1].origin.y == frames[0].size.height);

  // Folded away with its disclosure, a section is its title row.
  auto folded = node<ngn::SidebarSectionComponentDescriptor>(
      3, dynamic::object("title", "Mail"), rows(4), ngn::SidebarSectionState{.collapsed = true});
  auto foldedFrames = layOut(node<ngn::SplitViewComponentDescriptor>(2, dynamic::object(), {folded}), {240, 700});
  CHECK(foldedFrames[0].size.height == ngn::kSidebarHeaderHeight);

  // A section with no title cannot fold: it has nothing left to show.
  auto untitledFolded = node<ngn::SidebarSectionComponentDescriptor>(
      6, dynamic::object(), rows(7), ngn::SidebarSectionState{.collapsed = true});
  auto untitledFrames =
      layOut(node<ngn::SplitViewComponentDescriptor>(2, dynamic::object(), {untitledFolded}), {240, 700});
  CHECK(untitledFrames[0].size.height == 2 * ngn::kSidebarRowHeight);
}

TEST_CASE("a custom row is at least a row tall and as wide as the cell it is drawn in") {
  auto tall = node<ngn::DesktopViewComponentDescriptor>(9, dynamic::object("height", 44));
  auto custom = node<ngn::SidebarItemComponentDescriptor>(4, dynamic::object(), {tall});
  auto small = node<ngn::DesktopViewComponentDescriptor>(11, dynamic::object("height", 10));
  auto short_ = node<ngn::SidebarItemComponentDescriptor>(10, dynamic::object(), {small});
  auto frames = layOut(node<ngn::SplitViewComponentDescriptor>(2, dynamic::object(), {custom, short_}), {240, 700});
  CHECK(frames[0].size == Size{240, 44});
  CHECK(frames[1].size.height == ngn::kSidebarRowHeight);

  auto inCell = node<ngn::SidebarItemComponentDescriptor>(
      4, dynamic::object(), {tall}, ngn::SplitPaneState{.size = {212, 0}});
  CHECK(layOut(node<ngn::SplitViewComponentDescriptor>(2, dynamic::object(), {inCell}), {240, 700})[0].size ==
        Size{212, 44});
}

TEST_CASE("neighbouring sections in one parent are one source list") {
  Fixture f;
  auto sidebar = shadowView(2, ngn::SidebarComponentName, {});
  auto search = shadowView(3, "View", {});
  auto footer = shadowView(20, "View", {});
  auto lines = f.mount(
      add(1, {sidebar}) +
      add(2,
          {search,
           section(4, dynamic::object("title", "Mailboxes")("collapsible", true)),
           section(8, dynamic::object()),
           footer,
           section(12, dynamic::object("title", "Tags"))}) +
      add(4, {item(5, dynamic::object("label", "Inbox")("badge", "3")("sfSymbol", "tray")("selected", true)),
              item(6, dynamic::object("label", "Sent"))}) +
      add(8, {item(9, dynamic::object("label", "Flagged"))}) + add(12, {item(13, dynamic::object("label", "Work"))}));
  CHECK(lines == Lines{
                     "lists of 2: [4 Mailboxes (collapsible): 5 Inbox (3) <tray> *, 6 Sent | 8: 9 Flagged] [12 Tags: 13 Work]",
                 });

  // A row's props change the list it is in; nothing else is sent again.
  lines = f.mount({ShadowViewMutation::UpdateMutation(
      item(6, dynamic::object("label", "Sent")), item(6, dynamic::object("label", "Sent")("selected", true)), 4)});
  CHECK(lines == Lines{
                     "lists of 2: [4 Mailboxes (collapsible): 5 Inbox (3) <tray> *, 6 Sent * | 8: 9 Flagged] [12 Tags: 13 Work]",
                 });

  // The same props again are no change.
  lines = f.mount({ShadowViewMutation::UpdateMutation(
      item(6, dynamic::object("label", "Sent")), item(6, dynamic::object("label", "Sent")("selected", true)), 4)});
  CHECK(lines.empty());

  // Content inside an item makes it a custom row.
  auto meter = shadowView(7, "View", {});
  lines = f.mount(add(6, {meter}));
  CHECK(lines == Lines{
                     "lists of 2: [4 Mailboxes (collapsible): 5 Inbox (3) <tray> *, 6 Sent * custom | 8: 9 Flagged] [12 Tags: 13 Work]",
                 });

  // Taking the footer out joins the two runs.
  lines = f.mount({ShadowViewMutation::RemoveMutation(2, footer, 3), ShadowViewMutation::DeleteMutation(footer)});
  CHECK(lines == Lines{
                     "lists of 2: [4 Mailboxes (collapsible): 5 Inbox (3) <tray> *, 6 Sent * custom | 8: 9 Flagged | 12 Tags: 13 Work]",
                 });

  // And the last section going leaves no list.
  auto sections = std::vector<ShadowView>{
      section(4, dynamic::object()), section(8, dynamic::object()), section(12, dynamic::object())};
  ShadowViewMutationList removals;
  for (int i = 2; i >= 0; i--) {
    removals.push_back(ShadowViewMutation::RemoveMutation(2, sections[i], i + 1));
  }
  lines = f.mount(removals);
  CHECK(lines == Lines{"lists of 2:"});
}

TEST_CASE("a section mounted before its parent is in place still makes its list") {
  Fixture f;
  auto pane = shadowView(2, ngn::SidebarComponentName, {});
  // Fabric builds a new subtree bottom up: the items go in before their section has a parent.
  auto lines = f.mount(
      ShadowViewMutationList{
          ShadowViewMutation::CreateMutation(pane),
          ShadowViewMutation::CreateMutation(section(4, dynamic::object("title", "Mail")))} +
      add(4, {item(5, dynamic::object("label", "Inbox"))}) +
      ShadowViewMutationList{ShadowViewMutation::InsertMutation(2, section(4, dynamic::object("title", "Mail")), 0)} +
      ShadowViewMutationList{ShadowViewMutation::InsertMutation(1, pane, 0)});
  CHECK(lines == Lines{"lists of 2: [4 Mail: 5 Inbox]"});
}

TEST_CASE("the first split view or tabs host in a window is the window's, and one inside another, a modal or tabs is plain") {
  Fixture f;
  auto outer = shadowView(2, ngn::SplitViewComponentName, {});
  auto sidebar = shadowView(3, ngn::SidebarComponentName, {});
  auto content = shadowView(4, ngn::SplitContentComponentName, {});
  auto inner = shadowView(5, ngn::SplitViewComponentName, {});
  // Inserted bottom up, as Fabric does: the inner one is seen first, then the outer one.
  auto innerSidebar = shadowView(6, ngn::SidebarComponentName, {});
  auto innerContent = shadowView(7, ngn::SplitContentComponentName, {});
  ShadowViewMutationList mutations;
  for (const auto &view : {outer, sidebar, content, inner, innerSidebar, innerContent}) {
    mutations.push_back(ShadowViewMutation::CreateMutation(view));
  }
  mutations.push_back(ShadowViewMutation::InsertMutation(5, innerSidebar, 0));
  mutations.push_back(ShadowViewMutation::InsertMutation(5, innerContent, 1));
  mutations.push_back(ShadowViewMutation::InsertMutation(4, inner, 0));
  mutations.push_back(ShadowViewMutation::InsertMutation(2, sidebar, 0));
  mutations.push_back(ShadowViewMutation::InsertMutation(2, content, 1));
  mutations.push_back(ShadowViewMutation::InsertMutation(1, outer, 0));
  auto lines = f.mount(mutations);
  CHECK(lines == Lines{"split view 2 of the window", "split view 5 in the content"});

  // A second one in the same window is plain, and so is one in a modal or in tabs.
  auto second = shadowView(10, ngn::SplitViewComponentName, {});
  auto modal = shadowView(11, "ModalHostView", {});
  auto inModal = shadowView(12, ngn::SplitViewComponentName, {});
  lines = f.mount(
      ShadowViewMutationList{ShadowViewMutation::CreateMutation(modal), ShadowViewMutation::CreateMutation(inModal),
                             ShadowViewMutation::InsertMutation(11, inModal, 0)} +
      add(1, {second}, 1) + ShadowViewMutationList{ShadowViewMutation::InsertMutation(1, modal, 2)});
  CHECK(lines == Lines{"split view 10 in the content", "split view 12 in the content"});

  // Once the window's has gone, the next one mounted takes its place.
  f.mount({ShadowViewMutation::RemoveMutation(1, outer, 0), ShadowViewMutation::DeleteMutation(outer)});
  lines = f.mount(add(1, {shadowView(13, ngn::SplitViewComponentName, {})}, 0));
  CHECK(lines == Lines{"split view 13 of the window"});

  // In a tab app the tabs host owns the window's split view controller.
  Fixture tabs;
  auto host = shadowView(2, "RNSTabsHostIOS", {});
  lines = tabs.mount(add(1, {host}) + add(2, {shadowView(3, ngn::SplitViewComponentName, {})}));
  // The tabs host draws as the window's split view, its tabs the sidebar.
  CHECK(splits(lines) == Lines{"split view 2 of the window", "split view 3 in the content"});
  // Mounted into the tabs before the tabs are in the window, it waits to know where it is.
  Fixture later;
  auto laterHost = shadowView(2, "RNSTabsHostIOS", {});
  auto laterSplit = shadowView(3, ngn::SplitViewComponentName, {});
  lines = later.mount({ShadowViewMutation::CreateMutation(laterHost), ShadowViewMutation::CreateMutation(laterSplit),
                       ShadowViewMutation::InsertMutation(2, laterSplit, 0)});
  CHECK(splits(lines).empty());
  lines = later.mount({ShadowViewMutation::InsertMutation(1, laterHost, 0)});
  CHECK(splits(lines) == Lines{"split view 2 of the window", "split view 3 in the content"});
}

TEST_CASE("a click in a custom row is the content's when it lands on something that takes it") {
  ngn::ViewTree tree;
  auto focusable = props<ngn::DesktopViewComponentDescriptor>(dynamic::object("focusable", true));
  tree.create(shadowView(4, ngn::SidebarItemComponentName, {{0, 0}, {200, 40}}));
  tree.create(shadowView(5, "View", {{0, 0}, {200, 40}}));
  tree.create(shadowView(6, "Paragraph", {{0, 0}, {100, 20}}));
  tree.create(shadowView(7, "View", {{120, 0}, {40, 40}}, focusable));
  tree.create(shadowView(8, "Paragraph", {{0, 0}, {40, 20}}));
  tree.create(shadowView(9, "TextInput", {{160, 0}, {40, 40}}));
  tree.create(shadowView(10, "Switch", {{160, 0}, {40, 40}}));
  tree.insert(4, 5, 0);
  tree.insert(5, 6, 0);
  tree.insert(5, 7, 1);
  tree.insert(7, 8, 0);
  CHECK_FALSE(ngn::rowContentTakesClick(tree, {4, 5, 6}));
  CHECK(ngn::rowContentTakesClick(tree, {4, 5, 7, 8}));
  CHECK(ngn::rowContentTakesClick(tree, {4, 9}));
  CHECK(ngn::rowContentTakesClick(tree, {4, 10}));
  // The row itself is focusable, for the source list's keyboard: that is not the content's.
  tree.update(shadowView(4, ngn::SidebarItemComponentName, {{0, 0}, {200, 40}}, focusable));
  CHECK_FALSE(ngn::rowContentTakesClick(tree, {4, 5, 6}));
}

TEST_CASE("the sidebar's collapsed state follows the app and the user without echoing either") {
  ngn::SidebarCollapse collapse;
  // The app shuts it: the toolkit is told, and its own change after that is not news.
  CHECK(collapse.propChanged(true) == std::optional<bool>(true));
  CHECK_FALSE(collapse.toolkitChanged(true));
  // The user opens it from the title bar: the app hears, and its answer changes nothing.
  CHECK(collapse.toolkitChanged(false));
  CHECK(collapse.propChanged(false) == std::nullopt);
  // An app that keeps it open regardless still hears each change the user makes.
  CHECK(collapse.toolkitChanged(true));
  CHECK(collapse.toolkitChanged(false) == false);
  CHECK(collapse.toolkitChanged(true));
  // And the same prop again is nothing to do.
  CHECK(collapse.propChanged(false) == std::optional<bool>(false));
  CHECK(collapse.propChanged(false) == std::nullopt);
}

TEST_CASE("sizes reported as a divider drags reach layout once a frame, the latest of each") {
  ngn::FrameSizes sizes;
  CHECK(sizes.report(3, {240, 700}));
  CHECK_FALSE(sizes.report(3, {250, 700}));
  CHECK_FALSE(sizes.report(4, {750, 700}));
  CHECK_FALSE(sizes.report(3, {260, 700}));
  auto flushed = sizes.flush();
  REQUIRE(flushed.size() == 2);
  CHECK(flushed[0] == std::pair<Tag, Size>{3, {260, 700}});
  CHECK(flushed[1] == std::pair<Tag, Size>{4, {750, 700}});

  // A size it already has is no change; the next report asks for a frame again.
  CHECK(sizes.report(3, {260, 700}));
  CHECK(sizes.flush().empty());
  CHECK(sizes.flush().empty());

  // A view that went and came back reports from scratch.
  sizes.forget(4);
  sizes.report(4, {750, 700});
  CHECK(sizes.flush().size() == 1);
}
