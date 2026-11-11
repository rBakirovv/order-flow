import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Order } from '../generated/prisma/client.js';
import { RabbitMqPublisher } from '../messaging/rabbitmq-publisher.service.js';
import type { SendOrderConfirmation } from './send-order-confirmation.js';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly publisher: RabbitMqPublisher) {}

  async sendOrderCreated(
    order: Pick<Order, 'id' | 'customerEmail'>,
  ): Promise<void> {
    const command: SendOrderConfirmation = {
      messageId: randomUUID(),
      orderId: order.id,
      customerEmail: order.customerEmail,
      createdAt: new Date().toISOString(),
    };
    const context = `messageId=${command.messageId} orderId=${command.orderId}`;
    try {
      await this.publisher.publish(command);
      this.logger.log(`Notification publication confirmed ${context}`);
    } catch {
      this.logger.error(
        `Notification publication failed or unconfirmed ${context}; order remains saved; email delivery is not guaranteed`,
      );
    }
  }
}
