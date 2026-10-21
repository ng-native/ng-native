/**
 * `<search-field>`: the platform's own search field, anywhere a view can go. `<native-search-bar>`
 * from `@ng-native/router` is the one in a navigation bar; this is the one for everywhere else, a
 * filter sheet, a page, a list's header:
 *
 * ```html
 * <ui-bottom-sheet [(open)]="filtering">
 *   <search-field placeholder="Search colours" [(value)]="query" />
 *   ...
 * </ui-bottom-sheet>
 * ```
 *
 * It is `@ng-native/expo`'s own native view: UIKit's `UISearchBar` on iOS, with its Cancel button,
 * dictation and clear button, and AndroidX's `SearchView` on Android, which has no Cancel button.
 * The events are `<native-search-bar>`'s: `(search)` for the keyboard's search key with the text,
 * `(cancel)`, `(searchFocus)` and `(searchBlur)`, and `focus()`, `blur()` and `clear()` from code.
 * The text is a two-way `value` rather than the bar's `query`, because it is a Signal Forms control
 * as `<text-input>` is: `[formField]` binds `value`, `disabled`, and `touch` on blur.
 * Its type is the `font-family`, `font-size`, `font-weight` and `font-style` its CSS resolves to,
 * as a `<text>`'s is.
 *
 * Expo Go cannot load native code of its own, so there the element draws nothing, and in
 * development it says so once.
 */
import {
  Component,
  booleanAttribute,
  DestroyRef,
  ElementRef,
  InjectionToken,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  Engine,
  type EngineNode,
  HostEngine,
  type NativeSyntheticEvent,
  nativePlatform,
  type PostScriptNames,
  registerViewName,
} from '@ng-native/fabric';
import { optional } from './native.ts';
import { expoViewName } from './register-expo-view.ts';
import { optionalBoolean } from './transforms.ts';

/** The functions the native module defines on the view, called with the view's tag as `this`. */
export interface SearchFieldFunctions {
  focus?(this: { nativeTag: number }): Promise<void>;
  blur?(this: { nativeTag: number }): Promise<void>;
}

declare const ngDevMode: unknown;

const MODULE = 'NgNativeSearchField';

let warned = false;

/** Says once, in development, that the build has no native search field to draw. */
function warnMissing(): void {
  if ((typeof ngDevMode !== 'undefined' && !ngDevMode) || warned) return;
  warned = true;
  console.warn(
    '[angular-native] <search-field> is native code of @ng-native/expo, which this build does not ' +
      'have, so it draws nothing. Expo Go cannot load it: run a development build.',
  );
}

/**
 * The field's face by the PostScript name UIKit finds it by: expo-font registers it under the name
 * the app gives it, which `UIFont(name:)` does not know. Android's font manager finds that name.
 */
function fieldFontName(props: Record<string, unknown>, postScriptName: PostScriptNames): void {
  const family = props['fontFamily'];
  if (typeof family === 'string') props['fontFamily'] = postScriptName(family) ?? family;
}

@Component({
  selector: 'search-field',
  template: '',
  styles: ':host { height: 56px; }',
  host: {
    '[text]': 'value()',
    '[enabled]': '!disabled()',
    '[mostRecentEventCount]': 'eventCount()',
    '[placeholder]': 'placeholder()',
    '[showsCancelButton]': 'showsCancelButton()',
    '[autoCapitalize]': 'autoCapitalize()',
    '[tintColor]': 'tintColor()',
    // Fabric draws a view the build does not have as a placeholder box naming it.
    '[style.display]': 'missing ? "none" : undefined',
  },
})
export class SearchField {
  /**
   * The functions native defines on the view, or null where the build has no native search
   * field. Overridden in a test.
   */
  static readonly SOURCE = new InjectionToken<SearchFieldFunctions | null>(
    'angular-native.searchFieldSource',
    {
      factory: () =>
        optional(() => {
          const core = require('expo-modules-core') as typeof import('expo-modules-core');
          const module = core.requireOptionalNativeModule<{
            ViewPrototypes?: Record<string, SearchFieldFunctions>;
          }>(MODULE);
          return module ? (module.ViewPrototypes?.[MODULE] ?? {}) : null;
        }),
    },
  );

  /**
   * The text in the field: typing writes it, and text set from code is put in the field. A
   * `model()`, which is all `FormValueControl<string>` asks, so `[formField]` binds it.
   */
  readonly value = model('');
  /** Refuse input and show the field dimmed. Signal Forms' `disabled()` rule sets it. */
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly placeholder = input<string>();
  /**
   * iOS: whether the Cancel button shows. Left unset it shows while the field has the keyboard,
   * as in a search bar under a navigation bar.
   */
  readonly showsCancelButton = input(undefined, { transform: optionalBoolean });
  readonly autoCapitalize = input<'none' | 'words' | 'sentences' | 'characters'>();
  /** The colour of the cursor and the Cancel button. */
  readonly tintColor = input<string>();

  /** The keyboard's search key was pressed, with the text in the field. */
  readonly search = output<string>();
  /** iOS: the Cancel button was pressed. The field is emptied and gives up the keyboard. */
  readonly cancel = output<void>();
  readonly searchFocus = output<void>();
  readonly searchBlur = output<void>();
  /** The field gave up the keyboard: what Signal Forms marks a field touched from. */
  readonly touch = output<void>();

  /**
   * The keystroke the text answers, as React Native's text input counts them: native skips a text
   * older than what has been typed since, which a fast typist's echo otherwise overwrites.
   */
  protected readonly eventCount = signal(0);

  private readonly functions = inject(SearchField.SOURCE);
  protected readonly missing = !this.functions;
  private readonly node = inject(ElementRef).nativeElement as EngineNode;
  private readonly engine = inject(Engine, { optional: true });

  constructor() {
    registerViewName('search-field', expoViewName(MODULE), undefined, {
      fontNames: nativePlatform() === 'ios' ? fieldFontName : undefined,
    });
    if (this.missing) warnMissing();
    const host =
      (this.node as { host?: Pick<Engine, 'setEventListener'> }).host ?? inject(HostEngine);
    const listen = (event: string, handle: (payload: Record<string, unknown>) => void) =>
      host.setEventListener(this.node, event, (raw) =>
        handle((raw as NativeSyntheticEvent<Record<string, unknown>>)?.nativeEvent ?? {}),
      );
    const stops = [
      listen('topChangeText', ({ text, eventCount }) => {
        if (typeof eventCount === 'number') this.eventCount.set(eventCount);
        this.value.set(String(text ?? ''));
      }),
      // Named apart from the outputs: a native event of an output's name reaches its listener too.
      listen('topSubmitSearch', ({ text }) => this.search.emit(String(text ?? this.value()))),
      listen('topPressCancel', () => this.cancel.emit()),
      listen('topBeginEditing', () => this.searchFocus.emit()),
      listen('topEndEditing', () => {
        this.searchBlur.emit();
        this.touch.emit();
      }),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  /** Give the field the keyboard. Does nothing before the view has reached the screen. */
  async focus(): Promise<void> {
    await this.call('focus');
  }

  /** Take the keyboard away from the field. */
  async blur(): Promise<void> {
    await this.call('blur');
  }

  /** Empty the field, and the value with it. */
  clear(): void {
    this.value.set('');
  }

  private async call(name: 'focus' | 'blur'): Promise<void> {
    const nativeTag = this.engine?.tagOf(this.node);
    if (nativeTag == null) return;
    await this.functions?.[name]?.call({ nativeTag });
  }
}
