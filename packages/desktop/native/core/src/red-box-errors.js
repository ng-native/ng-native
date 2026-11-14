// Evaluated on the JavaScript runtime of a dev run before the bundle (red-box.h), as a function
// of the host's `report(error, isFatal)`. It hands the red box what React Native's pipeline does
// not, once the runtime is ready: errors logged with console.error (Angular's ErrorHandler logs
// every error it catches there) and the errors ErrorUtils' global handler gets, fatal or not.
//
// React Native's console polyfill keeps the console it finds as `originalConsole` and calls it with
// each call's own arguments, so wrapping that console's `error` sees the Error objects themselves,
// whatever patches console.error later. ErrorUtils is caught as the polyfill sets it, and each
// handler set on it is wrapped.
(function (report) {
  'use strict';
  var inHandler = false;

  function text(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }

  function send(args, isFatal) {
    var stack = '';
    for (var i = 0; i < args.length; i++) {
      var arg = args[i];
      if (arg != null && typeof arg === 'object' && typeof arg.stack === 'string') {
        stack = arg.stack;
        break;
      }
    }
    var message = args.map(text).join(' ');
    try {
      report({ message: message, stack: stack, isFatal: isFatal });
    } catch (e) {
      // The red box never breaks the app's own error handling.
    }
  }

  var console = globalThis.console;
  if (console == null) {
    console = globalThis.console = {};
  }
  var error = console.error;
  console.error = function () {
    if (!inHandler) send(Array.prototype.slice.call(arguments), false);
    if (typeof error === 'function') return error.apply(this, arguments);
  };

  function wrap(utils) {
    if (utils == null || typeof utils.setGlobalHandler !== 'function' || utils.__ngnRedBox) return;
    utils.__ngnRedBox = true;
    var set = utils.setGlobalHandler;
    utils.setGlobalHandler = function (handler) {
      return set.call(utils, function (thrown, isFatal) {
        send([thrown], !!isFatal);
        // React Native's handler logs the error with console.error: the box has it already.
        inHandler = true;
        try {
          return handler(thrown, isFatal);
        } finally {
          inHandler = false;
        }
      });
    };
  }

  var utils = globalThis.ErrorUtils;
  wrap(utils);
  Object.defineProperty(globalThis, 'ErrorUtils', {
    configurable: true,
    enumerable: true,
    get: function () {
      return utils;
    },
    set: function (value) {
      utils = value;
      wrap(value);
    },
  });
});
