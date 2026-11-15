/**
 * `@expo/ui` on macOS: each SwiftUI view ng-native commits on iOS, and what the desktop host draws
 * it as. The desktop host implements a view in SwiftUI inside an NSHostingView, under the iOS name
 * and with the iOS props, wherever SwiftUI has the view on macOS; the rest are absent, with the
 * reason. `registerExpoUiViews('macos')` registers the ones in v1 and leaves the absent ones plain
 * views.
 *
 * The host's own list of the views it draws is `kExpoUIViews` in
 * `packages/desktop/native/core/src/expo-ui.cpp`, which a test holds to this table.
 */

/** Drawn on macOS as this SwiftUI view or modifier. */
export interface ExpoUiOnMac {
  readonly swiftUI: string;
}

/** Not drawn on macOS, and why. */
export interface ExpoUiAbsentOnMac {
  readonly absent: string;
}

/** The iOS view name (`EXPO_UI_VIEWS`' first column) -> what it is on macOS. */
export const EXPO_UI_MACOS: Readonly<Record<string, ExpoUiOnMac | ExpoUiAbsentOnMac>> = {
  AccessoryWidgetBackgroundView: {
    absent: "WidgetKit's AccessoryWidgetBackground is for the iOS Lock Screen and watchOS only",
  },
  AlertView: { swiftUI: 'alert(_:isPresented:actions:message:)' },
  BackgroundView: { swiftUI: 'background(alignment:content:)' },
  BottomSheetView: { swiftUI: 'sheet(isPresented:onDismiss:content:)' },
  Button: { swiftUI: 'Button' },
  CapsuleView: { swiftUI: 'Capsule' },
  ChartView: { swiftUI: 'Chart' },
  CircleView: { swiftUI: 'Circle' },
  ColorPickerView: { swiftUI: 'ColorPicker' },
  ConfirmationDialogView: {
    swiftUI: 'confirmationDialog(_:isPresented:titleVisibility:actions:message:)',
  },
  ContentUnavailableView: { swiftUI: 'ContentUnavailableView' },
  ContextMenu: { swiftUI: 'contextMenu(menuItems:)' },
  ControlGroupView: { swiftUI: 'ControlGroup' },
  DatePickerView: { swiftUI: 'DatePicker' },
  DisclosureGroupView: { swiftUI: 'DisclosureGroup' },
  DividerView: { swiftUI: 'Divider' },
  EllipseView: { swiftUI: 'Ellipse' },
  FormView: { swiftUI: 'Form' },
  GaugeView: { swiftUI: 'Gauge' },
  GlassEffectContainerView: { swiftUI: 'GlassEffectContainer' },
  GridView: { swiftUI: 'Grid' },
  GridRowView: { swiftUI: 'GridRow' },
  GroupView: { swiftUI: 'Group' },
  HostView: { swiftUI: 'NSHostingView' },
  HStackView: { swiftUI: 'HStack' },
  ImageView: { swiftUI: 'Image' },
  LabelView: { swiftUI: 'Label' },
  LabeledContentView: { swiftUI: 'LabeledContent' },
  LazyHStackView: { swiftUI: 'LazyHStack' },
  LazyVStackView: { swiftUI: 'LazyVStack' },
  LinkView: { swiftUI: 'Link' },
  ListView: { swiftUI: 'List' },
  MaskView: { swiftUI: 'mask(alignment:_:)' },
  MenuView: { swiftUI: 'Menu' },
  NavigationStackView: { swiftUI: 'NavigationStack' },
  OverlayView: { swiftUI: 'overlay(alignment:content:)' },
  PickerView: { swiftUI: 'Picker' },
  PopoverView: { swiftUI: 'popover(isPresented:attachmentAnchor:arrowEdge:content:)' },
  ProgressView: { swiftUI: 'ProgressView' },
  RectangleView: { swiftUI: 'Rectangle' },
  RNHostView: { swiftUI: 'NSViewRepresentable' },
  RoundedRectangleView: { swiftUI: 'RoundedRectangle' },
  ScrollViewComponent: { swiftUI: 'ScrollView' },
  SectionView: { swiftUI: 'Section' },
  SecureFieldView: { swiftUI: 'SecureField' },
  ShareLinkView: { swiftUI: 'ShareLink' },
  SliderView: { swiftUI: 'Slider' },
  SlotView: { swiftUI: 'the content of the view it is a slot of' },
  SpacerView: { swiftUI: 'Spacer' },
  StepperView: { swiftUI: 'Stepper' },
  SwipeActionsView: { swiftUI: 'swipeActions(edge:allowsFullSwipe:content:)' },
  SyncToggleView: {
    absent:
      'it reads and writes its state through react-native-worklets, which has no native part on macOS; use ToggleView',
  },
  TabView: { swiftUI: 'TabView' },
  TextFieldView: { swiftUI: 'TextField' },
  TextView: { swiftUI: 'Text' },
  ToggleView: { swiftUI: 'Toggle' },
  ToolbarView: {
    absent:
      "a SwiftUI toolbar on macOS belongs to the window's NSToolbar, which the desktop host builds from the screen's native header",
  },
  UnevenRoundedRectangleView: { swiftUI: 'UnevenRoundedRectangle' },
  VStackView: { swiftUI: 'VStack' },
  ZStackView: { swiftUI: 'ZStack' },
};

/** Whether the desktop host draws the iOS view `name` on macOS. */
export function expoUiOnMac(name: string): boolean {
  const entry = EXPO_UI_MACOS[name];
  return entry !== undefined && 'swiftUI' in entry;
}
