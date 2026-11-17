// An svg view that draws a foreignObject's views (svg-view.mm): the views draw after it in the
// same pass, so it draws once more on the next turn of the run loop, and then stops.
#import "../../svg-view.h"

#import <QuartzCore/QuartzCore.h>

#include "helpers.h"

#include <doctest/doctest.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/core/ConcreteState.h>

#include <string>
#include <utility>
#include <vector>

using namespace facebook::react;
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
  child.lengths = {{"width", {.value = 100, .set = true}}, {"height", {.value = 100, .set = true}}};
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
  NGNSvgElementView *object;

  Drawing() {
    [NSApplication sharedApplication];
    window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100)
                                         styleMask:NSWindowStyleMaskBorderless
                                           backing:NSBackingStoreBuffered
                                             defer:NO];
    window.releasedWhenClosed = NO;
    svg = [[NGNCountingSvgView alloc] initWithShadowView:shadowView(2, "RNSVGSvgView", {{0, 0}, {100, 100}})];
    svg.frame = NSMakeRect(0, 0, 100, 100);
    object = [[NGNSvgElementView alloc] initWithShadowView:shadowView(3, "RNSVGForeignObject", {})];
    [svg addSubview:object];
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

namespace {

// A Paragraph's state, as text layout commits it: runs of 20-point text, each in its colour.
State::Shared paragraph(std::vector<std::pair<std::string, SharedColor>> runs) {
  AttributedString text;
  for (auto &[string, color] : runs) {
    AttributedString::Fragment fragment;
    fragment.string = string;
    fragment.textAttributes.fontSize = 20;
    fragment.textAttributes.foregroundColor = color;
    text.appendFragment(std::move(fragment));
  }
  return std::make_shared<const ConcreteState<ParagraphState>>(
      std::make_shared<const ParagraphState>(ParagraphState{.attributedString = text}), ShadowNodeFamily::Weak{});
}

// What the svg's layer shows, as the window draws it: its own contents, not its hidden subviews.
struct Shown {
  std::vector<uint8_t> rgba = std::vector<uint8_t>(100 * 100 * 4, 0);

  explicit Shown(NSView *svg) {
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(rgba.data(), 100, 100, 8, 400, space, kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    CGContextTranslateCTM(context, 0, 100);
    CGContextScaleCTM(context, 1, -1);
    [svg.layer renderInContext:context];
    CGContextRelease(context);
  }

  // The rightmost column with ink, or -1.
  int rightmostInk() const {
    for (int x = 99; x >= 0; --x) {
      for (int y = 0; y < 100; ++y) {
        if (rgba[(y * 100 + x) * 4 + 3] > 128) {
          return x;
        }
      }
    }
    return -1;
  }

  // Pixels mostly of one channel: 0 red, 2 blue.
  int inked(int channel) const {
    int count = 0;
    for (size_t i = 0; i < rgba.size(); i += 4) {
      int c = rgba[i + channel], others = rgba[i] + rgba[i + 1] + rgba[i + 2] - c;
      count += rgba[i + 3] > 128 && c > 150 && others < 120;
    }
    return count;
  }
};

} // namespace

TEST_CASE("a Paragraph in a foreignObject shows its text in the svg when mounted, and its new text after a state update") {
  Drawing d;
  NGNView *text = [[NGNView alloc] initWithShadowView:shadowView(4, "Paragraph", {{0, 0}, {100, 30}})];
  LayoutMetrics metrics;
  metrics.frame = {{0, 0}, {100, 30}};
  [text updateLayout:metrics];
  auto black = colorFromRGBA(0, 0, 0, 255);
  // Mounted under the hidden foreignObject, then the svg drawn, as a mount does.
  [text updateState:paragraph({{"I", black}})];
  [d.object addSubview:text];
  [d.svg setDocument:document(true)];
  passes(d.window);
  int narrow = Shown(d.svg).rightmostInk();
  CHECK(narrow >= 0);

  // Only the text changes: no layout, no props.
  [text updateState:paragraph({{"WWW", black}})];
  [d.svg setDocument:document(true)];
  passes(d.window);
  int wide = Shown(d.svg).rightmostInk();
  CHECK(wide > narrow + 20);

  [text updateState:paragraph({{"I", black}})];
  [d.svg setDocument:document(true)];
  passes(d.window);
  CHECK(Shown(d.svg).rightmostInk() == narrow);

  // Runs in two colours.
  [text updateState:paragraph({{"RR", colorFromRGBA(255, 0, 0, 255)}, {"BB", colorFromRGBA(0, 0, 255, 255)}})];
  [d.svg setDocument:document(true)];
  passes(d.window);
  Shown runs(d.svg);
  CHECK(runs.inked(0) > 10);
  CHECK(runs.inked(2) > 10);
}
