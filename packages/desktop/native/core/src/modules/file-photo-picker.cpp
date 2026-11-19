// The photo picker of a host with no photo library (photo-library.h's makeFilePhotoPicker), and
// the two file readers it describes a pick with: an MP4 or QuickTime file's moov box, and a JPEG's
// EXIF.
#include "ngn/photo-library.h"

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <thread>

namespace ngn {

namespace {

namespace fs = std::filesystem;

// Big-endian reads of the file at `in`'s position.
uint64_t readBig(std::istream &in, int bytes) {
  uint64_t value = 0;
  for (int i = 0; i < bytes; i++) {
    int c = in.get();
    if (c == EOF) {
      return 0;
    }
    value = (value << 8) | static_cast<uint8_t>(c);
  }
  return value;
}

// The boxes between `from` and `to`, each as its type, where its contents start, and where it ends.
struct Box {
  std::string type;
  uint64_t start{0};
  uint64_t end{0};
};

std::optional<Box> boxAt(std::istream &in, uint64_t at, uint64_t to) {
  if (at + 8 > to) {
    return std::nullopt;
  }
  in.clear();
  in.seekg(static_cast<std::streamoff>(at));
  uint64_t size = readBig(in, 4);
  std::string type(4, '\0');
  in.read(type.data(), 4);
  uint64_t start = at + 8;
  if (size == 1) {
    size = readBig(in, 8);
    start += 8;
  } else if (size == 0) {
    size = to - at;
  }
  if (!in || size < start - at || at + size > to) {
    return std::nullopt;
  }
  return Box{type, start, at + size};
}

std::optional<Box> child(std::istream &in, const Box &parent, const std::string &type) {
  for (uint64_t at = parent.start; auto box = boxAt(in, at, parent.end); at = box->end) {
    if (box->type == type) {
      return box;
    }
  }
  return std::nullopt;
}

// A full box's version, read from its first byte, leaving `in` after its flags.
int versionAt(std::istream &in, const Box &box) {
  in.clear();
  in.seekg(static_cast<std::streamoff>(box.start));
  int version = in.get();
  in.ignore(3);
  return version;
}

// expo's names for the EXIF tags of each IFD, as iOS answers them (the TIFF and Exif tags at the
// top level, the GPS ones with GPS before their names).
const std::map<uint16_t, const char *> &mainTags() {
  static const std::map<uint16_t, const char *> tags{
      {0x0100, "ImageWidth"},       {0x0101, "ImageLength"},       {0x010E, "ImageDescription"},  {0x010F, "Make"},
      {0x0110, "Model"},            {0x0112, "Orientation"},       {0x011A, "XResolution"},       {0x011B, "YResolution"},
      {0x0128, "ResolutionUnit"},   {0x0131, "Software"},          {0x0132, "DateTime"},          {0x013B, "Artist"},
      {0x8298, "Copyright"},        {0x829A, "ExposureTime"},      {0x829D, "FNumber"},           {0x8822, "ExposureProgram"},
      {0x8827, "ISOSpeedRatings"},  {0x9003, "DateTimeOriginal"},  {0x9004, "DateTimeDigitized"}, {0x9010, "OffsetTime"},
      {0x9011, "OffsetTimeOriginal"}, {0x9012, "OffsetTimeDigitized"}, {0x9201, "ShutterSpeedValue"}, {0x9202, "ApertureValue"},
      {0x9203, "BrightnessValue"},  {0x9204, "ExposureBiasValue"}, {0x9207, "MeteringMode"},      {0x9209, "Flash"},
      {0x920A, "FocalLength"},      {0x9290, "SubsecTime"},        {0x9291, "SubsecTimeOriginal"}, {0x9292, "SubsecTimeDigitized"},
      {0xA001, "ColorSpace"},       {0xA002, "PixelXDimension"},   {0xA003, "PixelYDimension"},   {0xA402, "ExposureMode"},
      {0xA403, "WhiteBalance"},     {0xA404, "DigitalZoomRatio"},  {0xA405, "FocalLenIn35mmFilm"}, {0xA406, "SceneCaptureType"},
      {0xA432, "LensSpecification"}, {0xA433, "LensMake"},         {0xA434, "LensModel"},
  };
  return tags;
}

const std::map<uint16_t, const char *> &gpsTags() {
  static const std::map<uint16_t, const char *> tags{
      {0x0001, "GPSLatitudeRef"}, {0x0002, "GPSLatitude"},     {0x0003, "GPSLongitudeRef"}, {0x0004, "GPSLongitude"},
      {0x0005, "GPSAltitudeRef"}, {0x0006, "GPSAltitude"},     {0x0007, "GPSTimeStamp"},    {0x000C, "GPSSpeedRef"},
      {0x000D, "GPSSpeed"},       {0x0010, "GPSImgDirectionRef"}, {0x0011, "GPSImgDirection"}, {0x001D, "GPSDateStamp"},
  };
  return tags;
}

// A TIFF structure inside the APP1 segment, read with its byte order.
struct Tiff {
  const std::string &bytes;
  size_t base;
  bool little;

  bool has(size_t at, size_t count) const {
    return base + at + count <= bytes.size() && base + at + count >= base + at;
  }
  uint32_t read(size_t at, int size) const {
    uint32_t value = 0;
    for (int i = 0; i < size; i++) {
      auto byte = static_cast<uint8_t>(bytes[base + at + (little ? size - 1 - i : i)]);
      value = (value << 8) | byte;
    }
    return value;
  }
};

// One entry's value: a number, a string, or an array of numbers when it holds more than one.
folly::dynamic valueOf(const Tiff &tiff, size_t entry) {
  static const int sizes[] = {0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8};
  uint32_t type = tiff.read(entry + 2, 2);
  uint32_t count = tiff.read(entry + 4, 4);
  if (type == 0 || type > 10 || count == 0 || count > 1 << 16) {
    return nullptr;
  }
  size_t length = static_cast<size_t>(sizes[type]) * count;
  size_t at = length <= 4 ? entry + 8 : tiff.read(entry + 8, 4);
  if (!tiff.has(at, length)) {
    return nullptr;
  }
  if (type == 2 || type == 7) {
    std::string text = tiff.bytes.substr(tiff.base + at, length);
    if (type == 2) {
      text = text.substr(0, text.find('\0'));
    }
    return text;
  }
  folly::dynamic values = folly::dynamic::array();
  for (uint32_t i = 0; i < count; i++) {
    size_t at_i = at + static_cast<size_t>(sizes[type]) * i;
    switch (type) {
      case 1:
      case 6:
        values.push_back(static_cast<int64_t>(type == 6 ? static_cast<int8_t>(tiff.read(at_i, 1)) : tiff.read(at_i, 1)));
        break;
      case 3:
      case 8:
        values.push_back(static_cast<int64_t>(type == 8 ? static_cast<int16_t>(tiff.read(at_i, 2)) : tiff.read(at_i, 2)));
        break;
      case 4:
      case 9:
        values.push_back(type == 9 ? static_cast<int64_t>(static_cast<int32_t>(tiff.read(at_i, 4))) : static_cast<int64_t>(tiff.read(at_i, 4)));
        break;
      default: {
        // A rational: 5 unsigned, 10 signed.
        double num = type == 10 ? static_cast<int32_t>(tiff.read(at_i, 4)) : tiff.read(at_i, 4);
        double den = type == 10 ? static_cast<int32_t>(tiff.read(at_i + 4, 4)) : tiff.read(at_i + 4, 4);
        values.push_back(den == 0 ? 0.0 : num / den);
      }
    }
  }
  return count == 1 ? values[0] : values;
}

// The entries of the IFD at `at` into `out`, with what its pointers to the Exif and GPS IFDs say.
void readIfd(const Tiff &tiff, size_t at, const std::map<uint16_t, const char *> &names, folly::dynamic &out, std::optional<size_t> *exif,
             std::optional<size_t> *gps) {
  if (!tiff.has(at, 2)) {
    return;
  }
  uint32_t count = tiff.read(at, 2);
  for (uint32_t i = 0; i < count; i++) {
    size_t entry = at + 2 + 12 * static_cast<size_t>(i);
    if (!tiff.has(entry, 12)) {
      return;
    }
    auto tag = static_cast<uint16_t>(tiff.read(entry, 2));
    if (tag == 0x8769 && exif) {
      *exif = tiff.read(entry + 8, 4);
    } else if (tag == 0x8825 && gps) {
      *gps = tiff.read(entry + 8, 4);
    } else if (auto name = names.find(tag); name != names.end()) {
      auto value = valueOf(tiff, entry);
      if (!value.isNull()) {
        out[name->second] = std::move(value);
      }
    }
  }
}

// Degrees, minutes and seconds as degrees, as iOS gives GPSLatitude and GPSLongitude.
void toDegrees(folly::dynamic &exif, const char *key) {
  auto *value = exif.get_ptr(key);
  if (value && value->isArray() && value->size() == 3 && (*value)[0].isNumber()) {
    *value = (*value)[0].asDouble() + (*value)[1].asDouble() / 60 + (*value)[2].asDouble() / 3600;
  }
}

class FilePhotoPicker final : public PhotoPicker, public std::enable_shared_from_this<FilePhotoPicker> {
 public:
  FilePhotoPicker(std::shared_ptr<FileDialogs> dialogs, std::string folder, std::function<std::optional<std::pair<double, double>>(const std::string &)> imageSize)
      : dialogs_(std::move(dialogs)), folder_(std::move(folder)), imageSize_(std::move(imageSize)) {}

  void pick(const folly::dynamic &options, std::function<void(std::optional<std::vector<Picked>>)> done) override {
    auto kinds = mediaKindsOf(options);
    bool multiple = options.getDefault("allowsMultipleSelection", false) == true;
    auto limit = options.getDefault("selectionLimit", 0);
    size_t most = multiple ? (limit.isNumber() && limit.asDouble() >= 1 ? static_cast<size_t>(limit.asDouble()) : 0) : 1;
    FileDialogs::OpenRequest request{.multiple = multiple};
    if (kinds.photos) {
      request.types.emplace_back("image/*");
    }
    if (kinds.videos) {
      request.types.emplace_back("video/*");
    }
    const char *noun = kinds.photos && kinds.videos ? "Images and Videos" : kinds.videos ? "Videos" : "Images";
    request.filterName = noun;
    request.title = kinds.photos && kinds.videos ? (multiple ? "Choose Images or Videos" : "Choose an Image or Video")
                    : kinds.videos               ? (multiple ? "Choose Videos" : "Choose a Video")
                                                 : (multiple ? "Choose Images" : "Choose an Image");
    dialogs_->openFiles(request, [self = shared_from_this(), most, done = std::move(done)](std::optional<std::vector<std::string>> paths) {
      if (!paths) {
        done(std::nullopt);
        return;
      }
      if (most > 0 && paths->size() > most) {
        paths->resize(most);
      }
      // Copied on a thread of its own: the panel answers on the UI thread, and a video can be large.
      std::thread([self, paths = std::move(*paths), done = std::move(done)] {
        std::vector<Picked> picked;
        for (size_t i = 0; i < paths.size(); i++) {
          if (auto one = self->describe(paths[i], i)) {
            picked.push_back(std::move(*one));
          }
        }
        done(std::move(picked));
      }).detach();
    });
  }

 private:
  // The file copied into the caches, as the picker answers it; nothing when it cannot be copied.
  std::optional<Picked> describe(const std::string &path, size_t index) {
    std::error_code error;
    fs::path source(path);
    // A folder of its own per file keeps two files of one name apart.
    auto folder = fs::path(folder_) / (std::to_string(std::chrono::system_clock::now().time_since_epoch().count()) + "-" + std::to_string(index));
    fs::create_directories(folder, error);
    auto at = folder / source.filename();
    if (error || !fs::copy_file(source, at, fs::copy_options::overwrite_existing, error) || error) {
      return std::nullopt;
    }
    Picked out;
    out.uri = fileUri(at.string());
    out.fileName = source.filename().string();
    out.mimeType = mimeTypeOf(out.fileName);
    auto size = fs::file_size(at, error);
    out.fileSize = error ? 0 : static_cast<double>(size);
    if (out.mimeType.starts_with("video/")) {
      out.type = "video";
      if (auto facts = isoVideoFacts(at.string())) {
        out.width = facts->width;
        out.height = facts->height;
        out.duration = facts->duration;
      }
    } else {
      out.type = "image";
      if (auto measured = imageSize_ ? imageSize_(at.string()) : std::nullopt) {
        out.width = measured->first;
        out.height = measured->second;
      }
    }
    return out;
  }

  std::shared_ptr<FileDialogs> dialogs_;
  std::string folder_;
  std::function<std::optional<std::pair<double, double>>(const std::string &)> imageSize_;
};

} // namespace

std::optional<VideoFacts> isoVideoFacts(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    return std::nullopt;
  }
  in.seekg(0, std::ios::end);
  Box file{"", 0, static_cast<uint64_t>(in.tellg())};
  auto moov = child(in, file, "moov");
  auto mvhd = moov ? child(in, *moov, "mvhd") : std::nullopt;
  if (!mvhd) {
    return std::nullopt;
  }
  VideoFacts facts;
  int version = versionAt(in, *mvhd);
  in.ignore(version == 1 ? 16 : 8);
  double scale = static_cast<double>(readBig(in, 4));
  double duration = static_cast<double>(readBig(in, version == 1 ? 8 : 4));
  facts.duration = scale > 0 ? duration / scale * 1000 : 0;
  for (uint64_t at = moov->start; auto box = boxAt(in, at, moov->end); at = box->end) {
    auto tkhd = box->type == "trak" ? child(in, *box, "tkhd") : std::nullopt;
    if (!tkhd) {
      continue;
    }
    int v = versionAt(in, *tkhd);
    // Times, track id, reserved and duration; then reserved, layer, group, volume and reserved.
    in.ignore((v == 1 ? 32 : 20) + 16);
    int32_t matrix[9];
    for (auto &value : matrix) {
      value = static_cast<int32_t>(readBig(in, 4));
    }
    double width = static_cast<double>(readBig(in, 4)) / 65536;
    double height = static_cast<double>(readBig(in, 4)) / 65536;
    // A sound track has no size.
    if (!in || width <= 0 || height <= 0) {
      continue;
    }
    // Turned a quarter, as a phone's portrait video is: its size as it plays.
    bool turned = matrix[0] == 0 && matrix[4] == 0;
    facts.width = turned ? height : width;
    facts.height = turned ? width : height;
    return facts;
  }
  return facts;
}

folly::dynamic jpegExif(const std::string &bytes) {
  if (bytes.size() < 4 || static_cast<uint8_t>(bytes[0]) != 0xFF || static_cast<uint8_t>(bytes[1]) != 0xD8) {
    return nullptr;
  }
  for (size_t at = 2; at + 4 <= bytes.size();) {
    if (static_cast<uint8_t>(bytes[at]) != 0xFF) {
      return nullptr;
    }
    auto marker = static_cast<uint8_t>(bytes[at + 1]);
    size_t length = (static_cast<uint8_t>(bytes[at + 2]) << 8) | static_cast<uint8_t>(bytes[at + 3]);
    // The image data starts: no EXIF came before it.
    if (marker == 0xDA || marker == 0xD9 || length < 2) {
      return nullptr;
    }
    if (marker == 0xE1 && length >= 16 && bytes.compare(at + 4, 6, std::string("Exif\0\0", 6)) == 0) {
      // The TIFF header: its byte order, 42, and where its first IFD is.
      size_t base = at + 10;
      std::string segment = bytes.substr(0, std::min(bytes.size(), at + 2 + length));
      bool little = segment.compare(base, 2, "II") == 0;
      if (!little && segment.compare(base, 2, "MM") != 0) {
        return nullptr;
      }
      Tiff tiff{segment, base, little};
      if (!tiff.has(0, 8) || tiff.read(2, 2) != 42) {
        return nullptr;
      }
      folly::dynamic out = folly::dynamic::object();
      std::optional<size_t> exif, gps;
      readIfd(tiff, tiff.read(4, 4), mainTags(), out, &exif, &gps);
      if (exif) {
        readIfd(tiff, *exif, mainTags(), out, nullptr, nullptr);
      }
      if (gps) {
        readIfd(tiff, *gps, gpsTags(), out, nullptr, nullptr);
        toDegrees(out, "GPSLatitude");
        toDegrees(out, "GPSLongitude");
      }
      return out;
    }
    at += 2 + length;
  }
  return nullptr;
}

std::shared_ptr<PhotoPicker> makeFilePhotoPicker(std::shared_ptr<FileDialogs> dialogs, std::string folder,
                                                 std::function<std::optional<std::pair<double, double>>(const std::string &path)> imageSize) {
  return std::make_shared<FilePhotoPicker>(std::move(dialogs), std::move(folder), std::move(imageSize));
}

} // namespace ngn
