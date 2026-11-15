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

CGSize NgNativeButtonNaturalSize(NSString *title, NSString *controlSize, NSString *sfSymbol)
{
  UIFont *font = NgNativeButtonFont(controlSize);
  CGSize text = title.length > 0 ? [title sizeWithAttributes:@{NSFontAttributeName : font}] : CGSizeZero;
  CGFloat width = ceil(text.width);
  CGFloat height = ceil(MAX(text.height, font.lineHeight));
  UIImage *symbol = NgNativeButtonSymbol(sfSymbol, controlSize);
  if (symbol != nil) {
    width += ceil(symbol.size.width) + (title.length > 0 ? NgNativeButtonImagePadding : 0);
    height = MAX(height, ceil(symbol.size.height));
  }
  NSDirectionalEdgeInsets insets = NgNativeButtonInsets(controlSize);
  return CGSizeMake(width + insets.leading + insets.trailing, height + insets.top + insets.bottom);
}
