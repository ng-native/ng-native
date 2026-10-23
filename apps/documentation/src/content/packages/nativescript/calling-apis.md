---
title: Calling native APIs
summary: Synchronous calls on the JavaScript thread, worklets on the UI thread, and which is which.
---

# Calling native APIs

A component calls native APIs through the `NativeScript` service. Which of its two methods a call
goes through depends on the thread the API needs.

## On the JavaScript thread: `call()`

`call()` runs the function for the platform the app is on, synchronously, and answers what it
returns:

```ts
import { Component, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { NativeScript } from '@ng-native/nativescript';

@Component({
  selector: 'app-time-zone',
  imports: [Text],
  template: `<text>{{ zone }}</text>`,
})
export class TimeZone {
  private readonly native = inject(NativeScript);

  protected readonly zone = this.native.call({
    ios: () => NSTimeZone.localTimeZone.name,
    android: () => java.util.TimeZone.getDefault().getID(),
  });
}
```

It answers `undefined` on a platform the object has no function for, and in Node. A call costs a
few microseconds on iOS, and about 0.3 milliseconds on Android, where it crosses JNI.

The function is plain TypeScript, so it reads the component's state, and what it returns is any
value: a native object comes back as a JavaScript proxy for it, and its properties and methods are
called the same way.

This is the thread the component runs on, React Native's JavaScript thread, which is not the
platform's main thread. An API that is not tied to the UI can be called from it: reading the
device, the process, the file system and other Foundation classes on iOS, and `java.*` and
`android.*` classes such as `android.os.Build` on Android. The UI cannot.

## On the UI thread: `runOnUI()`

UIKit runs only on the main thread, and NativeScript refuses a UIKit call made from anywhere else
with `Error: Call must be made on main thread`. `runOnUI()` runs a function on the main thread and
resolves to what it returns:

```ts
protected async tint(): Promise<void> {
  await this.native.runOnUI((name: string) => {
    'worklet';
    UIApplication.sharedApplication.keyWindow!.tintColor = UIColor.colorNamed(name);
  }, 'AccentColor');
}
```

The function is a [worklet](https://docs.swmansion.com/react-native-worklets/): the `'worklet'`
directive has the Babel plugin compile it to run on another JavaScript runtime, the one Worklets
keeps on the main thread. That has consequences for what it can read:

- It captures what it reads by value, as it is created. A worklet that reads `this.name()` captures
  the component, and every signal and service in it, and fails to copy them. Pass what it needs as
  arguments instead, after the function, as `'AccentColor'` is passed above.
- Arguments and the return value are copied between the runtimes: numbers, strings, booleans, plain
  objects and arrays. A promise cannot be, so a worklet answers synchronously or not at all.
- A native object can be passed in, and returned. Returned, it is a proxy on the JavaScript thread
  for an object made on the main thread: read it there, and touch a view only from a worklet.
- An error it throws rejects the promise `runOnUI()` returns.
- The functions it calls must be worklets too. A function passed in as an argument is one it can
  hand back to the JavaScript thread but not call.

### Answering later

A worklet cannot wait for the user, but it can call back when they answer. `scheduleOnRN` from
`react-native-worklets` runs a function given to the worklet on the JavaScript thread:

```ts
import { scheduleOnRN } from 'react-native-worklets';

protected async remove(): Promise<void> {
  // UIKit's alert, so iOS only; in Node there is no worklet to reply.
  if (this.native.platform !== 'ios') return;
  const choice = await new Promise<string>((answer, fail) =>
    this.native.runOnUI(
      (title: string, reply: (choice: string) => void) => {
        'worklet';
        const alert = UIAlertController.alertControllerWithTitleMessagePreferredStyle(
          title,
          null,
          UIAlertControllerStyle.Alert,
        );
        for (const choice of ['Cancel', 'Delete']) {
          alert.addAction(
            UIAlertAction.actionWithTitleStyleHandler(choice, UIAlertActionStyle.Default, () =>
              scheduleOnRN(reply, choice),
            ),
          );
        }
        let top = UIApplication.sharedApplication.keyWindow!.rootViewController!;
        while (top.presentedViewController) top = top.presentedViewController;
        top.presentViewControllerAnimatedCompletion(alert, true, () => {});
      },
      'Delete this note?',
      answer,
    ).catch(fail),
  );
}
```

The promise waits for `reply`, so it is settled the other ways too: `fail` rejects it when
`runOnUI()` does, and the method returns before waiting where there is no iOS runtime to run the
worklet.

A plain confirmation is [`Dialogs`](/packages/device/dialogs) already, on both platforms, with no
worklet. This is the shape for what nothing wraps: a delegate, a completion handler, a picker.

## On Android

Android has no Worklets UI runtime. `runOnUI()` runs the function on Android's main thread instead,
in the same JavaScript runtime: the main thread borrows it while the JavaScript thread waits. So the
function gets the caller's own values rather than copies, and a `View` can be touched in it:

```ts
import { androidContext } from '@ng-native/nativescript';

protected async toast(): Promise<void> {
  await this.native.runOnUI((text: string) => {
    'worklet';
    android.widget.Toast.makeText(androidContext() as android.content.Context, text, 0).show();
  }, 'Saved');
}
```

`androidContext()` is the current Activity, which a view or a dialog is made with. The `'worklet'`
directive does no harm on Android and lets one function serve both platforms, but the Babel plugin
still turns the function into a worklet, which drops its `this`: pass state in as arguments, as on
iOS.

A Java callback the main thread makes, such as a view's click listener, runs on the main thread
too, so it can update its view. Touching a view anywhere else, in `call()` for example, throws
`CalledFromWrongThreadException`.

## Types

Each platform's SDK is typed, from the declaration file [Setup](/packages/nativescript#setup) adds:
`UIDevice.currentDevice.model` is a `string`, and `android.os.Build.MODEL` too. Both platforms'
types are global at once, so a function for one platform can name the other's classes without a
type error; `call()` is what keeps it from running there.

## What a worklet can name

A worklet names native classes directly, `UILabel.new()`, because the [Babel
config](/packages/nativescript#the-babel-config) leaves any name the worklet does not declare to be
looked up on the runtime it runs on. A global the JavaScript thread has and the UI runtime does not,
one the app defined itself, fails in a worklet with a `ReferenceError`: pass it as an argument.
