import ExpoModulesCore

/**
 The taps on a Live Activity's buttons made before any JavaScript was listening.

 `expo-widgets` runs a button's tap in the app, starting it in the background when it has to, and
 posts it as a notification that nothing keeps. The tap that starts the app is posted before the
 app's JavaScript has loaded, so this holds what is posted from launch until JavaScript takes it.
 */
final class HeldTaps {
  static let shared = HeldTaps()

  private let lock = NSLock()
  private var taps: [[String: Any]] = []
  private var observer: NSObjectProtocol?

  /// Holds each tap `expo-widgets` posts from now on.
  func start() {
    lock.lock()
    defer { lock.unlock() }
    guard observer == nil else { return }
    observer = NotificationCenter.default.addObserver(
      forName: Notification.Name("onExpoWidgetsUserInteraction"),
      object: nil,
      queue: nil
    ) { [weak self] notification in
      guard let self, let tap = notification.userInfo?["eventData"] as? [String: Any] else { return }
      self.lock.lock()
      defer { self.lock.unlock() }
      if self.observer != nil { self.taps.append(tap) }
    }
  }

  /**
   The held taps from `sources`, which are then held no longer. JavaScript listens to
   `expo-widgets` itself before it asks, so the first call also stops holding new ones.
   */
  func take(sources: [String]) -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    if let observer {
      NotificationCenter.default.removeObserver(observer)
      self.observer = nil
    }
    let from = { (tap: [String: Any]) in sources.contains(tap["source"] as? String ?? "") }
    let taken = taps.filter(from)
    taps.removeAll(where: from)
    return taken
  }
}

public final class LiveActivityTapsObserver: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    HeldTaps.shared.start()
    return true
  }
}

public final class LiveActivityTapsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeLiveActivityTaps")

    Function("takeTaps") { (sources: [String]) -> [[String: Any]] in
      HeldTaps.shared.take(sources: sources)
    }
  }
}
