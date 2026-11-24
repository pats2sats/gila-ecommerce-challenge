import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { prepareImport } from '../src/import.ts';

const contents = readFileSync(new URL('../data/products.csv', import.meta.url), 'utf8');

test('the supplied file has observable and auditable normalization results', () => {
  const { candidates, issues, processed } = prepareImport(contents);
  assert.equal(processed, 97);
  assert.equal(candidates.length, 87);
  assert.equal(issues.filter(issue => issue.status === 'invalid').length, 7);
  assert.equal(issues.filter(issue => issue.status === 'duplicate').length, 1);
  assert.deepEqual(issues.filter(issue => issue.status === 'conflict').map(issue => issue.sku).sort(), ['BS-021', 'RS-001']);
  assert.equal(candidates.find(x => x.data.sku === 'RS-001')?.data.stock, 150);
  assert.equal(candidates.find(x => x.data.sku === 'WM-042')?.data.price, 2999);
  assert.ok(candidates.some(x => x.data.price === 0));
});

test('normalizes identity after validation and preserves quoted fields', () => {
  const csv = 'name,sku,description,category,price,stock,weight_kg\nFirst, x ,"a,b",A,0,1.0,1\nOther,X,c,A,1,2,1\n';
  const { candidates, issues } = prepareImport(csv);
  assert.equal(candidates[0].data.description, 'a,b');
  assert.equal(candidates[0].data.sku, 'X');
  assert.equal(issues[0].status, 'conflict');
  assert.throws(() => prepareImport('sku,name\nX,Y\n'), /include/);
  assert.throws(() => prepareImport(csv + 'Bad,"unterminated'), /Malformed/);
});
