import ExpoModulesCore
#if canImport(ExpoUI)
import ExpoUI
#endif

/**
 The SwiftUI modifiers `@ng-native/expo` adds to `@expo/ui`'s, registered as it loads. A build
 without `@expo/ui` has no modifiers to add to, and this does nothing.
 */
public final class ExpoUIModifiersModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeExpoUIModifiers")

    OnCreate {
      #if canImport(ExpoUI)
      ViewModifierRegistry.register("ngNativeInlineNavigationTitle") { _, _, _ in
        InlineNavigationTitle()
      }
      ViewModifierRegistry.register("ngNativeSegmentedFont") { params, _, _ in
        SegmentedFont(params: params)
      }
      #endif
    }
  }
}
