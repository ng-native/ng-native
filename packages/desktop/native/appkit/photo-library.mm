#include "photo-library.h"

#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <Photos/Photos.h>
#import <PhotosUI/PhotosUI.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#import <objc/runtime.h>

#include <map>
#include <mutex>

using Access = ngn::PhotoLibrary::Access;

// Calls a block as the library changes.
@interface NGNPhotoObserver : NSObject <PHPhotoLibraryChangeObserver>
@property(nonatomic, copy) void (^changed)(void);
@end

@implementation NGNPhotoObserver
- (void)photoLibraryDidChange:(PHChange *)changeInstance {
  self.changed();
}
@end

// Answers the picker once, with the files it copied.
@interface NGNPickerDelegate : NSObject <PHPickerViewControllerDelegate>
@property(nonatomic, copy) NSString *folder;
@property(nonatomic, copy) void (^finished)(NSArray<NSDictionary *> *picked);
@property(nonatomic, strong) NSWindow *sheet;
@end

namespace {

std::string text(NSString *value) {
  return value != nil ? std::string(value.UTF8String) : "";
}

NSString *ns(const std::string &value) {
  return [NSString stringWithUTF8String:value.c_str()];
}

Access accessOf(PHAuthorizationStatus status) {
  switch (status) {
    case PHAuthorizationStatusAuthorized: return Access::Granted;
    case PHAuthorizationStatusLimited: return Access::Limited;
    case PHAuthorizationStatusDenied: return Access::Denied;
    case PHAuthorizationStatusRestricted: return Access::Restricted;
    default: return Access::NotDetermined;
  }
}

// Whether the app's Info.plist says why it asks: without the string the OS ends the app.
bool explains(bool writeOnly) {
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  NSArray *keys = writeOnly ? @[ @"NSPhotoLibraryAddUsageDescription", @"NSPhotoLibraryUsageDescription" ] : @[ @"NSPhotoLibraryUsageDescription" ];
  for (NSString *key in keys) {
    if ([info[key] isKindOfClass:NSString.class] && [info[key] length] > 0) {
      return true;
    }
  }
  return false;
}

const std::map<std::string, NSString *> kKeys{{"creationTime", @"creationDate"}, {"modificationTime", @"modificationDate"},
                                              {"mediaType", @"mediaType"},       {"width", @"pixelWidth"},
                                              {"height", @"pixelHeight"},        {"duration", @"duration"},
                                              {"isFavorite", @"favorite"},       {"mediaSubtypes", @"mediaSubtypes"}};

const std::map<std::string, PHAssetMediaType> kTypes{{"image", PHAssetMediaTypeImage}, {"video", PHAssetMediaTypeVideo},
                                                     {"audio", PHAssetMediaTypeAudio}, {"unknown", PHAssetMediaTypeUnknown}};

const std::vector<std::pair<std::string, PHAssetMediaSubtype>> kSubtypes{
    {"panorama", PHAssetMediaSubtypePhotoPanorama}, {"hdr", PHAssetMediaSubtypePhotoHDR},
    {"screenshot", PHAssetMediaSubtypePhotoScreenshot}, {"livePhoto", PHAssetMediaSubtypePhotoLive},
    {"depthEffect", PHAssetMediaSubtypePhotoDepthEffect}, {"stream", PHAssetMediaSubtypeVideoStreamed},
    {"highFrameRate", PHAssetMediaSubtypeVideoHighFrameRate}, {"timelapse", PHAssetMediaSubtypeVideoTimelapse},
    {"videoCinematic", PHAssetMediaSubtypeVideoCinematic}};

// A JS value as the predicate compares it: dates from milliseconds, media types by number.
id valueOf(const std::string &field, const folly::dynamic &value) {
  if (field == "creationTime" || field == "modificationTime") {
    return [NSDate dateWithTimeIntervalSince1970:(value.isNumber() ? value.asDouble() : 0) / 1000];
  }
  if (field == "mediaType") {
    auto found = value.isString() ? kTypes.find(value.asString()) : kTypes.end();
    return @(found != kTypes.end() ? found->second : PHAssetMediaTypeUnknown);
  }
  if (field == "isFavorite") {
    return @(value.isBool() && value.asBool());
  }
  return @(value.isNumber() ? value.asDouble() : 0);
}

NSPredicate *predicateOf(const std::vector<ngn::PhotoLibrary::Filter> &filters) {
  NSMutableArray<NSPredicate *> *parts = [NSMutableArray array];
  for (const auto &filter : filters) {
    NSString *key = kKeys.at(filter.field);
    if (filter.op == "contains") {
      PHAssetMediaSubtype bit = 0;
      for (const auto &[name, subtype] : kSubtypes) {
        if (filter.value.isString() && name == filter.value.asString()) {
          bit = subtype;
        }
      }
      [parts addObject:[NSPredicate predicateWithFormat:@"(mediaSubtypes & %lu) != 0", static_cast<unsigned long>(bit)]];
    } else if (filter.op == "within") {
      NSMutableArray *values = [NSMutableArray array];
      if (filter.value.isArray()) {
        for (const auto &value : filter.value) {
          [values addObject:valueOf(filter.field, value)];
        }
      }
      [parts addObject:[NSPredicate predicateWithFormat:@"%K IN %@", key, values]];
    } else {
      static const std::map<std::string, NSString *> ops{{"eq", @"=="}, {"gt", @">"}, {"gte", @">="}, {"lt", @"<"}, {"lte", @"<="}};
      NSString *format = [NSString stringWithFormat:@"%%K %@ %%@", ops.at(filter.op)];
      [parts addObject:[NSPredicate predicateWithFormat:format, key, valueOf(filter.field, filter.value)]];
    }
  }
  return parts.count > 0 ? [NSCompoundPredicate andPredicateWithSubpredicates:parts] : nil;
}

std::optional<double> ms(NSDate *date) {
  return date != nil ? std::optional(date.timeIntervalSince1970 * 1000) : std::nullopt;
}

ngn::PhotoLibrary::Asset assetOf(PHAsset *asset) {
  ngn::PhotoLibrary::Asset out;
  out.id = text(asset.localIdentifier);
  out.filename = text([PHAssetResource assetResourcesForAsset:asset].firstObject.originalFilename);
  for (const auto &[name, type] : kTypes) {
    if (type == asset.mediaType) {
      out.mediaType = name;
    }
  }
  out.width = static_cast<double>(asset.pixelWidth);
  out.height = static_cast<double>(asset.pixelHeight);
  if (asset.mediaType == PHAssetMediaTypeVideo || asset.mediaType == PHAssetMediaTypeAudio) {
    out.duration = asset.duration;
  }
  out.creationTime = ms(asset.creationDate);
  out.modificationTime = ms(asset.modificationDate);
  out.favorite = asset.favorite;
  for (const auto &[name, subtype] : kSubtypes) {
    if ((asset.mediaSubtypes & subtype) != 0) {
      out.subtypes.push_back(name);
    }
  }
  if (asset.location != nil) {
    out.location = std::pair(asset.location.coordinate.latitude, asset.location.coordinate.longitude);
  }
  return out;
}

ngn::PhotoLibrary::Album albumOf(PHAssetCollection *collection) {
  return {text(collection.localIdentifier), text(collection.localizedTitle),
          collection.assetCollectionType == PHAssetCollectionTypeSmartAlbum ? "smartAlbum" : "album"};
}

NSArray<PHAsset *> *assetsWithIds(const std::vector<std::string> &ids) {
  NSMutableArray *identifiers = [NSMutableArray array];
  for (const auto &id : ids) {
    [identifiers addObject:ns(id)];
  }
  NSMutableArray<PHAsset *> *out = [NSMutableArray array];
  [[PHAsset fetchAssetsWithLocalIdentifiers:identifiers options:nil] enumerateObjectsUsingBlock:^(PHAsset *asset, NSUInteger, BOOL *) {
    [out addObject:asset];
  }];
  return out;
}

PHAssetCollection *collectionWithId(const std::string &id) {
  return [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[ ns(id) ] options:nil].firstObject;
}

// Runs changes in the library, answering the error, empty when they were made.
void change(void (^changes)(void), std::function<void(const std::string &)> done) {
  auto answer = std::make_shared<std::function<void(const std::string &)>>(std::move(done));
  [PHPhotoLibrary.sharedPhotoLibrary performChanges:changes
                                  completionHandler:^(BOOL success, NSError *error) {
                                    (*answer)(success ? "" : error != nil ? text(error.localizedDescription) : "the library refused the change");
                                  }];
}

class PhotoKitLibrary final : public ngn::PhotoLibrary {
 public:
  explicit PhotoKitLibrary(std::string caches) : caches_(std::move(caches)) {}

  Access access(bool writeOnly) override {
    return accessOf([PHPhotoLibrary authorizationStatusForAccessLevel:writeOnly ? PHAccessLevelAddOnly : PHAccessLevelReadWrite]);
  }

  void requestAccess(bool writeOnly, std::function<void(Access)> done) override {
    if (!explains(writeOnly) || access(writeOnly) != Access::NotDetermined) {
      done(access(writeOnly));
      return;
    }
    auto answer = std::make_shared<std::function<void(Access)>>(std::move(done));
    [PHPhotoLibrary requestAuthorizationForAccessLevel:writeOnly ? PHAccessLevelAddOnly : PHAccessLevelReadWrite
                                               handler:^(PHAuthorizationStatus status) { (*answer)(accessOf(status)); }];
  }

  std::vector<Asset> assets(const Query &query) override {
    PHFetchOptions *options = [PHFetchOptions new];
    options.predicate = predicateOf(query.filters);
    NSMutableArray *sort = [NSMutableArray array];
    for (const auto &[key, ascending] : query.sort) {
      [sort addObject:[NSSortDescriptor sortDescriptorWithKey:kKeys.at(key) ascending:ascending]];
    }
    options.sortDescriptors = sort.count > 0 ? sort : nil;
    if (query.limit) {
      options.fetchLimit = static_cast<NSUInteger>(std::max(0, *query.limit + query.offset));
    }
    PHFetchResult<PHAsset *> *result;
    if (query.album) {
      PHAssetCollection *album = collectionWithId(*query.album);
      if (album == nil) {
        return {};
      }
      result = [PHAsset fetchAssetsInAssetCollection:album options:options];
    } else {
      result = [PHAsset fetchAssetsWithOptions:options];
    }
    std::vector<Asset> out;
    for (NSUInteger index = static_cast<NSUInteger>(query.offset); index < result.count; index++) {
      out.push_back(assetOf([result objectAtIndex:index]));
    }
    return out;
  }

  std::optional<Asset> asset(const std::string &id) override {
    PHAsset *found = assetsWithIds({id}).firstObject;
    return found != nil ? std::optional(assetOf(found)) : std::nullopt;
  }

  void fileUri(const std::string &id, std::function<void(std::optional<std::string>)> done) override {
    PHAsset *found = assetsWithIds({id}).firstObject;
    if (found == nil) {
      done(std::nullopt);
      return;
    }
    auto answer = std::make_shared<std::function<void(std::optional<std::string>)>>(std::move(done));
    PHContentEditingInputRequestOptions *options = [PHContentEditingInputRequestOptions new];
    options.networkAccessAllowed = YES;
    [found requestContentEditingInputWithOptions:options
                               completionHandler:^(PHContentEditingInput *input, NSDictionary *) {
                                 NSURL *url = input.fullSizeImageURL;
                                 if (url == nil && [input.audiovisualAsset isKindOfClass:AVURLAsset.class]) {
                                   url = ((AVURLAsset *)input.audiovisualAsset).URL;
                                 }
                                 (*answer)(url != nil ? std::optional(text(url.absoluteString)) : std::nullopt);
                               }];
  }

  std::vector<Album> albums() override {
    __block std::vector<Album> out;
    for (auto type : {PHAssetCollectionTypeAlbum, PHAssetCollectionTypeSmartAlbum}) {
      [[PHAssetCollection fetchAssetCollectionsWithType:type subtype:PHAssetCollectionSubtypeAny options:nil]
          enumerateObjectsUsingBlock:^(PHAssetCollection *collection, NSUInteger, BOOL *) {
            out.push_back(albumOf(collection));
          }];
    }
    return out;
  }

  std::vector<std::string> albumAssets(const std::string &album) override {
    __block std::vector<std::string> out;
    PHAssetCollection *collection = collectionWithId(album);
    if (collection != nil) {
      [[PHAsset fetchAssetsInAssetCollection:collection options:nil] enumerateObjectsUsingBlock:^(PHAsset *asset, NSUInteger, BOOL *) {
        out.push_back(text(asset.localIdentifier));
      }];
    }
    return out;
  }

  std::function<void()> watch(std::function<void()> changed) override {
    NGNPhotoObserver *observer = [NGNPhotoObserver new];
    auto call = std::make_shared<std::function<void()>>(std::move(changed));
    observer.changed = ^{
      (*call)();
    };
    [PHPhotoLibrary.sharedPhotoLibrary registerChangeObserver:observer];
    return [observer] { [PHPhotoLibrary.sharedPhotoLibrary unregisterChangeObserver:observer]; };
  }

  void create(const std::string &path, const std::optional<std::string> &album,
              std::function<void(std::optional<std::string>, const std::string &)> done) override {
    NSURL *file = [NSURL fileURLWithPath:ns(path)];
    UTType *type = [UTType typeWithFilenameExtension:file.pathExtension];
    bool video = type != nil && [type conformsToType:UTTypeMovie];
    PHAssetCollection *collection = album ? collectionWithId(*album) : nil;
    auto created = std::make_shared<std::string>();
    auto answer = std::make_shared<std::function<void(std::optional<std::string>, const std::string &)>>(std::move(done));
    change(
        ^{
          PHAssetChangeRequest *request = video ? [PHAssetChangeRequest creationRequestForAssetFromVideoAtFileURL:file]
                                                : [PHAssetChangeRequest creationRequestForAssetFromImageAtFileURL:file];
          *created = text(request.placeholderForCreatedAsset.localIdentifier);
          if (collection != nil && request.placeholderForCreatedAsset != nil) {
            [[PHAssetCollectionChangeRequest changeRequestForAssetCollection:collection] addAssets:@[ request.placeholderForCreatedAsset ]];
          }
        },
        [answer, created](const std::string &error) {
          (*answer)(error.empty() && !created->empty() ? std::optional(*created) : std::nullopt, error);
        });
  }

  void remove(const std::vector<std::string> &ids, Done done) override {
    NSArray *assets = assetsWithIds(ids);
    change(^{ [PHAssetChangeRequest deleteAssets:assets]; }, std::move(done));
  }

  void setFavorite(const std::string &id, bool favorite, Done done) override {
    PHAsset *asset = assetsWithIds({id}).firstObject;
    change(^{ [PHAssetChangeRequest changeRequestForAsset:asset].favorite = favorite; }, std::move(done));
  }

  void createAlbum(const std::string &name, const std::vector<std::string> &ids, bool,
                   std::function<void(std::optional<Album>, const std::string &)> done) override {
    NSArray *assets = assetsWithIds(ids);
    auto created = std::make_shared<std::string>();
    auto answer = std::make_shared<std::function<void(std::optional<Album>, const std::string &)>>(std::move(done));
    change(
        ^{
          PHAssetCollectionChangeRequest *request = [PHAssetCollectionChangeRequest creationRequestForAssetCollectionWithTitle:ns(name)];
          [request addAssets:assets];
          *created = text(request.placeholderForCreatedAssetCollection.localIdentifier);
        },
        [answer, created, name](const std::string &error) {
          if (!error.empty() || created->empty()) {
            (*answer)(std::nullopt, error.empty() ? "the album was not made" : error);
            return;
          }
          (*answer)(Album{*created, name, "album"}, "");
        });
  }

  void deleteAlbums(const std::vector<std::string> &ids, bool deleteAssets, Done done) override {
    NSMutableArray<PHAssetCollection *> *collections = [NSMutableArray array];
    NSMutableArray<PHAsset *> *assets = [NSMutableArray array];
    for (const auto &id : ids) {
      if (PHAssetCollection *collection = collectionWithId(id)) {
        [collections addObject:collection];
        if (deleteAssets) {
          [[PHAsset fetchAssetsInAssetCollection:collection options:nil] enumerateObjectsUsingBlock:^(PHAsset *asset, NSUInteger, BOOL *) {
            [assets addObject:asset];
          }];
        }
      }
    }
    change(
        ^{
          [PHAssetCollectionChangeRequest deleteAssetCollections:collections];
          if (assets.count > 0) {
            [PHAssetChangeRequest deleteAssets:assets];
          }
        },
        std::move(done));
  }

  void changeAlbum(const std::string &album, const std::vector<std::string> &ids, bool add, Done done) override {
    PHAssetCollection *collection = collectionWithId(album);
    if (collection == nil) {
      done("there is no album with that id");
      return;
    }
    NSArray *assets = assetsWithIds(ids);
    change(
        ^{
          PHAssetCollectionChangeRequest *request = [PHAssetCollectionChangeRequest changeRequestForAssetCollection:collection];
          if (add) {
            [request addAssets:assets];
          } else {
            [request removeAssets:assets];
          }
        },
        std::move(done));
  }

  void pick(const folly::dynamic &options, std::function<void(std::optional<std::vector<Picked>>)> done) override {
    auto answer = std::make_shared<std::function<void(std::optional<std::vector<Picked>>)>>(std::move(done));
    PHPickerConfiguration *configuration = [[PHPickerConfiguration alloc] initWithPhotoLibrary:PHPhotoLibrary.sharedPhotoLibrary];
    auto multiple = options.getDefault("allowsMultipleSelection", false);
    auto limit = options.getDefault("selectionLimit", 0);
    configuration.selectionLimit = multiple.isBool() && multiple.asBool() ? (limit.isNumber() ? static_cast<NSInteger>(limit.asDouble()) : 0) : 1;
    NSMutableArray<PHPickerFilter *> *filters = [NSMutableArray array];
    auto types = options.getDefault("mediaTypes", folly::dynamic::array("images"));
    for (const auto &type : types.isArray() ? types : folly::dynamic::array(types)) {
      auto name = type.isString() ? type.asString() : "";
      if (name == "images" || name == "Images" || name == "All" || name == "all") {
        [filters addObject:PHPickerFilter.imagesFilter];
      }
      if (name == "videos" || name == "Videos" || name == "All" || name == "all") {
        [filters addObject:PHPickerFilter.videosFilter];
      }
      if (name == "livePhotos") {
        [filters addObject:PHPickerFilter.livePhotosFilter];
      }
    }
    configuration.filter = filters.count > 0 ? [PHPickerFilter anyFilterMatchingSubfilters:filters] : nil;
    NSString *folder = ns(caches_ + "/ImagePicker");
    dispatch_async(dispatch_get_main_queue(), ^{
      NSWindow *window = NSApp.keyWindow != nil ? NSApp.keyWindow : NSApp.mainWindow;
      if (window == nil) {
        (*answer)(std::nullopt);
        return;
      }
      PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:configuration];
      NGNPickerDelegate *delegate = [NGNPickerDelegate new];
      delegate.folder = folder;
      delegate.finished = ^(NSArray<NSDictionary *> *picked) {
        if (picked == nil) {
          (*answer)(std::nullopt);
          return;
        }
        std::vector<Picked> out;
        for (NSDictionary *item in picked) {
          Picked asset;
          asset.uri = text(item[@"uri"]);
          asset.fileName = text(item[@"fileName"]);
          asset.mimeType = text(item[@"mimeType"]);
          asset.type = text(item[@"type"]);
          asset.width = [item[@"width"] doubleValue];
          asset.height = [item[@"height"] doubleValue];
          asset.fileSize = [item[@"fileSize"] doubleValue];
          if (item[@"duration"] != nil) {
            asset.duration = [item[@"duration"] doubleValue];
          }
          if (item[@"assetId"] != nil) {
            asset.assetId = text(item[@"assetId"]);
          }
          out.push_back(asset);
        }
        (*answer)(out);
      };
      picker.delegate = delegate;
      // The delegate lives as long as the picker's sheet.
      objc_setAssociatedObject(picker, @selector(delegate), delegate, OBJC_ASSOCIATION_RETAIN);
      NSWindow *sheet = [NSWindow windowWithContentViewController:picker];
      delegate.sheet = sheet;
      [window beginSheet:sheet completionHandler:nil];
    });
  }

 private:
  std::string caches_;
};

} // namespace

@implementation NGNPickerDelegate

- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results {
  [self.sheet.sheetParent endSheet:self.sheet];
  if (results.count == 0) {
    self.finished(nil);
    return;
  }
  [NSFileManager.defaultManager createDirectoryAtPath:self.folder withIntermediateDirectories:YES attributes:nil error:nil];
  NSMutableArray<NSDictionary *> *picked = [NSMutableArray array];
  dispatch_group_t group = dispatch_group_create();
  NSLock *lock = [NSLock new];
  for (PHPickerResult *result in results) {
    NSItemProvider *provider = result.itemProvider;
    BOOL video = [provider hasItemConformingToTypeIdentifier:UTTypeMovie.identifier];
    NSString *typeId = video ? UTTypeMovie.identifier : UTTypeImage.identifier;
    dispatch_group_enter(group);
    [provider loadFileRepresentationForTypeIdentifier:typeId
                                    completionHandler:^(NSURL *url, NSError *) {
                                      // The file is gone once this returns: copied into the app's caches.
                                      NSURL *copy = nil;
                                      if (url != nil) {
                                        copy = [NSURL fileURLWithPath:[self.folder stringByAppendingPathComponent:[NSString stringWithFormat:@"%@.%@", NSUUID.UUID.UUIDString, url.pathExtension]]];
                                        if (![NSFileManager.defaultManager copyItemAtURL:url toURL:copy error:nil]) {
                                          copy = nil;
                                        }
                                      }
                                      if (copy != nil) {
                                        NSMutableDictionary *item = [NSMutableDictionary dictionary];
                                        item[@"uri"] = copy.absoluteString;
                                        item[@"fileName"] = url.lastPathComponent;
                                        UTType *type = [UTType typeWithFilenameExtension:copy.pathExtension];
                                        item[@"mimeType"] = type.preferredMIMEType != nil ? type.preferredMIMEType : @"application/octet-stream";
                                        item[@"type"] = video ? @"video" : @"image";
                                        id size = [NSFileManager.defaultManager attributesOfItemAtPath:copy.path error:nil][NSFileSize];
                                        item[@"fileSize"] = size != nil ? size : @0;
                                        if (result.assetIdentifier != nil) {
                                          item[@"assetId"] = result.assetIdentifier;
                                        }
                                        if (video) {
                                          AVURLAsset *asset = [AVURLAsset URLAssetWithURL:copy options:nil];
                                          AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
                                          CGSize size = CGSizeApplyAffineTransform(track.naturalSize, track.preferredTransform);
                                          item[@"width"] = @(fabs(size.width));
                                          item[@"height"] = @(fabs(size.height));
                                          item[@"duration"] = @(CMTimeGetSeconds(asset.duration) * 1000);
                                        } else if (CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)copy, nil)) {
                                          NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, nil));
                                          CFRelease(source);
                                          item[@"width"] = properties[(id)kCGImagePropertyPixelWidth] != nil ? properties[(id)kCGImagePropertyPixelWidth] : @0;
                                          item[@"height"] = properties[(id)kCGImagePropertyPixelHeight] != nil ? properties[(id)kCGImagePropertyPixelHeight] : @0;
                                        }
                                        [lock lock];
                                        [picked addObject:item];
                                        [lock unlock];
                                      }
                                      dispatch_group_leave(group);
                                    }];
  }
  dispatch_group_notify(group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    self.finished(picked);
  });
}

@end

namespace ngn::appkit {

std::shared_ptr<PhotoLibrary> makePhotoLibrary(const std::string &caches) {
  return std::make_shared<PhotoKitLibrary>(caches);
}

} // namespace ngn::appkit
