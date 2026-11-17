#import "NgNativeSceneKeys.h"

BOOL NgNativeSessionHadWindow(NSDictionary *kept, NSString *session)
{
  return [kept[session] isKindOfClass:[NSString class]];
}

NSString *NgNativeSessionKey(NSDictionary *kept, NSString *session)
{
  id key = kept[session];
  return [key isKindOfClass:[NSString class]] && [key length] > 0 ? key : nil;
}

NSDictionary *NgNativeKeepSession(NSDictionary *kept, NSString *session, NSString *key)
{
  NSMutableDictionary *next = [kept mutableCopy] ?: [NSMutableDictionary dictionary];
  next[session] = key ?: @"";
  return next;
}

NSDictionary *NgNativeKeepOpenSessions(NSDictionary *kept, NSSet<NSString *> *open)
{
  NSMutableDictionary *next = [NSMutableDictionary dictionary];
  for (id session in kept) {
    if ([open containsObject:session]) {
      next[session] = kept[session];
    }
  }
  return next;
}

NSUInteger NgNativeSceneForKey(NSArray *sceneKeys, NSString *key)
{
  NSUInteger unkeyed = NSNotFound;
  for (NSUInteger index = 0; index < sceneKeys.count; index++) {
    id kept = sceneKeys[index];
    if (![kept isKindOfClass:[NSString class]]) {
      if (unkeyed == NSNotFound) {
        unkeyed = index;
      }
    } else if (key != nil && [kept isEqualToString:key]) {
      return index;
    }
  }
  return unkeyed;
}

NSUInteger NgNativeSessionForKey(NSDictionary *kept, NSArray<NSString *> *sessions, NSString *key)
{
  for (NSUInteger index = 0; index < sessions.count; index++) {
    if ([NgNativeSessionKey(kept, sessions[index]) isEqualToString:key]) {
      return index;
    }
  }
  return NSNotFound;
}
