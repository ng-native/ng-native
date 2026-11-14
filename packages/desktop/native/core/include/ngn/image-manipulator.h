// NgNativeImageManipulator: what @ng-native/expo's ImageEditor calls on expo-image-manipulator,
// over an ImageCodec, which the AppKit backend implements with ImageIO and Core Graphics. A
// TurboModule cannot hand back expo's context and image objects, so the desktop loader keeps a
// context's actions in JavaScript and sends them whole:
//
// - renderAsync(uri, actions, loadOptions): {width, height}, the size the actions give, read from
//   the file's header without decoding it.
// - saveAsync(uri, actions, loadOptions, saveOptions): expo's ImageResult, {uri, width, height,
//   base64?}, the edited image written to a new file in `<caches>/ImageManipulator`.
//
// `uri` is a `file:` uri, an absolute path, a `data:` uri or an `http(s):` url (an asset on the
// dev server), all read through the backend's HTTP client. `actions` are expo's: `resize`,
// `rotate` (degrees, clockwise), `flip` and `crop`, applied in order to the image the right way
// up, sized and checked as expo's iOS module does. `loadOptions` is `{maxWidth, maxHeight}`, which
// scales a larger image down to fit first. `saveOptions` is `{format: jpeg | png | webp, compress
// (0 to 1, JPEG only), base64}`; a format ImageIO cannot write here (WebP) refuses the save.
#pragma once

#include "ngn/native-module.h"
#include "ngn/network.h"

#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct ImageSize {
  int width{0};
  int height{0};
  bool operator==(const ImageSize &) const = default;
};

// One edit, with the size of the image it gives.
struct ImageStep {
  enum class Kind { Resize, Rotate, FlipHorizontal, FlipVertical, Crop };
  Kind kind{Kind::Resize};
  ImageSize size;
  // Rotate: clockwise.
  double degrees{0};
  // Crop: the rectangle's origin in pixels from the top left; its size is `size`.
  int x{0};
  int y{0};
};

// The steps `actions` make of an upright image of `source` size, `loadOptions` first. Throws
// std::invalid_argument with the reason for an action that cannot apply.
std::vector<ImageStep> planImageEdits(ImageSize source, const folly::dynamic &actions, const folly::dynamic &loadOptions);

class ImageCodec {
 public:
  virtual ~ImageCodec() = default;
  // The size of the encoded image the right way up, by its orientation, or nothing for bytes that
  // are not an image.
  virtual std::optional<ImageSize> size(const std::string &bytes) = 0;
  // Whether it can encode `format`: jpeg, png or webp.
  virtual bool encodes(const std::string &format) = 0;
  // Decodes the image the right way up, applies `steps` and encodes the result as `format` at
  // `quality` (0 to 1, for a lossy format). Throws std::runtime_error with the reason it cannot.
  virtual std::string render(const std::string &bytes, const std::vector<ImageStep> &steps, const std::string &format, double quality) = 0;
};

// `folder` is where saved images go: `<caches>/ImageManipulator`.
std::shared_ptr<NativeModule> makeImageManipulatorModule(std::shared_ptr<ImageCodec> codec, std::shared_ptr<Http> http, std::string folder);

} // namespace ngn
