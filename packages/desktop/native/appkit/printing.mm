#import "printing.h"

#import <WebKit/WebKit.h>

#include <filesystem>

// Loads one HTML string into a WKWebView in a window never shown, then prints it with the print
// info it was given, and answers once.
@interface NGNHtmlPrintJob : NSObject <WKNavigationDelegate>
- (instancetype)initWithInfo:(NSPrintInfo *)info done:(std::function<void(NSPrintOperation *, NSString *)>)done;
- (void)load:(NSString *)html;
@end

@implementation NGNHtmlPrintJob {
  NSPrintInfo *_info;
  NSWindow *_window;
  WKWebView *_webView;
  NGNHtmlPrintJob *_keep;
  std::function<void(NSPrintOperation *, NSString *)> _done;
}

- (instancetype)initWithInfo:(NSPrintInfo *)info done:(std::function<void(NSPrintOperation *, NSString *)>)done {
  if ((self = [super init])) {
    _info = info;
    _done = std::move(done);
    NSSize paper = info.paperSize;
    NSRect frame = NSMakeRect(0, 0, paper.width - info.leftMargin - info.rightMargin, paper.height - info.topMargin - info.bottomMargin);
    // WebKit prints only from a view in a window; this one is offscreen and never ordered in.
    _window = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    _window.releasedWhenClosed = NO;
    [_window setFrameOrigin:NSMakePoint(-100000, -100000)];
    _webView = [[WKWebView alloc] initWithFrame:frame configuration:[WKWebViewConfiguration new]];
    _webView.navigationDelegate = self;
    _window.contentView = _webView;
  }
  return self;
}

- (void)load:(NSString *)html {
  _keep = self;
  [_webView loadHTMLString:html baseURL:nil];
}

- (void)finish:(NSPrintOperation *)operation error:(NSString *)error {
  auto done = std::move(_done);
  _done = nullptr;
  if (done) {
    done(operation, error);
  }
  _webView.navigationDelegate = nil;
  [_window close];
  _keep = nil;
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  NSPrintOperation *operation = [webView printOperationWithPrintInfo:_info];
  operation.showsPrintPanel = NO;
  operation.showsProgressPanel = NO;
  // WKWebView's print view lays out at the size it is given, and paginates from there.
  operation.view.frame = webView.bounds;
  [operation runOperationModalForWindow:_window delegate:self didRunSelector:@selector(printOperationDidRun:success:contextInfo:) contextInfo:nil];
}

- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)contextInfo {
  // The operation may have run on a thread of its own; the window closes on the main thread.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self finish:success ? operation : nil error:success ? nil : @"the print operation failed"];
  });
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  [self finish:nil error:error.localizedDescription];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  [self finish:nil error:error.localizedDescription];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  [self finish:nil error:@"WebKit's content process ended"];
}
@end

// Answers a print panel run as a sheet once it closes.
@interface NGNPrintPanelEnd : NSObject
- (instancetype)initWithDone:(std::function<void()>)done;
- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)contextInfo;
@end

@implementation NGNPrintPanelEnd {
  std::function<void()> _done;
  NGNPrintPanelEnd *_keep;
}
- (instancetype)initWithDone:(std::function<void()>)done {
  if ((self = [super init])) {
    _done = std::move(done);
    _keep = self;
  }
  return self;
}
- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)contextInfo {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_done();
    self->_keep = nil;
  });
}
@end

namespace ngn::appkit {

namespace {

NSPrintInfo *pdfPrintInfo(const PageSetup &page, NSURL *target) {
  NSPrintInfo *info = [[NSPrintInfo alloc] initWithDictionary:@{
    NSPrintJobDisposition : NSPrintSaveJob,
    NSPrintJobSavingURL : target,
  }];
  // NSPrintInfo keeps a paper wider than tall as a portrait paper turned to landscape.
  bool wide = page.width > page.height;
  info.paperSize = wide ? NSMakeSize(page.height, page.width) : NSMakeSize(page.width, page.height);
  info.orientation = wide ? NSPaperOrientationLandscape : NSPaperOrientationPortrait;
  info.leftMargin = page.left;
  info.topMargin = page.top;
  info.rightMargin = page.right;
  info.bottomMargin = page.bottom;
  info.horizontalPagination = NSPrintingPaginationModeFit;
  info.verticalPagination = NSPrintingPaginationModeAutomatic;
  info.horizontallyCentered = NO;
  info.verticallyCentered = NO;
  return info;
}

void onMain(std::function<void()> work) {
  if (NSThread.isMainThread) {
    work();
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      work();
    });
  }
}

class AppKitPrintSystem final : public PrintSystem {
 public:
  void print(Document document, bool landscape, std::function<void(const std::string &)> done) override {
    onMain([document = std::move(document), landscape, done = std::move(done)] {
      if (document.kind != Document::Kind::Html) {
        PDFDocument *pdf = printableDocument(document);
        if (pdf == nil) {
          done("the file is not a PDF or an image");
          return;
        }
        show(pdf, landscape, done);
        return;
      }
      // The HTML on the paper the shared print info has (the default printer's), as a PDF first.
      NSPrintInfo *shared = NSPrintInfo.sharedPrintInfo;
      PageSetup page{.width = shared.paperSize.width, .height = shared.paperSize.height, .left = shared.leftMargin,
                     .top = shared.topMargin, .right = shared.rightMargin, .bottom = shared.bottomMargin};
      if (landscape && page.height > page.width) {
        std::swap(page.width, page.height);
      }
      NSString *name = [NSUUID.UUID.UUIDString stringByAppendingString:@".pdf"];
      std::string path = std::string(NSTemporaryDirectory().UTF8String) + "/" + name.UTF8String;
      renderHtmlPdf(document.content, page, path, [path, landscape, done](int, const std::string &error) {
        PDFDocument *pdf = error.empty() ? [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:@(path.c_str())]] : nil;
        std::error_code ignored;
        std::filesystem::remove(path, ignored);
        if (pdf == nil) {
          done(error.empty() ? "the HTML could not be laid out" : error);
          return;
        }
        show(pdf, landscape, done);
      });
    });
  }

  void renderPdf(std::string html, PageSetup page, std::string path, std::function<void(int, const std::string &)> done) override {
    onMain([html = std::move(html), page, path = std::move(path), done = std::move(done)] { renderHtmlPdf(html, page, path, done); });
  }

 private:
  static void show(PDFDocument *pdf, bool landscape, const std::function<void(const std::string &)> &done) {
    NSPrintOperation *operation = printOperation(pdf, landscape);
    if (operation == nil) {
      done("the document cannot be printed");
      return;
    }
    NSWindow *window = NSApp.keyWindow;
    if (window == nil || !window.visible) {
      // No window to hang a sheet on: the panel runs app-modally, and has closed when this returns.
      [operation runOperation];
      done("");
      return;
    }
    NGNPrintPanelEnd *end = [[NGNPrintPanelEnd alloc] initWithDone:[done] { done(""); }];
    [operation runOperationModalForWindow:window delegate:end didRunSelector:@selector(printOperationDidRun:success:contextInfo:) contextInfo:nil];
  }
};

} // namespace

void renderHtmlPdf(const std::string &html, const PageSetup &page, const std::string &path, std::function<void(int, const std::string &)> done) {
  NSURL *target = [NSURL fileURLWithPath:@(path.c_str())];
  NGNHtmlPrintJob *job = [[NGNHtmlPrintJob alloc] initWithInfo:pdfPrintInfo(page, target) done:[target, done](NSPrintOperation *operation, NSString *error) {
    if (operation == nil) {
      done(0, error.length > 0 ? error.UTF8String : "the HTML could not be printed");
      return;
    }
    CGPDFDocumentRef written = CGPDFDocumentCreateWithURL((__bridge CFURLRef)target);
    if (written == nullptr) {
      done(0, "no PDF was written");
      return;
    }
    int pages = static_cast<int>(CGPDFDocumentGetNumberOfPages(written));
    CGPDFDocumentRelease(written);
    done(pages, "");
  }];
  NSString *text = [[NSString alloc] initWithBytes:html.data() length:html.size() encoding:NSUTF8StringEncoding];
  [job load:text != nil ? text : @""];
}

PDFDocument *printableDocument(const PrintSystem::Document &document) {
  NSData *data = [NSData dataWithBytes:document.content.data() length:document.content.size()];
  if (document.kind == PrintSystem::Document::Kind::Pdf) {
    PDFDocument *pdf = [[PDFDocument alloc] initWithData:data];
    return pdf.pageCount > 0 ? pdf : nil;
  }
  NSImage *image = [[NSImage alloc] initWithData:data];
  if (image == nil || image.size.width <= 0 || image.size.height <= 0) {
    return nil;
  }
  PDFPage *page = [[PDFPage alloc] initWithImage:image];
  if (page == nil) {
    return nil;
  }
  PDFDocument *pdf = [PDFDocument new];
  [pdf insertPage:page atIndex:0];
  return pdf;
}

NSPrintOperation *printOperation(PDFDocument *document, bool landscape) {
  NSPrintInfo *info = [NSPrintInfo.sharedPrintInfo copy];
  info.orientation = landscape ? NSPaperOrientationLandscape : NSPaperOrientationPortrait;
  NSPrintOperation *operation = [document printOperationForPrintInfo:info scalingMode:kPDFPrintPageScaleDownToFit autoRotate:YES];
  operation.showsPrintPanel = YES;
  operation.showsProgressPanel = YES;
  return operation;
}

std::shared_ptr<PrintSystem> makePrintSystem() {
  return std::make_shared<AppKitPrintSystem>();
}

} // namespace ngn::appkit
