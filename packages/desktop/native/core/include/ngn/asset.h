// NgNativeAsset: what @ng-native/expo's `assets()` needs of expo-asset on a desktop OS, where
// expo-asset is an empty module: an asset's file on this Mac, downloaded first when the dev server
// serves it. The desktop loader resolves each module to its source as an image is, and builds
// expo's Asset over the answer.
//
// - downloadAsync(uri, hash, type): the file:// uri of the asset's file. A `file:` uri or a path
//   (a packaged app's asset) is answered as it is when the file is there. An `http(s):` url is
//   downloaded into `<caches>/ExponentAsset-<hash>.<type>`, as expo-asset names it, and a file
//   already there for that hash is not downloaded again. Without a hash the name is the url's.
//   A hash or type other than letters, digits, `_` and `-` is refused, so neither leaves the caches.
//
// A file is answered only where `files` lets the app read (FileAccess::readFor: its own folders,
// picks, declared paths and a packaged app's bundle), and anything else is refused before the
// file is looked at, so the answer never says whether a file outside is there.
#pragma once

#include "ngn/file-system.h"
#include "ngn/native-module.h"
#include "ngn/network.h"

#include <memory>
#include <string>

namespace ngn {

std::shared_ptr<NativeModule> makeAssetModule(std::shared_ptr<Http> http, std::string caches, std::shared_ptr<FileAccess> files);

} // namespace ngn
