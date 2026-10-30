---
title: Address search
summary: Postal addresses that match what someone has typed so far, and the parts of the one they pick.
---

# Address search

`AddressSearch` fills an address form from part of an address: someone types a postcode or the
start of a street, picks the full address from the suggestions, and the form gets its line one,
town, postcode and country. It needs no permission and no API key. It is `@ng-native/expo`'s own
native code: MapKit on iOS, and the platform's geocoder on Android.

## Install

Nothing to install beyond `@ng-native/expo`. Its native half is in a development build; Expo Go
cannot load it.

```ts
import { AddressSearch } from '@ng-native/expo/address-search';
```

## The smallest thing that works

```ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text, TextInput, View } from '@ng-native/components';
import {
  AddressSearch,
  type AddressSuggestion,
  type PostalAddress,
} from '@ng-native/expo/address-search';

@Component({
  selector: 'app-address',
  imports: [Pressable, Text, TextInput, View],
  template: `
    <view>
      <text-input placeholder="Postcode or street" [(value)]="query" />
      @for (suggestion of suggestions(); track suggestion.id) {
        <pressable accessibilityRole="button" (press)="pick(suggestion)">
          <text>{{ suggestion.title }}</text>
          <text>{{ suggestion.subtitle }}</text>
        </pressable>
      }
      @if (address(); as address) {
        <text>{{ address.line1 }}, {{ address.town }} {{ address.postcode }}</text>
      }
    </view>
  `,
})
export class AddressForm {
  private readonly search = inject(AddressSearch);
  protected readonly query = signal('');
  protected readonly suggestions = this.search.suggest(this.query, { region: 'GB' });
  protected readonly address = signal<PostalAddress | null>(null);

  protected async pick(suggestion: AddressSuggestion): Promise<void> {
    this.address.set(await this.search.resolve(suggestion));
  }
}
```

## Suggestions

`suggest(query, options)` answers a signal of the addresses that match the `query` signal, best
first, that follows it as it changes. Each suggestion has an `id`, a `title` (the first line,
`22 Hyde Park Terrace`) and a `subtitle` (the rest, `Leeds, LS6 1BJ, England`).

- It is empty while the query is blank, and only the latest query's suggestions are kept, however
  the answers arrive.
- Call it in an injection context, such as a component's field. The search ends when that context
  is destroyed.
- `region` is a country, as an ISO 3166-1 alpha-2 code such as `GB`. On Android only addresses in
  that country are suggested. On iOS the search looks in a circle around the country, which can
  take in a neighbour's border: only there from iOS 18, and there first on earlier versions.
- `pointsOfInterest: true` suggests places by name too, such as a shop or a station. iOS only.

A search that fails, for example with no network, leaves the suggestions empty and goes to the
app's `ErrorHandler`.

## The address

`resolve(suggestion)` answers the picked suggestion's address in parts, or null when there is none:

| Part          | Example                   |
| ------------- | ------------------------- |
| `line1`       | `22 Hyde Park Terrace`    |
| `locality`    | `Headingley`              |
| `town`        | `Leeds`                   |
| `postcode`    | `LS6 1BJ`                 |
| `region`      | `England`                 |
| `country`     | `United Kingdom`          |
| `countryCode` | `GB`                      |
| `coordinates` | `{ latitude, longitude }` |

A part the platform does not know is an empty string. `locality`, `region` and `coordinates` are
left out instead. A suggestion resolves while its suggestions are the latest the search answered.
After the query changes, resolve one of the new suggestions.

## Platform differences

- **iOS:** MapKit's `MKLocalSearchCompleter`, which completes partial addresses as the query
  changes and waits while the query is still changing. `MKLocalSearch` looks up the picked
  suggestion. A full postcode such as `LS6 1BJ` suggests the postcode itself rather than the
  houses in it, and resolves with an empty `line1`. A street suggestion can resolve with only the
  first part of its postcode (`LS6`), so a form should let the person finish it.
- **Android:** the platform's `Geocoder`, asked once the query has not changed for 300 ms. It
  answers whole addresses that match the query rather than completions, so a partial street name
  finds less than on iOS. It goes to the network for each lookup. On a device with no geocoder,
  the suggestions stay empty.

## Without the native module

In Expo Go, on the web and in Node tests there is no native module: the suggestions stay empty,
`resolve` answers null, and in development a warning says so once. A test provides a fake through
`AddressSearch.SOURCE`.
