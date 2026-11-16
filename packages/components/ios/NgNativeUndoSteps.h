// The undo manager behind `UndoStack` on iOS and how an action goes on it, apart from the module so
// the unit tests reach them without React Native.
#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// An undo manager on which each of the app's actions is an undo step of its own, whenever it is
// registered: two in one pass of the run loop are still two steps.
NSUndoManager *NgNativeMakeUndoManager(void);

// Register `handler` as one step named `label`. One registered while undoing or redoing goes into
// the group NSUndoManager has open for that, on the other stack.
void NgNativeRegisterUndoStep(NSUndoManager *manager, id target, NSString *label, void (^handler)(id target));

NS_ASSUME_NONNULL_END
