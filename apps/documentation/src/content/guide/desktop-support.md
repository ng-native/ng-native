---
title: What each OS has
summary: Each desktop API and macOS input, and what it does on every OS.
---

# What each OS has

The desktop APIs and macOS inputs, and what each does on every OS.

- **yes** - it works as on macOS.
- **absent** - the service's `available()` is `false`, and every call does nothing and answers its
  empty value: `[]`, `null`, `false` or nothing.
- **ignored** - the input has no effect.
- **inert** - the element draws nothing.
- Anything else says what the OS does in its place.

<!-- os-support -->

Each service's own page says the same for that service. The services from `@ng-native/expo` work
on macOS through the desktop host where their pages say so.
