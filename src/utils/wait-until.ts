import { sleep } from './sleep.ts';

// Polls until the predicate holds or the timeout passes. Returns the final
// answer, so a caller can tell "it happened" from "it never did".
export async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  pollMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await sleep(pollMs);
  }

  return predicate();
}
