import type { INestApplication } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RabbitMqPublisher } from '../src/messaging/rabbitmq-publisher.service.js';
import type { SendOrderConfirmation } from '../src/notifications/send-order-confirmation.js';

describe('Orders API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let notificationSpy: MockInstance<NotificationsService['sendOrderCreated']>;
  const publish = vi.fn<(command: SendOrderConfirmation) => Promise<void>>();
  const customerEmail = 'user@example.com';
  const valid = { customerEmail, items: [{ productId: 11, quantity: 1 }] };
  const post = (body: object) =>
    request(app.getHttpServer()).post('/orders').send(body);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RabbitMqPublisher)
      .useValue({ publish })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    const [database] = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;
    expect(database.name).toMatch(/^order_flow_test_[a-f0-9]{32}$/);
  });

  beforeEach(async () => {
    publish.mockReset().mockResolvedValue(undefined);
    notificationSpy = vi.spyOn(notifications, 'sendOrderCreated');
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.product.createMany({
      data: [
        { id: 11, name: 'Notebook', price: 1000, stock: 5 },
        { id: 22, name: 'Pen', price: 500, stock: 3 },
        { id: 33, name: 'Cup', price: 1500, stock: 0 },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function expectUnchanged() {
    expect(notificationSpy).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
    expect(
      await prisma.product.findMany({
        orderBy: { id: 'asc' },
        select: { stock: true },
      }),
    ).toEqual([{ stock: 5 }, { stock: 3 }, { stock: 0 }]);
  }

  it('waits for publication after commit while reads and stock locks remain available', async () => {
    let confirm!: () => void;
    publish.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    );
    let completed = false;
    const pending = post(valid)
      .expect(201)
      .then((response) => {
        completed = true;
        return response;
      });
    try {
      await vi.waitFor(() => {
        expect(publish).toHaveBeenCalledOnce();
      });
      expect(completed).toBe(false);
      const command = publish.mock.calls[0][0];
      const orderId = command.orderId;
      expect(command).toEqual({
        messageId: expect.any(String),
        orderId: expect.any(Number),
        customerEmail,
        createdAt: expect.any(String),
      });
      expect(command.messageId).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(command.createdAt).toISOString()).toBe(command.createdAt);
      const read = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .expect(200);
      expect(read.body.id).toBe(orderId);
      expect(completed).toBe(false);

      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = 11 FOR UPDATE NOWAIT`;
      });
      expect(completed).toBe(false);
      confirm();
      const response = await pending;
      expect(response.body).toEqual(read.body);
    } finally {
      confirm?.();
      await pending;
    }
  }, 10000);

  it('returns the saved order with 201 when publication fails', async () => {
    publish.mockRejectedValueOnce(new Error('Broker unavailable'));
    const response = await post(valid).expect(201);
    expect(await prisma.order.count()).toBe(1);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: 11 } })).stock,
    ).toBe(4);
    expect(publish.mock.calls[0][0].orderId).toBe(response.body.id);
    const read = await request(app.getHttpServer())
      .get(`/orders/${response.body.id}`)
      .expect(200);
    expect(read.body).toEqual(response.body);
  });

  it('reads a created order with saved prices after the catalog changes', async () => {
    const created = await post({
      customerEmail,
      items: [
        { productId: 22, quantity: 1 },
        { productId: 11, quantity: 2 },
      ],
    }).expect(201);
    const before = await prisma.product.findMany({ orderBy: { id: 'asc' } });
    await prisma.product.update({ where: { id: 11 }, data: { price: 9999 } });
    const response = await request(app.getHttpServer())
      .get(`/orders/${created.body.id}`)
      .expect(200);
    expect(response.body).toEqual(created.body);
    expect(
      await prisma.product.findMany({
        orderBy: { id: 'asc' },
        select: { stock: true },
      }),
    ).toEqual(before.map(({ stock }) => ({ stock })));
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderItem.count()).toBe(2);
  });

  it('returns 404 for a missing order', async () => {
    await request(app.getHttpServer()).get('/orders/2147483647').expect(404);
    await expectUnchanged();
  });

  it.each([
    'abc',
    '0',
    '-1',
    '1.5',
    '1e0',
    '0x1',
    '1abc',
    'NaN',
    'Infinity',
    '2147483648',
    '9007199254740993',
    '%20',
    '%201%20',
  ])('returns 400 for invalid order id %s', async (id) => {
    await request(app.getHttpServer()).get(`/orders/${id}`).expect(400);
    await expectUnchanged();
  });

  it('creates an order using database prices and returns only API fields', async () => {
    const response = await post({
      customerEmail,
      items: [
        { productId: 22, quantity: 1 },
        { productId: 11, quantity: 2 },
      ],
    }).expect(201);
    expect(response.body).toEqual({
      id: expect.any(Number),
      customerEmail,
      status: 'CREATED',
      totalAmount: 2500,
      items: [
        { productId: 11, quantity: 2, unitPrice: 1000 },
        { productId: 22, quantity: 1, unitPrice: 500 },
      ],
    });
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderItem.count()).toBe(2);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: 11 } })).stock,
    ).toBe(3);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: 22 } })).stock,
    ).toBe(2);
    await prisma.product.update({ where: { id: 11 }, data: { price: 9999 } });
    expect(
      (await prisma.orderItem.findFirstOrThrow({ where: { productId: 11 } }))
        .unitPrice,
    ).toBe(1000);
  });

  it.each([
    ['missing fields', {}],
    ['invalid email', { ...valid, customerEmail: 'invalid' }],
    ['empty items', { customerEmail, items: [] }],
    ['non-array items', { customerEmail, items: {} }],
    ['null items', { customerEmail, items: null }],
    ['null item', { customerEmail, items: [null] }],
    ['array item', { customerEmail, items: [[]] }],
    ['primitive item', { customerEmail, items: [1] }],
    ['missing quantity', { customerEmail, items: [{ productId: 11 }] }],
    [
      'zero quantity',
      { customerEmail, items: [{ productId: 11, quantity: 0 }] },
    ],
    [
      'negative quantity',
      { customerEmail, items: [{ productId: 11, quantity: -1 }] },
    ],
    [
      'fractional quantity',
      { customerEmail, items: [{ productId: 11, quantity: 1.5 }] },
    ],
    [
      'string quantity',
      { customerEmail, items: [{ productId: 11, quantity: '1' }] },
    ],
    [
      'oversized quantity',
      { customerEmail, items: [{ productId: 11, quantity: 2147483648 }] },
    ],
    [
      'zero product ID',
      { customerEmail, items: [{ productId: 0, quantity: 1 }] },
    ],
    [
      'negative product ID',
      { customerEmail, items: [{ productId: -1, quantity: 1 }] },
    ],
    [
      'fractional product ID',
      { customerEmail, items: [{ productId: 1.5, quantity: 1 }] },
    ],
    [
      'string product ID',
      { customerEmail, items: [{ productId: '11', quantity: 1 }] },
    ],
    [
      'oversized product ID',
      { customerEmail, items: [{ productId: 2147483648, quantity: 1 }] },
    ],
    [
      'duplicate product',
      {
        customerEmail,
        items: [
          { productId: 11, quantity: 1 },
          { productId: 11, quantity: 2 },
        ],
      },
    ],
    [
      'client unit price',
      { customerEmail, items: [{ productId: 11, quantity: 1, unitPrice: 1 }] },
    ],
    ['client total', { ...valid, totalAmount: 1 }],
  ])('rejects %s with 400 and no writes', async (_name, body) => {
    await post(body).expect(400);
    await expectUnchanged();
  });

  it('returns 404 for a missing product without partial changes', async () => {
    await post({
      customerEmail,
      items: [
        { productId: 11, quantity: 1 },
        { productId: 9999, quantity: 1 },
      ],
    }).expect(404);
    await expectUnchanged();
  });

  it('returns 409 when stock is insufficient', async () => {
    await post({
      customerEmail,
      items: [{ productId: 22, quantity: 4 }],
    }).expect(409);
    await expectUnchanged();
  });

  it('rolls back an earlier stock decrement when a later item is unavailable', async () => {
    await post({
      customerEmail,
      items: [
        { productId: 11, quantity: 2 },
        { productId: 33, quantity: 1 },
      ],
    }).expect(409);
    await expectUnchanged();
  });

  it('rolls back stock and order if inserting a position fails in PostgreSQL', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION reject_test_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Intentional e2e insert failure'; END;
      $$
    `);
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER reject_test_order_item BEFORE INSERT ON "OrderItem"
        FOR EACH ROW EXECUTE FUNCTION reject_test_order_item()
      `);
      await post(valid).expect(500);
      await expectUnchanged();
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_test_order_item ON "OrderItem"',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION reject_test_order_item()');
    }
  });

  it('returns 400 instead of overflowing the integer amount column', async () => {
    await post({
      customerEmail,
      items: [{ productId: 11, quantity: 2147483647 }],
    }).expect(400);
    await expectUnchanged();
  });

  it('allows only one concurrent order for the last unit', async () => {
    await prisma.product.update({ where: { id: 11 }, data: { stock: 1 } });
    const responses = await Promise.all([post(valid), post(valid)]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: 11 } })).stock,
    ).toBe(0);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderItem.count()).toBe(1);
  });

  it('handles concurrent orders whose input items are in opposite order', async () => {
    const first = [
      { productId: 11, quantity: 1 },
      { productId: 22, quantity: 1 },
    ];
    const responses = await Promise.all([
      post({ customerEmail, items: first }),
      post({ customerEmail, items: [...first].reverse() }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: 11 } })).stock,
    ).toBe(3);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: 22 } })).stock,
    ).toBe(1);
    expect(await prisma.order.count()).toBe(2);
  });
});
