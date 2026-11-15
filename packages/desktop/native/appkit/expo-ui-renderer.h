// `@expo/ui` drawn in SwiftUI (expo-ui.swift): a HostView's tree (the core's expo-ui.h) as the
// SwiftUI views it names, in one NSView, with the content's fitting size for Yoga and each view's
// events. No Fabric view here: the HostView's NGNView (expo-ui-view.mm) holds a renderer and sends
// its events through the views' event emitters.
#pragma once

#include "ngn/expo-ui.h"

#import <AppKit/AppKit.h>

#include <folly/dynamic.h>

#include <functional>
#include <memory>
#include <string>
#include <unordered_map>

namespace ngn::appkit {

class ExpoUIRenderer {
 public:
  // A view's event: its tag, expo/ui's iOS name for it without `on`, and the payload.
  using Events = std::function<void(facebook::react::Tag, const std::string &, folly::dynamic)>;
  // An RNHostView's NSView, by its tag: the app's own views, which the SwiftUI content holds.
  using Views = std::function<NSView *(facebook::react::Tag)>;

  ExpoUIRenderer(Events events, Views views);
  ~ExpoUIRenderer();
  ExpoUIRenderer(const ExpoUIRenderer &) = delete;
  ExpoUIRenderer &operator=(const ExpoUIRenderer &) = delete;

  // The SwiftUI content's view, which fills the HostView.
  NSView *view() const;

  void setTree(std::shared_ptr<const ExpoUINode> root);
  const std::shared_ptr<const ExpoUINode> &tree() const {
    return root_;
  }

  // The content's size: its own with no width or height given (negative), or the size it takes at
  // the width or height given.
  facebook::react::Size fit(double width, double height) const;

  // Acts on the view `tag` as the user would (expo-ui.swift's ngn_ui_host_perform). False for a tag
  // or an action the view does not take.
  bool perform(facebook::react::Tag tag, const folly::dynamic &action);

  // Whether the renderer draws the iOS view `name`.
  static bool draws(const std::string &name);

  // `node` as the JSON the Swift half reads.
  static folly::dynamic json(const ExpoUINode &node);

  // Called by the Swift half.
  void deliver(facebook::react::Tag tag, const std::string &name, const std::string &payload);
  NSView *viewFor(facebook::react::Tag tag) const;

 private:
  Events events_;
  Views views_;
  void *host_;
  std::shared_ptr<const ExpoUINode> root_;
};

// The event emitter of each view in `root`'s tree, by tag.
std::unordered_map<facebook::react::Tag, facebook::react::SharedEventEmitter> expoUIEmitters(const ExpoUINode &root);

} // namespace ngn::appkit
