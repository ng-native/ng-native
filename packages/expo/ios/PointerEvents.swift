import ExpoModulesCore
import React

/**
 Turns on React Native's W3C pointer events where the app's config plugin asked for them.

 `RCTSurfaceTouchHandler` reads the flag once, as it is made, so it is set while the app finishes
 launching, before React Native starts.
 */
public final class PointerEventsObserver: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if Bundle.main.object(forInfoDictionaryKey: "NgNativePointerEvents") as? Bool == true {
      RCTSetDispatchW3CPointerEvents(true)
    }
    return true
  }
}
