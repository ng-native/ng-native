#include "ngn/dev-server.h"

#include <doctest/doctest.h>

TEST_CASE("a Metro bundle URL names the dev server, the entry and the OS") {
  auto server = ngn::DevServer::fromBundleUrl(
      "http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=macos&dev=true");
  REQUIRE(server);
  CHECK(server->scheme == "http");
  CHECK(server->host == "localhost");
  CHECK(server->port == 8081);
  CHECK(server->entry == ".expo/.virtual-metro-entry");
  CHECK(server->platform == "macos");
  CHECK(server->bundleUrl == "http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=macos&dev=true");
  CHECK(server->packagerConnectionUrl() == "ws://localhost:8081/message");
}

TEST_CASE("the port defaults to the scheme's, and https connects over wss") {
  auto server = ngn::DevServer::fromBundleUrl("https://metro.example.com/index.bundle?platform=macos");
  REQUIRE(server);
  CHECK(server->port == 443);
  CHECK(server->entry == "index");
  CHECK(server->packagerConnectionUrl() == "wss://metro.example.com:443/message");
  CHECK(ngn::DevServer::fromBundleUrl("http://10.0.0.2/index.bundle")->port == 80);
}

TEST_CASE("a bundle URL without a platform asks for macos") {
  CHECK(ngn::DevServer::fromBundleUrl("http://localhost:8081/index.bundle?dev=true")->platform == "macos");
  CHECK(ngn::DevServer::fromBundleUrl("http://localhost:8081/index.bundle")->platform == "macos");
  CHECK(ngn::DevServer::fromBundleUrl("http://h:1/a.bundle?x=1&platform=ios")->platform == "ios");
}

TEST_CASE("a path on disk is not a dev server") {
  CHECK_FALSE(ngn::DevServer::fromBundleUrl("/tmp/main.hbc"));
  CHECK_FALSE(ngn::DevServer::fromBundleUrl("dist/main.jsbundle"));
  CHECK_FALSE(ngn::DevServer::fromBundleUrl("file:///tmp/main.hbc"));
  CHECK_FALSE(ngn::DevServer::fromBundleUrl("http://"));
  CHECK_FALSE(ngn::DevServer::fromBundleUrl("http://localhost:notaport/index.bundle"));
}

TEST_CASE("the HMR client is set up with the OS and entry of the bundle URL") {
  auto server = ngn::DevServer::fromBundleUrl("http://127.0.0.1:8082/src/main.bundle?platform=macos&dev=true");
  REQUIRE(server);
  auto args = server->hmrSetupArgs();
  REQUIRE(args.size() == 6);
  CHECK(args[0] == "macos");
  CHECK(args[1] == "src/main");
  CHECK(args[2] == "127.0.0.1");
  CHECK(args[3] == 8082);
  CHECK(args[4] == true);
  CHECK(args[5] == "http");
}
