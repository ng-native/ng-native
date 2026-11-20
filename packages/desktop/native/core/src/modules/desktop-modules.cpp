#include "ngn/desktop-modules.h"

#include "ngn/asset.h"
#include "ngn/sqlite.h"
#include "ngn/web-view.h"

namespace ngn {

std::shared_ptr<NativeModule> makeHostModule(std::vector<std::string> absent) {
  struct Host : NativeModule {
    explicit Host(std::vector<std::string> absent) : NativeModule("NgNativeHost") {
      constants([absent = std::move(absent)] {
        folly::dynamic names = folly::dynamic::array();
        for (const auto &name : absent) {
          names.push_back(name);
        }
        return folly::dynamic::object("absentModules", std::move(names));
      });
    }
  };
  return std::make_shared<Host>(std::move(absent));
}

namespace {

// The input of a backend that has none to record from: nothing to allow and no microphone.
std::shared_ptr<AudioInput> noAudioInput() {
  struct None final : AudioInput {
    Access access() override { return Access::Restricted; }
    void requestAccess(std::function<void(Access)> done) override { done(Access::Restricted); }
    bool hasMicrophone() override { return false; }
    std::unique_ptr<AudioRecording> prepare(const std::string &, const RecordingSettings &, std::string &error) override {
      error = "there is no microphone to record from";
      return nullptr;
    }
  };
  return std::make_shared<None>();
}

} // namespace

DesktopModules addDesktopModules(ModuleRegistry &registry, const DesktopModuleSources &s) {
  // One launcher for the process: a reload gets a new module over it.
  DesktopModules made{
      .launcher = makePosixLauncher(),
      .notificationEvents = std::make_shared<NotificationEvents>(s.os.id),
      // The fonts loaded stay registered for the process, so their names outlast a reload too.
      .fonts = std::make_shared<FontLibrary>(),
      .cameraViews = std::make_shared<CameraViews>(),
      .mapViews = std::make_shared<MapViews>(),
  };
  auto notifications = s.notifications(made.notificationEvents);
  made.push = std::make_shared<PushTokens>(s.push, made.notificationEvents);

  // A module whose source the backend did not give is not registered. NgNativeHost names it, so
  // its JavaScript reads it as absent by design rather than as a host built without it.
  auto addSourced = [&registry, &absent = made.absent](const auto &source, const char *name, auto make) {
    if (source) {
      addModule(registry, name, std::move(make));
    } else {
      absent.emplace_back(name);
    }
  };

  addSourced(s.windows, "NgNativeWindows", [windows = s.windows] { return makeWindowsModule(windows); });
  addSourced(s.menus, "NgNativeMenus", [menus = s.menus] { return makeMenusModule(menus); });
  addSourced(s.tray, "NgNativeTray", [tray = s.tray] { return makeTrayModule(tray); });
  addSourced(s.dock, "NgNativeDock", [dock = s.dock] { return makeDockModule(dock); });
  addModule(registry, "NgNativeProcesses", [launcher = made.launcher, processes = s.processes] {
    return makeProcessesModule(launcher, processes);
  });
  addSourced(s.shell, "NgNativeShell", [shell = s.shell, files = s.files] { return makeShellModule(shell, files); });
  // The desktop Expo modules (DESKTOP_MODULES in @ng-native/expo).
  addSourced(s.secrets, "NgNativeSecureStore", [secrets = s.secrets, service = s.appId] {
    return makeSecureStoreModule(secrets, service);
  });
  addModule(registry, "NgNativeClipboard", [system = s.system, state = s.state] {
    return makeDesktopClipboardModule(system, state);
  });
  addSourced(notifications, "NgNativeNotifications", [notifications, events = made.notificationEvents, push = s.push ? made.push : nullptr] {
    return makeNotificationsModule(notifications, events, push);
  });
  addSourced(s.undo, "NgNativeUndo", [undo = s.undo] { return makeUndoModule(undo); });
  addSourced(s.sleep, "NgNativeKeepAwake", [awake = std::make_shared<KeepAwakeTags>(s.sleep)] {
    return makeKeepAwakeModule(awake);
  });
  addSourced(s.haptics, "NgNativeHaptics", [haptics = s.haptics] { return makeHapticsModule(haptics); });
  addSourced(s.files && s.fileWatcher, "NgNativeFileSystem", [files = s.files, watcher = s.fileWatcher] {
    return makeFileSystemModule(files, watcher);
  });
  addSourced(s.fileDialogs, "NgNativeDocumentPicker", [dialogs = s.fileDialogs, caches = s.caches, files = s.files] {
    return makeDocumentPickerModule(dialogs, caches, files);
  });
  // expo-sqlite keeps its databases in the app's documents, under SQLite; here, in its data.
  addModule(registry, "NgNativeSqlite", [databases = s.system->appDataDirectory() + "/SQLite", files = s.files] {
    return makeSqliteModule(databases, files);
  });
  addSourced(s.location, "NgNativeLocation", [location = s.location, noPrompts = s.noPrompts, geocoder = s.geocoder] {
    return makeLocationModule(location, noPrompts, geocoder);
  });
  addSourced(s.authenticator, "NgNativeLocalAuthentication", [authenticator = s.authenticator] {
    return makeLocalAuthenticationModule(authenticator);
  });
  addModule(registry, "NgNativeApplication", [bundle = s.bundle, appId = s.appId, appName = s.appName] {
    return makeApplicationModule(bundle, appId, appName);
  });
  addModule(registry, "NgNativeDevice", [machine = s.machine, os = s.os] { return makeDeviceModule(machine, os); });
  addSourced(s.pathMonitor, "NgNativeNetwork", [monitor = s.pathMonitor] { return makeNetworkModule(monitor); });
  addSourced(s.power, "NgNativeBattery", [power = s.power] { return makeBatteryModule(power); });
  addSourced(s.fontRegistrar, "NgNativeFont", [registrar = s.fontRegistrar, fonts = made.fonts, http = s.http, caches = s.caches, files = s.files] {
    return makeFontModule(registrar, fonts, http, caches + "/fonts", files);
  });
  addModule(registry, "NgNativeWebBrowser", [system = s.system, sessions = s.authSession, noPrompts = s.noPrompts] {
    return makeWebBrowserModule(system, sessions, noPrompts);
  });
  addSourced(s.textReader, "NgNativeTextRecognition", [reader = s.textReader, files = s.files] {
    return makeTextRecognitionModule(reader, files);
  });
  addSourced(s.calendars, "NgNativeCalendar", [calendars = s.calendars, noPrompts = s.noPrompts] {
    return makeCalendarModule(calendars, noPrompts);
  });
  // Players and recorders end with the runtime: a reload stops what the app played.
  // Playing needs only the output: with no input, a recording is refused for want of a microphone.
  addSourced(s.audioOutput, "NgNativeAudio", [output = s.audioOutput, input = s.audioInput ? s.audioInput : noAudioInput(), caches = s.caches, noPrompts = s.noPrompts, files = s.files] {
    return makeAudioModule(output, input, caches + "/Audio", noPrompts, files);
  });
  addSourced(s.videoOutput, "NgNativeVideo", [output = s.videoOutput, files = s.files] { return makeVideoModule(output, files); });
  addSourced(s.languageModel, "NgNativeLocalLlm", [engine = s.languageModel] { return makeLocalLlmModule(engine); });
  addSourced(s.captureShield, "NgNativeScreenCapture", [shield = s.captureShield] { return makeScreenCaptureModule(shield); });
  addSourced(s.splash, "NgNativeSplashScreen", [splash = s.splash] { return makeSplashScreenModule(splash); });
  addSourced(s.photos, "NgNativeMediaLibrary", [photos = s.photos, noPrompts = s.noPrompts, files = s.files] {
    return makeMediaLibraryModule(photos, noPrompts, files);
  });
  if (s.photos) {
    addSourced(s.cameraHardware && s.audioInput && s.cameraSheet, "NgNativeImagePicker", [photos = s.photos, noPrompts = s.noPrompts, camera = PickerCamera{.hardware = s.cameraHardware, .microphone = s.audioInput, .sheet = s.cameraSheet, .folder = s.caches + "/ImagePicker"}] {
      return makeImagePickerModule(photos, photos, noPrompts, camera);
    });
  } else {
    // A picker with no library and no camera: the library half alone.
    addSourced(s.photoPicker, "NgNativeImagePicker", [picker = s.photoPicker, noPrompts = s.noPrompts] {
      return makeImagePickerModule(picker, nullptr, noPrompts);
    });
  }
  addSourced(s.tracking, "NgNativeTrackingTransparency", [tracking = s.tracking, noPrompts = s.noPrompts] {
    return makeTrackingModule(tracking, noPrompts);
  });
  addSourced(s.addressLookup, "NgNativeAddressSearch", [lookup = s.addressLookup] { return makeAddressSearchModule(lookup); });
  addModule(registry, "NgNativeAsset", [http = s.http, caches = s.caches, files = s.files] {
    return makeAssetModule(http, caches, files);
  });
  addSourced(s.symbolMeasurer, "NgNativeSymbol", [measurer = s.symbolMeasurer] { return makeSymbolModule(measurer); });
  addSourced(s.sharePicker, "NgNativeSharing", [picker = s.sharePicker, noPrompts = s.noPrompts, files = s.files] {
    return makeSharingModule(picker, noPrompts, files);
  });
  addSourced(s.imageCodec, "NgNativeImageManipulator", [codec = s.imageCodec, http = s.http, caches = s.caches, files = s.files] {
    return makeImageManipulatorModule(codec, http, caches + "/ImageManipulator", files);
  });
  addSourced(s.cameraHardware, "NgNativeCamera", [hardware = s.cameraHardware, views = made.cameraViews, caches = s.caches, noPrompts = s.noPrompts] {
    return makeCameraModule(hardware, views, caches + "/Camera", noPrompts);
  });
  addSourced(s.mapViews, "NgNativeMaps", [views = made.mapViews] { return makeMapsModule(views); });
  addSourced(s.appleId, "NgNativeAppleAuthentication", [provider = s.appleId, noPrompts = s.noPrompts] {
    return makeAppleAuthenticationModule(provider, noPrompts);
  });
  addSourced(s.printSystem, "NgNativePrint", [system = s.printSystem, http = s.http, caches = s.caches, files = s.files, noPrompts = s.noPrompts] {
    return makePrintModule(system, http, caches + "/Print", files, noPrompts);
  });
  // react-native-webview's navigation answers; harmless in a host built without the library.
  addModule(registry, "RNCWebViewModule", [] { return makeWebViewModule(sharedNavigationLocks()); });
  addModule(registry, "NgNativeStoreReview", [prompt = s.reviewPrompt, noPrompts = s.noPrompts] {
    return makeStoreReviewModule(prompt, noPrompts);
  });
  addSourced(s.crypto, "NgNativeCrypto", [crypto = s.crypto] { return makeCryptoModule(crypto); });
  addSourced(s.locales && s.regionCode, "NgNativeLocalization", [locales = s.locales, regionCode = s.regionCode] {
    return makeLocalizationModule(locales, regionCode());
  });
  addSourced(s.updates, "NgNativeUpdates", [updates = s.updates, fromDevServer = s.fromDevServer, reload = s.reload, appUpdater = s.appUpdater] {
    return makeUpdatesModule(updates, fromDevServer, reload, appUpdater);
  });
  addModule(registry, "NgNativeHost", [absent = made.absent] { return makeHostModule(absent); });
  return made;
}

} // namespace ngn
