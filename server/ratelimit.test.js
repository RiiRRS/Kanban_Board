import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from './security.js';

test('rateLimit: dopo il massimo risponde 429 con Retry-After', () => {
  const limit = rateLimit({ windowMs: 60_000, max: 2 });
  const headers = {};
  const res = { set: (k, v) => (headers[k] = v) };
  const req = { ip: '1.2.3.4' };
  const results = [];
  for (let i = 0; i < 3; i++) limit(req, res, (err) => results.push(err?.status ?? 'ok'));
  assert.deepEqual(results, ['ok', 'ok', 429]);
  assert.ok(Number(headers['Retry-After']) > 0);
  // un altro IP ha il suo contatore
  limit({ ip: '5.6.7.8' }, res, (err) => results.push(err?.status ?? 'ok'));
  assert.equal(results.at(-1), 'ok');
});
