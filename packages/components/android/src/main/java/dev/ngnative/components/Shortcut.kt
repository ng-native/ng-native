package dev.ngnative.components

import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo

/**
 * A shortcut as `Menus` sends it: its `id`, its chord read for Android (`mod` is Ctrl), and the
 * `label` and `group` the Keyboard Shortcuts helper lists it under.
 */
internal class Shortcut(
  val id: String,
  /** The key as `KeyboardEvent.key` names it: `k` lower case, `,`, `ArrowLeft`, `Enter`. */
  val key: String,
  val ctrl: Boolean,
  val meta: Boolean,
  val alt: Boolean,
  val shift: Boolean,
  val label: String,
  val group: String,
) {
  /** Whether `event` is this chord: the same key, and exactly these modifiers. */
  fun matches(event: KeyEvent): Boolean {
    val pressed = keyName(event) ?: return false
    return pressed.equals(normalKey, ignoreCase = key.length > 1) &&
      event.isCtrlPressed == ctrl &&
      event.isMetaPressed == meta &&
      event.isAltPressed == alt &&
      event.isShiftPressed == shift
  }

  /** `Space` and `Spacebar` are the space key, as `KeyboardEvent.key` has it. */
  private val normalKey: String =
    if (key.equals("space", true) || key.equals("spacebar", true)) " " else key

  /** The row in the Keyboard Shortcuts helper. */
  fun info(): KeyboardShortcutInfo {
    val modifiers = (if (ctrl) KeyEvent.META_CTRL_ON else 0) or
      (if (meta) KeyEvent.META_META_ON else 0) or
      (if (alt) KeyEvent.META_ALT_ON else 0) or
      (if (shift) KeyEvent.META_SHIFT_ON else 0)
    val code = NAMED.entries.firstOrNull { it.value.equals(normalKey, true) }?.key
    return if (code != null) {
      KeyboardShortcutInfo(label, code, modifiers)
    } else {
      KeyboardShortcutInfo(label, normalKey.first().uppercaseChar(), modifiers)
    }
  }

  companion object {
    /** A shortcut from what `setShortcuts` was given, or null for one with no key. */
    fun from(sent: Map<String, Any?>): Shortcut? {
      val chord = sent["chord"] as? Map<*, *> ?: return null
      val key = chord["key"] as? String ?: return null
      if (key.isEmpty()) return null
      return Shortcut(
        id = sent["id"] as? String ?: return null,
        key = key,
        ctrl = chord["ctrl"] == true,
        meta = chord["meta"] == true,
        alt = chord["alt"] == true,
        shift = chord["shift"] == true,
        label = sent["label"] as? String ?: "",
        group = sent["group"] as? String ?: "",
      )
    }

    /** The keys `KeyboardEvent.key` names with a word, by their key code. */
    private val NAMED: Map<Int, String> = buildMap {
      put(KeyEvent.KEYCODE_DPAD_LEFT, "ArrowLeft")
      put(KeyEvent.KEYCODE_DPAD_RIGHT, "ArrowRight")
      put(KeyEvent.KEYCODE_DPAD_UP, "ArrowUp")
      put(KeyEvent.KEYCODE_DPAD_DOWN, "ArrowDown")
      put(KeyEvent.KEYCODE_ENTER, "Enter")
      put(KeyEvent.KEYCODE_NUMPAD_ENTER, "Enter")
      put(KeyEvent.KEYCODE_ESCAPE, "Escape")
      put(KeyEvent.KEYCODE_DEL, "Backspace")
      put(KeyEvent.KEYCODE_FORWARD_DEL, "Delete")
      put(KeyEvent.KEYCODE_TAB, "Tab")
      put(KeyEvent.KEYCODE_SPACE, " ")
      put(KeyEvent.KEYCODE_MOVE_HOME, "Home")
      put(KeyEvent.KEYCODE_MOVE_END, "End")
      put(KeyEvent.KEYCODE_PAGE_UP, "PageUp")
      put(KeyEvent.KEYCODE_PAGE_DOWN, "PageDown")
      for (n in 1..12) put(KeyEvent.KEYCODE_F1 + n - 1, "F$n")
    }

    /** The key `event` is, as `KeyboardEvent.key` names it, ignoring Shift: `k`, `,`, `Enter`. */
    fun keyName(event: KeyEvent): String? {
      NAMED[event.keyCode]?.let { return it }
      val char = event.getUnicodeChar(0)
      if (char <= 0) return null
      return char.toChar().lowercase()
    }

    /** The helper's groups: each group's shortcuts under its name, in the order sent. */
    fun groups(shortcuts: List<Shortcut>): List<KeyboardShortcutGroup> =
      shortcuts
        .groupBy { it.group }
        .map { (group, list) -> KeyboardShortcutGroup(group, list.map(Shortcut::info)) }
  }
}
