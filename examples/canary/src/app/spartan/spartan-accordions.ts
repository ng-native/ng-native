import { Component } from '@angular/core';
import { HlmAccordionImports } from './helm/accordion';

/**
 * Spartan UI's accordion: one item open at a time, each opened by its header.
 *
 * Known gap: a panel opens to its padding, not its content. The library measures the content of a
 * closed panel, and native lays text inside a zero-height hidden box out at no height.
 */
@Component({
  selector: 'app-spartan-accordions',
  imports: [HlmAccordionImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <hlm-accordion testID="accordion">
      <hlm-accordion-item testID="first-item">
        <hlm-accordion-trigger testID="first">Is it accessible?</hlm-accordion-trigger>
        <hlm-accordion-content testID="first-content">
          Yes. It follows the WAI-ARIA pattern.
        </hlm-accordion-content>
      </hlm-accordion-item>
      <hlm-accordion-item testID="second-item">
        <hlm-accordion-trigger testID="second">Is it styled?</hlm-accordion-trigger>
        <hlm-accordion-content testID="second-content">
          Yes. It comes with styles that match the other components.
        </hlm-accordion-content>
      </hlm-accordion-item>
    </hlm-accordion>
  `,
})
export class SpartanAccordions {}
