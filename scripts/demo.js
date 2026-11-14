// Abre o site com um banco separado (data/demo.db) cheio de dados de exemplo,
// para ver como tudo funciona sem mexer nos dados de verdade.
// Uso: npm run demo
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/demo.db';
rmSync('data/demo.db', { force: true });
rmSync('data/demo.db-wal', { force: true });
rmSync('data/demo.db-shm', { force: true });

const { db } = await import('../server/db.js');
const { createUser } = await import('../server/auth.js');
const { TASK_TEMPLATE, BUDGET_TEMPLATE } = await import('../server/templates.js');
const { app } = await import('../server/index.js');

createUser({ name: 'Lucas', email: 'lucas@demo.com', password: 'demo1234' });
createUser({ name: 'Karen', email: 'karen@demo.com', password: 'demo1234' });

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries({
  couple_names: 'Lucas & Karen', wedding_date: inDays(300), total_budget: '90000',
  ceremony_venue: 'Capela Santa Clara', ceremony_time: '16:30', reception_venue: 'Espaço Jardim',
  reception_time: '18:00', dress_code: 'Esporte fino. Evitem branco 😉',
  menu: 'Entrada: bruschettas\nPrincipal: risoto de cogumelos ou filé ao molho madeira\nSobremesa: mesa de doces',
})) set.run(k, v);

const task = db.prepare('INSERT INTO tasks (period, category, title, done, assignee, due_date) VALUES (?, ?, ?, ?, ?, ?)');
TASK_TEMPLATE.forEach(([p, c, t], i) => task.run(p, c, t, i < 5 ? 1 : 0,
  ['Lucas', 'Karen', 'Ambos', null][i % 4], i >= 5 && i < 9 ? inDays(i * 6 - 35) : null));

const vendor = db.prepare('INSERT INTO vendors (name, category, status, price, phone, instagram, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
const buffet = vendor.run('Buffet Jardim', 'Buffet', 'contratado', 32000, '11988887777', '@buffetjardim', 'Entrada, 2 pratos e sobremesa. 30% na assinatura.').lastInsertRowid;
vendor.run('Ana Fotografia', 'Fotografia e filmagem', 'negociando', 9500, '', '@anafoto', 'Pacote com álbum e drone.');
vendor.run('Studio Luz', 'Fotografia e filmagem', 'orcamento', null, '', '', '');
vendor.run('DJ Marcos', 'Música (banda/DJ)', 'pesquisando', 4500, '', '', '');

const budget = db.prepare('INSERT INTO budget_items (category, description, estimated, actual, paid, due_date, vendor_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
const filled = {
  'Local (cerimônia e festa)': ['Espaço Jardim', 18000, 18000, 18000, null, null],
  Buffet: ['150 pessoas', 35000, 32000, 9600, inDays(20), buffet],
  'Fotografia e filmagem': ['', 10000, 0, 0, null, null],
  'Vestido da noiva': ['', 6000, 5200, 2600, inDays(45), null],
};
for (const cat of BUDGET_TEMPLATE) budget.run(cat, ...(filled[cat] || ['', 0, 0, 0, null, null]));

const guest = db.prepare('INSERT INTO guests (name, side, group_name, adults, children, rsvp, invite_sent, dietary, invite_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
[
  ['Família Souza', 'Lado Lucas', 'Família', 2, 2, 'confirmado', 1, ''],
  ['Tia Maria', 'Lado Karen', 'Família', 1, 0, 'pendente', 1, 'vegetariana'],
  ['Pedro e Júlia', 'Dos dois', 'Amigos', 2, 0, 'confirmado', 1, ''],
  ['Vô Antônio', 'Lado Lucas', 'Família', 1, 0, 'recusado', 1, ''],
  ['Carla', 'Lado Karen', 'Trabalho', 1, 0, 'pendente', 0, 'sem glúten'],
  ['Rafael e Bia', 'Lado Lucas', 'Padrinhos', 2, 0, 'confirmado', 1, ''],
].forEach((g, i) => guest.run(...g, `DEMO00${i}`));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`\n♡ Site de demonstração no ar: http://localhost:${port}/painel`);
  console.log('  Entre com lucas@demo.com ou karen@demo.com, senha: demo1234');
  console.log('  (são dados de exemplo; apertem Ctrl+C para fechar)\n');
});
