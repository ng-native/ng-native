#include "ngn/svg-markup.h"
#include "svg-recorder.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <chrono>
#include <optional>

#include <string>
#include <vector>

namespace {

using Lines = std::vector<std::string>;

// What `markup` draws in a box `size` points square, its shapes only.
Lines drawnOf(const std::string &markup, double size = 24, std::optional<uint32_t> painted = std::nullopt) {
  auto document = ngn::parseSvgMarkup(markup);
  REQUIRE(document);
  Recorder canvas;
  ngn::drawSvg(painted ? ngn::svgPaintedIn(*document, *painted) : *document, size, size, canvas);
  return canvas.drawn();
}

// Lucide's markup, as `@ng-icons/lucide` ships it: the paint on the root, inherited by each shape.
const std::string lucide =
    R"svg(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" )svg"
    R"svg(stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18" /><rect x="3" y="4" width="18" )svg"
    R"svg(height="16" rx="2" /><circle cx="12" cy="12" r="3" /><polyline points="1 2 3 4" /><line x1="0" y1="0" x2="4" y2="0" /></svg>)svg";

} // namespace

TEST_CASE("an outline icon's shapes take the root's paint, scaled from its viewBox") {
  auto document = ngn::parseSvgMarkup(lucide);
  REQUIRE(document);
  Recorder canvas;
  ngn::drawSvg(*document, 48, 48, canvas);
  CHECK(canvas.calls.at(1) == "concat 2 0 0 2 0 0");
  CHECK(canvas.drawn() == Lines{
                              "stroke M3,12L21,12 w2 cap1 join1 #ff000000",
                              "stroke M5,4L19,4C21,6L21,18C19,20L5,20C3,18L3,6C5,4Z w2 cap1 join1 #ff000000",
                              "stroke M15,12C12,15C9,12C12,9C15,12Z w2 cap1 join1 #ff000000",
                              "stroke M1,2L3,4 w2 cap1 join1 #ff000000",
                              "stroke M0,0L4,0 w2 cap1 join1 #ff000000",
                          });
}

TEST_CASE("a style declaration beats its attribute, and a var() takes its fallback") {
  // Heroicons' outline set, which carries its weight in `--ng-icon__stroke-width`.
  auto drawn = drawnOf(
      R"svg(<svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" )svg"
      R"svg(style="stroke-width: var(--ng-icon__stroke-width, 3)"><path stroke-linecap="square" d="M0 0L1 1"/></svg>)svg");
  CHECK(drawn == Lines{"stroke M0,0L1,1 w3 cap2 join0 #ff000000"});
  // A var() with no fallback still beats the attribute, and leaves the width unset, as in a browser.
  CHECK(drawnOf(R"svg(<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" style="stroke-width: var(--w)"><path d="M0 0L1 1"/></svg>)svg") ==
        Lines{"stroke M0,0L1,1 w1 cap0 join0 #ff000000"});
}

TEST_CASE("a shape with no fill fills black, and painted in a colour fills in that colour") {
  const std::string solid = R"svg(<svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M0 0H16V16Z"/></svg>)svg";
  CHECK(drawnOf(solid, 16) == Lines{"fill M0,0L16,0L16,16Z evenodd #ff000000"});
  CHECK(drawnOf(solid, 16, 0xff336699) == Lines{"fill M0,0L16,0L16,16Z evenodd #ff336699"});
}

TEST_CASE("painted in one colour, every paint keeps its own opacity and none stays none") {
  auto drawn = drawnOf(
      R"svg(<svg viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>)svg"
      R"svg(<path d="M0 0H1" fill="rgba(255, 0, 0, 0.5)" stroke="none"/><path d="M0 0H2" fill="url(#g)"/>)svg"
      R"svg(<path d="M0 0H3" fill="#f00" stroke="currentColor" stroke-opacity="0.25"/><path d="M0 0H4" fill="#ff000080"/></svg>)svg",
      24, 0xff336699);
  CHECK(drawn == Lines{
                     "fill M0,0L1,0 #80336699",
                     "fill M0,0L2,0 #ff336699",
                     "fill M0,0L3,0 #ff336699",
                     "stroke M0,0L3,0 w1 cap0 join0 #ff336699 @0.25",
                     "fill M0,0L4,0 #80336699",
                 });
}

TEST_CASE("groups nest and transform their shapes, and a hidden one draws nothing") {
  auto document = ngn::parseSvgMarkup(
      R"svg(<?xml version="1.0"?><!DOCTYPE svg><!-- an icon --><svg:svg viewBox="0 0 24 24"><title>Box &amp; more</title>)svg"
      R"svg(<g transform="translate(2 3) scale(2)" fill="#000"><rect width="1" height="1"/><g style="display: none"><path d="M0 0H9"/></g></g></svg:svg>)svg");
  REQUIRE(document);
  Recorder canvas;
  ngn::drawSvg(*document, 24, 24, canvas);
  CHECK(std::find(canvas.calls.begin(), canvas.calls.end(), "concat 2 0 0 2 2 3") != canvas.calls.end());
  CHECK(canvas.drawn() == Lines{"fill M0,0L1,0L1,1L0,1Z #ff000000"});
}

TEST_CASE("markup that is not an svg element is no document") {
  CHECK_FALSE(ngn::parseSvgMarkup("lucideBlocks"));
  CHECK_FALSE(ngn::parseSvgMarkup(""));
  CHECK_FALSE(ngn::parseSvgMarkup("<div></div>"));
  CHECK_FALSE(ngn::parseSvgMarkup(R"svg(<svg viewBox="0 0 24 24"><path d="M0 0")svg"));
  CHECK_FALSE(ngn::parseSvgMarkup(R"svg(<svg viewBox=0 0 24 24></svg>)svg"));
  // A closing tag that names another element, or that never ends, closes nothing.
  CHECK_FALSE(ngn::parseSvgMarkup(R"svg(<svg><rect width="8" height="8"/></wrong>)svg"));
  CHECK_FALSE(ngn::parseSvgMarkup(R"svg(<svg><g><rect width="8" height="8"/></svg></g>)svg"));
  CHECK_FALSE(ngn::parseSvgMarkup(R"svg(<svg><rect width="8" height="8"/></svg)svg"));
  CHECK(ngn::parseSvgMarkup(R"svg(<svg><g></g ></svg>)svg"));
  // Nested deeper than any icon: refused rather than read to the end of the stack.
  std::string deep = "<svg>";
  for (int i = 0; i < 10000; i++) {
    deep += "<g>";
  }
  for (int i = 0; i < 10000; i++) {
    deep += "</g>";
  }
  deep += "</svg>";
  CHECK_FALSE(ngn::parseSvgMarkup(deep));
}

TEST_CASE("an svg data uri's markup, percent-encoded or base64") {
  CHECK(ngn::svgMarkupOfUri("data:image/svg+xml;utf8,%3Csvg%20viewBox%3D%220%200%201%201%22%2F%3E") ==
        std::optional<std::string>(R"svg(<svg viewBox="0 0 1 1"/>)svg"));
  CHECK(ngn::svgMarkupOfUri("data:image/svg+xml;base64,PHN2Zy8+") == std::optional<std::string>("<svg/>"));
  // Base64 is percent-encoded too where a uri needs it.
  CHECK(ngn::svgMarkupOfUri("data:image/svg+xml;base64,PHN2Zy8%2B") == std::optional<std::string>("<svg/>"));
  CHECK_FALSE(ngn::svgMarkupOfUri("data:image/png;base64,AAAA"));
  // Another media type that starts as this one does.
  CHECK_FALSE(ngn::svgMarkupOfUri("data:image/svg+xml-extra,%3Csvg%2F%3E"));
  CHECK_FALSE(ngn::svgMarkupOfUri("https://example.com/icon.svg"));
}

TEST_CASE("an rgb() colour's alpha as a number or a percentage, after commas or a slash") {
  auto drawn = drawnOf(
      R"svg(<svg viewBox="0 0 24 24"><path d="M0 0H1" fill="rgba(255, 0, 0, 50%)"/><path d="M0 0H2" fill="rgb(128 0 0 / 0.25)"/>)svg"
      R"svg(<path d="M0 0H3" fill="rgb(50% 0% 100% / 50%)"/><path d="M0 0H4" fill="rgb(1, 2, 3)"/></svg>)svg");
  CHECK(drawn == Lines{
                     "fill M0,0L1,0 #80ff0000",
                     "fill M0,0L2,0 #40800000",
                     "fill M0,0L3,0 #808000ff",
                     "fill M0,0L4,0 #ff010203",
                 });
}

TEST_CASE("painted in one colour, currentColor keeps the opacity of the colour it inherits") {
  auto drawn = drawnOf(
      R"svg(<svg viewBox="0 0 24 24" color="transparent"><path d="M0 0H1" fill="currentColor"/>)svg"
      R"svg(<g color="rgba(0, 0, 0, 0.5)"><path d="M0 0H2" fill="currentColor"/></g><path d="M0 0H3"/></svg>)svg",
      24, 0xff336699);
  CHECK(drawn == Lines{
                     "fill M0,0L1,0 #336699",
                     "fill M0,0L2,0 #80336699",
                     "fill M0,0L3,0 #ff336699",
                 });
}

TEST_CASE("painted in one colour, an inherited currentColor takes the colour of the shape that uses it") {
  auto drawn = drawnOf(
      R"svg(<svg viewBox="0 0 24 24" fill="currentColor"><rect color="transparent" width="1" height="1"/>)svg"
      R"svg(<g color="rgba(0, 0, 0, 0.5)"><path d="M0 0H2"/></g><path d="M0 0H3" fill="#ff000080"/></svg>)svg",
      24, 0xff336699);
  CHECK(drawn == Lines{
                     "fill M0,0L1,0L1,1L0,1Z #336699",
                     "fill M0,0L2,0 #80336699",
                     "fill M0,0L3,0 #80336699",
                 });
}

TEST_CASE("an attribute of many ampersands reads in linear time") {
  std::string many(1000000, '&');
  auto start = std::chrono::steady_clock::now();
  auto document = ngn::parseSvgMarkup(R"svg(<svg viewBox="0 0 1 1" id=")svg" + many + R"svg("/>)svg");
  CHECK(document);
  CHECK(std::chrono::steady_clock::now() - start < std::chrono::seconds(2));
  // A reference still reads, after an ampersand that starts none too.
  CHECK(drawnOf(R"svg(<svg viewBox="0 0 24 24"><path d="M0 0H1" fill="&#35;f00"/><path d="M0 0H2" fill="&&#35;f00" stroke="&#35;f&#48;0&"/></svg>)svg") ==
        Lines{"fill M0,0L1,0 #ffff0000", "fill M0,0L2,0 #ff000000"});
}

TEST_CASE("a shape in defs draws only where a use draws it, moved by the use's x and y") {
  auto document = ngn::parseSvgMarkup(
      R"svg(<svg viewBox="0 0 24 24"><defs><path id="bar" d="M0 0H4"/></defs>)svg"
      R"svg(<use href="#bar" x="2" y="3"/><use xlink:href="#bar"/><use href="#nothing"/></svg>)svg");
  REQUIRE(document);
  Recorder canvas;
  ngn::drawSvg(*document, 24, 24, canvas);
  CHECK(std::find(canvas.calls.begin(), canvas.calls.end(), "concat 1 0 0 1 2 3") != canvas.calls.end());
  CHECK(canvas.drawn() == Lines{"fill M0,0L4,0 #ff000000", "fill M0,0L4,0 #ff000000"});
}

TEST_CASE("a symbol draws only through a use, fitted from its viewBox into the use's width and height") {
  auto document = ngn::parseSvgMarkup(
      R"svg(<svg viewBox="0 0 24 24"><symbol id="dot" viewBox="0 0 2 2"><rect width="2" height="1"/></symbol>)svg"
      R"svg(<use href="#dot" width="12" height="12"/></svg>)svg");
  REQUIRE(document);
  Recorder canvas;
  ngn::drawSvg(*document, 24, 24, canvas);
  CHECK(std::find(canvas.calls.begin(), canvas.calls.end(), "concat 6 0 0 6 0 0") != canvas.calls.end());
  CHECK(canvas.drawn() == Lines{"fill M0,0L2,0L2,1L0,1Z #ff000000"});
}

TEST_CASE("a used shape takes the use's paint, and painted in one colour takes that colour") {
  // A sprite's shape: the geometry in a symbol, the paint on the use.
  const std::string sprite =
      R"svg(<svg viewBox="0 0 24 24"><defs><symbol id="s" viewBox="0 0 24 24"><path d="M0 0H5"/></symbol></defs>)svg"
      R"svg(<use href="#s" fill="none" stroke="currentColor" stroke-width="2"/></svg>)svg";
  CHECK(drawnOf(sprite, 24, 0xff336699) == Lines{"stroke M0,0L5,0 w2 cap0 join0 #ff336699"});
}

TEST_CASE("uses that each draw the one before twice stop drawing at a bound, rather than doubling forty times") {
  // Markup from a server can nest uses so each level doubles what the one below draws.
  std::string markup = R"svg(<svg viewBox="0 0 24 24"><defs><path id="u0" d="M0 0H1"/>)svg";
  for (int i = 1; i <= 40; i++) {
    auto below = "#u" + std::to_string(i - 1);
    markup += "<g id=\"u" + std::to_string(i) + "\"><use href=\"" + below + "\"/><use href=\"" + below + "\"/></g>";
  }
  markup += R"svg(</defs><use href="#u40"/></svg>)svg";
  auto start = std::chrono::steady_clock::now();
  auto drawn = drawnOf(markup);
  CHECK(std::chrono::steady_clock::now() - start < std::chrono::seconds(2));
  CHECK_FALSE(drawn.empty());
  CHECK(drawn.size() <= (1 << 16));
}

TEST_CASE("a use that leads back to itself draws nothing, and ends") {
  CHECK(drawnOf(R"svg(<svg viewBox="0 0 24 24"><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></svg>)svg").empty());
}
