/**
 * The `@expo/ui` view each `ui-*` element is. A file of its own, with no import, so the script
 * that checks these against `@expo/ui` (`scripts/expo-ui-native-props.mjs`) can load it with plain
 * Node, which cannot read the decorators `expo-ui.ts`'s imports reach.
 */

/** Element name -> the `ExpoUI` view on iOS and on Android. Null where the platform has no such. */
export const EXPO_UI_VIEWS: Readonly<Record<string, readonly [string | null, string | null]>> = {
  'accessory-widget-background': ['AccessoryWidgetBackgroundView', null],
  alert: ['AlertView', 'AlertDialogView'],
  'animated-visibility': [null, 'AnimatedVisibilityView'],
  'assist-chip': [null, 'AssistChipView'],
  background: ['BackgroundView', null],
  badge: [null, 'BadgeView'],
  'badged-box': [null, 'BadgedBoxView'],
  'basic-alert-dialog': [null, 'BasicAlertDialogView'],
  'bottom-sheet': ['BottomSheetView', 'ModalBottomSheetView'],
  /**
   * The same sheet under a second name, for `UiBottomSheet`: its own element is `ui-bottom-sheet`,
   * and a component's template takes its own selector to be the component again.
   */
  'bottom-sheet-view': ['BottomSheetView', 'ModalBottomSheetView'],
  button: ['Button', 'Button'],
  capsule: ['CapsuleView', null],
  chart: ['ChartView', null],
  checkbox: [null, 'CheckboxView'],
  circle: ['CircleView', null],
  'color-picker': ['ColorPickerView', null],
  'confirmation-dialog': ['ConfirmationDialogView', null],
  'content-unavailable': ['ContentUnavailableView', null],
  'context-menu': ['ContextMenu', null],
  'control-group': ['ControlGroupView', null],
  'date-picker': ['DatePickerView', 'DateTimePickerView'],
  'date-picker-dialog': [null, 'DatePickerDialogView'],
  'disclosure-group': ['DisclosureGroupView', null],
  divider: ['DividerView', 'HorizontalDividerView'],
  'docked-search-bar': [null, 'DockedSearchBarView'],
  ellipse: ['EllipseView', null],
  'dropdown-menu-item': [null, 'DropdownMenuItemView'],
  'exposed-dropdown-menu': [null, 'ExposedDropdownMenuView'],
  'exposed-dropdown-menu-box': [null, 'ExposedDropdownMenuBoxView'],
  'filter-chip': [null, 'FilterChipView'],
  'floating-action-button': [null, 'FloatingActionButtonView'],
  'flow-row': [null, 'FlowRowView'],
  form: ['FormView', null],
  gauge: ['GaugeView', null],
  'glass-effect-container': ['GlassEffectContainerView', null],
  grid: ['GridView', null],
  'grid-row': ['GridRowView', null],
  group: ['GroupView', null],
  'horizontal-floating-toolbar': [null, 'HorizontalFloatingToolbarView'],
  host: ['HostView', 'HostView'],
  hstack: ['HStackView', 'RowView'],
  icon: [null, 'IconView'],
  image: ['ImageView', 'ImageView'],
  'input-chip': [null, 'InputChipView'],
  label: ['LabelView', null],
  list: ['ListView', null],
  'labeled-content': ['LabeledContentView', null],
  'lazy-hstack': ['LazyHStackView', 'LazyRowView'],
  'lazy-vstack': ['LazyVStackView', 'LazyColumnView'],
  link: ['LinkView', null],
  'list-item': [null, 'ListItemView'],
  mask: ['MaskView', null],
  menu: ['MenuView', 'DropdownMenuView'],
  'multi-choice-segmented-button-row': [null, 'MultiChoiceSegmentedButtonRowView'],
  'navigation-bar': [null, 'NavigationBarView'],
  'navigation-bar-item': [null, 'NavigationBarItemView'],
  'navigation-stack': ['NavigationStackView', null],
  overlay: ['OverlayView', null],
  pager: [null, 'HorizontalPagerView'],
  /** On Android, the box `UiPicker` draws Compose's controls in: see there. */
  picker: ['PickerView', 'BoxView'],
  'plain-tooltip': [null, 'PlainTooltipView'],
  popover: ['PopoverView', null],
  progress: ['ProgressView', 'LinearProgressIndicatorView'],
  'pull-to-refresh-box': [null, 'PullToRefreshBoxView'],
  'radio-button': [null, 'RadioButtonView'],
  rectangle: ['RectangleView', null],
  'rich-tooltip': [null, 'RichTooltipView'],
  'rounded-rectangle': ['RoundedRectangleView', null],
  'scroll-view-component': ['ScrollViewComponent', null],
  'search-bar': [null, 'SearchBarView'],
  section: ['SectionView', null],
  'secure-field': ['SecureFieldView', null],
  'segmented-button': [null, 'SegmentedButtonView'],
  shape: [null, 'ShapeView'],
  'share-link': ['ShareLinkView', null],
  'single-choice-segmented-button-row': [null, 'SingleChoiceSegmentedButtonRowView'],
  slider: ['SliderView', 'SliderView'],
  /**
   * Both platforms, though it looks Android-only at a glance.
   *
   * SwiftUI's `SlotView` lives in a top-level `SlotView.tsx` rather than in a directory of its
   * own, which is how it was missed. Twenty SwiftUI components put their children through one:
   * a picker's options, a section's rows, a labelled content's value. Without it those children
   * mount into a plain `UIView` and SwiftUI refuses them, which is a red screen on iOS and an
   * empty control everywhere else.
   */
  slot: ['SlotView', 'SlotView'],
  snackbar: [null, 'SnackbarView'],
  'snackbar-host': [null, 'SnackbarHostView'],
  spacer: ['SpacerView', 'SpacerView'],
  stepper: ['StepperView', null],
  'suggestion-chip': [null, 'SuggestionChipView'],
  surface: [null, 'SurfaceView'],
  'swipe-actions': ['SwipeActionsView', null],
  'sync-toggle': ['SyncToggleView', 'SyncSwitchView'],
  tab: ['TabView', null],
  text: ['TextView', 'TextView'],
  'text-field': ['TextFieldView', null],
  'time-picker-dialog': [null, 'TimePickerDialogView'],
  toggle: ['ToggleView', 'SwitchView'],
  toolbar: ['ToolbarView', null],
  /** A slot under another name: SwiftUI's toolbar reads each of its items from a slot named `item`. */
  'toolbar-item': ['SlotView', null],
  'tooltip-box': [null, 'TooltipBoxView'],
  'tri-state-checkbox': [null, 'TriStateCheckboxView'],
  'uneven-rounded-rectangle': ['UnevenRoundedRectangleView', null],
  'vertical-slider': [null, 'VerticalSliderView'],
  /**
   * The other way round from `host`: views of the app's own inside SwiftUI or Compose content,
   * as a context menu's trigger or a sheet's body. `@expo/ui` calls it `RNHostView`.
   */
  'view-host': ['RNHostView', 'RNHostView'],
  vstack: ['VStackView', 'ColumnView'],
  zstack: ['ZStackView', 'BoxView'],
};
