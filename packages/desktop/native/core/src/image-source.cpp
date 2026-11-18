#include "ngn/image-source.h"

#include "ngn/download.h"

#include <cmath>
#include <limits>

using facebook::react::ImageResizeMode;
using facebook::react::ImageSource;

namespace ngn {

std::optional<ImageSource> pickImageSource(const std::vector<ImageSource> &sources, double screenScale) {
  std::optional<ImageSource> best;
  double distance = std::numeric_limits<double>::infinity();
  for (const auto &source : sources) {
    if (source.uri.empty()) {
      continue;
    }
    double d = std::abs(source.scale - screenScale);
    if (d < distance) {
      distance = d;
      best = source;
    }
  }
  return best;
}

bool sameImageRequest(const ImageSource &a, const ImageSource &b) {
  return a.uri == b.uri && a.cache == b.cache && a.method == b.method && a.headers == b.headers && a.body == b.body;
}

const char *imageContentFit(ImageResizeMode mode) {
  switch (mode) {
    case ImageResizeMode::Cover:
      return "cover";
    case ImageResizeMode::Contain:
      return "contain";
    case ImageResizeMode::Center:
      return "none";
    default:
      return "fill";
  }
}

void loadImageSource(
    const std::shared_ptr<Http> &http,
    const std::shared_ptr<ImageCache> &cache,
    const FileAccess *files,
    const ImageSource &source,
    std::function<void(std::string, const std::string &)> done) {
  using Cache = ImageSource::CacheStategy;
  const std::string &uri = source.uri;
  bool remote = uri.starts_with("http://") || uri.starts_with("https://");
  std::string url = uri;
  std::shared_ptr<FileAccess::Use> use;
  if (uri.starts_with('/') || isFileScheme(uri)) {
    try {
      auto readable = readableSource(files, uri);
      url = readable.uri;
      use = std::move(readable.use);
    } catch (const FileRefused &refused) {
      done("", refused.what());
      return;
    }
  } else if (!remote && !uri.starts_with("data:")) {
    done("", "Invalid image URL: " + uri);
    return;
  }
  bool cacheable = cache && remote && (source.method.empty() || source.method == "GET") && source.body.empty();
  if (cacheable && source.cache != Cache::Reload) {
    if (auto found = cache->find(uri, "memory")) {
      done(std::move(found->first), "");
      return;
    }
  }
  if (source.cache == Cache::OnlyIfCached) {
    done("", "The image at " + uri + " is not in the cache");
    return;
  }
  HttpRequest request{.url = url, .body = source.body};
  if (!source.method.empty()) {
    request.method = source.method;
  }
  for (const auto &[name, value] : source.headers) {
    request.headers.emplace_back(name, value);
  }
  // The pick holding a file stays open until it is read.
  auto keep = cacheable ? cache : nullptr;
  fetchBytes(http, std::move(request), [keep, uri, use, done](std::string body, const std::string &error) {
    if (!error.empty()) {
      done("", "Could not load the image at " + uri + " (" + error + ")");
      return;
    }
    if (keep) {
      keep->store(uri, body, "memory");
    }
    done(std::move(body), "");
  });
}

} // namespace ngn
