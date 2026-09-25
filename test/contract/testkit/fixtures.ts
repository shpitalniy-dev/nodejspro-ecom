// Shared between the consumer and provider tests so neither imports the
// other's test file. The id travels as a provider state PARAMETER (not a
// bare literal in the request path) — the state handler inserts the row
// with this exact id explicitly, so a second interaction with a different
// id wouldn't depend on insertion order the way "whichever row lands
// first" would.
export const CONTRACT_PRODUCT_KEY = 'contract-test-product';
export const CONTRACT_PRODUCT_ID = 1;
