#include "fake-network.h"
#include "ngn/bytes.h"
#include "ngn/image-manipulator.h"

#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>
#include <optional>
#include <stdexcept>

using folly::dynamic;
using ngn::ImageSize;
using ngn::ImageStep;
using Kind = ngn::ImageStep::Kind;

namespace {

std::vector<ImageStep> plan(ImageSize source, dynamic actions, dynamic load = nullptr) {
  return ngn::planImageEdits(source, actions, load);
}

std::string planError(ImageSize source, dynamic actions) {
  try {
    plan(source, std::move(actions));
  } catch (const std::invalid_argument &error) {
    return error.what();
  }
  return "";
}

// An "image" is "image:<width>x<height>"; rendering answers "<format>@<quality>:<steps>".
struct FakeCodec final : ngn::ImageCodec {
  std::vector<std::vector<ImageStep>> rendered;
  bool webp{false};
  std::optional<ImageSize> size(const std::string &bytes) override {
    int width = 0, height = 0;
    if (std::sscanf(bytes.c_str(), "image:%dx%d", &width, &height) != 2) {
      return std::nullopt;
    }
    return ImageSize{width, height};
  }
  bool encodes(const std::string &format) override {
    return format != "webp" || webp;
  }
  std::string render(const std::string &, const std::vector<ImageStep> &steps, const std::string &format, double quality) override {
    rendered.push_back(steps);
    return format + "@" + std::to_string(quality).substr(0, 3) + ":" + std::to_string(steps.size());
  }
};

struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn-image-manipulator-" + std::to_string(rand()));
  ~Folder() {
    std::filesystem::remove_all(path);
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer call(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(
      method, args, {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

// Answers the request `index` with `body`.
void serve(ngn::testing::FakeHttp &http, size_t index, const std::string &body, uint16_t status = 200) {
  REQUIRE(http.sent.size() > index);
  auto &callbacks = http.sent[index]->callbacks;
  callbacks.onResponse({.status = status});
  callbacks.onData(body, -1);
  callbacks.onComplete("", false);
}

std::string contents(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), {}};
}

} // namespace

TEST_CASE("planImageEdits resizes to a width or a height keeping the image's ratio, or to both") {
  auto steps = plan({200, 100}, dynamic::array(dynamic::object("resize", dynamic::object("width", 50))));
  REQUIRE(steps.size() == 1);
  CHECK(steps[0].kind == Kind::Resize);
  CHECK(steps[0].size == ImageSize{50, 25});
  CHECK(plan({200, 100}, dynamic::array(dynamic::object("resize", dynamic::object("height", 30))))[0].size == ImageSize{60, 30});
  CHECK(plan({200, 100}, dynamic::array(dynamic::object("resize", dynamic::object("width", 10)("height", 70))))[0].size == ImageSize{10, 70});
  // Each action sizes the image the one before gave.
  auto chained = plan(
      {200, 100},
      dynamic::array(dynamic::object("rotate", 90), dynamic::object("resize", dynamic::object("width", 50))));
  CHECK(chained[1].size == ImageSize{50, 100});
  CHECK(planError({200, 100}, dynamic::array(dynamic::object("resize", dynamic::object()))) ==
        "resize needs a width or a height above 0");
}

TEST_CASE("planImageEdits rotates to the rotated image's bounding box, rounded down, as iOS does") {
  CHECK(plan({200, 100}, dynamic::array(dynamic::object("rotate", 90)))[0].size == ImageSize{100, 200});
  CHECK(plan({200, 100}, dynamic::array(dynamic::object("rotate", -180)))[0].size == ImageSize{200, 100});
  auto tilted = plan({100, 100}, dynamic::array(dynamic::object("rotate", 45)))[0];
  CHECK(tilted.kind == Kind::Rotate);
  CHECK(tilted.degrees == 45);
  CHECK(tilted.size == ImageSize{141, 141});
}

TEST_CASE("planImageEdits flips either way, and refuses another direction") {
  auto steps = plan({30, 20}, dynamic::array(dynamic::object("flip", "vertical"), dynamic::object("flip", "horizontal")));
  CHECK(steps[0].kind == Kind::FlipVertical);
  CHECK(steps[1].kind == Kind::FlipHorizontal);
  CHECK(steps[1].size == ImageSize{30, 20});
  CHECK(planError({30, 20}, dynamic::array(dynamic::object("flip", "diagonal"))) == "flip is vertical or horizontal, not diagonal");
}

TEST_CASE("planImageEdits crops to the rectangle within the image, and refuses one outside it, as iOS does") {
  auto crop = [](double x, double y, double w, double h) {
    return dynamic::array(dynamic::object("crop", dynamic::object("originX", x)("originY", y)("width", w)("height", h)));
  };
  auto inside = plan({200, 100}, crop(10, 20, 30, 40))[0];
  CHECK(inside.kind == Kind::Crop);
  CHECK(inside.x == 10);
  CHECK(inside.y == 20);
  CHECK(inside.size == ImageSize{30, 40});
  // Past the edge, it keeps the part inside, as CGImage's cropping does.
  auto edge = plan({200, 100}, crop(150, 50, 100, 100))[0];
  CHECK(edge.size == ImageSize{50, 50});
  // A fractional rectangle grows to the whole pixels it touches.
  CHECK(plan({200, 100}, crop(0.5, 0, 10, 10))[0].size == ImageSize{11, 10});
  const char *outside = "Invalid crop options has been passed. Please make sure the requested crop rectangle is inside source image";
  CHECK(planError({200, 100}, crop(201, 0, 10, 10)) == outside);
  CHECK(planError({200, 100}, crop(0, 0, 10, 101)) == outside);
  CHECK(planError({200, 100}, crop(200, 0, 0, 10)).find("Cropping the image to rectangle") == 0);
}

TEST_CASE("planImageEdits scales an image larger than the load options down first, and refuses an unknown action") {
  auto steps = plan({400, 200}, dynamic::array(), dynamic::object("maxWidth", 100));
  REQUIRE(steps.size() == 1);
  CHECK(steps[0].size == ImageSize{100, 50});
  CHECK(plan({400, 200}, dynamic::array(), dynamic::object("maxWidth", 300)("maxHeight", 50))[0].size == ImageSize{100, 50});
  CHECK(plan({40, 20}, dynamic::array(), dynamic::object("maxWidth", 100)).empty());
  CHECK(planError({40, 20}, dynamic::array(dynamic::object("extent", dynamic::object()))) ==
        "An action is one of resize, rotate, flip or crop");
}

TEST_CASE("NgNativeImageManipulator sizes the edits from the file it reads, without rendering") {
  auto codec = std::make_shared<FakeCodec>();
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeImageManipulatorModule(codec, http, "/unused");
  auto answer = call(
      *module, "renderAsync",
      dynamic::array("/photos/cat one.png", dynamic::array(dynamic::object("rotate", 90)), nullptr));
  // A path is read as its file uri.
  REQUIRE(http->sent.size() == 1);
  CHECK(http->sent[0]->request.url == "file:///photos/cat%20one.png");
  serve(*http, 0, "image:200x100");
  REQUIRE(answer.value);
  CHECK(*answer.value == dynamic::object("width", 100)("height", 200));
  CHECK(codec->rendered.empty());
}

TEST_CASE("NgNativeImageManipulator saves the edited image as a new file in its folder") {
  Folder folder;
  auto codec = std::make_shared<FakeCodec>();
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeImageManipulatorModule(codec, http, (folder.path / "ImageManipulator").string());
  auto actions = dynamic::array(dynamic::object("flip", "vertical"), dynamic::object("resize", dynamic::object("width", 20)));
  auto jpeg = call(*module, "saveAsync", dynamic::array("http://localhost:8081/assets/cat.png", actions, nullptr, nullptr));
  CHECK(http->sent[0]->request.url == "http://localhost:8081/assets/cat.png");
  serve(*http, 0, "image:40x10");
  REQUIRE(jpeg.value);
  auto uri = (*jpeg.value)["uri"].asString();
  CHECK(uri.rfind("file://" + (folder.path / "ImageManipulator").string() + "/", 0) == 0);
  CHECK(uri.substr(uri.size() - 4) == ".jpg");
  // JPEG at full quality unless the options say otherwise, with no base64.
  CHECK(contents(uri.substr(7)) == "jpeg@1.0:2");
  CHECK((*jpeg.value)["width"] == dynamic(20));
  CHECK((*jpeg.value)["height"] == dynamic(5));
  CHECK((*jpeg.value).count("base64") == 0);
  REQUIRE(codec->rendered.size() == 1);
  CHECK(codec->rendered[0][0].kind == Kind::FlipVertical);

  auto png = call(
      *module, "saveAsync",
      dynamic::array("data:image/png;base64,AAAA", dynamic::array(), nullptr, dynamic::object("format", "png")("compress", 0.5)("base64", true)));
  CHECK(http->sent[1]->request.url == "data:image/png;base64,AAAA");
  serve(*http, 1, "image:3x4");
  REQUIRE(png.value);
  auto pngUri = (*png.value)["uri"].asString();
  CHECK(pngUri.substr(pngUri.size() - 4) == ".png");
  CHECK(pngUri != uri);
  CHECK((*png.value)["base64"] == dynamic(ngn::base64Encode("png@0.5:0")));
}

TEST_CASE("NgNativeImageManipulator refuses WebP where it cannot write it, before reading anything") {
  Folder folder;
  auto codec = std::make_shared<FakeCodec>();
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeImageManipulatorModule(codec, http, folder.path.string());
  auto webp = call(*module, "saveAsync", dynamic::array("/a.png", dynamic::array(), nullptr, dynamic::object("format", "webp")));
  REQUIRE(webp.error);
  CHECK(*webp.error == "ImageManipulator: this Mac cannot write WebP images; save as jpeg or png");
  CHECK(http->sent.empty());
  auto other = call(*module, "saveAsync", dynamic::array("/a.png", dynamic::array(), nullptr, dynamic::object("format", "gif")));
  CHECK(*other.error == "ImageManipulator: the format is jpeg, png or webp, not gif");
  codec->webp = true;
  call(*module, "saveAsync", dynamic::array("/a.png", dynamic::array(), nullptr, dynamic::object("format", "webp")));
  serve(*http, 0, "image:1x1");
  CHECK(codec->rendered.size() == 1);
}

TEST_CASE("NgNativeImageManipulator rejects a source it cannot read, an action that cannot apply, and a failed render") {
  Folder folder;
  auto codec = std::make_shared<FakeCodec>();
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeImageManipulatorModule(codec, http, folder.path.string());
  auto scheme = call(*module, "renderAsync", dynamic::array("ph://ABC", dynamic::array(), nullptr));
  CHECK(*scheme.error == "ImageManipulator: Could not load the image: ph://ABC is not a file, data or http(s) uri");
  CHECK(http->sent.empty());

  auto missing = call(*module, "renderAsync", dynamic::array("https://example.com/a.png", dynamic::array(), nullptr));
  serve(*http, 0, "", 404);
  CHECK(*missing.error == "ImageManipulator: Could not load the image: HTTP 404 for https://example.com/a.png");

  auto offline = call(*module, "renderAsync", dynamic::array("https://example.com/b.png", dynamic::array(), nullptr));
  http->sent[1]->callbacks.onComplete("The Internet connection appears to be offline.", false);
  CHECK(*offline.error == "ImageManipulator: Could not load the image: The Internet connection appears to be offline.");

  auto notImage = call(*module, "renderAsync", dynamic::array("/a.txt", dynamic::array(), nullptr));
  serve(*http, 2, "hello");
  CHECK(*notImage.error == "ImageManipulator: Could not load the image: /a.txt is not an image");

  auto badCrop = call(
      *module, "saveAsync",
      dynamic::array("/a.png", dynamic::array(dynamic::object("crop", dynamic::object("originX", 0)("originY", 0)("width", 9)("height", 1))), nullptr, nullptr));
  serve(*http, 3, "image:5x5");
  CHECK(badCrop.error->find("ImageManipulator: Invalid crop options") == 0);
  CHECK(codec->rendered.empty());

  struct FailingCodec final : ngn::ImageCodec {
    std::optional<ImageSize> size(const std::string &) override {
      return ImageSize{1, 1};
    }
    bool encodes(const std::string &) override {
      return true;
    }
    std::string render(const std::string &, const std::vector<ImageStep> &, const std::string &, double) override {
      throw std::runtime_error("Cannot create image data for given image format");
    }
  };
  auto failing = ngn::makeImageManipulatorModule(std::make_shared<FailingCodec>(), http, folder.path.string());
  auto failed = call(*failing, "saveAsync", dynamic::array("/a.png", dynamic::array(), nullptr, nullptr));
  serve(*http, 4, "x");
  CHECK(*failed.error == "ImageManipulator: Cannot create image data for given image format");
}
