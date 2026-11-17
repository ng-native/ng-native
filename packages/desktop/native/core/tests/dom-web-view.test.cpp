#include "fake-backend.h"
#include "ngn/dom-web-view.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>

using namespace facebook::react;

namespace {

struct Parser {
  std::shared_ptr<const ContextContainer> context = std::make_shared<const ContextContainer>();
  ngn::DomWebViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  std::shared_ptr<const ngn::DomWebViewProps> props(folly::dynamic raw, Props::Shared source = nullptr) {
    return std::static_pointer_cast<const ngn::DomWebViewProps>(descriptor.cloneProps(parserContext, source, RawProps(std::move(raw))));
  }
};

} // namespace

TEST_CASE("<dom-component>'s view is a component of the host, by @expo/dom-webview's name") {
  CHECK(std::string(ngn::DomWebViewComponentName) == "ViewManagerAdapter_ExpoDomWebViewModule");
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  CHECK(mounting->hasComponent(ngn::DomWebViewComponentName));
}

TEST_CASE("domWebViewConfig reads Expo's props, with the bridge on and no navigation held for the app") {
  Parser p;
  auto props = p.props(folly::dynamic::object("source", folly::dynamic::object("uri", "http://localhost:8081/_expo/@dom/note.ts"))(
      "injectedJavaScriptObject", R"({"inputs":{"label":"Draft"}})")("injectedJavaScript", "after();")(
      "injectedJavaScriptBeforeContentLoaded", "before();")("webviewDebuggingEnabled", true));
  auto config = ngn::domWebViewConfig(*props);
  REQUIRE(config);
  CHECK(config->source == ngn::WebViewSource{.uri = "http://localhost:8081/_expo/@dom/note.ts"});
  CHECK(config->injectedJavaScriptObject == R"({"inputs":{"label":"Draft"}})");
  CHECK(config->injectedJavaScript == "after();");
  CHECK(config->injectedJavaScriptBeforeContentLoaded == "before();");
  // In every frame, as Expo's iOS view adds them.
  CHECK_FALSE(config->injectedJavaScriptForMainFrameOnly);
  CHECK_FALSE(config->injectedJavaScriptBeforeContentLoadedForMainFrameOnly);
  CHECK(config->webviewDebuggingEnabled);
  CHECK(config->messagingEnabled);
  CHECK_FALSE(config->asksApp);
  CHECK_FALSE(config->originWhitelist);
  CHECK(ngn::navigationStep(*config, "http://localhost:8081/_expo/@dom/note.ts", true, "other") == ngn::NavigationStep::Allow);
  CHECK(ngn::navigationStep(*config, "https://example.com/", true, "click") == ngn::NavigationStep::Allow);

  // A source that names no uri loads nothing; a later update's uri replaces it.
  auto empty = p.props(folly::dynamic::object("source", nullptr));
  CHECK(ngn::domWebViewConfig(*empty)->source.uri.empty());
  auto moved = p.props(folly::dynamic::object("source", folly::dynamic::object("uri", "file:///App/www.bundle/a.html")), props);
  CHECK(ngn::domWebViewConfig(*moved)->source.uri == "file:///App/www.bundle/a.html");
  CHECK(ngn::domWebViewConfig(*moved)->injectedJavaScriptObject == R"({"inputs":{"label":"Draft"}})");
}

TEST_CASE("domWebViewConfig is nothing for another component's props") {
  ViewProps plain;
  CHECK_FALSE(ngn::domWebViewConfig(plain));
}
