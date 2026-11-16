package dev.ngnative.components

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * `NgNativeMenus` on Android, the host side of `Menus` in `@ng-native/device`.
 *
 * Android draws no menu bar, so `setMenuBar` is not here and `menuBar` is false: `Menus` sends the
 * bar's shortcuts with every `[shortcut]` through `setShortcuts`. A hardware keyboard's chord reaches
 * them through the window's key-shortcut dispatch, after a focused view has had it, so a text input
 * keeps Ctrl-Z, X, C, V and A; the Keyboard Shortcuts helper (Meta-/) lists them by group.
 *
 * `setContextMenu` keeps each `[contextMenu]` by its view's `nativeID`, since React Native's view
 * drops a `contextMenu` prop it does not know. A long press or a right-click on the view opens it
 * as a PopupMenu at the press point, and so does the view's long-press accessibility action.
 * `setTakesLongPress` names views inside one that take a long press themselves, where a long press
 * opens no menu.
 */
class MenusModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  /** This module's own sender, which `MenuHost` holds while this module is the app's. */
  private val sender: (Map<String, Any?>) -> Unit = { body -> sendEvent("ngNativeMenus", body) }

  override fun definition() = ModuleDefinition {
    Name("NgNativeMenus")

    Constant("menuBar") { false }
    Constant("appName") {
      val context = appContext.reactContext ?: return@Constant ""
      context.applicationInfo.loadLabel(context.packageManager).toString()
    }

    Events("ngNativeMenus")

    Function("setShortcuts") { shortcuts: List<Map<String, Any?>> ->
      val parsed = shortcuts.mapNotNull(Shortcut::from)
      main.post { MenuHost.shortcuts = parsed }
    }

    Function("setContextMenu") { nativeId: String, entries: List<Map<String, Any?>>? ->
      main.post {
        if (entries.isNullOrEmpty()) MenuHost.contextMenus.remove(nativeId)
        else MenuHost.contextMenus[nativeId] = entries
        ContextMenuAccessibility.update(appContext.currentActivity, nativeId)
      }
    }

    Function("setTakesLongPress") { nativeId: String, takes: Boolean ->
      main.post {
        if (takes) {
          MenuHost.longPressTakers.add(nativeId)
        } else {
          MenuHost.longPressTakers.remove(nativeId)
        }
      }
    }

    // On the main thread, in order with the old module's `OnDestroy` and every call after.
    OnCreate {
      main.post { MenuHost.attach(sender) }
      watchActivity()
    }

    // A recreated activity is a new window, which the menus move to.
    OnActivityEntersForeground { watchActivity() }

    // A reload makes a new module, which starts with no shortcuts or menus. The old one lets go
    // only of what it set: the new one may have attached first.
    OnDestroy {
      main.post {
        MenuHost.detach(sender)
        if (MenuHost.send == null) ContextMenuAccessibility.stop()
      }
    }
  }

  private fun watchActivity() {
    val activity = appContext.currentActivity ?: return
    main.post { MenuWindowCallback.install(activity) }
  }
}
