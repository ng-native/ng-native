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

  /**
   * The `nativeID`s of views that take a long press themselves (a `(longPress)`): one there opens
   * no context menu around them, as the innermost handler wins.
   */
  val longPressTakers: MutableSet<String> = HashSet()

  /** Sends an `ngNativeMenus` event to JavaScript, while a module is there to send it. */
  var send: ((Map<String, Any?>) -> Unit)? = null
    private set

  /** A new module's sender: it starts with nothing an earlier module was sent. */
  fun attach(sender: (Map<String, Any?>) -> Unit) {
    send = sender
    forget()
  }

  /**
   * Let go of the module that set `sender`. A reload's new module can attach before the old one's
   * `OnDestroy` runs, and then keeps what it has.
   */
  fun detach(sender: (Map<String, Any?>) -> Unit) {
    if (send !== sender) return
    send = null
    forget()
  }

  private fun forget() {
    shortcuts = emptyList()
    contextMenus.clear()
    longPressTakers.clear()
  }
}
