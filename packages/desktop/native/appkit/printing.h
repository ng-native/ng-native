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

std::shared_ptr<PrintSystem> makePrintSystem();

} // namespace ngn::appkit
