// AccessibilityInfo's iOS module, AccessibilityManager: the system's accessibility settings, kept
// in the host state by the backend, and an event under iOS's name for each one that changes.
#include "ngn/core-modules.h"

namespace ngn {

namespace {

struct Setting {
  // The getter AccessibilityInfo calls, and the device event iOS sends when it changes.
  const char *method;
  const char *event;
  bool AccessibilitySettings::*field;
};

constexpr Setting kSettings[] = {
    {"getCurrentVoiceOverState", "screenReaderChanged", &AccessibilitySettings::screenReader},
    {"getCurrentReduceMotionState", "reduceMotionChanged", &AccessibilitySettings::reduceMotion},
    {"getCurrentReduceTransparencyState", "reduceTransparencyChanged", &AccessibilitySettings::reduceTransparency},
    {"getCurrentInvertColorsState", "invertColorsChanged", &AccessibilitySettings::invertColors},
    {"getCurrentBoldTextState", "boldTextChanged", &AccessibilitySettings::boldText},
    {"getCurrentDarkerSystemColorsState", "darkerSystemColorsChanged", &AccessibilitySettings::increaseContrast},
    {"getCurrentGrayscaleState", "grayscaleChanged", &AccessibilitySettings::grayscale},
};

} // namespace

std::shared_ptr<NativeModule> makeAccessibilityManager(const CoreModuleServices &s) {
  struct AccessibilityManager : NativeModule {
    explicit AccessibilityManager(const CoreModuleServices &s) : NativeModule("AccessibilityManager") {
      auto state = s.state;
      for (const auto &setting : kSettings) {
        auto field = setting.field;
        async(setting.method, [state, field](const folly::dynamic &, std::vector<JsCallback> callbacks) {
          if (!callbacks.empty()) {
            callbacks[0](folly::dynamic::array(state->accessibility.get().*field));
          }
        });
      }
      // An iOS setting with no desktop counterpart.
      async("getCurrentPrefersCrossFadeTransitionsState", [](const folly::dynamic &, std::vector<JsCallback> callbacks) {
        if (!callbacks.empty()) {
          callbacks[0](folly::dynamic::array(false));
        }
      });
      // Dynamic Type's multipliers: nothing resizes a desktop app's text.
      async("setAccessibilityContentSizeMultipliers", [](const folly::dynamic &, std::vector<JsCallback>) {});
      auto system = s.system;
      // iOS's announcement interrupts what VoiceOver is saying unless it asks to queue; a priority
      // the call names wins.
      auto announce = [system](const folly::dynamic &args) {
        std::string text = args.size() > 0 && args[0].isString() ? args[0].asString() : "";
        if (text.empty()) {
          return;
        }
        auto priority = AnnouncementPriority::High;
        if (args.size() > 1 && args[1].isObject()) {
          const auto &options = args[1];
          if (auto queue = options.get_ptr("queue"); queue && queue->isBool() && queue->asBool()) {
            priority = AnnouncementPriority::Medium;
          }
          if (auto named = options.get_ptr("priority"); named && named->isString()) {
            priority = named->asString() == "low"  ? AnnouncementPriority::Low
                : named->asString() == "high"      ? AnnouncementPriority::High
                                                   : priority;
          }
        }
        system->announce({text, priority});
      };
      async("announceForAccessibility", [announce](const folly::dynamic &args, std::vector<JsCallback>) { announce(args); });
      async("announceForAccessibilityWithOptions",
          [announce](const folly::dynamic &args, std::vector<JsCallback>) { announce(args); });
      auto focus = s.focusAccessibility;
      async("setAccessibilityFocus", [focus](const folly::dynamic &args, std::vector<JsCallback>) {
        if (focus && args.size() > 0 && args[0].isNumber()) {
          focus(static_cast<int>(args[0].asDouble()));
        }
      });
      listeners();
      last_ = state->accessibility.get();
      subscription_ = state->accessibility.listen([this](const AccessibilitySettings &now) {
        auto before = last_;
        last_ = now;
        for (const auto &setting : kSettings) {
          if (before.*setting.field != now.*setting.field) {
            emit(setting.event, now.*setting.field);
          }
        }
      });
    }

    // Only the listener reads and writes it, and the state calls its listeners one at a time.
    AccessibilitySettings last_;
    std::shared_ptr<void> subscription_;
  };
  return std::make_shared<AccessibilityManager>(s);
}

} // namespace ngn
