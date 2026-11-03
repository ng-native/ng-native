import ExpoModulesCore
import UIKit

/**
 Lays a stack's hidden navigation bar out once with large titles, for `<native-header largeTitle>`
 in `@ng-native/router`, which asks before it commits a page with one.

 react-native-screens turns on `prefersLargeTitles` only as it shows the bar for a screen with a
 large title, and for a page pushed onto a stack whose bar is hidden, under a root page with no
 header, that is after the push has started. A bar never laid out with a large title then animates
 in from its compact layout: the inline title fades out and the large title drops into place.
 Laid out once with a large title beforehand, out of sight, the push starts from the
 height it ends at.
 */
public final class LargeTitleBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeStackBar")

    // Before the commit's mount, which is queued on the main thread after this.
    AsyncFunction("prepareLargeTitle") { (stack: Int) in
      guard let view = self.appContext?.findView(withTag: stack, ofType: UIView.self),
        let navigation = Self.navigationController(of: view)
      else { return }
      Self.prepare(navigation)
    }.runOnQueue(.main)
  }

  /// `RNSScreenStack` holds its navigation controller's view as a subview.
  private static func navigationController(of stack: UIView) -> UINavigationController? {
    stack.subviews.lazy.compactMap { $0.next as? UINavigationController }.first
  }

  /// A bar that is shown, or has had large titles turned on, has been laid out with them already.
  private static func prepare(_ navigation: UINavigationController) {
    guard navigation.isNavigationBarHidden, !navigation.navigationBar.prefersLargeTitles else {
      return
    }
    UIView.performWithoutAnimation {
      navigation.navigationBar.prefersLargeTitles = true
      navigation.setNavigationBarHidden(false, animated: false)
      navigation.view.layoutIfNeeded()
      navigation.setNavigationBarHidden(true, animated: false)
      navigation.view.layoutIfNeeded()
    }
  }
}
