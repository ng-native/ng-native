#include "fake-system.h"
#include "ngn/desktop-modules.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <string>
#include <vector>

namespace {

ngn::DesktopModuleSources sources() {
  return {
      .system = std::make_shared<ngn::testing::FakeSystem>(),
      .state = std::make_shared<ngn::HostState>(),
      .notifications = [](std::shared_ptr<ngn::NotificationEvents>) { return std::shared_ptr<ngn::NotificationCenter>(); },
  };
}

} // namespace

TEST_CASE("addDesktopModules registers each desktop module under the name @ng-native's JavaScript asks for") {
  ngn::ModuleRegistry registry;
  ngn::addDesktopModules(registry, sources());
  std::vector<std::string> expected{
      "NgNativeAddressSearch",
      "NgNativeAppleAuthentication",
      "NgNativeApplication",
      "NgNativeAsset",
      "NgNativeAudio",
      "NgNativeBattery",
      "NgNativeCalendar",
      "NgNativeCamera",
      "NgNativeClipboard",
      "NgNativeCrypto",
      "NgNativeDevice",
      "NgNativeDocumentPicker",
      "NgNativeDock",
      "NgNativeFileSystem",
      "NgNativeFont",
      "NgNativeHaptics",
      "NgNativeImageManipulator",
      "NgNativeImagePicker",
      "NgNativeKeepAwake",
      "NgNativeLocalAuthentication",
      "NgNativeLocalLlm",
      "NgNativeLocalization",
      "NgNativeLocation",
      "NgNativeMaps",
      "NgNativeMediaLibrary",
      "NgNativeMenus",
      "NgNativeNetwork",
      "NgNativeNotifications",
      "NgNativePrint",
      "NgNativeProcesses",
      "NgNativeScreenCapture",
      "NgNativeSecureStore",
      "NgNativeSharing",
      "NgNativeShell",
      "NgNativeSplashScreen",
      "NgNativeSqlite",
      "NgNativeStoreReview",
      "NgNativeSymbol",
      "NgNativeTextRecognition",
      "NgNativeTrackingTransparency",
      "NgNativeTray",
      "NgNativeUndo",
      "NgNativeUpdates",
      "NgNativeVideo",
      "NgNativeWebBrowser",
      "NgNativeWindows",
      "RNCWebViewModule",
  };
  std::sort(expected.begin(), expected.end());
  CHECK(registry.names() == expected);
}

TEST_CASE("addDesktopModules makes the notification centre and push tokens over one set of events, and gives them back") {
  auto given = sources();
  std::shared_ptr<ngn::NotificationEvents> heard;
  given.notifications = [&heard](std::shared_ptr<ngn::NotificationEvents> events) -> std::shared_ptr<ngn::NotificationCenter> {
    heard = std::move(events);
    return nullptr;
  };
  ngn::ModuleRegistry registry;
  auto made = ngn::addDesktopModules(registry, given);
  REQUIRE(made.notificationEvents);
  CHECK(heard == made.notificationEvents);
  // A token that rolls is told through the same events.
  REQUIRE(made.push);
  int rolls = 0;
  auto listening = made.notificationEvents->listen([&rolls](const folly::dynamic &) { ++rolls; });
  made.push->registered("a");
  made.push->registered("b");
  CHECK(rolls == 1);
  CHECK(made.launcher);
  CHECK(made.fonts);
  CHECK(made.cameraViews);
  CHECK(made.mapViews);
}
