/**
 * Inputs of Angular's forms directives, by the directive that takes each and where it comes from,
 * and the report both `Renderer2` adapters make when one reaches them unclaimed.
 *
 * The names and package paths below are the one piece of Angular-specific knowledge in this
 * package - everything else here stays framework-agnostic, per `docs/ARCHITECTURE.md`. It lives here
 * anyway, rather than duplicated in `@ng-native/platform` and `@ng-native/web`, because both of
 * their `Renderer2`s hit exactly the same failure for exactly the same reason and neither imports
 * the other: a binding reaches `setProperty` only when no directive on the element took it, and
 * none of these names is a native prop or a DOM one, so one arriving there means the directive
 * was never imported. Angular would say so on a real `platform-browser` bootstrap - its template
 * type-checker is not in this build, and neither adapter's runtime check can help, because one
 * takes any hyphenated element for a web component that may have any property and the other has
 * no DOM to run its own check against. So `<text-input [formField]>` without `FormField` compiles,
 * renders, and binds nothing, and the form sits empty and invalid without a word - unless
 * something says so here.
 */
const FORMS_INPUTS: Readonly<Record<string, readonly [directive: string, from: string]>> = {
  formField: ['FormField', '@angular/forms/signals'],
  ngModel: ['FormsModule', '@angular/forms'],
  formControl: ['ReactiveFormsModule', '@angular/forms'],
  formControlName: ['ReactiveFormsModule', '@angular/forms'],
  formGroup: ['ReactiveFormsModule', '@angular/forms'],
};

/** Whether a name is a forms directive's input, which `reportUnboundFormsInput` reports. */
export function isFormsInput(name: string): boolean {
  return Object.hasOwn(FORMS_INPUTS, name);
}

/** An element, as far as this report needs one: enough to name it. */
export interface NamedHostNode {
  readonly name: string;
}

/** Elements and inputs already reported, per caller, so a list of fields says it once. */
const reportedInputs = new WeakMap<object, Set<string>>();

/**
 * Reports `name` on `el` as an unbound forms directive input, once per `owner`/element/input
 * triple. A no-op when `name` is not one of `FORMS_INPUTS`, so a caller can run this unconditionally
 * from `setProperty` without checking first.
 *
 * `owner` keys the "already reported" set - each adapter passes its own engine, so two mounted
 * apps (or two tests) never suppress each other's first report.
 */
export function reportUnboundFormsInput(owner: object, el: NamedHostNode, name: string): void {
  const directiveEntry = FORMS_INPUTS[name];
  if (!directiveEntry) return;
  const seen = reportedInputs.get(owner) ?? new Set<string>();
  reportedInputs.set(owner, seen);
  const key = `${el.name} ${name}`;
  if (seen.has(key)) return;
  seen.add(key);
  const [directive, from] = directiveEntry;
  console.error(
    `[angular-native] Can't bind to '${name}' on <${el.name}>: no directive in its template ` +
      `takes it, so it binds nothing. Add ${directive} from '${from}' to the component's ` +
      `\`imports\`.`,
  );
}
