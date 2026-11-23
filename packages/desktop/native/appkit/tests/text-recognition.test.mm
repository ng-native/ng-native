// VisionTextReader (text-recognition.mm) reading text drawn into a PNG, offscreen.
#include "../text-recognition.h"

#include <doctest/doctest.h>

#include <memory>
#include <mutex>

#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <filesystem>
#include <optional>
#include <string>
#include <unistd.h>

namespace {

// Black text on white, 600 by 200 pixels, its baseline 60 pixels from the bottom, written to a PNG
// whose path it answers, or nothing when the PNG could not be written (a full disk).
std::optional<std::string> drawText(NSString *text) {
  // Named for this process: a suite run beside this one (another checkout's, on the same Mac) draws
  // and removes its own file, and a shared name made each read the other's, or none.
  auto path = (std::filesystem::temp_directory_path() / ("ngn-text-recognition-" + std::to_string(getpid()) + ".png")).string();
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
  // Encoded in memory and written whole: ImageIO writing to a file on a full disk says it finished
  // and leaves the PNG cut short, which Vision then reads no text in.
  NSMutableData *png = [NSMutableData data];
  CGImageDestinationRef destination =
      CGImageDestinationCreateWithData((__bridge CFMutableDataRef)png, (__bridge CFStringRef)UTTypePNG.identifier, 1, nullptr);
  CGImageDestinationAddImage(destination, image, nullptr);
  bool encoded = CGImageDestinationFinalize(destination);
  CFRelease(destination);
  CGImageRelease(image);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  REQUIRE(encoded);
  if (![png writeToFile:[NSString stringWithUTF8String:path.c_str()] options:NSDataWritingAtomic error:nil]) {
    return std::nullopt;
  }
  return path;
}

struct Result {
  std::optional<ngn::TextReader::Reading> reading;
  std::string error;
};

// The callback owns what it writes, so one that comes after the timeout writes nothing freed.
Result readNow(ngn::TextReader &reader, const std::string &path, bool fast = false) {
  struct Shared {
    std::mutex lock;
    Result result;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
  };
  auto shared = std::make_shared<Shared>();
  reader.read(path, {}, fast, [shared](std::optional<ngn::TextReader::Reading> reading, std::string error) {
    {
      std::lock_guard<std::mutex> hold(shared->lock);
      shared->result.reading = std::move(reading);
      shared->result.error = std::move(error);
    }
    dispatch_semaphore_signal(shared->done);
  });
  if (dispatch_semaphore_wait(shared->done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC)) != 0) {
    return {std::nullopt, "no answer in 30 s"};
  }
  std::lock_guard<std::mutex> hold(shared->lock);
  return shared->result;
}

} // namespace

TEST_CASE("VisionTextReader reads text drawn into an image, with its box") {
  auto reader = ngn::appkit::makeTextReader();
  auto path = drawText(@"Hello Vision");
  if (!path) {
    MESSAGE("the test image could not be written to " << std::filesystem::temp_directory_path() << " (a full disk?); skipped");
    return;
  }
  auto result = readNow(*reader, *path);
  std::filesystem::remove(*path);
  INFO("the reader answered: " << result.error);
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
