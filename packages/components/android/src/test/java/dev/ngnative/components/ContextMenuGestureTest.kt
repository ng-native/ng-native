package dev.ngnative.components

import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContextMenuGestureTest {
  private fun owner(
    chain: List<String?>,
    longPress: Boolean,
    menus: Set<String>,
    takers: Set<String> = emptySet(),
  ) = ContextMenuGesture.menuOwner(chain, longPress, menus::contains, takers::contains)

  @Test
  fun opensTheNearestMenuAboveThePressedView() {
    assertEquals(1, owner(listOf(null, "inner", "outer"), true, setOf("inner", "outer")))
    assertEquals(2, owner(listOf(null, "text", "outer"), true, setOf("outer")))
    assertNull(owner(listOf(null, "text"), true, setOf("elsewhere")))
  }

  @Test
  fun leavesALongPressToAViewInsideTheMenuThatTakesOne() {
    val chain = listOf("handle", "row")
    assertNull(owner(chain, longPress = true, menus = setOf("row"), takers = setOf("handle")))
    // A right-click still opens it.
    assertEquals(1, owner(chain, longPress = false, menus = setOf("row"), takers = setOf("handle")))
  }

  @Test
  fun opensTheMenuWhenTheViewThatTakesALongPressIsAroundIt() {
    val chain = listOf("row", "card")
    assertEquals(0, owner(chain, longPress = true, menus = setOf("row"), takers = setOf("card")))
  }

  @Test
  fun tellsARightClickByTheMouseSecondaryButton() {
    assertTrue(ContextMenuGesture.isSecondaryClick(true, MotionEvent.BUTTON_SECONDARY))
    assertTrue(
      ContextMenuGesture.isSecondaryClick(true, MotionEvent.BUTTON_SECONDARY or MotionEvent.BUTTON_PRIMARY),
    )
    assertFalse(ContextMenuGesture.isSecondaryClick(true, MotionEvent.BUTTON_PRIMARY))
    assertFalse(ContextMenuGesture.isSecondaryClick(false, MotionEvent.BUTTON_SECONDARY))
  }

  @Test
  fun opensOnlyOnAViewStillAttachedAndNamedAsWhenPressed() {
    assertTrue(ContextMenuGesture.stillOwns(attached = true, tag = "row-a", nativeId = "row-a"))
    // Recycled for another row while the press was held: row-a's menu is not opened on it.
    assertFalse(ContextMenuGesture.stillOwns(attached = true, tag = "row-b", nativeId = "row-a"))
    assertFalse(ContextMenuGesture.stillOwns(attached = true, tag = null, nativeId = "row-a"))
    assertFalse(ContextMenuGesture.stillOwns(attached = false, tag = "row-a", nativeId = "row-a"))
  }
}
