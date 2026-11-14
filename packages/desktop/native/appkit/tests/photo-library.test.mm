// PhotoKitLibrary (photo-library.mm) in the test binary, which has no Info.plist and so no usage
// string: it answers the access as macOS has it, asking shows no prompt, and the modules over it
// read and write nothing without access.
#include "../photo-library.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

using Access = ngn::PhotoLibrary::Access;

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
  auto module = ngn::makeMediaLibraryModule(library, false);
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
