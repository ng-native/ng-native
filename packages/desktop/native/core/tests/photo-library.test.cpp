#include "ngn/photo-library.h"

#include <doctest/doctest.h>

#include <optional>
#include <vector>

using folly::dynamic;
using Access = ngn::PhotoLibrary::Access;

namespace {

struct FakeLibrary final : ngn::PhotoLibrary {
  Access read{Access::NotDetermined};
  Access write{Access::NotDetermined};
  Access decides{Access::Granted};
  int asked{0};
  int reads{0};
  int watching{0};
  std::vector<std::string> writes;
  Query lastQuery;
  std::function<void()> changed;
  std::optional<std::vector<Picked>> picks;

  Access access(bool writeOnly) override {
    return writeOnly ? write : read;
  }
  void requestAccess(bool writeOnly, std::function<void(Access)> done) override {
    asked++;
    (writeOnly ? write : read) = decides;
    done(decides);
  }
  std::vector<Asset> assets(const Query &query) override {
    reads++;
    lastQuery = query;
    return {Asset{.id = "a1", .filename = "IMG_1.HEIC", .mediaType = "image", .width = 4032, .height = 3024, .creationTime = 1.7e12}};
  }
  std::optional<Asset> asset(const std::string &id) override {
    reads++;
    return Asset{.id = id, .filename = "IMG_1.HEIC", .mediaType = "image", .location = std::pair(53.8, -1.55), .inCloud = true};
  }
  void fileUri(const std::string &, std::function<void(std::optional<std::string>)> done) override {
    reads++;
    done("file:///Photos/IMG_1.HEIC");
  }
  std::vector<Album> albums() override {
    reads++;
    return {Album{.id = "al1", .title = "Holiday"}};
  }
  std::vector<std::string> albumAssets(const std::string &) override {
    reads++;
    return {"a1"};
  }
  std::function<void()> watch(std::function<void()> c) override {
    watching++;
    changed = std::move(c);
    return [this] { watching--; };
  }
  void create(const std::string &path, const std::optional<std::string> &album,
              std::function<void(std::optional<std::string>, const std::string &)> done) override {
    writes.push_back("create " + path + (album ? " in " + *album : ""));
    done("new-1", "");
  }
  void remove(const std::vector<std::string> &ids, Done done) override {
    writes.push_back("remove " + ids.at(0));
    done("");
  }
  void setFavorite(const std::string &id, bool favorite, Done done) override {
    writes.push_back("favorite " + id + (favorite ? " on" : " off"));
    done("");
  }
  void createAlbum(const std::string &name, const std::vector<std::string> &, bool,
                   std::function<void(std::optional<Album>, const std::string &)> done) override {
    writes.push_back("album " + name);
    done(Album{.id = "al2", .title = name}, "");
  }
  void deleteAlbums(const std::vector<std::string> &, bool, Done done) override {
    writes.push_back("delete albums");
    done("");
  }
  void changeAlbum(const std::string &album, const std::vector<std::string> &, bool add, Done done) override {
    writes.push_back((add ? "add to " : "remove from ") + album);
    done("The album is not editable");
  }
  void pick(const folly::dynamic &, std::function<void(std::optional<std::vector<Picked>>)> done) override {
    done(picks);
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> failure;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  Answer answer;
  module.callWithPromise(method, args, {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &m) { answer.failure = m; }});
  REQUIRE((answer.value || answer.failure));
  return answer;
}

} // namespace

TEST_CASE("NgNativeMediaLibrary reads nothing, and writes nothing, without access") {
  auto library = std::make_shared<FakeLibrary>();
  library->read = Access::Denied;
  library->write = Access::Denied;
  auto module = ngn::makeMediaLibraryModule(library, false);
  auto permission = ask(*module, "requestPermissionsAsync", dynamic::array(false));
  CHECK(permission.value->at("status") == dynamic("denied"));
  CHECK(permission.value->at("accessPrivileges") == dynamic("none"));
  CHECK(library->asked == 0);
  CHECK(ask(*module, "query", dynamic::array(dynamic::object())).value == dynamic::array());
  CHECK(ask(*module, "queryMetadata", dynamic::array(dynamic::object())).value == dynamic::array());
  CHECK(ask(*module, "asset", dynamic::array("a1")).value == dynamic(nullptr));
  CHECK(ask(*module, "uri", dynamic::array("a1")).value == dynamic(nullptr));
  CHECK(ask(*module, "albums").value == dynamic::array());
  CHECK(ask(*module, "albumAssets", dynamic::array("al1")).value == dynamic::array());
  CHECK(library->reads == 0);
  for (auto [method, args] : std::vector<std::pair<std::string, dynamic>>{
           {"createAsset", dynamic::array("file:///tmp/a.jpg", nullptr)},
           {"deleteAssets", dynamic::array(dynamic::array("a1"))},
           {"setFavorite", dynamic::array("a1", true)},
           {"createAlbum", dynamic::array("Trip", dynamic::array(), false)},
           {"deleteAlbums", dynamic::array(dynamic::array("al1"), false)},
           {"addAssets", dynamic::array("al1", dynamic::array("a1"))}}) {
    auto refused = ask(*module, method, args);
    CHECK_MESSAGE(refused.failure, method);
  }
  CHECK(library->writes.empty());
  CHECK(module->call("startObserving") == dynamic(false));
  CHECK(library->watching == 0);
}

TEST_CASE("NgNativeMediaLibrary asks only what is undetermined, and never with no prompts") {
  auto library = std::make_shared<FakeLibrary>();
  auto quiet = ngn::makeMediaLibraryModule(library, true);
  CHECK(ask(*quiet, "requestPermissionsAsync", dynamic::array(true)).value->at("status") == dynamic("undetermined"));
  CHECK(library->asked == 0);
  auto module = ngn::makeMediaLibraryModule(library, false);
  auto granted = ask(*module, "requestPermissionsAsync", dynamic::array(true));
  CHECK(granted.value->at("granted") == dynamic(true));
  CHECK(library->asked == 1);
  CHECK(library->write == Access::Granted);
  CHECK(library->read == Access::NotDetermined);
  // Add-only access saves, and reads nothing.
  CHECK(ask(*module, "createAsset", dynamic::array("file:///tmp/a.jpg", nullptr)).value == dynamic("new-1"));
  CHECK(library->writes.back() == "create /tmp/a.jpg");
  CHECK(ask(*module, "deleteAssets", dynamic::array(dynamic::array("a1"))).failure);
  CHECK(ask(*module, "query", dynamic::array(dynamic::object())).value == dynamic::array());
}

TEST_CASE("NgNativeMediaLibrary reads and writes with full access") {
  auto library = std::make_shared<FakeLibrary>();
  library->read = Access::Granted;
  auto module = ngn::makeMediaLibraryModule(library, false);
  dynamic query = dynamic::object("filters", dynamic::array(dynamic::object("field", "mediaType")("op", "eq")("value", "image"),
                                                        dynamic::object("field", "mediaSubtypes")("op", "contains")("value", "screenshot")))(
      "sort", dynamic::array(dynamic::object("key", "creationTime")("ascending", false)))("limit", 30)("offset", 10)("album", "al1");
  CHECK(ask(*module, "query", dynamic::array(query)).value == dynamic::array("a1"));
  CHECK(library->lastQuery.filters.size() == 2);
  CHECK(library->lastQuery.sort.at(0) == std::pair<std::string, bool>("creationTime", false));
  CHECK(library->lastQuery.limit == 30);
  CHECK(library->lastQuery.offset == 10);
  CHECK(library->lastQuery.album == "al1");
  auto metadata = ask(*module, "queryMetadata", dynamic::array(dynamic::object())).value->at(0);
  CHECK(metadata["filename"] == dynamic("IMG_1.HEIC"));
  CHECK(metadata["duration"] == dynamic(nullptr));
  CHECK(metadata["creationTime"] == dynamic(1.7e12));
  auto info = *ask(*module, "asset", dynamic::array("a1")).value;
  CHECK(info["location"] == dynamic::object("latitude", 53.8)("longitude", -1.55));
  CHECK(info["isInCloud"] == dynamic(true));
  CHECK(ask(*module, "uri", dynamic::array("a1")).value == dynamic("file:///Photos/IMG_1.HEIC"));
  CHECK(ask(*module, "albums").value->at(0) == dynamic::object("id", "al1")("title", "Holiday")("type", "album"));
  CHECK(ask(*module, "createAsset", dynamic::array("file:///tmp/a.jpg", "al1")).value == dynamic("new-1"));
  CHECK(library->writes.back() == "create /tmp/a.jpg in al1");
  CHECK(ask(*module, "setFavorite", dynamic::array("a1", true)).value == dynamic(nullptr));
  CHECK(ask(*module, "createAlbum", dynamic::array("Trip", dynamic::array("a1"), false)).value->at("id") == dynamic("al2"));
  auto failed = ask(*module, "addAssets", dynamic::array("al1", dynamic::array("a1")));
  CHECK(failed.failure == std::optional<std::string>("MediaLibrary: The album is not editable"));
}

TEST_CASE("NgNativeMediaLibrary refuses a query on a field or operator the library has none of") {
  CHECK_THROWS(ngn::photoQueryOf(dynamic::object("filters", dynamic::array(dynamic::object("field", "title")("op", "eq")("value", 1)))));
  CHECK_THROWS(ngn::photoQueryOf(dynamic::object("filters", dynamic::array(dynamic::object("field", "width")("op", "contains")("value", 1)))));
  CHECK_THROWS(ngn::photoQueryOf(dynamic::object("sort", dynamic::array(dynamic::object("key", "mediaSubtypes")))));
  auto library = std::make_shared<FakeLibrary>();
  library->read = Access::Granted;
  auto module = ngn::makeMediaLibraryModule(library, false);
  auto refused = ask(*module, "query", dynamic::array(dynamic::object("filters", dynamic::array(dynamic::object("field", "title")("op", "eq")))));
  CHECK(refused.failure);
}

TEST_CASE("NgNativeMediaLibrary watches the library once it may read it, and stops with the module") {
  auto library = std::make_shared<FakeLibrary>();
  library->read = Access::Granted;
  auto module = ngn::makeMediaLibraryModule(library, false);
  std::vector<dynamic> events;
  module->setEmitter([&](const std::string &event, dynamic body) {
    CHECK(event == "ngNativeMediaLibrary");
    events.push_back(body);
  });
  CHECK(module->call("startObserving") == dynamic(true));
  module->call("startObserving");
  CHECK(library->watching == 1);
  library->changed();
  CHECK(events.size() == 1);
  module.reset();
  CHECK(library->watching == 0);
}

TEST_CASE("NgNativeImagePicker picks from the library without a permission, and has no camera") {
  auto library = std::make_shared<FakeLibrary>();
  library->read = Access::Denied;
  auto module = ngn::makeImagePickerModule(library, false);
  CHECK(ask(*module, "launchImageLibraryAsync", dynamic::array(dynamic::object())).value->at("canceled") == dynamic(true));
  library->picks = std::vector<ngn::PhotoLibrary::Picked>{{.uri = "file:///c/p.jpg", .fileName = "p.jpg", .mimeType = "image/jpeg", .type = "image", .width = 10, .height = 20}};
  auto picked = *ask(*module, "launchImageLibraryAsync", dynamic::array(dynamic::object())).value;
  CHECK(picked["canceled"] == dynamic(false));
  CHECK(picked["assets"][0]["uri"] == dynamic("file:///c/p.jpg"));
  CHECK(picked["assets"][0]["assetId"] == dynamic(nullptr));
  CHECK(picked["assets"][0]["height"] == dynamic(20.0));
  CHECK(ask(*module, "getMediaLibraryPermissionsAsync").value->at("status") == dynamic("denied"));
  CHECK(ask(*module, "requestCameraPermissionsAsync").value->at("granted") == dynamic(false));
  CHECK(ask(*module, "launchCameraAsync").value->at("canceled") == dynamic(true));
  // With no prompts the picker is never shown.
  auto quiet = ngn::makeImagePickerModule(library, true);
  CHECK(ask(*quiet, "launchImageLibraryAsync", dynamic::array(dynamic::object())).value->at("canceled") == dynamic(true));
}
