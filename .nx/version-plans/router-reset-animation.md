---
__default__: patch
---

A `stackAnimation` given to `NativeNavigation.reset()` or `replace()` is now the one the new screen arrives with, on iOS and Android: `reset('/', { presentation: { stackAnimation: 'none' } })` lands with no animation. Before, it was never read, and the reset slid on iOS as a back from the screen it took away. Such a screen is given `replaceAnimation: 'push'` unless the navigation names its own, and `reset()` and `replace()` now declare the `presentation` option.
