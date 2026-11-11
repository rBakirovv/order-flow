import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { RabbitMqPublisher } from '../messaging/rabbitmq-publisher.service.js';

@Module({
  providers: [NotificationsService, RabbitMqPublisher],
  exports: [NotificationsService],
})
export class NotificationsModule {}
