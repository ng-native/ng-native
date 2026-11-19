// DocumentPicker's dialogs on GTK (FileDialogs in ngn/desktop-expo.h): the FileChooser portal's
// OpenFile and SaveFile, placed against the front window, and GtkFileDialog where no portal
// answers. A MIME type list becomes one filter of them all.
#pragma once

#include "ngn/desktop-expo.h"

#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn::gtk {

std::shared_ptr<FileDialogs> makeFileDialogs();

// The local paths of a FileChooser answer's `uris` (file:// only), or nothing when the user
// chose none.
std::optional<std::vector<std::string>> pathsOfUris(const std::vector<std::string> &uris);

} // namespace ngn::gtk
