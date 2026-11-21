---
__default__: patch
---

An app a device run relaunched, after the one before it exited or stopped answering, is now sent Vitest's start, with its config, before any file, where before its first file failed with `Cannot read property 'viteModuleRunner' of undefined`.
