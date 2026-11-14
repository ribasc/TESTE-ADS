import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DB_FILE } from './db.js';
import {
  requireCouple, login, logout, getSessionToken, setSessionCookie, clearSessionCookie,
  loginRateLimit, seedUsersFromEnv, countUsers, userFromRequest,
} from './auth.js';
import { api } from './api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

seedUsersFromEnv();

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Recursos públicos (CSS/fontes/ícones compartilhados).
app.use('/assets', express.static(join(pub, 'assets')));

// Login do casal
app.get('/entrar', (req, res) => {
  if (userFromRequest(req)) return res.redirect('/painel');
  res.sendFile(join(pub, 'entrar.html'));
});

app.post('/api/login', loginRateLimit, (req, res) => {
  const result = login(req.body?.email, req.body?.password);
  if (!result) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  setSessionCookie(res, result.token, result.expires);
  res.json({ user: result.user });
});

app.post('/api/logout', (req, res) => {
  logout(getSessionToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Área privada do casal: página e API exigem login.
app.use('/painel', requireCouple, express.static(join(pub, 'painel')));
app.use('/api', requireCouple, api);

// Página dos convidados (por enquanto, um "em breve").
app.get('/', (req, res) => res.sendFile(join(pub, 'index.html')));

app.use((req, res) => res.status(404).send('Página não encontrada.'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Site do casamento rodando em http://localhost:${port}`);
    console.log(`Painel do casal: http://localhost:${port}/painel  (banco: ${DB_FILE})`);
    if (countUsers() === 0) {
      console.log('\nNenhuma conta criada ainda. Crie as contas do casal com:');
      console.log('  npm run user:create -- "Lucas" lucas@exemplo.com "senha-forte"');
    }
  });
}
