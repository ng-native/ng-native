import ExpoModulesCore
import FirebaseCore
import FirebaseInstallations
import FirebaseMessaging

/**
 * The app's Firebase Installation ID (FID), and its registration with FCM, so a backend can send
 * to it through FCM's HTTP v1 API with the message's `fid` target.
 *
 * FCM delivers over APNs on iOS, so `register` takes the APNs token `expo-notifications` reported,
 * as the lowercase hex it hands JavaScript. Firebase's app delegate proxy is off (the config
 * plugin turns it off, since `expo-notifications` owns those methods), so this is the only way the
 * token reaches FCM.
 */
public class FirebaseMessagingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NgNativeFirebaseMessaging")

    AsyncFunction("getInstallationId") { () async throws -> String in
      try await Self.configure()
      return try await Installations.installations().installationID()
    }

    AsyncFunction("register") { (apnsToken: String?) async throws in
      try await Self.configure()
      guard let apnsToken, let token = Self.data(hex: apnsToken) else {
        throw Exception(
          name: "ERR_APNS_TOKEN",
          description: "FCM needs the APNs token on iOS, and none was given.")
      }
      await MainActor.run { Messaging.messaging().apnsToken = token }
      try await Messaging.messaging().register()
    }

    AsyncFunction("unregister") { () async throws in
      try await Self.configure()
      try await Installations.installations().delete()
    }
  }

  /** Configures Firebase on first use unless the app has; without the plist, configure() aborts. */
  @MainActor
  private static func configure() throws {
    if FirebaseApp.app() != nil { return }
    guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
      throw Exception(
        name: "ERR_NO_FIREBASE_CONFIG",
        description: "GoogleService-Info.plist is not in the app. "
          + "Set ios.googleServicesFile in app.json and rebuild.")
    }
    FirebaseApp.configure()
  }

  private static func data(hex: String) -> Data? {
    let bytes = Array(hex.utf8)
    guard bytes.count % 2 == 0 else { return nil }
    var data = Data(capacity: bytes.count / 2)
    for index in stride(from: 0, to: bytes.count, by: 2) {
      let pair = String(decoding: bytes[index..<index + 2], as: UTF8.self)
      guard let byte = UInt8(pair, radix: 16) else { return nil }
      data.append(byte)
    }
    return data
  }
}
