import { Module } from '@nestjs/common';
import { EmailWorker } from './email-worker.service.js';

@Module({ providers: [EmailWorker] })
export class EmailWorkerModule {}
