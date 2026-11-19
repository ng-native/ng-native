// A ScrollView on GTK: a GtkScrolledWindow filling the view, its content mounted into a document
// view the size of the content, as the macOS host mounts it into an NSScrollView's document view.
// The wheel, touchpad, kinetic scrolling and scroll bars are GTK's. Each scroll reports onScroll,
// updates the view's state and tells the core's hit test the new offset (onOffset).
//
// Scroll bars follow `gtk-overlay-scrolling`: overlay ones float over the content; classic ones take
// a strip of the view, which the core's scrollers.h lays the content out without.
#pragma once

#include "view-widget.h"

#include "ngn/desktop-props.h"
#include "ngn/scrollers.h"

#include <react/renderer/graphics/Point.h>
#include <react/renderer/graphics/Size.h>

#include <folly/dynamic.h>

#include <gtk/gtk.h>

#include <atomic>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn::gtk {

struct ScrollBox {
  GtkWidget *scrolled{nullptr};
  // The view the content mounts into, the content's size.
  GtkWidget *document{nullptr};
  ViewData *view{nullptr};
  facebook::react::Size content{};
  bool showsVertical{true};
  bool showsHorizontal{true};
  bool enabled{true};
  // GTK's own controllers on the scrolled window, turned off while scrolling is not enabled, and
  // the phase each had as it was turned off.
  std::vector<std::pair<GtkEventController *, GtkPropagationPhase>> controllers;
  // The `contentOffset` prop last read, and one not yet applied: it waits for the content's size
  // and the view's, and is applied once, as the prop arrives or changes.
  std::optional<facebook::react::Point> offsetProp;
  std::optional<facebook::react::Point> pendingOffset;
  guint pendingSource{0};
  // An offset the backend set, which the state already has.
  bool settingOffset{false};
  // The frame clock handler measuring the gutter again once a new scroll bar style applies.
  gulong remeasure{0};
  GdkFrameClock *remeasureClock{nullptr};
  int remeasureFrames{0};
  int steadyFrames{0};
  float measuredWidth{-1};
  // A new gutter's clone of the node not yet applied: React Native replaces a state update not
  // yet applied with the next one, which then clones in its place. Read where updates apply.
  std::shared_ptr<std::atomic<bool>> relayoutOwed{std::make_shared<std::atomic<bool>>(false)};
};

// Told on the UI thread as a scroll view's content moves: its tag and its offset.
using ScrollOffsetChanged = std::function<void(facebook::react::Tag, facebook::react::Point)>;
void onScrollOffset(ScrollOffsetChanged changed);

// The scroller style in force, and the width a classic vertical scroll bar takes in `scrolled`.
ScrollerStyle scrollerStyle(GtkWidget *widget);
float classicScrollerWidth(GtkWidget *scrolled);

// Makes `view`'s scrolled window and document, children of `widget`.
void makeScrollView(GtkWidget *widget, ViewData &view);
void destroyScrollView(ViewData &view);
// The widget `view`'s children mount into: its document for a scroll view, else its own.
GtkWidget *contentWidget(GtkWidget *widget);
void applyScrollViewProps(ViewData &view);
void applyScrollViewState(ViewData &view);
// Shows the scroll bars the core says show, and lays the content out again when their gutter changed.
void updateScrollers(ViewData &view);
void allocateScrollView(ViewData &view, int width, int height);
// scrollTo and scrollToEnd.
void scrollViewCommand(ViewData &view, const std::string &name, const folly::dynamic &args);

} // namespace ngn::gtk
