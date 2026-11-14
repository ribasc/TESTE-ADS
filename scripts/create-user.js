// Cria (ou atualiza a senha de) uma conta do casal.
// Uso: npm run user:create -- "Nome" email@exemplo.com "senha"
import { createUser } from '../server/auth.js';

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.error('Uso: npm run user:create -- "Nome" email@exemplo.com "senha"');
  process.exit(1);
}
try {
  const r = createUser({ name, email, password });
  console.log(r.updated ? `Conta de ${name} atualizada.` : `Conta de ${name} criada.`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
