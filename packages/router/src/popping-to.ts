/**
 * The screen a pop is going down to, per router, while the stack outlet sends the router there by
 * a navigation rather than through history: the history behind does not mirror the stack. With
 * the same url on the stack twice, the reuse strategy reads it to hand back that screen, not the
 * newer one at the url.
 */
import type { ComponentRef } from '@angular/core';

export const poppingTo = new WeakMap<object, ComponentRef<unknown>>();
