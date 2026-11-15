import { Component, signal } from '@angular/core';
import { MenuItem } from '../../components/src/menu.ts';
import { TrayIcon } from '../../components/src/tray-icon.ts';

@Component({
  selector: 'x-tray-icon',
  imports: [MenuItem, TrayIcon],
  template: `
    @if (shown()) {
      <tray-icon sfSymbol="timer" [title]="time()" tooltip="Focus timer">
        <menu-item label="Pause" (select)="said.push('pause')" />
      </tray-icon>
    }
    <tray-icon image="sync" (press)="said.push('sync')" />
  `,
})
export class TrayIconFixture {
  readonly shown = signal(true);
  readonly time = signal('25:00');
  readonly said: string[] = [];
}
