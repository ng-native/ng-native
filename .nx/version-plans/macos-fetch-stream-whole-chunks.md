---
__default__: patch
---

On macOS, a streamed `fetch` body now delivers each chunk whole as it arrives. Before, the desktop host held back the last one or two bytes of a chunk until the next one came, so a Server-Sent Events or NDJSON stream showed each event one event late.
