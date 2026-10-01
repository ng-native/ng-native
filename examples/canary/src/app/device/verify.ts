import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { Dialogs, LayoutAnimation, Sharing, StatusBar, Vibration } from '@ng-native/device';
import { NativeHeader } from '@ng-native/router';
import { Battery } from '@ng-native/expo/battery';
import { Brightness } from '@ng-native/expo/brightness';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { Locale } from '@ng-native/expo/locale';
import { Network } from '@ng-native/expo/network';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { Accelerometer } from '@ng-native/expo/sensors';
import { SecureStorage } from '@ng-native/expo/secure-store';
import { Storage } from '@ng-native/expo/async-storage';
import { page } from '../screen-styles.ts';

/**
 * The things that had been written and tested but never looked at.
 *
 * Every item here fails *quietly* when it is wrong, which is why a unit test is not enough: a
 * selector that matches nothing, a colour that resolves to nothing, a gradient that paints
 * nothing and a dialog that never opens all look identical to code that was never reached. This
 * screen exists to be read on a device, once, by a person.
 *
 * The facades here are the ones backed by React Native itself. The Expo-backed ones - battery,
 * network, sensors and the rest - need their native module installed to bundle at all, which is
 * deliberate and is checked at build time rather than at runtime.
 */
@Component({
  selector: 'x-verify',
  imports: [NativeHeader, Pressable, ScrollView, Text, View],
  template: `
    <native-header title="Verify" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint">
        Each of these fails silently when it is wrong. Look at them rather than trust them.
      </text>

      <text class="heading">Device state</text>
      <text class="body">
        Every one of these is a signal over a native listener. None had ever been read on a device
        before this screen existed; a facade that quietly reports its default looks exactly like a
        device that has nothing to say.
      </text>
      @for (row of state(); track row.label) {
        <view [style]="stateRow">
          <text class="hint">{{ row.label }}</text>
          <text class="body">{{ row.value }}</text>
        </view>
      }

      <text class="heading">Accelerometer</text>
      <text class="body">{{ motion() }}</text>
      <pressable class="card" (press)="toggleMotion()">
        <text class="button-label">{{ reading() ? 'Stop' : 'Start' }} reading</text>
      </pressable>
      <text class="hint">
        Nothing is subscribed until it is started, because every event is a change-detection pass. A
        simulator reports a constant, which is still the difference between reaching the sensor and
        not.
      </text>

      <text class="heading">Storage</text>
      <text class="body">plain: {{ note() }} / keychain: {{ secret() }}</text>
      <pressable class="card" (press)="bumpStored()">
        <text class="button-label">Write to both</text>
      </pressable>
      <text class="hint">
        Both are signals bound to a store. Kill the app and come back: the numbers should be where
        you left them, which is the only way to tell a write-through from a plain signal.
      </text>
      <text class="heading">Structural selectors</text>
      <text class="body">
        First and last row are rounded; odd rows are lighter. Only elements count.
      </text>
      <view>
        @for (row of rows(); track row) {
          <view class="verify-row"
            ><text class="body">{{ row }}</text></view
          >
        }
      </view>
      <view [style]="page.row">
        <pressable class="button" [style]="grow" (press)="addRow()">
          <text class="button-label">Add row</text>
        </pressable>
        <pressable class="button" [style]="grow" (press)="removeRow()">
          <text class="button-label">Remove</text>
        </pressable>
      </view>
      <text class="hint">
        Adding or removing re-resolves the siblings: the rounding and the striping have to follow.
      </text>

      <text class="heading">platform-color()</text>
      <text class="verify-platform-color">The system's own label colour</text>
      <text class="hint">
        iOS 'label', Android '?attr/textColorPrimary'. It should invert with the system theme
        without a dark-mode rule of its own.
      </text>

      <text class="heading">Gradient</text>
      <view class="verify-gradient"></view>
      <text class="hint">
        A blue-to-magenta band, left to right. The direction has to reach native as an angle: only
        the four corners are keywords it knows, and a rejected direction takes the whole gradient
        with it.
      </text>

      <text class="heading">Hairline</text>
      <view class="verify-hairline" [style]="hairlineBox"></view>
      <text class="hint">
        A third of a point on a 3x screen. Next to a 1px rule it should look visibly thinner.
      </text>

      <text class="heading">Dialogs</text>
      <text class="body">{{ answer() }}</text>
      <view [style]="page.row">
        <pressable class="button" [style]="grow" (press)="askConfirm()">
          <text class="button-label">Confirm</text>
        </pressable>
        <pressable class="button" [style]="grow" (press)="askText()">
          <text class="button-label">Prompt</text>
        </pressable>
      </view>
      <view [style]="page.row">
        <pressable class="button" [style]="grow" (press)="askChoice()">
          <text class="button-label">Choose</text>
        </pressable>
        <pressable class="button" [style]="grow" (press)="notify()">
          <text class="button-label">Notify</text>
        </pressable>
      </view>
      <text class="hint">
        Choose is an action sheet on iOS and a dialog on Android; notify is a toast on Android and
        an alert on iOS. Prompt is iOS-only and resolves to null elsewhere.
      </text>

      <text class="heading">Share, vibrate, status bar</text>
      <view [style]="page.row">
        <pressable class="button" [style]="grow" (press)="share()">
          <text class="button-label">Share</text>
        </pressable>
        <pressable class="button" [style]="grow" (press)="buzz()">
          <text class="button-label">Vibrate</text>
        </pressable>
      </view>
      <pressable class="card" (press)="flipBar()">
        <text class="button-label">Toggle the status bar style</text>
      </pressable>
      <text class="hint">{{ shared() }}</text>
    </scroll-view>
  `,
})
export class VerifyPage {
  private readonly battery = inject(Battery);
  private readonly network = inject(Network);
  private readonly locale = inject(Locale);
  private readonly orientation = inject(DeviceOrientation);
  private readonly brightness = inject(Brightness);
  private readonly keepAwake = inject(KeepAwake);
  private readonly accelerometer = inject(Accelerometer);
  private readonly store = inject(Storage);
  private readonly keychain = inject(SecureStorage);
  private readonly dialogs = inject(Dialogs);
  private readonly sharing = inject(Sharing);
  private readonly vibration = inject(Vibration);
  private readonly statusBar = inject(StatusBar);
  private readonly layout = inject(LayoutAnimation);

  protected readonly page = page;
  protected readonly grow = { flex: 1 };
  protected readonly hairlineBox = { height: 1, marginBottom: 4 };
  protected readonly stateRow = {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
  };

  protected readonly rows = signal(['one', 'two', 'three']);
  protected readonly reading = signal(false);
  private stopMotion: (() => void) | null = null;

  /** Persisted, so leaving and coming back is what proves the write went through. */
  protected readonly note = this.store.signal('verify.note', 0);
  protected readonly secret = this.keychain.signal('verify.secret', 0);

  /**
   * One list rather than a field each, so a facade that is quietly reporting its default sits
   * next to one that is not and the difference is visible.
   */
  protected readonly state = computed(() => [
    {
      label: 'battery',
      value: `${Math.round(this.battery.level() * 100)}%  ${this.battery.state()}`,
    },
    { label: 'battery low / saving', value: `${this.battery.low()} / ${this.battery.saving()}` },
    { label: 'network', value: `${this.network.type()}  connected ${this.network.connected()}` },
    { label: 'reachable', value: String(this.network.reachable()) },
    { label: 'locale', value: `${this.locale.tag() ?? '-'}  rtl ${this.locale.rtl()}` },
    { label: 'locales offered', value: String(this.locale.locales().length) },
    {
      label: 'orientation',
      value: `${this.orientation.orientation()}  landscape ${this.orientation.landscape()}`,
    },
    { label: 'brightness', value: this.brightness.level().toFixed(2) },
    { label: 'keep awake', value: String(this.keepAwake.active()) },
    { label: 'accelerometer available', value: String(this.accelerometer.available()) },
  ]);

  protected readonly motion = computed(() => {
    const { x, y, z } = this.accelerometer.reading();
    return `x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)}`;
  });
  protected readonly answer = signal('Nothing asked yet.');
  protected readonly shared = signal('');

  private barIsLight = true;
  private dropBar: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.dropBar?.();
      this.stopMotion?.();
    });
  }

  /** Started explicitly, and stopped, because a sensor nobody stops is a battery nobody gets back. */
  protected toggleMotion(): void {
    if (this.stopMotion) {
      this.stopMotion();
      this.stopMotion = null;
      this.reading.set(false);
      return;
    }
    this.stopMotion = this.accelerometer.start(200);
    this.reading.set(true);
  }

  protected bumpStored(): void {
    this.note.update((n) => n + 1);
    this.secret.update((n) => n + 1);
  }

  /** Through `animate`, so the rounding and striping move rather than jump. */
  protected addRow(): void {
    void this.layout.animate(() => this.rows.update((r) => [...r, `row ${r.length + 1}`]));
  }

  protected removeRow(): void {
    void this.layout.animate(() => this.rows.update((r) => r.slice(0, -1)));
  }

  protected async askConfirm(): Promise<void> {
    const yes = await this.dialogs.confirm('Delete this?', { destructive: true });
    this.answer.set(yes ? 'Confirmed.' : 'Cancelled.');
  }

  protected async askText(): Promise<void> {
    const name = await this.dialogs.ask('What is your name?');
    this.answer.set(name === null ? 'No prompt on this platform.' : `Typed: ${name}`);
  }

  protected async askChoice(): Promise<void> {
    const choices = [
      { label: 'Camera' },
      { label: 'Library' },
      { label: 'Delete', style: 'destructive' as const },
    ];
    // An index rather than the choice: native answers with the position it showed.
    const at = await this.dialogs.choose('Pick one', choices);
    this.answer.set(at === null ? 'Dismissed.' : `Chose: ${choices[at]!.label}`);
  }

  protected notify(): void {
    this.dialogs.notify('Copied to the clipboard');
  }

  protected async share(): Promise<void> {
    const took = await this.sharing.share({ message: 'angular-native', url: 'https://expo.dev' });
    this.shared.set(took ? 'Something took it.' : 'Dismissed, or nothing took it.');
  }

  protected buzz(): void {
    this.vibration.buzz(300);
  }

  /** Claims the bar, and drops the claim when the screen goes - which is the half that is easy to forget. */
  protected flipBar(): void {
    this.dropBar?.();
    this.barIsLight = !this.barIsLight;
    this.dropBar = this.statusBar.push({ style: this.barIsLight ? 'light' : 'dark' });
  }
}
