package dev.ngnative.components

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShortcutTest {
  private fun shortcut(key: String, ctrl: Boolean = true, shift: Boolean = false) =
    Shortcut("s", key, ctrl, meta = false, alt = false, shift = shift, label = "", group = "")

  @Test
  fun matchesTheKeyWithExactlyItsModifiers() {
    val save = shortcut("s")
    assertTrue(save.matches("s", null, ctrl = true, meta = false, alt = false, shift = false))
    assertFalse(save.matches("s", "S", ctrl = true, meta = false, alt = false, shift = true))
    assertFalse(save.matches("s", null, ctrl = true, meta = false, alt = true, shift = false))
    assertFalse(save.matches("s", null, ctrl = false, meta = false, alt = false, shift = false))
    assertFalse(save.matches("d", null, ctrl = true, meta = false, alt = false, shift = false))
    assertFalse(save.matches(null, null, ctrl = true, meta = false, alt = false, shift = false))
  }

  @Test
  fun matchesANamedKeyInAnyCaseAndSpaceByItsName() {
    assertTrue(shortcut("enter").matches("Enter", null, true, false, false, false))
    assertTrue(shortcut("Space").matches(" ", null, true, false, false, false))
  }

  @Test
  fun matchesAShiftedCharacterAsKeyboardEventKeyNamesIt() {
    // Ctrl-Shift-/ types `?`, and the main row's Ctrl-Shift-= types `+`.
    assertTrue(shortcut("?").matches("/", "?", ctrl = true, meta = false, alt = false, shift = true))
    assertTrue(shortcut("+").matches("=", "+", ctrl = true, meta = false, alt = false, shift = true))
    assertFalse(shortcut("?").matches("/", null, ctrl = true, meta = false, alt = false, shift = false))
    // So is `mod+shift+?`, which names the Shift the character takes.
    assertTrue(shortcut("?", shift = true).matches("/", "?", ctrl = true, meta = false, alt = false, shift = true))
    assertFalse(shortcut("?", shift = true).matches("/", null, true, false, false, false))
    // A chord that names Shift still matches the unshifted key.
    assertTrue(shortcut("/", shift = true).matches("/", "?", true, false, false, true))
    // Shift on a letter is a different chord.
    assertFalse(shortcut("k").matches("k", "K", true, false, false, true))
  }

  @Test
  fun namesTheKeysKeyboardEventKeyNamesWithAWord() {
    assertEquals("Insert", Shortcut.nameOf(KeyEvent.KEYCODE_INSERT))
    assertEquals("F12", Shortcut.nameOf(KeyEvent.KEYCODE_F12))
    assertEquals("F13", Shortcut.nameOf(KeyEvent.KEYCODE_F13))
    assertEquals("F20", Shortcut.nameOf(KeyEvent.KEYCODE_F20))
    assertNull(Shortcut.nameOf(KeyEvent.KEYCODE_F21))
    assertEquals("ArrowLeft", Shortcut.nameOf(KeyEvent.KEYCODE_DPAD_LEFT))
    assertNull(Shortcut.nameOf(KeyEvent.KEYCODE_K))
  }

  @Test
  fun showsInTheHelperOnlyAKeyItCanName() {
    assertEquals(KeyEvent.KEYCODE_INSERT, shortcut("Insert").keyCode())
    assertEquals('K', shortcut("k").helperChar())
    assertEquals(KeyEvent.KEYCODE_F13, shortcut("F13").keyCode())
    assertEquals(KeyEvent.KEYCODE_F20, shortcut("F20").keyCode())
    // No key code, and not one character: a wrong letter would be worse than no row.
    assertNull(shortcut("Help").keyCode())
    assertNull(shortcut("Help").helperChar())
  }

  @Test
  fun readsWhatSetShortcutsSends() {
    val sent = mapOf(
      "id" to "save",
      "chord" to mapOf("key" to "s", "ctrl" to true, "shift" to true),
      "label" to "Save",
      "group" to "File",
    )
    val parsed = Shortcut.from(sent)!!
    assertEquals("save", parsed.id)
    assertEquals("s", parsed.key)
    assertTrue(parsed.ctrl && parsed.shift && !parsed.meta && !parsed.alt)
    assertEquals("Save", parsed.label)
    assertEquals("File", parsed.group)
    assertNull(Shortcut.from(mapOf("id" to "x", "chord" to mapOf("key" to ""))))
    assertNull(Shortcut.from(mapOf("chord" to mapOf("key" to "s"))))
    assertNull(Shortcut.from(mapOf("id" to "x")))
  }
}
