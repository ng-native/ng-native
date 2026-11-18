---
__default__: patch
---

The desktop host has a GTK 4 backend: `native/scripts/build.sh --backend gtk` builds `ngn-linux`, which runs an exported bundle in the windows the app opens, drawing views (backgrounds, borders, corner radii, shadows, opacity, transforms and clipping), Pango text and single-line text inputs, taking pointer input and typing into text inputs, and giving each view its accessible role, label, description and states through GTK's own accessibility. It builds on Linux against GTK 4.10 or later and libadwaita 1.4 or later, and on macOS against Homebrew's GTK. Linux is not yet an app target: no Metro platform, scroll views, images or menus.
