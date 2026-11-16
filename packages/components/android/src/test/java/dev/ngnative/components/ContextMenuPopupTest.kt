package dev.ngnative.components

import android.view.Menu
import android.view.MenuItem
import android.view.SubMenu
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Test

class ContextMenuPopupTest {
  @Test
  fun colorsADestructiveItemWithMaterialsErrorColourForTheMenusTheme() {
    assertEquals(0xFFB3261E.toInt(), ContextMenuPopup.destructiveColour(light = true))
    assertEquals(0xFFF2B8B5.toInt(), ContextMenuPopup.destructiveColour(light = false))
  }

  /** A menu of `items`, each a submenu or null for a plain item, that records each `close()`. */
  private fun menu(name: String, closed: MutableList<String>, vararg items: SubMenu?): SubMenu {
    val rows = items.map { sub ->
      Proxy.newProxyInstance(javaClass.classLoader, arrayOf(MenuItem::class.java)) { _, method, _ ->
        if (method.name == "getSubMenu") sub else null
      } as MenuItem
    }
    return Proxy.newProxyInstance(javaClass.classLoader, arrayOf(SubMenu::class.java)) { _, method, args ->
      when (method.name) {
        "size" -> rows.size
        "getItem" -> rows[args!![0] as Int]
        "close" -> closed.add(name).let { null }
        else -> null
      }
    } as SubMenu
  }

  @Test
  fun closesEverySubmenuWhenItsViewDetachesWhichDismissingThePopupLeavesOpen() {
    // On a compact screen a submenu replaces the popup in a window of its own, which the popup's
    // dismiss() does not reach.
    val closed = mutableListOf<String>()
    val root: Menu = menu(
      "root",
      closed,
      null,
      menu("share", closed, menu("more", closed)),
      menu("move", closed),
    )
    ContextMenuPopup.closingOnDetach(root) { closed.add("popup") }.onViewDetachedFromWindow(null)
    assertEquals(listOf("more", "share", "move", "popup"), closed)
  }
}
