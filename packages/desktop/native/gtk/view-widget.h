// NgnView: the GtkWidget each Fabric view mounts as, and the widget a surface fills its window with.
//
// Yoga's frames are authoritative: a view asks GTK for no size of its own (`measure` gives 0) and
// allocates each child at its Fabric frame, moved and transformed as the child's props say. It
// paints its box and a Paragraph's text as GSK render nodes in its `snapshot`, then its children in
// Fabric's order, cut to its shape when it clips its overflow. The approach of Basalt's basalt-gtk
// (MIT, Copyright (c) 2026 Vince Vella); the code is ours.
#pragma once

#include "pango-text.h"

#include "ngn/desktop-props.h"
#include "ngn/svg.h"

#include <react/renderer/core/EventEmitter.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/core/Props.h>
#include <react/renderer/core/State.h>

#include <gtk/gtk.h>

#include <functional>
#include <memory>
#include <optional>
#include <string>

G_BEGIN_DECLS
#define NGN_TYPE_VIEW (ngn_view_get_type())
G_DECLARE_FINAL_TYPE(NgnView, ngn_view, NGN, VIEW, GtkWidget)
G_END_DECLS

namespace ngn::gtk {

struct ImageLoad;
struct ScrollBox;
class SvgImageHold;
struct TextField;

struct ViewData {
  // The widget holding this data, which a view whose role changes trades for another.
  GtkWidget *widget{nullptr};
  facebook::react::Tag tag{-1};
  std::string component;
  facebook::react::Props::Shared props;
  facebook::react::State::Shared state;
  facebook::react::SharedEventEmitter emitter;
  facebook::react::LayoutMetrics layout{};
  DesktopProps desktop;
  // A Paragraph's text, laid out on the first draw after its state or frame changed.
  std::optional<TextLayout> text;
  // A TextInput's field: the editable child it holds.
  TextField *field{nullptr};
  // An Image's source and the image it loaded.
  std::shared_ptr<ImageLoad> image;
  // A native control's widget (native-controls.h), which fills the view.
  GtkWidget *control{nullptr};
  // A ScrollView's scrolled window, which holds the document its content mounts into.
  ScrollBox *scroll{nullptr};
  // A scroll view's document: as large as the content it scrolls, which GTK reads from its measure.
  ScrollBox *documentOf{nullptr};
  // A placed split view's AdwBreakpointBin (split-view.h), which fills the view.
  GtkWidget *split{nullptr};
  // An svg's document, which the core builds from the elements under it.
  std::shared_ptr<const SvgDocument> svg;
  // The images its last draw asked for, kept for it in the shared cache.
  std::shared_ptr<SvgImageHold> svgImages;

  // A surface's widget: its root view fills it, and it reports its size as it changes.
  bool surface{false};
  facebook::react::SurfaceId surfaceId{-1};
  std::function<void(int width, int height)> resized;
  int width{-1}, height{-1};
};

// A view's widget with its accessible role, which GTK fixes as it makes it, floating: the caller
// sinks it.
GtkWidget *makeViewWidget(GtkAccessibleRole role = GTK_ACCESSIBLE_ROLE_GENERIC);
// The widget a surface's views mount into. It fills its parent and calls `resized` with its size.
GtkWidget *makeSurfaceWidget(facebook::react::SurfaceId surfaceId, std::function<void(int, int)> resized);

// Null for a widget that is not an NgnView.
ViewData *viewData(GtkWidget *widget);
// Trades two views' data, for a widget that replaces another: each is freed with the widget that
// holds it.
void swapViewData(GtkWidget *a, GtkWidget *b);

// Drops a Paragraph's laid-out text, to be laid out again on its next draw.
void forgetText(ViewData &data);

} // namespace ngn::gtk
