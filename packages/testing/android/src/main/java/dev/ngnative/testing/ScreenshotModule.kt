package dev.ngnative.testing

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
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
      copy(activity.window, windowRect(view), activity.window.decorView, promise)
    }.runOnQueue(Queues.MAIN)

    OnDestroy { encoder.quitSafely() }
  }

  /**
   * Where the view shows in the window, through its own and its ancestors' transforms composed (a
   * scale, a rotation, one undone by another), which its width and height do not count. Before
   * Android 10 the ancestors' are applied one at a time, an axis-aligned box at each.
   */
  private fun windowRect(view: View): Rect {
    val rect = Rect()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val matrix = Matrix()
      view.transformMatrixToGlobal(matrix)
      val box = RectF(0f, 0f, view.width.toFloat(), view.height.toFloat())
      matrix.mapRect(box)
      // The matrix maps to the screen, and the window can start elsewhere on it (split screen).
      val window = IntArray(2).also { view.rootView.getLocationOnScreen(it) }
      box.offset(-window[0].toFloat(), -window[1].toFloat())
      box.roundOut(rect)
    } else {
      view.getGlobalVisibleRect(rect)
    }
    return rect
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
