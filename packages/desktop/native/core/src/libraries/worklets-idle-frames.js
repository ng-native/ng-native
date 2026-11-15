// Evaluated on react-native-worklets' UI runtime as it starts (react-native-worklets.cpp).
//
// The library's UI runtime asks the host for a frame at the end of every frame it flushes, whether
// or not anything waits for one, so a display link that serves it never stops. Here the request
// that ends a frame which queued no work is parked instead, and asking for a frame or queueing a
// microtask wakes it. A finalizer does not: Reanimated's mappers queue one every frame. Work that
// runs outside a frame (a job sent to the UI runtime, a gesture's event), which can change a shared
// value its mappers read, wakes it through `__ngnWakeFrames`, which the host calls after it. A
// still app then takes no frames.
//
// The runtime may set its queue up after this runs, replacing the functions wrapped here, so they
// are wrapped again whenever the loop asks for a frame and finds them unwrapped.
(function parkIdleFrames(global) {
  if (global.__ngnIdleFramesParked) {
    return;
  }
  global.__ngnIdleFramesParked = true;
  var nativeRequest = global.__nativeRequestAnimationFrame;
  var parked = null;
  // Until the queue is set up, every request goes through.
  var work = true;

  function wake() {
    work = true;
    if (parked !== null) {
      var callback = parked;
      parked = null;
      work = false;
      nativeRequest(callback);
    }
  }

  function waking(name) {
    var original = global[name];
    if (typeof original !== 'function' || original.__ngnWakes) {
      return false;
    }
    var wrapped = function () {
      var result = original.apply(this, arguments);
      wake();
      return result;
    };
    wrapped.__ngnWakes = true;
    global[name] = wrapped;
    return true;
  }

  function wrapAll() {
    var any = waking('requestAnimationFrame');
    any = waking('queueMicrotask') || any;
    return any;
  }

  global.__ngnWakeFrames = wake;

  // The loop's own request for the next frame.
  global.__nativeRequestAnimationFrame = function (callback) {
    // Freshly set up: this frame is the loop's first, and goes through.
    if (wrapAll()) {
      work = true;
    }
    if (work) {
      work = false;
      nativeRequest(callback);
    } else {
      parked = callback;
    }
  };
  wrapAll();
})(globalThis);
