# Angular rules

Source: Angular's official AI best-practices file
(https://angular.dev/assets/context/best-practices.md) and the Angular style guide
(https://angular.dev/style-guide). Trimmed to what applies to this
project: Angular components rendering native iOS/Android views on React Native's Fabric
renderer, no DOM and no browser. This repo is on `@angular/core` 22.2.0, so the v20+/v22+
defaults below are already in effect.

## Components and directives

- Standalone is the default in v20+. Never set `standalone: true` explicitly.
- `OnPush` change detection is the default in v22+. Never set
  `changeDetection: ChangeDetectionStrategy.OnPush` explicitly.
- Use `input()`, `output()`, and `model()` functions rather than `@Input`/`@Output` decorators.
- Use `computed()` for derived state.
- Use `linkedSignal()` for state that needs to stay synchronized with another reactive source.
- Choose inline templates for small components.
- Use relative paths for external templates and styles.
- Keep components focused on a single responsibility; keep components and directives focused
  on presentation, and factor non-UI logic (validation rules, data transformations) into plain
  functions or classes.
- Group Angular-specific members (injected dependencies, inputs, outputs, queries) near the top
  of the class, before methods.
- Use `protected` for members that are only read from the component's own template.
- Use `readonly` for properties initialized by Angular: `input()`, `model()`, `output()`, and
  queries.
- Name event handlers for what they do, not for the triggering event (e.g. `saveUserData()`,
  not `handleClick()`).
- Keep lifecycle hooks simple: delegate to well-named methods rather than inlining logic, and
  implement the lifecycle hook interfaces (e.g. `OnInit`) so hook methods are named correctly.
- Avoid overly complex logic in templates; move it to TypeScript, typically behind a
  `computed()`.

## Host bindings

- Use the `host` object in the `@Component`/`@Directive` decorator instead of `@HostBinding`
  and `@HostListener`.

## Template bindings

- Use `class` and `[style]`/`[style.x]` bindings directly instead of `NgClass`/`NgStyle`.
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`.
- Handle observables with the `async` pipe rather than manual subscribe/unsubscribe.

## State management

- Manage local state with signals.
- Derive state with `computed()`; keep the transformations pure and predictable.
- Use `update()` or `set()` on signals, not `mutate()`.

## Dependency injection and services

- Use the `inject()` function over constructor parameter injection.
- Design services around a single responsibility.
- Use `providedIn: 'root'` for singleton services.
- Prefer the `@Service` decorator for singletons (v22+).

## Forms

- Prefer Signal Forms for all forms in this project.

## Routing

- Implement lazy loading for feature routes.

## Naming conventions

- Separate words in file names with hyphens: kebab-case. A component named `UserProfile` lives
  in `user-profile.ts`.
- File names should reflect the TypeScript identifier they contain. Avoid overly generic file
  names like `helpers.ts`, `utils.ts`, `common.ts`.
- Do not suffix class names with `Component`, `Directive`, `Service`, or `Pipe` (e.g. `UserProfile`,
  not `UserProfileComponent`). Do not suffix file names with `.component.ts`, `.directive.ts`,
  `.service.ts`, or `.pipe.ts` either - just `.ts`.
- The root application component's file is `app.ts`, exporting a class named `App`.
- Bootstrap the application in a file named `main.ts` directly inside `src`.
- A component's TypeScript, template, and style files share the same base name with different
  extensions (e.g. `user-profile.ts`, `user-profile.html`, `user-profile.css`).
- Unit tests end in `.test.ts` and live next to the code under test, not in a separate `tests`
  directory. `packages/integration-tests` is the exception: it exercises the whole seam.
- Organize the project by feature area, not by code type - avoid directories named
  `components`, `directives`, or `services`.
- Prefer one concept (usually one component, directive, or service) per file; split further if a
  directory grows hard to navigate.

## TypeScript

- Use strict type checking.
- Let type inference handle obvious cases.
- Prefer `unknown` over `any` for uncertain types.

## Dropped from the official rules (not applicable here - no DOM, no browser)

- `NgOptimizedImage` (browser image loading).
- `DomSanitizer` and other DOM-sanitization guidance.
- `provideHttpClient()` on its own: it returns null bodies on a device. Use
  `provideNativeHttpClient()` from `@ng-native/platform/http`.
- SSR/hydration guidance.
- Reactive Forms guidance (this project standardizes on Signal Forms; Reactive Forms are not used).
- AXE/browser accessibility-checker guidance (no DOM to run browser a11y tooling against).
