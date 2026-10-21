/** One turn of the frame loop, or the macrotask queue where there is no loop to wait on. */
export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (callback: () => void) => void })
      .requestAnimationFrame;
    if (raf) raf(() => resolve());
    else setTimeout(resolve, 0);
  });
