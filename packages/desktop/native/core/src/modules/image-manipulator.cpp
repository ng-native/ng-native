#include "ngn/image-manipulator.h"

#include "ngn/bytes.h"
#include "ngn/crypto.h"
#include "ngn/file-system.h"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <random>
#include <stdexcept>
#include <variant>

#include <folly/json.h>

namespace ngn {

namespace {

constexpr double kPi = 3.14159265358979323846;

double number(const folly::dynamic &object, const char *key) {
  if (!object.isObject()) {
    return 0;
  }
  auto found = object.get_ptr(key);
  return found && found->isNumber() ? found->asDouble() : 0;
}

int whole(double value) {
  return std::max(1, static_cast<int>(std::lround(value)));
}

ImageStep resized(ImageSize size) {
  return {.kind = ImageStep::Kind::Resize, .size = size};
}

ImageStep resize(ImageSize current, const folly::dynamic &options) {
  double width = number(options, "width");
  double height = number(options, "height");
  if (width <= 0 && height <= 0) {
    throw std::invalid_argument("resize needs a width or a height above 0");
  }
  double ratio = static_cast<double>(current.width) / current.height;
  if (width <= 0) {
    width = height * ratio;
  } else if (height <= 0) {
    height = width / ratio;
  }
  return resized({whole(width), whole(height)});
}

ImageStep rotate(ImageSize current, double degrees) {
  double radians = degrees * kPi / 180;
  double c = std::abs(std::cos(radians));
  double s = std::abs(std::sin(radians));
  // UIKit's frame of the rotated view, rounded down; the nudge keeps 90 degrees from losing a pixel.
  int width = static_cast<int>(std::floor(current.width * c + current.height * s + 1e-9));
  int height = static_cast<int>(std::floor(current.width * s + current.height * c + 1e-9));
  return {.kind = ImageStep::Kind::Rotate, .size = {std::max(1, width), std::max(1, height)}, .degrees = degrees};
}

std::string formatted(double value) {
  auto text = std::to_string(value);
  text.erase(text.find_last_not_of('0') + 1);
  return text.back() == '.' ? text + "0" : text;
}

ImageStep crop(ImageSize current, const folly::dynamic &rect) {
  double x = number(rect, "originX"), y = number(rect, "originY");
  double width = number(rect, "width"), height = number(rect, "height");
  if (x > current.width || y > current.height || width > current.width || height > current.height) {
    throw std::invalid_argument(
        "Invalid crop options has been passed. Please make sure the requested crop rectangle is inside source image");
  }
  // CGImage's cropping: the rectangle grown to whole pixels, then cut to the image.
  double left = std::max(0.0, std::floor(x)), top = std::max(0.0, std::floor(y));
  double right = std::min<double>(current.width, std::ceil(x + width));
  double bottom = std::min<double>(current.height, std::ceil(y + height));
  if (right <= left || bottom <= top) {
    throw std::invalid_argument(
        "Cropping the image to rectangle (x: " + formatted(x) + ", y: " + formatted(y) + ", width: " + formatted(width) +
        ", height: " + formatted(height) + ") has failed");
  }
  return {
      .kind = ImageStep::Kind::Crop,
      .size = {static_cast<int>(right - left), static_cast<int>(bottom - top)},
      .x = static_cast<int>(left),
      .y = static_cast<int>(top)};
}

ImageStep flip(ImageSize current, const folly::dynamic &direction) {
  auto name = direction.isString() ? direction.asString() : "";
  if (name != "vertical" && name != "horizontal") {
    throw std::invalid_argument("flip is vertical or horizontal, not " + (name.empty() ? folly::toJson(direction) : name));
  }
  return {.kind = name == "vertical" ? ImageStep::Kind::FlipVertical : ImageStep::Kind::FlipHorizontal, .size = current};
}

bool isHttpOrData(const std::string &uri) {
  return uri.rfind("http://", 0) == 0 || uri.rfind("https://", 0) == 0 || uri.rfind("data:", 0) == 0;
}

std::string extensionOf(const std::string &format) {
  return format == "png" ? ".png" : format == "webp" ? ".webp" : ".jpg";
}

std::string newName(const std::string &format) {
  static std::mutex mutex;
  static std::random_device device;
  std::lock_guard lock(mutex);
  std::string bytes(16, '\0');
  for (auto &byte : bytes) {
    byte = static_cast<char>(device() & 0xff);
  }
  auto id = uuidV4(bytes);
  std::transform(id.begin(), id.end(), id.begin(), [](unsigned char c) { return std::toupper(c); });
  return id + extensionOf(format);
}

struct Saving {
  std::string format{"jpeg"};
  double compress{1};
  bool base64{false};
};

// The save options, or why they cannot be used.
std::variant<Saving, std::string> savingOf(const folly::dynamic &options, ImageCodec &codec) {
  Saving saving;
  if (!options.isObject()) {
    return saving;
  }
  if (auto format = options.get_ptr("format"); format && format->isString()) {
    saving.format = format->asString() == "jpg" ? "jpeg" : format->asString();
  }
  if (saving.format != "jpeg" && saving.format != "png" && saving.format != "webp") {
    return "the format is jpeg, png or webp, not " + saving.format;
  }
  if (!codec.encodes(saving.format)) {
    return std::string("this Mac cannot write WebP images; save as jpeg or png");
  }
  if (auto compress = options.get_ptr("compress"); compress && compress->isNumber()) {
    saving.compress = std::clamp(compress->asDouble(), 0.0, 1.0);
  }
  if (auto base64 = options.get_ptr("base64"); base64 && base64->isBool()) {
    saving.base64 = base64->asBool();
  }
  return saving;
}

} // namespace

std::vector<ImageStep> planImageEdits(ImageSize source, const folly::dynamic &actions, const folly::dynamic &loadOptions) {
  std::vector<ImageStep> steps;
  auto current = source;
  auto add = [&](ImageStep step) {
    current = step.size;
    steps.push_back(step);
  };
  double maxWidth = number(loadOptions, "maxWidth"), maxHeight = number(loadOptions, "maxHeight");
  double scale = std::min(
      maxWidth > 0 ? maxWidth / current.width : 1.0, maxHeight > 0 ? maxHeight / current.height : 1.0);
  if (scale < 1) {
    add(resized({whole(current.width * scale), whole(current.height * scale)}));
  }
  if (!actions.isArray()) {
    return steps;
  }
  for (const auto &action : actions) {
    if (!action.isObject()) {
      throw std::invalid_argument("An action is one of resize, rotate, flip or crop");
    }
    if (auto options = action.get_ptr("resize")) {
      add(resize(current, *options));
    } else if (auto degrees = action.get_ptr("rotate"); degrees && degrees->isNumber()) {
      add(rotate(current, degrees->asDouble()));
    } else if (auto direction = action.get_ptr("flip")) {
      add(flip(current, *direction));
    } else if (auto rect = action.get_ptr("crop")) {
      add(crop(current, *rect));
    } else {
      throw std::invalid_argument("An action is one of resize, rotate, flip or crop");
    }
  }
  return steps;
}

std::shared_ptr<NativeModule> makeImageManipulatorModule(std::shared_ptr<ImageCodec> codec, std::shared_ptr<Http> http, std::string folder) {
  struct ImageManipulator : NativeModule {
    // Reads the image `args[0]` names and plans `args[1]` and `args[2]` on it, then hands the
    // bytes and the steps on, or rejects.
    using Planned = std::function<void(std::string bytes, std::vector<ImageStep> steps, ImageSize size, JsPromise promise)>;

    ImageManipulator(std::shared_ptr<ImageCodec> codec, std::shared_ptr<Http> http, std::string folder)
        : NativeModule("NgNativeImageManipulator") {
      auto withPlan = [codec, http](const folly::dynamic &args, JsPromise promise, Planned next) {
        auto uri = !args.empty() && args[0].isString() ? args[0].asString() : "";
        auto fail = [promise](const std::string &why) { promise.reject("ImageManipulator: Could not load the image: " + why); };
        std::string url;
        if (auto path = pathOfUri(uri)) {
          url = fileUri(*path);
        } else if (isHttpOrData(uri)) {
          url = uri;
        } else {
          fail(uri + " is not a file, data or http(s) uri");
          return;
        }
        folly::dynamic actions = args.size() > 1 ? args[1] : folly::dynamic(nullptr);
        folly::dynamic load = args.size() > 2 ? args[2] : folly::dynamic(nullptr);
        struct Read {
          uint16_t status{0};
          std::string bytes;
          std::unique_ptr<HttpTask> task;
        };
        auto read = std::make_shared<Read>();
        auto label = uri.rfind("data:", 0) == 0 ? std::string("the data uri") : uri;
        read->task = http->send(
            {.url = url},
            {.onResponse = [read](const HttpResponse &response) { read->status = response.status; },
             .onData = [read](std::string chunk, int64_t) { read->bytes += chunk; },
             .onComplete =
                 [read, codec, actions, load, label, fail, promise, next](const std::string &error, bool) {
                   auto keep = std::move(read->task);
                   if (!error.empty()) {
                     fail(error);
                     return;
                   }
                   if (read->status >= 400) {
                     fail("HTTP " + std::to_string(read->status) + " for " + label);
                     return;
                   }
                   auto size = codec->size(read->bytes);
                   if (!size || size->width <= 0 || size->height <= 0) {
                     fail(label + " is not an image");
                     return;
                   }
                   std::vector<ImageStep> steps;
                   try {
                     steps = planImageEdits(*size, actions, load);
                   } catch (const std::invalid_argument &invalid) {
                     promise.reject(std::string("ImageManipulator: ") + invalid.what());
                     return;
                   }
                   auto result = steps.empty() ? *size : steps.back().size;
                   next(std::move(read->bytes), std::move(steps), result, promise);
                 }});
      };

      promise("renderAsync", [withPlan](const folly::dynamic &args, JsPromise promise) {
        withPlan(args, std::move(promise), [](std::string, std::vector<ImageStep>, ImageSize size, JsPromise promise) {
          promise.resolve(folly::dynamic::object("width", size.width)("height", size.height));
        });
      });

      promise("saveAsync", [withPlan, codec, folder](const folly::dynamic &args, JsPromise promise) {
        auto saving = savingOf(args.size() > 3 ? args[3] : folly::dynamic(nullptr), *codec);
        if (auto *why = std::get_if<std::string>(&saving)) {
          promise.reject("ImageManipulator: " + *why);
          return;
        }
        auto options = std::get<Saving>(saving);
        withPlan(args, std::move(promise), [codec, folder, options](std::string bytes, std::vector<ImageStep> steps, ImageSize size, JsPromise promise) {
          std::string encoded;
          try {
            encoded = codec->render(bytes, steps, options.format, options.compress);
          } catch (const std::exception &error) {
            promise.reject(std::string("ImageManipulator: ") + error.what());
            return;
          }
          std::error_code ignored;
          std::filesystem::create_directories(folder, ignored);
          auto path = folder + "/" + newName(options.format);
          std::ofstream out(path, std::ios::binary | std::ios::trunc);
          out << encoded;
          out.close();
          if (!out) {
            promise.reject("ImageManipulator: Writing image data to the file has failed: " + path);
            return;
          }
          folly::dynamic result = folly::dynamic::object("uri", fileUri(path))("width", size.width)("height", size.height);
          if (options.base64) {
            result["base64"] = base64Encode(encoded);
          }
          promise.resolve(std::move(result));
        });
      });
    }
  };
  return std::make_shared<ImageManipulator>(std::move(codec), std::move(http), std::move(folder));
}

} // namespace ngn
