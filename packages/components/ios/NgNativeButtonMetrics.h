// How `<native-button>` is drawn and measured on iOS, in one place: the view configures its
// UIButton with these and the shadow node measures with them, so Yoga's size is the button's.
// Every call is safe off the main thread, where Fabric measures.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// The title's font for a `controlSize`, at the user's text size.
UIFont *NgNativeButtonFont(NSString *controlSize);

// The space around the title and symbol for a `controlSize`.
NSDirectionalEdgeInsets NgNativeButtonInsets(NSString *controlSize);

// UIButton's own size class for a `controlSize`: mini, small, medium (regular) or large.
UIButtonConfigurationSize NgNativeButtonConfigurationSize(NSString *controlSize);

// Between the symbol and the title.
extern const CGFloat NgNativeButtonImagePadding;

// The symbol drawn beside the title, or nil for none or a name the OS lacks.
UIImage *_Nullable NgNativeButtonSymbol(NSString *sfSymbol, NSString *controlSize);

// The side of an icon image drawn beside the title, in points: a symbol's height in the title's font.
CGFloat NgNativeButtonImageSide(NSString *controlSize);

// An icon image from a PNG `data:` URI, a template image `NgNativeButtonImageSide` square that the
// button tints as it does a symbol, or nil for none or data that is no image.
UIImage *_Nullable NgNativeButtonImage(NSString *uri, NSString *controlSize);

// The button's natural size: one line of title, the symbol or else an icon image, and the insets.
CGSize NgNativeButtonNaturalSize(NSString *title, NSString *controlSize, NSString *sfSymbol, BOOL hasImage);

NS_ASSUME_NONNULL_END
