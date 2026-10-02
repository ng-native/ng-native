---
title: Background task
summary: Register work for the platform to run while the app is in the background.
---

# Background task

`BackgroundTask` registers work for the platform to run while the app is in the background, bound
to `expo-background-task`: WorkManager on Android and BGTaskScheduler on iOS.

The platform decides when a registered task runs. The interval is a minimum rather than a
schedule, and iOS in particular runs tasks in windows of its own, such as overnight. A task is for
work that can wait: syncing, pruning a cache, refreshing content before the user next opens the
app.

## Install

```sh
npx expo install expo-background-task expo-task-manager
```

```ts
import { BackgroundTask } from '@ng-native/expo/background-task';
```

## Defining the task

A background task runs through `expo-task-manager`. It loads the app's bundle and evaluates its
entry module, but does not run the app, so Angular is never bootstrapped: `main.ts` registers the
app with `AppRegistry.registerRunnable`, and only a launch with a screen runs that. The task
therefore goes at the top level of `main.ts`, beside that registration, and works without Angular -
no components, and no services from `inject()`:

```ts
// main.ts
import * as TaskManager from 'expo-task-manager';
import { BackgroundTaskResult } from '@ng-native/expo/background-task';

TaskManager.defineTask('sync', async () => {
  try {
    // Plain functions and modules only: fetch, write to storage, update the badge.
    return BackgroundTaskResult.Success;
  } catch {
    return BackgroundTaskResult.Failed;
  }
});

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  // mount(...) as before
});
```

Importing the `@ng-native/*` packages has no native side effects, so the task can share plain
modules - a storage wrapper, an API client - with the app, as long as they do not need an injector.

## The smallest useful example

Registering the task is the part the app does, from anywhere an injector is:

```ts
import { Component, inject } from '@angular/core';
import { BackgroundTask, BackgroundTaskStatus } from '@ng-native/expo/background-task';

@Component({
  selector: 'app-sync-settings',
  template: `<pressable (press)="enable()"><text>Sync in the background</text></pressable>`,
})
export class SyncSettings {
  private readonly tasks = inject(BackgroundTask);

  protected async enable(): Promise<void> {
    if ((await this.tasks.status()) !== BackgroundTaskStatus.Available) return;
    await this.tasks.register('sync', { minimumInterval: 60 });
  }
}
```

## What it does

- **`status()`** - whether the platform will run background work: `BackgroundTaskStatus.Available`
  on a device, `Restricted` on the web.
- **`register(name, options?)`** - asks the platform to run the task of that name, as defined with
  `expo-task-manager`. `minimumInterval` is in minutes: twelve hours by default, and never less than
  fifteen.
- **`unregister(name)`** - stops the platform running it.
- **`triggerForTesting()`** - runs every registered task now, in a debug build, rather than waiting
  for the platform. `false` in a release build.

`BackgroundTaskStatus` and `BackgroundTaskResult` are exported beside the service: the module's
own enums, typed as those enums, without loading the module, so code that uses them can run in a
test.

On iOS, background processing needs the `processing` background mode and the module's scheduler
identifier in `BGTaskSchedulerPermittedIdentifiers`. The module's config plugin adds both, so a
development build is needed after installing it.

## Without the module

On iOS and Android, a missing `expo-background-task` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `status()` resolves to
`BackgroundTaskStatus.Restricted`, `register()` and `unregister()` resolve without doing anything,
and `triggerForTesting()` resolves to `false`.

## Reference

<!-- api: BackgroundTask -->
