import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { HttpError } from './http.ts';

export const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(80).transform(s => s.toUpperCase()),
  description: z.string().trim().max(4000),
  category: z.string().trim().min(1).max(100),
  price: z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/).transform(s => {
    const [whole, cents = ''] = s.split('.');
    return Number(whole) * 100 + Number(cents.padEnd(2, '0'));
  }).pipe(z.number().max(2147483647)),
  stock: z.number().int().min(0).max(2147483647),
  weight_kg: z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/).transform(s => Number(s).toFixed(3))
}).strict();

export type ProductInput = z.output<typeof productInput>;

export function productValues(input: ProductInput) {
  return [input.name, input.sku, input.description, input.category, input.price, input.stock, input.weight_kg];
}

export const columns = 'name, sku, description, category, price_cents, stock, weight_kg';
export const productSelect = 'id, name, sku, description, category, (price_cents::numeric / 100)::numeric(12,2)::text AS price, stock, weight_kg::text';
const idParams = z.object({ id: z.coerce.number().int().min(1).max(2147483647) });
const searchParams = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export function registerProducts(app: FastifyInstance, pool: Pool) {
  app.get('/api/products', async request => {
    const { q, page, limit } = searchParams.parse(request.query);
    const result = await pool.query(`
      SELECT ${productSelect} FROM products
      WHERE strpos(lower(name), lower($1)) > 0 OR strpos(lower(sku), lower($1)) > 0
        OR strpos(lower(category), lower($1)) > 0 OR strpos(lower(description), lower($1)) > 0
      ORDER BY id LIMIT $2 OFFSET $3
    `, [q, limit + 1, (page - 1) * limit]);
    return { items: result.rows.slice(0, limit), page, limit, hasMore: result.rows.length > limit };
  });
  app.get('/api/products/:id', async request => {
    const { id } = idParams.parse(request.params);
    const result = await pool.query(`SELECT ${productSelect} FROM products WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, 'Product not found');
    return result.rows[0];
  });
  app.post('/api/products', async (request, reply) => {
    const input = productInput.parse(request.body);
    const result = await pool.query(`
      INSERT INTO products (${columns}) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${productSelect}
    `, productValues(input));
    return reply.code(201).send(result.rows[0]);
  });
  app.put('/api/products/:id', async request => {
    const { id } = idParams.parse(request.params);
    const input = productInput.parse(request.body);
    const result = await pool.query(`
      UPDATE products SET (${columns}) = ($1,$2,$3,$4,$5,$6,$7) WHERE id = $8 RETURNING ${productSelect}
    `, [...productValues(input), id]);
    if (!result.rows[0]) throw new HttpError(404, 'Product not found');
    return result.rows[0];
  });
  app.delete('/api/products/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await pool.query('DELETE FROM products WHERE id = $1', [id]);
    if (!result.rowCount) throw new HttpError(404, 'Product not found');
    return reply.code(204).send();
  });
}
