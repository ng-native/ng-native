#include "fake-network.h"
#include "ngn/bytes.h"
#include "ngn/printing.h"

#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>
#include <optional>

using folly::dynamic;
using Kind = ngn::PrintSystem::Document::Kind;

namespace {

struct FakePrintSystem final : ngn::PrintSystem {
  struct Shown {
    Document document;
    bool landscape;
  };
  std::vector<Shown> shown;
  std::function<void(const std::string &)> pendingPrint;
  std::vector<ngn::PageSetup> pages;
  std::string error;
  void print(Document document, bool landscape, std::function<void(const std::string &)> done) override {
    shown.push_back({std::move(document), landscape});
    pendingPrint = std::move(done);
  }
  void renderPdf(std::string html, ngn::PageSetup page, std::string path, std::function<void(int, const std::string &)> done) override {
    pages.push_back(page);
    if (!error.empty()) {
      done(0, error);
      return;
    }
    std::ofstream(path, std::ios::binary) << "%PDF-" << html;
    done(3, "");
  }
};

struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn-print-" + std::to_string(rand()));
  ~Folder() {
    std::filesystem::remove_all(path);
  }
};

struct Answer {
  bool resolved{false};
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer call(const ngn::NativeModule &module, const std::string &method, dynamic options, Answer *into = nullptr) {
  Answer answer;
  Answer *target = into != nullptr ? into : &answer;
  module.callWithPromise(
      method, dynamic::array(options),
      {.resolve = [target](dynamic v) { target->resolved = true; target->value = v; }, .reject = [target](const std::string &e) { target->error = e; }});
  return answer;
}

ngn::PageSetup page(dynamic options) {
  return ngn::pageSetupOf(options);
}

} // namespace

TEST_CASE("pageSetupOf sizes the page as expo's iOS module does: US Letter, swapped for landscape, with margins") {
  CHECK(page(nullptr) == ngn::PageSetup{});
  CHECK(page(dynamic::object("width", 595)("height", 842)) == ngn::PageSetup{.width = 595, .height = 842});
  CHECK(page(dynamic::object("orientation", "landscape")) == ngn::PageSetup{.width = 792, .height = 612});
  // Already wider than tall: landscape keeps it.
  CHECK(page(dynamic::object("orientation", "landscape")("width", 800)("height", 400)) == ngn::PageSetup{.width = 800, .height = 400});
  auto margins = page(dynamic::object("margins", dynamic::object("left", 10)("top", 20)("right", 30)("bottom", 40)));
  CHECK(margins == ngn::PageSetup{.left = 10, .top = 20, .right = 30, .bottom = 40});
  CHECK_THROWS_AS(page(dynamic::object("width", 100)("margins", dynamic::object("left", 60)("right", 40))), std::invalid_argument);
}

TEST_CASE("NgNativePrint writes a PDF into the print folder and answers its uri, its pages and, when asked, its base64") {
  Folder folder;
  auto system = std::make_shared<FakePrintSystem>();
  auto module = ngn::makePrintModule(system, std::make_shared<ngn::testing::FakeHttp>(), folder.path.string());
  auto answer = call(*module, "printToFileAsync", dynamic::object("html", "<h1>Invoice</h1>")("width", 400)("base64", true));
  REQUIRE(answer.value);
  auto uri = (*answer.value)["uri"].asString();
  CHECK(uri.rfind("file://" + folder.path.string() + "/", 0) == 0);
  CHECK(uri.size() > 4);
  CHECK(uri.substr(uri.size() - 4) == ".pdf");
  CHECK((*answer.value)["numberOfPages"] == 3);
  CHECK((*answer.value)["base64"] == ngn::base64Encode("%PDF-<h1>Invoice</h1>"));
  REQUIRE(system->pages.size() == 1);
  CHECK(system->pages[0] == ngn::PageSetup{.width = 400, .height = 792});

  auto plain = call(*module, "printToFileAsync", dynamic::object("html", "x"));
  REQUIRE(plain.value);
  CHECK(plain.value->get_ptr("base64") == nullptr);
  CHECK((*plain.value)["uri"] != (*answer.value)["uri"]);

  system->error = "WebKit failed";
  CHECK(call(*module, "printToFileAsync", dynamic::object("html", "x")).error == "Print: Error while rendering the PDF: WebKit failed");
  CHECK(call(*module, "printToFileAsync", dynamic::object("height", 10)("margins", dynamic::object("top", 10))).error);
}

TEST_CASE("NgNativePrint shows the panel for HTML, and resolves once it closes") {
  auto system = std::make_shared<FakePrintSystem>();
  auto module = ngn::makePrintModule(system, std::make_shared<ngn::testing::FakeHttp>(), "/tmp/unused");
  Answer answer;
  call(*module, "printAsync", dynamic::object("html", "<p>Hi</p>")("orientation", "landscape")("printerUrl", "ipp://x"), &answer);
  REQUIRE(system->shown.size() == 1);
  CHECK(system->shown[0].document.kind == Kind::Html);
  CHECK(system->shown[0].document.content == "<p>Hi</p>");
  CHECK(system->shown[0].landscape);
  CHECK(call(*module, "printAsync", dynamic::object("html", "again")).error == "Print: the print panel is already showing");
  CHECK_FALSE(answer.resolved);
  system->pendingPrint("");
  CHECK(answer.resolved);

  Answer failed;
  call(*module, "printAsync", dynamic::object("html", "<p>Hi</p>"), &failed);
  CHECK_FALSE(system->shown[1].landscape);
  system->pendingPrint("no printer");
  CHECK(failed.error == "Print: no printer");
}

TEST_CASE("NgNativePrint reads a uri's file through the HTTP client and prints it as a PDF or an image") {
  auto system = std::make_shared<FakePrintSystem>();
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makePrintModule(system, http, "/tmp/unused");
  auto serve = [&](size_t index, const std::string &body, uint16_t status = 200) {
    REQUIRE(http->sent.size() > index);
    auto &callbacks = http->sent[index]->callbacks;
    callbacks.onResponse({.status = status});
    callbacks.onData(body, -1);
    callbacks.onComplete("", false);
  };
  Answer pdf;
  call(*module, "printAsync", dynamic::object("uri", "/Users/me/a doc.pdf"), &pdf);
  REQUIRE(http->sent.size() == 1);
  CHECK(http->sent[0]->request.url == "file:///Users/me/a%20doc.pdf");
  serve(0, "%PDF-1.7 ...");
  REQUIRE(system->shown.size() == 1);
  CHECK(system->shown[0].document.kind == Kind::Pdf);
  system->pendingPrint("");
  CHECK(pdf.resolved);

  call(*module, "printAsync", dynamic::object("uri", "https://example.com/photo.png"));
  CHECK(http->sent[1]->request.url == "https://example.com/photo.png");
  serve(1, "\x89PNG...");
  REQUIRE(system->shown.size() == 2);
  CHECK(system->shown[1].document.kind == Kind::Image);
  CHECK(system->shown[1].document.content == "\x89PNG...");
  system->pendingPrint("");

  Answer missing;
  call(*module, "printAsync", dynamic::object("uri", "https://example.com/gone.pdf"), &missing);
  serve(2, "", 404);
  CHECK(missing.error == "Print: could not read https://example.com/gone.pdf: HTTP 404");
  // A failed read frees the panel for the next print.
  call(*module, "printAsync", dynamic::object("html", "next"));
  CHECK(system->shown.size() == 3);
}

TEST_CASE("NgNativePrint refuses a print with nothing to print, and shows nothing with no prompts") {
  auto system = std::make_shared<FakePrintSystem>();
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makePrintModule(system, http, "/tmp/unused");
  CHECK(call(*module, "printAsync", dynamic::object()).error == "Print: No data to print. You must specify `uri` or `html` option");
  CHECK(call(*module, "printAsync", dynamic::object("uri", "content://x")).error == "Print: content://x is not a file, data or http(s) uri");
  CHECK(http->sent.empty());

  auto quiet = ngn::makePrintModule(system, http, "/tmp/unused", true);
  CHECK(call(*quiet, "printAsync", dynamic::object("html", "<p>Hi</p>")).resolved);
  CHECK(call(*quiet, "printAsync", dynamic::object("uri", "/tmp/a.pdf")).resolved);
  CHECK(system->shown.empty());
  CHECK(http->sent.empty());
}
