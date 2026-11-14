#import "undo.h"

#import <objc/runtime.h>

namespace ngn::appkit {

namespace {

NSUndoManager *shared() {
  static NSUndoManager *manager = [] {
    NSUndoManager *m = [NSUndoManager new];
    // Each of the app's actions is a group of its own, whenever it is registered.
    m.groupsByEvent = NO;
    return m;
  }();
  return manager;
}

void onMain(dispatch_block_t block) {
  if (NSThread.isMainThread) {
    block();
  } else {
    dispatch_async(dispatch_get_main_queue(), block);
  }
}

class AppKitUndoManager final : public UndoManager {
 public:
  void registerAction(const std::string &label, std::function<void()> action) override {
    NSString *name = [NSString stringWithUTF8String:label.c_str()];
    // Inline on the main thread: an undo registers its redo while it runs.
    onMain(^{
      NSUndoManager *m = shared();
      bool own = !m.isUndoing && !m.isRedoing;
      if (own) {
        [m beginUndoGrouping];
      }
      [m registerUndoWithTarget:m
                        handler:^(id) {
                          action();
                        }];
      [m setActionName:name];
      if (own) {
        [m endUndoGrouping];
      }
    });
  }
  bool undoing() const override {
    return shared().isUndoing;
  }
  void undo() override {
    onMain(^{
      if (shared().canUndo) {
        [shared() undo];
      }
    });
  }
  void redo() override {
    onMain(^{
      if (shared().canRedo) {
        [shared() redo];
      }
    });
  }
  void clear() override {
    onMain(^{
      [shared() removeAllActions];
    });
  }
};

const void *const kTextUndoKey = &kTextUndoKey;

} // namespace

std::shared_ptr<UndoManager> makeUndoManager() {
  return std::make_shared<AppKitUndoManager>();
}

NSUndoManager *undoManagerFor(NSWindow *window) {
  // The field editor (an NSTextView), or a text field about to hand over to it: the field
  // editor asks once as editing starts and keeps what it got.
  NSResponder *focus = window.firstResponder;
  if ([focus isKindOfClass:NSText.class] || [focus isKindOfClass:NSTextField.class]) {
    NSUndoManager *text = objc_getAssociatedObject(window, kTextUndoKey);
    if (text == nil) {
      text = [NSUndoManager new];
      objc_setAssociatedObject(window, kTextUndoKey, text, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    return text;
  }
  return shared();
}

} // namespace ngn::appkit

@implementation NGNUndoWindowDelegate
+ (instancetype)shared {
  static NGNUndoWindowDelegate *delegate = [NGNUndoWindowDelegate new];
  return delegate;
}
- (NSUndoManager *)windowWillReturnUndoManager:(NSWindow *)window {
  return ngn::appkit::undoManagerFor(window);
}
@end
