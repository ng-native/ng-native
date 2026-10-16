---
title: Search field
summary: The platform's own search field anywhere a view can go, such as a filter sheet.
---

# Search field

`<search-field>` is the system search field as a view of its own: UIKit's `UISearchBar` on iOS and
AndroidX's `SearchView` on Android. [`<native-search-bar>`](/packages/router/header#search) is the
one in a navigation bar; this one goes anywhere else, such as a bottom sheet, which has no
navigation bar, a page, or the top of a list.

It comes with `@ng-native/expo`, whose native half draws it, so it needs an app built since
`@ng-native/expo` was installed: `npx expo run:ios`, `npx expo run:android`, or a new EAS build.
Expo Go cannot load it, so there it draws nothing and logs a warning in development.

```ts
import { Component, computed, signal } from '@angular/core';
import { Text } from '@ng-native/components';
import { UiBottomSheet } from '@ng-native/expo';
import { SearchField } from '@ng-native/expo/search-field';

@Component({
  selector: 'app-colour-filter',
  imports: [SearchField, Text, UiBottomSheet],
  template: `
    <ui-bottom-sheet [(open)]="open">
      <search-field placeholder="Search colours" [(value)]="query" />
      @for (colour of matching(); track colour) {
        <text>{{ colour }}</text>
      }
    </ui-bottom-sheet>
  `,
})
export class ColourFilter {
  protected readonly open = signal(false);
  protected readonly query = signal('');
  private readonly colours = ['Indigo', 'Teal', 'Coral', 'Ochre'];
  protected readonly matching = computed(() =>
    this.colours.filter((colour) => colour.toLowerCase().includes(this.query().toLowerCase())),
  );
}
```

## Inputs and events

The events are `<native-search-bar>`'s. The text is a two-way `value` rather than the bar's
`query`, because the field is a Signal Forms control, as `<text-input>` is:

- **`value`** - the text in the field, two-way. Typing writes it, and text set from code is put in
  the field. Text for a keystroke the user has typed past is skipped, so a fast typist loses
  nothing, as with a text input.
- **`disabled`** - refuse input and show the field dimmed.
- **`placeholder`** - shown while the field is empty.
- **`showsCancelButton`** - iOS: whether the Cancel button shows. Unset, it shows while the field
  has the keyboard. Android's search field has no Cancel button.
- **`autoCapitalize`** - `'none'`, `'words'`, `'sentences'` or `'characters'`. iOS.
- **`tintColor`** - the colour of the cursor and the Cancel button. iOS.
- **`search`** - the keyboard's search key, with the text. The field gives up the keyboard.
- **`cancel`** - iOS: the Cancel button. The field is emptied and gives up the keyboard.
- **`searchFocus`** and **`searchBlur`** - the field taking the keyboard and giving it up.
- **`touch`** - the field gave up the keyboard, which is when a form marks it touched.

`focus()` and `blur()` give the field the keyboard and take it away, and `clear()` empties the field
and the value. Reach them with `viewChild(SearchField)`.

The element is 56 points tall by default, the height of the system's own field. A height in a style
or a class replaces it.

The field's text and placeholder take the `font-family`, `font-size`, `font-weight` and `font-style`
its CSS resolves to, from a class on the field, its own style, or what it inherits, as a `<text>`
beside it does. A face the app's `@font-face` declares, once [`loadFonts()`](/packages/expo/fonts)
has registered it, is matched by weight and style. The system font, or a family no `@font-face`
declares, is drawn at that weight, and slanted for `italic`, as a `<text>` is. The size scales with
the system text size setting. With none of them set, the field keeps the system font at its own
size.

On iOS, the system's field grows with the size of its font: in the system font, a size above about
21px needs more than the 56-point default height. A height in a style or a class gives it room.

```css
.search {
  font-size: 24px;
  height: 96px;
}
```

## In a form

`value` is a `model()`, so `[formField]` binds a search field into a Signal Forms form with no
adapter, as it binds a `<text-input>`. The form's `disabled()` rule disables it, and leaving the
field marks it touched:

```ts
import { Component, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { SearchField } from '@ng-native/expo/search-field';

@Component({
  selector: 'app-saved-filter',
  imports: [FormField, SearchField],
  template: `<search-field placeholder="Filter" [formField]="filter.text" />`,
})
export class SavedFilter {
  private readonly model = signal({ text: '' });
  protected readonly filter = form(this.model);
}
```

## API

<!-- api: SearchField -->
