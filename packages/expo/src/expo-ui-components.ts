/**
 * Typed components for the `@expo/ui` views an app reaches for most, named and shaped as SwiftUI's.
 *
 * `EXPO_UI_VIEWS` makes every view reachable by name, and a name is all the renderer needs. What a
 * name cannot give is a type: under strict templates an unknown element is an error, and so is
 * each prop on it. These are the same elements, claimed by a component whose inputs carry the
 * props' types and whose host bindings pass each one straight to the node, so nothing changes at
 * runtime. An unset input stays `undefined` and never reaches native.
 *
 * Events are declared as outputs so that `$event` is typed. SwiftUI's events are never emitted:
 * Angular binds a template's `(dateChange)` to the output *and* to the element, and it is the
 * element's own event that arrives, once. Emitting from a host listener as well would deliver it
 * twice; a host listener of the same name as the output listens to the output itself and recurses.
 * So subscribe in a template, not to the output in code.
 *
 * Where Compose names a prop or an event differently, a component sends Android its own names and
 * emits the output from a host listener for Compose's event, which SwiftUI never sends. Only a few
 * do: the toggle, slider, button, progress, stacks and slot, and the date picker.
 *
 * Only the views and props an app has needed are here; the rest stay names, as before. Add a view
 * when a template wants it typed, from `@expo/ui`'s own props for it.
 *
 * Still register the names with `registerExpoUiViews`: the component types the element, the
 * registration is what makes it commit as the SwiftUI or Compose view.
 */
import {
  Component,
  DestroyRef,
  forwardRef,
  ElementRef,
  InjectionToken,
  Injector,
  type Signal,
  afterNextRender,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { NativeState } from './native-state.ts';
import {
  Engine,
  type EngineNode,
  HostEngine,
  type HostNode,
  type NativeSyntheticEvent,
  keepNativeView,
  nativePlatform,
} from '@ng-native/fabric';
import { optional } from './native.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';
import { UiBottomSheetContent } from './ui-bottom-sheet-content.ts';
import { type UiBottomSheetPresentedEvent, UiBottomSheetView } from './ui-bottom-sheet-view.ts';

/** One SwiftUI modifier, as `@expo/ui`'s modifier functions build them: `{ $type: 'frame', ... }`. */
export interface UiModifier {
  readonly $type: string;
  readonly [key: string]: unknown;
}

/**
 * Says the component's host is the `@expo/ui` view its selector is registered as. A component of
 * an app's own with a `ui-` selector does not, and its host is a plain view.
 */
function nativeView(): true {
  keepNativeView(inject(ElementRef).nativeElement);
  return true;
}

/**
 * The bridge from Yoga's layout to SwiftUI's; every other `ui-*` view goes inside one.
 * `matchContents` sizes the host to the SwiftUI content rather than the other way round, on both
 * axes or on the ones named. Native reads a flag per axis, which is what this splits it into, as
 * `@expo/ui`'s own `Host` does: without them the host has no size of its own, and the control
 * drawn in it spills outside it, where it can be seen but not touched or read by VoiceOver.
 */
@Component({
  selector: 'ui-host',
  template: '<ng-content />',
  host: {
    '[matchContentsVertical]': 'matchVertical()',
    '[matchContentsHorizontal]': 'matchHorizontal()',
    '[ignoreSafeArea]': 'ignoreSafeArea()',
    '[useViewportSizeMeasurement]': 'useViewportSizeMeasurement()',
  },
})
export class UiHost {
  protected readonly nativeView = nativeView();
  readonly matchContents = input<
    boolean | { readonly vertical?: boolean; readonly horizontal?: boolean }
  >();
  protected readonly matchVertical = computed(() => {
    const match = this.matchContents();
    return typeof match === 'object' ? match.vertical : match;
  });
  protected readonly matchHorizontal = computed(() => {
    const match = this.matchContents();
    return typeof match === 'object' ? match.horizontal : match;
  });
  readonly ignoreSafeArea = input<'all' | 'keyboard' | 'container'>();
  readonly useViewportSizeMeasurement = input<boolean>(undefined, { transform: optionalBoolean });
}

/** A SwiftUI `Menu`. Its trigger is the `label` or a `<ui-slot name="label">`; its items are children. */
@Component({
  selector: 'ui-menu',
  template: '<ng-content />',
  host: {
    '[label]': 'label()',
    '[systemImage]': 'systemImage()',
    '[accessibilityLabel]': 'accessibilityLabel()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiMenu {
  protected readonly nativeView = nativeView();
  readonly label = input<string>();
  /** An SF Symbol name. */
  readonly systemImage = input<string>();
  readonly accessibilityLabel = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * Views of the app's own inside SwiftUI or Compose content: the way back from a `ui-host`. What
 * it holds is laid out by the engine, as anywhere else, and takes presses as anywhere else, so a
 * row drawn with the app's own components can be a context menu's trigger or a sheet's body.
 *
 * It holds one element. `matchContents` sizes it to that element, both ways: the element needs a
 * width of its own, since nothing here stretches it. Without `matchContents` it fills what the
 * SwiftUI or Compose view around it offers, which inside a view sized to its content is a width
 * and no height.
 */
@Component({
  selector: 'ui-view-host',
  template: '<ng-content />',
  host: {
    '[matchContents]': 'matchContents()',
    '[expoInternalSizeFromChildren]': 'matchContents()',
    '[layoutRoot]': 'layoutRoot()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiViewHost {
  protected readonly nativeView = nativeView();
  readonly matchContents = input<boolean>(undefined, { transform: optionalBoolean });
  /**
   * For content presented in a window of its own, a sheet or a popover, where nothing above it
   * delivers its touches: it then takes them itself, and is measured from itself.
   */
  readonly layoutRoot = input<boolean>(undefined, { transform: optionalBoolean });
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `contextMenu`: the menu a long press on its trigger opens, with the trigger lifted
 * over the dimmed screen. iOS only.
 *
 * Its content is three slots: `<ui-slot name="trigger">` is what is always shown,
 * `<ui-slot name="items">` holds the `ui-button`s, `ui-divider`s and `ui-section`s of the menu, and
 * `<ui-slot name="preview">`, when there is one, is shown above the open menu in place of the
 * trigger. All three are SwiftUI content, as everything inside a `ui-host` is.
 */
@Component({
  selector: 'ui-context-menu',
  template: '<ng-content />',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiContextMenu {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `Button`, as a menu item or on its own, or Compose's on Android, which draws `label` as
 * text inside it. `systemImage` and `role` are SwiftUI's alone. A `close` button with no label and
 * no content is the system's own close button, from iOS 26.
 */
@Component({
  selector: 'ui-button',
  imports: [forwardRef(() => UiText)],
  template: `@if (android && label()) {
      <ui-text [text]="label()" />
    }
    <ng-content />`,
  host: {
    '(buttonPressed)': 'android && buttonPress.emit($event)',
    '[label]': 'label()',
    '[systemImage]': 'systemImage()',
    '[role]': 'role()',
    '[target]': 'target()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiButton {
  protected readonly nativeView = nativeView();
  protected readonly android = nativePlatform() === 'android';
  readonly label = input<string>();
  /** An SF Symbol name. */
  readonly systemImage = input<string>();
  readonly role = input<'default' | 'cancel' | 'destructive' | 'close'>();
  /**
   * In a home-screen widget's or a Live Activity's layout, what a tap on it hands the app: see
   * `@ng-native/expo/widget` and `@ng-native/expo/live-activity`.
   */
  readonly target = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
  readonly buttonPress = output<NativeSyntheticEvent<Record<string, never>>>();
}

/** A SwiftUI `Divider`, or Compose's `HorizontalDivider`: a separator between groups of items. */
@Component({
  selector: 'ui-divider',
  template: '',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiDivider {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * Content for a named slot of its parent view, such as a menu's `label`. `extraProps` is what
 * the slot tells its parent about itself: a `ui-swipe-actions` group's `edge` and
 * `allowsFullSwipe`.
 */
@Component({
  selector: 'ui-slot',
  template: '<ng-content />',
  host: {
    '[name]': 'android ? undefined : name()',
    '[slotName]': 'android ? name() : undefined',
    '[extraProps]': 'extraProps()',
  },
})
export class UiSlot {
  protected readonly nativeView = nativeView();
  protected readonly android = nativePlatform() === 'android';
  readonly name = input.required<string>();
  readonly extraProps = input<Readonly<Record<string, unknown>>>();
}

/**
 * A SwiftUI `List`: rows as SwiftUI lays them out, which is what lets a row take the system's own
 * swipe actions through `ui-swipe-actions`.
 */
@Component({
  selector: 'ui-list',
  template: '<ng-content />',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiList {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * The system's swipe actions on a list row, iOS only. The first child is the row; the actions go
 * in `<ui-slot name="actions" [extraProps]="{ edge: 'trailing', allowsFullSwipe: true }">`, one
 * slot per edge, as `ui-button`s.
 */
@Component({
  selector: 'ui-swipe-actions',
  template: '<ng-content />',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiSwipeActions {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** What `ui-slider` sends as the thumb moves: its new value. */
export type UiSliderChangeEvent = NativeSyntheticEvent<{ readonly value: number }>;

/**
 * A SwiftUI `Slider`, or Compose's on Android. `valueChanged` reports each new value as the thumb
 * moves; note the d, which SwiftUI's event has and `@expo/ui`'s React prop does not.
 */
@Component({
  selector: 'ui-slider',
  template: '',
  host: {
    '[value]': 'value()',
    '[min]': 'min()',
    '[max]': 'max()',
    '[step]': 'android ? undefined : stepSize()',
    '[steps]': 'android ? stepsBetween() : undefined',
    '[modifiers]': 'modifiers()',
    '(valueChange)': 'android && valueChanged.emit($event)',
  },
})
export class UiSlider {
  protected readonly nativeView = nativeView();
  readonly value = input<number>(undefined, { transform: optionalNumber });
  readonly min = input<number>(undefined, { transform: optionalNumber });
  readonly max = input<number>(undefined, { transform: optionalNumber });
  /** How many steps the range is divided into; none moves the thumb continuously. */
  readonly steps = input<number>(undefined, { transform: optionalNumber });
  readonly modifiers = input<readonly UiModifier[]>();
  readonly valueChanged = output<UiSliderChangeEvent>();

  protected readonly android = nativePlatform() === 'android';
  /** A whole number of steps, which is all Compose can draw. */
  private readonly wholeSteps = computed(() => {
    const steps = Math.round(this.steps() ?? 0);
    return steps > 0 ? steps : undefined;
  });
  /** SwiftUI takes a step size, and draws 0 to 1 unless it has both ends. */
  protected readonly stepSize = computed(() => {
    const steps = this.wholeSteps();
    const min = this.min();
    const max = this.max();
    return steps && (min !== undefined && max !== undefined ? max - min : 1) / steps;
  });
  /** Compose takes the number of points between the ends. */
  protected readonly stepsBetween = computed(() => {
    const steps = this.wholeSteps();
    return steps && steps - 1;
  });
}

/**
 * A SwiftUI `VStack`, or Compose's `Column` on Android, centred, as SwiftUI's is, unless `alignment`
 * says otherwise. Without `spacing`, SwiftUI puts its own default spacing between children and Compose
 * puts none.
 */
@Component({
  selector: 'ui-vstack',
  template: '<ng-content />',
  host: {
    '[alignment]': 'android ? undefined : alignment()',
    '[spacing]': 'android ? undefined : spacing()',
    '[verticalArrangement]': 'android ? spacedBy(spacing()) : undefined',
    '[horizontalAlignment]': 'android ? composeAlignment(alignment()) : undefined',
    '[modifiers]': 'modifiers()',
  },
})
export class UiVStack {
  protected readonly nativeView = nativeView();
  readonly alignment = input<'leading' | 'center' | 'trailing'>();
  readonly spacing = input<number>(undefined, { transform: optionalNumber });
  readonly modifiers = input<readonly UiModifier[]>();

  protected readonly android = nativePlatform() === 'android';
  protected readonly spacedBy = spacedBy;
  protected composeAlignment(alignment: 'leading' | 'center' | 'trailing' | undefined) {
    return alignment === 'leading' ? 'start' : alignment === 'trailing' ? 'end' : 'center';
  }
}

/** A SwiftUI `Image`: an SF Symbol by `systemName`, or a picture by `uiImage` URL. */
@Component({
  selector: 'ui-image',
  template: '',
  host: {
    '[systemName]': 'systemName()',
    '[uiImage]': 'uiImage()',
    '[size]': 'size()',
    '[color]': 'color()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiImage {
  protected readonly nativeView = nativeView();
  readonly systemName = input<string>();
  readonly uiImage = input<string>();
  readonly size = input<number>(undefined, { transform: optionalNumber });
  readonly color = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `Text`, or Compose's on Android. Its text is what is written inside it,
 * `<ui-text>Us {{ score }}</ui-text>`, as `<text>` takes its own, or `text`, which wins over it.
 */
@Component({
  selector: 'ui-text',
  template: '<ng-content />',
  host: { '[text]': 'text()', '[modifiers]': 'modifiers()' },
})
export class UiText {
  protected readonly nativeView = nativeView();
  readonly text = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * What `ui-date-picker` sends when the user picks: the chosen moment, which SwiftUI reports in
 * milliseconds since the epoch.
 */
export type UiDateChangeEvent = NativeSyntheticEvent<{ readonly date: number | string }>;

/**
 * Listen for one of a `ui-*` view's own events from inside its component. Not a host listener:
 * one named as an output listens to the output itself, and see the note at the top of this file
 * for why the outputs are never emitted.
 */
function listen(event: string, handle: (payload: Record<string, unknown>) => void): void {
  const node = inject(ElementRef).nativeElement as HostNode;
  const engine = node.host ?? inject(HostEngine);
  const stop = engine.setEventListener(node, event, (raw) =>
    handle((raw as NativeSyntheticEvent<Record<string, unknown>>)?.nativeEvent ?? {}),
  );
  inject(DestroyRef).onDestroy(stop);
}

/**
 * A Compose event as the SwiftUI one it stands in for: its payload renamed, and stopping it stops the
 * event it came from.
 */
function withNativeEvent<T>(event: NativeSyntheticEvent, nativeEvent: T): NativeSyntheticEvent<T> {
  return {
    nativeEvent,
    target: event.target,
    stopPropagation: () => event.stopPropagation(),
    isPropagationStopped: () => event.isPropagationStopped(),
  };
}

/** The caller's modifiers, with SwiftUI's `disabled` added while the field is. */
function withDisabled(
  modifiers: readonly UiModifier[] | undefined,
  disabled: boolean,
): readonly UiModifier[] | undefined {
  return disabled ? [...(modifiers ?? []), { $type: 'disabled', disabled: true }] : modifiers;
}

/**
 * A date picker: SwiftUI's `DatePicker` on iOS, Compose's on Android.
 *
 * A Signal Forms field as it stands - `<ui-date-picker [formField]="f.arrival" />` - through its
 * `value` model, a `Date` (or null). The two platforms take and report a date differently, and
 * this is where that difference ends: SwiftUI is handed `selection` as ISO text and reports
 * `dateChange`; Compose is handed `initialDate` in milliseconds and reports `dateSelected`. Either
 * way the model gets a `Date`. A `disabled` field adds SwiftUI's `disabled` modifier. SwiftUI's
 * picker always shows a date, today when the field is empty, and the date it reports as it appears
 * is not taken as the user's; an optional date is best asked for behind a button that shows the
 * picker once the user wants to give one.
 *
 * `selection` is still accepted as ISO text, for a picker bound without a form.
 */
@Component({
  selector: 'ui-date-picker',
  template: '',
  host: {
    '[title]': 'title()',
    '[selection]': 'resolvedSelection()',
    '[initialDate]': 'initialDate()',
    '[displayedComponents]': 'displayedComponents()',
    '[range]': 'range()',
    '[accessibilityLabel]': 'accessibilityLabel()',
    '[modifiers]': 'resolvedModifiers()',
  },
})
export class UiDatePicker {
  protected readonly nativeView = nativeView();
  readonly title = input<string>();
  readonly selection = input<string>();
  readonly displayedComponents = input<readonly ('date' | 'hourAndMinute')[]>();
  readonly range = input<{ readonly start?: string; readonly end?: string }>();
  readonly accessibilityLabel = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
  /** The picked date: what `[formField]` binds. */
  readonly value = model<Date | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The user picked, which is when a form shows a field's errors: a picker has no blur. */
  readonly touch = output<void>();
  readonly dateChange = output<UiDateChangeEvent>();

  private readonly android = nativePlatform() === 'android';

  protected readonly resolvedSelection = computed(() =>
    this.android ? undefined : (this.selection() ?? this.value()?.toISOString()),
  );
  protected readonly initialDate = computed(() =>
    this.android ? (this.value()?.getTime() ?? null) : undefined,
  );
  protected readonly resolvedModifiers = computed(() =>
    this.android ? this.modifiers() : withDisabled(this.modifiers(), this.disabled()),
  );

  /**
   * SwiftUI's picker cannot be empty: it shows today, and reports that as a change the moment it
   * appears. Taken as the user's choice, an empty date field would fill itself in, pass
   * `required` and mark the form dirty before anyone touched it. So the first report, while the
   * field is empty and the picker has only just appeared, is the picker describing itself.
   */
  private readonly appeared = Date.now();
  private settled = false;

  constructor() {
    listen(this.android ? 'topDateSelected' : 'topDateChange', ({ date }) => {
      if (typeof date !== 'string' && typeof date !== 'number') return;
      const describingItself =
        !this.settled && this.value() === null && Date.now() - this.appeared < APPEARING_MS;
      this.settled = true;
      if (describingItself) return;
      this.value.set(new Date(date));
      this.touch.emit();
    });
  }
}

/** How long after a date picker appears its first report is taken to be about itself. */
const APPEARING_MS = 1000;

/** One choice in a `ui-picker`: what the field is set to, and what the user reads. */
export interface UiPickerOption {
  readonly value: string | number;
  readonly label: string;
}

/**
 * A SwiftUI `Picker`, iOS only, as a Signal Forms field: `<ui-picker [options]="rooms"
 * [formField]="f.room" />`. `options` draws the choices, each tagged with its value, which is the
 * content slot and `tag` modifiers `@expo/ui` otherwise wants written out by hand; children still
 * work for anything richer. `pickerStyle` is SwiftUI's (`menu`, `segmented`, `wheel`, `inline`).
 */
@Component({
  selector: 'ui-picker',
  imports: [UiSlot, UiText],
  template: `
    @if (options(); as options) {
      <ui-slot name="content">
        @for (option of options; track option.value) {
          <ui-text [text]="option.label" [modifiers]="tags().get(option.value)" />
        }
      </ui-slot>
    }
    <ng-content />
  `,
  host: {
    '[label]': 'label()',
    '[systemImage]': 'systemImage()',
    '[selection]': 'value()',
    '[modifiers]': 'resolvedModifiers()',
  },
})
export class UiPicker {
  protected readonly nativeView = nativeView();
  readonly label = input<string>();
  /** An SF Symbol name. */
  readonly systemImage = input<string>();
  readonly options = input<readonly UiPickerOption[]>();
  readonly pickerStyle = input<
    'automatic' | 'menu' | 'segmented' | 'wheel' | 'inline' | 'palette'
  >();
  readonly modifiers = input<readonly UiModifier[]>();
  /** The chosen option's value: what `[formField]` binds. */
  readonly value = model<string | number | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The user picked, which is when a form shows a field's errors: a picker has no blur. */
  readonly touch = output<void>();
  readonly selectionChange =
    output<NativeSyntheticEvent<{ readonly selection: string | number }>>();

  /** Each option's `tag`, one array per value, so a pass hands native the same objects. */
  protected readonly tags = computed(
    () =>
      new Map(
        (this.options() ?? []).map((option) => [
          option.value,
          [{ $type: 'tag', tag: option.value }] as readonly UiModifier[],
        ]),
      ),
  );

  protected readonly resolvedModifiers = computed(() => {
    const style = this.pickerStyle();
    const own = style
      ? [{ $type: 'pickerStyle', style }, ...(this.modifiers() ?? [])]
      : this.modifiers();
    return withDisabled(own, this.disabled());
  });

  constructor() {
    listen('topSelectionChange', ({ selection }) => {
      if (typeof selection !== 'string' && typeof selection !== 'number') return;
      this.value.set(selection);
      this.touch.emit();
    });
  }
}

/** What `ui-toggle` sends when it is switched: whether it is now on. */
export type UiToggleChangeEvent = NativeSyntheticEvent<{ readonly isOn: boolean }>;

/**
 * A SwiftUI `Toggle`, or Compose's `Switch` on Android. `isOnChange` reports each flip. Bound to
 * `isOn`, it shows what `isOn` says; without it, it switches itself. `label` is SwiftUI's alone.
 */
@Component({
  selector: 'ui-toggle',
  template: '<ng-content />',
  host: {
    '[isOn]': 'android ? undefined : isOn()',
    '[value]': 'android ? (isOn() ?? switchedOn()) : undefined',
    '[label]': 'label()',
    '[modifiers]': 'modifiers()',
    '(checkedChange)': 'android && checked($event)',
  },
})
export class UiToggle {
  protected readonly nativeView = nativeView();
  readonly isOn = input<boolean>(undefined, { transform: optionalBoolean });
  readonly label = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
  readonly isOnChange = output<UiToggleChangeEvent>();

  protected readonly android = nativePlatform() === 'android';
  /** What Compose's switch shows without `isOn`: SwiftUI's keeps this itself, Compose's does not. */
  protected readonly switchedOn = signal(false);
  protected checked(event: NativeSyntheticEvent<{ readonly value: boolean }>): void {
    this.switchedOn.set(event.nativeEvent.value);
    this.isOnChange.emit(withNativeEvent(event, { isOn: event.nativeEvent.value }));
  }
}

/** What `ui-stepper` sends as it is stepped: its new value. */
export type UiStepperChangeEvent = NativeSyntheticEvent<{ readonly value: number }>;

/** A SwiftUI `Stepper`, between `min` and `max` by `step`. */
@Component({
  selector: 'ui-stepper',
  template: '<ng-content />',
  host: {
    '[value]': 'value()',
    '[min]': 'min()',
    '[max]': 'max()',
    '[step]': 'step()',
    '[label]': 'label()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiStepper {
  protected readonly nativeView = nativeView();
  readonly value = input<number>(undefined, { transform: optionalNumber });
  readonly min = input<number>(undefined, { transform: optionalNumber });
  readonly max = input<number>(undefined, { transform: optionalNumber });
  readonly step = input<number>(undefined, { transform: optionalNumber });
  readonly label = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
  readonly valueChange = output<UiStepperChangeEvent>();
}

/** What `ui-text-field` sends as it is typed into: the text so far. */
export type UiTextFieldChangeEvent = NativeSyntheticEvent<{ readonly value: string }>;

/**
 * A SwiftUI `TextField`. `text` is where it keeps what is typed, a `nativeState('')`: the field
 * writes to it on the UI thread, and `textChange` reports each change.
 */
@Component({
  selector: 'ui-text-field',
  template: '',
  host: {
    '[text]': 'text()?.id',
    '[placeholder]': 'placeholder()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiTextField {
  protected readonly nativeView = nativeView();
  readonly text = input<NativeState<string> | null>();
  readonly placeholder = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
  readonly textChange = output<UiTextFieldChangeEvent>();
}

/** What `ui-color-picker` sends when a colour is picked: the colour, as hex. */
export type UiColorChangeEvent = NativeSyntheticEvent<{ readonly value: string }>;

/** A SwiftUI `ColorPicker`. `selection` is a colour as hex. */
@Component({
  selector: 'ui-color-picker',
  template: '',
  host: {
    '[selection]': 'selection()',
    '[label]': 'label()',
    '[supportsOpacity]': 'supportsOpacity()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiColorPicker {
  protected readonly nativeView = nativeView();
  readonly selection = input<string>();
  readonly label = input<string>();
  readonly supportsOpacity = input<boolean>(undefined, { transform: optionalBoolean });
  readonly modifiers = input<readonly UiModifier[]>();
  readonly selectionChange = output<UiColorChangeEvent>();
}

/** A SwiftUI `Gauge`: `value` between `min` and `max`, drawn as `type` says. */
@Component({
  selector: 'ui-gauge',
  template: '<ng-content />',
  host: {
    '[value]': 'value()',
    '[min]': 'min()',
    '[max]': 'max()',
    '[type]': 'type()',
    '[currentValueLabel]': 'currentValueLabel()',
    '[minimumValueLabel]': 'minimumValueLabel()',
    '[maximumValueLabel]': 'maximumValueLabel()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiGauge {
  protected readonly nativeView = nativeView();
  readonly value = input<number>(undefined, { transform: optionalNumber });
  readonly min = input<number>(undefined, { transform: optionalNumber });
  readonly max = input<number>(undefined, { transform: optionalNumber });
  readonly type = input<string>();
  readonly currentValueLabel = input<string>();
  readonly minimumValueLabel = input<string>();
  readonly maximumValueLabel = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** One point of a `ui-chart`: `x`, a label or a number, against `y`, with a colour of its own. */
export interface UiChartDataPoint {
  readonly x: string | number;
  readonly y: number;
  readonly color?: string;
}

/** How a `ui-chart` draws its points: `pie` needs iOS 17. */
export type UiChartType = 'line' | 'point' | 'bar' | 'area' | 'pie' | 'rectangle';

/** The symbol a `ui-chart` marks a point with. */
export type UiChartPointSymbol = 'circle' | 'square' | 'diamond';

/** A line chart's line: its dashes, width, colour, and the symbol at each point. */
export interface UiChartLineStyle {
  readonly dashArray?: readonly number[];
  readonly width?: number;
  readonly pointStyle?: UiChartPointSymbol;
  readonly pointSize?: number;
  readonly color?: string;
}

/** A point chart's symbol and its size. */
export interface UiChartPointStyle {
  readonly pointStyle?: UiChartPointSymbol;
  readonly pointSize?: number;
}

/** An area chart's fill. */
export interface UiChartAreaStyle {
  readonly color?: string;
}

/** A bar chart's bars: their corner radius and width. */
export interface UiChartBarStyle {
  readonly cornerRadius?: number;
  readonly width?: number;
}

/** A pie chart's slices: `innerRadius` from 0, a full pie, to 0.5 for a donut, and the gap between. */
export interface UiChartPieStyle {
  readonly innerRadius?: number;
  readonly angularInset?: number;
}

/** A rectangle chart's colour and corner radius. */
export interface UiChartRectangleStyle {
  readonly color?: string;
  readonly cornerRadius?: number;
}

/** The lines `referenceLines` draws across a `ui-chart`. */
export interface UiChartRuleStyle {
  readonly color?: string;
  readonly lineWidth?: number;
  readonly dashArray?: readonly number[];
}

/**
 * A Swift Charts chart of `data`, drawn as `type` says, iOS only, as Compose has no chart. Each
 * style applies to its own type alone; `referenceLines` are drawn across it in `ruleStyle`.
 * `showLegend` shows only when no point has a colour of its own.
 */
@Component({
  selector: 'ui-chart',
  template: '',
  host: {
    '[data]': 'data()',
    '[type]': 'type()',
    '[showGrid]': 'showGrid()',
    '[animate]': 'animate()',
    '[showLegend]': 'showLegend()',
    '[referenceLines]': 'referenceLines()',
    '[lineStyle]': 'lineStyle()',
    '[pointStyle]': 'pointStyle()',
    '[areaStyle]': 'areaStyle()',
    '[barStyle]': 'barStyle()',
    '[pieStyle]': 'pieStyle()',
    '[rectangleStyle]': 'rectangleStyle()',
    '[ruleStyle]': 'ruleStyle()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiChart {
  protected readonly nativeView = nativeView();
  readonly data = input.required<readonly UiChartDataPoint[]>();
  readonly type = input<UiChartType>();
  readonly showGrid = input<boolean>(undefined, { transform: optionalBoolean });
  readonly animate = input<boolean>(undefined, { transform: optionalBoolean });
  readonly showLegend = input<boolean>(undefined, { transform: optionalBoolean });
  readonly referenceLines = input<readonly UiChartDataPoint[]>();
  readonly lineStyle = input<UiChartLineStyle>();
  readonly pointStyle = input<UiChartPointStyle>();
  readonly areaStyle = input<UiChartAreaStyle>();
  readonly barStyle = input<UiChartBarStyle>();
  readonly pieStyle = input<UiChartPieStyle>();
  readonly rectangleStyle = input<UiChartRectangleStyle>();
  readonly ruleStyle = input<UiChartRuleStyle>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `ProgressView`: a bar filled to `value`, from 0 to 1, or a spinner without one. On
 * Android, Compose's `LinearProgressIndicator`, a moving bar rather than a spinner without a value.
 */
@Component({
  selector: 'ui-progress',
  template: '',
  host: {
    '[value]': 'android ? undefined : value()',
    '[progress]': 'android ? value() : undefined',
    '[modifiers]': 'modifiers()',
  },
})
export class UiProgress {
  protected readonly nativeView = nativeView();
  protected readonly android = nativePlatform() === 'android';
  readonly value = input<number>(undefined, { transform: optionalNumber });
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `HStack`, or Compose's `Row` on Android, centred, as SwiftUI's is, unless `alignment`
 * says otherwise. Compose has no `firstTextBaseline`, and centres instead. Without `spacing`, SwiftUI
 * puts its own default spacing between children and Compose puts none.
 */
@Component({
  selector: 'ui-hstack',
  template: '<ng-content />',
  host: {
    '[alignment]': 'android ? undefined : alignment()',
    '[spacing]': 'android ? undefined : spacing()',
    '[horizontalArrangement]': 'android ? spacedBy(spacing()) : undefined',
    '[verticalAlignment]': 'android ? composeAlignment(alignment()) : undefined',
    '[modifiers]': 'modifiers()',
  },
})
export class UiHStack {
  protected readonly nativeView = nativeView();
  readonly alignment = input<'top' | 'center' | 'bottom' | 'firstTextBaseline'>();
  readonly spacing = input<number>(undefined, { transform: optionalNumber });
  readonly modifiers = input<readonly UiModifier[]>();

  protected readonly android = nativePlatform() === 'android';
  protected readonly spacedBy = spacedBy;
  protected composeAlignment(
    alignment: 'top' | 'center' | 'bottom' | 'firstTextBaseline' | undefined,
  ) {
    return alignment === 'top' || alignment === 'bottom' ? alignment : 'center';
  }
}

function spacedBy(spacing: number | undefined) {
  return spacing === undefined ? undefined : { spacedBy: Math.round(spacing) };
}

/** A SwiftUI `Spacer`: the room left over in its stack. */
@Component({
  selector: 'ui-spacer',
  template: '',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiSpacer {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** Where `ui-zstack` puts its layers, as SwiftUI names it. */
export type UiZStackAlignment =
  | 'center'
  | 'leading'
  | 'trailing'
  | 'top'
  | 'bottom'
  | 'topLeading'
  | 'topTrailing'
  | 'bottomLeading'
  | 'bottomTrailing';

/** The same place, as Compose's `Box` names it. */
const CONTENT_ALIGNMENT: Record<UiZStackAlignment, string> = {
  center: 'center',
  leading: 'centerStart',
  trailing: 'centerEnd',
  top: 'topCenter',
  bottom: 'bottomCenter',
  topLeading: 'topStart',
  topTrailing: 'topEnd',
  bottomLeading: 'bottomStart',
  bottomTrailing: 'bottomEnd',
};

/**
 * A SwiftUI `ZStack`: its children drawn over one another, the first at the back. On Android,
 * Compose's `Box`, centred, as SwiftUI's is, unless `alignment` says otherwise.
 */
@Component({
  selector: 'ui-zstack',
  template: '<ng-content />',
  host: {
    '[alignment]': 'android ? undefined : alignment()',
    '[contentAlignment]': 'android ? contentAlignment[alignment() ?? "center"] : undefined',
    '[modifiers]': 'modifiers()',
  },
})
export class UiZStack {
  protected readonly nativeView = nativeView();
  readonly alignment = input<UiZStackAlignment>();
  readonly modifiers = input<readonly UiModifier[]>();

  protected readonly android = nativePlatform() === 'android';
  protected readonly contentAlignment = CONTENT_ALIGNMENT;
}

/** A SwiftUI `Rectangle`, filling the space it is given. Colour it with `foregroundStyle`. */
@Component({
  selector: 'ui-rectangle',
  template: '',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiRectangle {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `RoundedRectangle`, its corners rounded by `cornerRadius`. */
@Component({
  selector: 'ui-rounded-rectangle',
  template: '',
  host: { '[cornerRadius]': 'cornerRadius()', '[modifiers]': 'modifiers()' },
})
export class UiRoundedRectangle {
  protected readonly nativeView = nativeView();
  readonly cornerRadius = input<number>(undefined, { transform: optionalNumber });
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `UnevenRoundedRectangle`: a rectangle with a radius of its own for each corner. */
@Component({
  selector: 'ui-uneven-rounded-rectangle',
  template: '',
  host: {
    '[topLeadingRadius]': 'topLeadingRadius()',
    '[topTrailingRadius]': 'topTrailingRadius()',
    '[bottomLeadingRadius]': 'bottomLeadingRadius()',
    '[bottomTrailingRadius]': 'bottomTrailingRadius()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiUnevenRoundedRectangle {
  protected readonly nativeView = nativeView();
  readonly topLeadingRadius = input<number>(undefined, { transform: optionalNumber });
  readonly topTrailingRadius = input<number>(undefined, { transform: optionalNumber });
  readonly bottomLeadingRadius = input<number>(undefined, { transform: optionalNumber });
  readonly bottomTrailingRadius = input<number>(undefined, { transform: optionalNumber });
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `Capsule`: a rectangle with fully rounded ends. */
@Component({
  selector: 'ui-capsule',
  template: '',
  host: { '[cornerStyle]': 'cornerStyle()', '[modifiers]': 'modifiers()' },
})
export class UiCapsule {
  protected readonly nativeView = nativeView();
  readonly cornerStyle = input<'continuous' | 'circular'>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `Circle`, as large as fits the space it is given. */
@Component({
  selector: 'ui-circle',
  template: '',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiCircle {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `Ellipse`, filling the space it is given. */
@Component({
  selector: 'ui-ellipse',
  template: '',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiEllipse {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * WidgetKit's `AccessoryWidgetBackground`: the system's backdrop for a lock screen widget, the
 * translucent disc or panel behind its content.
 */
@Component({
  selector: 'ui-accessory-widget-background',
  template: '',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiAccessoryWidgetBackground {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `Label`: a title beside an SF Symbol. */
@Component({
  selector: 'ui-label',
  template: '',
  host: {
    '[title]': 'title()',
    '[systemImage]': 'systemImage()',
    '[color]': 'color()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiLabel {
  protected readonly nativeView = nativeView();
  readonly title = input<string>();
  /** An SF Symbol name. */
  readonly systemImage = input<string>();
  readonly color = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `Link`: opens `destination`, a URL, when tapped. It shows `label`, or the views
 * written inside it. In a widget, a link is how a tap opens the app at a deep link.
 */
@Component({
  selector: 'ui-link',
  template: '<ng-content />',
  host: {
    '[destination]': 'destination()',
    '[label]': 'label()',
    '[modifiers]': 'modifiers()',
  },
})
export class UiLink {
  protected readonly nativeView = nativeView();
  readonly destination = input.required<string>();
  readonly label = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `LabeledContent`: a label, and its content beside it. */
@Component({
  selector: 'ui-labeled-content',
  imports: [UiSlot],
  template: '<ui-slot name="content"><ng-content /></ui-slot>',
  host: { '[label]': 'label()', '[modifiers]': 'modifiers()' },
})
export class UiLabeledContent {
  protected readonly nativeView = nativeView();
  readonly label = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `Form`: settings-style grouped rows. */
@Component({
  selector: 'ui-form',
  template: '<ng-content />',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiForm {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** A SwiftUI `Section` of a form or a list, under `title`. */
@Component({
  selector: 'ui-section',
  imports: [UiSlot],
  template: '<ui-slot name="content"><ng-content /></ui-slot>',
  host: { '[title]': 'title()', '[modifiers]': 'modifiers()' },
})
export class UiSection {
  protected readonly nativeView = nativeView();
  readonly title = input<string>();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `Group`, iOS only: its children as they are, with no layout of its own. What it is for
 * is `modifiers` that belong to several views at once, or to content that takes none itself, as a
 * sheet's presentation modifiers go on a group around a `ui-view-host`.
 */
@Component({
  selector: 'ui-group',
  template: '<ng-content />',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiGroup {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * A SwiftUI `NavigationStack`, iOS only: the bar a `ui-toolbar` inside it puts its items in, and
 * that a `navigationTitle` modifier on its content titles.
 */
@Component({
  selector: 'ui-navigation-stack',
  template: '<ng-content />',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiNavigationStack {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/**
 * SwiftUI's `toolbar`, iOS only. Its children are the view the toolbar belongs to, and its items go
 * in `<ui-slot name="content">`, each a `ui-toolbar-item`. It shows in the bar of the
 * `ui-navigation-stack` around it.
 */
@Component({
  selector: 'ui-toolbar',
  template: '<ng-content />',
  host: { '[modifiers]': 'modifiers()' },
})
export class UiToolbar {
  protected readonly nativeView = nativeView();
  readonly modifiers = input<readonly UiModifier[]>();
}

/** Where a `ui-toolbar-item` sits, as SwiftUI's `ToolbarItemPlacement` names them. */
export type UiToolbarItemPlacement =
  | 'automatic'
  | 'principal'
  | 'navigation'
  | 'primaryAction'
  | 'secondaryAction'
  | 'status'
  | 'confirmationAction'
  | 'cancellationAction'
  | 'destructiveAction'
  | 'keyboard'
  | 'topBarLeading'
  | 'topBarTrailing'
  | 'topBarPinnedTrailing'
  | 'largeTitle'
  | 'bottomBar';

/**
 * One item of a `ui-toolbar`, SwiftUI's `ToolbarItem`: a `ui-button`, or a `ui-text` as a title
 * with `placement="principal"`. Unplaced, SwiftUI places it. A placement the OS does not have is
 * read as `automatic`.
 *
 * Written inside a `ui-bottom-sheet` it goes in the sheet's own toolbar, which is how a sheet
 * shows the system's close button.
 */
@Component({
  selector: 'ui-toolbar-item',
  template: '<ng-content />',
  host: { '[name]': '"item"', '[extraProps]': 'extraProps()' },
})
export class UiToolbarItem {
  protected readonly nativeView = nativeView();
  readonly placement = input<UiToolbarItemPlacement>();
  /** How readily the item gives up its place when the bar runs out of room, from iOS 27. */
  readonly visibilityPriority = input<'automatic' | 'low' | 'high'>();

  /** What the slot tells the toolbar about itself: only what is set, so SwiftUI decides the rest. */
  protected readonly extraProps = computed(() => {
    const placement = this.placement();
    const visibilityPriority = this.visibilityPriority();
    if (!placement && !visibilityPriority) return undefined;
    return { ...(placement && { placement }), ...(visibilityPriority && { visibilityPriority }) };
  });
}

/**
 * A height a SwiftUI sheet rests at, as `@expo/ui`'s `PresentationDetent`: about half the screen,
 * all of it, a fraction of it from 0 to 1, or a height in points.
 */
export type UiPresentationDetent =
  'medium' | 'large' | { readonly fraction: number } | { readonly height: number };

/** The detents of a sheet given none and not sized to its content. */
const HALF_AND_FULL: readonly UiPresentationDetent[] = ['medium', 'large'];

/** The functions `@expo/ui` defines on Compose's sheet, called with the view's tag as `this`. */
export interface UiBottomSheetViewFunctions {
  /** Slides the sheet away, answering once it has gone. */
  hide?(this: { nativeTag: number }): Promise<void>;
}

/** The window's width as the engine knows it, or undefined before the platform has said. */
function windowWidth(): Signal<number | undefined> {
  const node = inject(ElementRef).nativeElement as HostNode;
  const engine = (node.host ?? inject(HostEngine)) as Partial<
    Pick<Engine, 'viewport' | 'watchViewport'>
  >;
  const read = () => engine.viewport?.width || undefined;
  const width = signal(read());
  const stop = engine.watchViewport?.(() => width.set(read()));
  if (stop) inject(DestroyRef).onDestroy(stop);
  return width;
}

/**
 * A sheet that slides up from the bottom of the screen, opened from any component: SwiftUI's on
 * iOS, Material's on Android.
 *
 * ```html
 * <ui-bottom-sheet [(open)]="sorting" fitToContents>
 *   <app-sort-options (done)="sorting.set(false)" />
 * </ui-bottom-sheet>
 * ```
 *
 * `open` presents and dismisses it, and is written back when the user dismisses it. Its content is
 * what is written inside it, the app's own components, in the tree while the sheet is on screen.
 *
 * A `ui-toolbar-item` written inside it is not content: on iOS it goes in a toolbar of the sheet's
 * own, in a bar across its top, which is where the system's close button belongs.
 *
 * ```html
 * <ui-bottom-sheet [(open)]="sorting">
 *   <ui-toolbar-item placement="cancellationAction">
 *     <ui-button role="close" (buttonPress)="sorting.set(false)" />
 *   </ui-toolbar-item>
 *   <app-sort-options />
 * </ui-bottom-sheet>
 * ```
 *
 * Compose's sheet has no toolbar, so Android draws no item. Nor does an iOS build whose `@expo/ui`
 * is older than 57.0.20, which Expo Go's can be: it warns, and shows the sheet without one.
 *
 * The two platforms drive a sheet differently, and this is where that difference ends. SwiftUI's
 * stays in the tree and is presented by `isPresented`, reporting `isPresentedChange` and
 * `dismiss`. Compose's shows for as long as it is in the tree, and reports `dismissRequest`.
 *
 * Unlike the other components here, the element this is mounted on is a plain view, which takes
 * no room and needs no `ui-host` around it. The sheet is inside it, wrapped as `@expo/ui`'s own
 * React component wraps one: a `ui-host`, the sheet, on iOS a `ui-group` that carries the
 * presentation modifiers, and a `ui-view-host` holding the one view the content goes in. With
 * toolbar items, the view host is in a `ui-toolbar` in a `ui-navigation-stack`, under the group.
 */
@Component({
  selector: 'ui-bottom-sheet',
  imports: [
    UiBottomSheetContent,
    UiBottomSheetView,
    UiGroup,
    UiHost,
    UiNavigationStack,
    UiSlot,
    UiToolbar,
    UiViewHost,
  ],
  template: `
    <ng-template #content><ng-content /></ng-template>
    @if (swiftUI) {
      <ui-host style="position: absolute" pointerEvents="none" [style.width.px]="width()">
        <ui-bottom-sheet-view
          #sheet
          [isPresented]="open()"
          [fitToContents]="fits()"
          (isPresentedChange)="presented($event)"
          (dismiss)="gone($event)"
        >
          @if (mounted()) {
            <ui-group [modifiers]="presentation()">
              @if (toolbar()) {
                <ui-navigation-stack>
                  <ui-toolbar>
                    <ui-view-host layoutRoot [matchContents]="fits() || undefined">
                      <ui-bottom-sheet-content [style]="body()" [content]="content" />
                    </ui-view-host>
                    <ui-slot name="content"><ng-content select="ui-toolbar-item" /></ui-slot>
                  </ui-toolbar>
                </ui-navigation-stack>
              } @else {
                <ui-view-host layoutRoot [matchContents]="fits() || undefined">
                  <ui-bottom-sheet-content [style]="body()" [content]="content" />
                </ui-view-host>
              }
            </ui-group>
          }
        </ui-bottom-sheet-view>
      </ui-host>
    } @else if (mounted()) {
      <ui-host style="position: absolute" pointerEvents="none" [style.width.px]="width()">
        <ui-bottom-sheet-view
          #sheet
          [showDragHandle]="showDragIndicator()"
          [skipPartiallyExpanded]="fits()"
          (dismissRequest)="dismissRequested($event)"
        >
          <ui-view-host layoutRoot [matchContents]="fits() || undefined">
            <ui-bottom-sheet-content [style]="body()" [content]="content" />
          </ui-view-host>
        </ui-bottom-sheet-view>
      </ui-host>
    }
  `,
  host: { '[style.position]': '"absolute"' },
})
export class UiBottomSheet {
  /**
   * The functions of Compose's sheet, none of them on iOS, or null where `@expo/ui` is not in the
   * build and there is no sheet. Overridden in a test to hide a sheet without a device.
   */
  static readonly SOURCE = new InjectionToken<UiBottomSheetViewFunctions | null>(
    'angular-native.bottomSheetSource',
    {
      factory: () =>
        optional(() => {
          const core = require('expo-modules-core') as typeof import('expo-modules-core');
          const module = core.requireOptionalNativeModule<{
            ViewPrototypes?: Record<string, UiBottomSheetViewFunctions>;
          }>('ExpoUI');
          return module ? (module.ViewPrototypes?.['ExpoUI_ModalBottomSheetView'] ?? {}) : null;
        }),
    },
  );

  /**
   * Whether the build has SwiftUI's toolbar. `@expo/ui` has had it since 57.0.20, and Expo Go has
   * the version its SDK shipped with. A SwiftUI view under one the build lacks is a crash, so a
   * sheet there leaves its toolbar out. Overridden in a test.
   */
  static readonly TOOLBAR = new InjectionToken<boolean>('angular-native.bottomSheetToolbar', {
    factory: () => {
      const expo = (
        globalThis as { expo?: { getViewConfig?(module: string, view: string): unknown } }
      ).expo;
      return ['NavigationStackView', 'ToolbarView'].every(
        (view) => optional(() => expo?.getViewConfig?.('ExpoUI', view)) != null,
      );
    },
  });

  private readonly functions = inject(UiBottomSheet.SOURCE);
  private readonly toolbarInBuild = inject(UiBottomSheet.TOOLBAR);
  private readonly engine = inject(Engine, { optional: true });
  private readonly injector = inject(Injector);
  private readonly sheet = viewChild<unknown, ElementRef<EngineNode>>('sheet', {
    read: ElementRef,
  });

  /** Whether the sheet is on screen. Written back as false when the user dismisses it. */
  readonly open = model(false);
  /**
   * The sheet is as tall as its content. Without it the sheet rests at half the screen's height
   * and drags up to all of it. Read as the sheet opens. A sheet with a toolbar on iOS is not
   * sized to its content: it rests at its `detents`, or at half and full height.
   */
  readonly fitToContents = input(false, { transform: booleanAttribute });
  /**
   * The heights the sheet rests at, iOS only: SwiftUI's `presentationDetents`. Compose's sheet has
   * a half and a full height and no others, so Android takes no notice of this. On iOS a sheet
   * given detents rests at them rather than at the height of its content, whatever `fitToContents`
   * says, as `@expo/ui`'s own sheets do. None, or an empty list, is the sheet without them.
   */
  readonly detents = input<readonly UiPresentationDetent[]>();
  /** Whether the grabber shows at the top of the sheet. */
  readonly showDragIndicator = input(true, { transform: booleanAttribute });
  /**
   * The sheet has finished closing, whether the user dismissed it or `open` was set false: the
   * moment another sheet or a dialog can be presented.
   */
  readonly dismissed = output<void>();

  /** The toolbar items written inside the sheet, which give it a bar to hold them. */
  private readonly toolbarItems = contentChildren(UiToolbarItem);
  /** Whether the sheet has a toolbar: it has items for one, and the build has the views. */
  protected readonly toolbar = computed(
    () => this.toolbarInBuild && this.toolbarItems().length > 0,
  );

  /** SwiftUI's sheet stays in the tree; anywhere else it is there while it shows. */
  protected readonly swiftUI = nativePlatform() === 'ios';
  protected readonly width = windowWidth();

  /**
   * Whether the content is in the tree: from when the sheet opens until it has gone, which is
   * after `open` turns false, so that it slides away with its content still in it.
   */
  protected readonly mounted = linkedSignal<boolean, boolean>({
    source: this.open,
    computation: (open, previous) => open || (previous?.value ?? false),
  });

  /**
   * Whether the sheet is sized to its content, as it opened: a view host takes its sizing once,
   * as it mounts. SwiftUI's sheet is not where it has detents to rest at, nor where it has a
   * toolbar: a navigation stack fills what it is given, and the bar is no part of the content.
   * A toolbar that comes or goes while the sheet is open is followed, since the view host is made
   * again around it.
   */
  protected readonly fits = computed(() => {
    this.mounted();
    const toolbar = this.toolbar();
    return untracked(
      () => this.fitToContents() && !(this.swiftUI && (this.detents()?.length || toolbar)),
    );
  });

  /**
   * SwiftUI reads how a sheet is presented from modifiers on its content, not from props. The
   * detents of a sheet not sized to its content are followed while it is open.
   */
  protected readonly presentation = computed<readonly UiModifier[]>(() => [
    this.fits()
      ? { $type: 'presentationSizing', sizing: 'fitted' }
      : {
          $type: 'presentationDetents',
          detents: this.detents()?.length ? this.detents() : HALF_AND_FULL,
        },
    {
      $type: 'presentationDragIndicator',
      visibility: this.showDragIndicator() ? 'visible' : 'hidden',
    },
  ]);

  /**
   * The one view a view host holds. Sized to its content it needs a width of its own, the
   * window's; otherwise it fills the height the sheet gives it.
   */
  protected readonly body = computed(() =>
    this.fits() ? { width: this.width() } : { flexGrow: 1, height: 0 },
  );

  /** Whether `open` has turned false on a sheet that has yet to go. */
  private closing = false;
  /** Whether Compose is sliding the sheet away. */
  private hiding = false;

  constructor() {
    effect(() => {
      if (!this.open()) untracked(() => this.close());
    });
    if (this.swiftUI && !this.toolbarInBuild) {
      const warned = effect(() => {
        if (!this.toolbarItems().length) return;
        console.warn(
          '[angular-native] A ui-toolbar-item in a ui-bottom-sheet needs @expo/ui 57.0.20 or ' +
            'later in the native build. This build has no SwiftUI toolbar, as Expo Go may not, ' +
            'so the sheet is shown without the item.',
        );
        warned.destroy();
      });
    }
  }

  protected presented(event: UiBottomSheetPresentedEvent): void {
    if (!this.own(event)) return;
    const isPresented: unknown = event.nativeEvent?.isPresented;
    if (typeof isPresented === 'boolean') this.open.set(isPresented);
  }

  protected dismissRequested(event: NativeSyntheticEvent): void {
    if (this.own(event)) this.open.set(false);
  }

  /**
   * SwiftUI has finished dismissing the sheet. After a swipe it says so before it reports that the
   * sheet is no longer presented, so a sheet that has gone while `open`, and was not closing, is
   * one the user dismissed.
   */
  protected gone(event: NativeSyntheticEvent): void {
    if (!this.own(event)) return;
    if (!this.closing) this.open.set(false);
    this.finish();
  }

  /**
   * Whether an event is this sheet's own, which it then stops. Events bubble, so a `dismiss` from
   * a modal in the content arrives here too, and the sheet's own would go on to a listener around
   * it.
   */
  private own(event: NativeSyntheticEvent): boolean {
    const target = event.target;
    if (target != null && target !== this.sheet()?.nativeElement) return false;
    event.stopPropagation();
    return true;
  }

  /**
   * `open` turned false. SwiftUI dismisses its sheet on the prop, and says when it has gone.
   * Compose shows a sheet for as long as it is in the tree, so one taken out is gone at once:
   * its `hide` slides it away first, as `@expo/ui`'s own component calls it before unmounting.
   */
  private close(): void {
    if (!this.mounted()) return;
    // No `@expo/ui` in the build: no sheet is there to slide away, or to say that it has.
    if (!this.functions) return this.finish();
    this.closing = true;
    if (this.swiftUI || this.hiding) return;
    const node = this.sheet()?.nativeElement;
    const nativeTag = node ? (this.engine?.tagOf(node) ?? null) : null;
    const hidden =
      nativeTag === null ? undefined : optional(() => this.functions?.hide?.call({ nativeTag }));
    if (!hidden) return this.finish();
    this.hiding = true;
    const done = () => {
      this.hiding = false;
      this.finish();
    };
    hidden.then(done, done);
  }

  /** The sheet has gone: its content leaves the tree. */
  private finish(): void {
    this.closing = false;
    if (!this.mounted()) return;
    if (!this.open()) {
      this.mounted.set(false);
      this.dismissed.emit();
      return;
    }
    // Opened again before it had gone. SwiftUI presents the sheet it still has; Compose hid the
    // one it was asked to, and shows a sheet only as it enters the tree.
    if (this.swiftUI) return;
    this.mounted.set(false);
    afterNextRender(() => this.mounted.set(this.open()), { injector: this.injector });
  }
}
