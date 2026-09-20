import { BadRequestException } from '@nestjs/common';

// Opaque keyset-pagination cursor — just `id`. A database-generated,
// strictly sequential, already-unique key needs no tiebreaker the way a
// non-unique sort key (e.g. created_at) would, so there's nothing else to
// carry. Clients must treat this as opaque (openapi.yaml's Cursor
// parameter says so explicitly) — base64url of a small JSON object is
// enough to make that true without needing real encryption.
export function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id })).toString('base64url');
}

export function decodeCursor(raw: string): { id: number } {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    const { id } = parsed as { id?: unknown };

    if (typeof id !== 'number') {
      throw new Error();
    }

    return { id };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
