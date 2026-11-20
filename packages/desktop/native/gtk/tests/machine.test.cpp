// Device and Crypto on Linux: the machine's facts from DMI and os-release, and GLib's digests and
// the kernel's random bytes.
#include "../app-info.h"
#include "../crypto.h"
#include "../host-sources.h"

#include "ngn/host-os.h"

#include <doctest/doctest.h>
#include <glib.h>

#include <filesystem>
#include <fstream>
#include <set>

using folly::dynamic;

namespace {

void writeFile(const std::filesystem::path &path, const std::string &text) {
  std::filesystem::create_directories(path.parent_path());
  std::ofstream(path) << text;
}

// A folder that stands for /, removed with what it holds.
struct FakeRoot {
  std::filesystem::path path;
  FakeRoot() {
    gchar *made = g_dir_make_tmp("ngn-machine-XXXXXX", nullptr);
    path = made;
    g_free(made);
  }
  ~FakeRoot() {
    std::filesystem::remove_all(path);
  }
};

} // namespace

TEST_CASE("Device on Linux names the firmware's maker and product and the distribution's version") {
  FakeRoot root;
  writeFile(root.path / "sys/class/dmi/id/sys_vendor", "LENOVO\n");
  writeFile(root.path / "sys/class/dmi/id/product_name", "20XW0055UK\n");
  writeFile(root.path / "etc/os-release", "NAME=\"AlmaLinux\"\nVERSION_ID=\"9.4\"\n");
  auto facts = ngn::gtk::machineFacts(root.path.string());
  CHECK(facts.manufacturer == "LENOVO");
  CHECK(facts.modelId == "20XW0055UK");
  CHECK(facts.osVersion == "9.4");
  CHECK_FALSE(facts.osBuildId.empty());
  CHECK(facts.deviceName == std::string(g_get_host_name()));
  CHECK(facts.totalMemory > 0);
  REQUIRE(facts.architectures.size() == 1);
  CHECK((facts.architectures[0] == "arm64" || facts.architectures[0] == "x86_64"));
  auto device = ngn::makeDeviceModule(facts, ngn::linuxOs());
  CHECK(device->property("brand") == dynamic("LENOVO"));
  CHECK(device->property("osName") == dynamic("Linux"));
}

TEST_CASE("Device inside a Flatpak reads the host's os-release, and drops firmware placeholders") {
  FakeRoot root;
  writeFile(root.path / "sys/class/dmi/id/sys_vendor", "To Be Filled By O.E.M.\n");
  writeFile(root.path / "etc/os-release", "VERSION_ID=50\n");
  writeFile(root.path / "run/host/os-release", "VERSION_ID=\"44\"\n");
  auto facts = ngn::gtk::machineFacts(root.path.string());
  CHECK_FALSE(facts.manufacturer);
  CHECK(facts.modelId.empty());
  CHECK(facts.osVersion == "44");
  CHECK(ngn::makeDeviceModule(facts, ngn::linuxOs())->property("brand") == dynamic(nullptr));
}

TEST_CASE("Platform on Linux names the distribution and its version, as its os-release does") {
  FakeRoot root;
  writeFile(root.path / "etc/os-release", "NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nVERSION=\"24.04.1 LTS\"\n");
  auto release = ngn::gtk::distroRelease(root.path.string());
  CHECK(release.name == "Ubuntu");
  CHECK(release.versionId == "24.04");

  // Inside a Flatpak, the host's.
  writeFile(root.path / "run/host/os-release", "NAME=\"Fedora Linux\"\nVERSION_ID=44\n");
  release = ngn::gtk::distroRelease(root.path.string());
  CHECK(release.name == "Fedora Linux");
  CHECK(release.versionId == "44");

  // A rolling release has no VERSION_ID, and os-release's NAME defaults to Linux.
  writeFile(root.path / "run/host/os-release", "ID=arch\n");
  release = ngn::gtk::distroRelease(root.path.string());
  CHECK(release.name == "Linux");
  CHECK(release.versionId.empty());
}

TEST_CASE("Platform on Linux is the distribution's, with the desktop interface idiom") {
  auto facts = ngn::gtk::makeSystem("ngn.machine.test", g_get_tmp_dir())->facts();
  auto release = ngn::gtk::distroRelease();
  CHECK(facts.systemName == release.name);
  CHECK(facts.osVersion == release.versionId);
  CHECK(facts.interfaceIdiom == "desktop");
}

TEST_CASE("Crypto on Linux digests with GLib and has no MD2 or MD4") {
  auto crypto = ngn::gtk::makeCryptoSource();
  CHECK(ngn::hexOf(*crypto->digest("SHA-256", "abc")) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  CHECK(ngn::hexOf(*crypto->digest("SHA-1", "abc")) == "a9993e364706816aba3e25717850c26c9cd0d89d");
  CHECK(ngn::hexOf(*crypto->digest("MD5", "")) == "d41d8cd98f00b204e9800998ecf8427e");
  CHECK(crypto->digest("SHA-384", "abc")->size() == 48);
  CHECK(crypto->digest("SHA-512", "abc")->size() == 64);
  CHECK_FALSE(crypto->digest("MD2", "abc"));
  CHECK_FALSE(crypto->digest("MD4", "abc"));
}

TEST_CASE("Crypto on Linux fills random bytes, and a UUID from them is version 4") {
  auto crypto = ngn::gtk::makeCryptoSource();
  CHECK(crypto->randomBytes(0).empty());
  std::set<std::string> seen;
  for (int i = 0; i < 4; ++i) {
    auto bytes = crypto->randomBytes(1024);
    CHECK(bytes.size() == 1024);
    seen.insert(bytes);
  }
  CHECK(seen.size() == 4);
  auto module = ngn::makeCryptoModule(crypto);
  auto uuid = module->call("randomUUID").asString();
  CHECK(uuid.size() == 36);
  CHECK(uuid[14] == '4');
}
