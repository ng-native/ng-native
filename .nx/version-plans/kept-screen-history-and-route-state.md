---
__default__: patch
---

A navigation to a page under a screen further down the stack now drops the history entries of the screens it took off, and a failed or refused Back, or a failed navigation back to a kept screen, no longer leaves history or a route's observables changed.

Before, `Router.navigate()` to a page under a kept screen, such as `/compose/step` from a screen pushed over `/compose`, left the entries of the screens it took off behind the new one. A Back through history that failed, or that a guard refused, wrote the old url over the entry it went back to, with the default `canceledNavigationResolution: 'replace'`; that entry is now put back and the one left shows again. A failed navigation that changed a route's params, query params, fragment, url or data left the new values in that route's observables, and in inputs bound to them with `withComponentInputBinding()`, after its snapshot was put back; the old values are now sent again.
