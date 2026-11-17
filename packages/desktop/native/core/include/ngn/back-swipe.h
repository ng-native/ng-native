// An interactive back swipe on a native stack, the same on every toolkit: as two fingers move
// towards back (right in a left-to-right layout, left in a right-to-left one, as Safari and Finder
// swipe), the screen in front follows them and the screen below it shows; released past
// the threshold it goes back, released early it slides home. A forward swipe has no page to drag
// in, so it completes and then swaps (navigationFor in app-menus.h).
//
// The core decides which screens move, how far and whether the swipe goes back; the toolkit reads
// the scroll and draws each frame (the top screen's offset or opacity, and the screen below shown
// over its covered state, without touching the tree's).
#pragma once

#include "ngn/view-tree.h"

#include <optional>

namespace ngn {

// How the screen leaving moves: `fade` fades it out in place, any other animation slides it.
// A screen with `stackAnimation: none` has no swipe at all.
enum class SwipeStyle { Slide, Fade };

struct BackSwipeTarget {
  Tag stack{-1};
  // The screen in front, which follows the fingers, and the one below it, which shows.
  Tag top{-1};
  Tag below{-1};
  SwipeStyle style{SwipeStyle::Slide};
  bool operator==(const BackSwipeTarget &) const = default;
};

// What the toolkit draws at one moment of a swipe.
struct BackSwipeFrame {
  // How far the top screen has moved, in points: right in a left-to-right layout, left (negative)
  // in a right-to-left one.
  double offset{0};
  // The top screen's opacity.
  double opacity{1};
  // Whether the screen below is drawn.
  bool belowShown{false};
  bool operator==(const BackSwipeFrame &) const = default;
};

class BackSwipe {
 public:
  enum class Phase {
    Idle,
    // The fingers are down and the top screen follows them.
    Tracking,
    // Released early: sliding home, after which the swipe is over.
    Returning,
    // Released past the threshold: the app was told to go back, and the top screen stays away
    // until the stack's top changes.
    Leaving,
  };

  Phase phase() const {
    return phase_;
  }
  const std::optional<BackSwipeTarget> &target() const {
    return target_;
  }

  // Fingers began a sideways scroll in a window `width` wide whose front stack can go back to
  // `target`, laid out right to left or not. False, and nothing to draw, without a target or while
  // another swipe runs.
  bool begin(std::optional<BackSwipeTarget> target, double width, bool rightToLeft = false);
  // The fingers moved `dx` points towards back (negative away from it). The frame to draw.
  BackSwipeFrame moved(double dx);
  // The fingers lifted. True when the swipe goes back: past a third of the width, or flicked
  // towards back (its last move at least kFlick points) past a tenth. Otherwise, or when the OS
  // cancelled the scroll, it returns.
  bool lifted(bool cancelled = false);
  // Where the swipe settles once lifted: off towards back (or faded out) when leaving, home when
  // returning.
  BackSwipeFrame settled() const;
  // The return animation finished: the swipe is over, and the toolkit draws `rest()`.
  void returned();
  // After a mount, with the target stack's top screen now: true when a leaving swipe is over, the
  // app having gone back (or elsewhere), and the toolkit draws `rest()` on what is left.
  bool mounted(Tag stackTop);
  // The app did not go back in time (a guard refused, say), or the swipe's window closed: the
  // swipe ends where it began.
  void abandon();
  // New fingers began a scroll. A swipe still tracking never heard its fingers lift (its window
  // closed, or the OS never sent the end): it is over, true, and the toolkit draws `rest()`. A
  // swipe already lifted carries on.
  bool fingersDown();

  // The frame with nothing moved: what every screen is drawn as once the swipe is over.
  static BackSwipeFrame rest() {
    return {};
  }

  static constexpr double kFlick = 6;

 private:
  BackSwipeFrame frameAt(double progress, bool belowShown) const;

  Phase phase_{Phase::Idle};
  std::optional<BackSwipeTarget> target_;
  double width_{0};
  bool rightToLeft_{false};
  double offset_{0};
  double lastMove_{0};
};

// How far fingers that moved `right` points to the right went towards back: back is to the right
// in a left-to-right layout and to the left in a right-to-left one.
double towardsBack(double right, bool rightToLeft);

// The range a swipe tracker may move in, as AppKit's trackSwipeEvent takes it: -1 lets the fingers
// go left, 1 right, and 0 shuts that way. Right goes back in a left-to-right layout, and forward in
// a right-to-left one.
struct SwipeBounds {
  double min{0};
  double max{0};
  bool operator==(const SwipeBounds &) const = default;
};
SwipeBounds swipeBounds(bool canGoBack, bool canGoForward, bool rightToLeft = false);

} // namespace ngn
