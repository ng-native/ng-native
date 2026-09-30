---
__default__: patch
---

`<scroll-view>` and `<keyboard-avoiding-view>` take `contentContainerClass`, classes for their content container, matched by Tailwind and by the styles of the component they are written in.

It follows NativeWind's `contentContainerClassName`, so `<scroll-view contentContainerClass="gap-6 p-6">` pads and spaces the content without wrapping it in a view of its own. While it has a class, the content container is styled as if written in that component's template, on a device and on the web host. On `<keyboard-avoiding-view>` that container is the view `behavior="position"` moves. `contentContainerStyle` still wins over it. `HostEngine` gains `adoptScope(node, like)`, which a custom host can leave as the default no-op.
