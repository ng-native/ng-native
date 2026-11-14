// The input and hover interface: a backend reports the pointer, the core decides what it hit and
// which events Fabric gets (touches for press, pointer enter and leave for hover).
//
// A container is any native view that hosts part of a surface: the window's content, a sheet, a
// popover, a sidebar pane. Each hit-tests from its own root view in its own coordinates.
#pragma once

#include <react/renderer/graphics/Point.h>
#include <react/renderer/core/ReactPrimitives.h>

namespace ngn {

using ContainerId = int;

struct PointerInput {
  ContainerId container{0};
  // In the container's coordinates, top-left origin.
  facebook::react::Point point{};
  // In screen coordinates, top-left origin.
  facebook::react::Point screenPoint{};
  // Pressed buttons as a DOM `buttons` bitmask.
  int buttons{0};
  float pressure{0};
  // Seconds, on the clock the toolkit stamps its events with.
  double timestamp{0};
};

class InputSink {
 public:
  virtual ~InputSink() = default;

  // `rootTag` is the view the container's hit test starts from. The surface's main container
  // uses the surface's root (tag == surfaceId).
  virtual void addContainer(ContainerId container, facebook::react::SurfaceId surfaceId, facebook::react::Tag rootTag) = 0;
  virtual void removeContainer(ContainerId container) = 0;

  virtual void pointerDown(const PointerInput &input) = 0;
  // A move with or without a button down. Hover follows the container named here, which is the
  // one under the pointer now, not necessarily the one that saw the last event.
  virtual void pointerMove(const PointerInput &input) = 0;
  virtual void pointerUp(const PointerInput &input) = 0;
  // The pointer left every container of this surface.
  virtual void pointerLeave(facebook::react::SurfaceId surfaceId, const PointerInput &input) = 0;
};

} // namespace ngn
