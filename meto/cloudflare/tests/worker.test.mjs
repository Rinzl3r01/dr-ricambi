import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { allowedOrigins } from '../worker.mjs';

test('only explicit HTTPS origins, no wildcard, paths or credentials', () => {
  assert.deepEqual(allowedOrigins('https://odoo.example, https://odoo.example/'), ['https://odoo.example']);
  for (const value of ['http://odoo.example','https://*.example','https://user:secret@odoo.example','https://odoo.example/path','https://odoo.example/?x=1','https://odoo.example/#x']) assert.throws(() => allowedOrigins(value));
});
test('config and assets have restrictive headers, no permissive CORS', async () => {
  const env = { ODOO_ORIGINS: 'https://odoo.example', ASSETS: { fetch: async () => new Response('<html>METO</html>') } };
  const response = await worker.fetch(new Request('https://meto.example/config.json'), env);
  assert.deepEqual(await response.json(), {odooOrigins:['https://odoo.example']});
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors https:\/\/odoo.example/);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const html = await worker.fetch(new Request('https://meto.example/'), env);
  assert.equal(await html.text(), '<html>METO</html>');
  assert.equal(html.headers.get('Cache-Control'), 'no-cache');
});
test('unconfigured frame is blocked, invalid configuration fails closed', async () => {
  const env = { ASSETS:{fetch:async()=>new Response('METO')} };
  const res = await worker.fetch(new Request('https://meto.example/'), env);
  assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal((await worker.fetch(new Request('https://meto.example/'), {...env, ODOO_ORIGINS:'http://bad'})).status, 503);
});
test('no write endpoints or signing oracle', async () => {
  assert.equal((await worker.fetch(new Request('https://meto.example/',{method:'POST'}),{})).status,405);
  assert.equal((await worker.fetch(new Request('https://meto.example/api/sign'),{})).status,404);
});
