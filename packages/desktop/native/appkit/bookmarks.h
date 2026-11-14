// The OS half of the core's PickStore (file-system.h): security-scoped bookmarks over NSURL, and
// the store kept in the app's user defaults, where JavaScript's FileSystem cannot write.
#pragma once

#include "ngn/file-system.h"

#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<Bookmarks> makeBookmarks();

// The picks under `key` in the standard user defaults.
PickStore::Persistence pickPersistence(const std::string &key);

} // namespace ngn::appkit
