#import "NgNativeButtonMetrics.h"

const CGFloat NgNativeButtonImagePadding = 6;

UIFont *NgNativeButtonFont(NSString *controlSize)
{
  if ([controlSize isEqualToString:@"mini"]) {
    return [UIFont preferredFontForTextStyle:UIFontTextStyleCaption2];
  }
  if ([controlSize isEqualToString:@"small"]) {
    return [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
  }
  return [UIFont preferredFontForTextStyle:UIFontTextStyleBody];
}

NSDirectionalEdgeInsets NgNativeButtonInsets(NSString *controlSize)
{
  if ([controlSize isEqualToString:@"mini"]) {
    return NSDirectionalEdgeInsetsMake(3, 8, 3, 8);
  }
  if ([controlSize isEqualToString:@"small"]) {
    return NSDirectionalEdgeInsetsMake(5, 10, 5, 10);
  }
  if ([controlSize isEqualToString:@"large"]) {
    return NSDirectionalEdgeInsetsMake(14, 20, 14, 20);
  }
  return NSDirectionalEdgeInsetsMake(7, 14, 7, 14);
}

UIButtonConfigurationSize NgNativeButtonConfigurationSize(NSString *controlSize)
{
  if ([controlSize isEqualToString:@"mini"]) {
    return UIButtonConfigurationSizeMini;
  }
  if ([controlSize isEqualToString:@"small"]) {
    return UIButtonConfigurationSizeSmall;
  }
  if ([controlSize isEqualToString:@"large"]) {
    return UIButtonConfigurationSizeLarge;
  }
  return UIButtonConfigurationSizeMedium;
}

UIImage *_Nullable NgNativeButtonSymbol(NSString *sfSymbol, NSString *controlSize)
{
  if (sfSymbol.length == 0) {
    return nil;
  }
  UIImageSymbolConfiguration *configuration =
      [UIImageSymbolConfiguration configurationWithFont:NgNativeButtonFont(controlSize)
                                                  scale:UIImageSymbolScaleMedium];
  return [UIImage systemImageNamed:sfSymbol withConfiguration:configuration];
}

CGFloat NgNativeButtonImageSide(NSString *controlSize)
{
  return round(NgNativeButtonFont(controlSize).pointSize * 1.2);
}

UIImage *_Nullable NgNativeButtonImage(NSString *uri, NSString *controlSize)
{
  NSRange comma = [uri rangeOfString:@";base64,"];
  if (![uri hasPrefix:@"data:"] || comma.location == NSNotFound) {
    return nil;
  }
  NSData *data = [[NSData alloc] initWithBase64EncodedString:[uri substringFromIndex:NSMaxRange(comma)]
                                                     options:NSDataBase64DecodingIgnoreUnknownCharacters];
  UIImage *decoded = data != nil ? [UIImage imageWithData:data] : nil;
  CGImageRef pixels = decoded.CGImage;
  if (pixels == NULL) {
    return nil;
  }
  // Its pixels to a point chosen so that it is the side square, whatever size it was drawn at.
  CGFloat longest = MAX(CGImageGetWidth(pixels), CGImageGetHeight(pixels));
  UIImage *sized = [UIImage imageWithCGImage:pixels
                                       scale:longest / NgNativeButtonImageSide(controlSize)
                                 orientation:UIImageOrientationUp];
  return [sized imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
}

CGSize NgNativeButtonNaturalSize(NSString *title, NSString *controlSize, NSString *sfSymbol, BOOL hasImage)
{
  UIFont *font = NgNativeButtonFont(controlSize);
  CGSize text = title.length > 0 ? [title sizeWithAttributes:@{NSFontAttributeName : font}] : CGSizeZero;
  CGFloat width = ceil(text.width);
  CGFloat height = ceil(MAX(text.height, font.lineHeight));
  UIImage *symbol = NgNativeButtonSymbol(sfSymbol, controlSize);
  CGSize picture = symbol != nil ? symbol.size
      : hasImage                 ? CGSizeMake(NgNativeButtonImageSide(controlSize), NgNativeButtonImageSide(controlSize))
                                 : CGSizeZero;
  if (picture.width > 0) {
    width += ceil(picture.width) + (title.length > 0 ? NgNativeButtonImagePadding : 0);
    height = MAX(height, ceil(picture.height));
  }
  NSDirectionalEdgeInsets insets = NgNativeButtonInsets(controlSize);
  return CGSizeMake(width + insets.leading + insets.trailing, height + insets.top + insets.bottom);
}
