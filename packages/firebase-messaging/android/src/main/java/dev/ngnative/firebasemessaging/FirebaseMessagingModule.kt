package dev.ngnative.firebasemessaging

import com.google.android.gms.tasks.Task
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
      settle(FirebaseInstallations.getInstance().id, promise)
    }

    AsyncFunction("register") { _: String?, promise: Promise ->
      settle(FirebaseMessaging.getInstance().register(), promise)
    }
  }

  private fun <T> settle(task: Task<T>, promise: Promise) {
    task.addOnCompleteListener {
      if (it.isSuccessful) promise.resolve(it.result)
      else promise.reject("ERR_FIREBASE_MESSAGING", it.exception?.message, it.exception)
    }
  }
}
