// The accent colours a libadwaita app draws with, from the desktop's accent colour (the settings
// portal's org.freedesktop.appearance accent-color), as libadwaita 1.6 works them out for its own
// stylesheet: the nearest of its nine accent colours by OKLCh hue, as the background, white text on
// it, and the accent as text or an icon on the window's background, its OKLab lightness at most 0.5
// in a light style and at least 0.85 in a dark one so it reads (adw-accent-color.c).
// libadwaita 1.6 and later follow the portal themselves; the GTK host applies these below 1.6.
#pragma once

#include <optional>
#include <string>

namespace ngn {

// sRGB, each channel 0 to 1.
struct Rgb {
  double red{0};
  double green{0};
  double blue{0};
  bool operator==(const Rgb &other) const = default;
};

struct AccentColors {
  Rgb background;
  Rgb foreground;
  Rgb standalone;
  bool operator==(const AccentColors &other) const = default;
};

// Nothing for a portal colour out of range, the portal's way of saying the desktop sets none.
std::optional<AccentColors> accentColors(Rgb accent, bool dark);

// The colour as CSS writes it, `rgb(53,132,228)`.
std::string cssColor(Rgb color);

// GTK CSS defining libadwaita's accent_bg_color, accent_fg_color and accent_color as `colors`.
std::string accentCss(const AccentColors &colors);

} // namespace ngn
