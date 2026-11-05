import 'dotenv/config';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const execute = promisify(execFile);

export default async function setup() {
  const originalUrl = process.env.DATABASE_URL;
  if (!originalUrl) throw new Error('DATABASE_URL is required for e2e tests');

  const database = `order_flow_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: originalUrl,
      connectionTimeoutMillis: 5000,
    }),
  });
  let created = false;
  const cleanup = async () => {
    try {
      if (created) {
        await admin.$executeRawUnsafe(
          `DROP DATABASE "${database}" WITH (FORCE)`,
        );
      }
    } finally {
      await admin.$disconnect();
      process.env.DATABASE_URL = originalUrl;
    }
  };

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    const url = new URL(originalUrl);
    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.href;
    await execute(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        env: process.env,
        timeout: 60000,
      },
    );
    return cleanup;
  } catch {
    await cleanup();
    throw new Error(
      'Cannot prepare the temporary e2e database. Check PostgreSQL, DATABASE_URL and CREATEDB permission.',
    );
  }
}
