/**
 * The navigation bar's search field: react-native-screens' `RNSSearchBar`, the UISearchController
 * iOS puts under a large title. Place it in the header's search slot:
 *
 * ```html
 * <native-header title="Properties" [largeTitle]="true">
 *   <native-header-item type="searchBar">
 *     <native-search-bar placeholder="Search" [(query)]="query" />
 *   </native-header-item>
 * </native-header>
 * ```
 *
 * The text is a two-way `query`: what a list filter wants. Typing updates it, and a query set from
 * code - a recent search tapped, a suggestion taken - is put in the field, as a controlled text
 * input's value is. `(search)` is the keyboard's search key, with the text; `(cancel)` the Cancel
 * button; `(searchFocus)` and `(searchBlur)` the field taking and leaving the keyboard, which is when
 * a suggestions list comes and goes. `focus()`, `blur()`, `clear()` and `cancelSearch()` do those
 * from code.
 *
 * ponytail: react-native-screens has no scope bar and no search tokens; a scope is a segmented
 * control under the header, and a token is text. Nor has its search bar a font prop on iOS or
 * Android, so the field and placeholder stay in the system font; `<search-field>` from
 * `@ng-native/expo/search-field` takes the font its CSS resolves to.
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  model,
  output,
  untracked,
} from '@angular/core';
import { type EngineNode, HostEngine, type NativeSyntheticEvent } from '@ng-native/fabric';
import { ownHost } from './own-host.ts';
import { optionalBoolean } from './transforms.ts';

/** react-native-screens' placements for the navigation bar's search field. */
export type SearchBarPlacement =
  'automatic' | 'inline' | 'stacked' | 'integrated' | 'integratedButton' | 'integratedCentered';

@Component({
  selector: 'native-search-bar',
  template: '',
  host: {
    '[placeholder]': 'placeholder()',
    '[hideWhenScrolling]': 'hideWhenScrolling()',
    '[cancelButtonText]': 'cancelButtonText()',
    '[placement]': 'placement()',
    '[allowToolbarIntegration]': 'allowToolbarIntegration()',
    '[autoCapitalize]': 'autoCapitalize()',
    '[obscureBackground]':
      'obscureBackground() === undefined ? undefined : String(obscureBackground())',
    '[hideNavigationBar]':
      'hideNavigationBar() === undefined ? undefined : String(hideNavigationBar())',
    '[tintColor]': 'tintColor()',
    '[textColor]': 'textColor()',
    '(changeText)': 'onNativeText($event?.nativeEvent?.text ?? "")',
  },
})
export class NativeSearchBar {
  readonly query = model('');
  readonly placeholder = input<string>();
  /** Scroll the field away with the content, as iOS lists do by default. */
  readonly hideWhenScrolling = input(undefined, { transform: optionalBoolean });
  readonly cancelButtonText = input<string>();
  /**
   * Where iOS puts the field. `automatic` lets iOS 26 fold it into a toolbar, which a presented
   * sheet does not have, so there it shows nowhere; `stacked` keeps it under the title.
   */
  readonly placement = input<SearchBarPlacement>();
  /** iOS 26: whether `automatic` may move the field into the toolbar. */
  readonly allowToolbarIntegration = input(undefined, { transform: optionalBoolean });
  readonly autoCapitalize = input<
    'systemDefault' | 'none' | 'words' | 'sentences' | 'characters'
  >();
  /** Dim the content behind the field while it is being typed in. */
  readonly obscureBackground = input(undefined, { transform: optionalBoolean });
  /** Hide the navigation bar while the field is being typed in. */
  readonly hideNavigationBar = input(undefined, { transform: optionalBoolean });
  /** iOS: the cursor and the Cancel button. Android: the field's background. */
  readonly tintColor = input<string>();
  /** The typed text. */
  readonly textColor = input<string>();

  /** The keyboard's search key was pressed, with the text in the field. */
  readonly search = output<string>();
  /** The Cancel button was pressed. */
  readonly cancel = output<void>();
  readonly searchFocus = output<void>();
  readonly searchBlur = output<void>();

  private readonly node = inject(ElementRef).nativeElement as EngineNode;
  private readonly engine = this.node.engine ?? inject(HostEngine);
  /** What the field last said it holds, to tell a query set from code from the field's echo. */
  private fieldText = '';

  constructor() {
    ownHost(this.node, NativeSearchBar);
    const listen = (event: string, handle: (payload: Record<string, unknown>) => void) =>
      this.engine.setEventListener(this.node, event, (raw) =>
        handle((raw as NativeSyntheticEvent<Record<string, unknown>>)?.nativeEvent ?? {}),
      );
    const stops = [
      listen('topSearchButtonPress', ({ text }) => this.search.emit(String(text ?? this.query()))),
      listen('topCancelButtonPress', () => this.cancel.emit()),
      listen('topSearchFocus', () => this.searchFocus.emit()),
      listen('topSearchBlur', () => this.searchBlur.emit()),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
    // A query that is not what the field holds was set from code: put it in the field. After the
    // render, so a query the page starts with reaches a field that has been committed.
    afterRenderEffect({
      write: () => {
        const query = this.query();
        untracked(() => {
          if (query === this.fieldText) return;
          this.fieldText = query;
          this.engine.dispatchCommand(this.node, 'setText', [query]);
        });
      },
    });
  }

  focus(): void {
    this.engine.dispatchCommand(this.node, 'focus');
  }

  blur(): void {
    this.engine.dispatchCommand(this.node, 'blur');
  }

  /** Empty the field, and the query with it. */
  clear(): void {
    this.fieldText = '';
    this.query.set('');
    this.engine.dispatchCommand(this.node, 'clearText');
  }

  /** Close the search, as the Cancel button does. */
  cancelSearch(): void {
    this.engine.dispatchCommand(this.node, 'cancelSearch');
  }

  protected onNativeText(text: string): void {
    this.fieldText = text;
    this.query.set(text);
  }
}
