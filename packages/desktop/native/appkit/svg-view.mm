#import "svg-view.h"

#include <cmath>
#include <vector>

namespace {

CGColorRef createColor(uint32_t argb, double opacity) {
  CGFloat components[] = {
      ((argb >> 16) & 0xff) / 255.0,
      ((argb >> 8) & 0xff) / 255.0,
      (argb & 0xff) / 255.0,
      ((argb >> 24) & 0xff) / 255.0 * opacity,
  };
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGColorRef color = CGColorCreate(space, components);
  CGColorSpaceRelease(space);
  return color;
}

CGAffineTransform affine(const ngn::SvgMatrix &m) {
  return CGAffineTransformMake(m.a, m.b, m.c, m.d, m.e, m.f);
}

CGPathRef createPath(const ngn::SvgPath &path) {
  CGMutablePathRef out = CGPathCreateMutable();
  for (const auto &s : path.segments) {
    switch (s.op) {
      case ngn::SvgPath::Op::Move:
        CGPathMoveToPoint(out, nullptr, s.points[0], s.points[1]);
        break;
      case ngn::SvgPath::Op::Line:
        CGPathAddLineToPoint(out, nullptr, s.points[0], s.points[1]);
        break;
      case ngn::SvgPath::Op::Cubic:
        CGPathAddCurveToPoint(out, nullptr, s.points[0], s.points[1], s.points[2], s.points[3], s.points[4], s.points[5]);
        break;
      case ngn::SvgPath::Op::Close:
        CGPathCloseSubpath(out);
        break;
    }
  }
  return out;
}

// Images an svg draws, by URI, loaded once for every svg.
NSCache<NSString *, NSImage *> *imageCache() {
  static NSCache<NSString *, NSImage *> *cache = [NSCache new];
  return cache;
}

// The canvas drawSvg draws on: Core Graphics calls on the view's context, or on a mask's while
// one is drawn. It tracks the user transform itself, so a mask, drawn in a context of its own,
// starts where the drawing is.
class CGCanvas final : public ngn::SvgCanvas {
 public:
  CGCanvas(CGContextRef context, CGSize size, CGFloat scale, void (^imageLoaded)(void))
      : context_(context), size_(size), scale_(scale), imageLoaded_(imageLoaded) {}

  void save() override {
    CGContextSaveGState(context_);
    saved_.push_back(matrix_);
  }

  void restore() override {
    CGContextRestoreGState(context_);
    if (!saved_.empty()) {
      matrix_ = saved_.back();
      saved_.pop_back();
    }
  }

  void concat(const ngn::SvgMatrix &m) override {
    CGContextConcatCTM(context_, affine(m));
    matrix_ = matrix_ * m;
  }

  void clip(const ngn::SvgPath &path, bool evenOdd) override {
    CGPathRef p = createPath(path);
    CGContextAddPath(context_, p);
    CGPathRelease(p);
    if (evenOdd) {
      CGContextEOClip(context_);
    } else {
      CGContextClip(context_);
    }
  }

  void fill(const ngn::SvgPath &path, bool evenOdd, const ngn::SvgPaint &paint) override {
    CGPathRef p = createPath(path);
    if (paint.gradient) {
      CGContextSaveGState(context_);
      CGContextAddPath(context_, p);
      evenOdd ? CGContextEOClip(context_) : CGContextClip(context_);
      drawGradient(*paint.gradient, paint.opacity);
      CGContextRestoreGState(context_);
    } else {
      CGColorRef color = createColor(paint.argb, paint.opacity);
      CGContextSetFillColorWithColor(context_, color);
      CGColorRelease(color);
      CGContextAddPath(context_, p);
      CGContextDrawPath(context_, evenOdd ? kCGPathEOFill : kCGPathFill);
    }
    CGPathRelease(p);
  }

  void stroke(const ngn::SvgPath &path, const ngn::SvgStroke &stroke, const ngn::SvgPaint &paint) override {
    CGContextSaveGState(context_);
    CGContextSetLineWidth(context_, stroke.width);
    CGContextSetLineCap(context_, stroke.cap == 1 ? kCGLineCapRound : stroke.cap == 2 ? kCGLineCapSquare : kCGLineCapButt);
    CGContextSetLineJoin(context_, stroke.join == 1 ? kCGLineJoinRound : stroke.join == 2 ? kCGLineJoinBevel : kCGLineJoinMiter);
    CGContextSetMiterLimit(context_, stroke.miterLimit);
    if (!stroke.dashes.empty()) {
      std::vector<CGFloat> dashes(stroke.dashes.begin(), stroke.dashes.end());
      CGContextSetLineDash(context_, stroke.dashOffset, dashes.data(), dashes.size());
    }
    CGPathRef p = createPath(path);
    CGContextAddPath(context_, p);
    CGPathRelease(p);
    if (paint.gradient) {
      CGContextReplacePathWithStrokedPath(context_);
      CGContextClip(context_);
      drawGradient(*paint.gradient, paint.opacity);
    } else {
      CGColorRef color = createColor(paint.argb, paint.opacity);
      CGContextSetStrokeColorWithColor(context_, color);
      CGColorRelease(color);
      CGContextStrokePath(context_);
    }
    CGContextRestoreGState(context_);
  }

  void beginLayer(double opacity) override {
    CGContextSaveGState(context_);
    CGContextSetAlpha(context_, opacity);
    CGContextBeginTransparencyLayer(context_, nullptr);
  }

  void endLayer() override {
    CGContextEndTransparencyLayer(context_);
    CGContextRestoreGState(context_);
  }

  // A mask is drawn in a grey bitmap of the view's pixels, black where nothing is drawn, so its
  // grey is the luminance times the alpha SVG masks by. An alpha mask is drawn the same way.
  void beginMask(bool alpha) override {
    size_t width = std::max<size_t>(1, static_cast<size_t>(std::ceil(size_.width * scale_)));
    size_t height = std::max<size_t>(1, static_cast<size_t>(std::ceil(size_.height * scale_)));
    CGColorSpaceRef grey = CGColorSpaceCreateDeviceGray();
    CGContextRef mask = CGBitmapContextCreate(nullptr, width, height, 8, 0, grey, kCGImageAlphaNone);
    CGColorSpaceRelease(grey);
    CGContextSetGrayFillColor(mask, 0, 1);
    CGContextFillRect(mask, CGRectMake(0, 0, width, height));
    // The view's coordinates: top left, y down, in points.
    CGContextTranslateCTM(mask, 0, height);
    CGContextScaleCTM(mask, scale_, -scale_);
    CGContextConcatCTM(mask, affine(matrix_));
    masks_.push_back({.parent = context_, .mask = mask, .saved = saved_});
    context_ = mask;
  }

  void endMask() override {
    if (masks_.empty()) {
      return;
    }
    auto frame = masks_.back();
    CGImageRef image = CGBitmapContextCreateImage(frame.mask);
    CGContextRelease(frame.mask);
    context_ = frame.parent;
    saved_ = frame.saved;
    masks_.back().mask = nullptr;
    // Clip in the view's coordinates, the image's top row at the view's top, then come back.
    CGContextSaveGState(context_);
    CGAffineTransform toView = CGAffineTransformInvert(affine(matrix_));
    CGContextConcatCTM(context_, toView);
    CGContextTranslateCTM(context_, 0, size_.height);
    CGContextScaleCTM(context_, 1, -1);
    CGContextClipToMask(context_, CGRectMake(0, 0, size_.width, size_.height), image);
    CGContextScaleCTM(context_, 1, -1);
    CGContextTranslateCTM(context_, 0, -size_.height);
    CGContextConcatCTM(context_, affine(matrix_));
    CGImageRelease(image);
  }

  void endMasked() override {
    if (masks_.empty()) {
      return;
    }
    masks_.pop_back();
    CGContextRestoreGState(context_);
  }

  void image(const std::string &uri, const ngn::SvgRect &rect, const std::string &align, int meetOrSlice, double opacity) override {
    NSString *key = @(uri.c_str());
    NSImage *image = [imageCache() objectForKey:key];
    if (image == nil) {
      load(key);
      return;
    }
    NSSize natural = image.size;
    if (natural.width <= 0 || natural.height <= 0) {
      return;
    }
    auto fit = ngn::svgViewBoxTransform({0, 0, natural.width, natural.height}, align, meetOrSlice, rect.width, rect.height);
    CGContextSaveGState(context_);
    CGContextClipToRect(context_, CGRectMake(rect.x, rect.y, rect.width, rect.height));
    CGContextTranslateCTM(context_, rect.x, rect.y);
    CGContextConcatCTM(context_, affine(fit));
    NSGraphicsContext *previous = NSGraphicsContext.currentContext;
    NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithCGContext:context_ flipped:YES];
    [image drawInRect:NSMakeRect(0, 0, natural.width, natural.height)
             fromRect:NSZeroRect
            operation:NSCompositingOperationSourceOver
             fraction:opacity
       respectFlipped:YES
                hints:nil];
    NSGraphicsContext.currentContext = previous;
    CGContextRestoreGState(context_);
  }

  double text(
      const std::string &text,
      double x,
      double y,
      double fontSize,
      const std::string &fontFamily,
      const std::string &fontWeight,
      const ngn::SvgPaint *fill) override {
    NSFont *font = fontFamily.empty() ? nil : [NSFont fontWithName:@(fontFamily.c_str()) size:fontSize];
    if (font == nil) {
      int weight = fontWeight == "bold" ? 700 : std::atoi(fontWeight.c_str());
      font = [NSFont systemFontOfSize:fontSize weight:weight >= 600 ? NSFontWeightBold : weight >= 500 ? NSFontWeightMedium : NSFontWeightRegular];
    }
    uint32_t argb = fill ? (fill->gradient && !fill->gradient->stops.empty() ? fill->gradient->stops[0].second : fill->argb) : 0;
    CGColorRef color = createColor(argb, fill ? fill->opacity : 0);
    NSAttributedString *string = [[NSAttributedString alloc]
        initWithString:@(text.c_str())
            attributes:@{NSFontAttributeName : font, (id)kCTForegroundColorAttributeName : (__bridge id)color}];
    CGColorRelease(color);
    CTLineRef line = CTLineCreateWithAttributedString((CFAttributedStringRef)string);
    double width = CTLineGetTypographicBounds(line, nullptr, nullptr, nullptr);
    if (fill != nullptr) {
      CGContextSaveGState(context_);
      CGContextTranslateCTM(context_, x, y);
      CGContextScaleCTM(context_, 1, -1);
      CGContextSetTextMatrix(context_, CGAffineTransformIdentity);
      CGContextSetTextPosition(context_, 0, 0);
      CTLineDraw(line, context_);
      CGContextRestoreGState(context_);
    }
    CFRelease(line);
    return width;
  }

 private:
  struct Mask {
    CGContextRef parent;
    CGContextRef mask;
    std::vector<ngn::SvgMatrix> saved;
  };

  void drawGradient(const ngn::SvgGradient &g, double opacity) {
    std::vector<CGFloat> components;
    std::vector<CGFloat> locations;
    for (const auto &[offset, argb] : g.stops) {
      components.push_back(((argb >> 16) & 0xff) / 255.0);
      components.push_back(((argb >> 8) & 0xff) / 255.0);
      components.push_back((argb & 0xff) / 255.0);
      components.push_back(((argb >> 24) & 0xff) / 255.0);
      // Offsets only grow, as SVG clamps a smaller one to the one before.
      locations.push_back(std::clamp(locations.empty() ? offset : std::max(offset, double(locations.back())), 0.0, 1.0));
    }
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGGradientRef gradient = CGGradientCreateWithColorComponents(space, components.data(), locations.data(), locations.size());
    CGColorSpaceRelease(space);
    CGContextSaveGState(context_);
    CGContextSetAlpha(context_, opacity);
    CGContextConcatCTM(context_, affine(g.transform));
    auto extend = kCGGradientDrawsBeforeStartLocation | kCGGradientDrawsAfterEndLocation;
    if (g.radial) {
      CGContextDrawRadialGradient(context_, gradient, CGPointMake(g.x2, g.y2), 0, CGPointMake(g.x1, g.y1), g.r, extend);
    } else {
      CGContextDrawLinearGradient(context_, gradient, CGPointMake(g.x1, g.y1), CGPointMake(g.x2, g.y2), extend);
    }
    CGContextRestoreGState(context_);
    CGGradientRelease(gradient);
  }

  void load(NSString *uri) {
    static NSMutableSet<NSString *> *loading = [NSMutableSet set];
    if ([loading containsObject:uri]) {
      return;
    }
    NSURL *url = [NSURL URLWithString:uri];
    if (url == nil) {
      return;
    }
    [loading addObject:uri];
    void (^loaded)(void) = imageLoaded_;
    [[NSURLSession.sharedSession dataTaskWithURL:url
                               completionHandler:^(NSData *data, NSURLResponse *, NSError *) {
                                 NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
                                 dispatch_async(dispatch_get_main_queue(), ^{
                                   [loading removeObject:uri];
                                   if (image != nil) {
                                     [imageCache() setObject:image forKey:uri];
                                     if (loaded) {
                                       loaded();
                                     }
                                   }
                                 });
                               }] resume];
  }

  CGContextRef context_;
  CGSize size_;
  CGFloat scale_;
  void (^imageLoaded_)(void);
  ngn::SvgMatrix matrix_;
  std::vector<ngn::SvgMatrix> saved_;
  std::vector<Mask> masks_;
};

} // namespace

@implementation NGNSvgView {
  std::shared_ptr<const ngn::SvgDocument> _document;
}

- (void)setDocument:(std::shared_ptr<const ngn::SvgDocument>)document {
  _document = std::move(document);
  [self setNeedsDisplay:YES];
}

- (void)updateLayout:(const facebook::react::LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self setNeedsDisplay:YES];
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  if (!_document) {
    return;
  }
  CGContextRef context = NSGraphicsContext.currentContext.CGContext;
  NSSize size = self.bounds.size;
  CGFloat scale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  __weak NGNSvgView *weakSelf = self;
  CGCanvas canvas(context, size, scale, ^{
    [weakSelf setNeedsDisplay:YES];
  });
  CGContextSaveGState(context);
  ngn::drawSvg(*_document, size.width, size.height, canvas);
  CGContextRestoreGState(context);
}

@end

@implementation NGNSvgElementView

- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    self.hidden = YES;
  }
  return self;
}

- (void)setHidden:(BOOL)hidden {
  [super setHidden:YES];
}

@end
