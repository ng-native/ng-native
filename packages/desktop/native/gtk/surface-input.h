// The pointer on a surface, to the core's InputSink, which hit-tests the view tree itself and
// decides press, hover and the cursor. A capture-phase legacy controller on the surface's widget
// sees each event before any widget under it, and never claims one, so a text field under the
// pointer still takes its own click.
#pragma once

#include "ngn/input.h"

#include <react/renderer/components/view/primitives.h>

#include <gtk/gtk.h>

#include <cstdint>

namespace ngn::gtk {

// Which press of a run of quick ones a press is, by GTK's double-click time and distance: GDK
// gives a raw press no count of its own.
class ClickCounter {
 public:
  ClickCounter(int intervalMs, int distance) : intervalMs_(intervalMs), distance_(distance) {}
  int press(uint32_t timeMs, double x, double y, unsigned button);

 private:
  int intervalMs_;
  int distance_;
  int count_{0};
  uint32_t lastTime_{0};
  double lastX_{0}, lastY_{0};
  unsigned lastButton_{0};
};

// A DOM `buttons` bit for a GDK button: 1 primary, 2 secondary, 4 middle, 8 and 16 back and
// forward (GDK's 8 and 9).
int buttonBit(unsigned gdkButton);

// The CSS name GTK's cursors go by, or null for the default.
const char *cursorName(facebook::react::Cursor cursor);

// Feeds `widget`'s pointer events to `input` as the container `container` of `surfaceId`.
void attachPointerInput(GtkWidget *widget, facebook::react::SurfaceId surfaceId, ContainerId container, InputSink *input);

} // namespace ngn::gtk
