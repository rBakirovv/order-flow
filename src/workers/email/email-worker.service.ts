import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  connect,
  type ChannelModel,
  type Channel,
  type ConsumeMessage,
} from 'amqplib';
import {
  EMAIL_NOTIFICATIONS_QUEUE,
  type SendOrderConfirmation,
} from '../../notifications/send-order-confirmation.js';

export class EmailWorkerError extends Error {}

function parseCommand(message: ConsumeMessage): SendOrderConfirmation {
  const command = JSON.parse(
    message.content.toString(),
  ) as Partial<SendOrderConfirmation> | null;
  if (
    !command ||
    typeof command.messageId !== 'string' ||
    !command.messageId ||
    !Number.isInteger(command.orderId) ||
    (command.orderId ?? 0) < 1 ||
    typeof command.customerEmail !== 'string' ||
    !command.customerEmail ||
    typeof command.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(command.createdAt))
  ) {
    throw new EmailWorkerError('Invalid SendOrderConfirmation payload');
  }
  return command as SendOrderConfirmation;
}

@Injectable()
export class EmailWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(EmailWorker.name);
  private connection?: ChannelModel;
  private channel?: Channel;
  private consumerTag?: string;
  private processing?: Promise<void>;
  private stopping = false;

  async run(): Promise<never> {
    const url = process.env.RABBITMQ_URL;
    if (!url) throw new EmailWorkerError('RABBITMQ_URL is required');
    let fail!: (error: Error) => void;
    const failure = new Promise<Error>((resolve) => {
      fail = resolve;
    });
    const disconnected = () => {
      if (!this.stopping)
        fail(
          new EmailWorkerError(
            'RabbitMQ connection or channel closed; restart the worker',
          ),
        );
    };
    this.connection = await connect(url, { timeout: 5000 });
    // Do not print raw connection errors: they may contain credentials.
    this.connection.on('error', () => {
      if (!this.stopping)
        fail(
          new EmailWorkerError(
            'RabbitMQ connection error; check the broker and RABBITMQ_URL',
          ),
        );
    });
    this.connection.on('close', disconnected);
    this.channel = await this.connection.createChannel();
    this.channel.on('error', () => {
      if (!this.stopping)
        fail(new EmailWorkerError('RabbitMQ consumer channel error'));
    });
    this.channel.on('close', disconnected);
    await this.channel.assertQueue(EMAIL_NOTIFICATIONS_QUEUE, {
      durable: true,
    });
    await this.channel.prefetch(1);
    const { consumerTag } = await this.channel.consume(
      EMAIL_NOTIFICATIONS_QUEUE,
      (message) => {
        if (!message) {
          fail(
            new EmailWorkerError(
              'RabbitMQ cancelled the consumer; restart the worker',
            ),
          );
          return;
        }
        this.processing = this.handleMessage(message).catch(() => {
          fail(
            new EmailWorkerError(
              `Email task failed messageId=${message.properties.messageId ?? 'unknown'}; stopping without ACK. Inspect the queued message before restarting`,
            ),
          );
        });
      },
      { noAck: false },
    );
    this.consumerTag = consumerTag;
    this.logger.log(
      `Waiting for tasks queue=${EMAIL_NOTIFICATIONS_QUEUE} prefetch=1`,
    );
    throw await failure;
  }

  private async handleMessage(message: ConsumeMessage): Promise<void> {
    const command = parseCommand(message);
    const context = `messageId=${command.messageId} orderId=${command.orderId}`;
    this.logger.log(
      `Mock email started ${context} redelivered=${message.fields.redelivered}`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    this.logger.log(`Mock email completed ${context}`);
    this.channel!.ack(message);
    this.logger.log(`Email task ACK ${context}`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.channel && this.consumerTag) {
      await this.channel.cancel(this.consumerTag).catch(() => undefined);
    }
    await this.processing;
    // Channel.Close-Ok ensures earlier ACK frames are processed before disconnecting.
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
