---
__default__: patch
---

On macOS, a camera recording that AVFoundation refuses to start, because no video frame has arrived yet, now fails with AVFoundation's reason instead of ending the app.

Before, the movie output's exception went uncaught on the camera's queue. Now `recordAsync` rejects with that reason, the session is left as it was, and another recording can be asked for.
