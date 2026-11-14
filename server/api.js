import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { TASK_TEMPLATE, BUDGET_TEMPLATE, PERIODS } from './templates.js';

// Campos aceitos em cada recurso. Nada fora desta lista chega ao SQL.
const RESOURCES = {
  tasks: {
    table: 'tasks',
    order: 'done ASC, due_date IS NULL, due_date ASC, id ASC',
    fields: { title: 'text!', period: 'text', category: 'text', due_date: 'date', assignee: 'text', done: 'bool', notes: 'text' },
  },
  vendors: {
    table: 'vendors',
    order: 'category ASC, name ASC',
    fields: {
      name: 'text!', category: 'text', contact_name: 'text', phone: 'text', email: 'text',
      instagram: 'text', price: 'money', status: 'text', notes: 'text',
    },
  },
  budget: {
    table: 'budget_items',
    order: 'category ASC, id ASC',
    fields: {
      category: 'text!', description: 'text', estimated: 'money', actual: 'money', paid: 'money',
      due_date: 'date', vendor_id: 'int', notes: 'text',
    },
  },
  guests: {
    table: 'guests',
    order: 'name ASC',
    fields: {
      name: 'text!', side: 'text', group_name: 'text', adults: 'int', children: 'int', phone: 'text',
      email: 'text', rsvp: 'text', invite_sent: 'bool', dietary: 'text', table_name: 'text', notes: 'text',
    },
  },
};

const SETTINGS_KEYS = [
  'couple_names', 'wedding_date', 'ceremony_time', 'reception_time',
  'ceremony_venue', 'ceremony_address', 'reception_venue', 'reception_address',
  'dress_code', 'menu', 'total_budget', 'pix_key', 'pix_name', 'guest_message', 'notes',
];

class BadRequest extends Error {}

function coerce(type, value, field) {
  const required = type.endsWith('!');
  const base = type.replace('!', '');
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    if (required) throw new BadRequest(`O campo "${field}" é obrigatório.`);
    if (base === 'money' || base === 'int' || base === 'bool') return base === 'bool' ? 0 : null;
    return null;
  }
  switch (base) {
    case 'text': {
      const s = String(value).trim().slice(0, 5000);
      if (required && !s) throw new BadRequest(`O campo "${field}" é obrigatório.`);
      return s;
    }
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new BadRequest(`Data inválida em "${field}".`);
      return String(value);
    case 'money': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) throw new BadRequest(`Valor inválido em "${field}".`);
      return Math.round(n * 100) / 100;
    }
    case 'int': {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n)) throw new BadRequest(`Número inválido em "${field}".`);
      return n;
    }
    case 'bool':
      return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
    default:
      return undefined;
  }
}

function pick(def, body, { partial }) {
  const out = {};
  for (const [field, type] of Object.entries(def.fields)) {
    if (!(field in body)) {
      if (!partial && type.endsWith('!')) throw new BadRequest(`O campo "${field}" é obrigatório.`);
      continue;
    }
    out[field] = coerce(type, body[field], field);
  }
  return out;
}

const newInviteCode = () => randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 7).toUpperCase();

export const api = Router();

api.get('/me', (req, res) => res.json({ user: req.user }));

api.get('/meta', (req, res) => {
  const users = db.prepare('SELECT id, name FROM users ORDER BY id').all();
  res.json({ users, periods: PERIODS, budgetCategories: BUDGET_TEMPLATE });
});

// ---- Configurações / detalhes do casamento ----
api.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, '']));
  for (const r of rows) if (SETTINGS_KEYS.includes(r.key)) out[r.key] = r.value ?? '';
  res.json(out);
});

api.put('/settings', (req, res) => {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of SETTINGS_KEYS) {
    if (key in req.body) stmt.run(key, req.body[key] == null ? '' : String(req.body[key]).slice(0, 10000));
  }
  res.json({ ok: true });
});

// ---- Painel (resumo) ----
api.get('/dashboard', (req, res) => {
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const tasks = db.prepare('SELECT COUNT(*) total, COALESCE(SUM(done),0) done FROM tasks').get();
  const nextTasks = db.prepare(`SELECT id, title, due_date, assignee, period FROM tasks WHERE done = 0
    ORDER BY due_date IS NULL, due_date ASC, id ASC LIMIT 6`).all();
  const budget = db.prepare(`SELECT COALESCE(SUM(estimated),0) estimated, COALESCE(SUM(actual),0) actual,
    COALESCE(SUM(paid),0) paid FROM budget_items`).get();
  const upcomingPayments = db.prepare(`SELECT id, category, description, actual, paid, due_date FROM budget_items
    WHERE due_date IS NOT NULL AND paid < CASE WHEN actual > 0 THEN actual ELSE estimated END
    ORDER BY due_date ASC LIMIT 5`).all();
  const guests = db.prepare(`SELECT COUNT(*) invites,
    COALESCE(SUM(adults + children),0) people,
    COALESCE(SUM(CASE WHEN rsvp='confirmado' THEN adults + children END),0) confirmed,
    COALESCE(SUM(CASE WHEN rsvp='recusado' THEN adults + children END),0) declined,
    COALESCE(SUM(CASE WHEN rsvp='pendente' THEN adults + children END),0) pending,
    COALESCE(SUM(invite_sent),0) sent FROM guests`).get();
  const vendors = db.prepare(`SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN status='contratado' THEN 1 END),0) hired FROM vendors`).get();
  res.json({
    settings: { couple_names: s.couple_names || '', wedding_date: s.wedding_date || '', total_budget: Number(s.total_budget) || 0 },
    tasks, nextTasks, budget, upcomingPayments, guests, vendors,
  });
});

// ---- Modelos prontos ----
api.post('/tasks/template', (req, res) => {
  const existing = new Set(db.prepare('SELECT title FROM tasks').all().map((r) => r.title));
  const stmt = db.prepare('INSERT INTO tasks (period, category, title) VALUES (?, ?, ?)');
  let added = 0;
  for (const [period, category, title] of TASK_TEMPLATE) {
    if (!existing.has(title)) { stmt.run(period, category, title); added++; }
  }
  res.json({ added });
});

api.post('/budget/template', (req, res) => {
  const existing = new Set(db.prepare('SELECT category FROM budget_items').all().map((r) => r.category));
  const stmt = db.prepare('INSERT INTO budget_items (category) VALUES (?)');
  let added = 0;
  for (const cat of BUDGET_TEMPLATE) if (!existing.has(cat)) { stmt.run(cat); added++; }
  res.json({ added });
});

// ---- CRUD genérico ----
for (const [name, def] of Object.entries(RESOURCES)) {
  const one = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`);

  api.get(`/${name}`, (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${def.table} ORDER BY ${def.order}`).all());
  });

  api.post(`/${name}`, (req, res) => {
    const data = pick(def, req.body || {}, { partial: false });
    if (name === 'guests') data.invite_code = newInviteCode();
    const cols = Object.keys(data);
    const r = db.prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...Object.values(data));
    res.status(201).json(one.get(r.lastInsertRowid));
  });

  api.patch(`/${name}/:id`, (req, res) => {
    const data = pick(def, req.body || {}, { partial: true });
    const cols = Object.keys(data);
    if (!one.get(req.params.id)) return res.status(404).json({ error: 'Não encontrado.' });
    if (cols.length) {
      db.prepare(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...Object.values(data), req.params.id);
    }
    res.json(one.get(req.params.id));
  });

  api.delete(`/${name}/:id`, (req, res) => {
    const r = db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  });
}

api.use((err, req, res, next) => {
  if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erro inesperado no servidor.' });
});
