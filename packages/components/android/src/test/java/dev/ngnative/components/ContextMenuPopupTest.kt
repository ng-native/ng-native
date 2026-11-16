package dev.ngnative.components

import org.junit.Assert.assertEquals
import org.junit.Test

class ContextMenuPopupTest {
  @Test
  fun colorsADestructiveItemWithMaterialsErrorColourForTheMenusTheme() {
    assertEquals(0xFFB3261E.toInt(), ContextMenuPopup.destructiveColour(light = true))
    assertEquals(0xFFF2B8B5.toInt(), ContextMenuPopup.destructiveColour(light = false))
  }
}
