---
__default__: patch
---

`render()` and `rerender()` reject when `inputs` names an input the component does not have, with a message that names it, the component and the inputs it has, where Angular only logged `NG0303` and the component rendered with its defaults.
