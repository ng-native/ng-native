// ImageEditor on Linux: gdk-pixbuf decodes the image the right way up, cairo draws each step and
// gdk-pixbuf writes JPEG or PNG. Which steps an action makes, and their sizes, are the core's.
#include "../image-manipulator.h"
#include "mounted-views.h"

#include <doctest/doctest.h>
#include <gdk-pixbuf/gdk-pixbuf.h>

#include <array>
#include <cstdint>
#include <string>
#include <vector>

using Step = ngn::ImageStep;
using Rgb = std::array<int, 3>;

namespace {

// A `width` by `height` image with a red top-left pixel, a blue top-right one, a green bottom-left
// one and white elsewhere.
GdkPixbuf *corners(int width, int height) {
  GdkPixbuf *pixbuf = gdk_pixbuf_new(GDK_COLORSPACE_RGB, FALSE, 8, width, height);
  gdk_pixbuf_fill(pixbuf, 0xffffffff);
  auto set = [pixbuf](int x, int y, Rgb rgb) {
    guchar *pixel = gdk_pixbuf_get_pixels(pixbuf) + y * gdk_pixbuf_get_rowstride(pixbuf) + x * gdk_pixbuf_get_n_channels(pixbuf);
    for (int i = 0; i < 3; ++i) {
      pixel[i] = static_cast<guchar>(rgb[i]);
    }
  };
  set(0, 0, {255, 0, 0});
  set(width - 1, 0, {0, 0, 255});
  set(0, height - 1, {0, 255, 0});
  return pixbuf;
}

std::string encoded(GdkPixbuf *pixbuf, const char *type) {
  gchar *buffer = nullptr;
  gsize length = 0;
  REQUIRE(gdk_pixbuf_save_to_buffer(pixbuf, &buffer, &length, type, nullptr, nullptr));
  std::string out(buffer, length);
  g_free(buffer);
  return out;
}

GdkPixbuf *decoded(const std::string &bytes) {
  GdkPixbufLoader *loader = gdk_pixbuf_loader_new();
  gdk_pixbuf_loader_write(loader, reinterpret_cast<const guchar *>(bytes.data()), bytes.size(), nullptr);
  gdk_pixbuf_loader_close(loader, nullptr);
  GdkPixbuf *pixbuf = gdk_pixbuf_loader_get_pixbuf(loader);
  REQUIRE(pixbuf);
  g_object_ref(pixbuf);
  g_object_unref(loader);
  return pixbuf;
}

Rgb pixelAt(GdkPixbuf *pixbuf, int x, int y) {
  const guchar *pixel = gdk_pixbuf_get_pixels(pixbuf) + y * gdk_pixbuf_get_rowstride(pixbuf) + x * gdk_pixbuf_get_n_channels(pixbuf);
  return {pixel[0], pixel[1], pixel[2]};
}

// A JPEG with an Exif APP1 segment after its start, whose only tag is the orientation.
std::string withOrientation(const std::string &jpeg, uint8_t orientation) {
  const unsigned char tiff[] = {'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0};
  std::string exif("Exif\0\0", 6);
  exif.append(reinterpret_cast<const char *>(tiff), sizeof tiff);
  size_t length = exif.size() + 2;
  std::string segment = {'\xff', '\xe1', static_cast<char>(length >> 8), static_cast<char>(length & 0xff)};
  return jpeg.substr(0, 2) + segment + exif + jpeg.substr(2);
}

} // namespace

TEST_CASE("ImageEditor on Linux reads an image's size from its header, turned by its Exif orientation") {
  auto codec = ngn::gtk::makeImageCodec();
  GdkPixbuf *image = corners(40, 20);
  CHECK(codec->size(encoded(image, "png")) == ngn::ImageSize{40, 20});
  auto jpeg = encoded(image, "jpeg");
  CHECK(codec->size(jpeg) == ngn::ImageSize{40, 20});
  // 6: stored on its side, shown turned a quarter clockwise.
  CHECK(codec->size(withOrientation(jpeg, 6)) == ngn::ImageSize{20, 40});
  CHECK_FALSE(codec->size("not an image"));
  g_object_unref(image);
}

TEST_CASE("ImageEditor on Linux writes JPEG and PNG, and WebP only with a WebP writer") {
  auto codec = ngn::gtk::makeImageCodec();
  CHECK(codec->encodes("jpeg"));
  CHECK(codec->encodes("png"));
  bool webp = false;
  GSList *formats = gdk_pixbuf_get_formats();
  for (GSList *at = formats; at; at = at->next) {
    gchar *name = gdk_pixbuf_format_get_name(static_cast<GdkPixbufFormat *>(at->data));
    webp |= std::string(name) == "webp" && gdk_pixbuf_format_is_writable(static_cast<GdkPixbufFormat *>(at->data));
    g_free(name);
  }
  g_slist_free(formats);
  CHECK(codec->encodes("webp") == webp);
}

TEST_CASE("ImageEditor on Linux crops, flips, rotates and resizes, in order") {
  auto codec = ngn::gtk::makeImageCodec();
  GdkPixbuf *image = corners(40, 20);
  auto png = encoded(image, "png");
  g_object_unref(image);

  // A quarter turn clockwise: the red top left goes to the top right, the green bottom left to the
  // top left.
  GdkPixbuf *turned = decoded(codec->render(png, {Step{.kind = Step::Kind::Rotate, .size = {20, 40}, .degrees = 90}}, "png", 1));
  CHECK(gdk_pixbuf_get_width(turned) == 20);
  CHECK(gdk_pixbuf_get_height(turned) == 40);
  CHECK(pixelAt(turned, 19, 0) == Rgb{255, 0, 0});
  CHECK(pixelAt(turned, 0, 0) == Rgb{0, 255, 0});
  CHECK(pixelAt(turned, 19, 39) == Rgb{0, 0, 255});
  g_object_unref(turned);

  // Flipped left to right, then the top-left 10 by 5 cropped: blue is now at its corner.
  GdkPixbuf *cropped = decoded(codec->render(
      png, {Step{.kind = Step::Kind::FlipHorizontal, .size = {40, 20}}, Step{.kind = Step::Kind::Crop, .size = {10, 5}}}, "png", 1));
  CHECK(gdk_pixbuf_get_width(cropped) == 10);
  CHECK(gdk_pixbuf_get_height(cropped) == 5);
  CHECK(pixelAt(cropped, 0, 0) == Rgb{0, 0, 255});
  CHECK(pixelAt(cropped, 9, 4) == Rgb{255, 255, 255});
  g_object_unref(cropped);

  // Flipped top to bottom, then resized to 80 by 40: green at the top left, a block of it.
  GdkPixbuf *resized = decoded(codec->render(
      png, {Step{.kind = Step::Kind::FlipVertical, .size = {40, 20}}, Step{.kind = Step::Kind::Resize, .size = {80, 40}}}, "jpeg", 0.9));
  CHECK(gdk_pixbuf_get_width(resized) == 80);
  CHECK(gdk_pixbuf_get_height(resized) == 40);
  auto green = pixelAt(resized, 0, 0);
  CHECK(green[1] > 150);
  CHECK(green[0] < 120);
  g_object_unref(resized);
}

TEST_CASE("ImageEditor on Linux draws an image turned by its Exif orientation the right way up") {
  auto codec = ngn::gtk::makeImageCodec();
  // Red on the left half, blue on the right: blocks JPEG keeps, where it smears a lone pixel.
  GdkPixbuf *image = gdk_pixbuf_new(GDK_COLORSPACE_RGB, FALSE, 8, 40, 20);
  gdk_pixbuf_fill(image, 0x0000ffff);
  GdkPixbuf *left = gdk_pixbuf_new_subpixbuf(image, 0, 0, 20, 20);
  gdk_pixbuf_fill(left, 0xff0000ff);
  g_object_unref(left);
  auto jpeg = withOrientation(encoded(image, "jpeg"), 6);
  g_object_unref(image);
  GdkPixbuf *upright = decoded(codec->render(jpeg, {}, "png", 1));
  CHECK(gdk_pixbuf_get_width(upright) == 20);
  CHECK(gdk_pixbuf_get_height(upright) == 40);
  // Turned a quarter clockwise, as rotate 90 does: the left half on top.
  auto top = pixelAt(upright, 10, 5);
  auto bottom = pixelAt(upright, 10, 35);
  CHECK(top[0] > 200);
  CHECK(top[2] < 60);
  CHECK(bottom[2] > 200);
  CHECK(bottom[0] < 60);
  g_object_unref(upright);
  CHECK_THROWS_WITH(codec->render("not an image", {}, "png", 1), "Image cannot be found");
}
