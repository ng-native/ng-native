// Safe-area insets, the same on every toolkit: each container (the window's content, a cover, a
// sidebar pane) reports its size and the insets its OS gives it (on macOS, the content view's
// safeAreaInsets: the title bar plus the toolbar when the content runs under them), and every
// safe-area view in it gets the part of those insets it overlaps, as a UIView's safeAreaInsets
// does on iOS.
//
// RNCSafeAreaProvider hears insetsChange with its insets and its frame in the container.
// RNCSafeAreaView and react-native-screens' RNSSafeAreaView get theirs through their state, which
// their shadow nodes turn into padding. Each is told only when its insets change.
#pragma once

#include "ngn/view-tree.h"

#include <react/renderer/graphics/RectangleEdges.h>

#include <optional>
#include <unordered_map>

namespace ngn {

using facebook::react::EdgeInsets;
using facebook::react::Rect;
using facebook::react::Size;

struct ContainerInsets {
  Size size;
  EdgeInsets insets;
  // How far the window controls reach into this container from its leading edge, for
  // --safe-area-inset-titlebar-leading: their extent in a window's content with no sidebar and in
  // the sidebar pane under them, and 0 in the content pane beside a sidebar, which they do not
  // reach.
  double titlebarLeading{0};
  // How far window controls reach in from the trailing edge, for
  // --safe-area-inset-titlebar-trailing: 0 on macOS, whose controls are on the leading side, and
  // on the GTK host while its content stays below the header bar.
  double titlebarTrailing{0};
  bool operator==(const ContainerInsets &) const = default;
};

// The part of a container's insets a view at `frame` (in the container's coordinates) overlaps.
EdgeInsets insetsWithin(const ContainerInsets &container, const Rect &frame);

// How far window controls spanning `minX` to `maxX` (in a container `width` wide) reach in from
// its leading edge: the left one, or the right one right to left, where AppKit puts the controls
// on the right. 0 when they lie outside it.
double titlebarLeading(double minX, double maxX, double width, bool rightToLeft);

class SafeAreas {
 public:
  virtual ~SafeAreas() = default;

  void created(const ShadowView &view);
  void deleted(Tag tag);
  // A container's metrics, keyed by the tag its hit test starts from (the surface's root for the
  // window's content).
  void setContainer(Tag root, const ContainerInsets &metrics);
  void removeContainer(Tag root);

  // Brings every safe-area view up to date with the tree and the containers. True when it told
  // any of them something new.
  bool settle(const ViewTree &tree);

 protected:
  // Where the insets leave the core: the provider's event, and the views' state through the
  // library's glue. Tests record them instead.
  virtual void emitInsetsChange(
      const ViewTree::Node &provider,
      EdgeInsets insets,
      Rect frame,
      double titlebarLeading,
      double titlebarTrailing);
  virtual void setStateInsets(const ViewTree::Node &view, EdgeInsets insets);
  // The margin a view's mounted state adds for its insets, for a view that moves itself by them
  // (library-glue.h); nothing for one that pads its content instead.
  virtual std::optional<EdgeInsets> appliedMargin(const ViewTree::Node &view) const;

 private:
  enum class Kind { Provider, View };
  struct Tracked {
    Kind kind;
    bool known{false};
    EdgeInsets insets;
    Rect frame;
    // A provider's: the last titlebarLeading and titlebarTrailing its event said.
    double titlebarLeading{0};
    double titlebarTrailing{0};
  };
  std::unordered_map<Tag, Tracked> tracked_;
  std::unordered_map<Tag, ContainerInsets> containers_;
};

} // namespace ngn
