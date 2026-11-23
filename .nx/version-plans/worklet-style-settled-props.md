---
__default__: patch
---

With Reanimated 4.7 or later, a `[workletStyle]` view whose values have settled no longer makes every later commit slower on iOS and Android: about a second after its values stop changing, they are committed with the view and Reanimated stops re-applying it to each commit.

Before, every view bound with `[workletStyle]` stayed in Reanimated's animated props registry for as long as it was mounted, even at rest, and Reanimated cloned each one and its ancestors on every commit. Now `@ng-native/components/reanimated` reads Reanimated's settled updates every half second while any `[workletStyle]` is bound, as Reanimated's own components do, and hands them to the new `Engine.setUiThreadProps`, which commits them last, over every rule, inline style and `styleOverride`, with no transition easing them. On iOS and Android, with Reanimated 4.7 or later, its `FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS` flag on (the default) and `USE_ANIMATION_BACKEND` off; with Reanimated 4.5 or 4.6 views stay registered as before. `WorkletBackend.bind` takes a third argument, the function those settled props are handed to.
