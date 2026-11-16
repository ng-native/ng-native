package dev.ngnative.components

import android.app.Activity
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.Menu
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.PopupMenu
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event

/**
 * A `[contextMenu]` drawn as a PopupMenu at a point in the window, from the entries
 * `serializeMenu` makes: labels, separators (dividers between groups, Android 9 and later),
 * submenus, inline sections, checked, disabled and destructive items, and `icon` as a drawable
 * resource's name. A PopupMenu row has no second line or tooltip, so `subtitle` is not shown.
 * The item chosen goes to the view as `topContextMenuSelect` with its `id`.
 */
internal object ContextMenuPopup {
  /**
   * A destructive item's label colour on a light menu, or on a dark one: Material's error colour
   * for each.
   */
  fun destructiveColour(light: Boolean): Int = if (light) 0xFFB3261E.toInt() else 0xFFF2B8B5.toInt()

  private val main by lazy { Handler(Looper.getMainLooper()) }

  /** The last Android item id given out. On the main thread only. */
  private var lastItemId = 0

  /**
   * Close each submenu of `menu`, at any depth. On a compact screen a submenu opens in a popup of
   * its own in place of the menu's, which dismissing the menu's popup does not reach.
   */
  fun closeSubmenus(menu: Menu) {
    for (index in 0 until menu.size()) {
      val submenu = menu.getItem(index).subMenu ?: continue
      closeSubmenus(submenu)
      submenu.close()
    }
  }

  /** What closes `menu` when its view detaches: each submenu, then the popup through `dismiss`. */
  fun closingOnDetach(menu: Menu, dismiss: () -> Unit) =
    object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) = Unit

      override fun onViewDetachedFromWindow(v: View) {
        closeSubmenus(menu)
        dismiss()
      }
    }

  /** Show `entries` for `view` at (`x`, `y`) in `activity`'s window. Whether there was a menu. */
  fun show(activity: Activity, view: View, entries: List<Map<String, Any?>>, x: Float, y: Float): Boolean {
    val content = activity.findViewById<ViewGroup>(android.R.id.content) ?: return false
    // PopupMenu opens at a view: a one-pixel one at the press point, gone with the menu. The point
    // is physical, so the anchor sits from the left in a right-to-left layout too.
    val at = IntArray(2).also(content::getLocationInWindow)
    val anchor = View(activity)
    content.addView(
      anchor,
      FrameLayout.LayoutParams(1, 1).apply {
        gravity = Gravity.TOP or Gravity.LEFT
        leftMargin = (x - at[0]).toInt()
        topMargin = (y - at[1]).toInt()
      },
    )
    val popup = PopupMenu(activity, anchor, Gravity.NO_GRAVITY)
    val ids = HashMap<Int, String>()
    fill(activity, popup.menu, entries, ids, destructiveColour(isLight(activity)))
    if (popup.menu.size() == 0) {
      content.removeView(anchor)
      return false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) popup.setForceShowIcon(true)
    popup.setOnMenuItemClickListener { item ->
      val id = ids[item.itemId] ?: return@setOnMenuItemClickListener false
      select(view, id)
      true
    }
    // The menu goes with its view: when it unmounts, or its activity is recreated or destroyed.
    // A submenu open in its own popup goes too.
    val gone = closingOnDetach(popup.menu, popup::dismiss)
    view.addOnAttachStateChangeListener(gone)
    // Later, not while the view tree may be detaching its children.
    val done = {
      view.removeOnAttachStateChangeListener(gone)
      main.post { content.removeView(anchor) }
    }
    popup.setOnDismissListener { done() }
    // The anchor has no place until it is laid out, so the menu waits for that.
    anchor.addOnLayoutChangeListener(
      object : View.OnLayoutChangeListener {
        override fun onLayoutChange(
          v: View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int,
        ) {
          anchor.removeOnLayoutChangeListener(this)
          if (anchor.isAttachedToWindow && view.isAttachedToWindow) popup.show() else done()
        }
      },
    )
    return true
  }

  /**
   * Add `entries` to `menu`. Each item's Android id is one more than the last, and `ids` maps it
   * back to the entry's `id`. A separator or an inline section starts a new group.
   */
  private fun fill(
    activity: Activity,
    menu: Menu,
    entries: List<*>,
    ids: HashMap<Int, String>,
    destructive: Int,
    startGroup: Int = 0,
  ): Int {
    var group = startGroup
    for (raw in entries) {
      val entry = raw as? Map<*, *> ?: continue
      if (entry["separator"] == true) {
        group++
        continue
      }
      val label = entry["label"] as? String ?: continue
      val children = entry["items"] as? List<*>
      if (children != null && entry["inline"] == true) {
        group = fill(activity, menu, children, ids, destructive, group + 1) + 1
        continue
      }
      val title = if (entry["destructive"] == true) coloured(label, destructive) else label
      val itemId = ++lastItemId
      (entry["id"] as? String)?.let { ids[itemId] = it }
      val item = if (children != null) {
        menu.addSubMenu(group, itemId, Menu.NONE, title).also { fill(activity, it, children, ids, destructive) }.item
      } else {
        menu.add(group, itemId, Menu.NONE, title)
      }
      item.isEnabled = entry["disabled"] != true
      if (entry["checked"] != null) {
        item.isCheckable = true
        item.isChecked = entry["checked"] == true
      }
      (entry["icon"] as? String)?.let { name ->
        val res = activity.resources.getIdentifier(name, "drawable", activity.packageName)
        if (res != 0) item.setIcon(res)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) menu.setGroupDividerEnabled(true)
    return group
  }

  private fun coloured(label: String, colour: Int): CharSequence =
    SpannableString(label).apply {
      setSpan(ForegroundColorSpan(colour), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

  /**
   * Whether `activity`'s menus are light: its theme's `isLightTheme` on Android 10 and later, and
   * the night mode before that.
   */
  private fun isLight(activity: Activity): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val value = TypedValue()
      if (activity.theme.resolveAttribute(android.R.attr.isLightTheme, value, true)) {
        return value.data != 0
      }
    }
    val night = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    return night != Configuration.UI_MODE_NIGHT_YES
  }

  /** Send the chosen item's `id` to `view` as `topContextMenuSelect`. */
  private fun select(view: View, id: String) {
    val context = UIManagerHelper.getReactContext(view)
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, view.id) ?: return
    dispatcher.dispatchEvent(ContextMenuSelectEvent(UIManagerHelper.getSurfaceId(view), view.id, id))
  }

  private class ContextMenuSelectEvent(surfaceId: Int, viewTag: Int, private val id: String) :
    Event<ContextMenuSelectEvent>(surfaceId, viewTag) {
    override fun getEventName() = "topContextMenuSelect"

    override fun getEventData(): WritableMap = Arguments.createMap().apply { putString("id", id) }
  }
}
