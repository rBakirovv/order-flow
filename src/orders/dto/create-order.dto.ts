import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsInt,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  productId: number;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity: number;
}

export class CreateOrderDto {
  @IsEmail()
  customerEmail: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: OrderItemDto | null) => item?.productId)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
