// NgnView: the GtkWidget each Fabric view mounts as, and the widget a surface fills its window with.
//
// Yoga's frames are authoritative: a view asks GTK for no size of its own (`measure` gives 0) and
// allocates each child at its Fabric frame, moved and transformed as the child's props say. It
// paints its box and a Paragraph's text as GSK render nodes in its `snapshot`, then its children in
// Fabric's order, cut to its shape when it clips its overflow. The approach of Basalt's basalt-gtk
// (MIT, Copyright (c) 2026 Vince Vella); the code is ours.
#pragma once

#include "pango-text.h"

#include <react/renderer/core/EventEmitter.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/core/Props.h>
#include <react/renderer/core/State.h>

#include <gtk/gtk.h>

#include <functional>
#include <optional>
#include <string>

G_BEGIN_DECLS
#define NGN_TYPE_VIEW (ngn_view_get_type())
G_DECLARE_FINAL_TYPE(NgnView, ngn_view, NGN, VIEW, GtkWidget)
G_END_DECLS

namespace ngn::gtk {

struct TextField;

struct ViewData {
  facebook::react::Tag tag{-1};
  std::string component;
  facebook::react::Props::Shared props;
  facebook::react::State::Shared state;
  facebook::react::SharedEventEmitter emitter;
  facebook::react::LayoutMetrics layout{};
  // A Paragraph's text, laid out on the first draw after its state or frame changed.
  std::optional<TextLayout> text;
  // A TextInput's field: the editable child it holds.
  TextField *field{nullptr};

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
