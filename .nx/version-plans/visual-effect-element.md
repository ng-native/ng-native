---
__default__: patch
---

On macOS, `<visual-effect>` from `@ng-native/components` draws one of the system's translucent materials behind its children, as an `NSVisualEffectView`: with the default `behind-window` blending, the desktop shows through it, blurred, as it does through a sidebar, without a `<split-view>`.

It takes `material` (`sidebar` by default, or another `NSVisualEffectMaterial` by name, such as `under-window-background` or `hud-window`), `blendingMode` (`behind-window` or `within-window`), `state` (`follows-window`, `active` or `inactive`) and `emphasized`, and its `border-radius` rounds the material. On Linux, iOS and Android it is a plain view.
