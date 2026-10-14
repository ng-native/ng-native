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
