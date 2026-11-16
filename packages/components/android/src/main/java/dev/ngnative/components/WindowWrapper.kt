package dev.ngnative.components

import java.util.Collections
import java.util.WeakHashMap

/**
 * Puts a wrapper on each window's callback once. On the main thread only.
 *
 * Whether a window has the wrapper is kept by window, not read from the top of its callback chain:
 * a library that wraps the callback on resume and unwraps it on pause only while it is on top
 * (some crash and analytics SDKs do this) leaves ours under its own, and a check of the top would
 * wrap the window again on every resume.
 */
internal class WindowWrapper<W : Any> {
  private val wrapped: MutableSet<W> = Collections.newSetFromMap(WeakHashMap())

  /** Wrap `window`'s `callback` with `wrap` and `set` the result, the first time only. */
  fun <C : Any> wrapOnce(window: W, callback: C?, wrap: (C) -> C, set: (C) -> Unit) {
    if (callback == null || !wrapped.add(window)) return
    set(wrap(callback))
  }
}
