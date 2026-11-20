import ExpoModulesCore
import UIKit

/// `NgNativeScreenshot`: the app's window as a PNG, for `toMatchScreenshot()` in a device test.
///
/// The window is drawn whole, with `drawHierarchy`, into an image the size of the region asked for:
/// drawing a single view's hierarchy leaves out Fabric's text, while the window draws it as the
/// screen shows it. Standard range keeps the colours sRGB, as a simulator's own screenshot is.
public class NgNativeScreenshotModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeScreenshot")

    AsyncFunction("capture") { (region: [String: Double]?) throws -> String in
      let window = try appWindow()
      let rect = region.map {
        CGRect(x: $0["x"] ?? 0, y: $0["y"] ?? 0, width: $0["width"] ?? 0, height: $0["height"] ?? 0)
      } ?? window.bounds
      return try capture(window, rect)
    }.runOnQueue(.main)

    AsyncFunction("captureView") { (tag: Int) throws -> String in
      guard let view = appContext?.findView(withTag: tag, ofType: UIView.self), let window = view.window
      else {
        throw ScreenshotException("No view with tag \(tag) is in a window")
      }
      return try capture(window, view.convert(view.bounds, to: window))
    }.runOnQueue(.main)
  }
}

/// The app's own window: the key one, or the first of the foreground scene's.
private func appWindow() throws -> UIWindow {
  let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
  let windows = scenes.flatMap(\.windows)
  guard let window = windows.first(where: \.isKeyWindow) ?? windows.first else {
    throw ScreenshotException("The app has no window to capture")
  }
  return window
}

private func capture(_ window: UIWindow, _ region: CGRect) throws -> String {
  let rect = region.intersection(window.bounds)
  guard !rect.isEmpty else {
    throw ScreenshotException("The region \(region) is outside the window")
  }
  let format = UIGraphicsImageRendererFormat.default()
  format.preferredRange = .standard
  let image = UIGraphicsImageRenderer(bounds: rect, format: format).image { _ in
    // After pending updates, so the last commit is in the picture.
    window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
  }
  guard let data = image.pngData() else {
    throw ScreenshotException("The capture could not be encoded as a PNG")
  }
  return data.base64EncodedString()
}

private final class ScreenshotException: GenericException<String> {
  override var reason: String { param }
}
