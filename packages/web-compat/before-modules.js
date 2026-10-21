/**
 * The window's listeners before any module runs, where the Metro config has `withWebCompat`.
 *
 * A library reaches for them as its modules load, before an app is up to ask for
 * `provideWebCompat()`: the CDK adds a listener to the window to learn whether one can be passive.
 * React Native's window has none, so that threw where the library was imported eagerly. These
 * stand-ins read a listener's options as a browser does and keep what they are given, which
 * `installWindow()` hands to the window's own listeners once an app is up. A script, as Metro runs
 * a polyfill: no imports, and the global given as `global`.
 */
if (typeof global.addEventListener !== 'function') {
  var kept = [];
  var captures = function (options) {
    return typeof options === 'boolean' ? options : Boolean(options && options.capture);
  };
  var standIns = {
    addEventListener: function (type, listener, options) {
      var capture = captures(options);
      // Read as a browser reads them, which is what a library asking about `passive` hears.
      var once = Boolean(options && typeof options === 'object' && options.once);
      var passive = options && typeof options === 'object' ? options.passive : undefined;
      if (!listener) return;
      for (var i = 0; i < kept.length; i++) {
        if (kept[i].type === type && kept[i].listener === listener && kept[i].capture === capture)
          return;
      }
      kept.push({
        type: type,
        listener: listener,
        capture: capture,
        options: { capture: capture, once: once, passive: passive },
      });
    },
    removeEventListener: function (type, listener, options) {
      var capture = captures(options);
      kept = kept.filter(function (each) {
        return !(each.type === type && each.listener === listener && each.capture === capture);
      });
    },
    // Nothing is told before an app is up: no listener is on anything yet but this.
    dispatchEvent: function () {
      return true;
    },
  };
  Object.defineProperty(standIns, 'kept', {
    get: function () {
      return kept.splice(0);
    },
  });
  // What `installWindow()` looks for, by a name it alone knows to ask.
  standIns.addEventListener.standIns = standIns;
  global.addEventListener = standIns.addEventListener;
  global.removeEventListener = standIns.removeEventListener;
  global.dispatchEvent = standIns.dispatchEvent;
}
