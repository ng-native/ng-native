---
__default__: patch
---

Device tests run root effects in services created by render() on the host application's change-detection pass, including when settle() runs it.
