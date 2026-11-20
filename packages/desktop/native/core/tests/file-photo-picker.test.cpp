#include "ngn/bytes.h"
#include "ngn/photo-library.h"

#include <doctest/doctest.h>

#include <unistd.h>

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

using folly::dynamic;

namespace {

namespace fs = std::filesystem;

struct TempDir {
  fs::path path = fs::temp_directory_path() / ("ngn-photo-picker-" + std::to_string(getpid()) + "-" + std::to_string(reinterpret_cast<uintptr_t>(this)));
  TempDir() {
    fs::remove_all(path);
    fs::create_directories(path);
  }
  ~TempDir() {
    std::error_code ignored;
    fs::remove_all(path, ignored);
  }
};

// The open panel: what it was asked, and the files the user chooses.
struct Dialogs final : ngn::FileDialogs {
  std::vector<OpenRequest> asked;
  std::optional<std::vector<std::string>> chosen;
  void openFiles(const OpenRequest &request, std::function<void(std::optional<std::vector<std::string>>)> done) override {
    asked.push_back(request);
    done(chosen);
  }
  void saveFile(const SaveRequest &, std::function<void(std::optional<std::string>)> done) override {
    done(std::nullopt);
  }
  void chooseFolder(std::function<void(std::optional<std::string>)> done) override {
    done(std::nullopt);
  }
};

std::string big(uint64_t value, int bytes) {
  std::string out;
  for (int i = bytes - 1; i >= 0; i--) {
    out.push_back(static_cast<char>((value >> (8 * i)) & 0xff));
  }
  return out;
}

std::string box(const std::string &type, const std::string &contents) {
  return big(8 + contents.size(), 4) + type + contents;
}

// An MP4 of a sound track and a video track `width` by `height`, turned a quarter when `turned`,
// `seconds` long at a time scale of 600.
std::string mp4(int width, int height, double seconds, bool turned) {
  std::string mvhd = std::string(4, '\0') + big(0, 4) + big(0, 4) + big(600, 4) + big(static_cast<uint64_t>(seconds * 600), 4) + std::string(80, '\0');
  auto tkhd = [](int w, int h, bool quarter) {
    std::string head = std::string(4, '\0') + std::string(20, '\0') + std::string(16, '\0');
    // The matrix's a, b, u, c, d, v, x, y and w.
    int32_t matrix[9] = {quarter ? 0 : 0x10000, quarter ? 0x10000 : 0, 0, quarter ? -0x10000 : 0, quarter ? 0 : 0x10000, 0, 0, 0, 0x40000000};
    for (auto value : matrix) {
      head += big(static_cast<uint32_t>(value), 4);
    }
    return box("tkhd", head + big(static_cast<uint64_t>(w) << 16, 4) + big(static_cast<uint64_t>(h) << 16, 4));
  };
  std::string moov = box("mvhd", mvhd) + box("trak", tkhd(0, 0, false)) + box("trak", tkhd(width, height, turned));
  return box("ftyp", "isom" + big(0, 4)) + box("moov", moov) + box("mdat", "frames");
}

// A JPEG whose APP1 has an EXIF of `orientation`, a DateTimeOriginal in the Exif IFD and a
// latitude in the GPS IFD, in little-endian byte order.
std::string jpegWithExif(int orientation) {
  auto le = [](uint32_t value, int bytes) {
    std::string out;
    for (int i = 0; i < bytes; i++) {
      out.push_back(static_cast<char>((value >> (8 * i)) & 0xff));
    }
    return out;
  };
  auto entry = [&](uint16_t tag, uint16_t type, uint32_t count, uint32_t value) { return le(tag, 2) + le(type, 2) + le(count, 4) + le(value, 4); };
  // IFD0 at 8: Make, Orientation, the Exif pointer, the GPS pointer.
  const uint32_t ifd0 = 8, ifd0Size = 2 + 4 * 12 + 4;
  const uint32_t make = ifd0 + ifd0Size;            // "Canon\0", 6 bytes
  const uint32_t exif = make + 6;                   // one entry
  const uint32_t exifSize = 2 + 12 + 4;
  const uint32_t date = exif + exifSize;            // 20 bytes
  const uint32_t gps = date + 20;                   // two entries
  const uint32_t gpsSize = 2 + 2 * 12 + 4;
  const uint32_t latitude = gps + gpsSize;          // three rationals
  std::string tiff = "II" + le(42, 2) + le(ifd0, 4);
  tiff += le(4, 2) + entry(0x010F, 2, 6, make) + entry(0x0112, 3, 1, static_cast<uint32_t>(orientation)) + entry(0x8769, 4, 1, exif) +
          entry(0x8825, 4, 1, gps) + le(0, 4);
  tiff += std::string("Canon\0", 6);
  tiff += le(1, 2) + entry(0x9003, 2, 20, date) + le(0, 4);
  tiff += std::string("2026:11:19 10:30:00\0", 20);
  tiff += le(2, 2) + entry(0x0001, 2, 2, 'N') + entry(0x0002, 5, 3, latitude) + le(0, 4);
  tiff += le(51, 4) + le(1, 4) + le(30, 4) + le(1, 4) + le(36, 4) + le(1, 4);
  std::string app1 = std::string("Exif\0\0", 6) + tiff;
  return std::string("\xFF\xD8", 2) + "\xFF\xE1" + big(app1.size() + 2, 2) + app1 + "\xFF\xDA" + big(2, 2) + "scan";
}

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> failure;
};

// The picker answers from a thread of its own: waits for it, for at most 10 seconds.
template <typename T>
struct Waited {
  std::mutex mutex;
  std::condition_variable changed;
  std::optional<T> value;
  void set(T v) {
    std::lock_guard lock(mutex);
    value = std::move(v);
    changed.notify_all();
  }
  T get() {
    std::unique_lock lock(mutex);
    REQUIRE(changed.wait_for(lock, std::chrono::seconds(10), [this] { return value.has_value(); }));
    return *value;
  }
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  auto answer = std::make_shared<Waited<Answer>>();
  module.callWithPromise(method, args,
                         {.resolve = [answer](dynamic v) { answer->set({.value = v}); },
                          .reject = [answer](const std::string &m) { answer->set({.failure = m}); }});
  return answer->get();
}

} // namespace

TEST_CASE("isoVideoFacts reads an MP4's video track size and duration, turned as it plays, and nothing from another file") {
  TempDir dir;
  auto write = [&](const std::string &name, const std::string &bytes) {
    auto at = dir.path / name;
    std::ofstream(at, std::ios::binary) << bytes;
    return at.string();
  };
  auto facts = ngn::isoVideoFacts(write("a.mp4", mp4(1920, 1080, 2.5, false)));
  REQUIRE(facts);
  CHECK(facts->width == 1920);
  CHECK(facts->height == 1080);
  CHECK(facts->duration == doctest::Approx(2500));
  auto portrait = ngn::isoVideoFacts(write("b.mov", mp4(1920, 1080, 1, true)));
  REQUIRE(portrait);
  CHECK(portrait->width == 1080);
  CHECK(portrait->height == 1920);
  CHECK_FALSE(ngn::isoVideoFacts(write("c.webm", "\x1a\x45\xdf\xa3 not an mp4")));
  CHECK_FALSE(ngn::isoVideoFacts((dir.path / "missing.mp4").string()));
}

TEST_CASE("jpegExif names a JPEG's TIFF, Exif and GPS tags as iOS does, and reads nothing from bytes with no EXIF") {
  auto exif = ngn::jpegExif(jpegWithExif(6));
  REQUIRE(exif.isObject());
  CHECK(exif["Orientation"] == dynamic(6));
  CHECK(exif["Make"] == dynamic("Canon"));
  CHECK(exif["DateTimeOriginal"] == dynamic("2026:11:19 10:30:00"));
  CHECK(exif["GPSLatitudeRef"] == dynamic("N"));
  CHECK(exif["GPSLatitude"].asDouble() == doctest::Approx(51.51));
  CHECK(ngn::jpegExif(std::string("\xFF\xD8\xFF\xDA\x00\x02", 6)).isNull());
  CHECK(ngn::jpegExif("\x89PNG").isNull());
  // A segment cut short reads what it holds, and nothing past it.
  auto cut = jpegWithExif(3);
  CHECK_NOTHROW(ngn::jpegExif(cut.substr(0, 40)));
}

TEST_CASE("makeFilePhotoPicker asks the open panel for the media types, copies each file into the caches and describes it") {
  TempDir dir;
  auto dialogs = std::make_shared<Dialogs>();
  auto photo = (dir.path / "beach.jpg").string();
  std::ofstream(photo, std::ios::binary) << jpegWithExif(1);
  auto clip = (dir.path / "walk.mp4").string();
  std::ofstream(clip, std::ios::binary) << mp4(640, 480, 3, false);
  std::vector<std::string> measured;
  auto picker = ngn::makeFilePhotoPicker(dialogs, (dir.path / "caches").string(), [&](const std::string &path) {
    measured.push_back(path);
    return std::optional<std::pair<double, double>>({4032, 3024});
  });
  auto pick = [&](dynamic options) {
    auto out = std::make_shared<Waited<std::optional<std::vector<ngn::PhotoPicker::Picked>>>>();
    picker->pick(options, [out](std::optional<std::vector<ngn::PhotoPicker::Picked>> picked) { out->set(std::move(picked)); });
    return out->get();
  };

  // Cancelled.
  CHECK_FALSE(pick(dynamic::object()));
  CHECK(dialogs->asked.back().types == std::vector<std::string>{"image/*"});
  CHECK_FALSE(dialogs->asked.back().multiple);
  CHECK(dialogs->asked.back().title == "Choose an Image");
  CHECK(dialogs->asked.back().filterName == "Images");

  dialogs->chosen = std::vector<std::string>{photo, clip};
  auto picked = pick(dynamic::object("mediaTypes", dynamic::array("images", "videos"))("allowsMultipleSelection", true));
  CHECK(dialogs->asked.back().types == std::vector<std::string>{"image/*", "video/*"});
  CHECK(dialogs->asked.back().multiple);
  CHECK(dialogs->asked.back().title == "Choose Images or Videos");
  REQUIRE(picked);
  REQUIRE(picked->size() == 2);
  const auto &image = (*picked)[0];
  auto copied = ngn::pathOfUri(image.uri);
  REQUIRE(copied);
  CHECK(fs::path(*copied).parent_path().parent_path() == dir.path / "caches");
  CHECK(fs::exists(*copied));
  CHECK(image.fileName == "beach.jpg");
  CHECK(image.mimeType == "image/jpeg");
  CHECK(image.type == "image");
  CHECK(image.width == 4032);
  CHECK(image.height == 3024);
  CHECK(image.fileSize == static_cast<double>(fs::file_size(photo)));
  CHECK_FALSE(image.duration);
  // Measured in the caches, where the app reads it.
  CHECK(measured == std::vector<std::string>{*copied});
  const auto &video = (*picked)[1];
  CHECK(video.type == "video");
  CHECK(video.mimeType == "video/mp4");
  CHECK(video.width == 640);
  CHECK(video.height == 480);
  CHECK(video.duration == doctest::Approx(3000));

  // The copies are made off the thread the panel answered on.
  auto where = std::make_shared<Waited<std::thread::id>>();
  picker->pick(dynamic::object(), [where](auto) { where->set(std::this_thread::get_id()); });
  CHECK(where->get() != std::this_thread::get_id());

  // One file however many are chosen, unless several may be; then at most selectionLimit.
  CHECK(pick(dynamic::object("mediaTypes", "videos"))->size() == 1);
  CHECK(dialogs->asked.back().types == std::vector<std::string>{"video/*"});
  CHECK(dialogs->asked.back().title == "Choose a Video");
  CHECK(pick(dynamic::object("allowsMultipleSelection", true)("selectionLimit", 1))->size() == 1);
  CHECK(pick(dynamic::object("allowsMultipleSelection", true)("selectionLimit", 0))->size() == 2);
  // A file that has gone is left out.
  dialogs->chosen = std::vector<std::string>{(dir.path / "gone.png").string()};
  CHECK(pick(dynamic::object())->empty());
}

TEST_CASE("NgNativeImagePicker with no photo library answers its permissions granted, and gives base64 and exif when asked, for images only") {
  TempDir dir;
  auto dialogs = std::make_shared<Dialogs>();
  auto photo = (dir.path / "p.jpg").string();
  auto bytes = jpegWithExif(8);
  std::ofstream(photo, std::ios::binary) << bytes;
  auto clip = (dir.path / "v.mp4").string();
  std::ofstream(clip, std::ios::binary) << mp4(320, 240, 1, false);
  auto picker = ngn::makeFilePhotoPicker(dialogs, (dir.path / "caches").string(), [](const std::string &) { return std::nullopt; });
  auto module = ngn::makeImagePickerModule(picker, nullptr, false);
  for (const char *method : {"getMediaLibraryPermissionsAsync", "requestMediaLibraryPermissionsAsync"}) {
    auto permission = *ask(*module, method).value;
    CHECK(permission["status"] == dynamic("granted"));
    CHECK(permission["granted"] == dynamic(true));
  }
  CHECK(ask(*module, "getCameraPermissionsAsync").value->at("granted") == dynamic(false));
  CHECK(ask(*module, "launchCameraAsync").value->at("canceled") == dynamic(true));

  CHECK(ask(*module, "launchImageLibraryAsync", dynamic::array(dynamic::object())).value->at("canceled") == dynamic(true));
  dialogs->chosen = std::vector<std::string>{photo, clip};
  auto plain = *ask(*module, "launchImageLibraryAsync", dynamic::array(dynamic::object("allowsMultipleSelection", true))).value;
  CHECK(plain["canceled"] == dynamic(false));
  CHECK(plain["assets"][0]["base64"] == dynamic(nullptr));
  CHECK(plain["assets"][0]["exif"] == dynamic(nullptr));
  CHECK(plain["assets"][0]["width"] == dynamic(0.0));
  auto asked = *ask(*module, "launchImageLibraryAsync",
                    dynamic::array(dynamic::object("allowsMultipleSelection", true)("mediaTypes", "All")("base64", true)("exif", true)))
                    .value;
  CHECK(asked["assets"][0]["base64"] == dynamic(ngn::base64Encode(bytes)));
  CHECK(asked["assets"][0]["exif"]["Orientation"] == dynamic(8));
  CHECK(asked["assets"][1]["type"] == dynamic("video"));
  CHECK(asked["assets"][1]["base64"] == dynamic(nullptr));
  CHECK(asked["assets"][1]["exif"] == dynamic(nullptr));
  CHECK(asked["assets"][1]["duration"] == dynamic(1000.0));

  // With no prompts the panel is never shown.
  auto quiet = ngn::makeImagePickerModule(picker, nullptr, true);
  auto before = dialogs->asked.size();
  CHECK(ask(*quiet, "launchImageLibraryAsync", dynamic::array(dynamic::object())).value->at("canceled") == dynamic(true));
  CHECK(dialogs->asked.size() == before);
}

namespace {

std::string writeFile(const fs::path &at, const std::string &bytes) {
  std::ofstream(at, std::ios::binary) << bytes;
  return at.string();
}

// A version 0 tkhd box with `payload` bytes after its header, width and height last when whole.
std::string trackBox(int width, int height, size_t payload = 84) {
  std::string body = std::string(4, '\0') + std::string(20, '\0') + std::string(16, '\0');
  int32_t matrix[9] = {0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000};
  for (auto value : matrix) {
    body += big(static_cast<uint32_t>(value), 4);
  }
  body += big(static_cast<uint64_t>(width) << 16, 4) + big(static_cast<uint64_t>(height) << 16, 4);
  return box("tkhd", body.substr(0, payload));
}

std::string movieHeader() {
  return box("mvhd", std::string(4, '\0') + big(0, 4) + big(0, 4) + big(600, 4) + big(600, 4) + std::string(80, '\0'));
}

std::string littleEndian(uint32_t value, int bytes) {
  std::string out;
  for (int i = 0; i < bytes; i++) {
    out.push_back(static_cast<char>((value >> (8 * i)) & 0xff));
  }
  return out;
}

// A JPEG whose only IFD0 entry is ExposureBiasValue, a signed rational of `numerator` over `denominator`.
std::string jpegWithExposureBias(int32_t numerator, int32_t denominator) {
  std::string tiff = "II" + littleEndian(42, 2) + littleEndian(8, 4) + littleEndian(1, 2) + littleEndian(0x9204, 2) + littleEndian(10, 2) +
                     littleEndian(1, 4) + littleEndian(26, 4) + littleEndian(0, 4) + littleEndian(static_cast<uint32_t>(numerator), 4) +
                     littleEndian(static_cast<uint32_t>(denominator), 4);
  std::string app1 = std::string("Exif\0\0", 6) + tiff;
  return std::string("\xFF\xD8", 2) + "\xFF\xE1" + big(app1.size() + 2, 2) + app1 + "\xFF\xDA" + big(2, 2) + "scan";
}

} // namespace

TEST_CASE("isoVideoFacts stops at a box whose size runs past the file, even one that wraps the offset") {
  TempDir dir;
  // A box at 16 of an extended size of 2^64 - 16 ends, by wrapping, back at 0: the scan would
  // visit the file's boxes again for ever.
  auto wrapped = box("ftyp", "isom" + big(0, 4)) + big(1, 4) + "free" + big(0xFFFFFFFFFFFFFFF0ull, 8) + box("moov", movieHeader());
  CHECK_FALSE(ngn::isoVideoFacts(writeFile(dir.path / "wrapped.mp4", wrapped)));
  // A size past the end of the file, without wrapping.
  auto past = box("ftyp", "isom" + big(0, 4)) + big(1000, 4) + "moov" + movieHeader();
  CHECK_FALSE(ngn::isoVideoFacts(writeFile(dir.path / "past.mp4", past)));
}

TEST_CASE("isoVideoFacts reads a header's fields only inside its own box") {
  TempDir dir;
  // An mvhd that ends after its time scale: the duration would be its sibling's size and type.
  auto shortMovie = box("moov", box("mvhd", std::string(4, '\0') + big(0, 4) + big(0, 4) + big(600, 4)) + box("trak", trackBox(640, 480)));
  CHECK_FALSE(ngn::isoVideoFacts(writeFile(dir.path / "short-mvhd.mp4", box("ftyp", "isom" + big(0, 4)) + shortMovie)));
  // A track header cut before its width and height is skipped, not read into the next track.
  auto shortTrack = box("moov", movieHeader() + box("trak", trackBox(320, 240, 50)) + box("trak", trackBox(640, 480)));
  auto facts = ngn::isoVideoFacts(writeFile(dir.path / "short-tkhd.mp4", box("ftyp", "isom" + big(0, 4)) + shortTrack));
  REQUIRE(facts);
  CHECK(facts->width == 640);
  CHECK(facts->height == 480);
  CHECK(facts->duration == doctest::Approx(1000));
  // A movie whose only track is short has no size.
  auto onlyShort = box("moov", movieHeader() + box("trak", trackBox(320, 240, 50)));
  auto none = ngn::isoVideoFacts(writeFile(dir.path / "only-short.mp4", box("ftyp", "isom" + big(0, 4)) + onlyShort));
  REQUIRE(none);
  CHECK(none->width == 0);
  CHECK(none->height == 0);
}

TEST_CASE("jpegExif keeps the sign of a signed rational") {
  auto exif = ngn::jpegExif(jpegWithExposureBias(-1, 2));
  REQUIRE(exif.isObject());
  CHECK(exif["ExposureBiasValue"].asDouble() == doctest::Approx(-0.5));
  CHECK(ngn::jpegExif(jpegWithExposureBias(3, -4))["ExposureBiasValue"].asDouble() == doctest::Approx(-0.75));
  CHECK(ngn::jpegExif(jpegWithExposureBias(1, 3))["ExposureBiasValue"].asDouble() == doctest::Approx(1.0 / 3));
}

TEST_CASE("jpegExif reads an APP1 that fill bytes come before") {
  auto plain = jpegWithExif(6);
  // Any number of 0xFF fill bytes may come before a marker's code.
  auto filled = plain.substr(0, 2) + std::string("\xFF\xFF\xFF", 3) + plain.substr(2);
  auto exif = ngn::jpegExif(filled);
  REQUIRE(exif.isObject());
  CHECK(exif["Orientation"] == dynamic(6));
  // Fill bytes with nothing after them are a cut file.
  CHECK(ngn::jpegExif(plain.substr(0, 2) + std::string("\xFF\xFF\xFF\xFF", 4)).isNull());
}

TEST_CASE("makeFilePhotoPicker describes a 3GPP file as a video, and takes a huge selectionLimit as none") {
  TempDir dir;
  auto dialogs = std::make_shared<Dialogs>();
  auto picker = ngn::makeFilePhotoPicker(dialogs, (dir.path / "caches").string(), [](const std::string &) { return std::nullopt; });
  auto clip = writeFile(dir.path / "phone.3gp", "not parsed");
  auto other = writeFile(dir.path / "phone.3gpp", "not parsed");
  dialogs->chosen = std::vector<std::string>{clip, other};
  auto out = std::make_shared<Waited<std::optional<std::vector<ngn::PhotoPicker::Picked>>>>();
  picker->pick(dynamic::object("mediaTypes", "videos")("allowsMultipleSelection", true)("selectionLimit", 1e30),
               [out](std::optional<std::vector<ngn::PhotoPicker::Picked>> picked) { out->set(std::move(picked)); });
  auto picked = out->get();
  REQUIRE(picked);
  REQUIRE(picked->size() == 2);
  for (const auto &one : *picked) {
    CHECK(one.type == "video");
    CHECK(one.mimeType == "video/3gpp");
  }
}

TEST_CASE("NgNativeImagePicker leaves base64 null when the picked file has gone, and still answers exif the host gave") {
  struct Gone final : ngn::PhotoPicker {
    void pick(const dynamic &, std::function<void(std::optional<std::vector<Picked>>)> done) override {
      Picked one;
      one.uri = ngn::fileUri("/nonexistent-ngn-photo-dir/gone.jpg");
      one.fileName = "gone.jpg";
      one.mimeType = "image/jpeg";
      one.type = "image";
      one.fileSize = 1234;
      one.exif = dynamic::object("Orientation", 3);
      done(std::vector<Picked>{one});
    }
  };
  auto module = ngn::makeImagePickerModule(std::make_shared<Gone>(), nullptr, false);
  auto answer = *ask(*module, "launchImageLibraryAsync", dynamic::array(dynamic::object("base64", true)("exif", true))).value;
  CHECK(answer["assets"][0]["base64"] == dynamic(nullptr));
  CHECK(answer["assets"][0]["exif"]["Orientation"] == dynamic(3));
  CHECK(answer["assets"][0]["fileSize"] == dynamic(1234.0));
}
