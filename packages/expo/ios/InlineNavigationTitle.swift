import ExpoModulesCore
#if canImport(ExpoUI)
import ExpoUI
import SwiftUI

/**
 Shows a navigation stack's title inline in its bar. `ui-bottom-sheet` puts it on the toolbar of a
 sheet that has one: a navigation stack's root shows a large title by default, and SwiftUI leaves
 room for one under the bar even with no title to show.
 */
struct InlineNavigationTitle: ViewModifier {
  func body(content: Content) -> some View {
    content.navigationBarTitleDisplayMode(.inline)
  }
}
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
      #endif
    }
  }
}
