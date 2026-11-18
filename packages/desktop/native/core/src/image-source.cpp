#include "ngn/image-source.h"

#include <cmath>
#include <limits>

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

} // namespace ngn
