package dev.ngnative.components

/**
 * What the app has sent `NgNativeMenus`, shared by the module and the window it watches. Read and
 * written on the main thread only.
 */
internal object MenuHost {
  /** Every shortcut the app listens for, `[shortcut]`s and the menu bar's, in the order sent. */
  var shortcuts: List<Shortcut> = emptyList()

  /** Each `[contextMenu]`'s entries, as `serializeMenu` makes them, by its view's `nativeID`. */
  val contextMenus: MutableMap<String, List<Map<String, Any?>>> = HashMap()

  /** Sends an `ngNativeMenus` event to JavaScript, while a module is there to send it. */
  var send: ((Map<String, Any?>) -> Unit)? = null
}
