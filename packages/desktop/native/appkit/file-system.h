// The OS half of NgNativeFileSystem (the core's file-system.h): FSEvents and the Mac's folders.
#pragma once

#include "ngn/file-system.h"

#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<FileWatcher> makeFileWatcher();
// The app's folders and the user's: `appData` and `cache` as the host already makes them, the
// documents in appData's Documents, and the system's temporary folder.
FileAccess::Folders fileFolders(const std::string &appData, const std::string &cache);

} // namespace ngn::appkit
