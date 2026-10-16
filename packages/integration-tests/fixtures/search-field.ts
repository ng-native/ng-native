import { Component, signal, viewChild } from '@angular/core';
import { FormField, disabled, form } from '@angular/forms/signals';
import { SearchField } from '../../expo/src/search-field.ts';

export { SearchField };

/** A filter sheet's search field, as an app writes one. */
@Component({
  selector: 'x-search-field',
  imports: [SearchField],
  template: `
    <search-field
      nativeID="field"
      placeholder="Search colours"
      [(value)]="query"
      (search)="searched.set($event)"
      (cancel)="cancelled.set(cancelled() + 1)"
      (searchFocus)="focused.set(true)"
      (searchBlur)="focused.set(false)"
    />
  `,
})
export class SearchFieldHost {
  readonly field = viewChild.required(SearchField);
  readonly query = signal('');
  readonly searched = signal<string | null>(null);
  readonly cancelled = signal(0);
  readonly focused = signal(false);
}

/** A search field as a Signal Forms field: a saved filter's text. */
@Component({
  selector: 'x-search-field-form',
  imports: [FormField, SearchField],
  template: `<search-field nativeID="filter" [formField]="filter.text" />`,
})
export class SearchFieldForm {
  readonly locked = signal(false);
  readonly model = signal({ text: 'teal' });
  readonly filter = form(this.model, (path) => {
    disabled(path.text, () => this.locked());
  });
}

/** A search field on a page whose type is the app's own face. */
@Component({
  selector: 'x-search-field-in-brand',
  imports: [SearchField],
  styles: '.page { font-family: Brand; font-weight: 700; font-size: 20px; }',
  template: `
    <view class="page"><search-field nativeID="field" /></view>
    <search-field nativeID="inline" [style]="inline" />
    <search-field nativeID="system" [style]="system" />
  `,
})
export class SearchFieldInBrand {
  readonly inline = { fontFamily: 'Brand', fontWeight: '700' };
  readonly system = { fontFamily: 'Georgia' };
}
