/**
 * The platform's own dialogs: an alert, a confirmation, a prompt, an action sheet, a toast.
 *
 * All of these are callback APIs, and the reason to wrap them is that **a dialog is a question**.
 * `Alert.alert` hands its answer to one of several `onPress` callbacks, so asking something and
 * acting on the answer means splitting one thought across three functions. A promise puts it back
 * together, and `await` at the call site reads like what it is.
 *
 * The platform split is the other half. An action sheet is iOS's way of offering a short list of
 * choices and Android's is a dialog; a toast is Android's way of saying something small and iOS
 * has none. `choose` and `notify` pick per platform, so an app writes the intent rather than the
 * platform - and the one thing neither can do is fail silently on the platform it is not for.
 */

import { InjectionToken, Service, inject } from '@angular/core';
import { reactNative, type ReactNative } from './react-native.ts';

/** One choice in a dialog or an action sheet. */
export interface Choice {
  readonly label: string;
  /** `cancel` is dismissal; `destructive` is the one the platform paints red. */
  readonly style?: 'default' | 'cancel' | 'destructive';
}

export interface NativeDialogs {
  readonly platform: 'ios' | 'android' | string;
  alert(
    title: string,
    message: string | undefined,
    buttons: readonly { text: string; style?: string; onPress?: () => void }[],
  ): void;
  prompt?(
    title: string,
    message: string | undefined,
    onResult: (value: string | null) => void,
    defaultValue?: string,
  ): void;
  actionSheet?(
    options: {
      title?: string;
      options: string[];
      cancelButtonIndex: number;
      destructiveButtonIndex?: number;
    },
    onSelect: (index: number) => void,
  ): void;
  toast?(message: string, long: boolean): void;
}

/**
 * `inject(Dialogs).confirm('Delete this?', { destructive: true })`.
 *
 * A dialog is a question, so every method here resolves to the answer rather than handing it to
 * one of several callbacks.
 */
@Service()
export class Dialogs {
  /** Overridden in a test to answer a dialog without one being shown. */
  static readonly SOURCE = new InjectionToken<NativeDialogs | null>('angular-native.dialogSource', {
    factory: () => dialogSource(reactNative()),
  });

  private readonly native = inject(Dialogs.SOURCE);

  /** Say something, and wait until it has been read. Resolves when the dialog is dismissed. */
  tell(title: string, message?: string, dismiss = 'OK'): Promise<void> {
    return new Promise((resolve) => {
      if (!this.native) return resolve();
      this.native.alert(title, message, [{ text: dismiss, onPress: () => resolve() }]);
    });
  }

  /**
   * Ask something with two answers. Resolves to whether they agreed.
   *
   * `destructive` paints the confirm button as the platform paints a delete, and puts cancel where
   * the platform puts it - which on iOS is the *right*, so a confirmation dialog does not train
   * people to tap the wrong thing.
   */
  confirm(
    title: string,
    options: { message?: string; confirm?: string; cancel?: string; destructive?: boolean } = {},
  ): Promise<boolean> {
    const { message, confirm = 'OK', cancel = 'Cancel', destructive = false } = options;
    return new Promise((resolve) => {
      if (!this.native) return resolve(false);
      this.native.alert(title, message, [
        { text: cancel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirm,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ]);
    });
  }

  /**
   * Ask for a line of text. Resolves to null if they cancelled.
   *
   * iOS only: `Alert.prompt` has no Android equivalent, and inventing one out of a modal and a
   * text input would be a dialog that looks nothing like the platform's. On Android this resolves
   * to null so a caller can fall back to a screen of its own.
   */
  ask(title: string, options: { message?: string; value?: string } = {}): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.native?.prompt) return resolve(null);
      this.native.prompt(title, options.message, resolve, options.value);
    });
  }

  /**
   * Offer a short list of choices. Resolves to the index chosen, or null if dismissed.
   *
   * An action sheet on iOS and a dialog on Android, because that is what each platform means by
   * this. A `cancel` choice is where the platform puts cancel rather than in the list.
   */
  choose(title: string, choices: readonly Choice[]): Promise<number | null> {
    const cancelAt = choices.findIndex((choice) => choice.style === 'cancel');
    const destructiveAt = choices.findIndex((choice) => choice.style === 'destructive');

    return new Promise((resolve) => {
      if (!this.native) return resolve(null);

      if (this.native.actionSheet) {
        // iOS wants cancel last and named by index; a list with none gets one, because an action
        // sheet with no way out is one the user has to guess at.
        const labels = choices.map((choice) => choice.label);
        const cancelIndex = cancelAt >= 0 ? cancelAt : labels.push('Cancel') - 1;
        this.native.actionSheet(
          {
            title,
            options: labels,
            cancelButtonIndex: cancelIndex,
            ...(destructiveAt >= 0 ? { destructiveButtonIndex: destructiveAt } : {}),
          },
          (index) => resolve(index === cancelIndex ? null : index),
        );
        return;
      }

      /*
       * Android's alert is put up `cancelable: false` by React Native, so a press outside does
       * nothing and neither does the back button. Without a cancel among the choices there is no
       * way at all to decline - the user has to pick something - so one is appended, exactly as
       * the iOS branch above does for the same reason.
       *
       * Android's dialog holds three buttons: a negative, a neutral and a positive. Anything past
       * that is dropped by the platform without a word, and a choice the user cannot see is worse
       * than a list that refused to open, so it says so.
       */
      const buttons = choices.map((choice, index) => ({
        text: choice.label,
        style: choice.style,
        onPress: () => resolve(choice.style === 'cancel' ? null : index),
      }));
      if (cancelAt < 0) {
        buttons.push({ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) });
      }
      if (buttons.length > 3) {
        console.error(
          `[angular-native] Dialogs.choose was given ${choices.length} choices and Android shows ` +
            'at most three buttons, counting the cancel. The rest will not appear. Use a ' +
            '`ui-select` or an `action-sheet`-shaped list for anything longer.',
        );
      }
      this.native.alert(title, undefined, buttons);
    });
  }

  /**
   * Say something small and transient.
   *
   * A toast on Android. iOS has no such thing and never has, so this does nothing there rather
   * than putting up a modal alert for something that did not warrant interrupting anyone - and an
   * app that must be seen should use `tell`.
   */
  notify(message: string, options: { long?: boolean } = {}): void {
    this.native?.toast?.(message, options.long ?? false);
  }
}

/**
 * The platform's dialogs, from React Native's own modules.
 *
 * `Alert.prompt` and `ActionSheetIOS` are iOS-only and `ToastAndroid` is Android-only; each is
 * left absent rather than shimmed, which is what lets `ask`, `choose` and `notify` above decide
 * what to do about it.
 *
 * Which platform it is has to be asked outright, because React Native's own modules do not answer
 * it. `react-native` exports `ActionSheetIOS` on Android too - the object is there and so is
 * `showActionSheetWithOptions`; only the TurboModule underneath is null, and the invariant that
 * catches that throws out of the promise `choose` returns, so a press did nothing at all and said
 * nothing about it. `Alert.prompt` is worse: it exists on Android and its body is one
 * `Platform.OS === 'ios'` check, so it returns having called no callback and the promise `ask`
 * returns never settles. `ToastAndroid` is the mirror image on iOS. Presence is not capability
 * here; only the platform name is.
 */
export function dialogSource(
  native: Pick<ReactNative, 'Platform' | 'Alert' | 'ActionSheetIOS' | 'ToastAndroid'> | null,
): NativeDialogs | null {
  if (!native) return null;

  const ios = native.Platform.OS === 'ios';
  const android = native.Platform.OS === 'android';

  return {
    platform: native.Platform.OS,
    alert: (title, message, buttons) => native.Alert.alert(title, message, [...buttons]),
    // Buttons rather than a callback: given a callback, `Alert.prompt` answers OK alone, and the
    // Cancel the native alert adds calls nothing, so a cancelled `ask` never settled.
    ...(ios && native.Alert.prompt
      ? {
          prompt: (title, message, onResult, defaultValue) =>
            native.Alert.prompt!(
              title,
              message,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => onResult(null) },
                { text: 'OK', onPress: (value) => onResult(value ?? '') },
              ],
              undefined,
              defaultValue,
            ),
        }
      : {}),
    ...(ios && native.ActionSheetIOS
      ? {
          actionSheet: (options, onSelect) =>
            native.ActionSheetIOS!.showActionSheetWithOptions(options, onSelect),
        }
      : {}),
    ...(android && native.ToastAndroid
      ? {
          toast: (message, long) =>
            native.ToastAndroid!.show(
              message,
              long ? native.ToastAndroid!.LONG : native.ToastAndroid!.SHORT,
            ),
        }
      : {}),
  };
}
