---
__default__: patch
---

`@ng-native/tailwind` has `macos:` and `desktop:` variants, beside `ios:` and `android:`, in `native.css` and the Tailwind 3 preset; `desktop:` is macOS today. On native, `hover:` and `hovered:` take `web.css`'s form, so they match a real `:hover` as well as the pressed state and `data-hover`, and `focus-visible:` matches `:focus-visible` and `data-focus` rather than every `:focus`. A focused text field matches `:focus-visible` however it was focused, as in a browser, so a ring on a field still shows on iOS and Android; a focused element that is not a text field matches it on macOS when the keyboard focused it. `font-mono` and an HTML `code` element are in Menlo on macOS.
