// The core's InputSink: hit tests each pointer event against the ViewTree from the container's
// root, turns a press into Fabric touches on the deepest view, and sends the desktop's mouse
// events. UI thread only, like the tree it reads.
//
// The contract with the engine (packages/integration-tests/mouse-events.test.ts):
//
// - Every move goes to the deepest view under the pointer as a pointer move, and a pointer leave
//   follows the pointer out of the surface, as React Native iOS sends them. React Native's
//   PointerEventsProcessor turns those into over, out, enter and leave for the views that listen,
//   and passes the move on only when a view in the path listens for it.
// - Double click, context menu and wheel are the element events `doubleClick`, `contextMenu` and
//   `wheel`, sent to the deepest view when it or an ancestor opts in through its desktop props
//   (desktop-view-props.h). The engine bubbles them up from there.
//
// - A drag of files, text or urls goes to the nearest view under it whose `fileDrop` prop is true,
//   as `dropEnter` when it comes over that view, `dropLeave` when it goes off it without dropping
//   and `dropPerform` on a drop, which ends the drag without a leave. Enter and perform carry
//   `{ files: [{ uri, name }], text, urls }` (packages/integration-tests/drag-and-drop.test.ts).
// - A press that moves past the drag threshold on a view whose nearest ancestor-or-self with a
//   `dragItem` prop offers something is cancelled (touch cancel), and `onDragOut` starts the drag
//   session; the rest of the gesture belongs to it.
//
// It also decides the cursor: the nearest view under the pointer that names one, `text` over a
// text input, and the default otherwise.
#pragma once

#include "ngn/default-menu.h"
#include "ngn/desktop-view-props.h"
#include "ngn/input.h"
#include "ngn/view-tree.h"

#include <react/renderer/components/view/PointerEvent.h>
#include <react/renderer/components/view/TouchEvent.h>
#include <react/renderer/components/view/primitives.h>

#include <folly/dynamic.h>

#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class Gestures;
struct GesturePointer;

enum class TouchPhase { Start, Move, End, Cancel };
enum class PointerKind { Enter, Leave, Move, Over, Out };

using facebook::react::Cursor;

// The cursor the views under the pointer ask for, `chain` running from the container's root to
// the deepest. `Cursor::Auto` when none does: the toolkit's default.
Cursor cursorFor(const ViewTree &tree, const std::vector<Tag> &chain);

// What a `[dragItem]` view offers when dragged out: `file://` urls, text and a url.
struct DragOutItem {
  std::vector<std::string> files;
  std::optional<std::string> text;
  std::optional<std::string> url;
  bool operator==(const DragOutItem &) const = default;
};

// The item of a `dragItem` prop, or nothing when it is null or offers nothing.
std::optional<DragOutItem> dragItemOf(const folly::dynamic &prop);

// How far a press moves before it becomes a drag, in points (AppKit's own threshold).
constexpr float kDragThreshold = 4;

class InputDispatcher : public InputSink {
 public:
  explicit InputDispatcher(const ViewTree &tree);

  void addContainer(ContainerId container, SurfaceId surfaceId, Tag rootTag) override;
  void removeContainer(ContainerId container) override;
  void pointerDown(const PointerInput &input) override;
  void pointerMove(const PointerInput &input) override;
  void pointerUp(const PointerInput &input) override;
  void pointerLeave(SurfaceId surfaceId, const PointerInput &input) override;
  bool contextMenu(const PointerInput &input) override;
  bool wheel(const PointerInput &input, const WheelDelta &delta) override;
  bool dragOver(const PointerInput &input, const DragItems &items) override;
  void dragExit(ContainerId container) override;
  bool drop(const PointerInput &input, const DragItems &items) override;
  void magnify(const PointerInput &input, double magnification, GesturePhase phase) override;
  void rotate(const PointerInput &input, double degrees, GesturePhase phase) override;

  // The gesture handler's recognisers (gestures.h), which see every press, move, hover, scroll and
  // trackpad gesture before JavaScript's touches do. One that activates cancels the press
  // JavaScript was told of. Null for none.
  void setGestures(Gestures *gestures);

  // The context menu a secondary click at `input` shows: the nearest view under it with a
  // `contextMenu` prop, and its entries. Nothing when no view there has one.
  struct ContextMenuTarget {
    Tag tag;
    std::vector<MenuItem> items;
  };
  std::optional<ContextMenuTarget> contextMenuAt(const PointerInput &input) const;
  // An item of the context menu of `tag` was chosen: `topContextMenuSelect` with its id.
  void contextMenuSelect(Tag tag, const std::string &id);

  // VoiceOver's press, or Space on a focused view, for a view with no handler of its own: a press
  // and release at the view's centre, sent to the view itself as iOS's synthesized tap is, through
  // the container of `surfaceId` nearest to it. False when no container holds it or a press is
  // already down.
  bool activate(SurfaceId surfaceId, Tag tag);

  // After a transaction: the views under a still pointer may have changed what cursor they ask
  // for.
  void didMount(SurfaceId surfaceId);

  // The hovered views of a surface, outermost first.
  const std::vector<Tag> &hovered(SurfaceId surfaceId) const;

  // Told each time the cursor should change.
  std::function<void(Cursor)> onCursor;
  // Told when a press becomes a drag out of `tag`, at `input` (the move that crossed the
  // threshold): the backend starts the drag session with the item.
  std::function<void(Tag tag, const PointerInput &input, const DragOutItem &item)> onDragOut;

 protected:
  // Where events leave the core. The defaults send them through the view's event emitter; tests
  // record them instead.
  virtual void emitTouch(TouchPhase phase, const ViewTree::Node &target, const facebook::react::TouchEvent &event);
  virtual void emitPointer(PointerKind kind, const ViewTree::Node &node, const facebook::react::PointerEvent &event);
  // `name` without React Native's `top` prefix: `doubleClick`, `contextMenu`, `contextMenuSelect`,
  // `wheel`, `dropEnter`, `dropLeave` or `dropPerform`.
  virtual void emitElementEvent(const ViewTree::Node &node, const std::string &name, folly::dynamic payload);

 private:
  struct Container {
    SurfaceId surfaceId;
    Tag root;
  };
  struct Press {
    ContainerId container;
    Tag target;
    int clickCount;
    Point start;
  };
  // Whether a drag out starts from this move of the press; true when it did.
  bool startDragOut(const PointerInput &input);

  void updateHover(const Container &container, std::vector<Tag> chain, const PointerInput &input);
  void sendTouch(TouchPhase phase, const PointerInput &input);
  // Sends an element event to the deepest view of `chain` when it or an ancestor opted in.
  bool sendElementEvent(
      const Container &container,
      const std::vector<Tag> &chain,
      bool DesktopProps::*optIn,
      const std::string &name,
      folly::dynamic payload);
  folly::dynamic locationPayload(const Container &container, Tag target, Point point) const;
  // Where a container's root sits in its surface: page coordinates are the surface's.
  Point pageOrigin(const Container &container) const;
  facebook::react::PointerEvent pointerEvent(const PointerInput &input, Point pageOrigin) const;
  void setCursor(Cursor cursor);
  // The nearest view under `input` that takes drops.
  std::optional<Tag> dropTargetAt(const PointerInput &input) const;
  void leaveDropTarget();

  // The surface's coordinates of a point in a container, and the gesture pointer for it.
  GesturePointer gesturePointer(const Container &container, const PointerInput &input) const;
  // A gesture took the press: JavaScript's touch is cancelled.
  void claimPress();

  const ViewTree &tree_;
  Gestures *gestures_{nullptr};
  std::optional<PointerInput> lastInput_;
  // The press the gestures saw, which they keep after one of them takes it from JavaScript.
  bool gesturePressed_{false};
  std::map<ContainerId, Container> containers_;
  std::map<SurfaceId, std::vector<Tag>> hovered_;
  std::optional<Press> press_;
  // A drag out has the rest of the gesture, up to the release.
  bool draggingOut_{false};
  // The surface the pointer is over, if any, and the cursor last asked for.
  std::optional<SurfaceId> pointerSurface_;
  std::optional<Cursor> cursor_;
  // The view a drag is over, and the container it came through.
  struct DropTarget {
    ContainerId container;
    Tag tag;
  };
  std::optional<DropTarget> dropTarget_;
};

// A drag's items as the drop events carry them: `{ files: [{ uri, name }], text, urls }`.
folly::dynamic dropPayload(const DragItems &items);

} // namespace ngn
