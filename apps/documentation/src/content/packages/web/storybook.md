---
title: Storybook
summary: A Storybook catalogue of your Angular Native components, rendered by the web host.
---

# Storybook

Storybook's HTML framework for Vite, `@storybook/html-vite`, runs Angular Native components with
two additions: `ngNativeWeb()` in its Vite config, and a `render` function that mounts each story's
component with `mount`. A story names its component in `parameters`, and its args become the
component's inputs.

Storybook's Angular framework, `@storybook/angular`, builds with the Angular CLI's builders, which do
not build `@ng-native/*` ([The Angular CLI](/packages/web#the-angular-cli) covers why).

## Setting it up

In a browser app set up as in [Setting up a browser app](/packages/web#setting-up-a-browser-app):

```sh
npm install --save-dev storybook@10.6.1 @storybook/html-vite@10.6.1 @storybook/addon-docs@10.6.1
```

Every release of these packages is checked on Storybook 10.6.1 and Vite 8.3.2.

`.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/html-vite';
import { ngNativeWeb } from '@ng-native/web/vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../src/**/*.stories.ts'],
  addons: ['@storybook/addon-docs'],
  viteFinal: (config) => mergeConfig(config, { plugins: [ngNativeWeb()] }),
};

export default config;
```

`.storybook/preview.ts`:

```ts
import { mount, type MountResult } from '@ng-native/web';
import type { Preview } from '@storybook/html-vite';

const mounted = new WeakMap<HTMLElement, MountResult>();

function unmount(canvas: HTMLElement): void {
  mounted.get(canvas)?.destroy();
  mounted.delete(canvas);
}

const preview: Preview = {
  tags: ['autodocs'],
  render: (args, { parameters, canvasElement }) => {
    unmount(canvasElement);
    const root = document.createElement('div');
    mounted.set(canvasElement, mount(root, parameters.component, { inputs: args }));
    return root;
  },
  beforeEach: ({ canvasElement }) => {
    return () => unmount(canvasElement);
  },
};

export default preview;
```

Each story mounts as an app of its own. Storybook calls `render` again when a control changes, which
mounts the component afresh with the new inputs, and runs the cleanup `beforeEach` returns when it
leaves the story. Keying the apps by `canvasElement` keeps the stories on a docs page, which are all
on screen at once, apart.

A story then names its component and args. Here `Counter` is a component with a `label` input:

```ts
import type { Meta, StoryObj } from '@storybook/html-vite';
import { Counter } from './counter.ts';

const meta: Meta = {
  title: 'Counter',
  parameters: { component: Counter },
};

export default meta;

export const Default: StoryObj = {};

export const Labelled: StoryObj = {
  args: { label: 'Hello from Storybook' },
};
```

The component goes in `parameters` rather than in Storybook's own `component` field, which
`@storybook/html-vite` types as HTML rather than as a class.

`npx storybook dev` serves the catalogue, and `npx storybook build` writes it to
`storybook-static`.

## Projected content

`mount` sets inputs but has no content to project, so a story for a component that takes content
mounts a small component that supplies it:

```ts
import { Component, input } from '@angular/core';
import { Text } from '@ng-native/components';
import type { Meta, StoryObj } from '@storybook/html-vite';
import { Panel } from './panel.ts';

@Component({
  selector: 'story-panel',
  imports: [Panel, Text],
  template: `
    <app-panel [title]="title()">
      <text>Projected into the panel</text>
    </app-panel>
  `,
})
class PanelStory {
  readonly title = input('Settings');
}

const meta: Meta = { title: 'Panel', parameters: { component: PanelStory } };

export default meta;

export const WithContent: StoryObj = { args: { title: 'Settings' } };
```

## With Tailwind

Add `tailwindcss()` beside `ngNativeWeb()` in `.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/html-vite';
import tailwindcss from '@tailwindcss/vite';
import { ngNativeWeb } from '@ng-native/web/vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../src/**/*.stories.ts'],
  addons: ['@storybook/addon-docs'],
  viteFinal: (config) => mergeConfig(config, { plugins: [ngNativeWeb(), tailwindcss()] }),
};

export default config;
```

Then import the app's stylesheet at the top of `.storybook/preview.ts`:

```ts
import '../src/styles.css';
```

The stylesheet is the one [With Tailwind](/packages/web#with-tailwind) sets up. `mount` puts
`platform-web` on each story's root, and `dark` while the colour scheme is dark, as it does for an
app, so `web:` and `dark:` match in a story too.
