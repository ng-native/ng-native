import { Component, signal, viewChild } from '@angular/core';
import { NativeSearchBar } from '../../router/src/native-search-bar.ts';

@Component({
  selector: 'x-search-host',
  imports: [NativeSearchBar],
  template: `
    <native-search-bar
      placeholder="Search"
      [(query)]="query"
      (search)="submitted.push($event)"
      (cancel)="cancelled = cancelled + 1"
      (searchFocus)="focused = true"
      (searchBlur)="focused = false"
    />
  `,
})
export class SearchHost {
  readonly query = signal('');
  readonly bar = viewChild.required(NativeSearchBar);
  readonly submitted: string[] = [];
  cancelled = 0;
  focused = false;
}

/** A search restored with its query, as a screen coming back to life would be. */
@Component({
  selector: 'x-search-restored',
  imports: [NativeSearchBar],
  template: `<native-search-bar placeholder="Search" [(query)]="query" />`,
})
export class SearchRestored {
  readonly query = signal('oak');
}

/** A search that starts over once the query is longer than two characters. */
@Component({
  selector: 'x-search-reset',
  imports: [NativeSearchBar],
  template: `<native-search-bar
    placeholder="Search"
    [query]="query()"
    (queryChange)="reset($event)"
  />`,
})
export class SearchReset {
  readonly query = signal('');
  reset(query: string): void {
    this.query.set(query.length > 2 ? '' : query);
  }
}

/** A search that clears the field from code once the query is longer than two characters. */
@Component({
  selector: 'x-search-clear',
  imports: [NativeSearchBar],
  template: `<native-search-bar
    placeholder="Search"
    [query]="query()"
    (queryChange)="clearPast($event)"
  />`,
})
export class SearchClear {
  readonly query = signal('');
  readonly bar = viewChild.required(NativeSearchBar);
  clearPast(query: string): void {
    if (query.length > 2) this.bar().clear();
    this.query.set(query.length > 2 ? '' : query);
  }
}
