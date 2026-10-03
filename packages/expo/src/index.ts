/**
 * What the package exports without naming a module.
 *
 * Everything with an Expo module behind it has its own entry point - `@ng-native/expo/
 * battery.ts` and friends - so that importing haptics does not make an app install the video
 * player. What is left here is the shared machinery: the permission shape every module spells
 * identically, the signal-from-a-listener those services are built out of, and the view names.
 */
export { observed, type Observed } from './observed.ts';
export { Permission, type PermissionApi, type PermissionResponse } from './permissions.ts';
export {
  MissingModuleError,
  expoModule,
  optional,
  unavailable,
  type ModulePlatform,
} from './native.ts';
export { NATIVE_VIEWS, registerNativeViews } from './community-views.ts';
export { registerExpoUiViews } from './expo-ui.ts';
export { nativeState, type NativeState } from './native-state.ts';
export {
  EXPO_VIEWS,
  expoViewName,
  registerExpoView,
  registerExpoViews,
  type ExpoViewOptions,
} from './register-expo-view.ts';
export {
  UiAccessoryWidgetBackground,
  UiButton,
  UiCapsule,
  UiCircle,
  UiEllipse,
  UiLabel,
  UiLink,
  UiRectangle,
  UiRoundedRectangle,
  UiUnevenRoundedRectangle,
  UiZStack,
  type UiZStackAlignment,
  UiDatePicker,
  UiDivider,
  UiHost,
  UiImage,
  UiMenu,
  UiPicker,
  UiColorPicker,
  type UiColorChangeEvent,
  UiForm,
  UiChart,
  type UiChartAreaStyle,
  type UiChartBarStyle,
  type UiChartDataPoint,
  type UiChartLineStyle,
  type UiChartPieStyle,
  type UiChartPointStyle,
  type UiChartPointSymbol,
  type UiChartRectangleStyle,
  type UiChartRuleStyle,
  type UiChartType,
  UiGauge,
  UiHStack,
  UiLabeledContent,
  UiList,
  UiProgress,
  UiSection,
  UiSpacer,
  UiStepper,
  type UiStepperChangeEvent,
  UiTextField,
  type UiTextFieldChangeEvent,
  UiToggle,
  type UiToggleChangeEvent,
  UiSlider,
  type UiSliderChangeEvent,
  UiSlot,
  UiSwipeActions,
  UiText,
  UiVStack,
  type UiDateChangeEvent,
  type UiPickerOption,
  type UiModifier,
} from './expo-ui-components.ts';
export { ExpoImage, type ExpoImageContentFit, type ExpoImageSource } from './expo-image.ts';
export {
  ExpoGlass,
  ExpoGlassContainer,
  liquidGlassAvailable,
  type GlassEffectStyleConfig,
  type GlassStyle,
} from './glass.ts';
export {
  ExpoSymbol,
  type SymbolAnimationSpec,
  type SymbolResizeMode,
  type SymbolScale,
  type SymbolType,
  type SymbolWeight,
} from './symbol.ts';
export {
  SegmentedControl,
  type SegmentedControlChangeEvent,
  type SegmentedControlFont,
} from './segmented-control.ts';
