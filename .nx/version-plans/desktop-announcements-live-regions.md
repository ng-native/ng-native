---
__default__: patch
---

On macOS, `AccessibilityInfo.announceForAccessibility` (and `Accessibility.announce` from `@ng-native/device`) has VoiceOver say the text, interrupting what it is saying unless `announceForAccessibilityWithOptions` asks to queue or for low priority, and `setAccessibilityFocus` moves VoiceOver, and the keyboard focus of a focusable view, to the view. A live region (`accessibilityLiveRegion` or `aria-live`, `polite` or `assertive`) announces its text each time it changes after it appears: its label, or the text of the views under it. `announcementFinished` is not sent on macOS, which reports no end to an announcement.
