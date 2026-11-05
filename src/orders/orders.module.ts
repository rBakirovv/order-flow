import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
