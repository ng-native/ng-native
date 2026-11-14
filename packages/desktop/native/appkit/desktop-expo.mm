// The OS half of the desktop Expo modules (the core's desktop-expo.h): the Keychain, IOKit's power
// assertions and the trackpad's haptic feedback.
#import "desktop-expo.h"

#import <AppKit/AppKit.h>
#import <IOKit/pwr_mgt/IOPMLib.h>
#import <Security/Security.h>

#include <stdexcept>

namespace ngn::appkit {

namespace {

NSString *ns(const std::string &s) {
  NSString *out = [[NSString alloc] initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];
  return out != nil ? out : @"";
}

NSMutableDictionary *itemQuery(const std::string &service, const std::string &key) {
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : ns(service),
    (__bridge id)kSecAttrAccount : ns(key),
  } mutableCopy];
}

std::runtime_error keychainError(OSStatus status) {
  NSString *message = CFBridgingRelease(SecCopyErrorMessageString(status, nullptr));
  return std::runtime_error(message ? message.UTF8String : ("keychain error " + std::to_string(status)));
}

class Keychain final : public SecretStore {
 public:
  std::optional<std::string> get(const std::string &service, const std::string &key) override {
    NSMutableDictionary *query = itemQuery(service, key);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = nullptr;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) {
      return std::nullopt;
    }
    if (status != errSecSuccess) {
      throw keychainError(status);
    }
    NSData *data = CFBridgingRelease(result);
    return std::string(static_cast<const char *>(data.bytes), data.length);
  }

  void set(const std::string &service, const std::string &key, const std::string &value) override {
    NSData *data = [NSData dataWithBytes:value.data() length:value.size()];
    NSMutableDictionary *query = itemQuery(service, key);
    OSStatus status = SecItemUpdate(
        (__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef) @{(__bridge id)kSecValueData : data});
    if (status == errSecItemNotFound) {
      query[(__bridge id)kSecValueData] = data;
      // Readable only while the Mac is unlocked, as expo-secure-store's default is on iOS.
      query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlocked;
      status = SecItemAdd((__bridge CFDictionaryRef)query, nullptr);
    }
    if (status != errSecSuccess) {
      throw keychainError(status);
    }
  }

  void remove(const std::string &service, const std::string &key) override {
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)itemQuery(service, key));
    if (status != errSecSuccess && status != errSecItemNotFound) {
      throw keychainError(status);
    }
  }
};

class PowerAssertion final : public SleepPreventer {
 public:
  void hold(bool awake) override {
    if (awake && assertion_ == kIOPMNullAssertionID) {
      IOPMAssertionCreateWithName(
          kIOPMAssertPreventUserIdleDisplaySleep, kIOPMAssertionLevelOn, CFSTR("Kept awake by the app"), &assertion_);
    } else if (!awake && assertion_ != kIOPMNullAssertionID) {
      IOPMAssertionRelease(assertion_);
      assertion_ = kIOPMNullAssertionID;
    }
  }
  ~PowerAssertion() override {
    hold(false);
  }

 private:
  IOPMAssertionID assertion_{kIOPMNullAssertionID};
};

class Trackpad final : public HapticPlayer {
 public:
  void play(Pattern pattern) override {
    NSHapticFeedbackPattern p = pattern == Pattern::Alignment ? NSHapticFeedbackPatternAlignment
        : pattern == Pattern::LevelChange                   ? NSHapticFeedbackPatternLevelChange
                                                            : NSHapticFeedbackPatternGeneric;
    dispatch_async(dispatch_get_main_queue(), ^{
      [NSHapticFeedbackManager.defaultPerformer performFeedbackPattern:p
                                                       performanceTime:NSHapticFeedbackPerformanceTimeNow];
    });
  }
};

} // namespace

std::shared_ptr<SecretStore> makeKeychain() {
  return std::make_shared<Keychain>();
}
std::shared_ptr<SleepPreventer> makeSleepPreventer() {
  return std::make_shared<PowerAssertion>();
}
std::shared_ptr<HapticPlayer> makeHapticPlayer() {
  return std::make_shared<Trackpad>();
}

namespace {

std::string str(NSString *s) {
  return s != nil ? std::string(s.UTF8String) : std::string();
}

// NSCalendar's identifiers as expo-localization names them.
std::string calendarName(NSCalendarIdentifier identifier) {
  static NSDictionary<NSCalendarIdentifier, NSString *> *names = @{
    NSCalendarIdentifierGregorian : @"gregorian",
    NSCalendarIdentifierBuddhist : @"buddhist",
    NSCalendarIdentifierChinese : @"chinese",
    NSCalendarIdentifierCoptic : @"coptic",
    NSCalendarIdentifierEthiopicAmeteMihret : @"ethioaa",
    NSCalendarIdentifierEthiopicAmeteAlem : @"ethiopic",
    NSCalendarIdentifierHebrew : @"hebrew",
    NSCalendarIdentifierISO8601 : @"iso8601",
    NSCalendarIdentifierIndian : @"indian",
    NSCalendarIdentifierIslamic : @"islamic",
    NSCalendarIdentifierIslamicCivil : @"islamic-civil",
    NSCalendarIdentifierJapanese : @"japanese",
    NSCalendarIdentifierPersian : @"persian",
    NSCalendarIdentifierRepublicOfChina : @"roc",
    NSCalendarIdentifierIslamicTabular : @"islamic-tbla",
    NSCalendarIdentifierIslamicUmmAlQura : @"islamic-umalqura",
  };
  NSString *name = names[identifier];
  return str(name != nil ? name : identifier);
}

class SystemLocales final : public LocaleSource {
 public:
  std::vector<LocaleFacts> locales() override {
    // The formats are the region's, the same for every language, as Language & Region sets them.
    NSLocale *current = NSLocale.autoupdatingCurrentLocale;
    LocaleFacts formats{
        .decimalSeparator = str(current.decimalSeparator),
        .groupingSeparator = str(current.groupingSeparator),
        .measurementSystem = str([current objectForKey:NSLocaleMeasurementSystem]),
        .currencyCode = str(current.currencyCode),
        .currencySymbol = str(current.currencySymbol),
        .temperatureUnit = temperatureUnit(),
    };
    std::vector<LocaleFacts> out;
    for (NSString *tag in NSLocale.preferredLanguages) {
      auto facts = formats;
      facts.languageTag = str(tag);
      facts.rightToLeft = [NSLocale characterDirectionForLanguage:tag] == NSLocaleLanguageDirectionRightToLeft;
      out.push_back(std::move(facts));
    }
    return out;
  }

  CalendarFacts calendars() override {
    NSCalendar *calendar = NSCalendar.autoupdatingCurrentCalendar;
    NSString *hours = [NSDateFormatter dateFormatFromTemplate:@"j" options:0 locale:NSLocale.autoupdatingCurrentLocale];
    return {
        .calendar = calendarName(calendar.calendarIdentifier),
        .timeZone = str(NSTimeZone.localTimeZone.name),
        .uses24hourClock = [hours rangeOfString:@"a"].location == NSNotFound,
        .firstWeekday = static_cast<int>(calendar.firstWeekday),
    };
  }

 private:
  static std::string temperatureUnit() {
    // The unit the region formats temperatures in: what a formatter with the region's own units
    // writes for a celsius value.
    NSMeasurementFormatter *formatter = [NSMeasurementFormatter new];
    formatter.locale = NSLocale.autoupdatingCurrentLocale;
    formatter.unitStyle = NSFormattingUnitStyleShort;
    NSMeasurement *zero = [[NSMeasurement alloc] initWithDoubleValue:0 unit:NSUnitTemperature.celsius];
    NSString *text = [formatter stringFromMeasurement:zero];
    return [text containsString:@"F"] ? "fahrenheit" : "celsius";
  }
};

} // namespace

std::shared_ptr<LocaleSource> makeLocaleSource() {
  return std::make_shared<SystemLocales>();
}

std::string systemRegionCode() {
  NSString *region = NSLocale.autoupdatingCurrentLocale.countryCode;
  return region.length > 0 ? str(region) : "US";
}

} // namespace ngn::appkit
