// What a dropped item on iOS is, and the name its copy is kept under, apart from the module so the
// unit tests reach them without React Native.
#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, NgNativeDropKind) {
  NgNativeDropKindNone,
  // A file, from the Files app or another app's document, whatever its contents: `files`.
  NgNativeDropKindFile,
  // A link that is not a file: `urls`.
  NgNativeDropKindWebURL,
  // Text that is not a file, a selection dragged from another app: `text`.
  NgNativeDropKindText,
};

NgNativeDropKind NgNativeDropKindOf(NSItemProvider *provider);

// The type a file item is loaded as: its content's type, not a URL's.
NSString *_Nullable NgNativeDropFileType(NSItemProvider *provider);

// The name a dropped file's copy takes: the last part of the name the dragging app suggests, never
// a path out of the item's folder, `file` where that leaves nothing, with the type's extension
// where it has none.
NSString *NgNativeDropFileName(NSString *_Nullable suggestedName, NSString *_Nullable type);

NS_ASSUME_NONNULL_END
