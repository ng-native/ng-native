import { Component, signal } from '@angular/core';
import { HlmInputImports } from './helm/input';
import { HlmLabelImports } from './helm/label';

/** Spartan UI's input, with a label: plain, with a value typed into it read back, and disabled. */
@Component({
  selector: 'app-spartan-inputs',
  imports: [HlmInputImports, HlmLabelImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <label hlmLabel testID="label" for="name">Name</label>
    <input
      hlmInput
      id="name"
      testID="name"
      placeholder="Your name"
      (input)="name.set($any($event.target).value)"
    />
    <p class="text-muted-foreground text-sm">Typed: {{ name() }}</p>

    <label hlmLabel for="email">Email</label>
    <input hlmInput id="email" testID="email" type="email" placeholder="you@example.com" />

    <label hlmLabel for="password">Password</label>
    <input hlmInput id="password" testID="password" type="password" placeholder="Password" />

    <label hlmLabel for="disabled">Disabled</label>
    <input hlmInput id="disabled" testID="disabled" disabled placeholder="Cannot type here" />
  `,
})
export class SpartanInputs {
  protected readonly name = signal('');
}
