/**
 * What runs `run` in the next frame, once however often it is asked for before then: how an
 * observer looks at what it watches no more than once a frame. `forget` drops a request that will
 * never be answered, the timer of an app that went away, so the next is asked for at once.
 */
export function oncePerFrame(run: () => void): { ask(): void; forget(): void } {
  let asked: number | undefined;
  const go = () => {
    asked = undefined;
    run();
  };
  return {
    ask: () => {
      // Asked for and never run, as where the timer of a page that went away was cleared: again.
      if (asked !== undefined && performance.now() - asked < 1000) return;
      asked = performance.now();
      const request = (globalThis as { requestAnimationFrame?: (run: () => void) => unknown })
        .requestAnimationFrame;
      if (request) request(go);
      else setTimeout(go, 16);
    },
    forget: () => void (asked = undefined),
  };
}
