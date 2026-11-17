#import "cg-canvas.h"

#include "ngn/file-system.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace {

CGColorRef createColorImpl(uint32_t argb, double opacity) {
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

CGPathRef createPathImpl(const ngn::SvgPath &path) {
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
// The glyphs a cluster drew as in its shaped run: per font, each glyph and where it sits from the
// cluster's start.
struct ShapedGlyphs {
  struct Piece {
    CTFontRef font{nullptr};
    std::vector<CGGlyph> glyphs;
    std::vector<CGPoint> positions;
  };
  std::vector<Piece> pieces;
  ShapedGlyphs() = default;
  ShapedGlyphs(const ShapedGlyphs &) = delete;
  ShapedGlyphs &operator=(const ShapedGlyphs &) = delete;
  ~ShapedGlyphs() {
    for (auto &p : pieces) {
      CFRelease(p.font);
    }
  }
  void add(CTFontRef font, CGGlyph glyph, CGPoint position) {
    if (pieces.empty() || pieces.back().font != font) {
      pieces.push_back({.font = static_cast<CTFontRef>(CFRetain(font))});
    }
    pieces.back().glyphs.push_back(glyph);
    pieces.back().positions.push_back(position);
  }
};

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
    CGPathRef p = createPathImpl(path);
    CGContextAddPath(context_, p);
    CGPathRelease(p);
    if (evenOdd) {
      CGContextEOClip(context_);
    } else {
      CGContextClip(context_);
    }
  }

  void fill(const ngn::SvgPath &path, bool evenOdd, const ngn::SvgPaint &paint) override {
    CGPathRef p = createPathImpl(path);
    if (paint.gradient) {
      CGContextSaveGState(context_);
      CGContextAddPath(context_, p);
      evenOdd ? CGContextEOClip(context_) : CGContextClip(context_);
      drawGradient(*paint.gradient, paint.opacity);
      CGContextRestoreGState(context_);
    } else {
      CGColorRef color = createColorImpl(paint.argb, paint.opacity);
      CGContextSetFillColorWithColor(context_, color);
      CGColorRelease(color);
      CGContextAddPath(context_, p);
      CGContextDrawPath(context_, evenOdd ? kCGPathEOFill : kCGPathFill);
    }
    CGPathRelease(p);
  }

  void applyStroke(const ngn::SvgStroke &stroke) {
    CGContextSetLineWidth(context_, stroke.width);
    CGContextSetLineCap(context_, stroke.cap == 1 ? kCGLineCapRound : stroke.cap == 2 ? kCGLineCapSquare : kCGLineCapButt);
    CGContextSetLineJoin(context_, stroke.join == 1 ? kCGLineJoinRound : stroke.join == 2 ? kCGLineJoinBevel : kCGLineJoinMiter);
    CGContextSetMiterLimit(context_, stroke.miterLimit);
    if (!stroke.dashes.empty()) {
      std::vector<CGFloat> dashes(stroke.dashes.begin(), stroke.dashes.end());
      CGContextSetLineDash(context_, stroke.dashOffset, dashes.data(), dashes.size());
    }
  }

  void stroke(const ngn::SvgPath &path, const ngn::SvgStroke &stroke, const ngn::SvgPaint &paint) override {
    CGContextSaveGState(context_);
    applyStroke(stroke);
    CGPathRef p = createPathImpl(path);
    CGContextAddPath(context_, p);
    CGPathRelease(p);
    if (paint.gradient) {
      CGContextReplacePathWithStrokedPath(context_);
      CGContextClip(context_);
      drawGradient(*paint.gradient, paint.opacity);
    } else {
      CGColorRef color = createColorImpl(paint.argb, paint.opacity);
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

  // A luminance mask is drawn in a grey bitmap of the view's pixels, black where nothing is
  // drawn, so its grey is the luminance times the alpha SVG masks by. An alpha mask is drawn in an
  // alpha-only bitmap, clear where nothing is drawn, so only its content's alpha counts. A mask
  // whose bitmap cannot be made (too many pixels) masks nothing out.
  void beginMask(bool alpha) override {
    size_t width = std::max<size_t>(1, static_cast<size_t>(std::ceil(size_.width * scale_)));
    size_t height = std::max<size_t>(1, static_cast<size_t>(std::ceil(size_.height * scale_)));
    CGContextRef mask;
    if (alpha) {
      mask = CGBitmapContextCreate(nullptr, width, height, 8, 0, nullptr, kCGImageAlphaOnly);
      if (mask != nullptr) {
        CGContextClearRect(mask, CGRectMake(0, 0, width, height));
      }
    } else {
      CGColorSpaceRef grey = CGColorSpaceCreateDeviceGray();
      mask = CGBitmapContextCreate(nullptr, width, height, 8, 0, grey, kCGImageAlphaNone);
      CGColorSpaceRelease(grey);
      if (mask != nullptr) {
        CGContextSetGrayFillColor(mask, 0, 1);
        CGContextFillRect(mask, CGRectMake(0, 0, width, height));
      }
    }
    if (mask == nullptr) {
      // The mask's content is drawn into a context that keeps nothing, and the clip is skipped.
      masks_.push_back({.parent = context_, .mask = nullptr, .saved = saved_, .alpha = alpha, .scratch = scratchContext()});
      context_ = masks_.back().scratch;
      return;
    }
    // The view's coordinates: top left, y down, in points.
    CGContextTranslateCTM(mask, 0, height);
    CGContextScaleCTM(mask, scale_, -scale_);
    CGContextConcatCTM(mask, affine(matrix_));
    masks_.push_back({.parent = context_, .mask = mask, .saved = saved_, .alpha = alpha});
    context_ = mask;
  }

  void endMask() override {
    if (masks_.empty()) {
      return;
    }
    auto frame = masks_.back();
    context_ = frame.parent;
    saved_ = frame.saved;
    if (frame.mask == nullptr) {
      CGContextRelease(frame.scratch);
      masks_.back().scratch = nullptr;
      CGContextSaveGState(context_);
      return;
    }
    // A clip mask is a grey image: an alpha mask's alpha bytes are read as grey.
    CGImageRef image;
    if (frame.alpha) {
      size_t width = CGBitmapContextGetWidth(frame.mask), height = CGBitmapContextGetHeight(frame.mask);
      size_t row = CGBitmapContextGetBytesPerRow(frame.mask);
      CFDataRef bytes = CFDataCreate(nullptr, static_cast<const UInt8 *>(CGBitmapContextGetData(frame.mask)), static_cast<CFIndex>(row * height));
      CGDataProviderRef provider = CGDataProviderCreateWithCFData(bytes);
      CGColorSpaceRef grey = CGColorSpaceCreateDeviceGray();
      image = CGImageCreate(width, height, 8, 8, row, grey, static_cast<CGBitmapInfo>(kCGImageAlphaNone), provider, nullptr, false,
                            kCGRenderingIntentDefault);
      CGColorSpaceRelease(grey);
      CGDataProviderRelease(provider);
      CFRelease(bytes);
    } else {
      image = CGBitmapContextCreateImage(frame.mask);
    }
    CGContextRelease(frame.mask);
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

  void clipToStroke(const ngn::SvgPath &path, const ngn::SvgStroke &stroke) override {
    applyStroke(stroke);
    CGPathRef p = createPathImpl(path);
    CGContextAddPath(context_, p);
    CGPathRelease(p);
    CGContextReplacePathWithStrokedPath(context_);
    CGContextClip(context_);
  }

  // The tile is drawn once into a bitmap at the pixels it covers, and the bitmap tiled over the
  // clip. The bitmap's rows run from the tile's top, as the view's do.
  void pattern(const ngn::SvgPatternTile &tile, double opacity, const std::function<void(ngn::SvgCanvas &)> &drawTile) override {
    ngn::SvgMatrix toView = matrix_ * tile.transform;
    double density = scale_ * std::sqrt(std::abs(toView.a * toView.d - toView.b * toView.c));
    if (!(density > 0)) {
      return;
    }
    // At most 2048 pixels a side: a larger tile is drawn coarser.
    density = std::min({density, 2048 / tile.tile.width, 2048 / tile.tile.height});
    size_t width = std::max<size_t>(1, static_cast<size_t>(std::ceil(tile.tile.width * density)));
    size_t height = std::max<size_t>(1, static_cast<size_t>(std::ceil(tile.tile.height * density)));
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef bitmap = CGBitmapContextCreate(nullptr, width, height, 8, 0, space, kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    // A tile whose bitmap cannot be made paints nothing.
    if (bitmap == nullptr) {
      return;
    }
    CGContextTranslateCTM(bitmap, 0, height);
    CGContextScaleCTM(bitmap, width / tile.tile.width, -(height / tile.tile.height));
    {
      CGCanvas inner(bitmap, CGSizeMake(tile.tile.width, tile.tile.height), density, imageLoaded_);
      drawTile(inner);
    }
    CGImageRef image = CGBitmapContextCreateImage(bitmap);
    CGContextRelease(bitmap);
    CGContextSaveGState(context_);
    CGContextSetAlpha(context_, opacity);
    CGContextConcatCTM(context_, affine(tile.transform));
    CGContextTranslateCTM(context_, tile.tile.x, tile.tile.y);
    // Drawn in a space whose y runs up, so the image stands the right way; the tiles keep their
    // places, every tile's height apart.
    CGContextScaleCTM(context_, 1, -1);
    CGContextDrawTiledImage(context_, CGRectMake(0, 0, tile.tile.width, tile.tile.height), image);
    CGContextRestoreGState(context_);
    CGImageRelease(image);
  }

  // The source is drawn in a bitmap of the view's pixels, as a mask is, and the filter's result
  // drawn back in its place.
  void beginFilter(const ngn::SvgFilter &filter) override {
    size_t width = std::max<size_t>(1, static_cast<size_t>(std::ceil(size_.width * scale_)));
    size_t height = std::max<size_t>(1, static_cast<size_t>(std::ceil(size_.height * scale_)));
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef bitmap = CGBitmapContextCreate(nullptr, width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    // With no bitmap (too many pixels) the source is drawn as it is, unfiltered.
    if (bitmap == nullptr) {
      filters_.push_back({.parent = context_, .bitmap = nullptr, .saved = saved_, .filter = filter, .width = 0, .height = 0});
      return;
    }
    CGContextTranslateCTM(bitmap, 0, height);
    CGContextScaleCTM(bitmap, scale_, -scale_);
    CGContextConcatCTM(bitmap, affine(matrix_));
    filters_.push_back({.parent = context_, .bitmap = bitmap, .saved = saved_, .filter = filter, .width = width, .height = height});
    context_ = bitmap;
  }

  void endFilter() override {
    if (filters_.empty()) {
      return;
    }
    auto frame = std::move(filters_.back());
    filters_.pop_back();
    if (frame.bitmap == nullptr) {
      return;
    }
    context_ = frame.parent;
    saved_ = frame.saved;
    ngn::SvgPixels source{.width = static_cast<int>(frame.width), .height = static_cast<int>(frame.height)};
    const auto *data = static_cast<const uint8_t *>(CGBitmapContextGetData(frame.bitmap));
    source.rgba.assign(data, data + frame.width * frame.height * 4);
    CGContextRelease(frame.bitmap);
    auto result = ngn::runSvgFilter(frame.filter, source, ngn::SvgMatrix::scale(scale_, scale_) * matrix_);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CFDataRef bytes = CFDataCreate(nullptr, result.rgba.data(), static_cast<CFIndex>(result.rgba.size()));
    CGDataProviderRef provider = CGDataProviderCreateWithCFData(bytes);
    CGImageRef image = CGImageCreate(
        frame.width, frame.height, 8, 32, frame.width * 4, space,
        static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast), provider, nullptr, false, kCGRenderingIntentDefault);
    CGDataProviderRelease(provider);
    CFRelease(bytes);
    CGColorSpaceRelease(space);
    // In the view's coordinates, the image's top row at the view's top.
    CGContextSaveGState(context_);
    CGContextConcatCTM(context_, CGAffineTransformInvert(affine(matrix_)));
    CGContextTranslateCTM(context_, 0, size_.height);
    CGContextScaleCTM(context_, 1, -1);
    CGContextDrawImage(context_, CGRectMake(0, 0, frame.width / scale_, frame.height / scale_), image);
    CGContextRestoreGState(context_);
    CGImageRelease(image);
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

  double measureText(const std::string &text, double fontSize, const std::string &fontFamily, const std::string &fontWeight) override {
    CTLineRef line = createLine(text, fontSize, fontFamily, fontWeight, nullptr);
    double width = CTLineGetTypographicBounds(line, nullptr, nullptr, nullptr);
    CFRelease(line);
    return width;
  }

  // The composed character sequences of `text` (Foundation's grapheme clusters), each with the
  // glyphs Core Text's shaped line has for it, where it has them. A cluster with no glyph of its
  // own, the tail of a ligature, joins the one before it.
  std::vector<ngn::SvgGlyphCluster> glyphClusters(
      const std::string &text, double fontSize, const std::string &fontFamily, const std::string &fontWeight) override {
    NSString *string = @(text.c_str());
    if (string == nil) {
      string = @"";
    }
    std::vector<NSRange> ranges;
    std::vector<size_t> clusterOf(string.length);
    for (NSUInteger i = 0; i < string.length;) {
      NSRange range = [string rangeOfComposedCharacterSequenceAtIndex:i];
      std::fill(clusterOf.begin() + static_cast<long>(range.location), clusterOf.begin() + static_cast<long>(NSMaxRange(range)), ranges.size());
      ranges.push_back(range);
      i = NSMaxRange(range);
    }
    std::vector<double> left(ranges.size(), INFINITY), right(ranges.size(), -INFINITY);
    struct Glyph {
      CTFontRef font;
      CGGlyph glyph;
      CGPoint position;
    };
    std::vector<std::vector<Glyph>> glyphs(ranges.size());
    CTLineRef line = createLine(text, fontSize, fontFamily, fontWeight, nullptr);
    for (id item in (__bridge NSArray *)CTLineGetGlyphRuns(line)) {
      auto run = (__bridge CTRunRef)item;
      auto font = (CTFontRef)CFDictionaryGetValue(CTRunGetAttributes(run), kCTFontAttributeName);
      CFIndex count = CTRunGetGlyphCount(run);
      std::vector<CGGlyph> ids(static_cast<size_t>(count));
      std::vector<CGPoint> positions(static_cast<size_t>(count));
      std::vector<CGSize> advances(static_cast<size_t>(count));
      std::vector<CFIndex> indices(static_cast<size_t>(count));
      CTRunGetGlyphs(run, CFRangeMake(0, 0), ids.data());
      CTRunGetPositions(run, CFRangeMake(0, 0), positions.data());
      CTRunGetAdvances(run, CFRangeMake(0, 0), advances.data());
      CTRunGetStringIndices(run, CFRangeMake(0, 0), indices.data());
      for (size_t g = 0; g < positions.size(); ++g) {
        if (font == nullptr || indices[g] < 0 || static_cast<size_t>(indices[g]) >= clusterOf.size()) {
          continue;
        }
        size_t c = clusterOf[static_cast<size_t>(indices[g])];
        left[c] = std::min(left[c], static_cast<double>(positions[g].x));
        right[c] = std::max(right[c], static_cast<double>(positions[g].x + advances[g].width));
        glyphs[c].push_back({font, ids[g], positions[g]});
      }
    }
    std::vector<ngn::SvgGlyphCluster> out;
    for (size_t c = 0; c < ranges.size(); ++c) {
      std::string part = [string substringWithRange:ranges[c]].UTF8String;
      if (glyphs[c].empty() && !out.empty()) {
        out.back().text += part;
        continue;
      }
      auto shaped = std::make_shared<ShapedGlyphs>();
      for (const auto &g : glyphs[c]) {
        shaped->add(g.font, g.glyph, CGPointMake(g.position.x - left[c], g.position.y));
      }
      bool placed = !glyphs[c].empty();
      out.push_back({.text = std::move(part), .x = placed ? left[c] : 0, .advance = placed ? right[c] - left[c] : 0, .glyphs = shaped});
    }
    CFRelease(line);
    return out;
  }

  void glyphCluster(const ngn::SvgGlyphCluster &cluster, double x, double y, const ngn::SvgPaint &fill) override {
    auto shaped = std::static_pointer_cast<const ShapedGlyphs>(cluster.glyphs);
    if (!shaped) {
      return;
    }
    uint32_t argb = fill.gradient && !fill.gradient->stops.empty() ? fill.gradient->stops[0].second : fill.argb;
    CGColorRef color = createColorImpl(argb, fill.opacity);
    CGContextSaveGState(context_);
    CGContextTranslateCTM(context_, x, y);
    CGContextScaleCTM(context_, 1, -1);
    CGContextSetTextMatrix(context_, CGAffineTransformIdentity);
    CGContextSetFillColorWithColor(context_, color);
    for (const auto &p : shaped->pieces) {
      CTFontDrawGlyphs(p.font, p.glyphs.data(), p.positions.data(), p.glyphs.size(), context_);
    }
    CGContextRestoreGState(context_);
    CGColorRelease(color);
  }

  void text(
      const std::string &text,
      double x,
      double y,
      double fontSize,
      const std::string &fontFamily,
      const std::string &fontWeight,
      const ngn::SvgPaint &fill) override {
    CTLineRef line = createLine(text, fontSize, fontFamily, fontWeight, &fill);
    CGContextSaveGState(context_);
    CGContextTranslateCTM(context_, x, y);
    CGContextScaleCTM(context_, 1, -1);
    CGContextSetTextMatrix(context_, CGAffineTransformIdentity);
    CGContextSetTextPosition(context_, 0, 0);
    CTLineDraw(line, context_);
    CGContextRestoreGState(context_);
    CFRelease(line);
  }

 private:
  // A +1 line of `text` in the font, in `fill`'s colour (a gradient's first stop) when given.
  static CTLineRef createLine(
      const std::string &text,
      double fontSize,
      const std::string &fontFamily,
      const std::string &fontWeight,
      const ngn::SvgPaint *fill) {
    NSFont *font = fontFamily.empty() ? nil : [NSFont fontWithName:@(fontFamily.c_str()) size:fontSize];
    if (font == nil) {
      int weight = fontWeight == "bold" ? 700 : std::atoi(fontWeight.c_str());
      font = [NSFont systemFontOfSize:fontSize weight:weight >= 600 ? NSFontWeightBold : weight >= 500 ? NSFontWeightMedium : NSFontWeightRegular];
    }
    uint32_t argb = fill ? (fill->gradient && !fill->gradient->stops.empty() ? fill->gradient->stops[0].second : fill->argb) : 0;
    CGColorRef color = createColorImpl(argb, fill ? fill->opacity : 0);
    NSAttributedString *string = [[NSAttributedString alloc]
        initWithString:@(text.c_str())
            attributes:@{NSFontAttributeName : font, (__bridge id)kCTForegroundColorAttributeName : (__bridge id)color}];
    CGColorRelease(color);
    return CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)string);
  }

  struct Mask {
    CGContextRef parent;
    CGContextRef mask;
    std::vector<ngn::SvgMatrix> saved;
    bool alpha{false};
    // Where a mask with no bitmap has its content drawn, and dropped.
    CGContextRef scratch{nullptr};
  };

  // A one-pixel context that the content of a mask with no bitmap is drawn into.
  static CGContextRef scratchContext() {
    CGColorSpaceRef grey = CGColorSpaceCreateDeviceGray();
    CGContextRef scratch = CGBitmapContextCreate(nullptr, 1, 1, 8, 0, grey, kCGImageAlphaNone);
    CGColorSpaceRelease(grey);
    return scratch;
  }

  struct Filter {
    CGContextRef parent;
    CGContextRef bitmap;
    std::vector<ngn::SvgMatrix> saved;
    ngn::SvgFilter filter;
    size_t width, height;
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

  // Every canvas that asks for a uri while it loads is told when it is in the cache.
  void load(NSString *uri) {
    static NSMutableDictionary<NSString *, NSMutableArray *> *loading = [NSMutableDictionary dictionary];
    if (NSMutableArray *waiters = loading[uri]) {
      if (imageLoaded_ != nil) {
        [waiters addObject:[imageLoaded_ copy]];
      }
      return;
    }
    // An <image> href's file only inside the file boundary, and exactly the file checked.
    std::shared_ptr<ngn::FileAccess::Use> use;
    NSURL *url = nil;
    try {
      auto source = ngn::readableSource(ngn::viewFileAccess().get(), uri.UTF8String);
      url = [NSURL URLWithString:[NSString stringWithUTF8String:source.uri.c_str()]];
      use = std::move(source.use);
    } catch (const ngn::FileRefused &) {
      return;
    }
    if (url == nil) {
      return;
    }
    loading[uri] = imageLoaded_ != nil ? [NSMutableArray arrayWithObject:[imageLoaded_ copy]] : [NSMutableArray array];
    [[NSURLSession.sharedSession dataTaskWithURL:url
                               completionHandler:^(NSData *data, NSURLResponse *, NSError *) {
                                 (void)use;
                                 NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
                                 dispatch_async(dispatch_get_main_queue(), ^{
                                   NSArray *waiters = loading[uri];
                                   [loading removeObjectForKey:uri];
                                   if (image != nil) {
                                     [imageCache() setObject:image forKey:uri];
                                     for (void (^waiter)(void) in waiters) {
                                       waiter();
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
  std::vector<Filter> filters_;
};

} // namespace

CGColorRef NGNCreateColor(uint32_t argb, double opacity) {
  return createColorImpl(argb, opacity);
}

CGPathRef NGNCreatePath(const ngn::SvgPath &path) {
  return createPathImpl(path);
}

std::unique_ptr<ngn::SvgCanvas> NGNMakeCGCanvas(CGContextRef context, CGSize size, CGFloat scale, void (^imageLoaded)(void)) {
  return std::make_unique<CGCanvas>(context, size, scale, imageLoaded);
}
