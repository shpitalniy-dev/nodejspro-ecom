// Fixed key so provider verification can seed exactly this one row via the
// aProduct() builder — same "known placeholder" pattern as
// STOREFRONT_CUSTOMER_EMAIL in orders.service.ts. Shared between the
// consumer and provider tests so neither imports the other's test file.
export const CONTRACT_PRODUCT_KEY = 'contract-test-product';
