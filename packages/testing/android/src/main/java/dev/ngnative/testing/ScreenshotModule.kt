package dev.ngnative.testing

import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.view.PixelCopy
import android.view.View
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/**
 * `NgNativeScreenshot`: the app's window as a PNG, for `toMatchScreenshot()` in a device test.
 *
 * `PixelCopy` reads the window's surface as the screen shows it, so it has whatever the views drew,
 * hardware layers included. The PNG is encoded on a thread of its own, off the main thread.
 */
class ScreenshotModule : Module() {
  private val encoder by lazy { HandlerThread("NgNativeScreenshot").apply { start() } }

  override fun definition() = ModuleDefinition {
    Name("NgNativeScreenshot")

    AsyncFunction("capture") { region: Map<String, Double>?, promise: Promise ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction promise.reject(ScreenshotException("The app has no activity"))
      val decor = activity.window.decorView
      val rect = if (region == null) {
        Rect(0, 0, decor.width, decor.height)
      } else {
        val density = activity.resources.displayMetrics.density
        val px = { key: String -> ((region[key] ?: 0.0) * density).roundToInt() }
        Rect(px("x"), px("y"), px("x") + px("width"), px("y") + px("height"))
      }
      copy(activity.window, rect, decor, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("captureView") { tag: Int, promise: Promise ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction promise.reject(ScreenshotException("The app has no activity"))
      val view = appContext.findView<View>(tag)
        ?: return@AsyncFunction promise.reject(ScreenshotException("No view with tag $tag"))
      // Where the view shows in the window, through its own and its ancestors' transforms (a
      // scale, a rotation), which its width and height do not count, and cut to what is visible.
      val rect = Rect()
      if (!view.getGlobalVisibleRect(rect)) {
        return@AsyncFunction promise.reject(ScreenshotException("The view with tag $tag is not visible"))
      }
      copy(activity.window, rect, activity.window.decorView, promise)
    }.runOnQueue(Queues.MAIN)

    OnDestroy { encoder.quitSafely() }
  }

  private fun copy(window: android.view.Window, region: Rect, decor: View, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return promise.reject(ScreenshotException("Screenshots need Android 8 (API 26) or later"))
    }
    val rect = Rect(region)
    if (!rect.intersect(0, 0, decor.width, decor.height)) {
      return promise.reject(ScreenshotException("The region $region is outside the window"))
    }
    val bitmap = Bitmap.createBitmap(rect.width(), rect.height(), Bitmap.Config.ARGB_8888)
    PixelCopy.request(window, rect, bitmap, { result ->
      if (result != PixelCopy.SUCCESS) {
        promise.reject(ScreenshotException("PixelCopy failed with result $result"))
      } else {
        val png = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, png)
        bitmap.recycle()
        promise.resolve(Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP))
      }
    }, Handler(encoder.looper))
  }
}

private class ScreenshotException(message: String) : CodedException(message)
