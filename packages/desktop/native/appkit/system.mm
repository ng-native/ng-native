#import "system.h"

#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>

#include <folly/json.h>

#include <atomic>
#include <mutex>

namespace {

NSString *ns(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

std::string str(NSString *s) {
  return s ? std::string(s.UTF8String) : std::string();
}

std::string schemeOf(NSAppearance *appearance) {
  NSAppearanceName match = [appearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]];
  return [match isEqualToString:NSAppearanceNameDarkAqua] ? "dark" : "light";
}

void onMain(dispatch_block_t block) {
  if (NSThread.isMainThread) {
    block();
  } else {
    dispatch_async(dispatch_get_main_queue(), block);
  }
}

} // namespace

namespace ngn::appkit {

class AppKitSystem final : public System {
 public:
  explicit AppKitSystem(std::string appId) : appId_(std::move(appId)) {
    // Read once here on the main thread; JavaScript asks from its own.
    systemScheme_ = schemeOf(NSApp.effectiveAppearance);
    rightToLeft_ = NSApp.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  }

  DeviceFacts facts() override {
    NSOperatingSystemVersion v = NSProcessInfo.processInfo.operatingSystemVersion;
    std::string version = std::to_string(v.majorVersion) + "." + std::to_string(v.minorVersion);
    if (v.patchVersion != 0) {
      version += "." + std::to_string(v.patchVersion);
    }
    NSString *language = NSLocale.preferredLanguages.firstObject;
    if (language == nil) {
      language = NSLocale.currentLocale.localeIdentifier;
    }
    return {.osVersion = version, .systemName = "macOS", .locale = str(language), .rightToLeft = rightToLeft_};
  }

  void openUrl(const std::string &url, std::function<void(bool)> done) override {
    NSURL *u = [NSURL URLWithString:ns(url)];
    if (u == nil) {
      done(false);
      return;
    }
    auto shared = std::make_shared<std::function<void(bool)>>(std::move(done));
    onMain(^{
      [NSWorkspace.sharedWorkspace openURL:u
                             configuration:[NSWorkspaceOpenConfiguration configuration]
                         completionHandler:^(NSRunningApplication *app, NSError *error) {
                           (*shared)(error == nil);
                         }];
    });
  }

  bool canOpenUrl(const std::string &url) override {
    NSURL *u = [NSURL URLWithString:ns(url)];
    return u != nil && [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:u] != nil;
  }

  void openSettings(std::function<void(bool)> done) override {
    // A Mac app has no settings page of its own in System Settings; this opens System Settings.
    openUrl("x-apple.systempreferences:", std::move(done));
  }

  std::string colorScheme() override {
    std::lock_guard lock(mutex_);
    return override_.value_or(systemScheme_);
  }

  void setColorScheme(std::optional<std::string> scheme) override {
    {
      std::lock_guard lock(mutex_);
      override_ = scheme;
    }
    onMain(^{
      NSApp.appearance = !scheme ? nil
          : *scheme == "dark"    ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]
                                 : [NSAppearance appearanceNamed:NSAppearanceNameAqua];
    });
  }

  // The system's own scheme, with no override. Main thread.
  void systemSchemeChanged(std::string scheme) {
    std::lock_guard lock(mutex_);
    systemScheme_ = std::move(scheme);
  }

  void showAlert(const AlertRequest &request, std::function<void(int, std::string)> done) override {
    auto shared = std::make_shared<std::function<void(int, std::string)>>(std::move(done));
    AlertRequest r = request;
    onMain(^{
      NSAlert *alert = [NSAlert new];
      alert.messageText = ns(r.title);
      alert.informativeText = ns(r.message);
      for (size_t i = 0; i < r.buttons.size(); i++) {
        NSButton *button = [alert addButtonWithTitle:ns(r.buttons[i].label)];
        if (r.buttons[i].role == AlertButtonRole::Destructive) {
          button.hasDestructiveAction = YES;
        }
        if ((int)i == r.cancelIndex && i != 0) {
          button.keyEquivalent = @"\033";
        }
      }
      NSTextField *field = nil;
      if (r.input != AlertInput::None) {
        field = r.input == AlertInput::SecureText ? [NSSecureTextField new] : [NSTextField new];
        field.stringValue = ns(r.defaultValue);
        field.frame = NSMakeRect(0, 0, 240, 24);
        alert.accessoryView = field;
        alert.window.initialFirstResponder = field;
      }
      void (^finish)(NSModalResponse) = ^(NSModalResponse response) {
        int index = (int)(response - NSAlertFirstButtonReturn);
        (*shared)(index, field ? str(field.stringValue) : "");
      };
      // A sheet on the key window; with none (a menu-bar app, or every window closed) the alert
      // runs app-modally, so the answer always arrives.
      NSWindow *key = NSApp.keyWindow;
      if (key != nil && key.attachedSheet == nil) {
        [alert beginSheetModalForWindow:key completionHandler:finish];
      } else {
        finish([alert runModal]);
      }
    });
  }

  std::optional<std::string> clipboardText() override {
    NSString *text = [NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString];
    if (text == nil) {
      return std::nullopt;
    }
    return str(text);
  }

  void setClipboardText(const std::string &text) override {
    NSPasteboard *board = NSPasteboard.generalPasteboard;
    [board clearContents];
    [board setString:ns(text) forType:NSPasteboardTypeString];
  }

  std::optional<folly::dynamic> preference(const std::string &key) override {
    NSString *json = [NSUserDefaults.standardUserDefaults stringForKey:ns(prefixed(key))];
    if (json == nil) {
      return std::nullopt;
    }
    try {
      return folly::parseJson(str(json));
    } catch (...) {
      return std::nullopt;
    }
  }

  void setPreference(const std::string &key, std::optional<folly::dynamic> value) override {
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    if (value) {
      [defaults setObject:ns(folly::toJson(*value)) forKey:ns(prefixed(key))];
    } else {
      [defaults removeObjectForKey:ns(prefixed(key))];
    }
  }

  std::optional<std::pair<double, double>> imageSize(const std::string &bytes) override {
    NSData *data = [NSData dataWithBytesNoCopy:(void *)bytes.data() length:bytes.size() freeWhenDone:NO];
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, nullptr);
    if (source == nullptr) {
      return std::nullopt;
    }
    std::optional<std::pair<double, double>> size;
    if (CGImageSourceGetCount(source) > 0) {
      NSDictionary *props = (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr);
      NSNumber *w = props[(__bridge NSString *)kCGImagePropertyPixelWidth];
      NSNumber *h = props[(__bridge NSString *)kCGImagePropertyPixelHeight];
      if (w != nil && h != nil) {
        size = std::pair{w.doubleValue, h.doubleValue};
      }
    }
    CFRelease(source);
    return size;
  }

  std::string appDataDirectory() override {
    NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory
                                                          inDomains:NSUserDomainMask]
                         .firstObject;
    NSString *bundleId = NSBundle.mainBundle.bundleIdentifier;
    NSURL *dir = [support URLByAppendingPathComponent:bundleId != nil ? bundleId : ns(appId_) isDirectory:YES];
    [NSFileManager.defaultManager createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
    return str(dir.path);
  }

 private:
  // A bare host binary has no bundle identifier, so every app run with it would share one
  // defaults domain: the app's id keeps them apart.
  std::string prefixed(const std::string &key) const {
    return NSBundle.mainBundle.bundleIdentifier ? key : appId_ + "." + key;
  }

  std::string appId_;
  std::mutex mutex_;
  std::string systemScheme_;
  std::optional<std::string> override_;
  bool rightToLeft_{false};
};

std::shared_ptr<System> makeSystem(std::string appId) {
  return std::make_shared<AppKitSystem>(std::move(appId));
}

} // namespace ngn::appkit

// Observes the app for watchApp. Kept alive for the process.
@interface NGNAppObserver : NSObject
@property (nonatomic) std::shared_ptr<ngn::HostState> state;
@property (nonatomic) std::shared_ptr<ngn::appkit::AppKitSystem> system;
@property (nonatomic) BOOL launched;
@end

@implementation NGNAppObserver

- (void)start {
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  for (NSNotificationName name in @[
         NSApplicationDidBecomeActiveNotification, NSApplicationDidResignActiveNotification,
         NSApplicationDidHideNotification, NSApplicationDidUnhideNotification
       ]) {
    [center addObserver:self selector:@selector(activityChanged) name:name object:nil];
  }
  [center addObserver:self selector:@selector(didLaunch) name:NSApplicationDidFinishLaunchingNotification object:nil];
  [NSApp addObserver:self forKeyPath:@"effectiveAppearance" options:NSKeyValueObservingOptionNew context:nil];
  [NSAppleEventManager.sharedAppleEventManager setEventHandler:self
                                                   andSelector:@selector(handleURL:withReply:)
                                                 forEventClass:kInternetEventClass
                                                    andEventID:kAEGetURL];
  self.state->colorScheme.set(self.system->colorScheme());
}

- (void)didLaunch {
  self.launched = YES;
}

- (void)activityChanged {
  ngn::Activity activity = NSApp.isHidden ? ngn::Activity::Background
      : NSApp.isActive                    ? ngn::Activity::Active
                                          : ngn::Activity::Inactive;
  self.state->activity.set(activity);
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context {
  // With no override of the app's own, what the app draws in is the system's scheme.
  if (NSApp.appearance == nil) {
    self.system->systemSchemeChanged(schemeOf(NSApp.effectiveAppearance));
  }
  self.state->colorScheme.set(self.system->colorScheme());
}

- (void)handleURL:(NSAppleEventDescriptor *)event withReply:(NSAppleEventDescriptor *)reply {
  NSString *url = [event paramDescriptorForKeyword:keyDirectObject].stringValue;
  if (url == nil) {
    return;
  }
  // A URL that launched the app is its initial URL; later ones are events.
  if (self.launched) {
    self.state->openUrl(str(url));
  } else {
    self.state->setInitialUrl(str(url));
  }
}

@end

namespace ngn::appkit {

void watchApp(std::shared_ptr<HostState> state, std::shared_ptr<System> system) {
  static NGNAppObserver *observer;
  observer = [NGNAppObserver new];
  observer.state = std::move(state);
  observer.system = std::static_pointer_cast<AppKitSystem>(system);
  [observer start];
}

} // namespace ngn::appkit
