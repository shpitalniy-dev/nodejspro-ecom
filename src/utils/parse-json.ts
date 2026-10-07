// Returns undefined instead of throwing, so a malformed message body can be
// handled as a validation failure rather than an exception.
export function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString());
  } catch {
    return undefined;
  }
}
