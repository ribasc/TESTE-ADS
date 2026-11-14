import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'casamento-'));
process.env.DB_PATH = join(dir, 'test.db');
process.env.COUPLE_USERS = 'Lucas:lucas@teste.com:senha-123;Karen:karen@teste.com:senha-456';

const { app } = await import('../server/index.js');
let server, base, cookie;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (path, opts = {}) => fetch(base + path, {
  redirect: 'manual',
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...opts.headers },
  body: opts.body ? JSON.stringify(opts.body) : undefined,
});

test('sem login, a API e o painel ficam fechados', async () => {
  assert.equal((await call('/api/tasks')).status, 401);
  const r = await call('/painel/');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/entrar/);
});

test('senha errada é recusada', async () => {
  const r = await call('/api/login', { method: 'POST', body: { email: 'lucas@teste.com', password: 'errada' } });
  assert.equal(r.status, 401);
});

test('login do casal e CRUD', async () => {
  const r = await call('/api/login', { method: 'POST', body: { email: 'KAREN@teste.com', password: 'senha-456' } });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/painel/')).status, 200);

  const tpl = await (await call('/api/tasks/template', { method: 'POST' })).json();
  assert.ok(tpl.added > 30);
  const again = await (await call('/api/tasks/template', { method: 'POST' })).json();
  assert.equal(again.added, 0, 'não duplica o checklist');

  const g = await (await call('/api/guests', { method: 'POST', body: { name: 'Família Souza', adults: 2, children: 1, rsvp: 'confirmado', hacked: 'x' } })).json();
  assert.match(g.invite_code, /^[A-Z0-9]{7}$/);
  assert.equal(g.hacked, undefined);

  const bad = await call('/api/guests', { method: 'POST', body: { name: '' } });
  assert.equal(bad.status, 400);

  await call('/api/budget', { method: 'POST', body: { category: 'Buffet', estimated: '30000', actual: 28000, paid: 5000 } });
  await call('/api/settings', { method: 'PUT', body: { couple_names: 'Lucas & Karen', wedding_date: '2027-09-18' } });
  const d = await (await call('/api/dashboard')).json();
  assert.equal(d.guests.confirmed, 3);
  assert.equal(d.budget.actual, 28000);
  assert.equal(d.settings.couple_names, 'Lucas & Karen');

  await call('/api/logout', { method: 'POST' });
  assert.equal((await call('/api/tasks')).status, 401, 'sessão encerrada no logout');
});
