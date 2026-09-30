---
__default__: patch
---

`<scroll-view>` takes `contentContainerClass`, classes for the view that holds its children, matched by Tailwind and by the styles of the component it is written in.

It follows NativeWind's `contentContainerClassName`, so `<scroll-view contentContainerClass="gap-6 p-6">` pads and spaces the content without wrapping it in a view of its own. Once it has a class, the content container is styled as if written in that component's template, on a device and on the web host. `contentContainerStyle` still wins over it. `HostEngine` gains `adoptScope(node, like)`, which a custom host can leave as the default no-op.
