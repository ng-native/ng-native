/**
 * Fixture for `interaction-observer.test.ts`. See `button-app.ts`'s doc comment for why a real
 * `@Component` has to live in its own file rather than inside a `.test.ts` one.
 *
 * The component cases of `packages/integration-tests/fixtures/interaction-observer.ts`, so the web
 * host can be held to the same `component` the native one reports.
 */
import { Component, Directive } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';

/** A design-system button, with its pressable inside its template. */
@Component({
  selector: 'x-wrapped-button',
  imports: [Pressable, Text],
  template: `<pressable testID="wrapped"><text>wrapped</text></pressable>`,
})
export class WrappedButton {}

/** An element only a directive matches: not a component, so never the one an event names. */
@Directive({ selector: 'x-region' })
export class Region {}

/** A card with a pressable of its own, one under a directive, a wrapped button and a slot. */
@Component({
  selector: 'x-observed-card',
  imports: [Pressable, Region, Text, View, WrappedButton],
  template: `
    <view>
      <pressable testID="card-action"><text>card-action</text></pressable>
      <x-region
        ><pressable testID="in-region"><text>in-region</text></pressable></x-region
      >
      <x-wrapped-button />
      <ng-content />
    </view>
  `,
})
export class ObservedCard {}

/** Alternatives on one element name: named by the one whose attribute the host has. */
@Component({
  selector: 'section[x-primary], section[x-secondary]',
  imports: [Pressable, Text],
  template: `<pressable testID="panel-action"><text>panel-action</text></pressable>`,
})
export class Panel {}

/** Alternatives its host is ruled out of by a :not(): named by the one it matches. */
@Component({
  selector: 'header:not(.x-off), header:not(header[x-mute]), header[x-on]',
  imports: [Pressable, Text],
  template: `<pressable testID="banner-action"><text>banner-action</text></pressable>`,
})
export class Banner {}

/** Alternatives of classes alone: named by the one whose class the host has. */
@Component({
  selector: '.x-first-badge, .x-second-badge',
  imports: [Pressable, Text],
  template: `<pressable testID="badge-action"><text>badge-action</text></pressable>`,
})
export class Badge {}

@Component({
  selector: 'app-root',
  imports: [Badge, Banner, ObservedCard, Panel, Pressable, Text],
  template: `
    <pressable testID="save"><text>save</text></pressable>
    <x-observed-card>
      <pressable testID="projected"><text>projected</text></pressable>
    </x-observed-card>
    <section x-secondary></section>
    <section class="x-second-badge"></section>
    <header class="x-off" x-mute x-on></header>
  `,
})
export class InteractionObserverApp {}
