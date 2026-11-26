---
__default__: patch
---

Metro's transform cache is now kept per project, so a second checkout or copy of an app no longer reuses the first one's transforms and bundles a DOM component from the other copy's path.

Metro keys a cached transform by the file's path relative to the project and its content, in a temp directory every project shares. A DOM component's reference is an absolute file URL, so the second copy pointed at the first copy's file. `expo export:embed` then failed, or packaged the other copy's version of the component. The first bundle of each copy after upgrading starts with a cold cache.
