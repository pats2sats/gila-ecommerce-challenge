import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { migrate, openDb } from '../src/db.ts';
import { createApp } from '../src/http.ts';
import { registerProducts } from '../src/products.ts';
import { registerImport } from '../src/import.ts';
import { registerOrders } from '../src/orders.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const csv = readFileSync(new URL('../data/products.csv', import.meta.url), 'utf8');

test('API persists catalog, imports idempotently and prevents concurrent overselling', { skip: !databaseUrl && 'Set TEST_DATABASE_URL to an isolated PostgreSQL database' }, async () => {
  const admin = openDb(databaseUrl!);
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', '-c search_path=' + schema);
  let pool = openDb(url.href);
  const makeApp = () => {
    const app = createApp(pool);
    registerProducts(app, pool);
    registerImport(app, pool);
    registerOrders(app, pool);
    return app;
  };
  let app = makeApp();
  try {
    await migrate(pool);
    const headers = { 'content-type': 'text/csv' };
    const importFile = () => app.inject({ method:'POST', url:'/api/products/import', headers, payload:csv });
    const initial = await importFile();
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().inserted, 87);
    const initialList = (await app.inject('/api/products?q=rs-001')).json();
    assert.equal(initialList.items.length, 1);
    const runner = initialList.items[0];
    assert.equal(runner.stock, 150);
    assert.equal((await app.inject('/api/products?limit=1')).json().hasMore, true);
    assert.equal((await app.inject('/api/products?q=Running%25Shoes')).json().items.length, 0);

    const paid = await app.inject({method:'POST',url:'/api/orders',payload:{items:[{productId:runner.id,quantity:2}]}});
    assert.equal(paid.statusCode, 201);
    assert.equal(paid.json().totalCents, 17998);
    assert.equal(paid.json().payment, 'simulated');
    const repeat = await importFile();
    assert.equal(repeat.json().inserted, 0);
    assert.equal((await app.inject('/api/products/' + runner.id)).json().stock, 148);

    const input = {name:'Last item', sku:'LAST', description:'', category:'Test', price:'8.99', stock:1, weight_kg:'1'};
    const created = await app.inject({method:'POST',url:'/api/products',payload:input});
    assert.equal(created.statusCode, 201);
    const item = created.json();
    assert.equal((await app.inject({method:'POST',url:'/api/products',payload:input})).statusCode,409);
    const edit = await app.inject({method:'PUT',url:'/api/products/' + item.id,payload:{...input,name:'Updated item'}});
    assert.equal(edit.json().name,'Updated item');
    const place = () => app.inject({method:'POST',url:'/api/orders',payload:{items:[{productId:item.id,quantity:1}]}});
    const results = await Promise.all([place(),place()]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [201,409]);
    assert.equal((await app.inject('/api/products/' + item.id)).json().stock, 0);

    const invalid = await app.inject({method:'POST',url:'/api/orders',payload:{items:[{productId:runner.id,quantity:1},{productId:item.id,quantity:1}]}});
    assert.equal(invalid.statusCode,409);
    assert.equal((await app.inject('/api/products/' + runner.id)).json().stock,148);
    assert.equal((await app.inject({method:'DELETE',url:'/api/products/' + item.id})).statusCode,204);
    assert.equal((await app.inject('/api/products/' + item.id)).statusCode,404);

    await app.close();
    await pool.end();
    pool = openDb(url.href);
    app = makeApp();
    await migrate(pool);
    assert.equal((await app.inject('/api/products/' + runner.id)).json().stock,148);
    const orders = await pool.query('SELECT total_cents, items FROM orders ORDER BY total_cents');
    assert.equal(orders.rows.length,2);
    assert.equal(orders.rows[0].items[0].name,'Updated item');
  } finally {
    await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
