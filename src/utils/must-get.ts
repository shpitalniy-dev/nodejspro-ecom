// "This key must be in the map because we just built the map from the same
// source" lookups — seed.ts (wiring fixture relations) and the orders
// service (resolving a productId already validated to exist) both need
// this, so it lives here once instead of twice.
export function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);

  if (value === undefined) {
    throw new Error(`expected map to contain key: ${String(key)}`);
  }

  return value;
}
