---
title: Processes
summary: The environment a desktop app was started with. Absent on iOS, Android and the web.
---

# Processes

`Processes` holds what a desktop OS gives an app and a phone does not: the environment variables it
was started with, in `env`. On iOS, Android and the web it is absent: `available()` is `false` and
`env` is empty.

```ts
import { Component, inject } from '@angular/core';
import { Processes } from '@ng-native/device';

@Component({ selector: 'app-about', template: `<text>{{ home }}</text>` })
export class About {
  private readonly processes = inject(Processes);
  protected readonly home = this.processes.env['HOME'] ?? '';
}
```

`env` is read once, as the service is made, and cannot be changed. It comes from the desktop host's
module, so it is empty on macOS too until the desktop host reports it.

## Reference

<!-- api: Processes -->
