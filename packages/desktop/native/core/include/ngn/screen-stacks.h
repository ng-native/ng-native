// react-native-screens' native stack, the same on every toolkit: every screen of an
// RNSScreenStack stays mounted, the top one (its last screen) is shown, and those below it are
// covered: not drawn and not hit, with their views and state kept for when they return.
//
// A screen that comes to the top hears willAppear then appear, which is what the router sets
// SCREEN_SHOWN from, and the screen it covers hears willDisappear then disappear. Push and pop swap
// at once, so each pair is sent together, in UIKit's order. A popped screen is already gone and
// hears nothing, as on iOS when JavaScript pops.
#pragma once

#include "ngn/view-tree.h"

#include <optional>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ngn {

class ScreenStacks {
 public:
  virtual ~ScreenStacks() = default;

  // A view's children changed. Settled with the transaction, so a push that inserts and removes
  // in one commit is one change.
  void childrenChanged(const ViewTree &tree, Tag parent);
  // A screen's props changed: its presentation may have (screen-presentation.h).
  void propsChanged(const ViewTree &tree, Tag tag);
  void deleted(Tag tag);

  struct Covered {
    Tag tag;
    bool covered;
  };
  // Settles every stack whose screens changed since the last call: marks the screens covered or
  // not in `tree`, sends the events, and returns the screens whose covered state changed, for the
  // backend to hide or show.
  //
  // A presented screen (screen-presentation.h) does not cover the screens under it: those below
  // the last pushed screen are covered, and the presented ones over it are each presented.
  std::vector<Covered> settle(ViewTree &tree);

  // The screens that came to be presented (covered = true) or stopped being presented since the
  // last call, as settle found them.
  std::vector<Covered> takePresented();

  // The top screen of a stack, or -1.
  Tag top(Tag stack) const;

  // The header a container shows: the RNSScreenStackHeaderConfig of the last pushed screen of the
  // innermost stack (a presented screen draws its own) in the container that has one (a window has one toolbar, and the screen in
  // front fills it). Stacks under a covered screen or in a container of their own do not count,
  // but for the content pane of a split view or a tabs host, which is the window's content.
  struct FrontHeader {
    Tag config{-1};
    Tag screen{-1};
    // Whether the screen has one below it to go back to.
    bool canGoBack{false};
    bool operator==(const FrontHeader &) const = default;
  };
  std::optional<FrontHeader> frontHeader(const ViewTree &tree, Tag root) const;

 protected:
  // Where events leave the core: through the view's event emitter by default, recorded in tests.
  virtual void emit(const ViewTree::Node &node, const char *event);

 private:
  std::unordered_set<Tag> dirty_;
  std::unordered_map<Tag, Tag> tops_;
  std::unordered_set<Tag> presented_;
  std::vector<Covered> presentedChanges_;
};

} // namespace ngn
