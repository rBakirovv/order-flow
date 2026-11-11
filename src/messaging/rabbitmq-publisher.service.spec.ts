import { EventEmitter } from 'node:events';
import { connect } from 'amqplib';
import { RabbitMqPublisher } from './rabbitmq-publisher.service.js';

vi.mock('amqplib', () => ({ connect: vi.fn() }));

describe('RabbitMqPublisher', () => {
  const command = {
    messageId: '550e8400-e29b-41d4-a716-446655440000',
    orderId: 42,
    customerEmail: 'user@example.com',
    createdAt: '2026-11-11T12:00:00.000Z',
  };
  let publisher: RabbitMqPublisher;
  let confirm: (error: Error | null) => void;
  let channel: EventEmitter & {
    assertQueue: ReturnType<typeof vi.fn>;
    sendToQueue: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let connection: EventEmitter & {
    createConfirmChannel: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubEnv('RABBITMQ_URL', 'amqp://localhost');
    channel = Object.assign(new EventEmitter(), {
      assertQueue: vi.fn().mockResolvedValue({}),
      sendToQueue: vi
        .fn()
        .mockImplementation((_queue, _body, _options, callback) => {
          confirm = callback;
          return true;
        }),
      close: vi.fn().mockImplementation(async () => {
        channel.emit('close');
      }),
    });
    connection = Object.assign(new EventEmitter(), {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockImplementation(async () => {
        connection.emit('close');
      }),
    });
    vi.mocked(connect)
      .mockReset()
      .mockResolvedValue(connection as never);
    publisher = new RabbitMqPublisher();
  });

  afterEach(async () => {
    await publisher.onApplicationShutdown();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function startPublication() {
    const pending = publisher.publish(command);
    await vi.waitFor(() => expect(channel.sendToQueue).toHaveBeenCalledOnce());
    return { pending };
  }

  it('waits for broker confirmation rather than the sendToQueue boolean', async () => {
    const { pending } = await startPublication();
    let completed = false;
    void pending.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(channel.assertQueue).toHaveBeenCalledWith('email.notifications', {
      durable: true,
    });
    const [queue, body, options] = channel.sendToQueue.mock.calls[0];
    expect(queue).toBe('email.notifications');
    expect(JSON.parse(body.toString())).toEqual(command);
    expect(options).toMatchObject({
      persistent: true,
      mandatory: true,
      messageId: command.messageId,
    });
    confirm(null);
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects broker nacks', async () => {
    const { pending } = await startPublication();
    const rejected = expect(pending).rejects.toThrow('nack');
    confirm(new Error('nack'));
    await rejected;
  });

  it('rejects unroutable messages even when followed by a confirm', async () => {
    const { pending } = await startPublication();
    const rejected = expect(pending).rejects.toThrow('could not route');
    channel.emit('return', { properties: { messageId: command.messageId } });
    confirm(null);
    await rejected;
  });

  it('times out missing confirms and closes the channel without retrying', async () => {
    vi.useFakeTimers();
    const { pending } = await startPublication();
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(channel.close).toHaveBeenCalledOnce();
    expect(channel.sendToQueue).toHaveBeenCalledOnce();
  });

  it('allows a later request to reconnect after a connection failure', async () => {
    vi.mocked(connect).mockRejectedValueOnce(new Error('Connection refused'));
    await expect(publisher.publish(command)).rejects.toThrow(
      'Connection refused',
    );
    const { pending } = await startPublication();
    confirm(null);
    await pending;
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
