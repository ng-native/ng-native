/**
 * Whether the page has scrolled past a marker: the header reads it to turn solid and to rule
 * itself off from the hero. An observer rather than a scroll listener, so nothing runs per frame,
 * disconnected when the component that asked is destroyed.
 */
import type { DestroyRef } from '@angular/core';

export function observePast(
  selector: string,
  set: (past: boolean) => void,
  destroyRef: DestroyRef,
): void {
  const marker = document.querySelector(selector);
  if (!marker) return;
  const observer = new IntersectionObserver(([entry]) =>
    set(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0),
  );
  observer.observe(marker);
  destroyRef.onDestroy(() => observer.disconnect());
}
