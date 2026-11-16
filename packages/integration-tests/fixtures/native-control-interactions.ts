import { ChangeDetectorRef, Component, inject, signal } from '@angular/core';
import { NativeButton } from '../../components/src/native-button.ts';
import { Switch } from '../../components/src/switch.ts';

/** A switch and native buttons, each logging its own output, for the interaction observers. */
@Component({
  selector: 'x-native-control-interactions',
  imports: [NativeButton, Switch],
  template: `
    <switch
      testID="wifi"
      nativeID="wifi-switch"
      accessibilityLabel="Wi-Fi"
      [(checked)]="on"
      (checkedChange)="log('wifi ' + $event)"
      (touch)="log('wifi touched')"
    />
    <switch testID="locked" [checked]="false" />
    <native-button
      testID="save"
      accessibilityLabel="Save the draft"
      [disabled]="off()"
      (press)="log('save')"
      >Save</native-button
    >
    <native-button testID="silent">Nothing happens</native-button>
    @if (dismissible()) {
      <native-button testID="dismiss" (press)="dismiss()">Dismiss</native-button>
    }
  `,
})
export class NativeControlInteractionsFixture {
  readonly events: string[] = [];
  readonly on = signal(false);
  readonly off = signal(false);
  readonly dismissible = signal(true);
  private readonly changes = inject(ChangeDetectorRef);

  log(event: string): void {
    this.events.push(event);
  }

  /** Removes its own button before the press is over, as a dismiss button does. */
  dismiss(): void {
    this.dismissible.set(false);
    this.changes.detectChanges();
  }
}
