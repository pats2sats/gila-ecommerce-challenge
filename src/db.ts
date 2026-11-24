import pg from 'pg';
import type { Pool } from 'pg';

export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(728311)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)');
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE version = 1')).rowCount === 0) {
      await client.query(`
        CREATE TABLE products (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name text NOT NULL,
          sku text NOT NULL UNIQUE,
          description text NOT NULL,
          category text NOT NULL,
          price_cents integer NOT NULL CHECK (price_cents >= 0),
          stock integer NOT NULL CHECK (stock >= 0),
          weight_kg numeric(10, 3) NOT NULL CHECK (weight_kg >= 0)
        );
        CREATE TABLE orders (
          id uuid PRIMARY KEY,
          created_at timestamptz NOT NULL DEFAULT now(),
          total_cents bigint NOT NULL CHECK (total_cents >= 0),
          items jsonb NOT NULL
        );
        INSERT INTO schema_migrations VALUES (1);
      `);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function openDb(url: string) {
  return new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
}
