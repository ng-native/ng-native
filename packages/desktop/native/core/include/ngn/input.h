// The input and hover interface: a backend reports the pointer, the core decides what it hit and
// which events Fabric gets (touches for press, pointer enter and leave for hover).
//
// A container is any native view that hosts part of a surface: the window's content, a sheet, a
// popover, a sidebar pane. Each hit-tests from its own root view in its own coordinates.
#pragma once

#include <react/renderer/graphics/Point.h>
#include <react/renderer/core/ReactPrimitives.h>

#include <optional>
#include <string>
#include <vector>

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
  // Which press of a run of quick ones this is: 2 for a double click. A press only.
  int clickCount{1};
};

// Where a trackpad gesture or scroll is: it begins, changes and ends, or is cancelled. A wheel's
// clicks and a scroll's momentum have none.
enum class GesturePhase { Began, Changed, Ended, Cancelled };

// A scroll wheel's or trackpad's movement, as the DOM's WheelEvent has it.
struct WheelDelta {
  double x{0};
  double y{0};
  double z{0};
  // 0 in pixels (points), 1 in lines, 2 in pages.
  int mode{0};
  // A trackpad's own scroll, by its phase, and whether the content moves with the fingers
  // (natural scrolling): what turns the deltas into the fingers' movement for a gesture.
  std::optional<GesturePhase> phase;
  bool naturalScrolling{true};
};

// A file dragged onto a view: its `file://` url and its name.
struct DroppedFile {
  std::string uri;
  std::string name;
};

// What a drag from Finder or another app carries, as far as the toolkit shows it: files, plain
// text, and urls that are not files.
struct DragItems {
  std::vector<DroppedFile> files;
  std::optional<std::string> text;
  std::vector<std::string> urls;
};

// The items of a drag's urls (`file://` ones are files, named by their last part decoded) and
// its plain text, which is left out when it only repeats a url or a file's path.
DragItems dragItems(const std::vector<std::string> &urls, std::optional<std::string> text);

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
  // A secondary click (or Control-click). True when a view took it, so the toolkit shows no menu
  // of its own.
  virtual bool contextMenu(const PointerInput &input) = 0;
  // A wheel turn over the container. It still scrolls what it is over; true when a view heard it.
  virtual bool wheel(const PointerInput &input, const WheelDelta &delta) = 0;
  // A drag over the container, as it enters and each time it moves. True when a view under it
  // takes drops, so the toolkit shows a copy; false and it shows none.
  virtual bool dragOver(const PointerInput &input, const DragItems &items) = 0;
  // The drag left the container without dropping, or was cancelled.
  virtual void dragExit(ContainerId container) = 0;
  // The drag was dropped on the container. True when a view took it.
  virtual bool drop(const PointerInput &input, const DragItems &items) = 0;
  // A trackpad's pinch (`magnification` since the last step, 0.1 for a tenth bigger) and rotation
  // (degrees since the last step, anticlockwise) over the container.
  virtual void magnify(const PointerInput & /*input*/, double /*magnification*/, GesturePhase /*phase*/) {}
  virtual void rotate(const PointerInput & /*input*/, double /*degrees*/, GesturePhase /*phase*/) {}
};

} // namespace ngn
