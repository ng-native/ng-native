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
}
