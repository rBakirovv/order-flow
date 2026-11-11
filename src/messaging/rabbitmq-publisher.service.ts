import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import {
  EMAIL_NOTIFICATIONS_QUEUE,
  type SendOrderConfirmation,
} from '../notifications/send-order-confirmation.js';

interface Session {
  connection: ChannelModel;
  channel: ConfirmChannel;
}

const PUBLISH_TIMEOUT_MS = 5000;

@Injectable()
export class RabbitMqPublisher implements OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMqPublisher.name);
  private session?: Promise<Session>;
  private readonly returned = new Map<string, (error: Error) => void>();

  private getSession(): Promise<Session> {
    if (!this.session) {
      const invalidate = () => {
        if (this.session === pending) this.session = undefined;
      };
      const pending = this.openSession(invalidate);
      this.session = pending;
      void pending.catch(invalidate);
    }
    return this.session;
  }

  private async openSession(invalidate: () => void): Promise<Session> {
    const url = process.env.RABBITMQ_URL;
    if (!url) throw new Error('RABBITMQ_URL is required');
    const connection = await connect(url, { timeout: PUBLISH_TIMEOUT_MS });
    // Avoid logging connection errors verbatim: they can contain credentials.
    connection.on('error', () =>
      this.logger.error('RabbitMQ connection error'),
    );
    connection.on('close', invalidate);
    try {
      const channel = await connection.createConfirmChannel();
      channel.on('error', () => this.logger.error('RabbitMQ channel error'));
      channel.on('close', () => {
        invalidate();
        void connection.close().catch(() => undefined);
      });
      channel.on('return', (message) => {
        this.returned.get(message.properties.messageId)?.(
          new Error('RabbitMQ could not route the notification'),
        );
      });
      await channel.assertQueue(EMAIL_NOTIFICATIONS_QUEUE, { durable: true });
      return { connection, channel };
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  async publish(command: SendOrderConfirmation): Promise<void> {
    const { channel } = await this.getSession();
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error | null) => {
        clearTimeout(timer);
        this.returned.delete(command.messageId);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        finish(new Error('RabbitMQ publisher confirm timed out'));
        // The outcome is unknown; do not retry the command automatically.
        void channel.close().catch(() => undefined);
      }, PUBLISH_TIMEOUT_MS);
      this.returned.set(command.messageId, finish);
      try {
        channel.sendToQueue(
          EMAIL_NOTIFICATIONS_QUEUE,
          Buffer.from(JSON.stringify(command)),
          {
            persistent: true,
            mandatory: true,
            contentType: 'application/json',
            type: 'SendOrderConfirmation',
            messageId: command.messageId,
          },
          finish,
        );
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error('Publication failed'),
        );
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    const session = await this.session?.catch(() => undefined);
    await session?.connection.close().catch(() => undefined);
  }
}
