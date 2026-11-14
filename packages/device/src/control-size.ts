/**
 * How a native control is sized: AppKit's control sizes on macOS, and UIKit's on iOS 26 and later.
 * Android and the web ignore it. Unset is `regular`. Taken by `<native-button>`, `<switch>`,
 * `<activity-indicator>`, `<segmented-control>`, `<date-time-picker>` and `<search-field>`.
 */
export type ControlSize = 'mini' | 'small' | 'regular' | 'large';
