// The OS half of NgNativePrint (the core's printing.h). HTML is laid out by a WKWebView in a window
// that is never shown and printed by NSPrintOperation, to a PDF file or into the document the
// print panel shows. Every print shows a PDFDocument: the HTML's PDF, the file's, or an image on a
// page of its own.
#pragma once

#include "ngn/printing.h"

#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::appkit {

// Lays `html` out on pages of `page` with WebKit and writes the PDF to `path`. Main thread; answers
// on it once the run loop has turned, with the number of pages or why not.
void renderHtmlPdf(const std::string &html, const PageSetup &page, const std::string &path, std::function<void(int pages, const std::string &error)> done);

// The PDF document a PDF's or an image's bytes print as, or nil for bytes that are neither.
PDFDocument *printableDocument(const PrintSystem::Document &document);

// The operation the print panel runs for `document`: the panel and progress shown, the pages
// scaled down to fit the paper and turned to it, in `landscape` or portrait.
NSPrintOperation *printOperation(PDFDocument *document, bool landscape);

// What a window's content view shows, as it is drawn, on one page of its size: what
// `print({ window })` and File > Print print. Each web view's page is WebKit's snapshot of it,
// since a web view draws out of process. Main thread; answers on it, with nil for a view with
// nothing to draw.
void windowDocument(NSView *content, std::function<void(PDFDocument *)> done);

// `rect` of a content view, in its own coordinates, as it is drawn, at the window's scale, with
// each web view's page in its place: WebKit's snapshot, since a web view draws out of process.
// Main thread; answers on it, with nil for nothing to draw, and whether every web view's page is
// in it: one whose snapshot failed is left blank.
void drawnContent(NSView *content, NSRect rect, std::function<void(NSBitmapImageRep *, bool complete)> done);

// Shows the print panel for what `window` shows, as a sheet on it, scaled down to the paper. Main
// thread; answers once the panel closes, or why it could not show.
void printWindow(NSWindow *window, bool landscape, std::function<void(const std::string &error)> done);

// `windowOf` finds the window that shows a surface, for printWindow.
std::shared_ptr<PrintSystem> makePrintSystem(std::function<NSWindow *(facebook::react::SurfaceId)> windowOf = nullptr);

} // namespace ngn::appkit
