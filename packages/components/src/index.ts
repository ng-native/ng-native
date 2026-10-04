/**
 * The host primitives, and the platform-capability tokens they inject.
 *
 * Every element a template renders natively is a component here and must be imported by the
 * component whose template uses it, as any Angular component must. A template that uses one
 * without importing it compiles, renders a plain view, and is reported in dev builds.
 *
 * Importing this barrel evaluates decorators, so anything a Node test needs at runtime has to
 * be reached as a source file instead - see the note in `packages/integration-tests/compile.ts`.
 */
export { ActivityIndicator } from './activity-indicator.ts';
export { type AnimatedPropsHandle, type AnimationBackend } from './animation.ts';
export {
  type AccessibilityActionEvent,
  type AccessibilityActionPayload,
  type ContentSizeChangeEvent,
  type ImageErrorEvent,
  type ImageErrorPayload,
  type ImageLoadEvent,
  type ImageLoadPayload,
  type ImageProgressEvent,
  type ImageProgressPayload,
  type Insets,
  type KeyPressEvent,
  type KeyPressPayload,
  type LayoutEvent,
  type LayoutPayload,
  type OrientationChangeEvent,
  type OrientationChangePayload,
  type Point,
  type Rect,
  type ScrollEvent,
  type ScrollPayload,
  type SelectionChangeEvent,
  type SelectionChangePayload,
  type Size,
  type SwitchChangeEvent,
  type SwitchChangePayload,
  type TextInputChangeEvent,
  type TextInputChangePayload,
  type TextInputContentSizeEvent,
  type TextInputContentSizePayload,
  type TextInputEditingEvent,
  type TextInputFocusEvent,
  type TextInputFocusPayload,
  type TextInputScrollEvent,
  type TextInputScrollPayload,
  type TextLayoutEvent,
  type TextLayoutLine,
  type TextLayoutPayload,
  type TouchEvent,
  type TouchEventPayload,
} from './events.ts';
export { Image, type ImageResizeMode, type ImageSource, type ImageURISource } from './image.ts';
export { ImageBackground } from './image-background.ts';
export { InputAccessoryView } from './input-accessory-view.ts';
export {
  KEYBOARD_CONTROLLER,
  KeyboardDock,
  KeyboardLift,
  provideKeyboardController,
} from './keyboard-dock.ts';
export { KeyboardAvoidingView, type KeyboardAvoidingBehavior } from './keyboard-avoiding-view.ts';
export { Modal, type ModalOrientation, type ModalPresentationStyle } from './modal.ts';
export { NativeRef } from './native-ref.ts';
export {
  ControlBase,
  PressBehavior,
  Pressable,
  TouchableBase,
  type AndroidRipple,
  type PressEvent,
} from './pressable.ts';
export { RefreshControl } from './refresh-control.ts';
export { GradientText } from './gradient-text.ts';
export { type SafeAreaEdge, type SafeAreaEdges } from './safe-area.ts';
export { SafeAreaProvider } from './safe-area-provider.ts';
export { SafeAreaView, type SafeAreaEdgeMode } from './safe-area-view.ts';
export { type KeyboardShouldPersistTaps } from './keyboard-taps.ts';
export { ScrollView } from './scroll-view.ts';
export {
  SectionEdgeSeparator,
  SectionFooter,
  SectionHeader,
  SectionItem,
  SectionList,
  SectionSeparator,
  type SectionContext,
  type SectionEdgeSeparatorContext,
  type SectionItemContext,
  type SectionListSection,
  type SectionRow,
  type SectionSeparatorContext,
} from './section-list.ts';
export { Switch } from './switch.ts';
export { Text, type DynamicTypeRamp, type EllipsizeMode } from './text.ts';
export {
  TextInput,
  type KeyboardType,
  type ReturnKeyType,
  type SubmitBehavior,
} from './text-input.ts';
export { TouchableOpacity } from './touchable-opacity.ts';
export { optionalBoolean, optionalNumber } from './transforms.ts';
export { View } from './view.ts';
export {
  ViewBase,
  ViewBehavior,
  contributeAccessibility,
  type AccessibilityAction,
  type AccessibilityContribution,
  type AccessibilityLiveRegion,
  type AccessibilityRole,
  type Role,
  type AccessibilityState,
  type AccessibilityValue,
  type AndroidDrawable,
  type ImportantForAccessibility,
  type PointerEvents,
} from './view-base.ts';
export {
  VirtualList,
  VirtualListRow,
  VirtualListSeparator,
  type VirtualItemHeight,
  type VirtualListSeparatorContext,
  type VirtualListPadding,
  type VirtualListVisiblePosition,
  type VirtualRow,
} from './virtual-list.ts';
export { type GestureBackend, type GestureSpec, type GestureTarget } from './gesture-backend.ts';
export {
  workletScroll,
  workletStyle,
  type SharedValue,
  type WorkletBackend,
  type WorkletScrollSpec,
  type WorkletStyleSpec,
  type WorkletTarget,
} from './worklets.ts';
