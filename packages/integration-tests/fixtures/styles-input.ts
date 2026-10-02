import { Component, Input, booleanAttribute } from '@angular/core';
import { Text } from '../../components/src/text.ts';

/** An input named `styles`, under an alias, beside the component's own `styles`. */
@Component({
  imports: [Text],
  selector: 'x-aliased-styles',
  template: '<text>{{ styles }}</text>',
  styles: [':host { padding: 1px }'],
})
export class AliasedStyles {
  @Input('customStyles') styles = 'unset';
}

/** An input named `styles` with a transform, which the definition lists with its function. */
@Component({
  imports: [Text],
  selector: 'x-transformed-styles',
  template: '<text>{{ styles }}</text>',
  styles: [':host { padding: 2px }'],
})
export class TransformedStyles {
  @Input({ transform: booleanAttribute }) styles = false;
}

/** A template whose text reads like a definition's `styles` property. */
@Component({
  imports: [Text],
  selector: 'x-styles-in-text',
  template: '<text>styles: [ "kept" ]</text>',
  styles: [':host { padding: 3px }'],
})
export class StylesInText {}

@Component({
  imports: [AliasedStyles, TransformedStyles, StylesInText],
  selector: 'x-styles-input',
  template:
    '<x-aliased-styles customStyles="bound" /><x-transformed-styles styles /><x-styles-in-text />',
})
export class StylesInput {}
