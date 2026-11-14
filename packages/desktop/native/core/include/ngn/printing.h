// NgNativePrint: what @ng-native/expo's Printing calls on expo-print, over a PrintSystem, which the
// AppKit backend implements with NSPrintOperation and WebKit.
//
// - printAsync({html | uri, orientation}): shows the print panel for the HTML, or for the PDF or
//   image the uri names (a `file:` uri, a path, a `data:` uri or an `http(s):` url, read through
//   the backend's HTTP client). Resolves once the panel closes, printed or cancelled, as the
//   service promises. macOS has no printer picker, so `printerUrl` is ignored and the panel shows.
//   With `noPrompts` (NGN_NO_PROMPTS=1) nothing is shown and it resolves. One at a time.
// - printToFileAsync({html, width, height, margins, orientation, base64}): {uri, numberOfPages,
//   base64?}, the HTML laid out on pages of that size (US Letter, 612 by 792 points, by default)
//   and written to a new PDF in `<caches>/Print`, as expo's iOS module sizes them.
#pragma once

#include "ngn/native-module.h"
#include "ngn/network.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn {

// A page in points, and the margins inside it.
struct PageSetup {
  double width{612};
  double height{792};
  double left{0};
  double top{0};
  double right{0};
  double bottom{0};
  bool operator==(const PageSetup &) const = default;
};

// expo's page from printToFileAsync's options: `width` and `height` over US Letter, swapped for
// `landscape` when taller than wide, and `margins`. Throws std::invalid_argument when nothing is
// left to print on.
PageSetup pageSetupOf(const folly::dynamic &options);

class PrintSystem {
 public:
  struct Document {
    enum class Kind { Html, Pdf, Image };
    Kind kind{Kind::Html};
    // The HTML, or the file's bytes.
    std::string content;
  };
  virtual ~PrintSystem() = default;
  // Shows the print panel for `document`. Answers once, on any thread: empty when the panel has
  // closed, printed or cancelled, else why it could not show.
  virtual void print(Document document, bool landscape, std::function<void(const std::string &error)> done) = 0;
  // Lays `html` out on pages of `page` and writes the PDF to `path`. Answers once, on any thread,
  // with the number of pages, or why it could not.
  virtual void renderPdf(std::string html, PageSetup page, std::string path, std::function<void(int pages, const std::string &error)> done) = 0;
};

// `folder` is where PDFs go: `<caches>/Print`.
std::shared_ptr<NativeModule> makePrintModule(std::shared_ptr<PrintSystem> system, std::shared_ptr<Http> http, std::string folder, bool noPrompts = false);

} // namespace ngn
