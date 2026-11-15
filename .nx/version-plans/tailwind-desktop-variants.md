---
__default__: patch
---

`@ng-native/tailwind` has `macos:` and `desktop:` variants, beside `ios:` and `android:`, in `native.css` and the Tailwind 3 preset; `desktop:` is macOS today. On native, `hover:` and `hovered:` take `web.css`'s form, so they match a real `:hover` as well as the pressed state and `data-hover`, and `focus-visible:` matches `:focus-visible` and `data-focus`. On macOS that is a focused text field, or another element the keyboard focused; on iOS and Android it is still every focused element. `font-mono` and an HTML `code` element are in Menlo on macOS.
