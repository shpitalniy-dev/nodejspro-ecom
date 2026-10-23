import { createRateLimitGuard } from '../../services/rate-limit/rate-limit.service.ts';

// 30 req burst / 10 req/s sustained — generous enough to clear the one
// existing e2e test's 4-call burst (test/e2e/products.e2e.test.ts) with
// wide margin. Not derived from any real SLO, just a sensible illustrative
// default for a catalog list endpoint.
export const ProductsListRateLimitGuard = createRateLimitGuard({
  capacity: 30,
  refillPerSecond: 10,
  keyPrefix: 'products:list',
});
