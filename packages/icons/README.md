# @ng-native/icons

Renders `@ng-icons` icon sets as real native shapes, through `NgIcon` and react-native-svg, instead
of the `innerHTML` a web app uses.

Alpha: APIs may change before 1.0.

## Install

```sh
npm install @ng-native/icons @ng-icons/core react-native-svg
npm install @ng-icons/heroicons   # or whichever @ng-icons/* set you use
```

## Example

```ts
import { Component } from '@angular/core';
import { NgIcon } from '@ng-native/icons';
import { provideIcons } from '@ng-icons/core';
import { heroBookOpen, heroAcademicCap } from '@ng-icons/heroicons/outline';

@Component({
  selector: 'app-root',
  imports: [NgIcon],
  providers: [provideIcons({ heroBookOpen, heroAcademicCap })],
  template: `<ng-icon name="heroBookOpen" [size]="28" color="#ff9f0a" />`,
})
export class App {}
```

`provideIcons` works exactly as it does with `@ng-icons/core` on the web - only the rendering
underneath `NgIcon` changes.

## What's in the package

- `NgIcon` - the component, taking `name` or `svg`, plus `size`, `color`, `strokeWidth` and
  `accessibilityLabel`. With no `size` an icon is `1em`, as it is on the web: as big as the text
  around it, and sized by a `font-size` or by a width and height from a stylesheet.
- A narrow SVG parser (`svg`, `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`,
  `polygon`) that covers every set ng-icons ships.

## Docs

- [Icons](https://ng-native.com/packages/icons)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
