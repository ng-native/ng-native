---
__default__: patch
---

A Linux `deb` depends on `glib-networking`, and an `rpm` requires it, so an app installed from either follows GNOME's or KDE's proxy settings: GLib's proxy resolver reads them through that module, which the host loads at run time rather than links.
