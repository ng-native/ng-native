import { Component, input } from '@angular/core';
import { NativeHeader } from '../../router/src/native-header.ts';

/** A header that binds nothing, so the defaults are the only thing deciding its colours. */
@Component({
  imports: [NativeHeader],
  selector: 'x-header-default',
  template: `<native-header title="Inbox" nativeID="bar" />`,
})
export class HeaderDefault {}

/** The same, with the call site saying so, which must win. */
@Component({
  imports: [NativeHeader],
  selector: 'x-header-bound',
  template: `<native-header title="Inbox" nativeID="bar" backgroundColor="#ff0000" />`,
})
export class HeaderBound {}

/** A header that asks for the Liquid Glass bar itself, or refuses it, whatever the app's defaults. */
@Component({
  imports: [NativeHeader],
  selector: 'x-header-glass',
  template: `<native-header title="Inbox" nativeID="bar" [liquidGlass]="glass()" />`,
})
export class HeaderGlass {
  readonly glass = input(true);
}

/** A large title that says nothing else, which should look as iOS draws one. */
@Component({
  imports: [NativeHeader],
  selector: 'x-header-large',
  template: `<native-header title="Inbox" nativeID="bar" [largeTitle]="true" />`,
})
export class HeaderLarge {}

/** A large title whose call site asks for an opaque bar and a coloured edge. */
@Component({
  imports: [NativeHeader],
  selector: 'x-header-large-opaque',
  template: `
    <native-header
      title="Inbox"
      nativeID="bar"
      [largeTitle]="true"
      [translucent]="false"
      largeTitleBackgroundColor="#ff0000"
      [largeTitleHideShadow]="false"
    />
  `,
})
export class HeaderLargeOpaque {}
