// demo:gates "arch-broken" — an entity reaching up into the HTTP layer,
// exactly what .dependency-cruiser.cjs's entities-not-to-controllers forbids.
import { ORDERS_ROUTE } from '../controllers/orders.controller.ts';

export const route = ORDERS_ROUTE;
