#include "ngn/expo-image.h"

#include "ngn/bytes.h"
#include "ngn/desktop-view-props.h"
#include "ngn/download.h"
#include "ngn/file-system.h"

#include <react/renderer/components/view/conversions.h>
#include <react/renderer/core/propsConversions.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <numbers>

using namespace facebook::react;

namespace ngn {

const char ExpoImageComponentName[] = "ViewManagerAdapter_ExpoImage";

ExpoImageProps::ExpoImageProps(const PropsParserContext &context, const ExpoImageProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      source(convertRawProp(context, rawProps, "source", sourceProps.source, nullptr)),
      placeholder(convertRawProp(context, rawProps, "placeholder", sourceProps.placeholder, nullptr)),
      contentFit(convertRawProp(context, rawProps, "contentFit", sourceProps.contentFit, std::string{"cover"})),
      placeholderContentFit(
          convertRawProp(context, rawProps, "placeholderContentFit", sourceProps.placeholderContentFit, std::string{"scale-down"})),
      contentPosition(convertRawProp(context, rawProps, "contentPosition", sourceProps.contentPosition, nullptr)),
      transition(convertRawProp(context, rawProps, "transition", sourceProps.transition, nullptr)),
      blurRadius(convertRawProp(context, rawProps, "blurRadius", sourceProps.blurRadius, 0.0)),
      tintColor(convertRawProp(context, rawProps, "tintColor", sourceProps.tintColor, {})),
      cachePolicy(convertRawProp(context, rawProps, "cachePolicy", sourceProps.cachePolicy, std::string{"disk"})),
      recyclingKey(convertRawProp(context, rawProps, "recyclingKey", sourceProps.recyclingKey, {})) {}

namespace {

double numberIn(const folly::dynamic &object, const char *key) {
  const auto *value = object.isObject() ? object.get_ptr(key) : nullptr;
  return value != nullptr && value->isNumber() ? value->asDouble() : 0;
}

std::string textIn(const folly::dynamic &object, const char *key) {
  const auto *value = object.isObject() ? object.get_ptr(key) : nullptr;
  return value != nullptr && value->isString() ? value->asString() : "";
}

// A contentPosition value as a distance in points, or as a fraction of the space left.
struct PositionValue {
  std::optional<double> distance;
  std::optional<double> factor;
};

PositionValue positionValue(const folly::dynamic &position, const char *key) {
  const auto *value = position.isObject() ? position.get_ptr(key) : nullptr;
  if (value == nullptr) {
    return {};
  }
  if (value->isNumber()) {
    return {.distance = value->asDouble()};
  }
  if (value->isString()) {
    const auto &text = value->asString();
    try {
      if (!text.empty() && text.back() == '%') {
        return {.factor = std::stod(text.substr(0, text.size() - 1)) / 100};
      }
      return {.distance = std::stod(text)};
    } catch (const std::exception &) {
      return {};
    }
  }
  return {};
}

// expo-image's offset from the centre along one axis.
double offsetAlong(const folly::dynamic &position, const char *start, const char *end, double content, double container) {
  double diff = container - content;
  auto first = positionValue(position, start), last = positionValue(position, end);
  if (first.distance) {
    return -diff / 2 + *first.distance;
  }
  if (last.distance) {
    return diff / 2 - *last.distance;
  }
  if (first.factor) {
    return -diff / 2 + diff * *first.factor;
  }
  if (last.factor) {
    return diff / 2 - diff * *last.factor;
  }
  return 0;
}

int decode83(const std::string &text, size_t from, size_t to, bool &ok) {
  static const std::string digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
  int value = 0;
  for (size_t i = from; i < to; i++) {
    auto digit = digits.find(text[i]);
    if (digit == std::string::npos) {
      ok = false;
      return 0;
    }
    value = value * 83 + static_cast<int>(digit);
  }
  return value;
}

double sRGBToLinear(int value) {
  double v = value / 255.0;
  return v <= 0.04045 ? v / 12.92 : std::pow((v + 0.055) / 1.055, 2.4);
}

uint8_t linearToSRGB(double value) {
  double v = std::clamp(value, 0.0, 1.0);
  double out = v <= 0.0031308 ? v * 12.92 * 255 + 0.5 : (1.055 * std::pow(v, 1 / 2.4) - 0.055) * 255 + 0.5;
  return static_cast<uint8_t>(std::clamp(out, 0.0, 255.0));
}

double signPow(double value, double exponent) {
  return std::copysign(std::pow(std::abs(value), exponent), value);
}

std::string percentDecoded(const std::string &text) {
  std::string out;
  for (size_t i = 0; i < text.size(); i++) {
    if (text[i] == '%' && i + 2 < text.size() && std::isxdigit(static_cast<unsigned char>(text[i + 1])) &&
        std::isxdigit(static_cast<unsigned char>(text[i + 2]))) {
      out += static_cast<char>(std::stoi(text.substr(i + 1, 2), nullptr, 16));
      i += 2;
    } else {
      out += text[i];
    }
  }
  return out;
}

uint64_t fnv1a(const std::string &text, uint64_t seed) {
  uint64_t hash = seed;
  for (unsigned char c : text) {
    hash = (hash ^ c) * 1099511628211ULL;
  }
  return hash;
}

std::string contentsOf(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    return {};
  }
  return {std::istreambuf_iterator<char>(in), {}};
}

} // namespace

std::vector<ImageSourceRef> imageSources(const folly::dynamic &list) {
  std::vector<ImageSourceRef> sources;
  auto add = [&](const folly::dynamic &entry) {
    auto uri = textIn(entry, "uri");
    if (uri.empty()) {
      return;
    }
    ImageSourceRef source{.uri = uri, .width = numberIn(entry, "width"), .height = numberIn(entry, "height"), .cacheKey = textIn(entry, "cacheKey")};
    if (const auto *headers = entry.get_ptr("headers"); headers != nullptr && headers->isObject()) {
      for (const auto &[name, value] : headers->items()) {
        if (name.isString() && value.isString()) {
          source.headers.emplace_back(name.asString(), value.asString());
        }
      }
    }
    sources.push_back(std::move(source));
  };
  if (list.isArray()) {
    for (const auto &entry : list) {
      add(entry);
    }
  } else if (list.isObject()) {
    add(list);
  }
  return sources;
}

std::optional<ImageSourceRef> bestImageSource(const std::vector<ImageSourceRef> &sources, double width, double height, double scale) {
  if (sources.empty() || width <= 0 || height <= 0) {
    return std::nullopt;
  }
  if (sources.size() == 1) {
    return sources.front();
  }
  double target = width * height * scale * scale;
  std::optional<ImageSourceRef> best;
  double bestFit = INFINITY;
  for (const auto &source : sources) {
    double fit = std::abs(1 - (source.width * source.height / target));
    if (fit < bestFit) {
      best = source;
      bestFit = fit;
    }
  }
  return best;
}

ImageRect placeImage(const std::string &fit, const folly::dynamic &position, std::pair<double, double> image, std::pair<double, double> box) {
  auto [width, height] = image;
  auto [boxWidth, boxHeight] = box;
  if (width <= 0 || height <= 0) {
    return {};
  }
  if (fit == "fill") {
    return {0, 0, boxWidth, boxHeight};
  }
  double scale = 1;
  double fitScale = std::min(boxWidth / width, boxHeight / height);
  if (fit == "contain") {
    scale = fitScale;
  } else if (fit == "scale-down") {
    scale = std::min(1.0, fitScale);
  } else if (fit != "none") {
    scale = std::max(boxWidth / width, boxHeight / height);
  }
  width *= scale;
  height *= scale;
  double x = (boxWidth - width) / 2 + offsetAlong(position, "left", "right", width, boxWidth);
  double y = (boxHeight - height) / 2 + offsetAlong(position, "top", "bottom", height, boxHeight);
  return {x, y, width, height};
}

ImageTransition imageTransition(const folly::dynamic &transition) {
  ImageTransition out;
  if (transition.isNumber()) {
    out.duration = transition.asDouble();
  } else if (transition.isObject()) {
    out.duration = numberIn(transition, "duration");
    if (auto effect = textIn(transition, "effect"); !effect.empty()) {
      out.effect = effect;
    }
    if (auto timing = textIn(transition, "timing"); !timing.empty()) {
      out.timing = timing;
    }
  }
  return out;
}

std::optional<DecodedPixels> decodeBlurhash(const std::string &hash, int width, int height, double punch) {
  if (hash.size() < 6 || width <= 0 || height <= 0) {
    return std::nullopt;
  }
  bool ok = true;
  int sizeFlag = decode83(hash, 0, 1, ok);
  int numY = sizeFlag / 9 + 1, numX = sizeFlag % 9 + 1;
  if (!ok || hash.size() != static_cast<size_t>(4 + 2 * numX * numY)) {
    return std::nullopt;
  }
  double maxValue = (decode83(hash, 1, 2, ok) + 1) / 166.0 * punch;
  std::vector<std::array<double, 3>> colors(static_cast<size_t>(numX * numY));
  int dc = decode83(hash, 2, 6, ok);
  colors[0] = {sRGBToLinear(dc >> 16), sRGBToLinear((dc >> 8) & 255), sRGBToLinear(dc & 255)};
  for (size_t i = 1; i < colors.size(); i++) {
    int ac = decode83(hash, 4 + i * 2, 6 + i * 2, ok);
    colors[i] = {
        signPow((ac / (19 * 19) - 9) / 9.0, 2) * maxValue,
        signPow(((ac / 19) % 19 - 9) / 9.0, 2) * maxValue,
        signPow((ac % 19 - 9) / 9.0, 2) * maxValue,
    };
  }
  if (!ok) {
    return std::nullopt;
  }
  DecodedPixels out{width, height, std::vector<uint8_t>(static_cast<size_t>(width * height * 4))};
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      double r = 0, g = 0, b = 0;
      for (int j = 0; j < numY; j++) {
        for (int i = 0; i < numX; i++) {
          double basis = std::cos(std::numbers::pi * x * i / width) * std::cos(std::numbers::pi * y * j / height);
          const auto &color = colors[static_cast<size_t>(i + j * numX)];
          r += color[0] * basis;
          g += color[1] * basis;
          b += color[2] * basis;
        }
      }
      auto *pixel = &out.rgba[static_cast<size_t>((y * width + x) * 4)];
      pixel[0] = linearToSRGB(r);
      pixel[1] = linearToSRGB(g);
      pixel[2] = linearToSRGB(b);
      pixel[3] = 255;
    }
  }
  return out;
}

std::optional<DecodedPixels> decodeThumbhash(const std::string &bytes) {
  if (bytes.size() < 5) {
    return std::nullopt;
  }
  auto at = [&](size_t i) -> int { return i < bytes.size() ? static_cast<unsigned char>(bytes[i]) : 0; };
  int header24 = at(0) | (at(1) << 8) | (at(2) << 16);
  int header16 = at(3) | (at(4) << 8);
  double lDc = (header24 & 63) / 63.0;
  double pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  double qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  double lScale = ((header24 >> 18) & 31) / 31.0;
  bool hasAlpha = (header24 >> 23) != 0;
  double pScale = ((header16 >> 3) & 63) / 63.0;
  double qScale = ((header16 >> 9) & 63) / 63.0;
  bool landscape = (header16 >> 15) != 0;
  int lx = std::max(3, landscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  int ly = std::max(3, landscape ? header16 & 7 : (hasAlpha ? 5 : 7));
  double aDc = hasAlpha ? (at(5) & 15) / 15.0 : 1;
  double aScale = (at(5) >> 4) / 15.0;
  size_t acStart = hasAlpha ? 6 : 5;
  size_t acIndex = 0;
  auto channel = [&](int nx, int ny, double scale) {
    std::vector<double> ac;
    for (int cy = 0; cy < ny; cy++) {
      for (int cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++, acIndex++) {
        ac.push_back((((at(acStart + (acIndex >> 1)) >> ((acIndex & 1) << 2)) & 15) / 7.5 - 1) * scale);
      }
    }
    return ac;
  };
  auto lAc = channel(lx, ly, lScale);
  auto pAc = channel(3, 3, pScale * 1.25);
  auto qAc = channel(3, 3, qScale * 1.25);
  auto aAc = hasAlpha ? channel(5, 5, aScale) : std::vector<double>{};
  // The aspect ratio from the header's own component counts, before the minimum of 3.
  int rx = landscape ? (hasAlpha ? 5 : 7) : at(3) & 7;
  int ry = landscape ? at(3) & 7 : (hasAlpha ? 5 : 7);
  double ratio = ry > 0 ? static_cast<double>(rx) / ry : 1;
  int width = static_cast<int>(std::round(ratio > 1 ? 32 : 32 * ratio));
  int height = static_cast<int>(std::round(ratio > 1 ? 32 / ratio : 32));
  if (width <= 0 || height <= 0) {
    return std::nullopt;
  }
  DecodedPixels out{width, height, std::vector<uint8_t>(static_cast<size_t>(width * height * 4))};
  std::vector<double> fx(static_cast<size_t>(std::max(lx, hasAlpha ? 5 : 3)));
  std::vector<double> fy(static_cast<size_t>(std::max(ly, hasAlpha ? 5 : 3)));
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      double l = lDc, p = pDc, q = qDc, a = aDc;
      for (size_t cx = 0; cx < fx.size(); cx++) {
        fx[cx] = std::cos(std::numbers::pi / width * (x + 0.5) * static_cast<double>(cx));
      }
      for (size_t cy = 0; cy < fy.size(); cy++) {
        fy[cy] = std::cos(std::numbers::pi / height * (y + 0.5) * static_cast<double>(cy));
      }
      size_t j = 0;
      for (int cy = 0; cy < ly; cy++) {
        double fy2 = fy[static_cast<size_t>(cy)] * 2;
        for (int cx = cy ? 0 : 1; cx * ly < lx * (ly - cy); cx++, j++) {
          l += lAc[j] * fx[static_cast<size_t>(cx)] * fy2;
        }
      }
      j = 0;
      for (int cy = 0; cy < 3; cy++) {
        double fy2 = fy[static_cast<size_t>(cy)] * 2;
        for (int cx = cy ? 0 : 1; cx < 3 - cy; cx++, j++) {
          double f = fx[static_cast<size_t>(cx)] * fy2;
          p += pAc[j] * f;
          q += qAc[j] * f;
        }
      }
      if (hasAlpha) {
        j = 0;
        for (int cy = 0; cy < 5; cy++) {
          double fy2 = fy[static_cast<size_t>(cy)] * 2;
          for (int cx = cy ? 0 : 1; cx < 5 - cy; cx++, j++) {
            a += aAc[j] * fx[static_cast<size_t>(cx)] * fy2;
          }
        }
      }
      double b = l - 2.0 / 3 * p;
      double r = (3 * l - b + q) / 2;
      double g = r - q;
      auto *pixel = &out.rgba[static_cast<size_t>((y * width + x) * 4)];
      pixel[0] = static_cast<uint8_t>(std::max(0.0, 255 * std::min(1.0, r)));
      pixel[1] = static_cast<uint8_t>(std::max(0.0, 255 * std::min(1.0, g)));
      pixel[2] = static_cast<uint8_t>(std::max(0.0, 255 * std::min(1.0, b)));
      pixel[3] = static_cast<uint8_t>(std::max(0.0, 255 * std::min(1.0, a)));
    }
  }
  return out;
}

std::optional<DecodedPixels> decodeHashUri(const std::string &uri, double width, double height) {
  if (uri.rfind("blurhash:/", 0) == 0) {
    auto rest = uri.substr(10);
    auto hash = percentDecoded(rest.substr(0, rest.find('/')));
    // expo-image decodes a blurhash at its width and height, 16 by default.
    int w = width > 0 ? static_cast<int>(width) : 16, h = height > 0 ? static_cast<int>(height) : 16;
    return decodeBlurhash(hash, std::min(w, 128), std::min(h, 128));
  }
  if (uri.rfind("thumbhash:/", 0) == 0) {
    auto text = percentDecoded(uri.substr(11));
    std::replace(text.begin(), text.end(), '\\', '/');
    auto bytes = base64Decode(text);
    return bytes ? decodeThumbhash(*bytes) : std::nullopt;
  }
  return std::nullopt;
}

ImageCache::ImageCache(std::string folder, size_t memoryLimit) : folder_(std::move(folder)), limit_(memoryLimit) {}

std::string ImageCache::diskPath(const std::string &key) const {
  char name[40];
  std::snprintf(name, sizeof name, "%016llx%016llx", static_cast<unsigned long long>(fnv1a(key, 14695981039346656037ULL)),
                static_cast<unsigned long long>(fnv1a(key, 1099511628211ULL)));
  return folder_ + "/" + name;
}

std::optional<std::pair<std::string, ImageCache::Hit>> ImageCache::find(const std::string &key, const std::string &policy) {
  if (policy == "memory" || policy == "memory-disk") {
    std::lock_guard lock(mutex_);
    if (auto found = byKey_.find(key); found != byKey_.end()) {
      recent_.splice(recent_.begin(), recent_, found->second);
      return std::pair{found->second->second, Hit::Memory};
    }
  }
  if (policy == "disk" || policy == "memory-disk") {
    auto path = diskPath(key);
    std::error_code ignored;
    if (std::filesystem::exists(path, ignored)) {
      auto bytes = contentsOf(path);
      if (policy == "memory-disk") {
        remember(key, bytes);
      }
      return std::pair{std::move(bytes), Hit::Disk};
    }
  }
  return std::nullopt;
}

void ImageCache::remember(const std::string &key, const std::string &bytes) {
  std::lock_guard lock(mutex_);
  if (auto found = byKey_.find(key); found != byKey_.end()) {
    bytes_ -= found->second->second.size();
    recent_.erase(found->second);
    byKey_.erase(found);
  }
  if (bytes.size() > limit_) {
    return;
  }
  recent_.emplace_front(key, bytes);
  byKey_[key] = recent_.begin();
  bytes_ += bytes.size();
  while (bytes_ > limit_ && !recent_.empty()) {
    bytes_ -= recent_.back().second.size();
    byKey_.erase(recent_.back().first);
    recent_.pop_back();
  }
}

void ImageCache::store(const std::string &key, const std::string &bytes, const std::string &policy) {
  if (policy == "memory" || policy == "memory-disk") {
    remember(key, bytes);
  }
  if (policy == "disk" || policy == "memory-disk") {
    std::error_code ignored;
    std::filesystem::create_directories(folder_, ignored);
    auto path = diskPath(key);
    auto partial = path + ".part";
    {
      std::ofstream out(partial, std::ios::binary | std::ios::trunc);
      out << bytes;
    }
    std::filesystem::rename(partial, path, ignored);
  }
}

void ImageCache::clearMemory() {
  std::lock_guard lock(mutex_);
  recent_.clear();
  byKey_.clear();
  bytes_ = 0;
}

bool ImageCache::clearDisk() {
  std::error_code error;
  std::filesystem::remove_all(folder_, error);
  return !error;
}

size_t ImageCache::memoryBytes() const {
  std::lock_guard lock(mutex_);
  return bytes_;
}

const char *cacheTypeName(ImageCache::Hit hit) {
  switch (hit) {
    case ImageCache::Hit::Memory:
      return "memory";
    case ImageCache::Hit::Disk:
      return "disk";
    default:
      return "none";
  }
}

void loadImageBytes(
    const std::shared_ptr<Http> &http,
    const std::shared_ptr<ImageCache> &cache,
    const ImageSourceRef &source,
    const std::string &policy,
    std::function<void(std::string, ImageCache::Hit, const std::string &)> done) {
  std::string url;
  bool remote = source.uri.rfind("http://", 0) == 0 || source.uri.rfind("https://", 0) == 0;
  if (auto path = pathOfUri(source.uri)) {
    url = fileUri(*path);
  } else if (remote || source.uri.rfind("data:", 0) == 0) {
    url = source.uri;
  } else {
    done("", ImageCache::Hit::None, source.uri + " is not a file, data or http(s) uri");
    return;
  }
  auto key = source.cacheKey.empty() ? source.uri : source.cacheKey;
  if (remote && cache) {
    if (auto found = cache->find(key, policy)) {
      done(std::move(found->first), found->second, "");
      return;
    }
  }
  HttpRequest request{.url = url};
  for (const auto &[name, value] : source.headers) {
    request.headers.emplace_back(name, value);
  }
  fetchBytes(http, std::move(request), [cache, key, policy, remote, done](std::string body, const std::string &error) {
    if (!error.empty()) {
      done("", ImageCache::Hit::None, error);
      return;
    }
    if (remote && cache) {
      cache->store(key, body, policy);
    }
    done(std::move(body), ImageCache::Hit::None, "");
  });
}

} // namespace ngn
