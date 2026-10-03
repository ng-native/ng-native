import {
  DestroyRef,
  ENVIRONMENT_INITIALIZER,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import { Engine, extendNodes } from '@ng-native/fabric';
import { nodeMembers, type CoreNode } from './node-members.ts';

/** How many apps in the process asked for it: nodes share one prototype between them. */
let apps = 0;
let remove: (() => void) | undefined;

/**
 * Give the app's nodes the DOM members a component library written for the browser calls.
 *
 * The members are on the prototype every node shares, so they are there for each app in the
 * process while any app that asked for them is up, and gone when the last is destroyed.
 */
export function provideWebCompat(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        if (apps === 0) {
          const core = Object.getPrototypeOf(inject(Engine).root) as CoreNode;
          // Read now: once extended, the prototype's listeners are the ones below.
          const { addEventListener, removeEventListener } = core;
          remove = extendNodes(nodeMembers({ addEventListener, removeEventListener }));
        }
        apps++;
        inject(DestroyRef).onDestroy(() => {
          if (--apps === 0) remove?.();
        });
      },
    },
  ]);
}
