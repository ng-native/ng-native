// The source list a sidebar's sections draw as (split-view.mm's NGNSourceListView): where its rows
// sit, and what a click on a row selects.
#import "../../split-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;
using ngn::testing::viewProps;

namespace {

Props::Shared sectionProps(folly::dynamic raw) {
  return parsedProps<ngn::SidebarSectionComponentDescriptor>(std::move(raw));
}

// An item as `<sidebar-item>` commits it on macOS: focusable, as a control is.
Props::Shared itemProps(folly::dynamic raw) {
  raw["focusable"] = true;
  return parsedProps<ngn::SidebarItemComponentDescriptor>(std::move(raw));
}

NSOutlineView *outlineIn(NSView *view) {
  if ([view isKindOfClass:NSOutlineView.class]) {
    return (NSOutlineView *)view;
  }
  for (NSView *child in view.subviews) {
    if (NSOutlineView *found = outlineIn(child)) {
      return found;
    }
  }
  return nil;
}

// The host's settings the source list reads, put back on every way out.
struct Restore {
  ngn::InputSink *input = NGNSplitView.input;
  std::function<bool(NSInteger, NSPoint)> takesClick = NGNSplitView.rowContentTakesClick;
  ~Restore() {
    NGNSplitView.input = input;
    NGNSplitView.rowContentTakesClick = takesClick;
  }
};

// A press at the middle of `row`.
NSEvent *pressOn(NSOutlineView *outline, NSInteger row) {
  NSRect rect = [outline rectOfRow:row];
  return [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown
                            location:[outline convertPoint:NSMakePoint(NSMidX(rect), NSMidY(rect)) toView:nil]
                       modifierFlags:0
                           timestamp:0
                        windowNumber:outline.window.windowNumber
                             context:nil
                         eventNumber:0
                          clickCount:1
                            pressure:1];
}

// Counts the presses a custom row's container hands the core: the clicks its content takes.
struct Presses final : ngn::InputSink {
  int downs = 0;
  void addContainer(ngn::ContainerId, SurfaceId, Tag) override {}
  void removeContainer(ngn::ContainerId) override {}
  void pointerDown(const ngn::PointerInput &) override { downs++; }
  void pointerMove(const ngn::PointerInput &) override {}
  void pointerUp(const ngn::PointerInput &) override {}
  void pointerLeave(SurfaceId, const ngn::PointerInput &) override {}
  bool contextMenu(const ngn::PointerInput &) override { return false; }
  ngn::WheelResult wheel(const ngn::PointerInput &, const ngn::WheelDelta &) override { return {}; }
  bool dragOver(const ngn::PointerInput &, const ngn::DragItems &) override { return false; }
  void dragExit(ngn::ContainerId) override {}
  bool drop(const ngn::PointerInput &, const ngn::DragItems &) override { return false; }
};

} // namespace

TEST_CASE("A titled section's rows line up with its title and with an untitled section's rows") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SidebarSectionComponentName, sectionProps(folly::dynamic::object())), 4);
  mounted.add(MountedViews::shadow(6, ngn::SidebarItemComponentName, itemProps(folly::dynamic::object("label", "Home"))), 5);
  mounted.add(
      MountedViews::shadow(
          7, ngn::SidebarSectionComponentName, sectionProps(folly::dynamic::object("title", "Build")), 30),
      4);
  mounted.add(MountedViews::shadow(8, ngn::SidebarItemComponentName, itemProps(folly::dynamic::object("label", "Apps"))), 7);
  NSOutlineView *outline = outlineIn(mounted.view(4));
  REQUIRE((outline != nil));
  REQUIRE(outline.numberOfRows == 3);
  REQUIRE([outline levelForRow:2] == 1);

  [outline layoutSubtreeIfNeeded];
  CGFloat home = NSMinX([outline viewAtColumn:0 row:0 makeIfNecessary:YES].frame);
  CGFloat title = NSMinX([outline viewAtColumn:0 row:1 makeIfNecessary:YES].frame);
  CGFloat apps = NSMinX([outline viewAtColumn:0 row:2 makeIfNecessary:YES].frame);
  CHECK(apps == doctest::Approx(home));
  CHECK(apps == doctest::Approx(title));
  CHECK(NSMinX([outline frameOfCellAtColumn:0 row:2]) == doctest::Approx(NSMinX([outline frameOfCellAtColumn:0 row:0])));
  // Taken from the cell's left, not added to its right: it still ends where the row's others do.
  CHECK(NSMaxX([outline frameOfCellAtColumn:0 row:2]) == doctest::Approx(NSMaxX([outline frameOfCellAtColumn:0 row:0])));
}

TEST_CASE("A click on a custom row's content that does not take it selects the row") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  // The core's answer for a row whose content is a view, text and an icon (rowContentTakesClick).
  NGNSplitView.rowContentTakesClick = [](NSInteger, NSPoint) { return false; };
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SidebarSectionComponentName, sectionProps(folly::dynamic::object())), 4);
  mounted.add(MountedViews::shadow(6, ngn::SidebarItemComponentName, itemProps(folly::dynamic::object("label", "Home"))), 5);
  auto custom = MountedViews::shadow(7, ngn::SidebarItemComponentName, itemProps(folly::dynamic::object("label", "Storage")));
  mounted.add(custom, 5);
  mounted.add(MountedViews::shadow(8, "View", viewProps(folly::dynamic::object())), 7);
  NSOutlineView *outline = outlineIn(mounted.view(4));
  REQUIRE((outline != nil));
  REQUIRE(outline.numberOfRows == 2);
  [outline layoutSubtreeIfNeeded];
  REQUIRE(([outline viewAtColumn:0 row:1 makeIfNecessary:YES] != nil));

  // NSTableView's mouseDown: asks this of the view under the click: YES hands the click to that
  // view and leaves the row unselected. The content's clicks went to it before (rowContentTakesClick).
  NSEvent *press = pressOn(outline, 1);
  NSView *item = mounted.view(7);
  NSView *content = mounted.view(8);
  CHECK_FALSE([outline validateProposedFirstResponder:item forEvent:press]);
  CHECK_FALSE([outline validateProposedFirstResponder:content forEvent:press]);
  // A native row's label still answers as AppKit has it.
  NSView *label = ((NSTableCellView *)[outline viewAtColumn:0 row:0 makeIfNecessary:YES]).textField;
  CHECK_FALSE([outline validateProposedFirstResponder:label forEvent:pressOn(outline, 0)]);
}

TEST_CASE("An item hears whether its row's selection is drawn emphasized") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SidebarSectionComponentName, sectionProps(folly::dynamic::object())), 4);
  mounted.add(MountedViews::shadow(6, ngn::SidebarItemComponentName, itemProps(folly::dynamic::object("label", "Home"))), 5);
  NSOutlineView *outline = outlineIn(mounted.view(4));
  REQUIRE((outline != nil));
  auto *item = (NGNSidebarItemView *)mounted.view(6);
  NSTableRowView *row = [outline rowViewAtRow:0 makeIfNecessary:YES];
  REQUIRE((row != nil));
  CHECK(item.rowEmphasized == row.emphasized);
  // The window stops being key, or the list loses the focus: the selection turns grey.
  row.emphasized = NO;
  CHECK_FALSE(item.rowEmphasized);
  row.emphasized = YES;
  CHECK(item.rowEmphasized);
}

TEST_CASE("A click the window sends to a custom row's views goes to the content only when it takes it") {
  // Never freed: the pane containers hold a pointer to it, and AppKit can free them in a later test.
  Presses &presses = *new Presses;
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &presses;
  bool takes = false;
  NGNSplitView.rowContentTakesClick = [&](NSInteger, NSPoint) { return takes; };
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SidebarSectionComponentName, sectionProps(folly::dynamic::object())), 4);
  mounted.add(MountedViews::shadow(6, ngn::SidebarItemComponentName, itemProps(folly::dynamic::object("label", "Storage"))), 5);
  mounted.add(MountedViews::shadow(7, "View", viewProps(folly::dynamic::object())), 6);
  NSOutlineView *outline = outlineIn(mounted.view(4));
  REQUIRE((outline != nil));
  [outline layoutSubtreeIfNeeded];
  REQUIRE(([outline viewAtColumn:0 row:0 makeIfNecessary:YES] != nil));
  NSEvent *press = pressOn(outline, 0);
  NSView *content = mounted.view(7);
  // The window's hit test answers the row's own views, not the outline view.
  REQUIRE(([mounted.window.contentView hitTest:[mounted.window.contentView.superview convertPoint:press.locationInWindow fromView:nil]] == content));
  auto release = [&] {
    return [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp
                              location:press.locationInWindow
                         modifierFlags:0
                             timestamp:0
                          windowNumber:press.windowNumber
                               context:nil
                           eventNumber:0
                            clickCount:1
                              pressure:0];
  };

  // Text or a view: the outline view has it, and the content never hears a press.
  [NSApp postEvent:release() atStart:NO];
  [content mouseDown:press];
  CHECK(presses.downs == 0);

  // A pressable: the content has it.
  takes = true;
  [content mouseDown:press];
  CHECK(presses.downs == 1);
  [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:NSDate.distantPast inMode:NSDefaultRunLoopMode dequeue:YES];
}

TEST_CASE("A native row draws its item's SVG icon as a template image, and none once it is taken away") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(5, ngn::SidebarSectionComponentName, sectionProps(folly::dynamic::object())), 4);
  auto item = MountedViews::shadow(
      6, ngn::SidebarItemComponentName, itemProps(folly::dynamic::object("label", "Skills")("svgIcon", ngn::testing::kTopHalfIcon)));
  mounted.add(item, 5);
  NSOutlineView *outline = outlineIn(mounted.view(4));
  REQUIRE((outline != nil));
  auto imageOf = [&] {
    auto *cell = (NSTableCellView *)[outline viewAtColumn:0 row:0 makeIfNecessary:YES];
    REQUIRE((cell != nil));
    return cell.imageView.image;
  };

  NSImage *image = imageOf();
  REQUIRE((image != nil));
  // Tinted by AppKit for the selection, the window's state and Increase Contrast, as a symbol is.
  CHECK([image isTemplate]);
  CHECK(image.size.width == 16);
  CHECK(image.size.height == 16);
  CHECK(ngn::testing::imageAlpha(image, 16, 8, 2) == doctest::Approx(1));
  CHECK(ngn::testing::imageAlpha(image, 16, 8, 13) == doctest::Approx(0));

  // An SF Symbol wins over it, as it does on a button.
  mounted.update(item, itemProps(folly::dynamic::object("label", "Skills")("svgIcon", ngn::testing::kTopHalfIcon)("sfSymbol", "star")));
  REQUIRE((imageOf() != nil));
  CHECK(imageOf().size.width != 16);

  mounted.update(item, itemProps(folly::dynamic::object("label", "Skills")("svgIcon", nullptr)));
  CHECK((imageOf() == nil));

  // Markup that is no svg is no icon.
  mounted.update(item, itemProps(folly::dynamic::object("label", "Skills")("svgIcon", "lucideBlocks")));
  CHECK((imageOf() == nil));
}
