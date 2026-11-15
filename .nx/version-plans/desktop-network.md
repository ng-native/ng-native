---
__default__: patch
---

On macOS `Network` answers from the desktop host's `NgNativeNetwork`, over Network.framework's path monitor: `connected` and `reachable` are true when the Mac has a route to the network, `type` names the interface it uses (`wifi`, `ethernet`, `cellular` or `other`, and `none` without a route), and `status()` follows each change.
