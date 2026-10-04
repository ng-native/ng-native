---
__default__: patch
---

A static attribute that is an input of the host's own component is no longer committed to the host view as a prop: `<app-field accessibilityLabel="Email" />` gives the label to the input, and a screen reader and `getByLabelText` find the one field rather than the field and its container. The attribute stays on the node, so a selector such as `:host([variant='primary'])` still matches, and a host binding that writes the same name is committed as before.
