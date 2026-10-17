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
- A native object can be passed in as an argument, but not returned: `runOnUI()` rejects a worklet
  that returns one. NativeScript cannot release a native object handed from the UI runtime to the
  JavaScript one when the JavaScript reloads, and the app crashes. Return what the JavaScript thread
  needs from it instead, such as its `text`.
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

Android's runtime has no worklet runtime yet, so `runOnUI()` runs the function on the JavaScript
thread, where `call()` does. That thread has a looper, so an API that only needs one works from
it, a `Toast` among them. A `View` does not: touching one throws
`CalledFromWrongThreadException: Only the original thread that created a view hierarchy can touch
its views`, which `call()` and `runOnUI()` pass on as an error. A callback the platform runs on its
main thread, such as a `Runnable` posted to the main looper, runs its JavaScript on the JavaScript
thread, so it cannot touch one either.

So on Android, NativeScript reaches every non-UI API, and views stay with
[Expo modules](/guide/native-modules) and the [components](/packages/components).

### Reloading the JavaScript

On Android, NativeScript installs once per process and does not survive the JavaScript being
reloaded, by the dev menu, by pressing `r`, or by `expo-updates` applying an update. After a reload,
calls fail with an error saying the app needs restarting, and the app can crash as NativeScript
releases objects that belonged to the JavaScript before the reload. Restart the app after a reload;
Fast Refresh, which does not reload the JavaScript, is unaffected. iOS installs again on every
reload.

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
