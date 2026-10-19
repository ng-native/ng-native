/**
 * What runs `run` in the next frame, once however often it is asked for before then: how an
 * observer looks at what it watches no more than once a frame.
 */
export function oncePerFrame(run: () => void): () => void {
  let asked: number | undefined;
  const go = () => {
    asked = undefined;
    run();
  };
  return () => {
    // Asked for and never run, as where the timer of a page that went away was cleared: again.
    if (asked !== undefined && performance.now() - asked < 1000) return;
    asked = performance.now();
    const request = (globalThis as { requestAnimationFrame?: (run: () => void) => unknown })
      .requestAnimationFrame;
    if (request) request(go);
    else setTimeout(go, 16);
  };
}
