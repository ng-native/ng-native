#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#import "NgNativeDropItems.h"
#import "NgNativeViewBinder.h"

/**
 The `NgNativeDragAndDrop` module on iOS (`NativeDragAndDrop` in @ng-native/device), which adds
 interactions to React Native's own views by `nativeID`, once each is mounted, and removes them as
 it is unmounted, recycled or renamed. iPadOS only: on an iPhone every call does nothing.
 - `setFileDrop(nativeID, takes)`: a UIDropInteraction that takes files, text and urls, sending
   `dropEnter`, `dropLeave` and `dropPerform` with `{ nativeID, files, text, urls }` on
   `ngNativeDragAndDrop`. A dropped file is copied into the app's temporary folder, since the OS
   takes its own copy away when the drop ends.
 - `setDragItem(nativeID, item)`: a UIDragInteraction offering `{ files, text, url }` from a long
   press, or none with null.
 */
@interface NgNativeDragAndDrop : NSObject <RCTBridgeModule, RCTInvalidating>
- (nullable NSDictionary *)dragItemFor:(NSString *)nativeID;
- (void)send:(NSString *)type nativeID:(NSString *)nativeID drop:(nullable NSDictionary *)drop;
@end

static BOOL takesDrags(void)
{
  return UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad;
}

static NSString *nonEmptyString(id value)
{
  return [value isKindOfClass:[NSString class]] && [value length] > 0 ? value : nil;
}

#pragma mark - Drop

/** The delegate of one view's drop interaction, which it keeps. */
@interface NgNativeDropTarget : NSObject <UIDropInteractionDelegate>
@property (nonatomic, readonly) UIDropInteraction *interaction;
@end

@implementation NgNativeDropTarget {
  NSString *_nativeID;
  __weak NgNativeDragAndDrop *_module;
  // A drop ends the drag without `dropLeave`.
  BOOL _dropped;
}

- (instancetype)initWithNativeID:(NSString *)nativeID module:(NgNativeDragAndDrop *)module
{
  if (self = [super init]) {
    _nativeID = [nativeID copy];
    _module = module;
    _interaction = [[UIDropInteraction alloc] initWithDelegate:self];
  }
  return self;
}

- (BOOL)dropInteraction:(UIDropInteraction *)interaction canHandleSession:(id<UIDropSession>)session
{
  return [session hasItemsConformingToTypeIdentifiers:@[ UTTypeItem.identifier ]];
}

- (void)dropInteraction:(UIDropInteraction *)interaction sessionDidEnter:(id<UIDropSession>)session
{
  _dropped = NO;
  // iOS shows nothing of what is dragged until it is dropped.
  [_module send:@"dropEnter" nativeID:_nativeID drop:nil];
}

- (UIDropProposal *)dropInteraction:(UIDropInteraction *)interaction sessionDidUpdate:(id<UIDropSession>)session
{
  return [[UIDropProposal alloc] initWithDropOperation:UIDropOperationCopy];
}

- (void)dropInteraction:(UIDropInteraction *)interaction sessionDidExit:(id<UIDropSession>)session
{
  if (!_dropped) {
    [_module send:@"dropLeave" nativeID:_nativeID drop:nil];
  }
}

- (void)dropInteraction:(UIDropInteraction *)interaction performDrop:(id<UIDropSession>)session
{
  _dropped = YES;
  NSMutableArray<NSDictionary *> *files = [NSMutableArray array];
  NSMutableArray<NSString *> *urls = [NSMutableArray array];
  NSMutableArray<NSString *> *texts = [NSMutableArray array];
  NSObject *lock = [NSObject new];
  dispatch_group_t group = dispatch_group_create();
  NSURL *folder = [[NSURL fileURLWithPath:NSTemporaryDirectory()]
      URLByAppendingPathComponent:[NSString stringWithFormat:@"NgNativeDrops/%@", NSUUID.UUID.UUIDString]];

  NSUInteger index = 0;
  for (UIDragItem *item in session.items) {
    NSItemProvider *provider = item.itemProvider;
    NgNativeDropKind kind = NgNativeDropKindOf(provider);
    NSString *type = NgNativeDropFileType(provider);
    if (kind == NgNativeDropKindNone || (kind == NgNativeDropKindFile && type == nil)) {
      continue;
    }
    dispatch_group_enter(group);
    if (kind == NgNativeDropKindWebURL) {
      [provider loadObjectOfClass:[NSURL class]
                completionHandler:^(id<NSItemProviderReading> object, NSError *error) {
                  NSURL *url = [(NSObject *)object isKindOfClass:[NSURL class]] ? (NSURL *)object : nil;
                  if (url != nil) {
                    @synchronized(lock) {
                      [urls addObject:url.absoluteString];
                    }
                  }
                  dispatch_group_leave(group);
                }];
    } else if (kind == NgNativeDropKindText) {
      [provider loadObjectOfClass:[NSString class]
                completionHandler:^(id<NSItemProviderReading> object, NSError *error) {
                  if ([(NSObject *)object isKindOfClass:[NSString class]]) {
                    @synchronized(lock) {
                      [texts addObject:(NSString *)object];
                    }
                  }
                  dispatch_group_leave(group);
                }];
    } else {
      NSString *name = NgNativeDropFileName(provider.suggestedName, type);
      // A folder for each item, so two files of one name both arrive.
      NSURL *itemFolder = [folder URLByAppendingPathComponent:[NSString stringWithFormat:@"%lu", (unsigned long)index]];
      [provider loadFileRepresentationForTypeIdentifier:type
                                      completionHandler:^(NSURL *url, NSError *error) {
                                        // The OS removes `url` when this returns: keep a copy.
                                        if (url != nil) {
                                          NSFileManager *manager = NSFileManager.defaultManager;
                                          NSURL *kept = [itemFolder URLByAppendingPathComponent:name];
                                          if ([manager createDirectoryAtURL:itemFolder
                                                  withIntermediateDirectories:YES
                                                                   attributes:nil
                                                                        error:nil] &&
                                              [manager copyItemAtURL:url toURL:kept error:nil]) {
                                            @synchronized(lock) {
                                              [files addObject:@{@"uri" : kept.absoluteString, @"name" : name}];
                                            }
                                          }
                                        }
                                        dispatch_group_leave(group);
                                      }];
    }
    index++;
  }

  __weak NgNativeDragAndDrop *module = _module;
  NSString *nativeID = _nativeID;
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{
    NSString *text = texts.count > 0 ? [texts componentsJoinedByString:@"\n"] : nil;
    [module send:@"dropPerform"
        nativeID:nativeID
            drop:@{@"files" : [files copy], @"urls" : [urls copy], @"text" : text ?: [NSNull null]}];
  });
}

- (void)dropInteraction:(UIDropInteraction *)interaction sessionDidEnd:(id<UIDropSession>)session
{
  _dropped = NO;
}

@end

#pragma mark - Drag

/** The delegate of one view's drag interaction, which it keeps. */
@interface NgNativeDragSource : NSObject <UIDragInteractionDelegate>
@property (nonatomic, readonly) UIDragInteraction *interaction;
@end

@implementation NgNativeDragSource {
  NSString *_nativeID;
  __weak NgNativeDragAndDrop *_module;
}

- (instancetype)initWithNativeID:(NSString *)nativeID module:(NgNativeDragAndDrop *)module
{
  if (self = [super init]) {
    _nativeID = [nativeID copy];
    _module = module;
    _interaction = [[UIDragInteraction alloc] initWithDelegate:self];
    _interaction.enabled = YES;
  }
  return self;
}

- (NSArray<UIDragItem *> *)dragInteraction:(UIDragInteraction *)interaction
                  itemsForBeginningSession:(id<UIDragSession>)session
{
  NSDictionary *item = [_module dragItemFor:_nativeID];
  if (item == nil) {
    return @[];
  }
  NSMutableArray<UIDragItem *> *items = [NSMutableArray array];
  NSArray *files = [item[@"files"] isKindOfClass:[NSArray class]] ? item[@"files"] : @[];
  for (id file in files) {
    NSURL *url = nonEmptyString(file) ? [NSURL URLWithString:file] : nil;
    NSItemProvider *provider = url.isFileURL ? [[NSItemProvider alloc] initWithContentsOfURL:url] : nil;
    if (provider != nil) {
      provider.suggestedName = url.lastPathComponent;
      [items addObject:[[UIDragItem alloc] initWithItemProvider:provider]];
    }
  }
  NSString *text = nonEmptyString(item[@"text"]);
  if (text != nil) {
    [items addObject:[[UIDragItem alloc] initWithItemProvider:[[NSItemProvider alloc] initWithObject:text]]];
  }
  NSString *link = nonEmptyString(item[@"url"]);
  NSURL *url = link != nil ? [NSURL URLWithString:link] : nil;
  if (url != nil) {
    [items addObject:[[UIDragItem alloc] initWithItemProvider:[[NSItemProvider alloc] initWithObject:url]]];
  }
  return items;
}

@end

#pragma mark - Module

@implementation NgNativeDragAndDrop {
  NSMutableDictionary<NSString *, NSDictionary *> *_dragItems;
  NgNativeViewBinder *_dropViews;
  NgNativeViewBinder *_dragViews;
}

@synthesize callableJSModules = _callableJSModules;

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if (self = [super init]) {
    _dragItems = [NSMutableDictionary dictionary];
    __weak NgNativeDragAndDrop *weakSelf = self;
    _dropViews = [[NgNativeViewBinder alloc]
        initWithAttach:^id(UIView *view, NSString *nativeID) {
          NgNativeDragAndDrop *module = weakSelf;
          if (module == nil) {
            return nil;
          }
          NgNativeDropTarget *target = [[NgNativeDropTarget alloc] initWithNativeID:nativeID module:module];
          [view addInteraction:target.interaction];
          return target;
        }
        detach:^(UIView *view, NgNativeDropTarget *target) {
          [view removeInteraction:target.interaction];
        }];
    _dragViews = [[NgNativeViewBinder alloc]
        initWithAttach:^id(UIView *view, NSString *nativeID) {
          NgNativeDragAndDrop *module = weakSelf;
          if (module == nil) {
            return nil;
          }
          NgNativeDragSource *source = [[NgNativeDragSource alloc] initWithNativeID:nativeID module:module];
          [view addInteraction:source.interaction];
          return source;
        }
        detach:^(UIView *view, NgNativeDragSource *source) {
          [view removeInteraction:source.interaction];
        }];
  }
  return self;
}

// A reload makes a new module: this one's interactions go with it.
- (void)invalidate
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_dropViews unbindAll];
    [self->_dragViews unbindAll];
    [self->_dragItems removeAllObjects];
  });
}

RCT_EXPORT_METHOD(setFileDrop : (NSString *)nativeID takes : (BOOL)takes)
{
  if (!takesDrags() || nonEmptyString(nativeID) == nil) {
    return;
  }
  takes ? [_dropViews bind:nativeID] : [_dropViews unbind:nativeID];
}

RCT_EXPORT_METHOD(setDragItem : (NSString *)nativeID item : (nullable NSDictionary *)item)
{
  if (!takesDrags() || nonEmptyString(nativeID) == nil) {
    return;
  }
  if ([item isKindOfClass:[NSDictionary class]]) {
    _dragItems[nativeID] = item;
    [_dragViews bind:nativeID];
  } else {
    [_dragItems removeObjectForKey:nativeID];
    [_dragViews unbind:nativeID];
  }
}

- (NSDictionary *)dragItemFor:(NSString *)nativeID
{
  return _dragItems[nativeID];
}

- (void)send:(NSString *)type nativeID:(NSString *)nativeID drop:(NSDictionary *)drop
{
  NSMutableDictionary *event = [@{
    @"type" : type,
    @"nativeID" : nativeID,
    @"files" : @[],
    @"text" : [NSNull null],
    @"urls" : @[],
  } mutableCopy];
  [event addEntriesFromDictionary:drop ?: @{}];
  [_callableJSModules invokeModule:@"RCTDeviceEventEmitter" method:@"emit" withArgs:@[ @"ngNativeDragAndDrop", event ]];
}

@end
