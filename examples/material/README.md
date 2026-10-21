# Material

A small task list built with Angular Material, the component library written for the browser,
rendered as native views through `@ng-native/web-compat`. Material's components reach for the DOM
on what they render (`classList`, `addEventListener`, `getBoundingClientRect`), and web-compat
gives the engine's nodes those members, so the library runs unchanged.

| Part                                      | What it shows                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks (`src/app/tasks/tasks-page.ts`)     | Material's toolbar and menu, a progress bar, tabs for to do and done, checkboxes, icons, a floating button, and a snack bar with Undo |
| New task (`src/app/tasks/task-dialog.ts`) | A Material dialog with form fields, a textarea and selects, bound with Signal Forms                                                   |
| Theme (`src/material-theme.css`)          | Material's system tokens as `mat.theme` writes them, with `light-dark()` for the dark scheme, and its icon font                       |

## What it takes

- `provideWebCompat()` in `src/app/app.config.ts`, and `withWebCompat()` last in
  `metro.config.js`, naming `@angular/material` and `@angular/cdk` so their stylesheets are read
  as a browser reads them. The app's own components stay native views.
- The screen is a lazy route: the CDK adds a listener to the window as its modules load, and the
  window has listeners only once `provideWebCompat()` has run.
- The CDK's `Platform` told it is a browser on a phone (`src/app/cdk-platform.ts`), so it
  positions overlays against their triggers and Material uses its touch behaviour.
- `loadFonts()` before mounting, for the Material Icons font the theme declares.

## Run it

From the repository root, after `pnpm install`:

```sh
cd examples/material
pnpm start     # press i or a, or scan the QR code with Expo Go
pnpm test      # Vitest in Node, no simulator
```

`src/app/app.test.ts` drives the app as a person would: checks a task off, adds one through the
dialog, deletes one and brings it back with Undo, and clears what is done from the menu.
