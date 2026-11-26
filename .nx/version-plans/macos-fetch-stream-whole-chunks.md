---
__default__: patch
---

On macOS, a streamed `fetch` body now delivers each chunk whole as it arrives. Before, the desktop host could hold back the last one or two bytes of a chunk until more data arrived or the request completed, which could delay a Server-Sent Events or NDJSON record until the next one.
