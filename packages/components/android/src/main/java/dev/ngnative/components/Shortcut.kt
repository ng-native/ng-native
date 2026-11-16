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
  fun matches(event: KeyEvent): Boolean =
    matches(
      keyName(event),
      shiftedName(event),
      event.isCtrlPressed,
      event.isMetaPressed,
      event.isAltPressed,
      event.isShiftPressed,
    )

  /**
   * Whether a key `pressed` (as `keyName` names it) is this chord with these modifiers held.
   * `shifted` is the character the key types with Shift, while Shift is held.
   */
  fun matches(
    pressed: String?,
    shifted: String?,
    ctrl: Boolean,
    meta: Boolean,
    alt: Boolean,
    shift: Boolean,
  ): Boolean {
    if (pressed == null || ctrl != this.ctrl || meta != this.meta || alt != this.alt) return false
    if (pressed.equals(normalKey, ignoreCase = key.length > 1)) return shift == this.shift
    // `KeyboardEvent.key` names the shifted character, so `mod+?` is Ctrl-Shift-/, and so is
    // `mod+shift+?`, which names the Shift too.
    return shift && shifted == normalKey
  }

  /** `Space` and `Spacebar` are the space key, as `KeyboardEvent.key` has it. */
  private val normalKey: String =
    if (key.equals("space", true) || key.equals("spacebar", true)) " " else key

  /** The row in the Keyboard Shortcuts helper, or null for a key it has no way to show. */
  fun info(): KeyboardShortcutInfo? {
    val modifiers = (if (ctrl) KeyEvent.META_CTRL_ON else 0) or
      (if (meta) KeyEvent.META_META_ON else 0) or
      (if (alt) KeyEvent.META_ALT_ON else 0) or
      (if (shift) KeyEvent.META_SHIFT_ON else 0)
    val code = keyCode()
    if (code != null) return KeyboardShortcutInfo(label, code, modifiers)
    return KeyboardShortcutInfo(label, helperChar() ?: return null, modifiers)
  }

  /** The key code of a key `KeyboardEvent.key` names with a word, or null. */
  fun keyCode(): Int? = NAMED.entries.firstOrNull { it.value.equals(normalKey, true) }?.key

  /** The character the helper shows for a key with no key code, or null for a word it lacks. */
  fun helperChar(): Char? = normalKey.singleOrNull()?.uppercaseChar()

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

    /**
     * The keys `KeyboardEvent.key` names with a word, by their key code. Android has no key past
     * F12, so a shortcut on F13 and up never fires here and the helper does not list it.
     */
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
      put(KeyEvent.KEYCODE_INSERT, "Insert")
      put(KeyEvent.KEYCODE_BREAK, "Pause")
      put(KeyEvent.KEYCODE_SCROLL_LOCK, "ScrollLock")
      put(KeyEvent.KEYCODE_MENU, "ContextMenu")
      for (n in 1..12) put(KeyEvent.KEYCODE_F1 + n - 1, "F$n")
    }

    /** The key `event` is, as `KeyboardEvent.key` names it, ignoring Shift: `k`, `,`, `Enter`. */
    fun keyName(event: KeyEvent): String? {
      nameOf(event.keyCode)?.let { return it }
      val char = event.getUnicodeChar(0)
      if (char <= 0) return null
      return char.toChar().lowercase()
    }

    /** The word `KeyboardEvent.key` names the key with `keyCode` by, or null for a character. */
    fun nameOf(keyCode: Int): String? = NAMED[keyCode]

    /** The character `event`'s key types with Shift, while Shift is held, or null. */
    private fun shiftedName(event: KeyEvent): String? {
      if (!event.isShiftPressed) return null
      val char = event.getUnicodeChar(event.metaState and KeyEvent.META_SHIFT_MASK)
      return if (char > 0) char.toChar().toString() else null
    }

    /** The helper's groups: each group's shortcuts under its name, in the order sent. */
    fun groups(shortcuts: List<Shortcut>): List<KeyboardShortcutGroup> =
      shortcuts
        .groupBy { it.group }
        .mapNotNull { (group, list) ->
          list.mapNotNull(Shortcut::info).takeIf { it.isNotEmpty() }?.let { KeyboardShortcutGroup(group, it) }
        }
  }
}
