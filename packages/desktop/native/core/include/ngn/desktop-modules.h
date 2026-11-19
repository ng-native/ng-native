// The desktop host's own modules (NgNativeWindows to NgNativeUpdates, and react-native-webview's
// RNCWebViewModule), registered once for every backend. A backend makes what only its toolkit can
// answer (the Keychain, the pasteboard, the notification centre) and passes it in; the core makes
// the objects its modules share and gives back those the backend's views need too.
//
// Each module is made again on every reload, over the same sources: they live for the process.
#pragma once

#include "ngn/address-search.h"
#include "ngn/app-info.h"
#include "ngn/app-menus.h"
#include "ngn/app-windows.h"
#include "ngn/apple-authentication.h"
#include "ngn/audio.h"
#include "ngn/battery.h"
#include "ngn/calendar.h"
#include "ngn/camera.h"
#include "ngn/crypto.h"
#include "ngn/desktop-expo.h"
#include "ngn/file-system.h"
#include "ngn/fonts.h"
#include "ngn/host-os.h"
#include "ngn/image-manipulator.h"
#include "ngn/language-model.h"
#include "ngn/local-authentication.h"
#include "ngn/location.h"
#include "ngn/maps.h"
#include "ngn/module-registry.h"
#include "ngn/network-state.h"
#include "ngn/network.h"
#include "ngn/notifications.h"
#include "ngn/photo-library.h"
#include "ngn/printing.h"
#include "ngn/processes.h"
#include "ngn/screen-capture.h"
#include "ngn/sharing.h"
#include "ngn/splash-screen.h"
#include "ngn/store-review.h"
#include "ngn/symbol.h"
#include "ngn/system.h"
#include "ngn/text-recognition.h"
#include "ngn/tracking.h"
#include "ngn/tray-and-dock.h"
#include "ngn/undo.h"
#include "ngn/updates.h"
#include "ngn/video.h"
#include "ngn/web-browser.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn {

// What the backend passes in: the host's state and folders, the app's hosts it made with its
// windows and menus, and one source for each module that reaches the OS.
struct DesktopModuleSources {
  // The OS the host runs on: Device's osName, and a device push token's type.
  HostOs os;
  std::shared_ptr<System> system;
  std::shared_ptr<HostState> state;
  std::shared_ptr<Http> http;
  // The one set of rules for every path JavaScript names (file-system.h).
  std::shared_ptr<FileAccess> files;
  // The app's id, which names its secrets' service, and its name, as Application gives them.
  std::string appId;
  std::string appName;
  // The app's caches folder: each module that writes a file JavaScript reads back has one in it.
  std::string caches;
  // No system prompt is ever shown (launch-settings.h): a permission not decided reads as denied.
  bool noPrompts{false};

  std::shared_ptr<WindowHost> windows;
  std::shared_ptr<MenuHost> menus;
  std::shared_ptr<TrayHost> tray;
  std::shared_ptr<DockHost> dock;

  ProcessesSetup processes;
  std::shared_ptr<ShellOpener> shell;
  std::shared_ptr<SecretStore> secrets;
  std::shared_ptr<SleepPreventer> sleep;
  std::shared_ptr<HapticPlayer> haptics;
  // The notification centre, made over the events the core makes for it and for push.
  std::function<std::shared_ptr<NotificationCenter>(std::shared_ptr<NotificationEvents>)> notifications;
  std::shared_ptr<PushRegistrar> push;
  std::shared_ptr<UndoManager> undo;
  std::shared_ptr<FileDialogs> fileDialogs;
  std::shared_ptr<FileWatcher> fileWatcher;
  std::shared_ptr<LocationSource> location;
  std::shared_ptr<Geocoder> geocoder;
  std::shared_ptr<Authenticator> authenticator;
  BundleFacts bundle;
  MachineFacts machine;
  std::shared_ptr<PathMonitor> pathMonitor;
  std::shared_ptr<PowerSource> power;
  std::shared_ptr<FontRegistrar> fontRegistrar;
  std::shared_ptr<AuthSession> authSession;
  std::shared_ptr<TextReader> textReader;
  std::shared_ptr<CalendarStore> calendars;
  std::shared_ptr<AudioOutput> audioOutput;
  std::shared_ptr<AudioInput> audioInput;
  std::shared_ptr<VideoOutput> videoOutput;
  std::shared_ptr<LanguageModelEngine> languageModel;
  std::shared_ptr<CaptureShield> captureShield;
  std::shared_ptr<SplashGate> splash;
  std::shared_ptr<PhotoLibrary> photos;
  // A picker with no photo library behind it (makeFilePhotoPicker), for ImagePicker's library half
  // where there is no `photos`.
  std::shared_ptr<PhotoPicker> photoPicker;
  std::shared_ptr<CameraHardware> cameraHardware;
  std::shared_ptr<CameraSheet> cameraSheet;
  std::shared_ptr<TrackingAuthority> tracking;
  std::shared_ptr<AddressLookup> addressLookup;
  std::shared_ptr<SymbolMeasurer> symbolMeasurer;
  std::shared_ptr<SharePicker> sharePicker;
  std::shared_ptr<ImageCodec> imageCodec;
  std::shared_ptr<AppleIdProvider> appleId;
  std::shared_ptr<PrintSystem> printSystem;
  std::shared_ptr<ReviewPrompt> reviewPrompt;
  std::shared_ptr<CryptoSource> crypto;
  std::shared_ptr<LocaleSource> locales;
  // The region the system is set to, read again as each runtime's Localization module starts.
  std::function<std::string()> regionCode;

  // The Expo Updates client, whether the bundle came from a dev server, how the module's reload
  // runs the bundle it names, and the whole-app updater, when the backend has one.
  std::shared_ptr<UpdatesClient> updates;
  bool fromDevServer{false};
  std::function<void(const std::string &bundle, std::function<void(bool)> done)> reload;
  std::shared_ptr<AppUpdater> appUpdater;
};

// The core objects the modules share that the backend needs as well: the launcher it kills the
// app's programs with as it quits, where it hears push answers and silent pushes, the fonts its
// text draws with, and the registries its camera and map views join.
struct DesktopModules {
  std::shared_ptr<ProcessLauncher> launcher;
  std::shared_ptr<NotificationEvents> notificationEvents;
  std::shared_ptr<PushTokens> push;
  std::shared_ptr<FontLibrary> fonts;
  std::shared_ptr<CameraViews> cameraViews;
  std::shared_ptr<MapViews> mapViews;
  // The modules left out for want of a source, as NgNativeHost names them.
  std::vector<std::string> absent;
};

// Registers each module whose source the backend gives (a module over the host's own objects,
// such as Processes or Asset, always), and NgNativeHost, whose `absentModules` constant names the
// ones left out. Store Review and Web Browser's auth session are the exceptions: a null prompt or
// session is an answer of their own (no rating prompt outside the Mac App Store).
DesktopModules addDesktopModules(ModuleRegistry &registry, const DesktopModuleSources &sources);

// NgNativeHost: `getConstants()` answers `{absentModules}`, the desktop modules this host leaves
// out by design, which JavaScript reads as absent rather than as a host to rebuild.
std::shared_ptr<NativeModule> makeHostModule(std::vector<std::string> absent);

} // namespace ngn
