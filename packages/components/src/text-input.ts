import {
  Directive,
  type SimpleChanges,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { Keyboard } from '@ng-native/device';
import type { NativeSyntheticEvent } from '@ng-native/fabric';
import { ControlledModel } from './controlled-model.ts';
import type { SelectionChangePayload, TextInputChangePayload } from './events.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';
import { ViewBase } from './view-base.ts';

export type KeyboardType =
  | 'default'
  | 'number-pad'
  | 'decimal-pad'
  | 'numeric'
  | 'email-address'
  | 'phone-pad'
  | 'url'
  | 'ascii-capable'
  | 'numbers-and-punctuation'
  | 'name-phone-pad'
  | 'twitter'
  | 'web-search'
  | 'visible-password';
export type ReturnKeyType =
  | 'done'
  | 'go'
  | 'next'
  | 'search'
  | 'send'
  | 'none'
  | 'previous'
  | 'default'
  | 'emergency-call'
  | 'google'
  | 'join'
  | 'route'
  | 'yahoo';
export type SubmitBehavior = 'submit' | 'blurAndSubmit' | 'newline';

/**
 * A text field, wired for signal forms. Commits as `TextInput`, single or multi line by prop.
 *
 * `value` is a `model()`, which is all `FormValueControl<string>` requires, so binding it into a
 * form is `<text-input [formField]="f.name" />` with no adapter class. The rest of the contract is
 * declared too, because Signal Forms only writes to inputs of those names: `disabled` and
 * `readonly` turn `editable` off, `invalid` and `touched` come out as `data-invalid` and
 * `data-touched` for a stylesheet, and `touch` fires from the native blur - there is no DOM one
 * for the form to hear instead. `(changeText)` carries
 * the new string alone, as RN's `onChangeText` does; the raw `(change)`, `(focus)`, `(blur)`,
 * `(submitEditing)`, `(endEditing)`, `(selectionChange)`, `(keyPress)`, `(contentSizeChange)`
 * and `(scroll)` are element events typed in `events.ts`.
 *
 * The interesting part is the echo. A native text field owns state the user is actively
 * changing, so JS and native disagree constantly. RN's protocol: native reports an `eventCount`
 * with every change, JS passes the most recent one back, and native ignores a `text` update whose
 * count is stale, meaning the user has typed since. Without it, a controlled input fights the
 * cursor and drops characters under fast typing.
 *
 * The engine commits the count as the `mostRecentEventCount` prop. Android takes the latest, as RN
 * sends it; iOS takes 0 but where a multiline field's text style changes, since an echo with the
 * current count replaces an empty field's first typed text there and drops the keystrokes queued
 * behind it (see `echoedEventCount` in the engine). Text from code reaches iOS as the command
 * below instead, which carries the count.
 *
 * The other direction is native holding text the app does not: a value set from code after the
 * user has typed, or a keystroke the app refused or rewrote. It is controlled as RN's field is -
 * bind `value` and the app's value is what the field shows - so once each pass has rendered, the
 * field compares the model with the text native last reported and sends the difference as the
 * `setTextAndSelection` command. See `ControlledModel` for how a refusal reaches the model.
 * A value set that way is also measured again, since Fabric sizes the field from native state
 * that takes the new text only after measuring it: a composer cleared after sending shrinks.
 */
@Directive({
  selector: 'text-input',
  exportAs: 'textInput',
  host: {
    '[text]': 'value()',
    '[latestEventCount]': 'eventCount()',
    '[multiline]': 'multiline()',
    '[scrollEnabled]': 'scrollEnabled()',
    '[editable]': 'resolvedEditable()',
    // `disabled` is an input of ours, so it cannot reach `ngOnChanges` on the base; this is
    // the one binding that keeps the announced state in step with it.
    '[accessibilityState]': 'accessibilityStateProp()',
    '[attr.data-disabled]': "disabled() ? '' : null",
    '[attr.data-invalid]': "invalid() ? '' : null",
    '[attr.data-touched]': "touched() ? '' : null",
    '(blur)': 'touch.emit()',
    '(focus)': 'onFocus()',
    '[placeholder]': 'placeholder()',
    '[placeholderTextColor]': 'placeholderTextColor()',
    '[keyboardType]': 'keyboardType()',
    '[returnKeyType]': 'returnKeyType()',
    '[submitBehavior]': 'resolvedSubmitBehavior()',
    '[secureTextEntry]': 'secureTextEntry()',
    '[autoCapitalize]': 'autoCapitalize()',
    '[autoCorrect]': 'autoCorrect()',
    '[autoFocus]': 'autoFocus()',
    '[maxLength]': 'maxLength()',
    '[numberOfLines]': 'numberOfLines()',
    '[rows]': 'rows()',
    '[selection]': 'resolvedSelection()',
    '[selectionColor]': 'selectionColor()',
    '[selectTextOnFocus]': 'selectTextOnFocus()',
    '[caretHidden]': 'caretHidden()',
    '[contextMenuHidden]': 'contextMenuHidden()',
    '[textAlign]': 'textAlign()',
    '[allowFontScaling]': 'allowFontScaling()',
    '[maxFontSizeMultiplier]': 'maxFontSizeMultiplier()',
    '[inputAccessoryViewID]': 'inputAccessoryViewID()',
    '[clearButtonMode]': 'clearButtonMode()',
    '[clearTextOnFocus]': 'clearTextOnFocus()',
    '[enablesReturnKeyAutomatically]': 'enablesReturnKeyAutomatically()',
    '[keyboardAppearance]': 'keyboardAppearance()',
    '[passwordRules]': 'passwordRules()',
    '[spellCheck]': 'spellCheck()',
    '[smartInsertDelete]': 'smartInsertDelete()',
    '[dataDetectorTypes]': 'dataDetectorTypes()',
    '[textContentType]': 'textContentType()',
    '[autoComplete]': 'autoComplete()',
    '[underlineColorAndroid]': 'underlineColorAndroid()',
    '[cursorColor]': 'resolvedCursorColor()',
    '[selectionHandleColor]': 'resolvedSelectionHandleColor()',
    '[textAlignVertical]': 'textAlignVertical()',
    '[importantForAutofill]': 'importantForAutofill()',
    '[showSoftInputOnFocus]': 'showSoftInputOnFocus()',
    '[disableFullscreenUI]': 'disableFullscreenUI()',
    '[inlineImageLeft]': 'inlineImageLeft()',
    '[inlineImagePadding]': 'inlineImagePadding()',
    '[textBreakStrategy]': 'textBreakStrategy()',
    '(change)': 'onNativeChange($event)',
    '(selectionChange)': 'onNativeSelectionChange($event)',
  },
})
export class TextInput extends ViewBase {
  readonly value = model<string>('');
  /** The new text alone, on every native change. */
  readonly changeText = output<string>();
  /** Focus left the field. What Signal Forms marks a field touched from. */
  readonly touch = output<void>();

  /** Refuse input and announce as disabled. Wins over `editable`. */
  readonly disabled = input(undefined, { transform: optionalBoolean });
  /** Refuse input, though still announced as enabled. Wins over `editable`. */
  readonly readonly = input(undefined, { transform: optionalBoolean });
  /** Published as `data-invalid`; nothing native reads it. */
  readonly invalid = input(false, { transform: booleanAttribute });
  /** Published as `data-touched`; nothing native reads it. */
  readonly touched = input(false, { transform: booleanAttribute });

  /** Allow more than one line. */
  readonly multiline = input(undefined, { transform: optionalBoolean });
  /** iOS: whether a multiline field scrolls its text; off, it grows with it instead. */
  readonly scrollEnabled = input(undefined, { transform: optionalBoolean });
  /** Set to false to make the field read-only. */
  readonly editable = input(undefined, { transform: optionalBoolean });
  /** Shown while the field is empty. */
  readonly placeholder = input<string>();
  readonly placeholderTextColor = input<string>();
  /** Which keyboard to show. */
  readonly keyboardType = input<KeyboardType>();
  /** The label on the return key. */
  readonly returnKeyType = input<ReturnKeyType>();
  /** What return does. Defaults to `blurAndSubmit` on one line and `newline` on many. */
  readonly submitBehavior = input<SubmitBehavior>();
  /** Hide what is typed, for passwords. */
  readonly secureTextEntry = input(undefined, { transform: optionalBoolean });
  /** When the keyboard capitalises. Defaults to `sentences`. */
  readonly autoCapitalize = input<'none' | 'sentences' | 'words' | 'characters'>();
  /** Auto-correct while typing. Defaults to true. */
  readonly autoCorrect = input(undefined, { transform: optionalBoolean });
  /** Focus the field as soon as it mounts. */
  readonly autoFocus = input(undefined, { transform: optionalBoolean });
  /** The most characters allowed, enforced natively so nothing flickers. */
  readonly maxLength = input(undefined, { transform: optionalNumber });
  /** Android: the height of a multiline field, in lines. */
  readonly numberOfLines = input(undefined, { transform: optionalNumber });
  /**
   * How many lines of its `line-height` a multiline field is tall, where nothing sets its height,
   * as a `<textarea rows>` is. Read by the engine, which sizes the field; never sent to native.
   */
  readonly rows = input(undefined, { transform: optionalNumber });
  /**
   * The selected range, or the caret when `end` is left out or equals `start`. Sent to native
   * whenever it differs from what native last had, so a caret the user moves goes back to it.
   */
  readonly selection = input<{ readonly start: number; readonly end?: number }>();
  readonly selectionColor = input<string>();
  /** Select everything on focus. */
  readonly selectTextOnFocus = input(undefined, { transform: optionalBoolean });
  readonly caretHidden = input(undefined, { transform: optionalBoolean });
  /** Disable the copy, paste and share menu. */
  readonly contextMenuHidden = input(undefined, { transform: optionalBoolean });
  readonly textAlign = input<'left' | 'center' | 'right'>();
  readonly allowFontScaling = input(undefined, { transform: optionalBoolean });
  readonly maxFontSizeMultiplier = input(undefined, { transform: optionalNumber });
  /** iOS: the `nativeID` of an `<input-accessory-view>` to dock above the keyboard. */
  readonly inputAccessoryViewID = input<string>();
  /** iOS: when the clear button shows. */
  readonly clearButtonMode = input<'never' | 'while-editing' | 'unless-editing' | 'always'>();
  /** iOS: empty the field on focus. */
  readonly clearTextOnFocus = input(undefined, { transform: optionalBoolean });
  /** iOS: disable the return key while the field is empty. */
  readonly enablesReturnKeyAutomatically = input(undefined, { transform: optionalBoolean });
  /** iOS: the keyboard's colour scheme. */
  readonly keyboardAppearance = input<'default' | 'light' | 'dark'>();
  /** iOS: rules for a generated password, in Apple's Password Rules syntax. */
  readonly passwordRules = input<string>();
  /** iOS: underline misspellings. Follows `autoCorrect` by default. */
  readonly spellCheck = input(undefined, { transform: optionalBoolean });
  /** iOS: add and remove spaces around pasted and deleted words. */
  readonly smartInsertDelete = input(undefined, { transform: optionalBoolean });
  /** iOS, multiline: turn phone numbers, links and addresses into taps. */
  readonly dataDetectorTypes = input<string | readonly string[]>();
  /** iOS: what the field holds, so the system can autofill it. */
  readonly textContentType = input<string>();
  /** Android: the autofill hint. */
  readonly autoComplete = input<string>();
  /**
   * Android: the underline colour, transparent by default.
   *
   * Not a taste call. Android's `EditText` carries the platform's own underline in its background
   * drawable, so a field with a border of its own draws two: the app's box, and a grey line
   * through it that turns blue on focus. React Native's `TextInput` defaults this prop to
   * `'transparent'` for exactly that reason, and this is that default rather than a new opinion.
   * Ignored on iOS, where the native field has no such chrome.
   */
  readonly underlineColorAndroid = input<string>('transparent');
  /** Android: the caret colour. Follows `selectionColor` by default, as RN's does. */
  readonly cursorColor = input<string>();
  /** Android: the selection handle colour. Follows `selectionColor` by default, as RN's does. */
  readonly selectionHandleColor = input<string>();
  /** Android: where text sits in a tall field. */
  readonly textAlignVertical = input<'auto' | 'top' | 'bottom' | 'center'>();
  /** Android: whether autofill may fill this field. */
  readonly importantForAutofill = input<
    'auto' | 'no' | 'noExcludeDescendants' | 'yes' | 'yesExcludeDescendants'
  >();
  /** Android: set to false to focus without raising the keyboard. */
  readonly showSoftInputOnFocus = input(undefined, { transform: optionalBoolean });
  /** Android: keep the field in place in landscape rather than going full screen. */
  readonly disableFullscreenUI = input(undefined, { transform: optionalBoolean });
  /** Android: a drawable resource shown at the left of the field. */
  readonly inlineImageLeft = input<string>();
  readonly inlineImagePadding = input(undefined, { transform: optionalNumber });
  /** Android: the line-breaking strategy. */
  readonly textBreakStrategy = input<'simple' | 'highQuality' | 'balanced'>();

  protected readonly eventCount = signal(0);

  /** RN's normalised selection: an `end` left out is `start`, where iOS would read 0. */
  protected readonly resolvedSelection = computed(() => {
    const selection = this.selection();
    return selection
      ? { start: selection.start, end: selection.end ?? selection.start }
      : undefined;
  });

  // RN's Android defaults, checked against `undefined` as RN does rather than with `??`.
  protected readonly resolvedCursorColor = computed(() => {
    const color = this.cursorColor();
    return color === undefined ? this.selectionColor() : color;
  });
  protected readonly resolvedSelectionHandleColor = computed(() => {
    const color = this.selectionHandleColor();
    return color === undefined ? this.selectionColor() : color;
  });

  protected readonly resolvedEditable = computed(() =>
    this.disabled() || this.readonly() ? false : this.editable(),
  );

  protected override disabledForAccessibility(): boolean | undefined {
    return this.disabled();
  }

  protected readonly resolvedSubmitBehavior = computed(() => {
    const explicit = this.submitBehavior();
    // A single-line field has no line to add, so `newline` collapses to the default.
    if (explicit && (this.multiline() || explicit !== 'newline')) return explicit;
    return this.multiline() ? 'newline' : 'blurAndSubmit';
  });

  private readonly keyboard = inject(Keyboard);
  /** What native last reported, so a value set from code can be told from an echo. */
  private lastNativeText: string | null = null;
  /**
   * The selection native last had, sent or reported, so a bound one is sent only when it differs.
   * Unset to start with, so the first bound selection goes out too.
   */
  private lastSelection = { start: -1, end: -1 };
  /** Moved on every reported selection, so the bound one is compared with it again. */
  private readonly selectionReports = signal(0);
  private readonly control = new ControlledModel(this.value, 'value');

  constructor() {
    super();
    // RN's layout effect, keyed as RN keys it: the value, the selection, and the count every
    // native change moves on, so a refusal that leaves the value where it was is compared all the
    // same. After render rather than as an ordinary effect, because an accepted edit only reaches
    // the model during change detection, and comparing before it has would send the old text back.
    afterRenderEffect({ write: () => this.syncWithNative() });
  }

  override ngOnChanges(changes: SimpleChanges): void {
    super.ngOnChanges(changes);
    this.control.noteChanges(changes);
  }

  /**
   * With the keyboard already up, keep the field clear of it. UIKit scrolls a field clear as the
   * keyboard rises, not when focus moves from one field to another beneath it, which is what a
   * form's Next key does; native form screens keep the new field on screen either way.
   */
  protected onFocus(): void {
    const { height, screenY } = this.keyboard.metrics();
    if (height > 0 && screenY !== undefined)
      this.engine.reveal(this.node, { visibleBottom: screenY - this.keyboard.windowTop });
  }

  /** Bring the keyboard up on this field. A view command, so it reaches native directly. */
  focus(): void {
    this.engine.dispatchCommand(this.node, 'focus');
  }

  blur(): void {
    this.engine.dispatchCommand(this.node, 'blur');
  }

  /** Empty the field. */
  clear(): void {
    this.value.set('');
  }

  /** Move the caret, or select a range. */
  setSelection(start: number, end = start): void {
    this.engine.dispatchCommand(this.node, 'setTextAndSelection', [
      this.eventCount(),
      null,
      start,
      end,
    ]);
  }

  /** Whether this field currently has the keyboard. */
  isFocused(): boolean {
    return this.engine.focused === this.node;
  }

  protected onNativeChange(event: NativeSyntheticEvent<Partial<TextInputChangePayload>>): void {
    const native = event.nativeEvent;
    const text = native?.text ?? '';
    // Order matters, as it does in RN: the value first, the count last.
    this.lastNativeText = text;
    this.control.propose(text);
    this.eventCount.set(native?.eventCount ?? this.eventCount() + 1);
    this.changeText.emit(text);
  }

  /** Send native the text and selection it does not have, as one `setTextAndSelection`. */
  private syncWithNative(): void {
    const desired = this.value();
    const count = this.eventCount();
    const selection = this.resolvedSelection();
    this.selectionReports();
    const textChanged = this.lastNativeText !== null && this.lastNativeText !== desired;
    if (!textChanged && !this.differsFromNative(selection)) return;
    if (textChanged) this.lastNativeText = desired;
    if (selection) this.lastSelection = selection;
    // The `text` prop alone may be ignored as stale, so send it as a command with the count
    // native expects, and the text and bound selection as RN does whichever of them changed.
    this.engine.dispatchCommand(this.node, 'setTextAndSelection', [
      count,
      desired,
      selection?.start ?? -1,
      selection?.end ?? -1,
    ]);
    // Fabric sized the field for the text it had; see `HostEngine.remeasure`.
    if (textChanged) this.engine.remeasure(this.node);
  }

  /**
   * Whether a bound selection is not the one native last had. The prop alone does not move the
   * caret: Android has no `selection` prop, and iOS reads it only as the field appears or its
   * text is replaced.
   */
  private differsFromNative(selection: { start: number; end: number } | undefined): boolean {
    return (
      selection !== undefined &&
      (selection.start !== this.lastSelection.start || selection.end !== this.lastSelection.end)
    );
  }

  /** What native now has selected, which a bound selection that differs is sent over again. */
  protected onNativeSelectionChange(
    event: NativeSyntheticEvent<Partial<SelectionChangePayload>>,
  ): void {
    const selection = event.nativeEvent?.selection;
    if (!selection) return;
    this.lastSelection = { start: selection.start, end: selection.end };
    this.selectionReports.update((n) => n + 1);
  }
}
