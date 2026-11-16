package dev.ngnative.components

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A library that wraps the window's callback on resume and unwraps it on pause only while it is on
 * top, as some crash and analytics SDKs do.
 */
class WindowWrapperTest {
  private class FakeWindow(var callback: Any)

  private class Ours(val base: Any)

  private class Theirs(val base: Any)

  private fun FakeWindow.resumeTheirs() {
    callback = Theirs(callback)
  }

  private fun FakeWindow.pauseTheirs() {
    (callback as? Theirs)?.let { callback = it.base }
  }

  private fun FakeWindow.ours(): Int =
    generateSequence(callback) { (it as? Ours)?.base ?: (it as? Theirs)?.base }.count { it is Ours }

  @Test
  fun wrapsAWindowOnceWhenAnotherLibraryWrapsItOnEveryResume() {
    val wrapper = WindowWrapper<FakeWindow>()
    val window = FakeWindow("activity")
    repeat(3) {
      window.resumeTheirs()
      wrapper.wrapOnce(window, window.callback, ::Ours) { window.callback = it }
      window.pauseTheirs()
    }
    assertEquals(1, window.ours())
  }

  @Test
  fun wrapsEachWindowItIsGiven() {
    val wrapper = WindowWrapper<FakeWindow>()
    val activity = FakeWindow("activity")
    val dialog = FakeWindow("dialog")
    for (window in listOf(activity, dialog, activity, dialog)) {
      wrapper.wrapOnce(window, window.callback, ::Ours) { window.callback = it }
    }
    assertEquals(1, activity.ours())
    assertEquals(1, dialog.ours())
  }
}
