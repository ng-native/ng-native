// An svg view that draws a foreignObject's views (svg-view.mm): the views draw after it in the
// same pass, so it draws once more on the next turn of the run loop, and then stops.
#import "../../svg-view.h"

#include "helpers.h"

#include <doctest/doctest.h>

using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgNode;
using ngn::testing::shadowView;

@interface NGNCountingSvgView : NGNSvgView
@property (nonatomic) int drawCount;
@end

@implementation NGNCountingSvgView
- (void)drawRect:(NSRect)dirtyRect {
  _drawCount++;
  [super drawRect:dirtyRect];
}
@end

namespace {

std::shared_ptr<const ngn::SvgDocument> document(bool foreign) {
  SvgElement child{.kind = foreign ? SvgKind::ForeignObject : SvgKind::Rect};
  child.view = foreign ? 3 : -1;
  child.lengths = {{"width", {.value = 10, .set = true}}, {"height", {.value = 10, .set = true}}};
  return std::make_shared<const ngn::SvgDocument>(
      ngn::SvgDocument{.root = SvgNode{.element = {.kind = SvgKind::Svg}, .children = {SvgNode{.element = child}}}});
}

// Turns of the run loop, each followed by what the window draws, as the screen's passes are.
void passes(NSWindow *window, int count = 10) {
  for (int i = 0; i < count; ++i) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    [window displayIfNeeded];
  }
}

struct Drawing {
  NSWindow *window;
  NGNCountingSvgView *svg;

  Drawing() {
    [NSApplication sharedApplication];
    window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100)
                                         styleMask:NSWindowStyleMaskBorderless
                                           backing:NSBackingStoreBuffered
                                             defer:NO];
    window.releasedWhenClosed = NO;
    svg = [[NGNCountingSvgView alloc] initWithShadowView:shadowView(2, "RNSVGSvgView", {{0, 0}, {100, 100}})];
    svg.frame = NSMakeRect(0, 0, 100, 100);
    [svg addSubview:[[NGNSvgElementView alloc] initWithShadowView:shadowView(3, "RNSVGForeignObject", {})]];
    window.contentView = svg;
    passes(window);
  }
  ~Drawing() { [window close]; }
};

} // namespace

TEST_CASE("an svg draws again on the next turn after drawing a foreignObject's views, and only once") {
  Drawing d;
  d.svg.drawCount = 0;
  [d.svg setDocument:document(true)];
  passes(d.window);
  CHECK(d.svg.drawCount == 2);

  // Without a foreignObject, one draw is all.
  d.svg.drawCount = 0;
  [d.svg setDocument:document(false)];
  passes(d.window);
  CHECK(d.svg.drawCount == 1);
}

TEST_CASE("a change queued before the draw after a foreignObject's is followed by one more draw") {
  Drawing d;
  [d.svg setDocument:document(true)];
  // A mount queued on the main queue, then the draw, which queues its ask for the draw after behind
  // it: the next turn runs both, and one draw covers them.
  NGNCountingSvgView *svg = d.svg;
  dispatch_async(dispatch_get_main_queue(), ^{
    svg.drawCount = 0;
    [svg setDocument:document(true)];
  });
  [d.svg display];
  passes(d.window);
  CHECK(d.svg.drawCount == 2);
}

TEST_CASE("a change after the draw after a foreignObject's is asked for is followed by one more draw") {
  Drawing d;
  [d.svg setDocument:document(true)];
  [d.svg display];
  // The turn that asks for the draw after, with no draw in it, then a change before the draw.
  [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  [d.svg setDocument:document(true)];
  d.svg.drawCount = 0;
  passes(d.window);
  CHECK(d.svg.drawCount == 2);
}
