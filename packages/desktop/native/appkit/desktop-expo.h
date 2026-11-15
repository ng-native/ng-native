// The OS half of the desktop Expo modules (the core's desktop-expo.h).
#pragma once

#import <Foundation/Foundation.h>

#include "ngn/desktop-expo.h"
#include "ngn/launch-settings.h"

#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<SecretStore> makeKeychain();
// Removes the file keychain items another test launch left when it ended without removing them.
// Reads attributes only, so no item's data is asked for.
void removeStaleTestItems(const TestLaunch &own);
std::shared_ptr<SleepPreventer> makeSleepPreventer();
std::shared_ptr<HapticPlayer> makeHapticPlayer();
std::shared_ptr<LocaleSource> makeLocaleSource();
std::shared_ptr<FileDialogs> makeFileDialogs();
// The app's folder in ~/Library/Caches, created if missing.
std::string cacheDirectory(const std::string &appId);
// The region the system is set to ("GB"), or "US" when it has none.
std::string systemRegionCode();
// An NSCalendar identifier by expo-localization's name for it ("ethiopic"), or as it is when it has none.
std::string calendarName(NSString *identifier);

} // namespace ngn::appkit
