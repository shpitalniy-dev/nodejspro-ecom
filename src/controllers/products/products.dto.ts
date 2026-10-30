import { IsInt, Min } from 'class-validator';

// Price only — currency is CHECK-constrained to 'USD' alone, nothing
// else on this entity is meaningfully updatable yet.
export class UpdateProductDto {
  @IsInt()
  @Min(0)
  price_cents!: number;
}
