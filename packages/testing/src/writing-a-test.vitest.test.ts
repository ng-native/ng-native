/**
 * Every sample on the "Writing a test" docs page, run as written. The page quotes this file; a
 * change here is a change there.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  Component,
  Injectable,
  Service,
  inject,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormField, disabled, form, required } from '@angular/forms/signals';
import { withComponentInputBinding } from '@angular/router';
import { Pressable, Text, TextInput, View } from '@ng-native/components';
import { provideNativeHttpClient } from '@ng-native/platform/http';
import {
  NativeRouterLink,
  NativeStackOutlet,
  provideNativeRouter,
  withLinkParent,
} from '@ng-native/router';
import { injectService, render, screen, userEvent, waitFor, within } from '@ng-native/testing';

@Component({
  selector: 'app-counter',
  imports: [Pressable, Text, View],
  template: `
    <view>
      <text>{{ count() }}</text>
      <pressable
        accessibilityRole="button"
        accessibilityLabel="Count"
        (press)="count.set(count() + 1)"
      >
        <text>+1</text>
      </pressable>
    </view>
  `,
})
class Counter {
  protected readonly count = signal(0);
}

describe('rendering', () => {
  it('counts a press', async () => {
    await render(Counter);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Count' }));

    expect(screen.getByText('1')).toBeTruthy();
  });
});

@Component({
  selector: 'app-greeting',
  imports: [Pressable, Text],
  template: `
    <pressable accessibilityRole="button" (press)="greeted.emit(name())">
      <text>Hello, {{ name() }}</text>
    </pressable>
  `,
})
class Greeting {
  readonly name = input.required<string>();
  readonly greeted = output<string>();
}

describe('inputs and outputs', () => {
  it('takes inputs and listens to outputs on the class', async () => {
    const greeted = vi.fn();
    await render(Greeting, { inputs: { name: 'Ada' }, on: { greeted } });

    await userEvent.press(screen.getByRole('button', { name: 'Hello, Ada' }));

    expect(greeted).toHaveBeenCalledWith('Ada');
  });

  it('renders a template, as a parent would use the component', async () => {
    const greeted = vi.fn();
    await render('<app-greeting [name]="name" (greeted)="greeted($event)" />', {
      imports: [Greeting],
      componentProperties: { name: 'Grace', greeted },
    });

    await userEvent.press(screen.getByRole('button', { name: 'Hello, Grace' }));

    expect(greeted).toHaveBeenCalledWith('Grace');
  });

  it('rerenders with new inputs', async () => {
    const { rerender } = await render(Greeting, { inputs: { name: 'Ada' } });

    await rerender({ inputs: { name: 'Grace' } });

    expect(screen.getByText('Hello, Grace')).toBeTruthy();
  });
});

@Component({
  selector: 'app-sign-up',
  imports: [FormField, Pressable, Text, TextInput, View],
  template: `
    <view>
      <text-input
        accessibilityLabel="Email"
        placeholder="you@example.com"
        [formField]="signUp.email"
      />
      @if (signUp.email().touched() && signUp.email().invalid()) {
        <text accessibilityRole="alert">Email is required</text>
      }
      <pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Busy"
        [accessibilityState]="{ checked: busy() }"
        (press)="busy.set(!busy())"
      >
        <text>Busy</text>
      </pressable>
      <pressable
        accessibilityRole="button"
        [disabled]="signUp().invalid()"
        (press)="submitted.set(model().email)"
      >
        <text>Sign up</text>
      </pressable>
      @if (submitted()) {
        <text>Welcome, {{ submitted() }}</text>
      }
    </view>
  `,
})
class SignUp {
  protected readonly busy = signal(false);
  protected readonly model = signal({ email: '' });
  protected readonly submitted = signal('');
  protected readonly signUp = form(this.model, (path) => {
    required(path.email);
    disabled(path.email, () => this.busy());
  });
}

describe('a form', () => {
  it('types, then presses', async () => {
    const user = userEvent.setup();
    await render(SignUp);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.press(screen.getByRole('button', { name: 'Sign up' }));

    expect(screen.getByText('Welcome, ada@example.com')).toBeTruthy();
    expect(screen.getByDisplayValue('ada@example.com')).toBeTruthy();
  });

  it('says a field is required once it has been touched', async () => {
    const user = userEvent.setup();
    await render(SignUp);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.type(screen.getByPlaceholderText('you@example.com'), 'a');
    await user.clear(screen.getByPlaceholderText('you@example.com'));

    expect(within(screen.getByRole('alert')).getByText('Email is required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign up' }).props['accessibilityState']).toEqual({
      disabled: true,
    });
  });

  it('stops the field taking input while the form disables it', async () => {
    const user = userEvent.setup();
    await render(SignUp);

    await user.press(screen.getByRole('checkbox', { name: 'Busy' }));

    expect(screen.getByLabelText('Email').props['editable']).toBe(false);
    await user.type(screen.getByLabelText('Email'), 'ignored');
    expect(screen.queryByDisplayValue('ignored')).toBeNull();
  });
});

@Component({
  selector: 'app-later',
  imports: [Text],
  template: `
    @if (ready()) {
      <text>Loaded</text>
    } @else {
      <text>Loading</text>
    }
  `,
})
class Later {
  protected readonly ready = signal(false);
  constructor() {
    setTimeout(() => this.ready.set(true), 100);
  }
}

describe('async work', () => {
  it('finds what arrives later', async () => {
    await render(Later);

    expect(await screen.findByText('Loaded')).toBeTruthy();
  });

  it('waits for an assertion to pass', async () => {
    await render(Later);

    await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
  });
});

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

@Service()
class Outlook {
  private readonly weather = inject(Weather);

  async headline(): Promise<string> {
    return `Today: ${await this.weather.today()}`;
  }
}

describe('services', () => {
  it('replaces a service with a stand-in', async () => {
    await render(Forecast, {
      providers: [{ provide: Weather, useValue: { today: async () => 'Sunny' } }],
    });

    expect(await screen.findByText('Sunny')).toBeTruthy();
  });

  it('tests a service on its own', async () => {
    const outlook = injectService(Outlook, {
      providers: [{ provide: Weather, useValue: { today: async () => 'Sunny' } }],
    });

    expect(await outlook.headline()).toBe('Today: Sunny');
  });
});

@Component({
  selector: 'app-profile',
  imports: [Text],
  template: '<text>{{ name() }}</text>',
})
class Profile {
  protected readonly name = signal('...');
  constructor() {
    inject(HttpClient)
      .get<{ name: string }>('/api/me')
      .subscribe((me) => this.name.set(me.name));
  }
}

describe('HttpClient', () => {
  it('answers a request from the test', async () => {
    const { componentRef } = await render(Profile, {
      providers: [provideNativeHttpClient(), provideHttpClientTesting()],
    });
    const http = componentRef.injector.get(HttpTestingController);

    http.expectOne('/api/me').flush({ name: 'Ada' });

    expect(await screen.findByText('Ada')).toBeTruthy();
    http.verify();
  });
});

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

@Component({
  selector: 'app-badge',
  imports: [Text, View],
  template: '<view testID="badge" class="badge"><text>New</text></view>',
})
class Badge {}

describe('styling', () => {
  it('applies a global stylesheet', async () => {
    await render(Badge, {
      globalStyles: compileCss('.badge { background-color: rgb(1, 2, 3) }', 'global'),
    });

    expect(screen.getByTestId('badge').props['backgroundColor']).toBe('rgb(1, 2, 3)');
  });
});

@Component({
  selector: 'app-home',
  imports: [NativeRouterLink, Pressable, Text],
  template: `
    <pressable accessibilityRole="button" nativeRouterLink="/about">
      <text>About us</text>
    </pressable>
  `,
})
class Home {}

@Component({ selector: 'app-about', imports: [Text], template: '<text>We make apps</text>' })
class About {}

@Component({ selector: 'app-trip', imports: [Text], template: '<text>Trip {{ id() }}</text>' })
class Trip {
  readonly id = input.required<string>();
}

@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
class App {}

describe('routing', () => {
  it('pushes a screen when a link is pressed', async () => {
    await render(App, {
      providers: [
        provideNativeRouter([
          { path: '', component: Home },
          { path: 'about', component: About },
        ]),
      ],
    });

    await userEvent.press(screen.getByRole('button', { name: 'About us' }));

    expect(await screen.findByText('We make apps')).toBeTruthy();
  });

  it("passes Angular's router features through, so a route parameter arrives as an input", async () => {
    await render(App, {
      providers: [
        provideNativeRouter(
          [
            { path: '', redirectTo: 'trip/lisbon', pathMatch: 'full' },
            { path: 'trip/:id', component: Trip },
          ],
          withComponentInputBinding(),
        ),
      ],
    });

    expect(await screen.findByText('Trip lisbon')).toBeTruthy();
  });

  it('takes its native option as a feature beside Angular ones, and still routes', async () => {
    await render(App, {
      providers: [
        provideNativeRouter(
          [
            { path: '', component: Home },
            { path: 'about', component: About },
          ],
          withLinkParent((url) => (url.startsWith('/about/') ? '/about' : null)),
          withComponentInputBinding(),
        ),
      ],
    });

    await userEvent.press(screen.getByRole('button', { name: 'About us' }));

    expect(await screen.findByText('We make apps')).toBeTruthy();
  });
});

describe('debugging', () => {
  it('prints the committed tree', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await render(Counter);

    screen.debug();

    expect(log.mock.calls[0]![0]).toMatch(
      /View accessibilityRole="button" accessibilityLabel="Count"/,
    );
    log.mockRestore();
  });
});
