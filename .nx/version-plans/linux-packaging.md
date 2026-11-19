---
__default__: patch
---

`ng-native-desktop package` takes `--arch x64|arm64|all`: on macOS, `x64` or `arm64` keeps that one architecture of the universal app, and `all`, the default, keeps both.

It also takes `--os macos|linux`, defaulting to the machine's OS. `--os linux` packages for Linux, one package per architecture, as `--format app` (a runnable folder and its `.tar.gz`), `deb` (depending on GTK 4.10, libadwaita 1.4 and glibc 2.34), `rpm` or `flatpak` (on the GNOME 50 runtime: a `.flatpak` bundle, an OSTree repository and the manifest). Each installs a desktop entry, the Expo `icon`, when `expo.icon` is set, scaled to each hicolor size up to its own, and AppStream metainfo, with the name, version and description from app.json and `--license` (which rpm and flatpak need), `--homepage`, `--categories` and `--maintainer` (which deb needs) for the rest. `NGN_GPG_KEY` signs the `.tar.gz`, the rpm and the Flatpak repository. `app` and `deb` need only Node, and `gpg` when `NGN_GPG_KEY` signs an `app` archive; `rpm` and `flatpak` run `rpmbuild` and `flatpak-builder`, in a container through Docker or Podman where they are not installed. A Linux package needs a Linux host, which is built only on Linux, for the machine's architecture, until prebuilt Linux hosts are published.
