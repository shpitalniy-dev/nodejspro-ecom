import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';

import type { OrderStatus } from '../../entities/order.entity.ts';

// Validates on top of express-openapi-validator, not instead of it —
// openapi.yaml's CreateOrderRequest schema already rejects a malformed
// body at the wire level (and additionalProperties: false there is what
// contract/check.js's "unexpected body properties" case depends on). This
// gives the app a real, instanceof-checkable object instead of a
// structurally-typed interface, and is the concrete ValidationPipe-sourced
// 400 this course's own teaching pattern expects to exist somewhere.
export class CreateOrderItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}

// HW#18 realtime status-change endpoint. Its path IS declared in
// openapi.yaml (unlike its GET .../events sibling — see configure-app.ts's
// ignorePaths comment), so this is defense-in-depth on top of that
// contract, the same relationship CreateOrderItemDto has above. IsIn over
// the entity's own status literals, not IsEnum, since OrderStatus is a TS
// union, not a runtime enum object.
export class UpdateOrderStatusDto {
  @IsIn(['unpaid', 'pending', 'paid', 'refunded'] satisfies OrderStatus[])
  status!: OrderStatus;
}
