// The user's photo library, as NgNativeMediaLibrary and NgNativeImagePicker read it, over a
// PhotoLibrary, which the AppKit backend implements with PhotoKit (and PHPicker for the picker).
//
// NgNativeMediaLibrary, what @ng-native/expo's MediaLibrary calls on expo-media-library (the JS
// adapter, desktop-media-library.ts, builds its Asset, Album and Query classes over these):
// - getPermissionsAsync(writeOnly), requestPermissionsAsync(writeOnly): expo's permission shape,
//   with `accessPrivileges`. Only what is undetermined is asked, never with `noPrompts`, and the
//   library asks only when the app's Info.plist explains why. presentPermissionsPicker(): resolves;
//   macOS has no limited library.
// - query(query) -> [id], queryMetadata(query) -> [AssetMetadata], where a query is {filters:
//   [{field, op, value}], sort: [{key, ascending}], limit, offset, album}; asset(id) -> AssetInfo
//   or null; uri(id) -> the asset's file url. Without read access they read nothing: [], null.
// - createAsset(fileUri, albumId) -> id, deleteAssets(ids), setFavorite(id, favorite),
//   albums() -> [AlbumMetadata], albumAssets(albumId) -> [id], createAlbum(name, ids, move),
//   deleteAlbums(ids, deleteAssets), addAssets(albumId, ids), removeAssets(albumId, ids). A write
//   without access rejects.
// - startObserving(): `ngNativeMediaLibrary` events {hasIncrementalChanges: false} as the library
//   changes, once read access is granted; asked before that, it watches nothing.
//
// NgNativeImagePicker, expo-image-picker's library half: launchImageLibraryAsync(options) ->
// {canceled, assets}, the system's photo picker over the key window, which needs no permission;
// get/requestMediaLibraryPermissionsAsync() as above; launchCameraAsync() answers canceled and
// the camera permissions denied, since macOS has no system camera to open.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class PhotoLibrary {
 public:
  enum class Access { NotDetermined, Denied, Restricted, Granted, Limited };

  struct Filter {
    // An AssetField: creationTime, modificationTime, mediaType, width, height, duration,
    // isFavorite or mediaSubtypes.
    std::string field;
    // eq, within, gt, gte, lt, lte or contains.
    std::string op;
    folly::dynamic value;
  };
  struct Query {
    std::vector<Filter> filters;
    std::vector<std::pair<std::string, bool>> sort;
    std::optional<int> limit;
    int offset{0};
    std::optional<std::string> album;
  };
  struct Asset {
    std::string id;
    std::string filename;
    // image, video, audio or unknown.
    std::string mediaType{"unknown"};
    double width{0};
    double height{0};
    // Seconds for a video; milliseconds since 1970 for the times.
    std::optional<double> duration;
    std::optional<double> creationTime;
    std::optional<double> modificationTime;
    bool favorite{false};
    std::vector<std::string> subtypes;
    std::optional<std::pair<double, double>> location;
    bool inCloud{false};
  };
  struct Album {
    std::string id;
    std::string title;
    // album or smartAlbum.
    std::string type{"album"};
  };
  struct Picked {
    // A file url in the app's caches.
    std::string uri;
    std::string fileName;
    std::string mimeType;
    std::string type;
    double width{0};
    double height{0};
    std::optional<double> duration;
    double fileSize{0};
    std::optional<std::string> assetId;
  };

  virtual ~PhotoLibrary() = default;
  virtual Access access(bool writeOnly) = 0;
  // Shows the OS's prompt and answers once the user decides; answers the access as it is, with no
  // prompt, when the app's Info.plist gives no reason to ask. Any thread.
  virtual void requestAccess(bool writeOnly, std::function<void(Access)> done) = 0;

  // Read only with read access.
  virtual std::vector<Asset> assets(const Query &query) = 0;
  virtual std::optional<Asset> asset(const std::string &id) = 0;
  // The asset's file, once PhotoKit has it on disk (which may download it). Any thread.
  virtual void fileUri(const std::string &id, std::function<void(std::optional<std::string>)> done) = 0;
  virtual std::vector<Album> albums() = 0;
  virtual std::vector<std::string> albumAssets(const std::string &album) = 0;
  // Changes, answered with how to stop watching. Only with read access.
  virtual std::function<void()> watch(std::function<void()> changed) = 0;

  // Writes: each answers an error, empty when it worked. Any thread.
  using Done = std::function<void(const std::string &error)>;
  virtual void create(const std::string &path, const std::optional<std::string> &album,
                      std::function<void(std::optional<std::string> id, const std::string &error)> done) = 0;
  virtual void remove(const std::vector<std::string> &ids, Done done) = 0;
  virtual void setFavorite(const std::string &id, bool favorite, Done done) = 0;
  virtual void createAlbum(const std::string &name, const std::vector<std::string> &ids, bool move,
                           std::function<void(std::optional<Album>, const std::string &error)> done) = 0;
  virtual void deleteAlbums(const std::vector<std::string> &ids, bool deleteAssets, Done done) = 0;
  virtual void changeAlbum(const std::string &album, const std::vector<std::string> &ids, bool add, Done done) = 0;

  // The system's photo picker; null when the user cancels or there is no window to show it on.
  virtual void pick(const folly::dynamic &options, std::function<void(std::optional<std::vector<Picked>>)> done) = 0;
};

// The query a JS Query describes; throws for a field or operator the library has none of.
PhotoLibrary::Query photoQueryOf(const folly::dynamic &query);

std::shared_ptr<NativeModule> makeMediaLibraryModule(std::shared_ptr<PhotoLibrary> library, bool noPrompts);
std::shared_ptr<NativeModule> makeImagePickerModule(std::shared_ptr<PhotoLibrary> library, bool noPrompts);

} // namespace ngn
