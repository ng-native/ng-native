// VisionTextReader (text-recognition.mm) reading text drawn into a PNG, offscreen.
#include "../text-recognition.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <filesystem>

namespace {

// Black text on white, 600 by 200 pixels, its baseline 60 pixels from the bottom.
std::string drawText(NSString *text) {
  auto path = (std::filesystem::temp_directory_path() / "ngn-text-recognition.png").string();
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(nullptr, 600, 200, 8, 0, space, kCGImageAlphaPremultipliedLast);
  CGContextSetRGBFillColor(context, 1, 1, 1, 1);
  CGContextFillRect(context, CGRectMake(0, 0, 600, 200));
  NSDictionary *attributes = @{
    NSFontAttributeName : [NSFont systemFontOfSize:64],
    NSForegroundColorAttributeName : NSColor.blackColor,
  };
  CTLineRef line = CTLineCreateWithAttributedString(
      (__bridge CFAttributedStringRef)[[NSAttributedString alloc] initWithString:text attributes:attributes]);
  CGContextSetTextPosition(context, 20, 60);
  CTLineDraw(line, context);
  CFRelease(line);
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL(
      (__bridge CFURLRef)[NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]],
      (__bridge CFStringRef)UTTypePNG.identifier, 1, nullptr);
  CGImageDestinationAddImage(destination, image, nullptr);
  CGImageDestinationFinalize(destination);
  CFRelease(destination);
  CGImageRelease(image);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return path;
}

struct Result {
  std::optional<ngn::TextReader::Reading> reading;
  std::string error;
};

Result readNow(ngn::TextReader &reader, const std::string &path, bool fast = false) {
  Result result;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  reader.read(path, {}, fast, [&](std::optional<ngn::TextReader::Reading> reading, std::string error) {
    result.reading = std::move(reading);
    result.error = std::move(error);
    dispatch_semaphore_signal(done);
  });
  dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
  return result;
}

} // namespace

TEST_CASE("VisionTextReader reads text drawn into an image, with its box") {
  auto reader = ngn::appkit::makeTextReader();
  auto path = drawText(@"Hello Vision");
  auto result = readNow(*reader, path);
  std::filesystem::remove(path);
  REQUIRE(result.reading);
  CHECK(result.reading->width == 600);
  CHECK(result.reading->height == 200);
  REQUIRE(result.reading->lines.size() == 1);
  const auto &line = result.reading->lines[0];
  CHECK(line.text == "Hello Vision");
  CHECK(line.confidence > 0.5);
  // From the bottom left: the line starts near x 20 and sits around its 60 pixel baseline.
  CHECK(line.x * 600 == doctest::Approx(20).epsilon(0.5));
  CHECK(line.y * 200 < 70);
  CHECK((line.y + line.height) * 200 > 90);
}

TEST_CASE("VisionTextReader lists the languages it reads, and refuses a file that is not an image") {
  auto reader = ngn::appkit::makeTextReader();
  auto languages = reader->languages(false);
  CHECK(std::find(languages.begin(), languages.end(), "en-US") != languages.end());
  auto result = readNow(*reader, "/nowhere/image.png");
  CHECK_FALSE(result.reading);
  CHECK(result.error == "No image could be read at /nowhere/image.png");
}
