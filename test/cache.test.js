'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlCache } = require('../src/cache');

test('TtlCache stores, expires and evicts', async () => {
  const c = new TtlCache({ ttlMs: 20, max: 2 });
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.get('a'), 1); // a is now most recently used
  c.set('c', 3); // evicts b
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(c.get('c'), undefined);
});
