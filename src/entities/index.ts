import { File } from './file.entity.ts';
import { Fulfillment } from './fulfillment.entity.ts';
import { Inventory } from './inventory.entity.ts';
import { Order } from './order.entity.ts';
import { OrderItem } from './order-item.entity.ts';
import { Outbox } from './outbox.entity.ts';
import { ProcessedMessage } from './processed-message.entity.ts';
import { Product } from './product.entity.ts';
import { RefreshToken } from './refresh-token.entity.ts';
import { Task } from './task.entity.ts';
import { User } from './user.entity.ts';

export { File } from './file.entity.ts';
export { Fulfillment } from './fulfillment.entity.ts';
export { Inventory } from './inventory.entity.ts';
export { Order } from './order.entity.ts';
export { OrderItem } from './order-item.entity.ts';
export { Outbox } from './outbox.entity.ts';
export { ProcessedMessage } from './processed-message.entity.ts';
export { Product } from './product.entity.ts';
export { RefreshToken } from './refresh-token.entity.ts';
export { Task } from './task.entity.ts';
export { User } from './user.entity.ts';

// Single source for DataSource's `entities` array — keeps data-source.ts,
// seed.ts, demo-nplus1.ts and report.ts from each listing all nine.
export const entities = [
  Product,
  User,
  Inventory,
  Order,
  OrderItem,
  Fulfillment,
  Task,
  Outbox,
  ProcessedMessage,
  RefreshToken,
  File,
];
