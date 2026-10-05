import { Injectable } from '@angular/core';

/** A service in a file of its own, for `hmr.test.ts` to edit under a component that calls it. */
@Injectable({ providedIn: 'root' })
export class Label {
  text(): string {
    return 'one';
  }
}
