---
__default__: patch
---

A `stackAnimation` given to `NativeNavigation.reset()` or `replace()` is now the one the new screen arrives with, on iOS and Android: `reset('/sign-in', { presentation: { stackAnimation: 'none' } })` lands with no animation. Before, it was never read, and the reset slid on iOS as a back from the screen it took away. Such a navigation is given `replaceAnimation: 'push'` unless it names its own, or its `stackAnimation` is `default`, and `reset()` and `replace()` now declare the `presentation` option. A reset to a screen still on the stack puts up no new screen, and still animates as a back from the screen it takes away.
