import { resolve } from 'node:path';
import serveStatic from '@fastify/static';
import { migrate, openDb } from './db.ts';
import { createApp } from './http.ts';
import { registerProducts } from './products.ts';
import { registerImport } from './import.ts';

const pool = openDb(process.env.DATABASE_URL ?? 'postgres://commerce:commerce_local@localhost:5432/commerce');
const app = createApp(pool, true);
registerProducts(app, pool);
registerImport(app, pool);
app.addHook('onClose', () => pool.end());
await migrate(pool);
await app.register(serveStatic, { root: resolve('dist') });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close());
