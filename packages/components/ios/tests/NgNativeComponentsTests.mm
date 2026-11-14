// Unit tests for the iOS code of @ng-native/components that runs without React Native: the view
// binder, the menu building (the iPad menu bar's duplicate keys among it), the long press a view
// inside a context menu takes, and the responder hooks' call-through and undo routing. Run by
// `run-tests.sh` on a simulator, through XCTest's own runner.
#import <React/RCTViewComponentView.h>
#import <XCTest/XCTest.h>
#import <objc/runtime.h>

#import "../NgNativeMenuBuilding.h"
#import "../NgNativeResponderHooks.h"
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
