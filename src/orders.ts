import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { HttpError } from './http.ts';

const cart = z.object({ items: z.array(z.object({
  productId: z.number().int().min(1).max(2147483647),
  quantity: z.number().int().min(1).max(1000)
}).strict()).min(1).max(100) }).strict();

export function registerOrders(app: FastifyInstance, pool: Pool) {
  app.post('/api/orders', async (request, reply) => {
    const { items } = cart.parse(request.body);
    const ids = items.map(item => item.productId);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Each product must appear once in the cart');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ id: number; name: string; sku: string; price_cents: number; stock: number }>(
        'SELECT id,name,sku,price_cents,stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]
      );
      const products = new Map(locked.rows.map(product => [product.id, product]));
      const orderItems = items.map(({ productId, quantity }) => {
        const product = products.get(productId);
        if (!product) throw new HttpError(409, 'A product in your cart is no longer available');
        if (product.stock < quantity) throw new HttpError(409, `Not enough stock for ${product.sku}`);
        return { productId, name: product.name, sku: product.sku, unitPriceCents: product.price_cents, quantity };
      });
      for (const { productId, quantity } of orderItems) {
        await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [quantity, productId]);
      }
      const id = randomUUID();
      const totalCents = orderItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
      const result = await client.query<{ created_at: Date }>(
        'INSERT INTO orders (id,total_cents,items) VALUES ($1,$2,$3) RETURNING created_at',
        [id, totalCents, JSON.stringify(orderItems)]
      );
      await client.query('COMMIT');
      return reply.code(201).send({ id, totalCents, items: orderItems, createdAt: result.rows[0].created_at, payment: 'simulated' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
