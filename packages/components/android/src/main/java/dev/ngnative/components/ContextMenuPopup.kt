package dev.ngnative.components

import android.app.Activity
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
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
 * resource's name. The item chosen goes to the view as `topContextMenuSelect` with its `id`.
 */
internal object ContextMenuPopup {
  /** Material's error colour, for a destructive item's label. */
  private const val DESTRUCTIVE = 0xFFB3261E.toInt()

  /** The last Android item id given out. On the main thread only. */
  private var lastItemId = 0

  /** Show `entries` for `view` at (`x`, `y`) in `activity`'s window. Whether there was a menu. */
  fun show(activity: Activity, view: View, entries: List<Map<String, Any?>>, x: Float, y: Float): Boolean {
    val content = activity.findViewById<ViewGroup>(android.R.id.content) ?: return false
    // PopupMenu opens at a view: a one-pixel one at the press point, gone with the menu.
    val at = IntArray(2).also(content::getLocationInWindow)
    val anchor = View(activity)
    content.addView(
      anchor,
      FrameLayout.LayoutParams(1, 1).apply {
        leftMargin = (x - at[0]).toInt()
        topMargin = (y - at[1]).toInt()
      },
    )
    val popup = PopupMenu(activity, anchor, Gravity.NO_GRAVITY)
    val ids = HashMap<Int, String>()
    fill(activity, popup.menu, entries, ids)
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
    popup.setOnDismissListener { content.removeView(anchor) }
    // The anchor has no place until it is laid out, so the menu waits for that.
    anchor.addOnLayoutChangeListener(
      object : View.OnLayoutChangeListener {
        override fun onLayoutChange(
          v: View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int,
        ) {
          anchor.removeOnLayoutChangeListener(this)
          if (anchor.isAttachedToWindow) popup.show()
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
        group = fill(activity, menu, children, ids, group + 1) + 1
        continue
      }
      val title = title(label, entry["destructive"] == true)
      val itemId = ++lastItemId
      (entry["id"] as? String)?.let { ids[itemId] = it }
      val item = if (children != null) {
        menu.addSubMenu(group, itemId, Menu.NONE, title).also { fill(activity, it, children, ids) }.item
      } else {
        menu.add(group, itemId, Menu.NONE, title)
      }
      item.isEnabled = entry["disabled"] != true
      if (entry["checked"] != null) {
        item.isCheckable = true
        item.isChecked = entry["checked"] == true
      }
      (entry["subtitle"] as? String)?.let {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) item.tooltipText = it
      }
      (entry["icon"] as? String)?.let { name ->
        val res = activity.resources.getIdentifier(name, "drawable", activity.packageName)
        if (res != 0) item.setIcon(res)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) menu.setGroupDividerEnabled(true)
    return group
  }

  private fun title(label: String, destructive: Boolean): CharSequence {
    if (!destructive) return label
    return SpannableString(label).apply {
      setSpan(ForegroundColorSpan(DESTRUCTIVE), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
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
