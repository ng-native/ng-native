// The OS half of NgNativeFileSystem on Linux (the core's file-system.h): GFileMonitor, which is
// inotify, and the XDG folders.
#pragma once

#include "ngn/file-system.h"

#include <memory>
#include <string>

namespace ngn::gtk {

// Watches with one GFileMonitor per watch, made and read on the main context.
std::shared_ptr<FileWatcher> makeFileWatcher();

// The folder `name` (DESKTOP, DOWNLOAD) names in the XDG user-dirs file's `contents`, with $HOME
// expanded; empty when it names none, or names the home folder itself, which the file uses to
// say the user has no such folder.
std::string xdgUserDir(const std::string &contents, const std::string &name, const std::string &home);

// The app's folders under `appData` and `cache`, `temp`, and the user's: home, and the desktop and
// downloads folders from $XDG_CONFIG_HOME/user-dirs.dirs, absent when the user has none. A Flatpak
// sets XDG_DATA_HOME and XDG_CACHE_HOME under ~/.var/app/<id>, so the app's own follow them.
FileAccess::Folders fileFolders(const std::string &appData, const std::string &cache, const std::string &temp);

} // namespace ngn::gtk
