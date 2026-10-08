---
'__default__': minor
---

ICU plurals and selects render, `i18n-` attributes keep their text, and a method shorthand in decorator metadata compiles, on `@oxc-angular/vite` 0.0.40.

`{count(), plural, =0 {...} one {...} other {...}}` and `{value, select, ...}` in a template threw on first render and now work on iOS and Android, in the source language and translated; the web host does not support them yet. `i18n-accessibilityLabel` and the other `i18n-` attributes compiled with empty source text and now carry it. `providers: [{ useValue: { attach() {} } }]` failed the build and now compiles.

**Translation files need one edit.** The placeholders for an element or a control-flow block inside a message are now named as Angular's own compiler names them, with underscores between the words: `{$STARTTAGTEXT}` is `{$START_TAG_TEXT}`, `{$CLOSETAGSCROLLVIEW}` is `{$CLOSE_TAG_SCROLL_VIEW}` and `{$STARTBLOCKIF}` is `{$START_BLOCK_IF}`. `{$INTERPOLATION}` and `{$INTERPOLATION_1}` are unchanged. A translation still using the old names is not applied and the message shows its source text. Extract again with `localize-extract` and copy the new names into each translation file.

A case of a plural or select holds text and interpolations: Angular leaves out an element inside one, such as `<text>`, with its content. A plural picks its case by the rules of `LOCALE_ID`.

`@ng-native/metro` no longer exports `assertNoBrokenMethodShorthand`.
