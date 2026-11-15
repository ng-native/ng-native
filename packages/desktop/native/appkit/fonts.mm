#include "fonts.h"

#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>

#include <stdexcept>

namespace ngn::appkit {

namespace {

std::string stringOf(CFStringRef value) {
  return value != nullptr ? std::string([(__bridge NSString *)value UTF8String]) : "";
}

class CoreTextRegistrar final : public FontRegistrar {
 public:
  RegisteredFont registerFile(const std::string &path) override {
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
    NSArray *descriptors = CFBridgingRelease(CTFontManagerCreateFontDescriptorsFromURL((__bridge CFURLRef)url));
    if (descriptors.count == 0) {
      throw std::runtime_error([NSFileManager.defaultManager fileExistsAtPath:url.path] ? "the file is not a font CoreText reads"
                                                                                         : "there is no such file");
    }
    auto descriptor = (__bridge CTFontDescriptorRef)descriptors.firstObject;
    RegisteredFont font{
        .family = stringOf((__bridge CFStringRef)CFBridgingRelease(CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute))),
        .postScriptName = stringOf((__bridge CFStringRef)CFBridgingRelease(CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute))),
    };
    CFErrorRef error = nullptr;
    if (!CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url, kCTFontManagerScopeProcess, &error)) {
      NSError *failure = CFBridgingRelease(error);
      // Registered before, by this process or the system: it is there to use either way.
      if (failure.code != kCTFontManagerErrorAlreadyRegistered && failure.code != kCTFontManagerErrorDuplicatedName) {
        throw std::runtime_error(failure.localizedDescription.UTF8String);
      }
    }
    return font;
  }
};

} // namespace

std::shared_ptr<FontRegistrar> makeFontRegistrar() {
  return std::make_shared<CoreTextRegistrar>();
}

} // namespace ngn::appkit
