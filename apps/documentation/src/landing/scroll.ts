/**
 * Whether the page has scrolled past a marker: the header reads it to turn solid and to rule
 * itself off from the hero. An observer rather than a scroll listener, so nothing runs per frame.
 */
export function observePast(selector: string, set: (past: boolean) => void): void {
  const marker = document.querySelector(selector);
  if (!marker) return;
  new IntersectionObserver(([entry]) =>
    set(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0),
  ).observe(marker);
}
