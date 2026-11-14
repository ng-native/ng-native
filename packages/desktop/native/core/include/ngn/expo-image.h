// `<expo-image>` on a desktop host: expo-image's view (ViewManagerAdapter_ExpoImage, the component
// `registerExpoViews('expo-image')` commits) as a Fabric component of the desktop's own.
//
// The core reads the props and decides what the backend draws: which `source` fits the view
// (expo-image's getBestSource), where the image goes in the view (`contentFit` and
// `contentPosition`, CSS's object-fit and object-position as expo-image's iOS view applies them),
// the transition, and the placeholder, decoding a blurhash or a thumbhash to pixels. It fetches an
// image's bytes through the backend's HTTP client and keeps them in an ImageCache, in memory and on
// disk by `cachePolicy`, so the backend only decodes and draws. The view sends expo-image's
// events: loadStart, progress, load ({cacheType, source: {url, width, height, mediaType,
// isAnimated}}), error ({error}) and display.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/network.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/graphics/Color.h>

#include <folly/dynamic.h>

#include <cstdint>
#include <functional>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

extern const char ExpoImageComponentName[];

class ExpoImageProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  ExpoImageProps() = default;
  ExpoImageProps(
      const facebook::react::PropsParserContext &context,
      const ExpoImageProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  // Lists of {uri, width, height, headers, cacheKey}, as expo-image's JavaScript hands them down.
  folly::dynamic source;
  folly::dynamic placeholder;
  std::string contentFit{"cover"};
  std::string placeholderContentFit{"scale-down"};
  // {top, right, bottom, left}, each points or a percentage string; null for the centre.
  folly::dynamic contentPosition;
  // A duration in milliseconds, or {duration, effect, timing}.
  folly::dynamic transition;
  double blurRadius{0};
  facebook::react::SharedColor tintColor;
  // none, disk, memory or memory-disk.
  std::string cachePolicy{"disk"};
  std::string recyclingKey;
};

using ExpoImageShadowNode =
    facebook::react::ConcreteViewShadowNode<ExpoImageComponentName, ExpoImageProps, facebook::react::ViewEventEmitter>;
using ExpoImageComponentDescriptor = facebook::react::ConcreteComponentDescriptor<ExpoImageShadowNode>;

struct ImageSourceRef {
  std::string uri;
  double width{0};
  double height{0};
  std::vector<std::pair<std::string, std::string>> headers;
  std::string cacheKey;
  bool operator==(const ImageSourceRef &) const = default;
};

// Each entry of a `source` list (or a lone object), in order; entries with no uri are left out.
std::vector<ImageSourceRef> imageSources(const folly::dynamic &list);

// The source whose pixel count is nearest the view's at `scale`, as expo-image picks: the only
// one when there is one, and nothing for a view with no size.
std::optional<ImageSourceRef> bestImageSource(const std::vector<ImageSourceRef> &sources, double width, double height, double scale);

struct ImageRect {
  double x{0}, y{0}, width{0}, height{0};
  bool operator==(const ImageRect &) const = default;
};

// Where an image of `image` size draws in a box of `box` size, from its top left, by `contentFit`
// (cover, contain, fill, none, scale-down) and `contentPosition`.
ImageRect placeImage(
    const std::string &contentFit, const folly::dynamic &contentPosition, std::pair<double, double> image, std::pair<double, double> box);

struct ImageTransition {
  double duration{0};
  // cross-dissolve, flip-from-left, flip-from-right, flip-from-top, flip-from-bottom,
  // curl-up, curl-down, or none.
  std::string effect{"cross-dissolve"};
  std::string timing{"ease-in-out"};
  bool operator==(const ImageTransition &) const = default;
};
// expo-image's transition from its prop: a number is the duration in milliseconds.
ImageTransition imageTransition(const folly::dynamic &transition);

struct DecodedPixels {
  int width{0};
  int height{0};
  // RGBA, 8 bits a channel, unpremultiplied, rows from the top.
  std::vector<uint8_t> rgba;
};

// A blurhash decoded to `width` by `height` pixels, as the reference decoder does. Nothing for a
// hash that is not one.
std::optional<DecodedPixels> decodeBlurhash(const std::string &hash, int width, int height, double punch = 1);
// A thumbhash's bytes decoded to its own small size (32 points on its longer side), as the
// reference decoder does. Nothing for bytes too short to be one.
std::optional<DecodedPixels> decodeThumbhash(const std::string &bytes);

// A placeholder's uri decoded, when it is a `blurhash:/<hash>/<w>/<h>` or `thumbhash:/<base64>`
// uri, as expo-image's JavaScript writes them.
std::optional<DecodedPixels> decodeHashUri(const std::string &uri, double width = 0, double height = 0);

// Images' bytes by key, in memory (least recently used dropped past `memoryLimit` bytes) and on
// disk in `folder`, each by `cachePolicy`. Any thread.
class ImageCache {
 public:
  enum class Hit { None, Memory, Disk };
  ImageCache(std::string folder, size_t memoryLimit);
  // The bytes kept for `key` where `policy` looks (memory first), or nothing.
  std::optional<std::pair<std::string, Hit>> find(const std::string &key, const std::string &policy);
  void store(const std::string &key, const std::string &bytes, const std::string &policy);
  void clearMemory();
  bool clearDisk();
  // The file `key`'s bytes are kept in on disk.
  std::string diskPath(const std::string &key) const;
  size_t memoryBytes() const;

 private:
  void remember(const std::string &key, const std::string &bytes);
  std::string folder_;
  size_t limit_;
  mutable std::mutex mutex_;
  std::list<std::pair<std::string, std::string>> recent_;
  std::map<std::string, std::list<std::pair<std::string, std::string>>::iterator> byKey_;
  size_t bytes_{0};
};

// expo-image's name for a cache hit: none, memory or disk.
const char *cacheTypeName(ImageCache::Hit hit);

// Reads `source`'s bytes: from the cache by its cacheKey (or uri) when `policy` keeps it, else
// through `http` with its headers, then into the cache. `file:` and `data:` sources are read and
// never cached. Answers once, on any thread: the bytes and the hit, or an error.
void loadImageBytes(
    const std::shared_ptr<Http> &http,
    const std::shared_ptr<ImageCache> &cache,
    const ImageSourceRef &source,
    const std::string &policy,
    std::function<void(std::string bytes, ImageCache::Hit hit, const std::string &error)> done);

} // namespace ngn
