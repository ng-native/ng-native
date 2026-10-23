---
'__default__': patch
---

A stylesheet's `text-wrap: pretty` (and `text-wrap-style: pretty`, Tailwind's `text-pretty`) sets iOS's `lineBreakStrategyIOS` to `standard`, the line breaking UILabel and SwiftUI use, and `word-break: keep-all` (`break-keep`) sets it to `hangul-word`, where both were dropped as having no React Native equivalent.

`text-wrap: balance` (`text-balance`) sets Android's `textBreakStrategy` to `balanced`; iOS has no balanced breaking. `wrap`, `auto` and `stable` set each platform's default, and `word-break: normal` sets iOS's `none`. Both props are inherited, so a class on a view reaches the text inside it, and a prop bound on a `<text>` wins. `text-wrap: nowrap` and the other `word-break` values are still dropped, with a message that says what to write.
