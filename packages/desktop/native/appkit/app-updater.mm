// Whole-app updates through Sparkle, in a `dmg` build only. The binary never links Sparkle: a dmg
// build has it in Contents/Frameworks (`package --format dmg --feed-url` embeds it, from beside the
// host binary), and this loads it there at runtime, so an `app` or `mas` build, or a dev run, has
// no updater and the whole-app half of Updates is absent.
#import "updates.h"

#import <AppKit/AppKit.h>

#include <mutex>

// The parts of Sparkle's API used here, called on the classes looked up at runtime.
@protocol NGNSparkleUpdater <NSObject>
- (void)checkForUpdateInformation;
@end

@protocol NGNSparkleController <NSObject>
- (instancetype)initWithStartingUpdater:(BOOL)startUpdater updaterDelegate:(id)updaterDelegate userDriverDelegate:(id)userDriverDelegate;
- (void)checkForUpdates:(id)sender;
@property (nonatomic, readonly) id<NGNSparkleUpdater> updater;
@end

// SPUUpdaterDelegate's two answers to a check.
@interface NGNSparkleDelegate : NSObject
@property (nonatomic) std::function<void(bool)> found;
@end

@implementation NGNSparkleDelegate
- (void)updater:(id)updater didFindValidUpdate:(id)item {
  if (_found) {
    _found(true);
  }
}
- (void)updaterDidNotFindUpdate:(id)updater {
  if (_found) {
    _found(false);
  }
}
@end

namespace ngn::appkit {

namespace {

class SparkleUpdater final : public AppUpdater {
 public:
  SparkleUpdater(id<NGNSparkleController> controller, NGNSparkleDelegate *delegate)
      : controller_(controller), delegate_(delegate) {}

  void start() {
    std::weak_ptr<SparkleUpdater> weak = self_;
    delegate_.found = [weak](bool available) {
      if (auto self = weak.lock()) {
        self->found(available);
      }
    };
    // A check without Sparkle's window, so the app can say an update is waiting.
    [controller_.updater checkForUpdateInformation];
  }

  void check() override {
    dispatch_async(dispatch_get_main_queue(), ^{
      [controller_ checkForUpdates:nil];
    });
  }

  bool updateAvailable() override {
    std::lock_guard lock(mutex_);
    return available_;
  }

  void onUpdateAvailable(std::function<void(bool)> listener) override {
    std::lock_guard lock(mutex_);
    listener_ = std::move(listener);
  }

  std::weak_ptr<SparkleUpdater> self_;

 private:
  void found(bool available) {
    fprintf(stderr, "[ngn] Sparkle: %s\n", available ? "an update is available" : "no update");
    std::function<void(bool)> listener;
    {
      std::lock_guard lock(mutex_);
      available_ = available;
      listener = listener_;
    }
    if (listener) {
      listener(available);
    }
  }

  id<NGNSparkleController> controller_;
  NGNSparkleDelegate *delegate_;
  std::mutex mutex_;
  bool available_{false};
  std::function<void(bool)> listener_;
};

} // namespace

std::shared_ptr<AppUpdater> makeSparkleUpdater() {
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  if (![info[@"NGNDistribution"] isEqual:@"dmg"] || ![info[@"SUFeedURL"] isKindOfClass:NSString.class]) {
    return nullptr;
  }
  NSString *path = [NSBundle.mainBundle.privateFrameworksPath stringByAppendingPathComponent:@"Sparkle.framework"];
  NSBundle *framework = [NSBundle bundleWithPath:path];
  NSError *error = nil;
  if (framework == nil || ![framework loadAndReturnError:&error]) {
    fprintf(stderr, "[ngn] Sparkle did not load from %s: %s\n", path.UTF8String,
            error != nil ? error.localizedDescription.UTF8String : "it is not there");
    return nullptr;
  }
  Class controllerClass = NSClassFromString(@"SPUStandardUpdaterController");
  if (controllerClass == nil) {
    fprintf(stderr, "[ngn] Sparkle has no SPUStandardUpdaterController\n");
    return nullptr;
  }
  NGNSparkleDelegate *delegate = [NGNSparkleDelegate new];
  id<NGNSparkleController> controller =
      [(id<NGNSparkleController>)[controllerClass alloc] initWithStartingUpdater:YES updaterDelegate:delegate userDriverDelegate:nil];
  auto updater = std::make_shared<SparkleUpdater>(controller, delegate);
  updater->self_ = updater;
  updater->start();
  return updater;
}

} // namespace ngn::appkit
