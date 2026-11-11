import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';

const orderSelect = {
  id: true,
  customerEmail: true,
  status: true,
  totalAmount: true,
  items: {
    orderBy: { productId: 'asc' },
    select: { productId: true, quantity: true, unitPrice: true },
  },
} satisfies Prisma.OrderSelect;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findOne(id: number) {
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
      throw new BadRequestException(
        'Order id must be an integer between 1 and 2147483647',
      );
    }
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: orderSelect,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async create(dto: CreateOrderDto) {
    // All requests acquire stock locks in the same order.
    const items = [...dto.items].sort((a, b) => a.productId - b.productId);

    const order = await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: items.map((item) => item.productId) } },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      let totalAmount = 0;
      const orderItems = items.map((item) => {
        const product = byId.get(item.productId);
        if (!product) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }
        totalAmount += product.price * item.quantity;
        if (totalAmount > 2147483647) {
          throw new BadRequestException(
            'Order total exceeds the supported limit',
          );
        }
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: product.price,
        };
      });

      for (const item of orderItems) {
        const { count } = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (count !== 1) {
          throw new ConflictException(
            `Insufficient stock for product ${item.productId}`,
          );
        }
      }

      return tx.order.create({
        data: {
          customerEmail: dto.customerEmail,
          totalAmount,
          items: { create: orderItems },
        },
        select: orderSelect,
      });
    });
    // Commit and release stock locks before waiting for the broker confirm.
    await this.notifications.sendOrderCreated(order);
    return order;
  }
}
