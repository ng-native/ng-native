// An Image (image-view.mm) keeps its picture through the view's own redraws: every layout asks
// NGNView to draw its box again, which replaces its layer's contents.
#import "../../image-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>
#include <react/renderer/components/image/ImageComponentDescriptor.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;

namespace {

// A 2 by 2 opaque red PNG.
constexpr const char *kRedPixels =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=";

// The picture on the view's layers, or nil.
id drawnImage(NSView *view) {
  if (view.layer.contents != nil && [view.layer.contents isKindOfClass:NSImage.class]) {
    return view.layer.contents;
  }
  for (CALayer *layer in view.layer.sublayers) {
    if ([layer.contents isKindOfClass:NSImage.class]) {
      return layer.contents;
    }
  }
  return nil;
}

} // namespace

TEST_CASE("An image keeps its picture when the view lays out and redraws after it loads") {
  MountedViews mounted;
  auto props = parsedProps<ImageComponentDescriptor>(
      folly::dynamic::object("source", folly::dynamic::array(folly::dynamic::object("uri", kRedPixels))));
  auto image = MountedViews::shadow(5, "Image", props);
  mounted.add(image);
  NSView *view = mounted.view(5);
  REQUIRE((view != nil));
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (drawnImage(view) == nil && deadline.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
  REQUIRE((drawnImage(view) != nil));

  // A layout after the load, and the redraw it asks for.
  auto moved = image;
  moved.layoutMetrics.frame.origin.y = 40;
  mounted.mount({ShadowViewMutation::UpdateMutation(image, moved, MountedViews::kSurface)});
  [view displayIfNeeded];
  CHECK((drawnImage(view) != nil));
}
