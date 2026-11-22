/**
 * The end of a test in the device runner: its teardown, then what must happen however the teardown
 * went (animations back to the project's setting). The first error, the teardown's own, is the
 * one reported; the second step's error is thrown only when the teardown succeeded.
 */
export async function teardownThen(
  teardown: () => unknown,
  always: () => Promise<void>,
): Promise<void> {
  let failure: { error: unknown } | undefined;
  try {
    await teardown();
  } catch (error) {
    failure = { error };
  }
  try {
    await always();
  } catch (error) {
    failure ??= { error };
  }
  if (failure) throw failure.error;
}
