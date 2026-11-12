import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { connect, type ConsumeMessage } from 'amqplib';
import { EmailWorker } from './email-worker.service.js';

vi.mock('amqplib', () => ({ connect: vi.fn() }));

describe('EmailWorker', () => {
  let worker: EmailWorker;
  let receive: (message: ConsumeMessage | null) => void;
  let running: Promise<unknown>;
  const channel = Object.assign(new EventEmitter(), {
    assertQueue: vi.fn(),
    prefetch: vi.fn(),
    consume: vi.fn(),
    ack: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  });
  const connection = Object.assign(new EventEmitter(), {
    createChannel: vi.fn(),
    close: vi.fn(),
  });
  const command = {
    messageId: '550e8400-e29b-41d4-a716-446655440000',
    orderId: 42,
    customerEmail: 'user@example.com',
    createdAt: '2026-11-11T12:00:00.000Z',
  };
  const message = (body: unknown = command) =>
    ({
      content: Buffer.from(JSON.stringify(body)),
      properties: { messageId: command.messageId },
      fields: { redelivered: false },
    }) as ConsumeMessage;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv('RABBITMQ_URL', 'amqp://localhost');
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    channel.removeAllListeners();
    connection.removeAllListeners();
    vi.clearAllMocks();
    channel.assertQueue.mockResolvedValue({});
    channel.prefetch.mockResolvedValue({});
    channel.cancel.mockResolvedValue({});
    channel.close.mockResolvedValue(undefined);
    channel.consume.mockImplementation(async (_queue, callback) => {
      receive = callback;
      return { consumerTag: 'email-worker' };
    });
    connection.createChannel.mockResolvedValue(channel);
    connection.close.mockResolvedValue(undefined);
    vi.mocked(connect).mockResolvedValue(connection as never);
    worker = new EmailWorker();
    running = worker.run().catch((error: unknown) => error);
    await vi.waitFor(() => expect(channel.consume).toHaveBeenCalledOnce());
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    await worker.onApplicationShutdown();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('uses manual ACK and acknowledges only after the three-second processing', async () => {
    expect(channel.prefetch).toHaveBeenCalledWith(1);
    expect(channel.consume).toHaveBeenCalledWith(
      'email.notifications',
      expect.any(Function),
      { noAck: false },
    );
    const task = message();
    receive(task);
    await vi.advanceTimersByTimeAsync(2999);
    expect(channel.ack).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(channel.ack).toHaveBeenCalledExactlyOnceWith(task);
  });

  it('stops on invalid payload without ACK or a retry loop', async () => {
    receive(message({ orderId: 42 }));
    const error = await running;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(command.messageId);
    expect(channel.ack).not.toHaveBeenCalled();
    await worker.onApplicationShutdown();
    expect(channel.cancel).toHaveBeenCalledWith('email-worker');
    expect(connection.close).toHaveBeenCalled();
    expect(channel.consume).toHaveBeenCalledOnce();
  });

  it('drains the current task before closing the connection on shutdown', async () => {
    receive(message());
    const stopping = worker.onApplicationShutdown();
    await Promise.resolve();
    expect(channel.cancel).toHaveBeenCalledWith('email-worker');
    expect(connection.close).not.toHaveBeenCalled();
    expect(channel.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    await stopping;
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(channel.close).toHaveBeenCalledOnce();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(channel.ack.mock.invocationCallOrder[0]).toBeLessThan(
      channel.close.mock.invocationCallOrder[0],
    );
    expect(channel.close.mock.invocationCallOrder[0]).toBeLessThan(
      connection.close.mock.invocationCallOrder[0],
    );
  });

  it('reports connection loss so the process can exit instead of staying idle', async () => {
    connection.emit('close');
    expect(((await running) as Error).message).toContain('closed');
  });
});
