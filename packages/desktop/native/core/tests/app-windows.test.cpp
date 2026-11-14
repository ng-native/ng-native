#include "fake-system.h"
#include "ngn/app-windows.h"

#include <doctest/doctest.h>
#include <folly/json.h>

using folly::dynamic;
using ngn::SurfaceId;
using ngn::WindowFrame;
using ngn::WindowHost;
using ngn::WindowRequest;
using ngn::testing::FakeSystem;

namespace {

std::string sortedJson(const dynamic &value) {
  folly::json::serialization_opts opts;
  opts.sort_keys = true;
  return folly::json::serialize(value, opts);
}

// Windows that open at once, and a log of what the core asked for.
struct FakeWindows final : ngn::WindowBackend {
  struct Opened {
    SurfaceId surface;
    WindowRequest request;
    WindowFrame frame;
    bool restored;
  };
  std::vector<Opened> opened;
  std::vector<SurfaceId> closed;
  std::vector<SurfaceId> focused;
  std::vector<std::pair<SurfaceId, std::string>> titles;
  std::vector<std::string> quits;
  WindowHost *host = nullptr;

  void openWindow(SurfaceId surface, const WindowRequest &request, const ngn::WindowPlacement &placement,
                  std::function<void()> opened_) override {
    opened.push_back({surface, request, placement.frame, placement.restored});
    opened_();
  }
  void closeWindow(SurfaceId surface) override {
    closed.push_back(surface);
  }
  void focusWindow(SurfaceId surface) override {
    focused.push_back(surface);
  }
  void setWindowTitle(SurfaceId surface, const std::string &title) override {
    titles.emplace_back(surface, title);
  }
  // As AppKit does: terminate: asks whether to quit, which the core answers.
  void beginQuit() override {
    quits.push_back("begin");
    switch (host->quitRequested()) {
      case ngn::QuitReply::Now:
        quits.push_back("now");
        break;
      case ngn::QuitReply::Later:
        quits.push_back("later");
        break;
      case ngn::QuitReply::Cancel:
        quits.push_back("cancel");
        break;
    }
  }
  void replyToQuit(bool proceed) override {
    quits.push_back(proceed ? "reply yes" : "reply no");
  }
  std::vector<std::pair<double, std::function<void()>>> timers;
  void after(double seconds, std::function<void()> task) override {
    timers.emplace_back(seconds, std::move(task));
  }
};

struct Fixture {
  std::shared_ptr<FakeSystem> system = std::make_shared<FakeSystem>();
  std::shared_ptr<FakeWindows> windows = std::make_shared<FakeWindows>();
  std::shared_ptr<WindowHost> host = std::make_shared<WindowHost>(windows, system);
  std::shared_ptr<ngn::NativeModule> module;
  std::vector<std::string> events;

  Fixture() {
    windows->host = host.get();
  }

  // The app's module, listening as the app does once it starts.
  ngn::NativeModule &app() {
    if (!module) {
      module = ngn::makeWindowsModule(host);
      module->setEmitter([this](const std::string &event, dynamic body) {
        events.push_back(event + " " + sortedJson(body));
      });
    }
    return *module;
  }

  SurfaceId open(dynamic request) {
    std::string out;
    app().callWithPromise(
        "open", dynamic::array(request),
        {[&out](dynamic v) { out = folly::toJson(v); }, [&out](const std::string &m) { out = "rejected " + m; }});
    return static_cast<SurfaceId>(std::stoi(out));
  }
};

dynamic request(dynamic key, std::string title = "Notes") {
  return dynamic::object("key", key)("title", title);
}

} // namespace

TEST_CASE("NgNativeWindows says the OS has windows, and opens one with its own surface for each request") {
  Fixture f;
  CHECK(f.app().call("getConstants")["multipleWindows"] == true);

  auto main = f.open(dynamic::object("key", "main")("title", "Notes")("width", 800)("height", 500)(
      "minWidth", 400)("titleBar", "transparent")("resizable", false));
  auto second = f.open(request(nullptr, "Second"));
  // Root tags end in 1, as React Native's do, and the app's own surface is 1.
  CHECK(main == 11);
  CHECK(second == 21);
  REQUIRE(f.windows->opened.size() == 2);
  const auto &first = f.windows->opened[0];
  CHECK(first.request.key == std::optional<std::string>("main"));
  CHECK(first.request.title == "Notes");
  CHECK(first.request.minWidth == 400);
  CHECK(first.request.resizable == false);
  CHECK(first.request.titleBar == ngn::TitleBar::Transparent);
  CHECK(first.frame.width == 800);
  CHECK(first.frame.height == 500);
  CHECK_FALSE(first.restored);
  // Sizes left out are the host's default.
  CHECK(f.windows->opened[1].frame.width == ngn::kDefaultWindowWidth);
  CHECK(f.windows->opened[1].frame.height == ngn::kDefaultWindowHeight);
  CHECK(f.windows->opened[1].request.titleBar == ngn::TitleBar::Default);

  f.app().call("setTitle", dynamic::array(main, "Draft"));
  f.app().call("focus", dynamic::array(second));
  f.app().call("close", dynamic::array(second));
  CHECK(f.windows->titles == std::vector<std::pair<SurfaceId, std::string>>{{11, "Draft"}});
  CHECK(f.windows->focused == std::vector<SurfaceId>{21});
  CHECK(f.windows->closed == std::vector<SurfaceId>{21});
  CHECK(f.host->surfaces() == std::vector<SurfaceId>{11});
  // A surface that is not a window is left alone.
  f.app().call("close", dynamic::array(21));
  f.app().call("setTitle", dynamic::array(99, "x"));
  CHECK(f.windows->closed.size() == 1);
  CHECK(f.windows->titles.size() == 1);
}

TEST_CASE("the close button asks the app, which closes the window itself") {
  Fixture f;
  auto surface = f.open(request("main"));
  CHECK_FALSE(f.host->closeRequested(surface));
  CHECK(f.events == std::vector<std::string>{"ngNativeWindows {\"surface\":11,\"type\":\"closeRequest\"}"});
  CHECK(f.windows->closed.empty());

  // A window the app does not know closes as AppKit would, rather than staying stuck.
  CHECK(f.host->closeRequested(51));
}

TEST_CASE("with no app listening, the close button and quitting do what the OS would") {
  Fixture f;
  f.host->open(WindowRequest{.key = "main"}, [](SurfaceId) {});
  CHECK(f.host->closeRequested(11));
  CHECK(f.host->surfaces().empty());
  CHECK(f.host->quitRequested() == ngn::QuitReply::Now);
}

TEST_CASE("quitting waits for the app's answer, and asks once while it waits") {
  Fixture f;
  f.open(request("main"));
  CHECK(f.host->quitRequested() == ngn::QuitReply::Later);
  CHECK(f.host->quitRequested() == ngn::QuitReply::Later);
  CHECK(f.events == std::vector<std::string>{"ngNativeWindows {\"type\":\"quitRequest\"}"});

  f.app().call("answerQuit", dynamic::array(false));
  CHECK(f.windows->quits == std::vector<std::string>{"reply no"});
  // Asked again once the first is answered.
  CHECK(f.host->quitRequested() == ngn::QuitReply::Later);
  CHECK(f.events.size() == 2);
  f.app().call("answerQuit", dynamic::array(true));
  CHECK(f.windows->quits == std::vector<std::string>{"reply no", "reply yes"});
  // Quitting closes no window and sends nothing more: the app's list of windows to restore on
  // the next launch is what it was when it agreed.
  CHECK(f.events.size() == 2);
  CHECK(f.windows->closed.empty());
}

TEST_CASE("quit() starts quitting as Cmd-Q does, and comes back as a request") {
  Fixture f;
  f.open(request("main"));
  f.app().call("quit");
  CHECK(f.windows->quits == std::vector<std::string>{"begin", "later"});
  CHECK(f.events.back() == "ngNativeWindows {\"type\":\"quitRequest\"}");

  // An answer nobody asked for that says yes quits; one that says no does nothing.
  Fixture g;
  g.open(request("main"));
  g.app().call("answerQuit", dynamic::array(false));
  CHECK(g.windows->quits.empty());
  g.app().call("answerQuit", dynamic::array(true));
  CHECK(g.windows->quits == std::vector<std::string>{"begin", "now"});
}

TEST_CASE("focus, resize and a Dock click with no window reach the app") {
  Fixture f;
  auto surface = f.open(request("main"));
  f.host->focused(surface);
  f.host->focused(surface);
  f.host->focused(std::nullopt);
  f.host->resized(surface, {.x = 0, .y = 0, .width = 900, .height = 600}, 2);
  f.host->reopen(true);
  f.host->reopen(false);
  CHECK(f.events == std::vector<std::string>{
                        "ngNativeWindows {\"surface\":11,\"type\":\"focus\"}",
                        "ngNativeWindows {\"surface\":null,\"type\":\"focus\"}",
                        "ngNativeWindows {\"height\":600,\"scale\":2,\"surface\":11,\"type\":\"resize\",\"width\":900}",
                        "ngNativeWindows {\"type\":\"reopen\"}",
                    });
  CHECK(f.host->focusedSurface() == std::nullopt);
}

TEST_CASE("a window's frame autosaves under its key and is restored when it opens again") {
  Fixture f;
  auto main = f.open(request("main"));
  f.host->moved(main, {.x = 100, .y = 200, .width = 900, .height = 640});
  f.host->resized(main, {.x = 100, .y = 180, .width = 900, .height = 660}, 2);
  auto keyless = f.open(request(nullptr));
  f.host->moved(keyless, {.x = 5, .y = 5, .width = 300, .height = 300});
  CHECK(f.system->preferences.size() == 1);
  f.app().call("close", dynamic::array(main));

  // A later launch, with the same preferences.
  Fixture g;
  g.system = f.system;
  g.host = std::make_shared<WindowHost>(g.windows, g.system);
  g.windows->host = g.host.get();
  g.open(dynamic::object("key", "main")("title", "Notes")("width", 400)("height", 300));
  const auto &opened = g.windows->opened[0];
  CHECK(opened.restored);
  CHECK(opened.frame == WindowFrame{.x = 100, .y = 180, .width = 900, .height = 660});
  g.open(request("other"));
  CHECK_FALSE(g.windows->opened[1].restored);
}

TEST_CASE("a restored frame keeps to the window's size limits, and a fixed-size window keeps its size") {
  Fixture f;
  f.system->preferences["NgNativeWindowFrame main"] =
      dynamic::object("x", 10)("y", 20)("width", 2000)("height", 100);
  f.open(dynamic::object("key", "main")("title", "")("maxWidth", 1200)("minHeight", 300));
  CHECK(f.windows->opened[0].frame == WindowFrame{.x = 10, .y = 20, .width = 1200, .height = 300});

  f.system->preferences["NgNativeWindowFrame tool"] =
      dynamic::object("x", 10)("y", 20)("width", 2000)("height", 100);
  f.open(dynamic::object("key", "tool")("title", "")("width", 320)("height", 240)("resizable", false));
  CHECK(f.windows->opened[1].frame == WindowFrame{.x = 10, .y = 20, .width = 320, .height = 240});

  // A saved value that is not a frame is ignored.
  f.system->preferences["NgNativeWindowFrame bad"] = dynamic::object("x", "left")("width", -4);
  f.open(request("bad"));
  CHECK_FALSE(f.windows->opened[2].restored);
}

TEST_CASE("the first module is no reload; a later one closes the windows with no key and gives the rest back to the app by key") {
  Fixture f;
  auto main = f.open(request("main"));
  auto keyless = f.open(request(nullptr, "Scratch"));
  auto prefs = f.open(request("prefs", "Settings"));
  CHECK(f.windows->timers.empty());

  // The reloaded runtime's module.
  f.module.reset();
  f.events.clear();
  CHECK(f.windows->closed.empty());
  f.app();
  CHECK(f.windows->closed == std::vector<SurfaceId>{keyless});
  CHECK(f.open(request("main", "Notes again")) == main);
  CHECK(f.windows->opened.size() == 3);
  CHECK(f.windows->titles.back() == std::pair<SurfaceId, std::string>{main, "Notes again"});
  // Claimed once: a second window with the key is a new one.
  CHECK(f.open(request("main")) == 41);

  // The windows the reloaded app never asked for go, a little later.
  REQUIRE(f.windows->timers.size() == 1);
  CHECK(f.windows->timers[0].first == WindowHost::kClaimSeconds);
  CHECK(f.windows->closed.size() == 1);
  f.windows->timers[0].second();
  CHECK(f.windows->closed == std::vector<SurfaceId>{keyless, prefs});
  CHECK(f.host->surfaces() == std::vector<SurfaceId>{main, 41});
}
