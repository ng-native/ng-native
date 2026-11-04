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

 It also keeps a header item from laying the bar out while a push or pop runs: see
 `deferredHeaderLayout`.
 */
public final class LargeTitleBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeStackBar")

    OnCreate {
      _ = Self.deferredHeaderLayout
    }

    // Before the commit's mount, which is queued on the main thread after this.
    AsyncFunction("prepareLargeTitle") { (stack: Int) in
      guard let view = self.appContext?.findView(withTag: stack, ofType: UIView.self),
        let navigation = Self.navigationController(of: view)
      else { return }
      Self.prepare(navigation)
    }.runOnQueue(.main)
  }

  /**
   react-native-screens lays the stack's bar out at once, with `layoutIfNeeded`, whenever a header
   item's layout changes (`-[RNSScreenStackHeaderSubview layoutNavigationBar]`). A `matchContents`
   `ui-host` in an item has a size only once SwiftUI has laid it out in the window, which is during
   the push, and the bar laid out then starts a large title above its place, to drop into it. While
   a transition runs, the layout waits for it to end, once per item, and runs then. Replaced once
   per process; a react-native-screens without the method is left as it is.
   */
  private static let deferredHeaderLayout: Void = {
    let selector = NSSelectorFromString("layoutNavigationBar")
    guard let itemClass = NSClassFromString("RNSScreenStackHeaderSubview"),
      let method = class_getInstanceMethod(itemClass, selector)
    else { return }
    typealias Layout = @convention(c) (UIView, Selector) -> Void
    let layout = unsafeBitCast(method_getImplementation(method), to: Layout.self)
    let waiting = NSHashTable<UIView>.weakObjects()
    let deferred: @convention(block) (UIView) -> Void = { item in
      guard let coordinator = navigationController(containing: item)?.transitionCoordinator else {
        layout(item, selector)
        return
      }
      if waiting.contains(item) { return }
      waiting.add(item)
      let queued = coordinator.animate(alongsideTransition: nil) { [weak item] _ in
        guard let item else { return }
        waiting.remove(item)
        layout(item, selector)
      }
      if !queued {
        waiting.remove(item)
        layout(item, selector)
      }
    }
    method_setImplementation(method, imp_implementationWithBlock(deferred))
  }()

  /// A header item is in its stack's bar, whose superview is the navigation controller's view.
  private static func navigationController(containing item: UIView) -> UINavigationController? {
    sequence(first: item as UIResponder) { $0.next }.lazy
      .compactMap { $0 as? UINavigationController }.first
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
