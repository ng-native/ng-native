// `@expo/ui`'s SwiftUI views on macOS (expo-ui-renderer.mm and expo-ui.swift), drawn offscreen into
// bitmaps in a window that is never shown, their fitting sizes, and their events, sent as the user
// would set each control.
#include "../expo-ui-renderer.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>

#include <map>
#include <tuple>
#include <vector>

using folly::dynamic;
using ngn::ExpoUINode;
using ngn::appkit::ExpoUIRenderer;

namespace {

ExpoUINode ui(int tag, const char *name, dynamic props = dynamic::object(), std::vector<ExpoUINode> children = {}) {
  return ExpoUINode{.tag = tag, .name = name, .props = std::move(props), .children = std::move(children)};
}

std::shared_ptr<const ExpoUINode> host(std::vector<ExpoUINode> children, dynamic props = dynamic::object()) {
  return std::make_shared<const ExpoUINode>(ui(1, "HostView", std::move(props), std::move(children)));
}

struct Event {
  int tag;
  std::string name;
  dynamic payload;
};

// A renderer whose events are kept in order.
struct Harness {
  std::vector<Event> events;
  std::map<int, NSView *> embedded;
  ExpoUIRenderer renderer{
      [this](facebook::react::Tag tag, const std::string &name, dynamic payload) {
        events.push_back({tag, name, std::move(payload)});
      },
      [this](facebook::react::Tag tag) -> NSView * {
        auto found = embedded.find(tag);
        return found == embedded.end() ? nil : found->second;
      }};
};

void spin(double seconds) {
  [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}

// The renderer's view drawn at `size` in a window that is never ordered in: its pixels, RGBA.
struct Drawn {
  int width{0}, height{0};
  std::vector<uint8_t> pixels;

  std::tuple<int, int, int, int> at(int x, int y) const {
    auto i = static_cast<size_t>((y * width + x) * 4);
    return {pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]};
  }
  // How many pixels are not the background, the top left pixel's colour.
  int ink() const {
    auto background = at(0, 0);
    int count = 0;
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        auto [r, g, b, a] = at(x, y);
        auto [br, bg, bb, ba] = background;
        if (std::abs(r - br) + std::abs(g - bg) + std::abs(b - bb) + std::abs(a - ba) > 60) {
          count++;
        }
      }
    }
    return count;
  }
  // How many pixels differ from `other`'s.
  int differs(const Drawn &other) const {
    int count = 0;
    for (size_t i = 0; i + 3 < pixels.size() && i + 3 < other.pixels.size(); i += 4) {
      int d = 0;
      for (size_t c = 0; c < 4; c++) {
        d += std::abs(pixels[i + c] - other.pixels[i + c]);
      }
      count += d > 60 ? 1 : 0;
    }
    return count;
  }
  // How many pixels are strongly red.
  int red() const {
    int count = 0;
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        auto [r, g, b, a] = at(x, y);
        count += (a > 200 && r > 200 && g < 60 && b < 60) ? 1 : 0;
      }
    }
    return count;
  }
};

Drawn draw(ExpoUIRenderer &renderer, int width, int height) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, width, height)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  NSView *view = renderer.view();
  view.frame = NSMakeRect(0, 0, width, height);
  [window.contentView addSubview:view];
  for (int i = 0; i < 5; i++) {
    [view layoutSubtreeIfNeeded];
    spin(0.02);
  }
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr
                                                                  pixelsWide:width
                                                                  pixelsHigh:height
                                                               bitsPerSample:8
                                                             samplesPerPixel:4
                                                                    hasAlpha:YES
                                                                    isPlanar:NO
                                                              colorSpaceName:NSDeviceRGBColorSpace
                                                                 bytesPerRow:width * 4
                                                                bitsPerPixel:32];
  NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = context;
  [NSColor.whiteColor setFill];
  NSRectFill(NSMakeRect(0, 0, width, height));
  [NSGraphicsContext restoreGraphicsState];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  [view removeFromSuperview];
  [window close];
  Drawn drawn{width, height, std::vector<uint8_t>(rep.bitmapData, rep.bitmapData + width * height * 4)};
  return drawn;
}

} // namespace

TEST_CASE("the SwiftUI renderer draws every view the core registers") {
  [NSApplication sharedApplication];
  for (const auto &view : ngn::expoUIViews()) {
    CHECK_MESSAGE(ExpoUIRenderer::draws(view), view);
  }
  CHECK_FALSE(ExpoUIRenderer::draws("SyncToggleView"));
  CHECK_FALSE(ExpoUIRenderer::draws("ToolbarView"));
}

TEST_CASE("an expo/ui tree goes to SwiftUI as JSON with its tags, names and props") {
  auto tree = ui(1, "HostView", dynamic::object("matchContentsVertical", true),
                 {ui(2, "PickerView", dynamic::object("label", "Room"), {ui(3, "SlotView", dynamic::object("name", "content"))})});
  auto json = ExpoUIRenderer::json(tree);
  CHECK(json["tag"] == 1);
  CHECK(json["children"][0]["name"] == "PickerView");
  CHECK(json["children"][0]["props"]["label"] == "Room");
  CHECK(json["children"][0]["children"][0]["props"]["name"] == "content");
}

TEST_CASE("text draws ink, and an empty host draws none and fits in nothing") {
  [NSApplication sharedApplication];
  Harness h;
  h.renderer.setTree(host({}));
  CHECK(draw(h.renderer, 120, 40).ink() == 0);
  auto empty = h.renderer.fit(-1, -1);
  CHECK(empty.width == 0);

  h.renderer.setTree(host({ui(2, "TextView", dynamic::object("text", "Kitchen"))}));
  CHECK(draw(h.renderer, 120, 40).ink() > 40);
  auto size = h.renderer.fit(-1, -1);
  CHECK(size.width > 20);
  CHECK(size.height > 8);
  CHECK(size.height < 40);

  // A foreground colour modifier reaches the text.
  h.renderer.setTree(host({ui(2, "TextView",
                              dynamic::object("text", "Kitchen")("modifiers",
                                  dynamic::array(dynamic::object("$type", "foregroundStyle")(
                                      "style", dynamic::object("type", "color")("color", "#FF0000")))))}));
  CHECK(draw(h.renderer, 120, 40).red() > 10);
}

TEST_CASE("a picker shows its selection and sends selectionChange with expo/ui's payload") {
  [NSApplication sharedApplication];
  Harness h;
  auto picker = [](dynamic selection) {
    auto options = std::vector<ExpoUINode>{
        ui(4, "TextView", dynamic::object("text", "Kitchen")("modifiers", dynamic::array(dynamic::object("$type", "tag")("tag", "kitchen")))),
        ui(5, "TextView", dynamic::object("text", "Garden")("modifiers", dynamic::array(dynamic::object("$type", "tag")("tag", "garden")))),
    };
    return host({ui(2, "PickerView",
                    dynamic::object("label", "Room")("selection", selection)(
                        "modifiers", dynamic::array(dynamic::object("$type", "pickerStyle")("style", "segmented"))),
                    {ui(3, "SlotView", dynamic::object("name", "content"), options)})});
  };
  h.renderer.setTree(picker("kitchen"));
  auto kitchen = draw(h.renderer, 240, 40);
  CHECK(kitchen.ink() > 100);
  auto fitted = h.renderer.fit(-1, -1);
  CHECK(fitted.width > 60);
  CHECK(fitted.height > 10);

  h.renderer.setTree(picker("garden"));
  auto garden = draw(h.renderer, 240, 40);
  CHECK(garden.differs(kitchen) > 20);
  CHECK(h.events.empty());

  // The user picks: the event says what, and the picker shows it before the prop catches up.
  CHECK(h.renderer.perform(2, dynamic::object("selection", "kitchen")));
  REQUIRE(h.events.size() == 1);
  CHECK(h.events[0].tag == 2);
  CHECK(h.events[0].name == "selectionChange");
  CHECK(h.events[0].payload == dynamic::object("selection", "kitchen"));
  CHECK(draw(h.renderer, 240, 40).differs(kitchen) < 20);

  // A number selection comes back a number.
  CHECK(h.renderer.perform(2, dynamic::object("selection", 3)));
  CHECK(h.events.back().payload["selection"] == 3.0);
  CHECK_FALSE(h.renderer.perform(99, dynamic::object("selection", "x")));
}

TEST_CASE("a date picker sends dateChange in milliseconds, and takes its selection as ISO text") {
  [NSApplication sharedApplication];
  Harness h;
  auto picker = [](const char *iso) {
    return host({ui(2, "DatePickerView", dynamic::object("selection", iso)("displayedComponents", dynamic::array("date")))});
  };
  h.renderer.setTree(picker("2026-01-05T12:00:00.000Z"));
  auto january = draw(h.renderer, 200, 30);
  CHECK(january.ink() > 50);
  h.renderer.setTree(picker("2026-07-21T12:00:00.000Z"));
  CHECK(draw(h.renderer, 200, 30).differs(january) > 20);

  CHECK(h.renderer.perform(2, dynamic::object("date", 1767614400000.0)));
  REQUIRE(h.events.size() == 1);
  CHECK(h.events[0].name == "dateChange");
  CHECK(h.events[0].payload["date"].asDouble() == doctest::Approx(1767614400000.0));
}

TEST_CASE("a toggle, a slider and a stepper send their changes as expo/ui does") {
  [NSApplication sharedApplication];
  Harness h;
  auto toggle = [](bool on) { return host({ui(2, "ToggleView", dynamic::object("isOn", on)("label", "Wi-Fi"))}); };
  h.renderer.setTree(toggle(false));
  auto off = draw(h.renderer, 160, 30);
  h.renderer.setTree(toggle(true));
  CHECK(draw(h.renderer, 160, 30).differs(off) > 20);
  CHECK(h.renderer.perform(2, dynamic::object("isOn", false)));
  CHECK(h.events.back().name == "isOnChange");
  CHECK(h.events.back().payload == dynamic::object("isOn", false));
  // What the user set shows until the prop changes.
  CHECK(draw(h.renderer, 160, 30).differs(off) < 20);

  h.events.clear();
  auto slider = [](double value) { return host({ui(3, "SliderView", dynamic::object("value", value)("min", 0)("max", 10))}); };
  h.renderer.setTree(slider(2));
  auto low = draw(h.renderer, 200, 30);
  h.renderer.setTree(slider(8));
  CHECK(draw(h.renderer, 200, 30).differs(low) > 20);
  CHECK(h.renderer.perform(3, dynamic::object("value", 12)));
  REQUIRE(h.events.size() == 2);
  CHECK(h.events[0].name == "editingChanged");
  CHECK(h.events[1].name == "valueChanged");
  // Clamped to the slider's range, and counted.
  CHECK(h.events[1].payload["value"] == 10.0);
  CHECK(h.events[1].payload["eventCount"] == 1);
  CHECK(h.renderer.perform(3, dynamic::object("value", 4)));
  CHECK(h.events.back().payload["eventCount"] == 2);

  h.events.clear();
  h.renderer.setTree(host({ui(4, "StepperView", dynamic::object("label", "Guests")("value", 2)("min", 1)("max", 8))}));
  CHECK(draw(h.renderer, 200, 30).ink() > 40);
  CHECK(h.renderer.perform(4, dynamic::object("value", 3)));
  CHECK(h.events.back().name == "valueChange");
  CHECK(h.events.back().payload == dynamic::object("value", 3));
}

TEST_CASE("a button presses, a text field types, and a colour picker reports hex") {
  [NSApplication sharedApplication];
  Harness h;
  h.renderer.setTree(host({
      ui(2, "Button", dynamic::object("label", "Save")),
      ui(3, "TextFieldView", dynamic::object("placeholder", "Name")("maxLength", 3)),
      ui(4, "ColorPickerView", dynamic::object("selection", "#FF0000")("label", "Tint")),
  }));
  CHECK(draw(h.renderer, 240, 120).ink() > 100);
  CHECK(h.renderer.perform(2, dynamic::object()));
  CHECK(h.events.back().name == "buttonPress");
  CHECK(h.renderer.perform(3, dynamic::object("text", "Ada")));
  CHECK(h.events.back().name == "textChange");
  CHECK(h.events.back().payload == dynamic::object("value", "Ada"));
  CHECK(h.renderer.perform(4, dynamic::object("value", "#00ff00")));
  CHECK(h.events.back().name == "selectionChange");
  CHECK(h.events.back().payload == dynamic::object("value", "#00FF00FF"));
}

TEST_CASE("forms, sections, gauges, progress and the rest of the views draw") {
  [NSApplication sharedApplication];
  Harness h;
  auto label = [](int tag, const char *text) { return ui(tag, "TextView", dynamic::object("text", text)); };
  std::vector<std::pair<const char *, ExpoUINode>> views = {
      {"Form", ui(2, "FormView", dynamic::object(),
                  {ui(3, "SectionView", dynamic::object("title", "Account"), {label(4, "Signed in")})})},
      {"Gauge", ui(2, "GaugeView", dynamic::object("value", 0.6))},
      {"Progress", ui(2, "ProgressView", dynamic::object("value", 0.5))},
      {"Labeled content", ui(2, "LabeledContentView", dynamic::object("label", "Plan"), {label(3, "Pro")})},
      {"Label", ui(2, "LabelView", dynamic::object("title", "Inbox")("systemImage", "tray"))},
      {"Image", ui(2, "ImageView", dynamic::object("systemName", "star.fill"))},
      {"Menu", ui(2, "MenuView", dynamic::object("label", "Sort"), {ui(3, "Button", dynamic::object("label", "Name"))})},
      {"Disclosure", ui(2, "DisclosureGroupView", dynamic::object("label", "More"), {label(3, "Hidden")})},
      {"Stack", ui(2, "HStackView", dynamic::object("spacing", 4), {label(3, "A"), ui(4, "SpacerView"), label(5, "B")})},
      {"Shape", ui(2, "RoundedRectangleView", dynamic::object("cornerRadius", 6)("modifiers",
          dynamic::array(dynamic::object("$type", "foregroundStyle")("style", dynamic::object("type", "color")("color", "#FF0000")))))},
      {"Chart", ui(2, "ChartView", dynamic::object("type", "bar")("data",
          dynamic::array(dynamic::object("x", "Mon")("y", 3), dynamic::object("x", "Tue")("y", 5))))},
      {"Content unavailable", ui(2, "ContentUnavailableView", dynamic::object("title", "No mail")("systemImage", "tray"))},
      {"Control group", ui(2, "ControlGroupView", dynamic::object(), {ui(3, "Button", dynamic::object("label", "A")), ui(4, "Button", dynamic::object("label", "B"))})},
      {"Link", ui(2, "LinkView", dynamic::object("label", "Docs")("destination", "https://example.com"))},
  };
  for (auto &[name, view] : views) {
    h.renderer.setTree(host({view}));
    CHECK_MESSAGE(draw(h.renderer, 240, 160).ink() > 30, name);
  }
}

TEST_CASE("presentations and disclosures send their state as the user changes it") {
  [NSApplication sharedApplication];
  Harness h;
  h.renderer.setTree(host({
      ui(2, "AlertView", dynamic::object("title", "Delete?")("isPresented", true)),
      ui(3, "BottomSheetView", dynamic::object("isPresented", true)),
      ui(4, "DisclosureGroupView", dynamic::object("label", "More")("isExpanded", true)),
  }));
  CHECK(h.renderer.perform(2, dynamic::object("isPresented", false)));
  CHECK(h.events.back().name == "isPresentedChange");
  CHECK(h.events.back().payload == dynamic::object("isPresented", false));
  // A sheet dismissed also sends dismiss.
  CHECK(h.renderer.perform(3, dynamic::object("isPresented", false)));
  CHECK(h.events.back().name == "dismiss");
  CHECK(h.events[h.events.size() - 2].name == "isPresentedChange");
  CHECK(h.renderer.perform(4, dynamic::object("isExpanded", false)));
  CHECK(h.events.back().payload == dynamic::object("isExpanded", false));
  // Setting what is already so sends nothing.
  auto before = h.events.size();
  CHECK(h.renderer.perform(2, dynamic::object("isPresented", false)));
  CHECK(h.events.size() == before);
}

TEST_CASE("an RNHostView holds the app's own view in the SwiftUI content") {
  [NSApplication sharedApplication];
  Harness h;
  NSView *own = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 50, 20)];
  own.wantsLayer = YES;
  own.layer.backgroundColor = NSColor.redColor.CGColor;
  h.embedded[3] = own;
  h.renderer.setTree(host({ui(2, "VStackView", dynamic::object(), {ui(3, "RNHostView")})}));
  auto drawn = draw(h.renderer, 100, 60);
  CHECK(static_cast<bool>(own.superview != nil));
  CHECK([own isDescendantOf:h.renderer.view()]);
  CHECK(drawn.red() > 400);
  auto size = h.renderer.fit(-1, -1);
  CHECK(size.width == doctest::Approx(50));
  CHECK(size.height == doctest::Approx(20));
}
