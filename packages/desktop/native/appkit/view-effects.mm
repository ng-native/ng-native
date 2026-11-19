#import "view-effects.h"

namespace ngn::appkit {

namespace {

CIFilter *colorMatrix(const std::array<double, 20> &m) {
  CIFilter *filter = [CIFilter filterWithName:@"CIColorMatrix"];
  // Row by row of the spec's 4 by 5 matrix: each output channel's weights, and the offsets as the bias.
  [filter setValue:[CIVector vectorWithX:m[0] Y:m[1] Z:m[2] W:m[3]] forKey:@"inputRVector"];
  [filter setValue:[CIVector vectorWithX:m[5] Y:m[6] Z:m[7] W:m[8]] forKey:@"inputGVector"];
  [filter setValue:[CIVector vectorWithX:m[10] Y:m[11] Z:m[12] W:m[13]] forKey:@"inputBVector"];
  [filter setValue:[CIVector vectorWithX:m[15] Y:m[16] Z:m[17] W:m[18]] forKey:@"inputAVector"];
  [filter setValue:[CIVector vectorWithX:m[4] Y:m[9] Z:m[14] W:m[19]] forKey:@"inputBiasVector"];
  return filter;
}

} // namespace

NSArray<CIFilter *> *layerFilters(const std::vector<FilterStep> &steps) {
  NSMutableArray<CIFilter *> *filters = [NSMutableArray array];
  for (const auto &step : steps) {
    switch (step.type) {
      case FilterStep::Type::ColorMatrix:
        [filters addObject:colorMatrix(step.matrix)];
        [filters addObject:[CIFilter filterWithName:@"CIColorClamp"]];
        break;
      case FilterStep::Type::Blur: {
        CIFilter *blur = [CIFilter filterWithName:@"CIGaussianBlur"];
        // Core Image's radius is the Gaussian's standard deviation, as CSS's blur() is.
        [blur setValue:@(step.standardDeviation) forKey:kCIInputRadiusKey];
        [filters addObject:blur];
        break;
      }
      case FilterStep::Type::DropShadow:
        break;
    }
  }
  if (filters.count == 0) {
    return nil;
  }
  // The steps run on sRGB values, as Chrome's do, between the conversions out of and back into the
  // working space.
  [filters insertObject:[CIFilter filterWithName:@"CILinearToSRGBToneCurve"] atIndex:0];
  [filters addObject:[CIFilter filterWithName:@"CISRGBToneCurveToLinear"]];
  return filters;
}

NSString *blendFilterName(facebook::react::BlendMode mode) {
  using facebook::react::BlendMode;
  switch (mode) {
    case BlendMode::Multiply:
      return @"multiplyBlendMode";
    case BlendMode::Screen:
      return @"screenBlendMode";
    case BlendMode::Overlay:
      return @"overlayBlendMode";
    case BlendMode::Darken:
      return @"darkenBlendMode";
    case BlendMode::Lighten:
      return @"lightenBlendMode";
    case BlendMode::ColorDodge:
      return @"colorDodgeBlendMode";
    case BlendMode::ColorBurn:
      return @"colorBurnBlendMode";
    case BlendMode::HardLight:
      return @"hardLightBlendMode";
    case BlendMode::SoftLight:
      return @"softLightBlendMode";
    case BlendMode::Difference:
      return @"differenceBlendMode";
    case BlendMode::Exclusion:
      return @"exclusionBlendMode";
    case BlendMode::Hue:
      return @"hueBlendMode";
    case BlendMode::Saturation:
      return @"saturationBlendMode";
    case BlendMode::Color:
      return @"colorBlendMode";
    case BlendMode::Luminosity:
      return @"luminosityBlendMode";
    case BlendMode::PlusLighter:
      return @"linearDodgeBlendMode";
    case BlendMode::Normal:
      return nil;
  }
  return nil;
}

} // namespace ngn::appkit
