/**
 * What native answers for a view it has not mounted, or not yet put in a window: Android
 * (`TestingModule.kt`), iOS and the macOS host. A commit's views mount on the platform's UI thread
 * after JavaScript commits them, which on Android can be after the frame `settle()` waits for.
 */
const NOT_MOUNTED = /No view with tag \d+/;

/**
 * A screenshot's capture loop: taken again until two captures in a row agree, so what is moving
 * has settled, and asked again a frame later while native has not mounted the view yet.
 *
 * @param capture one capture, a PNG in base64
 * @param timeout how long to wait for both, in milliseconds
 */
export async function settledCapture(
  capture: () => Promise<string>,
  timeout: number,
): Promise<string> {
  const deadline = Date.now() + timeout;
  const mounted = async (): Promise<string> => {
    for (;;) {
      try {
        return await capture();
      } catch (error) {
        if (!NOT_MOUNTED.test((error as Error)?.message ?? '') || Date.now() > deadline)
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }
  };
  let last = await mounted();
  for (;;) {
    const next = await mounted();
    if (next === last) return next;
    if (Date.now() > deadline) {
      throw new Error(`The screenshot did not settle within ${timeout}ms: something kept moving.`);
    }
    last = next;
  }
}
