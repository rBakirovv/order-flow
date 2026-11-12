import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EmailWorkerModule } from './email-worker.module.js';
import { EmailWorker, EmailWorkerError } from './email-worker.service.js';

const app = await NestFactory.createApplicationContext(EmailWorkerModule);
app.enableShutdownHooks();
try {
  await app.get(EmailWorker).run();
} catch (error) {
  // Keep raw AMQP errors (which may contain the URL) out of the logs.
  Logger.error(
    error instanceof EmailWorkerError
      ? error.message
      : 'Email worker failed. Check RabbitMQ and RABBITMQ_URL before restarting.',
    'EmailWorkerBootstrap',
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
