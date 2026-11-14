package dev.ngnative.components

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** A reload makes a new `NgNativeMenus` module before or after the old one's `OnDestroy` runs. */
class MenuHostTest {
  private val old: (Map<String, Any?>) -> Unit = {}
  private val new: (Map<String, Any?>) -> Unit = {}

  @After
  fun reset() {
    MenuHost.detach(MenuHost.send ?: return)
  }

  @Test
  fun keepsTheNewSenderWhenTheOldModuleLetsGoAfterIt() {
    MenuHost.attach(old)
    MenuHost.attach(new)
    MenuHost.contextMenus["row"] = listOf(mapOf("id" to "0"))
    MenuHost.longPressTakers.add("handle")
    MenuHost.detach(old)
    assertSame(new, MenuHost.send)
    assertEquals(setOf("row"), MenuHost.contextMenus.keys)
    assertEquals(setOf("handle"), MenuHost.longPressTakers)
  }

  @Test
  fun letsGoOfEverythingWhenTheModuleThatSetItGoes() {
    MenuHost.attach(old)
    MenuHost.contextMenus["row"] = listOf(mapOf("id" to "0"))
    MenuHost.longPressTakers.add("handle")
    MenuHost.detach(old)
    assertNull(MenuHost.send)
    assertTrue(MenuHost.contextMenus.isEmpty())
    assertTrue(MenuHost.longPressTakers.isEmpty())
    assertTrue(MenuHost.shortcuts.isEmpty())
  }

  @Test
  fun startsANewModuleWithNothingTheOldOneSent() {
    MenuHost.attach(old)
    MenuHost.contextMenus["ngn-view-1"] = listOf(mapOf("id" to "0"))
    MenuHost.longPressTakers.add("ngn-view-2")
    MenuHost.attach(new)
    assertTrue(MenuHost.contextMenus.isEmpty())
    assertTrue(MenuHost.longPressTakers.isEmpty())
  }
}
