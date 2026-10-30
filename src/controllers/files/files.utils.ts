// Content-Type is never trustworthy, from either side: the client's
// declared value at intent time is just a claim (see files.service.ts's
// createIntent()), and — verified empirically against this exact stack —
// the header a client's real PUT sends isn't bound by the presigned URL's
// signature either, so it can't be trusted at commit time as a header
// check. Only the bytes themselves can confirm the declared type.
// 12 bytes covers all three signatures below (WEBP needs the most).
export const MAGIC_BYTES_CHECK_LENGTH = 12;

export function matchesMagicBytes(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  const buf = Buffer.from(bytes);

  switch (contentType) {
    case 'image/png':
      return buf
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'image/webp':
      return (
        buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buf.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}
