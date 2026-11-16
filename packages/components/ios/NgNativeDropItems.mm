#import "NgNativeDropItems.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

/** A file item: a file URL, or a file the dragging app lets the app open in place (the Files app). */
static BOOL isFile(NSItemProvider *provider)
{
  if ([provider hasItemConformingToTypeIdentifier:UTTypeFileURL.identifier]) {
    return YES;
  }
  NSString *type = NgNativeDropFileType(provider);
  return type != nil &&
      [provider hasRepresentationConformingToTypeIdentifier:type fileOptions:NSItemProviderFileOptionOpenInPlace];
}

NgNativeDropKind NgNativeDropKindOf(NSItemProvider *provider)
{
  if (isFile(provider)) {
    return NgNativeDropKindFile;
  }
  if ([provider hasItemConformingToTypeIdentifier:UTTypeURL.identifier] &&
      [provider canLoadObjectOfClass:[NSURL class]]) {
    return NgNativeDropKindWebURL;
  }
  if ([provider hasItemConformingToTypeIdentifier:UTTypePlainText.identifier] &&
      [provider canLoadObjectOfClass:[NSString class]]) {
    return NgNativeDropKindText;
  }
  return provider.registeredTypeIdentifiers.firstObject != nil ? NgNativeDropKindFile : NgNativeDropKindNone;
}

NSString *_Nullable NgNativeDropFileType(NSItemProvider *provider)
{
  for (NSString *identifier in provider.registeredTypeIdentifiers) {
    if (![[UTType typeWithIdentifier:identifier] conformsToType:UTTypeURL]) {
      return identifier;
    }
  }
  return provider.registeredTypeIdentifiers.firstObject;
}

NSString *NgNativeDropFileName(NSString *_Nullable suggestedName, NSString *_Nullable type)
{
  // The dragging app names the file: `../x` would write outside the item's folder.
  NSString *name = suggestedName.lastPathComponent;
  if (name.length == 0 || [name isEqualToString:@"."] || [name isEqualToString:@".."] ||
      [name isEqualToString:@"/"]) {
    name = @"file";
  }
  NSString *extension = type != nil ? [UTType typeWithIdentifier:type].preferredFilenameExtension : nil;
  if (extension.length > 0 && name.pathExtension.length == 0) {
    name = [name stringByAppendingPathExtension:extension];
  }
  return name;
}
