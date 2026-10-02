---
title: Testing with services
summary: Replacing an injected dependency with a stand-in for the test.
---

# Testing with services

Continues from [Writing a test](/packages/testing/writing-a-test). `providers` are the providers of
the app the component is mounted in, so replacing a service with a stand-in is ordinary dependency
injection:

```ts
import { Component, Injectable, inject, resource } from '@angular/core';
import { Text } from '@ng-native/components';
import { render, screen } from '@ng-native/testing';
import { expect, it } from 'vitest';

@Injectable({ providedIn: 'root' })
class Weather {
  today(): Promise<string> {
    return fetch('https://example.com/weather').then((response) => response.text());
  }
}

@Component({
  selector: 'app-forecast',
  imports: [Text],
  template: '<text>{{ forecast.value() ?? "..." }}</text>',
})
class Forecast {
  private readonly weather = inject(Weather);
  protected readonly forecast = resource({ loader: () => this.weather.today() });
}

it('replaces a service with a stand-in', async () => {
  await render(Forecast, {
    providers: [{ provide: Weather, useValue: { today: async () => 'Sunny' } }],
  });

  expect(await screen.findByText('Sunny')).toBeTruthy();
});
```

`Weather` is written with `@Injectable({ providedIn: 'root' })` rather than `@Service()` on
purpose: both forms declare a root-scoped service, and a test resolves either the same way.

## A service on its own

A service with no component to render goes through `injectService()`. It creates the service in a
fresh app's root injector, built with the `providers` given, so a `@Service()` and every root
service it injects resolve as they do in the app. There is no `TestBed` to configure, and
`Injector.create()` does not stand in for one: an injector made that way has no root scope, so it
finds no `@Service()` or `providedIn: 'root'` class.

```ts
import { Service, inject } from '@angular/core';
import { injectService } from '@ng-native/testing';
import { expect, it } from 'vitest';

@Service()
class Outlook {
  private readonly weather = inject(Weather);

  async headline(): Promise<string> {
    return `Today: ${await this.weather.today()}`;
  }
}

it('tests a service on its own', async () => {
  const outlook = injectService(Outlook, {
    providers: [{ provide: Weather, useValue: { today: async () => 'Sunny' } }],
  });

  expect(await outlook.headline()).toBe('Today: Sunny');
});
```

`cleanup()` destroys the app, which runs the service's `DestroyRef` callbacks, just as it unmounts
a render.
