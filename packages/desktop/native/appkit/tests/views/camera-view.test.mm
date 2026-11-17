// `<expo-camera>`'s view (camera-view.mm) passing its `mute` prop on to NgNativeCamera through the
// camera views, as it mounts, as the prop changes and as it goes. Over a camera that is not
// allowed, so no session starts and nothing prompts.
#import "../../camera-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;

namespace {

struct RefusedCamera final : ngn::CameraHardware {
  Access access() override {
    return Access::Denied;
  }
  void requestAccess(std::function<void(Access)> done) override {
    done(Access::Denied);
  }
  bool hasCamera() override {
    return true;
  }
  bool microphoneAllowed() override {
    return true;
  }
};

Props::Shared cameraProps(folly::dynamic raw) {
  return parsedProps<ngn::CameraComponentDescriptor>(std::move(raw));
}

} // namespace

TEST_CASE("The camera view passes its mute on as it mounts, as it changes, and forgets it as it goes") {
  auto views = std::make_shared<ngn::CameraViews>();
  [NGNCameraView useHardware:std::make_shared<RefusedCamera>() views:views noPrompts:true];
  try {
    MountedViews mounted;
    auto camera = MountedViews::shadow(5, ngn::CameraComponentName, cameraProps(folly::dynamic::object("mute", true)));
    mounted.add(camera);
    REQUIRE([mounted.view(5) isKindOfClass:NGNCameraView.class]);
    CHECK(views->muted(5));

    mounted.update(camera, cameraProps(folly::dynamic::object("mute", false)));
    CHECK_FALSE(views->muted(5));
    mounted.update(camera, cameraProps(folly::dynamic::object("mute", true)));
    CHECK(views->muted(5));
    // Removed from the props altogether, as a binding set to null does.
    mounted.update(camera, cameraProps(folly::dynamic::object()));
    CHECK_FALSE(views->muted(5));
    mounted.update(camera, cameraProps(folly::dynamic::object("mute", true)));
    CHECK(views->muted(5));

    // A view stopped by `active` keeps its mute for when it starts again.
    mounted.update(camera, cameraProps(folly::dynamic::object("mute", true)("active", false)));
    mounted.update(camera, cameraProps(folly::dynamic::object("mute", true)("active", true)));
    CHECK(views->muted(5));

    auto current = mounted.mounting->tree().find(5)->view;
    mounted.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, current, 0), ShadowViewMutation::DeleteMutation(current)});
    @autoreleasepool {
      [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    bool gone = mounted.view(5) == nil;
    CHECK(gone);
    CHECK_FALSE(views->muted(5));
  } catch (...) {
    [NGNCameraView useHardware:nullptr views:nullptr noPrompts:false];
    throw;
  }
  [NGNCameraView useHardware:nullptr views:nullptr noPrompts:false];
}
