import SwiftUI
import UIKit

/**
 Draws a segmented picker's segments in a font. SwiftUI draws them as a `UISegmentedControl`, and
 `font` does not reach it, so this finds the control and sets its title font. `ui-picker` sends it
 beside each `font` modifier of a segmented picker, with the same `family`, `size` and `weight`.
 */
struct SegmentedFont: ViewModifier {
  let font: UIFont

  init(params: [String: Any]) {
    let size = (params["size"] as? Double).map { CGFloat($0) } ?? UIFont.systemFontSize
    let weight = Self.weight(params["weight"] as? String)
    guard let family = params["family"] as? String else {
      font = .systemFont(ofSize: size, weight: weight ?? .regular)
      return
    }
    // A face's name or a family's, as `font` takes it, then the weight within that family.
    let named = UIFont(name: family, size: size)
    guard let weight else {
      font = named ?? UIFont(descriptor: UIFontDescriptor(fontAttributes: [.family: family]), size: size)
      return
    }
    let descriptor = UIFontDescriptor(fontAttributes: [
      .family: named?.familyName ?? family,
      .traits: [UIFontDescriptor.TraitKey.weight: weight],
    ])
    font = UIFont(descriptor: descriptor, size: size)
  }

  func body(content: Content) -> some View {
    content.background(SegmentedFontSetter(font: font))
  }

  /// `@expo/ui`'s font weights, as UIKit's.
  private static func weight(_ name: String?) -> UIFont.Weight? {
    switch name {
    case "regular": return .regular
    case "ultraLight": return .ultraLight
    case "thin": return .thin
    case "light": return .light
    case "medium": return .medium
    case "semibold": return .semibold
    case "bold": return .bold
    case "heavy": return .heavy
    case "black": return .black
    default: return nil
    }
  }
}

/// A view beside the picker that finds its control, and gives it the system font back when it goes.
private struct SegmentedFontSetter: UIViewRepresentable {
  let font: UIFont

  func makeUIView(context: Context) -> SegmentedFontView { SegmentedFontView() }

  func updateUIView(_ view: SegmentedFontView, context: Context) {
    view.font = font
  }

  static func dismantleUIView(_ view: SegmentedFontView, coordinator: ()) {
    view.font = nil
  }
}

private final class SegmentedFontView: UIView {
  private weak var control: UISegmentedControl?

  var font: UIFont? {
    didSet { font == nil ? apply(to: control) : applyOnceLaidOut() }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { applyOnceLaidOut() }
  }

  /// SwiftUI adds the control beside this view in the same pass, so it is looked for after it.
  private func applyOnceLaidOut() {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.font != nil, self.window != nil else { return }
      if self.control?.window == nil { self.control = self.nearestControl() }
      self.apply(to: self.control)
    }
  }

  private func apply(to control: UISegmentedControl?) {
    let attributes: [NSAttributedString.Key: Any]? = font.map { [.font: $0] }
    control?.setTitleTextAttributes(attributes, for: .normal)
    control?.setTitleTextAttributes(attributes, for: .selected)
  }

  // ponytail: the first control under the nearest ancestor that has one. The picker and this view
  // share a parent, so that is the picker's own; walk SwiftUI's tree if two ever share one.
  private func nearestControl() -> UISegmentedControl? {
    var above = superview
    while let view = above {
      if let found = Self.firstControl(in: view) { return found }
      above = view.superview
    }
    return nil
  }

  private static func firstControl(in view: UIView) -> UISegmentedControl? {
    if let control = view as? UISegmentedControl { return control }
    for subview in view.subviews {
      if let control = firstControl(in: subview) { return control }
    }
    return nil
  }
}
