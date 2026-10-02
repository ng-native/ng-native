---
__default__: patch
---

`<dom-component>` acts only on messages from the page it loaded, and the Metro preset's dev server looks for a lazy chunk from outside the project only in the server root and the watch folders, rather than in every directory up to the root of the disk.

A page the web view is taken to by a link cannot fire the app's outputs or be sent its changed inputs. The inputs given before the page loads are still handed to whatever page the web view shows, so they should hold nothing secret. A message that is not JSON is dropped instead of throwing, and an output named after an object member such as `constructor` does nothing.

The dev server also refuses a chunk name that decodes to a `..` segment, a root or a backslash.
