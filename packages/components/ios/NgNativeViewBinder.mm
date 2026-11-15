#import "NgNativeViewBinder.h"

#import <QuartzCore/QuartzCore.h>
#import <React/RCTViewComponentView.h>

/**
 How long a binder waits between looks for views it has not found yet, in seconds: at first, and
 at most, after looks that found nothing.
 */
static const CFTimeInterval FirstSearchInterval = 0.25;
static const CFTimeInterval LongestSearchInterval = 2;

/** A view found for a `nativeID`, and what attaching it answered. */
@interface NgNativeBinding : NSObject
@property (nonatomic, weak) UIView *view;
@property (nonatomic, strong) id token;
@end

@implementation NgNativeBinding
@end

NSString *NgNativeNativeIdOf(UIView *view)
{
  return [view isKindOfClass:[RCTViewComponentView class]] ? ((RCTViewComponentView *)view).nativeId : nil;
}

BOOL NgNativeLongPressTaken(UIView *touched, UIView *menuView, NSSet<NSString *> *takers)
{
  if (takers.count == 0) {
    return NO;
  }
  for (UIView *view = touched; view != nil && view != menuView; view = view.superview) {
    NSString *nativeID = NgNativeNativeIdOf(view);
    if (nativeID != nil && [takers containsObject:nativeID]) {
      return YES;
    }
  }
  return NO;
}

/** Each view under `view` whose `nativeID` is in `wanted`, the first one found for each. */
static void collect(UIView *view, NSSet<NSString *> *wanted, NSMutableDictionary<NSString *, UIView *> *found)
{
  NSString *nativeID = NgNativeNativeIdOf(view);
  if (nativeID != nil && found[nativeID] == nil && [wanted containsObject:nativeID]) {
    found[nativeID] = view;
  }
  for (UIView *subview in view.subviews) {
    if (found.count == wanted.count) {
      return;
    }
    collect(subview, wanted, found);
  }
}

@implementation NgNativeViewBinder {
  NgNativeViewAttach _attach;
  NgNativeViewDetach _detach;
  // Every `nativeID` asked for, with its view once found (NSNull until then).
  NSMutableDictionary<NSString *, id> *_bindings;
  // Runs `refresh` each time the main run loop finishes its work, so after every mount, while
  // there is anything to bind.
  CFRunLoopObserverRef _observer;
  CFTimeInterval _searchedAt;
}

@synthesize roots = _roots;

- (instancetype)initWithAttach:(NgNativeViewAttach)attach detach:(NgNativeViewDetach)detach
{
  if (self = [super init]) {
    _attach = [attach copy];
    _detach = [detach copy];
    _bindings = [NSMutableDictionary dictionary];
    _searchInterval = FirstSearchInterval;
  }
  return self;
}

- (NSArray<UIView *> * (^)(void))roots
{
  if (_roots != nil) {
    return _roots;
  }
  return ^NSArray<UIView *> * {
    NSMutableArray<UIView *> *windows = [NSMutableArray array];
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if ([scene isKindOfClass:[UIWindowScene class]]) {
        [windows addObjectsFromArray:((UIWindowScene *)scene).windows];
      }
    }
    return windows;
  };
}

/** Look at once, and often, for what changed. */
- (void)searchSoon
{
  _searchedAt = 0;
  _searchInterval = FirstSearchInterval;
}

- (void)dealloc
{
  [self stopObserving];
}

- (void)bind:(NSString *)nativeID
{
  if (_bindings[nativeID] == nil) {
    _bindings[nativeID] = [NSNull null];
  }
  // Looked for as the run loop finishes this pass, after a mount already on its way.
  [self searchSoon];
  [self startObserving];
}

- (void)unbind:(NSString *)nativeID
{
  [self detach:nativeID];
  [_bindings removeObjectForKey:nativeID];
  if (_bindings.count == 0) {
    [self stopObserving];
  }
}

- (void)unbindAll
{
  for (NSString *nativeID in _bindings.allKeys) {
    [self unbind:nativeID];
  }
}

- (void)startObserving
{
  if (_observer != NULL) {
    return;
  }
  __weak NgNativeViewBinder *weakSelf = self;
  _observer = CFRunLoopObserverCreateWithHandler(
      kCFAllocatorDefault, kCFRunLoopBeforeWaiting, true, 0, ^(CFRunLoopObserverRef observer, CFRunLoopActivity activity) {
        [weakSelf refresh];
      });
  CFRunLoopAddObserver(CFRunLoopGetMain(), _observer, kCFRunLoopCommonModes);
}

- (void)stopObserving
{
  if (_observer == NULL) {
    return;
  }
  CFRunLoopObserverInvalidate(_observer);
  CFRelease(_observer);
  _observer = NULL;
}

- (void)detach:(NSString *)nativeID
{
  id binding = _bindings[nativeID];
  if (![binding isKindOfClass:[NgNativeBinding class]]) {
    return;
  }
  _bindings[nativeID] = [NSNull null];
  [self searchSoon];
  UIView *view = ((NgNativeBinding *)binding).view;
  id token = ((NgNativeBinding *)binding).token;
  if (view != nil && token != nil) {
    _detach(view, token);
  }
}

- (void)refresh
{
  NSMutableSet<NSString *> *missing = [NSMutableSet set];
  for (NSString *nativeID in _bindings.allKeys) {
    id binding = _bindings[nativeID];
    if ([binding isKindOfClass:[NgNativeBinding class]]) {
      UIView *view = ((NgNativeBinding *)binding).view;
      // Unmounted (a recycled view is taken out first), or another element's now.
      if (view != nil && view.superview != nil && [NgNativeNativeIdOf(view) isEqualToString:nativeID]) {
        continue;
      }
      [self detach:nativeID];
    }
    [missing addObject:nativeID];
  }
  // A view not mounted yet is looked for at once after a change, then less often while it stays
  // missing: a whole search of every window is not cheap.
  CFTimeInterval now = CACurrentMediaTime();
  if (missing.count == 0 || now - _searchedAt < _searchInterval) {
    return;
  }
  _searchedAt = now;
  _searches++;
  NSMutableDictionary<NSString *, UIView *> *found = [NSMutableDictionary dictionary];
  for (UIView *root in self.roots()) {
    collect(root, missing, found);
  }
  _searchInterval = found.count == 0 ? MIN(_searchInterval * 2, LongestSearchInterval) : FirstSearchInterval;
  [found enumerateKeysAndObjectsUsingBlock:^(NSString *nativeID, UIView *view, BOOL *stop) {
    NgNativeBinding *binding = [NgNativeBinding new];
    binding.view = view;
    binding.token = self->_attach(view, nativeID);
    self->_bindings[nativeID] = binding;
  }];
}

@end
