// The AppKit half of NgNativePrint (printing.mm): HTML laid out by WebKit in a window never shown
// and printed to a PDF in a temp folder, read back with PDFKit; the documents a file prints as;
// and the print panel's operation, built but never run.
#include "../printing.h"

#include <doctest/doctest.h>

#include <unistd.h>

#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

#include <chrono>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>

// A content view as the host's surface view is: flipped, y down.
@interface NGNPrintTestFlippedView : NSView
@end
@implementation NGNPrintTestFlippedView
- (BOOL)isFlipped {
  return YES;
}
@end

namespace {

template <typename Done>
bool runUntil(Done done, double limit) {
  auto end = std::chrono::steady_clock::now() + std::chrono::duration<double>(limit);
  while (!done()) {
    if (std::chrono::steady_clock::now() > end) {
      return false;
    }
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  return true;
}

struct Rendered {
  std::optional<int> pages;
  std::string error;
  PDFDocument *pdf{nil};
};

Rendered render(const std::string &html, ngn::PageSetup page) {
  auto folder = std::filesystem::temp_directory_path() / ("ngn-print-test-" + std::to_string(getpid()) + "-" + std::to_string(rand()));
  std::filesystem::create_directories(folder);
  auto path = (folder / "out.pdf").string();
  // Shared with the callback, which can still answer after a timed-out wait leaves.
  struct Answer {
    bool answered = false;
    Rendered rendered;
  };
  auto answer = std::make_shared<Answer>();
  ngn::appkit::renderHtmlPdf(html, page, path, [answer](int pages, const std::string &error) {
    answer->answered = true;
    answer->rendered.pages = pages;
    answer->rendered.error = error;
  });
  REQUIRE(runUntil([answer] { return answer->answered; }, 20));
  Rendered rendered = answer->rendered;
  rendered.pdf = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:@(path.c_str())]];
  std::filesystem::remove_all(folder);
  return rendered;
}

std::string pngBytes() {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr pixelsWide:40 pixelsHigh:20 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return std::string(static_cast<const char *>(png.bytes), png.length);
}

// What `content` prints as, with `meanwhile` run before the web views' snapshots answer.
PDFDocument *captured(NSView *content, const std::function<void()> &meanwhile = {}) {
  // Shared with the callback, which can still answer after a timed-out wait leaves.
  struct Answer {
    bool answered = false;
    PDFDocument *pdf = nil;
  };
  auto answer = std::make_shared<Answer>();
  ngn::appkit::windowDocument(content, [answer](PDFDocument *document) {
    answer->answered = true;
    answer->pdf = document;
  });
  if (meanwhile) {
    meanwhile();
  }
  REQUIRE(runUntil([answer] { return answer->answered; }, 10));
  return answer->pdf;
}

// The colour at a fraction of the way across and up a one-page document's page, in sRGB.
NSColor *colorAt(PDFDocument *pdf, double x, double y) {
  NSImage *drawn = [[NSImage alloc] initWithData:[[pdf pageAtIndex:0] dataRepresentation]];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:[drawn CGImageForProposedRect:nil context:nil hints:nil]];
  return [[rep colorAtX:static_cast<NSInteger>(rep.pixelsWide * x) y:static_cast<NSInteger>(rep.pixelsHigh * (1 - y))]
      colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
}

} // namespace

TEST_CASE("renderHtmlPdf lays HTML out on pages of the size asked, breaking where the CSS asks, into a PDF file") {
  auto rendered = render(
      "<html><body><h1>Invoice 1042</h1><div style='break-after: page'>First</div><p>Second</p>"
      "<div style='break-before: page'>Third</div></body></html>",
      {.width = 595, .height = 842, .left = 36, .top = 36, .right = 36, .bottom = 36});
  CHECK(rendered.error.empty());
  REQUIRE((rendered.pdf != nil));
  CHECK(rendered.pages == 3);
  CHECK(rendered.pdf.pageCount == 3);
  NSRect box = [[rendered.pdf pageAtIndex:0] boundsForBox:kPDFDisplayBoxMediaBox];
  CHECK(box.size.width == doctest::Approx(595));
  CHECK(box.size.height == doctest::Approx(842));
  CHECK([[rendered.pdf pageAtIndex:0].string containsString:@"Invoice 1042"]);
  CHECK([[rendered.pdf pageAtIndex:2].string containsString:@"Third"]);
}

TEST_CASE("renderHtmlPdf writes one page for short HTML, at US Letter landscape when asked") {
  auto rendered = render("<p>Hello</p>", {.width = 792, .height = 612});
  REQUIRE((rendered.pdf != nil));
  CHECK(rendered.pages == 1);
  NSRect box = [[rendered.pdf pageAtIndex:0] boundsForBox:kPDFDisplayBoxMediaBox];
  CHECK(box.size.width == doctest::Approx(792));
  CHECK(box.size.height == doctest::Approx(612));
}

TEST_CASE("printableDocument prints a PDF's pages, an image on a page of its own, and nothing else") {
  auto html = render("<p>A</p><p style='break-before: page'>B</p>", {});
  REQUIRE((html.pdf != nil));
  NSData *data = html.pdf.dataRepresentation;
  using Kind = ngn::PrintSystem::Document::Kind;
  PDFDocument *pdf = ngn::appkit::printableDocument({.kind = Kind::Pdf, .content = std::string(static_cast<const char *>(data.bytes), data.length)});
  REQUIRE((pdf != nil));
  CHECK(pdf.pageCount == 2);

  PDFDocument *image = ngn::appkit::printableDocument({.kind = Kind::Image, .content = pngBytes()});
  REQUIRE((image != nil));
  CHECK(image.pageCount == 1);

  CHECK((ngn::appkit::printableDocument({.kind = Kind::Image, .content = "not an image"}) == nil));
  CHECK((ngn::appkit::printableDocument({.kind = Kind::Pdf, .content = "%PDF-broken"}) == nil));
}

TEST_CASE("printOperation shows the panel, in the orientation asked, without running") {
  PDFDocument *image = ngn::appkit::printableDocument({.kind = ngn::PrintSystem::Document::Kind::Image, .content = pngBytes()});
  REQUIRE((image != nil));
  NSPrintOperation *portrait = ngn::appkit::printOperation(image, false);
  REQUIRE((portrait != nil));
  CHECK(portrait.showsPrintPanel);
  CHECK(portrait.printInfo.orientation == NSPaperOrientationPortrait);
  CHECK(ngn::appkit::printOperation(image, true).printInfo.orientation == NSPaperOrientationLandscape);
}

TEST_CASE("a window prints as what its content view draws, on one page of its size") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSView *content = window.contentView;
  content.wantsLayer = YES;
  // A layer's colour, which only a render of the layers draws.
  NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 150, 200)];
  box.wantsLayer = YES;
  box.layer.backgroundColor = NSColor.redColor.CGColor;
  [content addSubview:box];

  PDFDocument *pdf = captured(content);
  REQUIRE((pdf != nil));
  CHECK(pdf.pageCount == 1);
  NSRect page = [[pdf pageAtIndex:0] boundsForBox:kPDFDisplayBoxMediaBox];
  CHECK(NSWidth(page) == doctest::Approx(300));
  CHECK(NSHeight(page) == doctest::Approx(200));
  // The page carries the window's pixels: the layer's red on the left half, and on the right the
  // window's own content view, which draws nothing.
  NSColor *left = colorAt(pdf, 0.25, 0.5);
  NSColor *right = colorAt(pdf, 0.75, 0.5);
  CHECK(left.redComponent > 0.9);
  CHECK(left.greenComponent < 0.4);
  CHECK(right.redComponent < 0.5);

  CHECK((captured(nil) == nil));
  // The operation the panel would run: shown, scaled to the paper, and never run here.
  NSPrintOperation *operation = ngn::appkit::printOperation(pdf, true);
  CHECK(operation.showsPrintPanel);
  CHECK(operation.printInfo.orientation == NSPaperOrientationLandscape);
  [window close];
}

TEST_CASE("a window prints a web view's page, which WebKit draws out of process, where the web view is") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSView *content = window.contentView;
  content.wantsLayer = YES;
  // A web view in the bottom right quarter, inside a plain view, its page blue.
  NSView *holder = [[NSView alloc] initWithFrame:NSMakeRect(150, 0, 150, 100)];
  [content addSubview:holder];
  WKWebView *web = [[WKWebView alloc] initWithFrame:holder.bounds configuration:[WKWebViewConfiguration new]];
  [holder addSubview:web];
  [web loadHTMLString:@"<html><body style='margin:0;background:rgb(0,0,255)'></body></html>" baseURL:nil];
  REQUIRE(runUntil([&] { return !web.isLoading && web.estimatedProgress >= 1; }, 20));
  PDFDocument *pdf = captured(content);
  REQUIRE((pdf != nil));
  NSColor *page = colorAt(pdf, 0.75, 0.25);
  CHECK(page.blueComponent > 0.9);
  CHECK(page.redComponent < 0.2);
  CHECK(page.greenComponent < 0.2);
  // Nowhere else.
  CHECK(colorAt(pdf, 0.25, 0.25).blueComponent < 0.5);
  CHECK(colorAt(pdf, 0.75, 0.75).blueComponent < 0.5);
  [window close];
}

TEST_CASE("a web view prints where it is in a flipped content view, as the host's surface is") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSView *content = [[NGNPrintTestFlippedView alloc] initWithFrame:NSMakeRect(0, 0, 300, 200)];
  content.wantsLayer = YES;
  window.contentView = content;
  // Top right, y down.
  WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(150, 0, 150, 100) configuration:[WKWebViewConfiguration new]];
  [content addSubview:web];
  [web loadHTMLString:@"<html><body style='margin:0;background:rgb(0,0,255)'></body></html>" baseURL:nil];
  REQUIRE(runUntil([&] { return !web.isLoading && web.estimatedProgress >= 1; }, 20));
  PDFDocument *pdf = captured(content);
  REQUIRE((pdf != nil));
  CHECK(colorAt(pdf, 0.75, 0.75).blueComponent > 0.9);
  CHECK(colorAt(pdf, 0.75, 0.75).redComponent < 0.2);
  CHECK(colorAt(pdf, 0.75, 0.25).blueComponent < 0.5);
  [window close];
}

TEST_CASE("a view over a web view covers its page in print, as it does on screen") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSView *content = window.contentView;
  content.wantsLayer = YES;
  // The web view fills the window; a red box over its left half.
  WKWebView *web = [[WKWebView alloc] initWithFrame:content.bounds configuration:[WKWebViewConfiguration new]];
  [content addSubview:web];
  NSView *cover = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 150, 200)];
  cover.wantsLayer = YES;
  cover.layer.backgroundColor = NSColor.redColor.CGColor;
  [content addSubview:cover positioned:NSWindowAbove relativeTo:web];
  [web loadHTMLString:@"<html><body style='margin:0;background:rgb(0,0,255)'></body></html>" baseURL:nil];
  REQUIRE(runUntil([&] { return !web.isLoading && web.estimatedProgress >= 1; }, 20));
  PDFDocument *pdf = captured(content);
  REQUIRE((pdf != nil));
  NSColor *covered = colorAt(pdf, 0.25, 0.5);
  CHECK(covered.redComponent > 0.9);
  CHECK(covered.blueComponent < 0.4);
  CHECK(colorAt(pdf, 0.75, 0.5).blueComponent > 0.9);
  // The stand-in for the page is gone again.
  CHECK(content.subviews.count == 2);
  [window close];
}

TEST_CASE("a layout that changes while a web view's snapshot is taken prints as it is once taken") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSView *content = window.contentView;
  content.wantsLayer = YES;
  // A red box top left, a web view bottom right.
  NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 100, 150, 100)];
  box.wantsLayer = YES;
  box.layer.backgroundColor = NSColor.redColor.CGColor;
  [content addSubview:box];
  WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(150, 0, 150, 100) configuration:[WKWebViewConfiguration new]];
  [content addSubview:web];
  [web loadHTMLString:@"<html><body style='margin:0;background:rgb(0,0,255)'></body></html>" baseURL:nil];
  REQUIRE(runUntil([&] { return !web.isLoading && web.estimatedProgress >= 1; }, 20));
  // Before the snapshot answers: the box moves top right and the web view bottom left.
  PDFDocument *pdf = captured(content, [&] {
    box.frame = NSMakeRect(150, 100, 150, 100);
    web.frame = NSMakeRect(0, 0, 150, 100);
  });
  REQUIRE((pdf != nil));
  CHECK(colorAt(pdf, 0.75, 0.75).redComponent > 0.9);
  CHECK(colorAt(pdf, 0.25, 0.75).redComponent < 0.5);
  CHECK(colorAt(pdf, 0.25, 0.25).blueComponent > 0.9);
  CHECK(colorAt(pdf, 0.75, 0.25).blueComponent < 0.5);
  [window close];
}

TEST_CASE("a web view hidden while its snapshot is taken prints as hidden") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSView *content = window.contentView;
  content.wantsLayer = YES;
  // A red box under a web view that fills the window.
  NSView *box = [[NSView alloc] initWithFrame:content.bounds];
  box.wantsLayer = YES;
  box.layer.backgroundColor = NSColor.redColor.CGColor;
  [content addSubview:box];
  WKWebView *web = [[WKWebView alloc] initWithFrame:content.bounds configuration:[WKWebViewConfiguration new]];
  [content addSubview:web];
  [web loadHTMLString:@"<html><body style='margin:0;background:rgb(0,0,255)'></body></html>" baseURL:nil];
  REQUIRE(runUntil([&] { return !web.isLoading && web.estimatedProgress >= 1; }, 20));
  PDFDocument *pdf = captured(content, [&] { web.hidden = YES; });
  REQUIRE((pdf != nil));
  NSColor *seen = colorAt(pdf, 0.5, 0.5);
  CHECK(seen.redComponent > 0.9);
  CHECK(seen.blueComponent < 0.4);
  CHECK(content.subviews.count == 2);
  [window close];
}
