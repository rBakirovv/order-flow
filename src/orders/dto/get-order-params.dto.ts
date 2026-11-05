import { Matches } from 'class-validator';

export class GetOrderParamsDto {
  @Matches(/^\d+$/, { message: 'id must contain only decimal digits' })
  id: string;
}
