package dev.ngnative.firebasemessaging

import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app's Firebase Installation ID (FID), and its registration with FCM, so a backend can send
 * to it through FCM's HTTP v1 API with the message's `fid` target. Android has no APNs token, so
 * `register` ignores its argument.
 */
class FirebaseMessagingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NgNativeFirebaseMessaging")

    AsyncFunction("getInstallationId") { promise: Promise ->
      settle(promise) { FirebaseInstallations.getInstance().id }
    }

    AsyncFunction("register") { _: String?, promise: Promise ->
      settle(promise) { FirebaseMessaging.getInstance().register() }
    }

    AsyncFunction("unregister") { promise: Promise ->
      settle(promise) { FirebaseInstallations.getInstance().delete() }
    }
  }

  /**
   * Without google-services.json the default FirebaseApp is never initialized, and getInstance()
   * throws; reject with the code iOS uses instead.
   */
  private fun <T> settle(promise: Promise, task: () -> Task<T>) {
    val context = appContext.reactContext
    if (context == null || FirebaseApp.getApps(context).isEmpty()) {
      promise.reject(
        "ERR_NO_FIREBASE_CONFIG",
        "google-services.json is not in the app. Set android.googleServicesFile in app.json and rebuild.",
        null,
      )
      return
    }
    task().addOnCompleteListener {
      if (it.isSuccessful) promise.resolve(it.result)
      else promise.reject("ERR_FIREBASE_MESSAGING", it.exception?.message, it.exception)
    }
  }
}
