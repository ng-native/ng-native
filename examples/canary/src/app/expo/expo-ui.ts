import { Component, computed, signal } from '@angular/core';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import {
  nativeState,
  UiBottomSheet,
  UiButton,
  UiChart,
  UiColorPicker,
  UiDatePicker,
  UiDivider,
  UiForm,
  UiGauge,
  UiHStack,
  UiHost,
  UiLabeledContent,
  UiPicker,
  type UiPresentationDetent,
  UiProgress,
  UiSection,
  UiSlider,
  UiSlot,
  UiSpacer,
  UiStepper,
  UiText,
  UiTextField,
  UiToggle,
  UiToolbarItem,
  UiVStack,
} from '@ng-native/expo';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { Example, Section } from '../example.ts';
import { page } from '../screen-styles.ts';

/**
 * SwiftUI, driven by the engine rather than by React.
 *
 * These are `@expo/ui`'s own native views, registered by name in `main.ts` and rendered as
 * elements. There is no Angular component for any of them: `registerExpoUiViews` gives the
 * engine the Fabric name each element commits as, and the props are the ones the SwiftUI view
 * declares. A component per control would be a second place for every prop to be wrong, and
 * ninety-two of them would be a maintenance burden with no end.
 *
 * Two things follow from bypassing `@expo/ui`'s React, and both are visible here.
 *
 * Every group has to sit inside `<ui-host>`. SwiftUI is not laid out by Yoga, so the host view is
 * the bridge between the two worlds: it measures its SwiftUI content and reports a size back to
 * React Native's layout. Outside one, a control has no size and does not appear.
 *
 * A host needs two things beyond that, and both are only visible once something moves. It places
 * its content at `bounds.origin` - top left, never centred - so any height the Yoga box has
 * beyond the content becomes a gap underneath, and the control reads as sitting too high; letting
 * `matchContentsVertical` size the box is what avoids it. And it applies the container safe area
 * to its content, which is stable until the navigation bar collapses on the first scroll and then
 * shifts every control up by the difference while the React Native views around them stay put.
 * `ignoreSafeArea="container"` is what keeps SwiftUI content on the frame it was given.
 *
 * The event names are the *native* ones. React's `onPress` on a Button is
 * `onButtonPress` on the view underneath, a Slider reports `onValueChanged` rather than
 * `onValueChange`, and a Toggle is `onIsOnChange`. The wrapper renames them; we do not have the
 * wrapper.
 */
@Component({
  selector: 'x-expo-ui',
  imports: [
    Example,
    NativeHeader,
    Pressable,
    ScrollView,
    Section,
    Text,
    UiBottomSheet,
    UiButton,
    UiChart,
    UiColorPicker,
    UiDatePicker,
    UiDivider,
    UiForm,
    UiGauge,
    UiHStack,
    UiHost,
    UiLabeledContent,
    UiPicker,
    UiProgress,
    UiSection,
    UiSlider,
    UiSlot,
    UiSpacer,
    UiStepper,
    UiText,
    UiTextField,
    UiToggle,
    UiToolbarItem,
    UiVStack,
    View,
  ],
  // Views registered by name, with no component behind them: see registerExpoView.
  template: `
    <native-header title="SwiftUI controls" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint">
        Real SwiftUI, with no React in the render path. Each group is inside a host view, which is
        what measures SwiftUI content for React Native's layout.
      </text>

      <x-section title="Controls">
        <x-example
          title="Slider"
          note="onValueChanged with a d, which is the one that catches everybody: the React prop
                is onValueChange and the native event is not."
          code='<ui-slider [value]="..." (valueChanged)="..." />'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-slider
              [value]="level()"
              [min]="0"
              [max]="1"
              (valueChanged)="level.set($event.nativeEvent.value)"
            ></ui-slider>
          </ui-host>
          <text class="body">{{ level().toFixed(2) }}</text>
        </x-example>

        <x-example
          title="Picker"
          note="Four things, and missing any one draws nothing. The options go in a slot named
                content, each needs a tag modifier so SwiftUI can map the selection to one, the
                picker needs a style because the default collapses outside a form, and the
                selection is the tag value rather than an index."
          code="[modifiers]=&quot;[pickerStyle('segmented')]&quot;"
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-picker
              label="Size"
              [value]="size()"
              [modifiers]="segmented"
              (selectionChange)="pickSize($event.nativeEvent.selection)"
            >
              <ui-slot name="content">
                @for (option of sizes; track option) {
                  <ui-text [text]="option" [modifiers]="[tag(option)]"></ui-text>
                }
              </ui-slot>
            </ui-picker>
          </ui-host>
          <text class="body">{{ size() }}</text>
        </x-example>

        <x-example
          title="Button"
          note="A real UIButton drawn by SwiftUI. The native event is onButtonPress; React's
                wrapper is what calls it onPress."
          code='<ui-button label="Press me" (buttonPress)="..." />'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-button label="Press me" (buttonPress)="taps.set(taps() + 1)"></ui-button>
          </ui-host>
          <text class="body">pressed {{ taps() }} times</text>
        </x-example>

        <x-example
          title="Button roles"
          note="destructive is red and cancel is the dismissing one, decided by SwiftUI rather
                than by a colour we pick."
          code='role="destructive"'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-button label="Delete" role="destructive"></ui-button>
          </ui-host>
        </x-example>

        <x-example
          title="Toggle"
          note="A UISwitch. onIsOnChange, not onValueChange."
          code='<ui-toggle [isOn]="on()" (isOnChange)="..." />'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-toggle label="Wi-Fi" [isOn]="on()" (isOnChange)="on.set($event.nativeEvent.isOn)">
            </ui-toggle>
          </ui-host>
          <text class="body">{{ on() ? 'on' : 'off' }}</text>
        </x-example>

        <x-example
          title="Stepper"
          note="Plus and minus, with the platform's own repeat behaviour when held."
          code='<ui-stepper [value]="n()" (valueChange)="..." />'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-stepper
              label="Guests"
              [value]="guests()"
              [min]="1"
              [max]="8"
              [step]="1"
              (valueChange)="guests.set($event.nativeEvent.value)"
            ></ui-stepper>
          </ui-host>
          <text class="body">{{ guests() }}</text>
        </x-example>

        <x-example
          title="Text field"
          note="text is not the text. It names an ObservableState living on the native side, and
            what travels over the prop is that object's id, so binding the string logs
            FieldInvalidTypeException and the field quietly ignores everything you set."
          code='[text]="name?.id"'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-text-field
              placeholder="Your name"
              [text]="name"
              (textChange)="typed.set($event.nativeEvent.value)"
            ></ui-text-field>
          </ui-host>
          <text class="body">{{ typed() || '(empty)' }}</text>
          <pressable class="card" (press)="name?.set('Ada Lovelace')">
            <text class="button-label">set it from Angular</text>
          </pressable>
        </x-example>

        <x-example
          title="Colour picker"
          note="Opens the system colour panel, which is not something React Native offers."
          code='<ui-color-picker [selection]="..." />'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-color-picker
              label="Tint"
              selection="#3b6ef5"
              [supportsOpacity]="true"
            ></ui-color-picker>
          </ui-host>
        </x-example>

        <x-example
          title="Date picker"
          note="The graphical variant is the full calendar; compact is the tappable field."
          code='variant="compact"'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-date-picker
              title="When"
              variant="compact"
              [displayedComponents]="['date']"
            ></ui-date-picker>
          </ui-host>
        </x-example>
      </x-section>

      <x-section title="Indicators" note="Presentational, so nothing has to be wired to them.">
        <x-example
          title="Gauge"
          note="A SwiftUI gauge, with the labels it draws at each end."
          code='<ui-gauge [value]="0.7" type="circular" />'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostRow"
          >
            <ui-gauge
              [value]="level()"
              [min]="0"
              [max]="1"
              [currentValueLabel]="level().toFixed(2)"
              minimumValueLabel="0"
              maximumValueLabel="1"
            ></ui-gauge>
          </ui-host>
        </x-example>

        <x-example title="Progress" code='<ui-progress [value]="0.4" />'>
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostFill"
          >
            <ui-progress [value]="level()"></ui-progress>
          </ui-host>
        </x-example>

        <x-example
          title="Chart"
          note="Swift Charts, iOS only. The slider above moves the last bar."
          code='<ui-chart type="bar" [data]="sets()" />'
        >
          <ui-host ignoreSafeArea="container" [style]="hostChart">
            <ui-chart
              type="bar"
              showGrid
              [data]="sets()"
              [barStyle]="{ cornerRadius: 4 }"
            ></ui-chart>
          </ui-host>
        </x-example>
      </x-section>

      <x-section title="Layout" note="SwiftUI's own stacks, laid out by SwiftUI rather than Yoga.">
        <x-example
          title="hstack and vstack"
          note="Inside the host these are SwiftUI layout containers - the flex properties of the
                surrounding views mean nothing to them."
          code="<ui-hstack><text /><ui-spacer /><text /></ui-hstack>"
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostFill"
          >
            <ui-vstack [spacing]="8">
              <ui-hstack [spacing]="12">
                <ui-text text="Leading"></ui-text>
                <ui-spacer></ui-spacer>
                <ui-text text="Trailing"></ui-text>
              </ui-hstack>
              <ui-divider></ui-divider>
              <ui-labeled-content label="Version"
                ><ui-text text="1.0"></ui-text
              ></ui-labeled-content>
            </ui-vstack>
          </ui-host>
        </x-example>

        <x-example
          title="Section in a form"
          note="The grouped list style an iOS settings screen is built from, with none of it drawn
                by us."
          code='<ui-form><ui-section title="...">...</ui-section></ui-form>'
        >
          <ui-host
            ignoreSafeArea="container"
            [matchContents]="{ vertical: true }"
            [style]="hostForm"
          >
            <ui-form>
              <ui-section title="Display">
                <ui-slot name="content">
                  <ui-toggle label="Bold text" [isOn]="on()"></ui-toggle>
                  <ui-labeled-content label="Appearance">
                    <ui-slot name="content"><ui-text text="Dark"></ui-text></ui-slot>
                  </ui-labeled-content>
                </ui-slot>
              </ui-section>
            </ui-form>
          </ui-host>
        </x-example>
      </x-section>

      <x-section
        title="Presentation"
        note="The system's sheet, opened from this page with no route."
      >
        <x-example
          title="Bottom sheet"
          note="SwiftUI's sheet stays in the tree and is presented by a prop; Compose's shows for
                as long as it is in the tree. One element is both, and what is written inside it
                is this app's own views. Dismissed counts each time the sheet has gone."
          code='<ui-bottom-sheet [(open)]="open" fitToContents>...</ui-bottom-sheet>'
        >
          <pressable [style]="sheetButton" testID="sheet-fitted" (press)="openSheet(true)">
            <text [style]="sheetButtonLabel">Open, as tall as its content</text>
          </pressable>
          <pressable [style]="sheetButton" testID="sheet-half" (press)="openSheet(false)">
            <text [style]="sheetButtonLabel">Open at half height</text>
          </pressable>
          <pressable
            [style]="sheetButton"
            testID="sheet-detents"
            (press)="openSheet(false, thirdAndFull)"
          >
            <text [style]="sheetButtonLabel">Open at a third, iOS only</text>
          </pressable>
          <pressable
            [style]="sheetButton"
            testID="sheet-toolbar"
            (press)="openSheet(false, undefined, true)"
          >
            <text [style]="sheetButtonLabel">Open with the system's close button, iOS only</text>
          </pressable>
          <text class="body" testID="sheet-state">
            {{ sheetOpen() ? 'Open' : 'Closed' }}, dismissed {{ sheetDismissals() }} times
          </text>
          <ui-bottom-sheet
            [(open)]="sheetOpen"
            [fitToContents]="sheetFits()"
            [detents]="sheetDetents()"
            (dismissed)="sheetDismissals.set(sheetDismissals() + 1)"
          >
            @if (sheetToolbar()) {
              <ui-toolbar-item placement="cancellationAction">
                <ui-button role="close" (buttonPress)="sheetOpen.set(false)" />
              </ui-toolbar-item>
            }
            <view [style]="sheetBody">
              <text [style]="sheetTitle">A sheet of the app's own views</text>
              <pressable [style]="sheetButton" testID="sheet-count" (press)="taps.set(taps() + 1)">
                <text [style]="sheetButtonLabel">Pressed {{ taps() }} times</text>
              </pressable>
              <pressable [style]="sheetButton" testID="sheet-close" (press)="sheetOpen.set(false)">
                <text [style]="sheetButtonLabel">Close</text>
              </pressable>
            </view>
          </ui-bottom-sheet>
        </x-example>
      </x-section>

      <text class="hint">
        Fifty-five SwiftUI elements are registered, and these are the ones worth looking at. The
        rest are the same idea: a name, and the props the SwiftUI view declares.
      </text>
    </scroll-view>
  `,
})
export class ExpoUiPage {
  protected readonly page = page;

  protected readonly taps = signal(0);
  protected readonly on = signal(true);
  protected readonly level = signal(0.5);
  protected readonly guests = signal(2);
  protected readonly sets = computed(() => [
    { x: 'Mon', y: 3 },
    { x: 'Tue', y: 5 },
    { x: 'Wed', y: 2 },
    { x: 'Thu', y: Math.round(this.level() * 10) },
  ]);
  protected readonly size = signal('Medium');

  protected readonly sheetOpen = signal(false);
  protected readonly sheetFits = signal(true);
  protected readonly sheetDismissals = signal(0);

  protected readonly sheetBody = { padding: 24, gap: 12 };
  protected readonly sheetTitle = { fontSize: 17, fontWeight: '600' };
  protected readonly sheetButton = {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#0a84ff',
  };
  protected readonly sheetButtonLabel = { color: '#ffffff', fontWeight: '600' };

  protected readonly sheetDetents = signal<readonly UiPresentationDetent[] | undefined>(undefined);
  protected readonly thirdAndFull: readonly UiPresentationDetent[] = [{ fraction: 0.3 }, 'large'];

  /** Whether the sheet has a toolbar, which holds the system's close button. */
  protected readonly sheetToolbar = signal(false);

  protected openSheet(
    fits: boolean,
    detents?: readonly UiPresentationDetent[],
    toolbar = false,
  ): void {
    this.sheetFits.set(fits);
    this.sheetDetents.set(detents);
    this.sheetToolbar.set(toolbar);
    this.sheetOpen.set(true);
  }

  protected pickSize(selection: string | number): void {
    this.size.set(String(selection));
  }
  protected readonly typed = signal('');
  /** Where the text field's text actually lives. See the Text field example. */
  protected readonly name = nativeState('');
  protected readonly sizes = ['Small', 'Medium', 'Large'];
  /** A modifier is plain data - `{ $type: 'tag', tag }` - so it travels as an ordinary prop. */
  protected readonly tag = tag;
  /** Without a style the picker collapses outside a form, which looks like it did not render. */
  protected readonly segmented = [pickerStyle('segmented')];

  /**
   * Nothing. A host places its SwiftUI content at `bounds.origin` - top left, never centred -
   * so any height the box has beyond the content shows up as a gap underneath it, and the
   * control reads as sitting too high. `matchContentsVertical` makes the box the content.
   */
  protected readonly hostRow = {};
  protected readonly hostFill = {};
  protected readonly hostForm = { minHeight: 180 };
  protected readonly hostChart = { height: 180 };
}
