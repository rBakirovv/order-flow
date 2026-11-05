import { Injectable, Logger } from '@nestjs/common';
import { setTimeout } from 'node:timers/promises';
import type { Order } from '../generated/prisma/client.js';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async sendOrderCreated(
    order: Pick<Order, 'id' | 'customerEmail'>,
  ): Promise<void> {
    this.logger.log(`Mock email started for order ${order.id}`);
    await setTimeout(3000);
    this.logger.log(`Mock email completed for order ${order.id}`);
  }
}
