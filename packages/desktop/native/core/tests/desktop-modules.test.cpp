#include "fake-system.h"
#include "ngn/desktop-modules.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <string>
#include <vector>

namespace {

struct NoTray final : ngn::TrayBackend {
  void setIcons(std::vector<ngn::TrayIcon>) override {}
};

struct NoDock final : ngn::DockBackend {
  void setMenu(std::optional<std::vector<ngn::MenuItem>>) override {}
  void bounce(int, bool) override {}
  void cancelBounce(int) override {}
};

ngn::DesktopModuleSources sources() {
  return {
      .system = std::make_shared<ngn::testing::FakeSystem>(),
      .state = std::make_shared<ngn::HostState>(),
      .tray = std::make_shared<ngn::TrayHost>(std::make_shared<NoTray>()),
      .dock = std::make_shared<ngn::DockHost>(std::make_shared<NoDock>()),
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

TEST_CASE("addDesktopModules leaves out the tray and the Dock without a source for them") {
  auto given = sources();
  given.tray = nullptr;
  ngn::ModuleRegistry registry;
  ngn::addDesktopModules(registry, given);
  auto names = registry.names();
  CHECK(std::count(names.begin(), names.end(), "NgNativeTray") == 0);
  CHECK(std::count(names.begin(), names.end(), "NgNativeDock") == 1);
  given.dock = nullptr;
  ngn::ModuleRegistry without;
  ngn::addDesktopModules(without, given);
  names = without.names();
  CHECK(std::count(names.begin(), names.end(), "NgNativeDock") == 0);
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
