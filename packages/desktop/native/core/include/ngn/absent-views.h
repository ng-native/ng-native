// The views a desktop host has no counterpart for, by Fabric name, each with the reason. The view
// registry (MountingManager::hasComponent, which JavaScript reads as
// `__nativeComponentRegistry__hasComponent`) answers false for each, so the element reports itself
// absent, and one committed anyway mounts as a plain view (UnimplementedNativeView) whose children
// still show. A library compiled into the host that declares one (react-native-keyboard-controller)
// has it left out of the registry. The community views `slider` and `picker` are
// here too: their libraries ship no macOS code, and `@expo/ui`'s SwiftUI slider and picker are
// the macOS ones.
#pragma once

#include <optional>
#include <string_view>
#include <vector>

namespace ngn {

struct AbsentView {
  std::string_view name;
  std::string_view reason;
};

const std::vector<AbsentView> &absentViews();

// Why the view `name` is absent here, or nothing for a view that is not.
std::optional<std::string_view> absentReason(std::string_view name);

} // namespace ngn
