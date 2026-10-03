import { Component, signal } from '@angular/core';
import { HlmInputImports } from './helm/input';
import { HlmLabelImports } from './helm/label';

/** Spartan UI's input, with a label: plain, with a value typed into it read back, and disabled. */
@Component({
  selector: 'app-spartan-inputs',
  imports: [HlmInputImports, HlmLabelImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <label hlmLabel testID="label">Name</label>
    <input
      hlmInput
      testID="name"
      placeholder="Your name"
      (input)="name.set($any($event.target).value)"
    />
    <p class="text-muted-foreground text-sm">Typed: {{ name() }}</p>

    <label hlmLabel>Email</label>
    <input hlmInput testID="email" type="email" placeholder="you@example.com" />

    <label hlmLabel>Password</label>
    <input hlmInput testID="password" type="password" placeholder="Password" />

    <label hlmLabel>Disabled</label>
    <input hlmInput testID="disabled" disabled placeholder="Cannot type here" />
  `,
})
export class SpartanInputs {
  protected readonly name = signal('');
}
