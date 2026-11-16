---
__default__: patch
---

Interaction observers now hear native gestures attached with `[gesture]` on iOS and Android: a tap as a `click`, a long press as a `long-press`, a fling or a fast pan as a `swipe`, and a slower pan, a pinch or a rotation as the new `gesture` type.

Each such event names the gesture in a new `gesture` field and carries the element the gesture is attached to, with the `component` around it as a pressed control has. A pan or a fling adds `direction` and `distance`, and a pinch `scale`; a gesture's `direction` is the way the finger moved, and a pan that ends where it started has a `distance` of 0 and no `direction`. Only a gesture that ends successfully is reported, once, and with no observer registered a gesture does no reporting work. `[trackGesture]="false"` keeps an element's gestures out.
