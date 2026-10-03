---
__default__: patch
---

`inject(Screen).window()` in a test is the size the render's `conditions` give, and follows `engine.updateConditions()`, where it was zero by zero whatever `conditions` said.
