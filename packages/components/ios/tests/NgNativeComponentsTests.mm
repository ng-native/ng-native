// Unit tests for the iOS code of @ng-native/components that runs without React Native: the view
// binder, the menu building (the iPad menu bar's duplicate keys among it), the long press a view
// inside a context menu takes, `NgNativeHook`'s call-through, which first responders answer the
// shared undo manager, the undo steps, what a dropped item is, the split view's delegate, and which
// scene a window opens in. The hooks installed on UIApplication and the app delegate, and the
// modules themselves, need React Native and are not here. Run by `run-tests.sh` on a simulator,
// through XCTest's own runner; no CI job runs them.
#import <React/RCTViewComponentView.h>
#import <XCTest/XCTest.h>
#import <objc/runtime.h>

#import "../NgNativeMenuBuilding.h"
#import "../NgNativeResponderHooks.h"
#import "../NgNativeUndoSteps.h"
#import "../NgNativeDropItems.h"
#import "../NgNativeSplitViewDelegate.h"
#import "../NgNativeSceneKeys.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import "../NgNativeViewBinder.h"

@implementation RCTViewComponentView
@end

// A method no class has, which a hook adds.
@interface NSObject (NgNativeHookTest)
- (NSString *)description2;
@end

static RCTViewComponentView *viewNamed(NSString *nativeID)
{
  RCTViewComponentView *view = [RCTViewComponentView new];
  view.nativeId = nativeID;
  return view;
}

#pragma mark - The binder

@interface NgNativeViewBinderTests : XCTestCase
@end

@implementation NgNativeViewBinderTests {
  UIView *_root;
  NgNativeViewBinder *_binder;
  NSMutableArray<NSString *> *_calls;
}

- (void)setUp
{
  _root = [UIView new];
  _calls = [NSMutableArray array];
  NSMutableArray<NSString *> *calls = _calls;
  _binder = [[NgNativeViewBinder alloc]
      initWithAttach:^id(UIView *view, NSString *nativeID) {
        [calls addObject:[@"attach " stringByAppendingString:nativeID]];
        return @"token";
      }
      detach:^(UIView *view, id token) {
        [calls addObject:[NSString stringWithFormat:@"detach %@ %@", ((RCTViewComponentView *)view).nativeId, token]];
      }];
  UIView *root = _root;
  _binder.roots = ^NSArray<UIView *> * {
    return @[ root ];
  };
}

- (void)tearDown
{
  [_binder unbindAll];
}

- (void)testAttachesTheViewWithTheNameOnceItIsMounted
{
  [_binder bind:@"row"];
  [_binder refresh];
  XCTAssertEqualObjects(_calls, @[]);
  UIView *parent = [UIView new];
  [_root addSubview:parent];
  [parent addSubview:viewNamed(@"other")];
  [parent addSubview:viewNamed(@"row")];
  [_binder bind:@"row"];
  [_binder refresh];
  XCTAssertEqualObjects(_calls, @[ @"attach row" ]);
  [_binder refresh];
  XCTAssertEqualObjects(_calls, @[ @"attach row" ], @"once");
}

- (void)testDetachesAViewThatIsUnmountedOrRenamed
{
  RCTViewComponentView *view = viewNamed(@"row");
  [_root addSubview:view];
  [_binder bind:@"row"];
  [_binder refresh];
  view.nativeId = @"renamed";
  [_binder refresh];
  XCTAssertEqualObjects(_calls, (@[ @"attach row", @"detach renamed token" ]));
  view.nativeId = @"row";
  [_binder bind:@"row"];
  [_binder refresh];
  [view removeFromSuperview];
  [_binder refresh];
  XCTAssertEqualObjects(_calls.lastObject, @"detach row token", @"a recycled view leaves its superview first");
}

- (void)testDetachesOnUnbind
{
  [_root addSubview:viewNamed(@"row")];
  [_binder bind:@"row"];
  [_binder refresh];
  [_binder unbind:@"row"];
  XCTAssertEqualObjects(_calls, (@[ @"attach row", @"detach row token" ]));
}

- (void)testAnswersTheTokenOfTheBindingNowAndNotOneAViewOfTheSameNameHadBefore
{
  __block NSUInteger made = 0;
  NgNativeViewBinder *binder = [[NgNativeViewBinder alloc]
      initWithAttach:^id(UIView *view, NSString *nativeID) {
        return [NSString stringWithFormat:@"%@ %lu", nativeID, (unsigned long)++made];
      }
      detach:^(UIView *view, id token){
      }];
  UIView *root = _root;
  binder.roots = ^NSArray<UIView *> * {
    return @[ root ];
  };
  XCTAssertNil([binder tokenFor:@"drop"], @"not bound");
  RCTViewComponentView *first = viewNamed(@"drop");
  [_root addSubview:first];
  [binder bind:@"drop"];
  [binder refresh];
  id taken = [binder tokenFor:@"drop"];
  XCTAssertEqualObjects(taken, @"drop 1");
  // A binding no longer valid answers nothing before the next refresh notices.
  first.nativeId = @"other";
  XCTAssertNil([binder tokenFor:@"drop"], @"renamed, not refreshed yet");
  first.nativeId = @"drop";
  [first removeFromSuperview];
  XCTAssertNil([binder tokenFor:@"drop"], @"unmounted, not refreshed yet");
  [_root addSubview:first];
  XCTAssertEqualObjects([binder tokenFor:@"drop"], taken, @"mounted again");
  // The view unmounts and another mounts under the same name, as a pending drop loads its files.
  [first removeFromSuperview];
  [binder refresh];
  XCTAssertNil([binder tokenFor:@"drop"], @"detached");
  [_root addSubview:viewNamed(@"drop")];
  [binder bind:@"drop"];
  [binder refresh];
  XCTAssertEqualObjects([binder tokenFor:@"drop"], @"drop 2");
  XCTAssertNotEqualObjects([binder tokenFor:@"drop"], taken);
  [binder unbind:@"drop"];
  XCTAssertNil([binder tokenFor:@"drop"], @"unbound");
}

- (void)testLooksLessOftenForAViewThatStaysMissing
{
  [_binder bind:@"gone"];
  NSTimeInterval first = _binder.searchInterval;
  [_binder refresh];
  [_binder refresh];
  XCTAssertEqual(_binder.searches, 1, @"rate limited");
  XCTAssertGreaterThan(_binder.searchInterval, first, @"a fruitless search waits longer for the next");
  [_binder bind:@"gone"];
  XCTAssertEqual(_binder.searchInterval, first, @"a bind looks again at once, and often");
  [_binder refresh];
  XCTAssertEqual(_binder.searches, 2);
}

- (void)testFindsTheTouchedViewsLongPress
{
  RCTViewComponentView *menu = viewNamed(@"card");
  RCTViewComponentView *handle = viewNamed(@"handle");
  UIView *plain = [UIView new];
  UIView *inner = [UIView new];
  [menu addSubview:handle];
  [handle addSubview:inner];
  [menu addSubview:plain];
  NSSet *takers = [NSSet setWithObject:@"handle"];
  XCTAssertTrue(NgNativeLongPressTaken(inner, menu, takers), @"inside a view that takes it");
  XCTAssertTrue(NgNativeLongPressTaken(handle, menu, takers));
  XCTAssertFalse(NgNativeLongPressTaken(plain, menu, takers));
  XCTAssertFalse(NgNativeLongPressTaken(menu, menu, [NSSet setWithObject:@"card"]), @"the menu's own view");
  XCTAssertFalse(NgNativeLongPressTaken(nil, menu, takers));
}

@end

#pragma mark - Menu building

@interface NgNativeMenuBuildingTests : XCTestCase
@end

@implementation NgNativeMenuBuildingTests

- (void)testMakesKeyCommandsForTheMenuBarAndActionsForAContextMenu
{
  NSArray *entries = @[
    @{@"id" : @"m0", @"label" : @"Add", @"shortcut" : @{@"key" : @"n", @"meta" : @YES}},
    @{@"separator" : @YES},
    @{@"id" : @"m1", @"label" : @"Copy", @"menuRole" : @"copy"},
    @{@"id" : @"m2", @"label" : @"Find", @"menuRole" : @"find", @"handled" : @YES},
  ];
  NSArray<UIMenuElement *> *bar = NgNativeMenuElements(entries, ^(NSString *itemId) {
  }, @selector(ngn_menuBarItem:));
  XCTAssertEqual(bar.count, 2u, @"two inline groups, and Copy left to UIKit");
  UIKeyCommand *add = (UIKeyCommand *)((UIMenu *)bar[0]).children[0];
  XCTAssertTrue([add isKindOfClass:[UIKeyCommand class]]);
  XCTAssertEqualObjects(add.input, @"n");
  XCTAssertEqual(add.modifierFlags, UIKeyModifierCommand);
  XCTAssertEqualObjects(add.propertyList, @"m0");
  NSArray<UIMenuElement *> *context = NgNativeMenuElements(entries, ^(NSString *itemId) {
  }, NULL);
  XCTAssertTrue([((UIMenu *)context[0]).children[0] isKindOfClass:[UIAction class]]);
}

- (void)testDropsTheKeysOfAMenuBarItemWhoseChordIsTaken
{
  // UIKit's own Find, and an app item before ours, have Cmd-F and Cmd-K.
  UIKeyCommand *uikitFind = [UIKeyCommand commandWithTitle:@"Find"
                                                     image:nil
                                                    action:@selector(find:)
                                                     input:@"f"
                                             modifierFlags:UIKeyModifierCommand
                                              propertyList:nil];
  UIMenu *root = [UIMenu menuWithTitle:@"" children:@[ [UIMenu menuWithTitle:@"Edit" children:@[ uikitFind ]] ]];
  NSMutableSet<NSString *> *taken = [NSMutableSet set];
  NgNativeCollectKeyChords(root, taken);
  NSArray *entries = @[
    @{@"id" : @"m0", @"label" : @"Search", @"menuRole" : @"find", @"handled" : @YES,
      @"shortcut" : @{@"key" : @"f", @"meta" : @YES}},
    @{@"id" : @"m1", @"label" : @"Palette", @"shortcut" : @{@"key" : @"k", @"meta" : @YES}},
    @{@"id" : @"m2", @"label" : @"Palette again", @"shortcut" : @{@"key" : @"k", @"meta" : @YES}},
    @{@"id" : @"m3", @"label" : @"Find more", @"shortcut" : @{@"key" : @"f", @"meta" : @YES, @"shift" : @YES}},
  ];
  NSArray<UIMenuElement *> *elements = NgNativeWithoutTakenKeys(
      NgNativeMenuElements(entries, ^(NSString *itemId) {
      }, @selector(ngn_menuBarItem:)),
      taken);
  XCTAssertEqual(elements.count, 4u);
  XCTAssertFalse([elements[0] isKindOfClass:[UIKeyCommand class]], @"UIKit has Cmd-F");
  XCTAssertEqualObjects(((UICommand *)elements[0]).propertyList, @"m0", @"still chosen by its id");
  XCTAssertEqual(((UICommand *)elements[0]).action, @selector(ngn_menuBarItem:));
  XCTAssertTrue([elements[1] isKindOfClass:[UIKeyCommand class]]);
  XCTAssertFalse([elements[2] isKindOfClass:[UIKeyCommand class]], @"the first item has Cmd-K");
  XCTAssertTrue([elements[3] isKindOfClass:[UIKeyCommand class]], @"Shift-Cmd-F is another chord");
}

- (void)testDropsTakenKeysInsideSubmenus
{
  NSMutableSet<NSString *> *taken = [NSMutableSet setWithObject:NgNativeKeyChord(@"z", UIKeyModifierCommand)];
  NSArray *entries = @[ @{
    @"id" : @"s",
    @"label" : @"More",
    @"items" : @[ @{@"id" : @"u", @"label" : @"Undo it", @"shortcut" : @{@"key" : @"z", @"meta" : @YES}} ],
  } ];
  NSArray<UIMenuElement *> *elements = NgNativeWithoutTakenKeys(
      NgNativeMenuElements(entries, ^(NSString *itemId) {
      }, @selector(ngn_menuBarItem:)),
      taken);
  UIMenuElement *inner = ((UIMenu *)elements[0]).children[0];
  XCTAssertFalse([inner isKindOfClass:[UIKeyCommand class]]);
  XCTAssertEqualObjects(((UICommand *)inner).propertyList, @"u");
}

@end

#pragma mark - The hooks

@interface NgNativeHookBase : NSObject
- (NSString *)said;
- (NSString *)inherited;
@end

@implementation NgNativeHookBase
- (NSString *)said
{
  return @"base said";
}
- (NSString *)inherited
{
  return @"base inherited";
}
@end

@interface NgNativeHookChild : NgNativeHookBase
@end

@implementation NgNativeHookChild
- (NSString *)said
{
  return @"child said";
}
@end

@interface NgNativeHooksTests : XCTestCase
@end

@implementation NgNativeHooksTests

- (void)testCallsWhatTheClassHadAndLeavesItsSuperclassAlone
{
  NgNativeHook([NgNativeHookChild class], @selector(said), "@@:", ^id(IMP previous) {
    return ^NSString *(id self) {
      return [@"hooked " stringByAppendingString:((NSString * (*)(id, SEL)) previous)(self, @selector(said))];
    };
  });
  NgNativeHook([NgNativeHookChild class], @selector(inherited), "@@:", ^id(IMP previous) {
    return ^NSString *(id self) {
      return [@"hooked " stringByAppendingString:((NSString * (*)(id, SEL)) previous)(self, @selector(inherited))];
    };
  });
  __block BOOL hadNone = NO;
  NgNativeHook([NgNativeHookChild class], @selector(description2), "@@:", ^id(IMP previous) {
    hadNone = previous == NULL;
    return ^NSString *(id self) {
      return @"added";
    };
  });
  NgNativeHookChild *child = [NgNativeHookChild new];
  XCTAssertEqualObjects(child.said, @"hooked child said");
  XCTAssertEqualObjects(child.inherited, @"hooked base inherited");
  XCTAssertEqualObjects([NgNativeHookBase new].inherited, @"base inherited", @"the superclass is untouched");
  XCTAssertEqualObjects([NgNativeHookBase new].said, @"base said");
  XCTAssertTrue(hadNone);
  XCTAssertEqualObjects([child performSelector:@selector(description2)], @"added");
}

- (void)testAnswersTheSharedUndoManagerOnlyForReactNativesViewsOrNoFirstResponder
{
  XCTAssertTrue(NgNativeAnswersSharedUndo(nil));
  XCTAssertTrue(NgNativeAnswersSharedUndo(viewNamed(@"row")));
  XCTAssertTrue(NgNativeAnswersSharedUndo([UIViewController new]), @"a screen's controller");
  XCTAssertFalse(NgNativeAnswersSharedUndo([UITextView new]), @"a text input keeps its own");
  XCTAssertFalse(NgNativeAnswersSharedUndo([UIView new]), @"another view, a canvas, keeps its window's");
}

@end

#pragma mark - Undo steps

@interface NgNativeUndoStepsTests : XCTestCase
@end

@implementation NgNativeUndoStepsTests

- (void)testTwoActionsInOnePassAreTwoSteps
{
  NSUndoManager *manager = NgNativeMakeUndoManager();
  NSMutableArray<NSString *> *undone = [NSMutableArray array];
  NSObject *target = [NSObject new];
  NgNativeRegisterUndoStep(manager, target, @"Add", ^(id) {
    [undone addObject:@"add"];
  });
  NgNativeRegisterUndoStep(manager, target, @"Rename", ^(id) {
    [undone addObject:@"rename"];
  });
  XCTAssertEqualObjects(manager.undoActionName, @"Rename");
  [manager undo];
  XCTAssertEqualObjects(undone, (@[ @"rename" ]));
  XCTAssertEqualObjects(manager.undoActionName, @"Add");
  [manager undo];
  XCTAssertEqualObjects(undone, (@[ @"rename", @"add" ]));
  XCTAssertFalse(manager.canUndo);
}

- (void)testAStepRegisteredWhileUndoingIsItsRedo
{
  NSUndoManager *manager = NgNativeMakeUndoManager();
  NSMutableArray<NSString *> *said = [NSMutableArray array];
  NSObject *target = [NSObject new];
  __block void (^step)(void);
  __weak __block void (^weakStep)(void);
  step = ^{
    NgNativeRegisterUndoStep(manager, target, @"Add", ^(id) {
      [said addObject:manager.isUndoing ? @"undo" : @"redo"];
      weakStep();
    });
  };
  weakStep = step;
  step();
  [manager undo];
  XCTAssertTrue(manager.canRedo);
  XCTAssertEqualObjects(manager.redoActionName, @"Add");
  [manager redo];
  XCTAssertEqualObjects(said, (@[ @"undo", @"redo" ]));
  XCTAssertTrue(manager.canUndo);
}

@end

#pragma mark - Dropped items

@interface NgNativeDropItemsTests : XCTestCase
@end

@implementation NgNativeDropItemsTests

- (void)testTakesAPlainTextFileAsAFileAndNotItsText
{
  NSItemProvider *provider = [NSItemProvider new];
  [provider registerFileRepresentationForTypeIdentifier:UTTypePlainText.identifier
                                            fileOptions:NSItemProviderFileOptionOpenInPlace
                                             visibility:NSItemProviderRepresentationVisibilityAll
                                            loadHandler:^NSProgress *(void (^done)(NSURL *, BOOL, NSError *)) {
                                              done(nil, NO, nil);
                                              return nil;
                                            }];
  provider.suggestedName = @"notes.txt";
  XCTAssertTrue([provider canLoadObjectOfClass:[NSString class]], @"it could load as text");
  XCTAssertEqual(NgNativeDropKindOf(provider), NgNativeDropKindFile);
  XCTAssertEqualObjects(NgNativeDropFileType(provider), UTTypePlainText.identifier);
}

- (void)testTakesAFileURLItemAsAFile
{
  NSURL *url = [[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByAppendingPathComponent:@"ngn-drop-test.txt"];
  [@"hello" writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:nil];
  @try {
    NSItemProvider *provider = [[NSItemProvider alloc] initWithContentsOfURL:url];
    XCTAssertEqual(NgNativeDropKindOf(provider), NgNativeDropKindFile);
    XCTAssertFalse([[UTType typeWithIdentifier:NgNativeDropFileType(provider)] conformsToType:UTTypeURL]);
  } @finally {
    [NSFileManager.defaultManager removeItemAtURL:url error:nil];
  }
}

- (void)testTakesASelectionAsTextAndALinkAsAURL
{
  XCTAssertEqual(NgNativeDropKindOf([[NSItemProvider alloc] initWithObject:@"hello"]), NgNativeDropKindText);
  NSURL *link = [NSURL URLWithString:@"https://ng-native.com"];
  XCTAssertEqual(NgNativeDropKindOf([[NSItemProvider alloc] initWithObject:link]), NgNativeDropKindWebURL);
  XCTAssertEqual(NgNativeDropKindOf([NSItemProvider new]), NgNativeDropKindNone);
}

- (void)testKeepsAFileNameInsideTheItemsFolder
{
  XCTAssertEqualObjects(NgNativeDropFileName(@"../../../Documents/x.txt", nil), @"x.txt");
  XCTAssertEqualObjects(NgNativeDropFileName(@"/etc/hosts", UTTypePlainText.identifier), @"hosts.txt");
  XCTAssertEqualObjects(NgNativeDropFileName(@"..", nil), @"file");
  XCTAssertEqualObjects(NgNativeDropFileName(@".", nil), @"file");
  XCTAssertEqualObjects(NgNativeDropFileName(@"", UTTypePNG.identifier), @"file.png");
  XCTAssertEqualObjects(NgNativeDropFileName(nil, nil), @"file");
  XCTAssertEqualObjects(NgNativeDropFileName(@"photo", UTTypeJPEG.identifier), @"photo.jpeg");
  XCTAssertEqualObjects(NgNativeDropFileName(@"a.pdf", UTTypePNG.identifier), @"a.pdf");
}

@end

#pragma mark - The split view's delegate

// UIKit does not change a split view controller's display mode outside an app, so these call the
// delegate in the order a device does.
@interface NgNativeSplitViewDelegateTests : XCTestCase
@end

@implementation NgNativeSplitViewDelegateTests {
  UISplitViewController *_controller;
  NgNativeSplitViewDelegate *_delegate;
  NSMutableArray<NSNumber *> *_reported;
}

- (void)setUp
{
  _controller = [[UISplitViewController alloc] initWithStyle:UISplitViewControllerStyleDoubleColumn];
  _controller.preferredDisplayMode = UISplitViewControllerDisplayModeOneBesideSecondary;
  if (@available(iOS 17, *)) {
    _controller.traitOverrides.horizontalSizeClass = UIUserInterfaceSizeClassRegular;
  }
  _delegate = [[NgNativeSplitViewDelegate alloc] initWithController:_controller];
  _reported = [NSMutableArray array];
  NSMutableArray<NSNumber *> *reported = _reported;
  _delegate.onCollapse = ^(BOOL collapsed) {
    [reported addObject:@(collapsed)];
  };
  [self layOutAtWidth:820];
}

- (void)layOutAtWidth:(CGFloat)width
{
  _controller.view.frame = CGRectMake(0, 0, width, 1000);
  [_delegate columnLaidOut];
}

// UIKit, laying out at `width`, changes the display mode first and the columns after.
- (void)changeTo:(UISplitViewControllerDisplayMode)mode atWidth:(CGFloat)width
{
  _controller.view.frame = CGRectMake(0, 0, width, 1000);
  [_delegate splitViewController:_controller willChangeToDisplayMode:mode];
  [_delegate columnLaidOut];
}

- (UISplitViewControllerDisplayMode)expand
{
  UISplitViewControllerDisplayMode mode =
      [_delegate splitViewController:_controller
          displayModeForExpandingToProposedDisplayMode:UISplitViewControllerDisplayModeAutomatic];
  [_delegate splitViewControllerDidExpand:_controller];
  return mode;
}

- (void)testANarrowerWidthHidingTheSidebarIsNotTheUsersChoice
{
  [self changeTo:UISplitViewControllerDisplayModeSecondaryOnly atWidth:375];
  XCTAssertEqualObjects(_reported, @[], @"the sidebar is not reported shut");
  XCTAssertEqual(_controller.preferredDisplayMode, UISplitViewControllerDisplayModeOneBesideSecondary);
  XCTAssertEqual([self expand], UISplitViewControllerDisplayModeOneBesideSecondary, @"expanding shows it again");
}

- (void)testTheUsersChoiceAtTheSameWidthIsKept
{
  [self changeTo:UISplitViewControllerDisplayModeSecondaryOnly atWidth:820];
  XCTAssertEqualObjects(_reported, @[ @YES ]);
  XCTAssertEqual(_controller.preferredDisplayMode, UISplitViewControllerDisplayModeSecondaryOnly);
  XCTAssertEqual([self expand], UISplitViewControllerDisplayModeSecondaryOnly, @"expanding keeps it shut");

  [self changeTo:UISplitViewControllerDisplayModeOneBesideSecondary atWidth:820];
  XCTAssertEqualObjects(_reported, (@[ @YES, @NO ]));
  XCTAssertEqual(_controller.preferredDisplayMode, UISplitViewControllerDisplayModeOneBesideSecondary);
}

- (void)testTheUsersChoiceAfterAResizeIsTheirs
{
  [self layOutAtWidth:1000];
  [self changeTo:UISplitViewControllerDisplayModeSecondaryOnly atWidth:1000];
  XCTAssertEqualObjects(_reported, @[ @YES ]);
}

- (void)testASizeClassChangeIsNotTheUsersChoice
{
  if (@available(iOS 17, *)) {
    [self changeTo:UISplitViewControllerDisplayModeSecondaryOnly atWidth:820];
    _controller.traitOverrides.horizontalSizeClass = UIUserInterfaceSizeClassCompact;
    [self changeTo:UISplitViewControllerDisplayModeOneBesideSecondary atWidth:820];
    XCTAssertEqualObjects(_reported, @[ @YES ], @"only the user's own choice is reported");
    XCTAssertEqual(_controller.preferredDisplayMode, UISplitViewControllerDisplayModeSecondaryOnly);
  }
}

- (void)testTheAppsCollapsedIsKeptAndNotReportedBack
{
  [_delegate setCollapsed:YES];
  XCTAssertEqual(_controller.preferredDisplayMode, UISplitViewControllerDisplayModeSecondaryOnly);
  [self changeTo:UISplitViewControllerDisplayModeSecondaryOnly atWidth:820];
  [self changeTo:UISplitViewControllerDisplayModeOneBesideSecondary atWidth:1000];
  XCTAssertEqualObjects(_reported, @[]);
  XCTAssertEqual(_controller.preferredDisplayMode, UISplitViewControllerDisplayModeSecondaryOnly);
  XCTAssertEqual([self expand], UISplitViewControllerDisplayModeSecondaryOnly);
}

@end

#pragma mark - Scene keys

@interface NgNativeSceneKeysTests : XCTestCase
@end

@implementation NgNativeSceneKeysTests

- (void)testKeepsTheKeyOfTheWindowEachSessionHad
{
  NSDictionary *kept = NgNativeKeepSession(nil, @"a", @"library");
  kept = NgNativeKeepSession(kept, @"b", nil);
  XCTAssertTrue(NgNativeSessionHadWindow(kept, @"a"));
  XCTAssertEqualObjects(NgNativeSessionKey(kept, @"a"), @"library");
  XCTAssertTrue(NgNativeSessionHadWindow(kept, @"b"), @"a window with no key");
  XCTAssertNil(NgNativeSessionKey(kept, @"b"));
  XCTAssertFalse(NgNativeSessionHadWindow(kept, @"c"), @"a scene the user made");
  XCTAssertNil(NgNativeSessionKey(kept, @"c"));
  XCTAssertFalse(NgNativeSessionHadWindow(nil, @"a"));
  kept = NgNativeKeepSession(kept, @"a", @"main");
  XCTAssertEqualObjects(NgNativeSessionKey(kept, @"a"), @"main", @"a session whose window changed");
  kept = NgNativeKeepSession(kept, @"a", nil);
  XCTAssertNil(NgNativeSessionKey(kept, @"a"), @"a window with no key leaves none behind");
  XCTAssertNil(NgNativeSessionKey(@{@"a" : @3}, @"a"));
  XCTAssertFalse(NgNativeSessionHadWindow(@{@"a" : @3}, @"a"), @"a value written outside the app");
}

- (void)testForgetsTheSessionsIPadOSNoLongerKeeps
{
  NSDictionary *kept = @{@"a" : @"main", @"b" : @"library", @"c" : @""};
  NSDictionary *open = NgNativeKeepOpenSessions(kept, [NSSet setWithObjects:@"a", @"c", @"d", nil]);
  XCTAssertEqualObjects(open, (@{@"a" : @"main", @"c" : @""}));
  XCTAssertEqualObjects(NgNativeKeepOpenSessions(kept, [NSSet set]), @{});
  XCTAssertEqualObjects(NgNativeKeepOpenSessions(nil, [NSSet setWithObject:@"a"]), @{});
}

- (void)testOpensAWindowInTheSceneKeptForItsKey
{
  NSArray *scenes = @[ @"library", NSNull.null, @"main" ];
  XCTAssertEqual(NgNativeSceneForKey(scenes, @"main"), 2u);
  XCTAssertEqual(NgNativeSceneForKey(scenes, @"library"), 0u);
  XCTAssertEqual(NgNativeSceneForKey(scenes, @"settings"), 1u, @"else the first scene kept for no key");
  XCTAssertEqual(NgNativeSceneForKey(scenes, nil), 1u);
  XCTAssertEqual(NgNativeSceneForKey((@[ NSNull.null, NSNull.null ]), @"main"), 0u);
}

- (void)testLeavesASceneKeptForAnotherKeyToThatKey
{
  XCTAssertEqual(NgNativeSceneForKey(@[ @"library" ], @"main"), (NSUInteger)NSNotFound);
  XCTAssertEqual(NgNativeSceneForKey(@[ @"library" ], nil), (NSUInteger)NSNotFound);
  XCTAssertEqual(NgNativeSceneForKey(@[], @"main"), (NSUInteger)NSNotFound);
}

- (void)testFindsTheHiddenSessionOfAWindowOnlyByItsKey
{
  NSDictionary *kept = @{@"b" : @"", @"c" : @"main"};
  NSArray *sessions = @[ @"a", @"b", @"c" ];
  XCTAssertEqual(NgNativeSessionForKey(kept, sessions, @"main"), 2u);
  XCTAssertEqual(NgNativeSessionForKey(kept, sessions, @"library"), (NSUInteger)NSNotFound);
  XCTAssertEqual(NgNativeSessionForKey(kept, sessions, nil), (NSUInteger)NSNotFound, @"not a session kept for no key");
  XCTAssertEqual(NgNativeSessionForKey(kept, @[ @"a", @"b" ], @"main"), (NSUInteger)NSNotFound, @"only among those given");
}

@end
