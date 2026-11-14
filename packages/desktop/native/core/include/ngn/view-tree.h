// The core's copy of the mounted view tree: which view is where, for every surface.
//
// The mounting manager keeps it in step with what it asks the backend to mount, on the UI thread,
// so hit testing (and later the Tab-order walk) runs in the core, the same on every toolkit.
#pragma once

#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/mounting/ShadowView.h>

#include <optional>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ngn {

using facebook::react::Point;
using facebook::react::ShadowView;
using facebook::react::SurfaceId;
using facebook::react::Tag;

class ViewTree {
 public:
  struct Node {
    ShadowView view;
    Tag parent{-1};
    std::vector<Tag> children;
  };

  void create(const ShadowView &view);
  void destroy(Tag tag);
  void insert(Tag parent, Tag child, int index);
  void remove(Tag parent, Tag child);
  void update(const ShadowView &view);

  const Node *find(Tag tag) const;
  bool contains(Tag tag) const;

  // Marks `root` as the root of a container of its own (a sheet, a popover, a sidebar pane).
  // A hit test that starts anywhere else skips that subtree, so a click in the window never
  // lands on a popover's nodes.
  void addContainerRoot(Tag root);
  void removeContainerRoot(Tag root);
  bool isContainerRoot(Tag tag) const;

  // The views under `point` (in `root`'s coordinates), from `root` down to the deepest, as React
  // Native iOS's hitTest:withEvent: finds them: later siblings are on top, `pointerEvents` is
  // honoured, hidden views are skipped, and a view clips the hit test to its bounds when it
  // clips its content or nothing of it overflows. Empty when nothing is hit.
  std::vector<Tag> hitTest(Tag root, Point point) const;

  // A screen below the top of its stack: kept mounted, but neither drawn nor hit.
  void setCovered(Tag tag, bool covered);
  bool covered(Tag tag) const;

  // How far a scrolling view has scrolled its content: the content's origin is drawn at minus
  // this. The backend reports it as the user scrolls; the view's state lags behind.
  void setScrollOffset(Tag tag, Point offset);

  // The views from `root` down to `tag`, or nothing when `tag` is not under `root`.
  std::vector<Tag> chain(Tag tag, Tag root) const;

  // Where `tag`'s origin is in `root`'s coordinates, or nothing when `tag` is not under `root`.
  std::optional<Point> originIn(Tag tag, Tag root) const;

 private:
  bool hitTest(Tag tag, Tag root, Point point, std::vector<Tag> &chain) const;
  Point scrollOffset(Tag tag) const;

  std::unordered_map<Tag, Node> nodes_;
  std::unordered_set<Tag> containerRoots_;
  std::unordered_set<Tag> covered_;
  std::unordered_map<Tag, Point> scrollOffsets_;
};

} // namespace ngn
