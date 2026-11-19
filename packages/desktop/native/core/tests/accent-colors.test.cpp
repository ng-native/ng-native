#include "ngn/accent-colors.h"

#include <doctest/doctest.h>

using ngn::accentColors;
using ngn::cssColor;
using ngn::Rgb;

TEST_CASE("the desktop's accent is libadwaita's nearest accent colour, with white text on it") {
  // GNOME's own purple, and a purple of the user's own: both libadwaita's purple.
  CHECK(cssColor(accentColors({0x91 / 255.0, 0x41 / 255.0, 0xac / 255.0}, false)->background) == "rgb(145,65,172)");
  CHECK(cssColor(accentColors({0.6, 0.2, 0.8}, false)->background) == "rgb(145,65,172)");
  CHECK(cssColor(accentColors({0.1, 0.8, 0.2}, false)->background) == "rgb(58,148,74)");
  // A grey is slate.
  CHECK(cssColor(accentColors({0.5, 0.5, 0.5}, true)->background) == "rgb(111,131,150)");
  CHECK(cssColor(accentColors({0.6, 0.2, 0.8}, false)->foreground) == "rgb(255,255,255)");
}

TEST_CASE("the accent as text is darkened on a light window and lightened on a dark one") {
  // libadwaita 1.6's blue: #3584e4 as the background, #0461be as text on light, #81d0ff on dark.
  auto light = accentColors({0x35 / 255.0, 0x84 / 255.0, 0xe4 / 255.0}, false);
  auto dark = accentColors({0x35 / 255.0, 0x84 / 255.0, 0xe4 / 255.0}, true);
  CHECK(cssColor(light->background) == "rgb(53,132,228)");
  CHECK(cssColor(light->standalone) == "rgb(4,97,190)");
  CHECK(cssColor(dark->standalone) == "rgb(129,208,255)");
}

TEST_CASE("a portal colour out of range is no accent, and the CSS defines libadwaita's three names") {
  CHECK_FALSE(accentColors({-1, -1, -1}, false).has_value());
  CHECK_FALSE(accentColors({0.2, 1.5, 0.2}, false).has_value());
  auto css = ngn::accentCss(*accentColors({0x35 / 255.0, 0x84 / 255.0, 0xe4 / 255.0}, false));
  CHECK(css == "@define-color accent_bg_color rgb(53,132,228);\n@define-color accent_fg_color rgb(255,255,255);\n"
               "@define-color accent_color rgb(4,97,190);\n");
}
