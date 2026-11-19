---
__default__: patch
---

On macOS `align-items: baseline` (and `alignItems: 'baseline'`) now lines text up by its first baseline, as on iOS, rather than by its top, and `<text>` sends `(textLayout)` with its lines, each where it is drawn, where it sent nothing before.
