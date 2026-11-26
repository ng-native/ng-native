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

#include <folly/dynamic.h>

#include <optional>
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
  // Whether the window's toolbar (macOS) or header bar (Linux) shows the sidebar button.
  bool toggleButton{true};
  // The content pane's own: `plain` or `inset`.
  std::string contentStyle;
};

// Whether the content pane with these props is drawn inset: a card with rounded corners, this far
// from the edges of its pane's space and below the toolbar, on the sidebar's backdrop. `props` is
// the content pane's, or null before it has any.
bool insetContent(const SplitPaneProps *props);
constexpr facebook::react::Float kInsetContentMargin = 8;
constexpr facebook::react::Float kInsetContentRadius = 10;

// The narrowest and widest a sidebar is dragged to, and the width it starts at when its toolkit's
// autosave holds none: the app's bounds, or 150 and 400 where it sets none, with the widest never
// below the narrowest.
struct SidebarWidths {
  facebook::react::Float minimum{0};
  facebook::react::Float maximum{0};
  facebook::react::Float starting{0};
  bool operator==(const SidebarWidths &) const = default;
};
// `props` is the sidebar's, or null before it has any.
SidebarWidths sidebarWidths(const SplitPaneProps *props);

// The narrowest the content pane is beside the sidebar, in points: a window narrower than the
// sidebar's narrowest plus this is compact, and a split view that folds into a stack (FoldingSplit)
// folds there.
constexpr facebook::react::Float kSplitContentMinWidth = 360;
facebook::react::Float sidebarCompactWidth(const SidebarWidths &widths);

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
  // An icon's SVG markup (ngn/svg-markup.h). macOS draws it when there is no `sfSymbol`; Linux,
  // which has no SF Symbols, always draws it.
  std::string svgIcon;
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
  // An icon's SVG markup, drawn in the row's text colour: on macOS when the row has no `sfSymbol`,
  // and always on Linux, which has no SF Symbols.
  std::string svgIcon;
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
  // What the toolkit shows now.
  bool collapsed() const {
    return toolkit_;
  }

 private:
  bool prop_{false};
  bool toolkit_{false};
};

// Where a toolkit with no autosave of its own (GTK's) keeps a sidebar's collapsed state between
// launches: in the app's preferences under its `autosaveName`, as window frames are (app-windows.h).
// Its width is not kept, since libadwaita's sidebar has no divider to drag. None for no name.
std::optional<std::string> sidebarCollapsedKey(const std::string &autosaveName);
// The state saved there, or none for nothing saved or a value that is not a boolean.
std::optional<bool> savedSidebarCollapsed(const std::optional<folly::dynamic> &value);

// A split view that folds into a stack whose root is the sidebar (libadwaita's
// AdwNavigationSplitView), and what it shows. The core decides, the toolkit only shows the result:
// - side by side, the sidebar beside the content, while the window is wide and the sidebar is not
//   collapsed;
// - a stack with the content in front while the window is wide and the sidebar is collapsed, so a
//   collapsed sidebar is out of sight as it is on macOS;
// - a stack at a compact width, whose front pane is the stack's own: the content until Show Sidebar
//   brings the sidebar forward, and the content again once an item is chosen there. That is no
//   collapse the app hears of, so the panes are side by side again as the window widens.
class FoldingSplit {
 public:
  struct Showing {
    bool stacked{false};
    // In a stack, the content in front, else the sidebar.
    bool content{true};
    bool operator==(const Showing &) const = default;
  };
  Showing showing() const;
  // The window crossed the compact width (sidebarCompactWidth).
  void setCompact(bool compact);
  bool compact() const {
    return compact_;
  }
  // The sidebar's collapsed state, as SidebarCollapse settles it.
  void setCollapsed(bool collapsed);
  // An item chosen in the sidebar: a stack shows the content.
  void chose();
  // Show Sidebar (F9, the header bar's sidebar button). At a compact width the stack swaps its
  // front pane; otherwise the sidebar's collapsed state flips, and the new state is returned for
  // the toolkit to report (SidebarCollapse::toolkitChanged).
  std::optional<bool> toggle();

 private:
  bool compact_{false};
  bool collapsed_{false};
  bool sidebarInFront_{false};
};

// What a toolkit drawing a source list keeps between the lists the core sends: the sections the
// user folded with their disclosure, each forgotten as its section goes.
class SourceListFolds {
 public:
  // The list now: the folds of sections no longer in it go.
  void setList(const SourceList &list);
  void fold(Tag section, bool folded);
  bool folded(Tag section) const;

 private:
  std::unordered_set<Tag> folded_;
};

// The row the app has selected in `list`, if any: the last one that says so.
std::optional<Tag> selectedRow(const SourceList &list);
// Whether `a` and `b` differ in which row is selected and nothing else: a toolkit then moves the
// selection rather than building the list again, which would take the rows away from under the
// pointer that just chose one.
bool onlySelectionDiffers(const SourceList &a, const SourceList &b);

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
