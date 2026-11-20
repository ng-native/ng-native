#include "app-info.h"

#include <glib.h>

#include <sys/utsname.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <map>
#include <sstream>

namespace ngn::gtk {

namespace {

std::optional<std::string> fileText(const std::string &path) {
  std::ifstream in(path);
  if (!in) {
    return std::nullopt;
  }
  std::stringstream text;
  text << in.rdbuf();
  return text.str();
}

// A DMI field, trimmed, or nothing for the placeholders firmware leaves unfilled.
std::optional<std::string> dmiField(const std::string &root, const char *name) {
  auto text = fileText(root + "/sys/class/dmi/id/" + name);
  if (!text) {
    return std::nullopt;
  }
  auto first = text->find_first_not_of(" \t\n");
  auto last = text->find_last_not_of(" \t\n");
  if (first == std::string::npos) {
    return std::nullopt;
  }
  std::string value = text->substr(first, last - first + 1);
  std::string folded = value;
  std::transform(folded.begin(), folded.end(), folded.begin(), [](unsigned char c) { return std::tolower(c); });
  for (const char *placeholder : {"to be filled by o.e.m.", "system manufacturer", "system product name", "default string", "not specified"}) {
    if (folded == placeholder) {
      return std::nullopt;
    }
  }
  return value;
}

// The distribution's os-release. A Flatpak's /etc/os-release is its runtime's: the host's is under
// /run/host.
std::map<std::string, std::string> osRelease(const std::string &root) {
  std::optional<std::string> release;
  for (const char *path : {"/run/host/os-release", "/etc/os-release", "/usr/lib/os-release"}) {
    if ((release = fileText(root + path))) {
      break;
    }
  }
  return osReleaseFields(release.value_or(""));
}

} // namespace

DistroRelease distroRelease(const std::string &root) {
  auto fields = osRelease(root);
  auto name = fields.find("NAME");
  return {.name = name == fields.end() || name->second.empty() ? "Linux" : name->second, .versionId = fields["VERSION_ID"]};
}

MachineFacts machineFacts(const std::string &root) {
  struct utsname name {};
  uname(&name);
  std::string machine = name.machine;
  // The name the macOS host gives the same CPUs.
  if (machine == "aarch64") {
    machine = "arm64";
  }
  auto fields = osRelease(root);
  long pages = sysconf(_SC_PHYS_PAGES), pageSize = sysconf(_SC_PAGESIZE);
  return {
      .manufacturer = dmiField(root, "sys_vendor"),
      .modelId = dmiField(root, "product_name").value_or(""),
      .osVersion = fields["VERSION_ID"],
      .osBuildId = name.release,
      .deviceName = std::string(g_get_host_name()),
      .totalMemory = pages > 0 && pageSize > 0 ? static_cast<uint64_t>(pages) * static_cast<uint64_t>(pageSize) : 0,
      .architectures = {machine},
  };
}

} // namespace ngn::gtk
