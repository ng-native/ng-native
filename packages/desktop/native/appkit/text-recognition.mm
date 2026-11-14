#include "text-recognition.h"

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

namespace ngn::appkit {

namespace {

std::vector<std::string> stringsOf(NSArray<NSString *> *values) {
  std::vector<std::string> out;
  for (NSString *value in values) {
    out.emplace_back(value.UTF8String);
  }
  return out;
}

class VisionTextReader final : public TextReader {
 public:
  std::vector<std::string> languages(bool fast) override {
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = fast ? VNRequestTextRecognitionLevelFast : VNRequestTextRecognitionLevelAccurate;
    return stringsOf([request supportedRecognitionLanguagesAndReturnError:nil]);
  }

  void read(
      const std::string &path,
      const std::vector<std::string> &languages,
      bool fast,
      std::function<void(std::optional<Reading>, std::string)> done) override {
    NSString *file = [NSString stringWithUTF8String:path.c_str()];
    NSMutableArray<NSString *> *codes = [NSMutableArray array];
    for (const auto &language : languages) {
      [codes addObject:[NSString stringWithUTF8String:language.c_str()]];
    }
    auto answer = std::make_shared<std::function<void(std::optional<Reading>, std::string)>>(std::move(done));
    dispatch_async(queue_, ^{
      CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:file], nullptr);
      CGImageRef image = source != nullptr ? CGImageSourceCreateImageAtIndex(source, 0, nullptr) : nullptr;
      if (image == nullptr) {
        if (source != nullptr) {
          CFRelease(source);
        }
        (*answer)(std::nullopt, std::string("No image could be read at ") + file.UTF8String);
        return;
      }
      NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr));
      CFRelease(source);
      uint32_t raw = [properties[(__bridge NSString *)kCGImagePropertyOrientation] unsignedIntValue];
      auto orientation = static_cast<CGImagePropertyOrientation>(raw >= 1 && raw <= 8 ? raw : 1);
      bool quarterTurn = orientation >= kCGImagePropertyOrientationLeftMirrored;
      Reading reading{
          .width = static_cast<double>(quarterTurn ? CGImageGetHeight(image) : CGImageGetWidth(image)),
          .height = static_cast<double>(quarterTurn ? CGImageGetWidth(image) : CGImageGetHeight(image)),
      };
      VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
      request.recognitionLevel = fast ? VNRequestTextRecognitionLevelFast : VNRequestTextRecognitionLevelAccurate;
      if (codes.count > 0) {
        request.recognitionLanguages = codes;
      } else if (@available(macOS 13.0, *)) {
        request.automaticallyDetectsLanguage = YES;
      }
      NSError *error = nil;
      VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image orientation:orientation options:@{}];
      BOOL performed = [handler performRequests:@[ request ] error:&error];
      CGImageRelease(image);
      if (!performed) {
        (*answer)(std::nullopt, error.localizedDescription.UTF8String);
        return;
      }
      for (VNRecognizedTextObservation *observation in request.results) {
        VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
        if (candidate == nil) {
          continue;
        }
        CGRect box = observation.boundingBox;
        reading.lines.push_back({
            .text = candidate.string.UTF8String,
            .confidence = candidate.confidence,
            .x = box.origin.x,
            .y = box.origin.y,
            .width = box.size.width,
            .height = box.size.height,
        });
      }
      (*answer)(std::move(reading), "");
    });
  }

 private:
  // Off the JavaScript thread: decoding and reading an image takes a while.
  dispatch_queue_t queue_ = dispatch_queue_create("ng-native.text-recognition", DISPATCH_QUEUE_SERIAL);
};

} // namespace

std::shared_ptr<TextReader> makeTextReader() {
  return std::make_shared<VisionTextReader>();
}

} // namespace ngn::appkit
