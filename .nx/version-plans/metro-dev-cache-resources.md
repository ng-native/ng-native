---
'__default__': patch
---

A dev server started again shows a template or stylesheet edited while it was stopped. A component with both a `templateUrl` and a `styleUrl` kept the old one until its other file was saved or the cache was cleared, because the cached module of the one put back what it was compiled with.
