#import "NgNativeUndoSteps.h"

NSUndoManager *NgNativeMakeUndoManager(void)
{
  NSUndoManager *manager = [NSUndoManager new];
  // Each of the app's actions is a group of its own, whenever it is registered.
  manager.groupsByEvent = NO;
  return manager;
}

void NgNativeRegisterUndoStep(NSUndoManager *manager, id target, NSString *label, void (^handler)(id target))
{
  BOOL own = !manager.isUndoing && !manager.isRedoing;
  if (own) {
    [manager beginUndoGrouping];
  }
  [manager registerUndoWithTarget:target handler:handler];
  [manager setActionName:label];
  if (own) {
    [manager endUndoGrouping];
  }
}
