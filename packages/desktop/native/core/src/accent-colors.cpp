#include "ngn/accent-colors.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace ngn {

namespace {

struct Oklab {
  double L, a, b;
};

double toLinear(double v) {
  return v >= 0.04045 ? std::pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
}

double toGamma(double v) {
  return v > 0.0031308 ? 1.055 * std::pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
}

Oklab oklab(Rgb c) {
  double r = toLinear(c.red), g = toLinear(c.green), b = toLinear(c.blue);
  double l = std::cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  double m = std::cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  double s = std::cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s};
}

Rgb rgb(Oklab c) {
  double l = std::pow(c.L + 0.3963377774 * c.a + 0.2158037573 * c.b, 3);
  double m = std::pow(c.L - 0.1055613458 * c.a - 0.0638541728 * c.b, 3);
  double s = std::pow(c.L - 0.0894841775 * c.a - 1.2914855480 * c.b, 3);
  auto channel = [](double v) { return std::clamp(toGamma(v), 0.0, 1.0); };
  return {channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      channel(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)};
}

Rgb hex(unsigned value) {
  return {((value >> 16) & 0xff) / 255.0, ((value >> 8) & 0xff) / 255.0, (value & 0xff) / 255.0};
}

// libadwaita's accent colour nearest `c`: slate for a grey, else by OKLCh hue.
Rgb nearestAccent(Rgb c) {
  auto lab = oklab(c);
  double chroma = std::hypot(lab.a, lab.b);
  double hue = std::fmod(std::atan2(lab.b, lab.a) * 180 / M_PI + 360, 360);
  if (chroma < 0.04) return hex(0x6f8396);  // slate
  if (hue > 345) return hex(0xd56199);      // pink
  if (hue > 280) return hex(0x9141ac);      // purple
  if (hue > 230) return hex(0x3584e4);      // blue
  if (hue > 175) return hex(0x2190a4);      // teal
  if (hue > 130) return hex(0x3a944a);      // green
  if (hue > 75.5) return hex(0xc88800);     // yellow
  if (hue > 35) return hex(0xed5b00);       // orange
  if (hue > 10) return hex(0xe62d42);       // red
  return hex(0xd56199);                     // pink
}

} // namespace

std::optional<AccentColors> accentColors(Rgb accent, bool dark) {
  auto inRange = [](double v) { return v >= 0 && v <= 1; };
  if (!inRange(accent.red) || !inRange(accent.green) || !inRange(accent.blue)) {
    return std::nullopt;
  }
  Rgb background = nearestAccent(accent);
  auto lab = oklab(background);
  lab.L = dark ? std::max(lab.L, 0.85) : std::min(lab.L, 0.5);
  return AccentColors{.background = background, .foreground = {1, 1, 1}, .standalone = rgb(lab)};
}

std::string cssColor(Rgb color) {
  char out[32];
  auto byte = [](double v) { return static_cast<int>(std::lround(std::clamp(v, 0.0, 1.0) * 255)); };
  std::snprintf(out, sizeof out, "rgb(%d,%d,%d)", byte(color.red), byte(color.green), byte(color.blue));
  return out;
}

std::string accentCss(const AccentColors &colors) {
  return "@define-color accent_bg_color " + cssColor(colors.background) + ";\n@define-color accent_fg_color " +
      cssColor(colors.foreground) + ";\n@define-color accent_color " + cssColor(colors.standalone) + ";\n";
}

} // namespace ngn
