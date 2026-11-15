#include "ngn/absent-views.h"

namespace ngn {

const std::vector<AbsentView> &absentViews() {
  static constexpr std::string_view kNoPull = "a Mac has no pull to refresh: a scroll view stops at its top";
  static constexpr std::string_view kNoKeyboard = "a Mac has no software keyboard to follow or sit on";
  static const std::vector<AbsentView> views{
      // `<refresh-control>`: iOS's and Android's.
      {"PullToRefreshView", kNoPull},
      {"AndroidSwipeRefreshLayout", kNoPull},
      // `<input-accessory-view>`.
      {"InputAccessoryView", kNoKeyboard},
      // `<keyboard-dock>`, `<keyboard-avoiding-view>`'s helpers and the rest of
      // react-native-keyboard-controller's views.
      {"KeyboardControllerView", kNoKeyboard},
      {"KeyboardGestureArea", kNoKeyboard},
      {"KeyboardExtender", kNoKeyboard},
      {"KeyboardBackgroundView", kNoKeyboard},
      {"KeyboardToolbarGroupView", kNoKeyboard},
      {"OverKeyboardView", kNoKeyboard},
      {"ClippingScrollViewDecoratorView", kNoKeyboard},
      // Community views whose libraries ship no macOS code, and no host view stands in for.
      {"RNCSlider", "@react-native-community/slider has no macOS view: ui-slider (@expo/ui) is a SwiftUI slider"},
      {"RNCPicker", "@react-native-picker/picker has no macOS view: ui-picker (@expo/ui) is a SwiftUI picker"},
      {"RNCPickerItem", "@react-native-picker/picker has no macOS view: ui-picker (@expo/ui) is a SwiftUI picker"},
      {"RNCMaskedView", "@react-native-masked-view/masked-view has no macOS view: the content shows unmasked"},
  };
  return views;
}

std::optional<std::string_view> absentReason(std::string_view name) {
  for (const auto &view : absentViews()) {
    if (view.name == name) {
      return view.reason;
    }
  }
  return std::nullopt;
}

} // namespace ngn
