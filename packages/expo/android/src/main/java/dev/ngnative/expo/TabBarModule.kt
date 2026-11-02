package dev.ngnative.expo

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.core.view.children
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * How tall a tab bar is on Android, for `TabBarInsets` in `@ng-native/router`.
 *
 * No event of react-native-screens carries it, and a `SafeAreaView` cannot read it for JavaScript:
 * the tabs container keeps one insets listener, so a second view would take it from the app's own.
 * A layout listener on the bar itself has no such limit. `onTabBarHeight` reports the height in
 * points, which includes the system bar the bar reaches over. A bar hidden with `tabBarHidden` keeps
 * its last height: JavaScript knows it hid the bar.
 */
class TabBarModule : Module() {
  private class Watched(val bar: View, val listener: View.OnLayoutChangeListener)

  /** By the tabs host's tag. On the main thread only. */
  private val watched = HashMap<Int, Watched>()

  override fun definition() = ModuleDefinition {
    Name("NgNativeTabBar")

    Events("onTabBarHeight")

    // Asked again with each layout of the host, as nothing says when the view is mounted.
    AsyncFunction("watch") { host: Int ->
      watch(host)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unwatch") { host: Int ->
      unwatch(host)
    }.runOnQueue(Queues.MAIN)

    // A recreated activity has new views while the old app's JavaScript can outlive them. Each app
    // on screen asks again as its host lays out.
    OnActivityDestroys {
      unwatchAll()
    }

    OnDestroy {
      Handler(Looper.getMainLooper()).post(::unwatchAll)
    }
  }

  /** Whether the host has a bar to watch yet. */
  private fun watch(host: Int): Boolean {
    val bar = barOf(host) ?: return false
    if (watched[host]?.bar !== bar) {
      unwatch(host)
      val listener = View.OnLayoutChangeListener { view, _, top, _, bottom, _, oldTop, _, oldBottom ->
        if (bottom - top != oldBottom - oldTop) report(host, view)
      }
      bar.addOnLayoutChangeListener(listener)
      watched[host] = Watched(bar, listener)
    }
    report(host, bar)
    return true
  }

  private fun unwatch(host: Int) {
    watched.remove(host)?.run { bar.removeOnLayoutChangeListener(listener) }
  }

  private fun unwatchAll() {
    watched.keys.toList().forEach(::unwatch)
  }

  private fun report(host: Int, bar: View) {
    val points = bar.height / bar.resources.displayMetrics.density.toDouble()
    sendEvent("onTabBarHeight", mapOf("host" to host, "height" to points))
  }

  private fun barOf(host: Int): View? {
    val context = appContext.reactContext as? ReactContext ?: return null
    val view = try {
      UIManagerHelper.getUIManagerForReactTag(context, host)?.resolveView(host)
    } catch (_: RuntimeException) {
      // Not mounted yet, or gone already.
      null
    }
    return view?.let(::findBar)
  }

  /** The bar is react-native-screens' to create, so it is found by what it is. */
  private fun findBar(view: View): View? {
    if (isBar(view)) return view
    return (view as? ViewGroup)?.children?.firstNotNullOfOrNull(::findBar)
  }

  private fun isBar(view: View): Boolean =
    generateSequence<Class<*>>(view.javaClass) { it.superclass }.any { it.name == BOTTOM_NAVIGATION }

  private companion object {
    /** By name, as this package has no dependency on Material or on react-native-screens. */
    const val BOTTOM_NAVIGATION = "com.google.android.material.bottomnavigation.BottomNavigationView"
  }
}
