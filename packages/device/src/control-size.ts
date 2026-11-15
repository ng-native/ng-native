/**
 * How a native control is sized: AppKit's control sizes on macOS, and on iOS UIKit's button sizes
 * for `<native-button>`. Android and the web ignore it. Unset is `regular`. Taken by `<native-button>`, `<switch>`,
 * `<activity-indicator>`, `<segmented-control>`, `<date-time-picker>` and `<search-field>`.
 */
export type ControlSize = 'mini' | 'small' | 'regular' | 'large';
