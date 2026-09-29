---
__default__: patch
---

The template targets iOS and Android only: its `app.json` names both as its `platforms`, and the
web favicon, its `web` settings and `web-build/` in `.gitignore` are gone. The Angular CLI and Nx
generators name the same platforms. Angular Native components render in a browser through
`@ng-native/web`, which is set up separately.
