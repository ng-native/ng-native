#include "ngn/photo-library.h"

#include <mutex>
#include <set>
#include <stdexcept>

namespace ngn {

namespace {

using Access = PhotoLibrary::Access;

const std::set<std::string> kFields{"creationTime", "modificationTime", "mediaType", "width", "height",
                                    "duration",     "isFavorite",       "mediaSubtypes"};
const std::set<std::string> kOps{"eq", "within", "gt", "gte", "lt", "lte", "contains"};

bool reads(Access access) {
  return access == Access::Granted || access == Access::Limited;
}

folly::dynamic permissionOf(Access access) {
  bool granted = reads(access);
  bool askable = access == Access::NotDetermined;
  return folly::dynamic::object("status", granted ? "granted" : askable ? "undetermined" : "denied")("granted", granted)(
      "canAskAgain", askable)("expires", "never")(
      "accessPrivileges", access == Access::Granted ? "all" : access == Access::Limited ? "limited" : "none");
}

folly::dynamic orNull(const std::optional<double> &value) {
  return value ? folly::dynamic(*value) : folly::dynamic(nullptr);
}

folly::dynamic subtypesOf(const PhotoLibrary::Asset &asset) {
  folly::dynamic out = folly::dynamic::array();
  for (const auto &subtype : asset.subtypes) {
    out.push_back(subtype);
  }
  return out;
}

folly::dynamic metadataOf(const PhotoLibrary::Asset &asset) {
  return folly::dynamic::object("id", asset.id)("filename", asset.filename)("mediaType", asset.mediaType)("width", asset.width)(
      "height", asset.height)("duration", orNull(asset.duration))("creationTime", orNull(asset.creationTime))(
      "modificationTime", orNull(asset.modificationTime))("isFavorite", asset.favorite)("mediaSubtypes", subtypesOf(asset));
}

folly::dynamic infoOf(const PhotoLibrary::Asset &asset) {
  auto info = metadataOf(asset);
  info["isInCloud"] = asset.inCloud;
  info["location"] = asset.location ? folly::dynamic::object("latitude", asset.location->first)("longitude", asset.location->second)
                                    : folly::dynamic(nullptr);
  return info;
}

folly::dynamic albumOf(const PhotoLibrary::Album &album) {
  return folly::dynamic::object("id", album.id)("title", album.title)("type", album.type);
}

std::vector<std::string> idsOf(const folly::dynamic &args, size_t at) {
  std::vector<std::string> ids;
  if (args.size() > at && args[at].isArray()) {
    for (const auto &id : args[at]) {
      if (id.isString()) {
        ids.push_back(id.asString());
      }
    }
  }
  return ids;
}

std::optional<std::string> stringArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isString() ? std::optional(args[at].asString()) : std::nullopt;
}

bool flagArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isBool() && args[at].asBool();
}

// The path a file url names, or the string itself when it is a path.
std::string pathOf(const std::string &uri) {
  return uri.rfind("file://", 0) == 0 ? uri.substr(7) : uri;
}

void settle(JsPromise promise, const std::string &error) {
  if (error.empty()) {
    promise.resolve(nullptr);
  } else {
    promise.reject("MediaLibrary: " + error);
  }
}

// The two permissions, asked as the module asks them.
struct Permissions {
  std::shared_ptr<PhotoLibrary> library;
  bool noPrompts;
  void get(bool writeOnly, JsPromise promise) const {
    promise.resolve(permissionOf(library->access(writeOnly)));
  }
  void request(bool writeOnly, JsPromise promise) const {
    auto access = library->access(writeOnly);
    if (noPrompts || access != Access::NotDetermined) {
      promise.resolve(permissionOf(access));
      return;
    }
    library->requestAccess(writeOnly, [promise](Access decided) { promise.resolve(permissionOf(decided)); });
  }
};

} // namespace

PhotoLibrary::Query photoQueryOf(const folly::dynamic &query) {
  PhotoLibrary::Query out;
  if (!query.isObject()) {
    return out;
  }
  if (auto filters = query.get_ptr("filters"); filters && filters->isArray()) {
    for (const auto &filter : *filters) {
      auto field = filter.getDefault("field", "").asString();
      auto op = filter.getDefault("op", "").asString();
      if (!kFields.count(field) || !kOps.count(op)) {
        throw std::invalid_argument("MediaLibrary: a query cannot filter " + field + " by " + op);
      }
      if ((op == "contains") != (field == "mediaSubtypes")) {
        throw std::invalid_argument("MediaLibrary: mediaSubtypes is filtered by contains, and only it is");
      }
      out.filters.push_back({field, op, filter.getDefault("value", nullptr)});
    }
  }
  if (auto sort = query.get_ptr("sort"); sort && sort->isArray()) {
    for (const auto &descriptor : *sort) {
      auto key = descriptor.getDefault("key", "").asString();
      if (!kFields.count(key) || key == "mediaSubtypes") {
        throw std::invalid_argument("MediaLibrary: a query cannot sort by " + key);
      }
      out.sort.emplace_back(key, descriptor.getDefault("ascending", true).asBool());
    }
  }
  if (auto limit = query.get_ptr("limit"); limit && limit->isNumber()) {
    out.limit = static_cast<int>(limit->asDouble());
  }
  if (auto offset = query.get_ptr("offset"); offset && offset->isNumber()) {
    out.offset = std::max(0, static_cast<int>(offset->asDouble()));
  }
  if (auto album = query.get_ptr("album"); album && album->isString()) {
    out.album = album->asString();
  }
  return out;
}

std::shared_ptr<NativeModule> makeMediaLibraryModule(std::shared_ptr<PhotoLibrary> library, bool noPrompts) {
  struct MediaLibrary : NativeModule {
    std::shared_ptr<PhotoLibrary> library;
    std::mutex mutex;
    std::function<void()> stopWatching;

    MediaLibrary(std::shared_ptr<PhotoLibrary> from, bool noPrompts) : NativeModule("NgNativeMediaLibrary"), library(std::move(from)) {
      listeners();
      auto photos = library;
      Permissions permissions{photos, noPrompts};
      promise("getPermissionsAsync", [permissions](const folly::dynamic &args, JsPromise promise) {
        permissions.get(flagArg(args, 0), std::move(promise));
      });
      promise("requestPermissionsAsync", [permissions](const folly::dynamic &args, JsPromise promise) {
        permissions.request(flagArg(args, 0), std::move(promise));
      });
      promise("presentPermissionsPicker", [](const folly::dynamic &, JsPromise promise) { promise.resolve(nullptr); });

      auto readable = [photos] { return reads(photos->access(false)); };
      auto writable = [photos](bool addOnly) {
        return reads(photos->access(false)) || (addOnly && reads(photos->access(true)));
      };
      promise("query", [photos, readable](const folly::dynamic &args, JsPromise promise) {
        PhotoLibrary::Query query;
        try {
          query = photoQueryOf(args.empty() ? folly::dynamic(nullptr) : args[0]);
        } catch (const std::invalid_argument &error) {
          promise.reject(error.what());
          return;
        }
        folly::dynamic out = folly::dynamic::array();
        if (readable()) {
          for (const auto &asset : photos->assets(query)) {
            out.push_back(asset.id);
          }
        }
        promise.resolve(std::move(out));
      });
      promise("queryMetadata", [photos, readable](const folly::dynamic &args, JsPromise promise) {
        PhotoLibrary::Query query;
        try {
          query = photoQueryOf(args.empty() ? folly::dynamic(nullptr) : args[0]);
        } catch (const std::invalid_argument &error) {
          promise.reject(error.what());
          return;
        }
        folly::dynamic out = folly::dynamic::array();
        if (readable()) {
          for (const auto &asset : photos->assets(query)) {
            out.push_back(metadataOf(asset));
          }
        }
        promise.resolve(std::move(out));
      });
      promise("asset", [photos, readable](const folly::dynamic &args, JsPromise promise) {
        auto id = stringArg(args, 0);
        auto asset = id && readable() ? photos->asset(*id) : std::nullopt;
        promise.resolve(asset ? infoOf(*asset) : folly::dynamic(nullptr));
      });
      promise("uri", [photos, readable](const folly::dynamic &args, JsPromise promise) {
        auto id = stringArg(args, 0);
        if (!id || !readable()) {
          promise.resolve(nullptr);
          return;
        }
        photos->fileUri(*id, [promise](std::optional<std::string> uri) {
          promise.resolve(uri ? folly::dynamic(*uri) : folly::dynamic(nullptr));
        });
      });
      promise("albums", [photos, readable](const folly::dynamic &, JsPromise promise) {
        folly::dynamic out = folly::dynamic::array();
        if (readable()) {
          for (const auto &album : photos->albums()) {
            out.push_back(albumOf(album));
          }
        }
        promise.resolve(std::move(out));
      });
      promise("albumAssets", [photos, readable](const folly::dynamic &args, JsPromise promise) {
        folly::dynamic out = folly::dynamic::array();
        auto id = stringArg(args, 0);
        if (id && readable()) {
          for (const auto &asset : photos->albumAssets(*id)) {
            out.push_back(asset);
          }
        }
        promise.resolve(std::move(out));
      });

      auto refused = [](JsPromise &promise) {
        promise.reject("MediaLibrary: the app has no access to the photo library");
      };
      promise("createAsset", [photos, writable, refused](const folly::dynamic &args, JsPromise promise) {
        auto uri = stringArg(args, 0);
        if (!writable(true)) {
          refused(promise);
          return;
        }
        if (!uri) {
          promise.reject("MediaLibrary: Asset.create takes a file's uri");
          return;
        }
        photos->create(pathOf(*uri), stringArg(args, 1), [promise](std::optional<std::string> id, const std::string &error) {
          if (id) {
            promise.resolve(*id);
          } else {
            promise.reject("MediaLibrary: " + (error.empty() ? std::string("the file was not saved") : error));
          }
        });
      });
      promise("deleteAssets", [photos, writable, refused](const folly::dynamic &args, JsPromise promise) {
        if (!writable(false)) {
          refused(promise);
          return;
        }
        photos->remove(idsOf(args, 0), [promise](const std::string &error) { settle(promise, error); });
      });
      promise("setFavorite", [photos, writable, refused](const folly::dynamic &args, JsPromise promise) {
        auto id = stringArg(args, 0);
        if (!writable(false) || !id) {
          refused(promise);
          return;
        }
        photos->setFavorite(*id, flagArg(args, 1), [promise](const std::string &error) { settle(promise, error); });
      });
      promise("createAlbum", [photos, writable, refused](const folly::dynamic &args, JsPromise promise) {
        auto name = stringArg(args, 0);
        if (!writable(false) || !name) {
          refused(promise);
          return;
        }
        photos->createAlbum(*name, idsOf(args, 1), flagArg(args, 2), [promise](std::optional<PhotoLibrary::Album> album, const std::string &error) {
          if (album) {
            promise.resolve(albumOf(*album));
          } else {
            promise.reject("MediaLibrary: " + error);
          }
        });
      });
      promise("deleteAlbums", [photos, writable, refused](const folly::dynamic &args, JsPromise promise) {
        if (!writable(false)) {
          refused(promise);
          return;
        }
        photos->deleteAlbums(idsOf(args, 0), flagArg(args, 1), [promise](const std::string &error) { settle(promise, error); });
      });
      for (bool add : {true, false}) {
        promise(add ? "addAssets" : "removeAssets", [photos, writable, refused, add](const folly::dynamic &args, JsPromise promise) {
          auto album = stringArg(args, 0);
          if (!writable(false) || !album) {
            refused(promise);
            return;
          }
          photos->changeAlbum(*album, idsOf(args, 1), add, [promise](const std::string &error) { settle(promise, error); });
        });
      }
      sync("startObserving", [this, readable](const folly::dynamic &) {
        std::lock_guard lock(mutex);
        // Watching reads the library, so only once the user allowed it.
        if (!stopWatching && readable()) {
          stopWatching = library->watch([this] { emit("ngNativeMediaLibrary", folly::dynamic::object("hasIncrementalChanges", false)); });
        }
        return folly::dynamic(stopWatching != nullptr);
      });
    }

    ~MediaLibrary() override {
      std::lock_guard lock(mutex);
      if (stopWatching) {
        stopWatching();
      }
    }
  };
  return std::make_shared<MediaLibrary>(std::move(library), noPrompts);
}

std::shared_ptr<NativeModule> makeImagePickerModule(std::shared_ptr<PhotoLibrary> library, bool noPrompts) {
  struct ImagePicker : NativeModule {
    ImagePicker(std::shared_ptr<PhotoLibrary> photos, bool noPrompts) : NativeModule("NgNativeImagePicker") {
      Permissions permissions{photos, noPrompts};
      promise("getMediaLibraryPermissionsAsync", [permissions](const folly::dynamic &args, JsPromise promise) {
        permissions.get(flagArg(args, 0), std::move(promise));
      });
      promise("requestMediaLibraryPermissionsAsync", [permissions](const folly::dynamic &args, JsPromise promise) {
        permissions.request(flagArg(args, 0), std::move(promise));
      });
      // No system camera to open on macOS.
      auto noCamera = [](const folly::dynamic &, JsPromise promise) { promise.resolve(permissionOf(Access::Denied)); };
      promise("getCameraPermissionsAsync", noCamera);
      promise("requestCameraPermissionsAsync", noCamera);
      folly::dynamic canceled = folly::dynamic::object("canceled", true)("assets", nullptr);
      promise("launchCameraAsync", [canceled](const folly::dynamic &, JsPromise promise) { promise.resolve(canceled); });
      promise("launchImageLibraryAsync", [photos, noPrompts, canceled](const folly::dynamic &args, JsPromise promise) {
        if (noPrompts) {
          promise.resolve(canceled);
          return;
        }
        auto options = args.empty() || !args[0].isObject() ? folly::dynamic::object() : args[0];
        photos->pick(options, [promise, canceled](std::optional<std::vector<PhotoLibrary::Picked>> picked) {
          if (!picked || picked->empty()) {
            promise.resolve(canceled);
            return;
          }
          folly::dynamic assets = folly::dynamic::array();
          for (const auto &asset : *picked) {
            assets.push_back(folly::dynamic::object("uri", asset.uri)("assetId", asset.assetId ? folly::dynamic(*asset.assetId) : folly::dynamic(nullptr))(
                "width", asset.width)("height", asset.height)("type", asset.type)("fileName", asset.fileName)("fileSize", asset.fileSize)(
                "mimeType", asset.mimeType)("duration", orNull(asset.duration))("exif", nullptr)("base64", nullptr));
          }
          promise.resolve(folly::dynamic::object("canceled", false)("assets", std::move(assets)));
        });
      });
    }
  };
  return std::make_shared<ImagePicker>(std::move(library), noPrompts);
}

} // namespace ngn
