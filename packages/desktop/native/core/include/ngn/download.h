// A file fetched over the backend's HTTP client: an asset or a font the dev server serves, saved
// before the OS opens it.
#pragma once

#include "ngn/network.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn {

// Downloads `url` into the file `target`, making its folder first. Answers once, on any thread:
// an empty error once the file is written, else why not: "HTTP <status>", the client's error, or
// "could not be saved to <target>".
void downloadFile(const std::shared_ptr<Http> &http, const std::string &url, const std::string &target, std::function<void(const std::string &error)> done);

} // namespace ngn
