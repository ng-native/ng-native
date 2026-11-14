#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <UIKit/UIKit.h>

#import "NgNativeMenuBuilding.h"
#import "NgNativeResponderHooks.h"
#import "NgNativeViewBinder.h"

/**
 The `NgNativeMenus` module on iOS (`NativeMenus` in @ng-native/device):
 - `setMenuBar(groups)`: on an iPad, the app's groups in the main menu through UIMenuBuilder, the
   iPadOS menu bar and the hold-Cmd overlay. A group with a standard `menuRole` adds its items to
   that menu, another is a menu of its own after View. Role items the OS does itself stay its own.
 - `setShortcuts(shortcuts)`: a UIKeyCommand for each, from a hardware keyboard, on the app
   delegate, so they work wherever focus is.
 - `setContextMenu(nativeID, entries)`: a UIContextMenuInteraction on React Native's own view with
   that `nativeID`, added once the view is mounted, its menu read as it opens, and removed with
   null, or as the view is unmounted, recycled or renamed. A long press opens it, and a secondary
   click from an iPad pointer.
 - Events on `ngNativeMenus`: `menuSelect` for a menu bar item, `shortcut` with
   `textInputFocused`, `navigate` for the Back and Forward roles, and `contextMenuSelect` with the
   view's `nativeID` and the item's `id`, since React Native's view sends no event it does not know.
 - `menuBar` is true on an iPad and false on an iPhone; `appName` is the bundle's display name.
 */
@interface NgNativeMenus : NSObject <RCTBridgeModule, RCTInvalidating, NgNativeMenusHost>
- (nullable NSArray *)contextMenuFor:(NSString *)nativeID;
- (void)send:(NSDictionary *)event;
@end

/** The delegate of one view's context menu interaction, which it keeps. */
@interface NgNativeContextMenuTarget : NSObject <UIContextMenuInteractionDelegate>
@property (nonatomic, readonly) UIContextMenuInteraction *interaction;
@end

@implementation NgNativeContextMenuTarget {
  NSString *_nativeID;
  __weak NgNativeMenus *_module;
}

- (instancetype)initWithNativeID:(NSString *)nativeID module:(NgNativeMenus *)module
{
  if (self = [super init]) {
    _nativeID = [nativeID copy];
    _module = module;
    _interaction = [[UIContextMenuInteraction alloc] initWithDelegate:self];
  }
  return self;
}

- (UIContextMenuConfiguration *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                        configurationForMenuAtLocation:(CGPoint)location
{
  // The menu as it is when it opens.
  NSArray *entries = [_module contextMenuFor:_nativeID];
  if (entries.count == 0) {
    return nil;
  }
  NSString *nativeID = _nativeID;
  __weak NgNativeMenus *module = _module;
  return [UIContextMenuConfiguration
      configurationWithIdentifier:nil
                  previewProvider:nil
                   actionProvider:^UIMenu *(NSArray<UIMenuElement *> *suggested) {
                     NSArray<UIMenuElement *> *elements = NgNativeMenuElements(
                         entries,
                         ^(NSString *itemId) {
                           [module send:@{@"type" : @"contextMenuSelect", @"nativeID" : nativeID, @"id" : itemId}];
                         },
                         NULL);
                     return [UIMenu menuWithTitle:@"" children:elements];
                   }];
}

@end

static NSString *const NavigatePrefix = @"navigate:";

static UIMenuIdentifier standardMenu(NSString *role)
{
  static NSDictionary<NSString *, UIMenuIdentifier> *menus;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    menus = @{
      @"app" : UIMenuApplication,
      @"file" : UIMenuFile,
      @"edit" : UIMenuEdit,
      @"view" : UIMenuView,
      @"window" : UIMenuWindow,
      @"help" : UIMenuHelp,
    };
  });
  return [role isKindOfClass:[NSString class]] ? menus[role] : nil;
}

@implementation NgNativeMenus {
  NSArray *_menuBar;
  NSArray<UIKeyCommand *> *_shortcuts;
  NSMutableDictionary<NSString *, NSArray *> *_contextMenus;
  NgNativeViewBinder *_contextMenuViews;
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
    _menuBar = @[];
    _shortcuts = @[];
    _contextMenus = [NSMutableDictionary dictionary];
    __weak NgNativeMenus *weakSelf = self;
    _contextMenuViews = [[NgNativeViewBinder alloc]
        initWithAttach:^id(UIView *view, NSString *nativeID) {
          NgNativeMenus *module = weakSelf;
          if (module == nil) {
            return nil;
          }
          NgNativeContextMenuTarget *target = [[NgNativeContextMenuTarget alloc] initWithNativeID:nativeID
                                                                                           module:module];
          [view addInteraction:target.interaction];
          return target;
        }
        detach:^(UIView *view, NgNativeContextMenuTarget *target) {
          [view removeInteraction:target.interaction];
        }];
    dispatch_async(dispatch_get_main_queue(), ^{
      NgNativeInstallResponderHooks();
      NgNativeSetMenusHost(self);
    });
  }
  return self;
}

// A reload makes a new module: this one's menus go with it.
- (void)invalidate
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_contextMenuViews unbindAll];
    [self->_contextMenus removeAllObjects];
  });
}

- (NSDictionary *)constantsToExport
{
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  return @{
    @"menuBar" : @(UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad),
    @"appName" : info[@"CFBundleDisplayName"] ?: info[@"CFBundleName"] ?: @"",
  };
}

RCT_EXPORT_METHOD(setMenuBar : (NSArray *)groups)
{
  _menuBar = [groups isKindOfClass:[NSArray class]] ? groups : @[];
  [UIMenuSystem.mainSystem setNeedsRebuild];
}

RCT_EXPORT_METHOD(setShortcuts : (NSArray *)shortcuts)
{
  NSMutableArray<UIKeyCommand *> *commands = [NSMutableArray array];
  for (NSDictionary *shortcut in [shortcuts isKindOfClass:[NSArray class]] ? shortcuts : @[]) {
    if (![shortcut isKindOfClass:[NSDictionary class]] || ![shortcut[@"chord"] isKindOfClass:[NSDictionary class]]) {
      continue;
    }
    UIKeyModifierFlags flags = 0;
    NSString *input = NgNativeKeyInput(shortcut[@"chord"], &flags);
    NSString *itemId = shortcut[@"id"];
    if (input == nil || ![itemId isKindOfClass:[NSString class]]) {
      continue;
    }
    NSString *label = [shortcut[@"label"] isKindOfClass:[NSString class]] ? shortcut[@"label"] : @"";
    UIKeyCommand *command = [UIKeyCommand commandWithTitle:label
                                                     image:nil
                                                    action:@selector(ngn_shortcut:)
                                                     input:input
                                             modifierFlags:flags
                                              propertyList:itemId];
    command.discoverabilityTitle = label.length > 0 ? label : nil;
    [commands addObject:command];
  }
  _shortcuts = commands;
}

RCT_EXPORT_METHOD(setContextMenu : (NSString *)nativeID entries : (nullable NSArray *)entries)
{
  if (![nativeID isKindOfClass:[NSString class]] || nativeID.length == 0) {
    return;
  }
  if ([entries isKindOfClass:[NSArray class]] && entries.count > 0) {
    _contextMenus[nativeID] = entries;
    [_contextMenuViews bind:nativeID];
  } else {
    [_contextMenus removeObjectForKey:nativeID];
    [_contextMenuViews unbind:nativeID];
  }
}

- (NSArray *)contextMenuFor:(NSString *)nativeID
{
  return _contextMenus[nativeID];
}

- (void)send:(NSDictionary *)event
{
  [_callableJSModules invokeModule:@"RCTDeviceEventEmitter" method:@"emit" withArgs:@[ @"ngNativeMenus", event ]];
}

#pragma mark - NgNativeMenusHost

- (NSArray<UIKeyCommand *> *)shortcutKeyCommands
{
  return _shortcuts;
}

- (void)buildMenuBar:(id<UIMenuBuilder>)builder
{
  if (builder.system != UIMenuSystem.mainSystem || UIDevice.currentDevice.userInterfaceIdiom != UIUserInterfaceIdiomPad) {
    return;
  }
  UIMenuIdentifier after = UIMenuView;
  NSUInteger index = 0;
  for (NSDictionary *group in _menuBar) {
    index++;
    if (![group isKindOfClass:[NSDictionary class]] || ![group[@"items"] isKindOfClass:[NSArray class]]) {
      continue;
    }
    NSArray<UIMenuElement *> *elements = NgNativeMenuElements(group[@"items"], ^(NSString *itemId) {
    }, @selector(ngn_menuBarItem:));
    if (elements.count == 0) {
      continue;
    }
    UIMenuIdentifier identifier = [NSString stringWithFormat:@"dev.ngnative.menu.%lu", (unsigned long)index];
    UIMenuIdentifier standard = standardMenu(group[@"menuRole"]);
    if (standard != nil && [builder menuForIdentifier:standard] != nil) {
      UIMenu *section = [UIMenu menuWithTitle:@""
                                        image:nil
                                   identifier:identifier
                                      options:UIMenuOptionsDisplayInline
                                     children:elements];
      [builder insertChildMenu:section atEndOfMenuForIdentifier:standard];
    } else {
      NSString *label = [group[@"label"] isKindOfClass:[NSString class]] ? group[@"label"] : @"";
      UIMenu *menu = [UIMenu menuWithTitle:label image:nil identifier:identifier options:0 children:elements];
      [builder insertSiblingMenu:menu afterMenuForIdentifier:after];
      after = identifier;
    }
  }
}

- (void)commandChosen:(UICommand *)command shortcut:(BOOL)shortcut
{
  NSString *itemId = [command.propertyList isKindOfClass:[NSString class]] ? command.propertyList : nil;
  if (itemId == nil) {
    return;
  }
  NSDictionary *event;
  if ([itemId hasPrefix:NavigatePrefix]) {
    event = @{@"type" : @"navigate", @"direction" : [itemId substringFromIndex:NavigatePrefix.length]};
  } else if (shortcut) {
    event = @{@"type" : @"shortcut", @"id" : itemId, @"textInputFocused" : @(NgNativeTextInputFocused())};
  } else {
    event = @{@"type" : @"menuSelect", @"id" : itemId};
  }
  [self send:event];
}

@end
