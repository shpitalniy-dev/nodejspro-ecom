import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';

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
