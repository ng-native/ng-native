import ExpoModulesCore
import UIKit

/**
 The size of an SF Symbol's image at a point size, weight and scale, which `<expo-symbol>` lays its
 view out at. SwiftUI lays an `Image(systemName:)` out at this size, while `expo-symbols` builds the
 symbol at the system font size and fits it into the view, so the view's size is what sets how
 large the symbol draws.
 */
public final class SymbolImageSizeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeSymbol")

    Function("imageSize") { (name: String, pointSize: Double, weight: String?, scale: String?) -> [Double]? in
      let configuration = UIImage.SymbolConfiguration(
        pointSize: CGFloat(pointSize),
        weight: Self.weight(weight),
        scale: Self.scale(scale)
      )
      guard let image = UIImage(systemName: name, withConfiguration: configuration) else {
        return nil
      }
      return [Double(image.size.width), Double(image.size.height)]
    }
  }

  /// `expo-symbols`' weights, as UIKit's.
  private static func weight(_ name: String?) -> UIImage.SymbolWeight {
    switch name {
    case "ultraLight": return .ultraLight
    case "thin": return .thin
    case "light": return .light
    case "regular": return .regular
    case "medium": return .medium
    case "semibold": return .semibold
    case "bold": return .bold
    case "heavy": return .heavy
    case "black": return .black
    default: return .unspecified
    }
  }

  /// `expo-symbols`' scales, as UIKit's.
  private static func scale(_ name: String?) -> UIImage.SymbolScale {
    switch name {
    case "small": return .small
    case "medium": return .medium
    case "large": return .large
    case "unspecified": return .unspecified
    default: return .default
    }
  }
}
