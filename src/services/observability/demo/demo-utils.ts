import type { EntityManager } from 'typeorm';

import { Inventory } from '../../../entities/inventory.entity.ts';

// Shared by every demo in this folder that needs to inspect raw pino
// output: patches process.stdout.write for a narrow window instead of
// piping the process (these demos run the app in-process, see
// startDemoApp()) and splits + JSON-parses whatever came through.
export interface CapturedStdout {
  lines: string[];
  stop: () => void;
}

export function captureStdout(): CapturedStdout {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.length > 0) lines.push(line);
    }

    return true;
  }) as typeof process.stdout.write;

  return {
    lines,
    stop: () => {
      process.stdout.write = original;
    },
  };
}

// These demos place real orders against a real seeded product, which
// decrements that product's real inventory on every success (checkout.ts)
// — same as every other demo that spends real stock. Reset to a known
// baseline first, same pattern demo-race.ts already uses, so re-running
// any of these demos never depends on how much stock prior runs left
// behind (confirmed live: without this, a second demo:metrics run in a
// row starts failing its own "valid" requests once stock hits 0).
export async function resetStock(
  manager: EntityManager,
  productId: number,
  quantity: number,
): Promise<void> {
  const inventory = await manager
    .getRepository(Inventory)
    .findOneBy({ product: { id: productId } });

  if (!inventory) {
    throw new Error(`no inventory row for product ${productId}`);
  }

  await manager.getRepository(Inventory).update(inventory.id, { quantity });
}

export function parseJsonLines<T = Record<string, unknown>>(
  raw: string[],
): { parsed: T[]; nonJsonLines: number } {
  const parsed: T[] = [];
  let nonJsonLines = 0;

  for (const line of raw) {
    try {
      parsed.push(JSON.parse(line) as T);
    } catch {
      nonJsonLines++;
    }
  }

  return { parsed, nonJsonLines };
}
