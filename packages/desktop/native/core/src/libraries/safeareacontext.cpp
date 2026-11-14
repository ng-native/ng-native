// The core's writing of react-native-safe-area-context's state, compiled into the host only with
// the library (cmake/libraries.cmake).
#include "ngn/library-glue.h"

#include <react/renderer/components/safeareacontext/RNCSafeAreaViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace ngn {

void installGlue_safeareacontext() {
  libraryGlue().safeAreaStates.emplace_back([](const State &state, EdgeInsets insets) {
    const auto *concrete = dynamic_cast<const ConcreteState<RNCSafeAreaViewState> *>(&state);
    if (concrete == nullptr) {
      return false;
    }
    RNCSafeAreaViewState data;
    data.insets = insets;
    concrete->updateState(std::move(data));
    return true;
  });
}

} // namespace ngn
