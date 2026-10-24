/**
 * The window's and the document's listeners before any module runs, where the Metro config has
 * `withWebCompat`.
 *
 * A library reaches for them as its modules load, before an app is up to ask for
 * `provideWebCompat()`: the CDK adds a listener to the window to learn whether one can be passive,
 * and a library that notes the last touch adds one to the document. React Native's window has
 * none, and the `document` Metro's `animation-globals.js` gives the runtime has none either, so
 * that threw where the library was imported eagerly. These stand-ins read a listener's options as
 * a browser does and keep what they are given: `installWindow()` hands the window's to the
 * window's own listeners once an app is up, and each app's document is given the document's. A
 * script, as Metro runs a polyfill: no imports, and the global given as `global`.
 */
(function () {
  var captures = function (options) {
    return typeof options === 'boolean' ? options : Boolean(options && options.capture);
  };

  /** Listening that keeps what it is given, put on `target`. */
  var standIn = function (target) {
    var kept = [];
    // The app documents handed what this was given: see `handEarlyListeners`.
    var handedTo = new Set();
    var tell = function (name, args) {
      handedTo.forEach(function (document) {
        document[name].apply(document, args);
      });
    };
    var standIns = {
      addEventListener: function (type, listener, options) {
        tell('addEventListener', arguments);
        var capture = captures(options);
        // Read as a browser reads them, which is what a library asking about `passive` hears.
        var once = Boolean(options && typeof options === 'object' && options.once);
        var passive = options && typeof options === 'object' ? options.passive : undefined;
        // A listener added with a signal already aborted is never added, and goes once it aborts.
        var signal = options && typeof options === 'object' ? options.signal : undefined;
        if (!listener || (signal && signal.aborted)) return;
        for (var i = 0; i < kept.length; i++) {
          if (kept[i].type === type && kept[i].listener === listener && kept[i].capture === capture)
            return;
        }
        var entry = {
          type: type,
          listener: listener,
          capture: capture,
          options: { capture: capture, once: once, passive: passive, signal: signal },
        };
        kept.push(entry);
        if (signal && typeof signal.addEventListener === 'function') {
          signal.addEventListener('abort', function () {
            kept = kept.filter(function (each) {
              return each !== entry;
            });
          });
        }
      },
      removeEventListener: function (type, listener, options) {
        tell('removeEventListener', arguments);
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
    // The window's, taken once: the window is one, and its own listeners keep them from then on.
    Object.defineProperty(standIns, 'kept', {
      get: function () {
        return kept.splice(0);
      },
    });
    // The document's, read for each app's document as it comes up.
    Object.defineProperty(standIns, 'listeners', {
      get: function () {
        return kept.slice();
      },
    });
    standIns.handedTo = handedTo;
    // What `installWindow()` and each app's document look for, by a name they alone know to ask.
    standIns.addEventListener.standIns = standIns;
    target.addEventListener = standIns.addEventListener;
    target.removeEventListener = standIns.removeEventListener;
    target.dispatchEvent = standIns.dispatchEvent;
  };

  if (typeof global.addEventListener !== 'function') standIn(global);
  var document = global.document;
  if (document && typeof document.addEventListener !== 'function') standIn(document);
})();
