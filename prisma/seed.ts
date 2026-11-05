import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required. Configure it in .env.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }),
});

try {
  await prisma.$transaction(async (tx) => {
    await tx.product.createMany({
      data: [
        { id: 1, name: 'Блокнот', price: 25000, stock: 20 },
        { id: 2, name: 'Ручка', price: 5000, stock: 100 },
        { id: 3, name: 'Кружка', price: 75000, stock: 5 },
        { id: 4, name: 'Рюкзак', price: 350000, stock: 1 },
        { id: 5, name: 'Термос', price: 150000, stock: 0 },
      ],
      skipDuplicates: true,
    });

    // Explicit seed IDs must not collide with subsequent auto-generated IDs.
    // Keep the sequence ahead of existing products without moving it backwards.
    await tx.$queryRaw`
      SELECT setval(
        pg_get_serial_sequence('"Product"', 'id'),
        GREATEST(
          (SELECT MAX("id") FROM "Product"),
          (SELECT last_value FROM "Product_id_seq")
        ),
        true
      )
    `;
  });
  console.log('Product seed completed (existing products preserved).');
} finally {
  await prisma.$disconnect();
}
