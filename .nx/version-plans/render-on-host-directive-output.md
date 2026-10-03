---
__default__: patch
---

`render()`'s `on` hears an output a host directive forwards, and refuses a name the component has no output by with a message that names it, where both threw `TypeError: Cannot read properties of undefined (reading 'subscribe')`.

An output is named as a template binds it, so one with an alias is listened to by its alias, not by the name of the field. `mount()` takes `bindings`, which is how `on` is passed.
