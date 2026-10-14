import { Component, signal, viewChild } from '@angular/core';
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
      [(query)]="query"
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
