import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/bot/utils/ttl-cache.js';

test('la caché de dispositivos caduca y respeta su tamaño máximo', async () => {
  const cache = new TtlCache({ ttlMs: 20, maxEntries: 2 });
  cache.set('a', [1]);
  cache.mset([{ key: 'b', value: [2] }, { key: 'c', value: [3] }]);
  assert.equal(cache.get('a'), undefined);
  assert.deepEqual(cache.mget(['b', 'c', 'x']), { b: [2], c: [3] });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(cache.get('b'), undefined);
  cache.set('d', [4]);
  cache.del('d');
  assert.equal(cache.get('d'), undefined);
});
