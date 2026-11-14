// The core's InputSink: hit tests each pointer event against the ViewTree from the container's
// root, turns a press into Fabric touches on the deepest view, and diffs the hovered chain per
// surface into pointer enter and leave events for the views whose props ask for them (React
// Native iOS gates them the same way). UI thread only, like the tree it reads.
#pragma once

#include "ngn/input.h"
#include "ngn/view-tree.h"

#include <react/renderer/components/view/PointerEvent.h>
#include <react/renderer/components/view/TouchEvent.h>

#include <map>
#include <optional>
#include <vector>

namespace ngn {

enum class TouchPhase { Start, Move, End };

class InputDispatcher : public InputSink {
 public:
  explicit InputDispatcher(const ViewTree &tree);

  void addContainer(ContainerId container, SurfaceId surfaceId, Tag rootTag) override;
  void removeContainer(ContainerId container) override;
  void pointerDown(const PointerInput &input) override;
  void pointerMove(const PointerInput &input) override;
  void pointerUp(const PointerInput &input) override;
  void pointerLeave(SurfaceId surfaceId, const PointerInput &input) override;

  // The hovered views of a surface, outermost first.
  const std::vector<Tag> &hovered(SurfaceId surfaceId) const;

 protected:
  // Where events leave the core. The defaults send them through the view's TouchEventEmitter;
  // tests record them instead.
  virtual void emitTouch(TouchPhase phase, const ViewTree::Node &target, const facebook::react::TouchEvent &event);
  virtual void emitPointerEnter(const ViewTree::Node &node, const facebook::react::PointerEvent &event);
  virtual void emitPointerLeave(const ViewTree::Node &node, const facebook::react::PointerEvent &event);

 private:
  struct Container {
    SurfaceId surfaceId;
    Tag root;
  };
  struct Press {
    ContainerId container;
    Tag target;
  };

  void updateHover(const Container &container, std::vector<Tag> chain, const PointerInput &input);
  void sendTouch(TouchPhase phase, const PointerInput &input);
  // Where a container's root sits in its surface: page coordinates are the surface's.
  Point pageOrigin(const Container &container) const;
  facebook::react::PointerEvent pointerEvent(const PointerInput &input, Point pageOrigin) const;

  const ViewTree &tree_;
  std::map<ContainerId, Container> containers_;
  std::map<SurfaceId, std::vector<Tag>> hovered_;
  std::optional<Press> press_;
};

} // namespace ngn
