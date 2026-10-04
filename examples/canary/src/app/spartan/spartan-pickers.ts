import { Component, signal } from '@angular/core';
import { HlmComboboxImports } from './helm/combobox';
import { HlmDatePickerImports } from './helm/date-picker';
import { HlmDropdownMenuImports } from './helm/dropdown-menu';
import { HlmMenubarImports } from './helm/menubar';
import { HlmNativeSelectImports } from './helm/native-select';

/** Spartan UI's combobox, date picker, native select and menubar. */
@Component({
  selector: 'app-spartan-pickers',
  imports: [
    HlmComboboxImports,
    HlmDatePickerImports,
    HlmDropdownMenuImports,
    HlmMenubarImports,
    HlmNativeSelectImports,
  ],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm" testID="picker-state">
      Framework: {{ framework() ?? 'none' }}, date: {{ date()?.toDateString() ?? 'none' }}, fruit:
      {{ fruit() }}, menu: {{ menu() }}
    </p>

    <hlm-combobox [(value)]="framework">
      <hlm-combobox-input placeholder="Select a framework" testID="combobox-input" />
      <hlm-combobox-content *hlmComboboxPortal testID="combobox-content">
        <hlm-combobox-empty>No items found.</hlm-combobox-empty>
        <div hlmComboboxList>
          @for (name of frameworks; track name) {
            <hlm-combobox-item [value]="name">{{ name }}</hlm-combobox-item>
          }
        </div>
      </hlm-combobox-content>
    </hlm-combobox>

    <hlm-date-picker [(date)]="date" [defaultFocusedDate]="start" testID="date-picker">
      <hlm-date-picker-trigger buttonId="date-trigger">Pick a date</hlm-date-picker-trigger>
    </hlm-date-picker>

    <hlm-native-select [(value)]="fruit" testID="native-select">
      <option hlmNativeSelectOption value="apple">Apple</option>
      <option hlmNativeSelectOption value="banana">Banana</option>
    </hlm-native-select>

    <div class="flex">
      <hlm-menubar testID="menubar">
        <button hlmMenubarTrigger [hlmMenubarTrigger]="file" testID="menubar-file">File</button>
        <button hlmMenubarTrigger [hlmMenubarTrigger]="edit" testID="menubar-edit">Edit</button>
      </hlm-menubar>
    </div>
    <ng-template #file>
      <hlm-dropdown-menu class="w-48">
        <button hlmDropdownMenuItem (triggered)="menu.set('new tab')">New tab</button>
        <button hlmDropdownMenuItem (triggered)="menu.set('print')">Print</button>
      </hlm-dropdown-menu>
    </ng-template>
    <ng-template #edit>
      <hlm-dropdown-menu class="w-48">
        <button hlmDropdownMenuItem (triggered)="menu.set('undo')">Undo</button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class SpartanPickers {
  protected readonly frameworks = ['Angular', 'Analog', 'Astro', 'Next.js'];
  protected readonly start = new Date(2026, 9, 15);
  protected readonly framework = signal<string | null>(null);
  protected readonly date = signal<Date | undefined>(undefined);
  protected readonly fruit = signal('apple');
  protected readonly menu = signal('nothing');
}
