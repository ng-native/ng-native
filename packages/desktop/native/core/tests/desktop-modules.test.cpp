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

TEST_CASE("addDesktopModules registers or names as absent each desktop module, under the name @ng-native's JavaScript asks for") {
  ngn::ModuleRegistry registry;
  auto made = ngn::addDesktopModules(registry, sources());
  auto names = registry.names();
  names.insert(names.end(), made.absent.begin(), made.absent.end());
  std::sort(names.begin(), names.end());
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
      "NgNativeHost",
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
  CHECK(names == expected);
}

TEST_CASE("addDesktopModules leaves out each module the backend gives no source for, and NgNativeHost names it") {
  ngn::ModuleRegistry registry;
  auto made = ngn::addDesktopModules(registry, sources());
  // What the core makes over the host's own objects, the two whose null source is an answer, and the
  // tray and Dock, which sources() gives.
  std::vector<std::string> registered{
      "NgNativeApplication", "NgNativeAsset", "NgNativeClipboard", "NgNativeDevice", "NgNativeDock", "NgNativeHost",
      "NgNativeProcesses", "NgNativeTray", "NgNativeSqlite", "NgNativeStoreReview", "NgNativeWebBrowser", "RNCWebViewModule",
  };
  std::sort(registered.begin(), registered.end());
  CHECK(registry.names() == registered);
  CHECK(std::find(made.absent.begin(), made.absent.end(), "NgNativeMaps") != made.absent.end());
  // The modules Linux crashed in, among the rest.
  for (const char *name : {"NgNativeBattery", "NgNativeAppleAuthentication", "NgNativeHaptics", "NgNativeSplashScreen",
                           "NgNativeCalendar", "NgNativeCamera", "NgNativeImagePicker", "NgNativeMediaLibrary",
                           "NgNativeAudio", "NgNativeVideo", "NgNativeLocalLlm", "NgNativeTrackingTransparency",
                           "NgNativeLocalAuthentication", "NgNativeLocation", "NgNativeNotifications"}) {
    CHECK(std::find(made.absent.begin(), made.absent.end(), name) != made.absent.end());
    CHECK_FALSE(registry.module(name, nullptr));
  }
  auto names = ngn::makeHostModule(made.absent)->call("getConstants")["absentModules"];
  REQUIRE(names.size() == made.absent.size());
  CHECK(names[0] == made.absent[0]);
}

TEST_CASE("addDesktopModules registers a module once its source is given, and no longer names it as absent") {
  auto given = sources();
  given.splash = std::make_shared<ngn::SplashGate>();
  ngn::ModuleRegistry registry;
  auto made = ngn::addDesktopModules(registry, given);
  auto names = registry.names();
  CHECK(std::find(names.begin(), names.end(), "NgNativeSplashScreen") != names.end());
  CHECK(std::find(made.absent.begin(), made.absent.end(), "NgNativeSplashScreen") == made.absent.end());
  CHECK(std::find(made.absent.begin(), made.absent.end(), "NgNativeHaptics") != made.absent.end());
}

TEST_CASE("addDesktopModules registers ImagePicker over a picker with no photo library, and leaves MediaLibrary out") {
  struct Picker final : ngn::PhotoPicker {
    void pick(const folly::dynamic &, std::function<void(std::optional<std::vector<Picked>>)> done) override {
      done(std::nullopt);
    }
  };
  auto given = sources();
  given.photoPicker = std::make_shared<Picker>();
  ngn::ModuleRegistry registry;
  auto made = ngn::addDesktopModules(registry, given);
  auto has = [&](const char *name) { return std::find(made.absent.begin(), made.absent.end(), name) == made.absent.end(); };
  CHECK(has("NgNativeImagePicker"));
  CHECK(registry.module("NgNativeImagePicker", nullptr));
  CHECK_FALSE(has("NgNativeMediaLibrary"));
  CHECK_FALSE(has("NgNativeCamera"));
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
