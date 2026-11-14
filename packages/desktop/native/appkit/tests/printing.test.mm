// The AppKit half of NgNativePrint (printing.mm): HTML laid out by WebKit in a window never shown
// and printed to a PDF in a temp folder, read back with PDFKit; the documents a file prints as;
// and the print panel's operation, built but never run.
#include "../printing.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

#include <chrono>
#include <filesystem>
#include <optional>

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
  auto folder = std::filesystem::temp_directory_path() / ("ngn-print-test-" + std::to_string(rand()));
  std::filesystem::create_directories(folder);
  auto path = (folder / "out.pdf").string();
  Rendered rendered;
  bool answered = false;
  ngn::appkit::renderHtmlPdf(html, page, path, [&](int pages, const std::string &error) {
    answered = true;
    rendered.pages = pages;
    rendered.error = error;
  });
  REQUIRE(runUntil([&] { return answered; }, 20));
  rendered.pdf = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:@(path.c_str())]];
  std::filesystem::remove_all(folder);
  return rendered;
}

std::string pngBytes() {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr pixelsWide:40 pixelsHigh:20 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return std::string(static_cast<const char *>(png.bytes), png.length);
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
