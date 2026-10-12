---
'__default__': patch
---

A DOM component's page has a `localStorage` and a `sessionStorage` on Android, where reading either threw, so web code that reads one as it starts failed the page before anything rendered.

Expo's Android web view leaves DOM storage off and answers `null` for both. The page now gets one of each kept in memory, with storage's methods (`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`), before any of its own code runs. What is stored lasts as long as the page: it is not kept between launches, as the web view's own is on iOS.
