#include "battery.h"

#import <Foundation/Foundation.h>
#import <IOKit/ps/IOPSKeys.h>
#import <IOKit/ps/IOPowerSources.h>

#include <mutex>

namespace ngn::appkit {

namespace {

class MacPowerSource final : public PowerSource {
 public:
  PowerFacts facts() override {
    PowerFacts facts;
    facts.lowPowerMode = NSProcessInfo.processInfo.isLowPowerModeEnabled;
    CFTypeRef info = IOPSCopyPowerSourcesInfo();
    if (info == nullptr) {
      return facts;
    }
    CFStringRef providing = IOPSGetProvidingPowerSourceType(info);
    facts.externalPower = providing != nullptr && CFStringCompare(providing, CFSTR(kIOPMACPowerKey), 0) == kCFCompareEqualTo;
    CFArrayRef sources = IOPSCopyPowerSourcesList(info);
    for (CFIndex i = 0; sources != nullptr && i < CFArrayGetCount(sources); i++) {
      NSDictionary *source = (__bridge NSDictionary *)IOPSGetPowerSourceDescription(info, CFArrayGetValueAtIndex(sources, i));
      if (![source[@kIOPSTypeKey] isEqual:@kIOPSInternalBatteryType] || ![source[@kIOPSIsPresentKey] boolValue]) {
        continue;
      }
      double current = [source[@kIOPSCurrentCapacityKey] doubleValue];
      double max = [source[@kIOPSMaxCapacityKey] doubleValue];
      facts.hasBattery = true;
      facts.level = max > 0 ? current / max : 0;
      facts.charging = [source[@kIOPSIsChargingKey] boolValue];
      facts.charged = [source[@kIOPSIsChargedKey] boolValue];
      break;
    }
    if (sources != nullptr) {
      CFRelease(sources);
    }
    CFRelease(info);
    return facts;
  }

  // A power source notification on the main run loop, and Low Power Mode's notification.
  std::function<void()> watch(std::function<void()> changed) override {
    auto listener = new std::function<void()>(std::move(changed));
    CFRunLoopSourceRef source = IOPSNotificationCreateRunLoopSource(
        [](void *context) { (*static_cast<std::function<void()> *>(context))(); }, listener);
    if (source != nullptr) {
      CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopDefaultMode);
    }
    id observer = [NSNotificationCenter.defaultCenter addObserverForName:NSProcessInfoPowerStateDidChangeNotification
                                                                  object:nil
                                                                   queue:nil
                                                              usingBlock:^(NSNotification *) {
                                                                (*listener)();
                                                              }];
    return [source, observer, listener] {
      [NSNotificationCenter.defaultCenter removeObserver:observer];
      if (source != nullptr) {
        // Removed on the main run loop's thread, where the callback runs, so none runs after.
        auto remove = ^{
          CFRunLoopRemoveSource(CFRunLoopGetMain(), source, kCFRunLoopDefaultMode);
          CFRelease(source);
          delete listener;
        };
        if (NSThread.isMainThread) {
          remove();
        } else {
          dispatch_sync(dispatch_get_main_queue(), remove);
        }
      } else {
        delete listener;
      }
    };
  }
};

} // namespace

std::shared_ptr<PowerSource> makePowerSource() {
  return std::make_shared<MacPowerSource>();
}

} // namespace ngn::appkit
