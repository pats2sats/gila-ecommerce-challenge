import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { parse } from 'csv-parse/sync';
import { HttpError } from './http.ts';
import { columns, productInput, productValues } from './products.ts';
import type { ProductInput } from './products.ts';

const required = ['name', 'sku', 'description', 'category', 'price', 'stock', 'weight_kg'] as const;
type Issue = { row: number; sku: string; status: 'invalid' | 'duplicate' | 'conflict' | 'existing'; message: string };
type Candidate = { row: number; data: ProductInput };

export function prepareImport(csv: string) {
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(csv, { bom: true, info: true, skip_empty_lines: true, relax_column_count: true }) as unknown as typeof records;
  } catch {
    throw new HttpError(400, 'Malformed CSV');
  }
  const headers = records.shift()?.record.map(s => s.trim().toLowerCase()) ?? [];
  if (new Set(headers).size !== headers.length || required.some(h => !headers.includes(h))) {
    throw new HttpError(400, 'CSV must have unique headers and include: ' + required.join(', '));
  }
  if (records.length > 5000) throw new HttpError(400, 'CSV may contain at most 5000 records');
  const issues: Issue[] = [];
  const candidates: Candidate[] = [];
  const seen = new Map<string, ProductInput>();
  for (const { record, info } of records) {
    const row = info.lines;
    const fields = Object.fromEntries(required.map(h => [h, (record[headers.indexOf(h)] ?? '').trim()]));
    const stock = /^\d+(\.0+)?$/.test(fields.stock) ? Number(fields.stock) : NaN;
    const parsed = productInput.safeParse({
      ...fields, stock, price: fields.price.toLowerCase() === 'free' ? '0' : fields.price.replace(/^\$\s*/, '')
    });
    if (!parsed.success || record.length !== headers.length) {
      issues.push({
        row, sku: fields.sku, status: 'invalid',
        message: record.length !== headers.length ? 'Wrong column count' :
          parsed.error?.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') ?? 'Invalid row'
      });
      continue;
    }
    const data = parsed.data;
    const prior = seen.get(data.sku);
    if (prior) {
      const same = JSON.stringify(prior) === JSON.stringify(data);
      issues.push({ row, sku: data.sku, status: same ? 'duplicate' : 'conflict', message: same ? 'Identical product already seen in this file' : 'SKU conflicts with the first valid row' });
      continue;
    }
    seen.set(data.sku, data);
    candidates.push({ row, data });
  }
  return { candidates, issues, processed: records.length };
}

export function registerImport(app: FastifyInstance, pool: Pool) {
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_, body, done) => done(null, body));
  app.post('/api/products/import', async request => {
    if (typeof request.body !== 'string') throw new HttpError(415, 'Send the file as text/csv');
    const { candidates, issues, processed } = prepareImport(request.body);
    let inserted = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const { data, row } of [...candidates].sort((a, b) => a.data.sku < b.data.sku ? -1 : 1)) {
        const result = await client.query(`
          INSERT INTO products (${columns}) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (sku) DO NOTHING
        `, productValues(data));
        if (result.rowCount) inserted++;
        else issues.push({ row, sku: data.sku, status: 'existing', message: 'Existing inventory left unchanged' });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { processed, inserted, skipped: processed - inserted, issues: issues.sort((a, b) => a.row - b.row) };
  });
}
