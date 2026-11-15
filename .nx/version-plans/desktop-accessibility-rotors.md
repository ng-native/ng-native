---
__default__: patch
---

On macOS, VoiceOver's Headings, Links and Landmarks rotors list an app's headings, links and landmark views (`banner`, `main`, `navigation`, `complementary`, `contentinfo`, `form`, `region`) in tree order. The app's content in a window is now one group to VoiceOver, which holds the rotors. `NGN_LOG_ROTORS=1` logs each rotor's items, for checking them without a screen reader.
