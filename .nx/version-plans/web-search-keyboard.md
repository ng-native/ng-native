---
__default__: patch
---

On the web, a `<text-input>` with `keyboardType` `web-search` now sets `inputmode="search"`, so a phone's browser shows its search keyboard and search key.

The field stays a `type="text"` field, and the enter key stays with `returnKeyType`. The `email-address` and `url` keyboards still set only `inputmode`, deliberately: in Chromium `type="email"` has no selection API, trims the value the app sets and hides the spaces a user types from its value, and `type="url"` trims the value the app sets.
