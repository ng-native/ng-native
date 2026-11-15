// The app's undo stack on the desktop: `NgNativeUndo` for `UndoStack` in @ng-native/device
// (packages/integration-tests/undo-stack.test.ts).
//
// - `register(id, label)` registers an action with the toolkit's undo manager (NSUndoManager),
//   named `label`, so Edit > Undo reads "Undo <label>". One manager serves every window; a focused
//   text input keeps its own history (the backend gives it another manager).
// - Undoing it sends `{ type: 'undo', id }` on `ngNativeUndo` and registers its redo under the same
//   id; redoing sends `{ type: 'redo', id }` and registers the undo again.
// - `undo()`, `redo()` and `clear()` do what Edit > Undo, Edit > Redo and clearing do.
// - A reload clears the history: the reloaded app knows none of the old ids.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn {

// The toolkit's undo manager, with NSUndoManager's rules: an action registered while undoing goes
// on the redo stack, one registered while redoing on the undo stack, and one registered otherwise
// clears the redo stack.
class UndoManager {
 public:
  virtual ~UndoManager() = default;
  virtual void registerAction(const std::string &label, std::function<void()> action) = 0;
  // Whether the manager is undoing now, as an action it runs asks.
  virtual bool undoing() const = 0;
  virtual void undo() = 0;
  virtual void redo() = 0;
  virtual void clear() = 0;
};

std::shared_ptr<NativeModule> makeUndoModule(std::shared_ptr<UndoManager> manager);

} // namespace ngn
