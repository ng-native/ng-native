import { Component, Injectable, inject, input, signal } from '@angular/core';
import { CURRENT_WINDOW, SafeArea, Screen } from '@ng-native/device';
import { HostEngine } from '@ng-native/fabric';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';

/** A root service every window shares. */
@Injectable({ providedIn: 'root' })
export class Count {
  readonly value = signal(0);
}

@Component({
  selector: 'x-main-window',
  imports: [Pressable, Text],
  template: `
    <pressable testID="add" (press)="count.value.set(count.value() + 1)">
      <text testID="main-count">{{ count.value() }}</text>
    </pressable>
  `,
})
export class MainWindowApp {
  protected readonly count = inject(Count);
}

@Component({
  selector: 'x-note-window',
  imports: [Pressable, Text],
  template: `
    <pressable testID="note-add" (press)="count.value.set(count.value() + 1)">
      <text testID="note">{{ name() }} {{ count.value() }}</text>
    </pressable>
  `,
})
export class NoteWindow {
  readonly name = input('');
  readonly unsaved = signal(false);
  protected readonly count = inject(Count);
  readonly window = inject(CURRENT_WINDOW);

  constructor() {
    this.window?.canClose(() => !this.unsaved());
    NoteWindow.made.push(this);
  }

  /** Every note window made, for a test to reach the one it opened. */
  static readonly made: NoteWindow[] = [];
}

@Component({
  selector: 'x-routed-app',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
export class RoutedApp {}

@Component({
  selector: 'x-home-page',
  imports: [Text],
  template: '<text testID="home">Home</text>',
})
export class HomePage {}

@Component({
  selector: 'x-general-page',
  imports: [Text],
  template: '<text testID="general">General {{ count.value() }}</text>',
})
export class GeneralPage {
  protected readonly count = inject(Count);
}

/** A page with an outlet of its own, for its child routes. */
@Component({
  selector: 'x-accounts-shell',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
export class AccountsShell {}

/** A window that shows what it was given of its own: its screen, its safe area and its engine. */
@Component({
  selector: 'x-screen-window',
  imports: [Text],
  template: '<text testID="size">{{ screen.window().width }}</text>',
})
export class ScreenWindow {
  readonly screen = inject(Screen);
  readonly safeArea = inject(SafeArea);
  readonly engine = inject(HostEngine);

  constructor() {
    ScreenWindow.made.push(this);
  }

  static readonly made: ScreenWindow[] = [];
}
