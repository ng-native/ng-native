---
__default__: patch
---

CSS animations played natively that end in the same frame now share one commit, rather than each committing the whole tree as it ends.

Where the platform drives the engine, an animation's end marks its view and the next frame commits it, so a list of labels fading in together costs one commit as they finish. An engine with no host to schedule a frame still commits as each one ends.
