package dev.ngnative.components

import android.app.UiModeManager
import org.junit.Assert.assertEquals
import org.junit.Test

class ColorSchemeModuleTest {
  @Test
  fun mapsEachSchemeToItsNightMode() {
    assertEquals(UiModeManager.MODE_NIGHT_YES, nightMode("dark"))
    assertEquals(UiModeManager.MODE_NIGHT_NO, nightMode("light"))
    assertEquals(UiModeManager.MODE_NIGHT_AUTO, nightMode("unspecified"))
  }

  @Test
  fun aFieldShowingTheOldThemesSelectionColourTakesTheNewOne() {
    assertEquals(0x22, followedHighlight(current = 0x11, was = 0x11, now = 0x22))
  }

  @Test
  fun aSelectionColourSetFromJavaScriptStays() {
    assertEquals(0x33, followedHighlight(current = 0x33, was = 0x11, now = 0x22))
  }
}
