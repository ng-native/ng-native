// PhotoKitLibrary (photo-library.mm) in the test binary, which has no Info.plist and so no usage
// string: it answers the access as macOS has it, asking shows no prompt, and the modules over it
// read and write nothing without access.
#include "../photo-library.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#import <PhotosUI/PhotosUI.h>

using Access = ngn::PhotoLibrary::Access;

// photo-library.mm's picker delegate, as declared there.
@interface NGNPickerDelegate : NSObject <PHPickerViewControllerDelegate>
@property(nonatomic, copy) NSString *folder;
@property(nonatomic, copy) void (^finished)(NSArray<NSDictionary *> *picked);
@property(nonatomic, strong) NSWindow *sheet;
@end

TEST_CASE("PhotoKitLibrary asks for nothing without a usage string, and answers the access as it is") {
  auto library = ngn::appkit::makePhotoLibrary(NSTemporaryDirectory().UTF8String);
  for (bool writeOnly : {false, true}) {
    auto before = library->access(writeOnly);
    std::optional<Access> answered;
    library->requestAccess(writeOnly, [&](Access access) { answered = access; });
    // Answered at once, on this thread: nothing was shown.
    REQUIRE(answered);
    CHECK(*answered == before);
  }
}

TEST_CASE("The media library and the picker over PhotoKit read and write nothing without access") {
  auto library = ngn::appkit::makePhotoLibrary(NSTemporaryDirectory().UTF8String);
  if (library->access(false) == Access::Granted || library->access(false) == Access::Limited ||
      library->access(true) == Access::Granted) {
    MESSAGE("this test binary has photo library access; the denied path is not checked");
    return;
  }
  auto module = ngn::makeMediaLibraryModule(library, false, nullptr);
  auto run = [&](const std::string &method, folly::dynamic args) {
    std::optional<folly::dynamic> value;
    std::optional<std::string> failure;
    module->callWithPromise(method, args, {.resolve = [&](folly::dynamic v) { value = v; }, .reject = [&](const std::string &m) { failure = m; }});
    REQUIRE((value || failure));
    return std::pair(value, failure);
  };
  CHECK(run("requestPermissionsAsync", folly::dynamic::array(false)).first->at("granted") == folly::dynamic(false));
  CHECK(run("query", folly::dynamic::array(folly::dynamic::object())).first == folly::dynamic::array());
  CHECK(run("albums", folly::dynamic::array()).first == folly::dynamic::array());
  CHECK(run("createAsset", folly::dynamic::array("file:///tmp/none.jpg", nullptr)).second);
  CHECK(module->call("startObserving") == folly::dynamic(false));
  auto picker = ngn::makeImagePickerModule(library, true);
  std::optional<folly::dynamic> picked;
  picker->callWithPromise("launchImageLibraryAsync", folly::dynamic::array(folly::dynamic::object()),
                          {.resolve = [&](folly::dynamic v) { picked = v; }, .reject = {}});
  REQUIRE(picked);
  CHECK((*picked)["canceled"] == folly::dynamic(true));
}

TEST_CASE("The picker's sheet has a picker's size, not its content's fitting size, and fits its window") {
  // The photo picker fits to almost nothing (a title and Cancel); a plain view stands in for it.
  NSViewController *content = [NSViewController new];
  content.view = [[NSView alloc] initWithFrame:NSZeroRect];
  NSWindow *large = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1040, 720) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  NSWindow *sheet = ngn::appkit::pickerSheet(content, large);
  CHECK((sheet.contentViewController == content));
  CHECK(sheet.contentLayoutRect.size.width == 780);
  CHECK(sheet.contentLayoutRect.size.height == 560);
  NSWindow *small = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 500, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  NSViewController *other = [NSViewController new];
  other.view = [[NSView alloc] initWithFrame:NSZeroRect];
  NSSize fitted = ngn::appkit::pickerSheet(other, small).contentLayoutRect.size;
  CHECK(fitted.width == 460);
  CHECK(fitted.height == 340);
}

TEST_CASE("The picker's delegate lets its sheet go when the pick ends, so the session is freed") {
  NGNPickerDelegate *delegate = [NGNPickerDelegate new];
  __block int finished = 0;
  delegate.finished = ^(NSArray<NSDictionary *> *picked) {
    CHECK(bool(picked == nil));
    finished++;
  };
  delegate.sheet = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  // Cancelled: no results.
  PHPickerViewController *picker = nil;
  [delegate picker:picker didFinishPicking:@[]];
  CHECK(finished == 1);
  CHECK(bool(delegate.sheet == nil));
}
