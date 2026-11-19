#include "ngn/desktop-modules.h"

#include "ngn/asset.h"
#include "ngn/sqlite.h"
#include "ngn/web-view.h"

namespace ngn {

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

  addModule(registry, "NgNativeWindows", [windows = s.windows] { return makeWindowsModule(windows); });
  addModule(registry, "NgNativeMenus", [menus = s.menus] { return makeMenusModule(menus); });
  addModule(registry, "NgNativeTray", [tray = s.tray] { return makeTrayModule(tray); });
  addModule(registry, "NgNativeDock", [dock = s.dock] { return makeDockModule(dock); });
  addModule(registry, "NgNativeProcesses", [launcher = made.launcher, processes = s.processes] {
    return makeProcessesModule(launcher, processes);
  });
  addModule(registry, "NgNativeShell", [shell = s.shell, files = s.files] { return makeShellModule(shell, files); });
  // The desktop Expo modules (DESKTOP_MODULES in @ng-native/expo).
  addModule(registry, "NgNativeSecureStore", [secrets = s.secrets, service = s.appId] {
    return makeSecureStoreModule(secrets, service);
  });
  addModule(registry, "NgNativeClipboard", [system = s.system, state = s.state] {
    return makeDesktopClipboardModule(system, state);
  });
  addModule(registry, "NgNativeNotifications", [notifications, events = made.notificationEvents, push = made.push] {
    return makeNotificationsModule(notifications, events, push);
  });
  addModule(registry, "NgNativeUndo", [undo = s.undo] { return makeUndoModule(undo); });
  addModule(registry, "NgNativeKeepAwake", [awake = std::make_shared<KeepAwakeTags>(s.sleep)] {
    return makeKeepAwakeModule(awake);
  });
  addModule(registry, "NgNativeHaptics", [haptics = s.haptics] { return makeHapticsModule(haptics); });
  addModule(registry, "NgNativeFileSystem", [files = s.files, watcher = s.fileWatcher] {
    return makeFileSystemModule(files, watcher);
  });
  addModule(registry, "NgNativeDocumentPicker", [dialogs = s.fileDialogs, caches = s.caches, files = s.files] {
    return makeDocumentPickerModule(dialogs, caches, files);
  });
  // expo-sqlite keeps its databases in the app's documents, under SQLite; here, in its data.
  addModule(registry, "NgNativeSqlite", [databases = s.system->appDataDirectory() + "/SQLite", files = s.files] {
    return makeSqliteModule(databases, files);
  });
  addModule(registry, "NgNativeLocation", [location = s.location, noPrompts = s.noPrompts, geocoder = s.geocoder] {
    return makeLocationModule(location, noPrompts, geocoder);
  });
  addModule(registry, "NgNativeLocalAuthentication", [authenticator = s.authenticator] {
    return makeLocalAuthenticationModule(authenticator);
  });
  addModule(registry, "NgNativeApplication", [bundle = s.bundle, appId = s.appId, appName = s.appName] {
    return makeApplicationModule(bundle, appId, appName);
  });
  addModule(registry, "NgNativeDevice", [machine = s.machine, os = s.os.name] { return makeDeviceModule(machine, os); });
  addModule(registry, "NgNativeNetwork", [monitor = s.pathMonitor] { return makeNetworkModule(monitor); });
  addModule(registry, "NgNativeBattery", [power = s.power] { return makeBatteryModule(power); });
  addModule(registry, "NgNativeFont", [registrar = s.fontRegistrar, fonts = made.fonts, http = s.http, caches = s.caches, files = s.files] {
    return makeFontModule(registrar, fonts, http, caches + "/fonts", files);
  });
  addModule(registry, "NgNativeWebBrowser", [system = s.system, sessions = s.authSession, noPrompts = s.noPrompts] {
    return makeWebBrowserModule(system, sessions, noPrompts);
  });
  addModule(registry, "NgNativeTextRecognition", [reader = s.textReader, files = s.files] {
    return makeTextRecognitionModule(reader, files);
  });
  addModule(registry, "NgNativeCalendar", [calendars = s.calendars, noPrompts = s.noPrompts] {
    return makeCalendarModule(calendars, noPrompts);
  });
  // Players and recorders end with the runtime: a reload stops what the app played.
  addModule(registry, "NgNativeAudio", [output = s.audioOutput, input = s.audioInput, caches = s.caches, noPrompts = s.noPrompts, files = s.files] {
    return makeAudioModule(output, input, caches + "/Audio", noPrompts, files);
  });
  addModule(registry, "NgNativeVideo", [output = s.videoOutput, files = s.files] { return makeVideoModule(output, files); });
  addModule(registry, "NgNativeLocalLlm", [engine = s.languageModel] { return makeLocalLlmModule(engine); });
  addModule(registry, "NgNativeScreenCapture", [shield = s.captureShield] { return makeScreenCaptureModule(shield); });
  addModule(registry, "NgNativeSplashScreen", [splash = s.splash] { return makeSplashScreenModule(splash); });
  addModule(registry, "NgNativeMediaLibrary", [photos = s.photos, noPrompts = s.noPrompts, files = s.files] {
    return makeMediaLibraryModule(photos, noPrompts, files);
  });
  addModule(registry, "NgNativeImagePicker", [photos = s.photos, noPrompts = s.noPrompts, camera = PickerCamera{.hardware = s.cameraHardware, .microphone = s.audioInput, .sheet = s.cameraSheet, .folder = s.caches + "/ImagePicker"}] {
    return makeImagePickerModule(photos, noPrompts, camera);
  });
  addModule(registry, "NgNativeTrackingTransparency", [tracking = s.tracking, noPrompts = s.noPrompts] {
    return makeTrackingModule(tracking, noPrompts);
  });
  addModule(registry, "NgNativeAddressSearch", [lookup = s.addressLookup] { return makeAddressSearchModule(lookup); });
  addModule(registry, "NgNativeAsset", [http = s.http, caches = s.caches, files = s.files] {
    return makeAssetModule(http, caches, files);
  });
  addModule(registry, "NgNativeSymbol", [measurer = s.symbolMeasurer] { return makeSymbolModule(measurer); });
  addModule(registry, "NgNativeSharing", [picker = s.sharePicker, noPrompts = s.noPrompts, files = s.files] {
    return makeSharingModule(picker, noPrompts, files);
  });
  addModule(registry, "NgNativeImageManipulator", [codec = s.imageCodec, http = s.http, caches = s.caches, files = s.files] {
    return makeImageManipulatorModule(codec, http, caches + "/ImageManipulator", files);
  });
  addModule(registry, "NgNativeCamera", [hardware = s.cameraHardware, views = made.cameraViews, caches = s.caches, noPrompts = s.noPrompts] {
    return makeCameraModule(hardware, views, caches + "/Camera", noPrompts);
  });
  addModule(registry, "NgNativeMaps", [views = made.mapViews] { return makeMapsModule(views); });
  addModule(registry, "NgNativeAppleAuthentication", [provider = s.appleId, noPrompts = s.noPrompts] {
    return makeAppleAuthenticationModule(provider, noPrompts);
  });
  addModule(registry, "NgNativePrint", [system = s.printSystem, http = s.http, caches = s.caches, files = s.files, noPrompts = s.noPrompts] {
    return makePrintModule(system, http, caches + "/Print", files, noPrompts);
  });
  // react-native-webview's navigation answers; harmless in a host built without the library.
  addModule(registry, "RNCWebViewModule", [] { return makeWebViewModule(sharedNavigationLocks()); });
  addModule(registry, "NgNativeStoreReview", [prompt = s.reviewPrompt, noPrompts = s.noPrompts] {
    return makeStoreReviewModule(prompt, noPrompts);
  });
  addModule(registry, "NgNativeCrypto", [crypto = s.crypto] { return makeCryptoModule(crypto); });
  addModule(registry, "NgNativeLocalization", [locales = s.locales, regionCode = s.regionCode] {
    return makeLocalizationModule(locales, regionCode());
  });
  addModule(registry, "NgNativeUpdates", [updates = s.updates, fromDevServer = s.fromDevServer, reload = s.reload, appUpdater = s.appUpdater] {
    return makeUpdatesModule(updates, fromDevServer, reload, appUpdater);
  });
  return made;
}

} // namespace ngn
