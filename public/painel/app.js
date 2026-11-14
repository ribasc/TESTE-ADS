// Painel do casal — SPA simples sem build. Rotas por hash (#/tarefas etc.).

// ---------- utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
};
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = '/entrar?voltar=/painel/'; throw new Error('Sessão expirada.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo deu errado.');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- estado compartilhado ----------
const state = { me: null, meta: { users: [], periods: [], budgetCategories: [] }, settings: {} };
const assigneeOptions = () => [...state.meta.users.map((u) => u.name), 'Ambos'];

// ---------- modal de formulário ----------
/**
 * fields: [{ name, label, type: text|textarea|date|number|money|select|checkbox|section, options, full, placeholder }]
 */
function openForm({ title, fields, values = {}, onSave, onDelete }) {
  const dialog = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-error').textContent = '';
  const body = $('#modal-body');
  body.innerHTML = `<div class="form-grid">${fields.map((f) => renderField(f, values[f.name])).join('')}</div>`;
  const del = $('#modal-delete');
  del.hidden = !onDelete;
  del.onclick = async () => {
    if (!confirm('Tem certeza que quer excluir?')) return;
    try { await onDelete(); dialog.close(); } catch (e) { $('#modal-error').textContent = e.message; }
  };
  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== 'save') return; // cancelar fecha normalmente
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      if (f.type === 'section') continue;
      const el = form.elements[f.name];
      data[f.name] = f.type === 'checkbox' ? el.checked : el.value;
    }
    const missing = fields.find((f) => f.required && !String(data[f.name] ?? '').trim());
    if (missing) { $('#modal-error').textContent = `Preencha "${missing.label}".`; return; }
    const btn = $('#modal-save');
    btn.disabled = true;
    try { await onSave(data); dialog.close(); } catch (err) { $('#modal-error').textContent = err.message; } finally { btn.disabled = false; }
  };
  dialog.showModal();
  body.querySelector('input:not([type=checkbox]), textarea, select')?.focus();
}

function renderField(f, value) {
  const id = `f_${f.name}`;
  const cls = `field${f.full ? ' full' : ''}`;
  const v = value ?? f.default ?? '';
  switch (f.type) {
    case 'section':
      return `<h3 class="section-title">${esc(f.label)}</h3>`;
    case 'textarea':
      return `<div class="${cls} full"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea></div>`;
    case 'select': {
      const opts = (f.options || []).map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('');
      return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><select id="${id}" name="${f.name}">${f.blank !== false ? '<option value="">—</option>' : ''}${opts}</select></div>`;
    }
    case 'checkbox':
      return `<div class="${cls} check-field"><input class="check" type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}><label for="${id}">${esc(f.label)}</label></div>`;
    case 'money':
      return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" type="number" step="0.01" min="0" inputmode="decimal" value="${v === null ? '' : esc(v)}" placeholder="0,00"></div>`;
    case 'number':
      return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" type="number" min="0" step="1" value="${esc(v)}"></div>`;
    case 'datalist': {
      const listId = `${id}_list`;
      return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" list="${listId}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"><datalist id="${listId}">${(f.options || []).map((o) => `<option value="${esc(o)}">`).join('')}</datalist></div>`;
    }
    default:
      return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"></div>`;
  }
}

// ---------- rotas ----------
const routes = { inicio: viewHome, tarefas: viewTasks, orcamento: viewBudget, convidados: viewGuests, fornecedores: viewVendors, detalhes: viewDetails };

async function render() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio';
  const view = routes[name] || viewHome;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  const el = $('#view');
  try {
    await view(el);
  } catch (e) {
    el.innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p></div>`;
  }
}

function pageHead(title, subtitle, actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
}

// ---------- Início ----------
async function viewHome(el) {
  const d = await api('/dashboard');
  const days = daysUntil(d.settings.wedding_date);
  const names = d.settings.couple_names || 'Nosso casamento';
  const totalBudget = d.settings.total_budget || d.budget.estimated;
  const committed = d.budget.actual || 0;

  let countdown;
  if (days === null) countdown = `<a class="btn primary" href="#/detalhes">Definir a data</a>`;
  else if (days > 0) countdown = `<div><div class="count">${days}</div><div class="muted">${days === 1 ? 'dia' : 'dias'} para o grande dia</div></div>`;
  else if (days === 0) countdown = `<div class="count">É hoje! ♡</div>`;
  else countdown = `<div class="muted">Casados há ${-days} dias ♡</div>`;

  el.innerHTML = `
    <div class="card hero">
      <div>
        <p class="muted small" style="margin:0">Olá, ${esc(state.me.name)}</p>
        <h1>${esc(names)}</h1>
        <p class="muted" style="margin:.2rem 0 0">${d.settings.wedding_date ? fmtDate(d.settings.wedding_date) : 'Data ainda não definida'}</p>
      </div>
      ${countdown}
    </div>

    <div class="grid stats">
      <a class="card stat" href="#/tarefas" style="text-decoration:none;color:inherit">
        <div class="label">Tarefas</div>
        <div class="value">${d.tasks.done}/${d.tasks.total}</div>
        <div class="bar"><span style="width:${pct(d.tasks.done, d.tasks.total)}%"></span></div>
        <div class="hint">${pct(d.tasks.done, d.tasks.total)}% concluído</div>
      </a>
      <a class="card stat" href="#/orcamento" style="text-decoration:none;color:inherit">
        <div class="label">Orçamento</div>
        <div class="value">${brl(committed)}</div>
        <div class="bar ${totalBudget && committed > totalBudget ? 'over' : ''}"><span style="width:${pct(committed, totalBudget)}%"></span></div>
        <div class="hint">contratado de ${brl(totalBudget)} · pago ${brl(d.budget.paid)}</div>
      </a>
      <a class="card stat" href="#/convidados" style="text-decoration:none;color:inherit">
        <div class="label">Convidados</div>
        <div class="value">${d.guests.confirmed}<span class="muted" style="font-size:1.1rem"> / ${d.guests.people}</span></div>
        <div class="bar"><span style="width:${pct(d.guests.confirmed, d.guests.people)}%"></span></div>
        <div class="hint">confirmados · ${d.guests.pending} pendentes · ${d.guests.declined} não vão</div>
      </a>
      <a class="card stat" href="#/fornecedores" style="text-decoration:none;color:inherit">
        <div class="label">Fornecedores</div>
        <div class="value">${d.vendors.hired}<span class="muted" style="font-size:1.1rem"> contratados</span></div>
        <div class="hint">${d.vendors.total} no total</div>
      </a>
    </div>

    <div class="grid two">
      <section class="card">
        <h3>Próximas tarefas</h3>
        ${d.nextTasks.length ? `<ul class="list">${d.nextTasks.map((t) => `
          <li>
            <input type="checkbox" class="check" data-done="${t.id}" aria-label="Concluir">
            <div class="grow"><div class="title">${esc(t.title)}</div>
              <div class="small muted">${[t.period, t.assignee].filter(Boolean).map(esc).join(' · ')}</div></div>
            ${dueChip(t.due_date)}
          </li>`).join('')}</ul>`
          : `<p class="empty">Nada pendente. ${d.tasks.total ? 'Tudo em dia! 🎉' : '<a href="#/tarefas">Comece pelo checklist sugerido.</a>'}</p>`}
      </section>
      <section class="card">
        <h3>Próximos pagamentos</h3>
        ${d.upcomingPayments.length ? `<ul class="list">${d.upcomingPayments.map((p) => `
          <li><div class="grow"><div class="title">${esc(p.category)}</div>
            <div class="small muted">${esc(p.description || '')}</div></div>
            <div class="small" style="text-align:right">${brl((p.actual || 0) - (p.paid || 0))}<br>${dueChip(p.due_date)}</div></li>`).join('')}</ul>`
          : '<p class="empty">Nenhum pagamento com vencimento cadastrado.</p>'}
      </section>
    </div>`;

  el.querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('change', async () => {
    await api(`/tasks/${cb.dataset.done}`, { method: 'PATCH', body: { done: true } });
    toast('Tarefa concluída ✓');
    render();
  }));
}

function dueChip(date) {
  if (!date) return '';
  const n = daysUntil(date);
  const cls = n < 0 ? 'danger' : n <= 14 ? 'warn' : '';
  const label = n < 0 ? `atrasada · ${fmtDate(date)}` : n === 0 ? 'hoje' : fmtDate(date);
  return `<span class="chip ${cls}">${label}</span>`;
}

// ---------- Tarefas ----------
const taskFilter = { status: 'pendentes', assignee: '', q: '' };

async function viewTasks(el) {
  const tasks = await api('/tasks');
  const fields = () => [
    { name: 'title', label: 'Tarefa', required: true, full: true },
    { name: 'period', label: 'Quando', type: 'select', options: state.meta.periods },
    { name: 'due_date', label: 'Prazo', type: 'date' },
    { name: 'assignee', label: 'Responsável', type: 'select', options: assigneeOptions() },
    { name: 'category', label: 'Categoria', type: 'datalist', options: [...new Set(tasks.map((t) => t.category).filter(Boolean))] },
    { name: 'done', label: 'Concluída', type: 'checkbox' },
    { name: 'notes', label: 'Observações', type: 'textarea' },
  ];
  const edit = (t) => openForm({
    title: t ? 'Editar tarefa' : 'Nova tarefa',
    fields: fields(),
    values: t || {},
    onSave: async (data) => { await api(t ? `/tasks/${t.id}` : '/tasks', { method: t ? 'PATCH' : 'POST', body: data }); toast('Tarefa salva'); render(); },
    onDelete: t && (async () => { await api(`/tasks/${t.id}`, { method: 'DELETE' }); toast('Tarefa excluída'); render(); }),
  });

  const done = tasks.filter((t) => t.done).length;
  const q = taskFilter.q.toLowerCase();
  const visible = tasks.filter((t) =>
    (taskFilter.status === 'todas' || (taskFilter.status === 'pendentes' ? !t.done : t.done)) &&
    (!taskFilter.assignee || t.assignee === taskFilter.assignee) &&
    (!q || `${t.title} ${t.category} ${t.notes}`.toLowerCase().includes(q)));

  // agrupa pela ordem dos períodos
  const order = [...state.meta.periods, ''];
  const groups = new Map(order.map((p) => [p, []]));
  for (const t of visible) {
    const key = order.includes(t.period || '') ? (t.period || '') : '';
    groups.get(key).push(t);
  }

  el.innerHTML = `
    ${pageHead('Tarefas', `${done} de ${tasks.length} concluídas`, `
      ${tasks.length < 10 ? '<button class="btn" id="tpl">Carregar checklist sugerido</button>' : ''}
      <button class="btn primary" id="add">+ Nova tarefa</button>`)}
    <div class="toolbar">
      <input class="input" id="q" placeholder="Buscar tarefa…" value="${esc(taskFilter.q)}">
      <div class="seg" id="status">
        ${['pendentes', 'concluidas', 'todas'].map((s) => `<button data-s="${s}" class="${taskFilter.status === s ? 'on' : ''}">${{ pendentes: 'Pendentes', concluidas: 'Concluídas', todas: 'Todas' }[s]}</button>`).join('')}
      </div>
      <select class="input" id="who">
        <option value="">Todos</option>
        ${assigneeOptions().map((a) => `<option ${taskFilter.assignee === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
      </select>
    </div>
    ${tasks.length === 0 ? `<div class="card"><p class="empty">Ainda não tem nenhuma tarefa. Que tal começar com o <b>checklist sugerido</b>? São ${'~'}40 itens organizados de 12 meses antes até depois do casamento — vocês podem editar ou excluir o que não fizer sentido.</p></div>` : ''}
    ${[...groups].filter(([, list]) => list.length).map(([period, list]) => `
      <section class="card group">
        <h3>${esc(period || 'Sem período')} <span class="small muted">${list.filter((t) => t.done).length}/${list.length}</span></h3>
        <ul class="list">${list.map((t) => `
          <li class="${t.done ? 'done' : ''}">
            <input type="checkbox" class="check" data-toggle="${t.id}" ${t.done ? 'checked' : ''} aria-label="Concluída">
            <div class="grow" data-edit="${t.id}" style="cursor:pointer">
              <div class="title">${esc(t.title)}</div>
              <div class="small muted">${[t.category, t.assignee].filter(Boolean).map(esc).join(' · ')}</div>
            </div>
            ${t.done ? '' : dueChip(t.due_date)}
          </li>`).join('')}</ul>
      </section>`).join('')}
    ${tasks.length && !visible.length ? '<p class="empty">Nenhuma tarefa com esses filtros.</p>' : ''}`;

  $('#add', el).onclick = () => edit();
  $('#tpl', el)?.addEventListener('click', async () => {
    const r = await api('/tasks/template', { method: 'POST' });
    toast(`${r.added} tarefas adicionadas`);
    render();
  });
  const qInput = $('#q', el);
  qInput.oninput = () => { taskFilter.q = qInput.value; viewTasks(el).then(() => { const i = $('#q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); };
  el.querySelectorAll('#status button').forEach((b) => b.onclick = () => { taskFilter.status = b.dataset.s; render(); });
  $('#who', el).onchange = (e) => { taskFilter.assignee = e.target.value; render(); };
  el.querySelectorAll('[data-toggle]').forEach((cb) => cb.addEventListener('change', async () => {
    await api(`/tasks/${cb.dataset.toggle}`, { method: 'PATCH', body: { done: cb.checked } });
    render();
  }));
  el.querySelectorAll('[data-edit]').forEach((d) => d.onclick = () => edit(tasks.find((t) => t.id === Number(d.dataset.edit))));
}

// ---------- Orçamento ----------
async function viewBudget(el) {
  const [items, vendors] = await Promise.all([api('/budget'), api('/vendors')]);
  const total = Number(state.settings.total_budget) || 0;
  const sum = (k) => items.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  const est = sum('estimated'), act = sum('actual'), paid = sum('paid');
  const base = total || est;

  const edit = (it) => openForm({
    title: it ? 'Editar item' : 'Novo item do orçamento',
    fields: [
      { name: 'category', label: 'Categoria', type: 'datalist', options: state.meta.budgetCategories, required: true },
      { name: 'description', label: 'Descrição' },
      { name: 'estimated', label: 'Previsto (R$)', type: 'money' },
      { name: 'actual', label: 'Contratado (R$)', type: 'money' },
      { name: 'paid', label: 'Já pago (R$)', type: 'money' },
      { name: 'due_date', label: 'Próximo vencimento', type: 'date' },
      { name: 'vendor_id', label: 'Fornecedor', type: 'select', options: vendors.map((v) => [v.id, `${v.name}${v.category ? ` (${v.category})` : ''}`]) },
      { name: 'notes', label: 'Observações', type: 'textarea', placeholder: 'Ex.: 30% na assinatura, resto em 5x' },
    ],
    values: it || {},
    onSave: async (data) => { await api(it ? `/budget/${it.id}` : '/budget', { method: it ? 'PATCH' : 'POST', body: data }); toast('Orçamento atualizado'); render(); },
    onDelete: it && (async () => { await api(`/budget/${it.id}`, { method: 'DELETE' }); toast('Item excluído'); render(); }),
  });

  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || '';
  const status = (i) => {
    const owed = (i.actual || 0) - (i.paid || 0);
    if (!i.actual && !i.estimated) return '<span class="chip">a definir</span>';
    if (i.actual && owed <= 0) return '<span class="chip ok">quitado</span>';
    if (i.actual) return `<span class="chip warn">falta ${brl(owed)}</span>`;
    return '<span class="chip">só previsto</span>';
  };

  el.innerHTML = `
    ${pageHead('Orçamento', 'Previsto, contratado e pago em cada categoria.', `
      ${items.length < 5 ? '<button class="btn" id="tpl">Carregar categorias sugeridas</button>' : ''}
      <button class="btn primary" id="add">+ Novo item</button>`)}
    <div class="grid stats">
      <div class="card stat"><div class="label">Teto do orçamento</div><div class="value">${total ? brl(total) : '—'}</div>
        <div class="hint">${total ? `<a href="#/detalhes">alterar</a>` : '<a href="#/detalhes">definir em Detalhes</a>'}</div></div>
      <div class="card stat"><div class="label">Previsto</div><div class="value">${brl(est)}</div>
        <div class="hint">${total ? (est > total ? `<span style="color:var(--danger)">${brl(est - total)} acima do teto</span>` : `${brl(total - est)} de folga`) : 'soma das estimativas'}</div></div>
      <div class="card stat"><div class="label">Contratado</div><div class="value">${brl(act)}</div>
        <div class="bar ${base && act > base ? 'over' : ''}"><span style="width:${pct(act, base)}%"></span></div></div>
      <div class="card stat"><div class="label">Pago</div><div class="value">${brl(paid)}</div>
        <div class="bar"><span style="width:${pct(paid, act)}%"></span></div><div class="hint">falta pagar ${brl(Math.max(0, act - paid))}</div></div>
    </div>
    <div class="card table-wrap">
      ${items.length ? `<table class="table">
        <thead><tr><th>Categoria</th><th class="hide-sm">Fornecedor</th><th class="num">Previsto</th><th class="num">Contratado</th><th class="num hide-sm">Pago</th><th class="hide-sm">Situação</th><th class="hide-sm">Vence</th></tr></thead>
        <tbody>${items.map((i) => `<tr data-id="${i.id}">
          <td><div>${esc(i.category)}</div>${i.description ? `<div class="small muted">${esc(i.description)}</div>` : ''}</td>
          <td class="hide-sm">${esc(vendorName(i.vendor_id))}</td>
          <td class="num">${i.estimated ? brl(i.estimated) : '—'}</td>
          <td class="num">${i.actual ? brl(i.actual) : '—'}</td>
          <td class="num hide-sm">${i.paid ? brl(i.paid) : '—'}</td>
          <td class="hide-sm">${status(i)}</td>
          <td class="hide-sm">${(i.actual || i.estimated) > (i.paid || 0) ? dueChip(i.due_date) : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="hide-sm"></td><td class="num">${brl(est)}</td><td class="num">${brl(act)}</td><td class="num hide-sm">${brl(paid)}</td><td class="hide-sm" colspan="2"></td></tr></tfoot>
      </table>` : '<p class="empty" style="padding:.6rem">Nenhum item ainda. Carreguem as categorias sugeridas para começar.</p>'}
    </div>`;

  $('#add', el).onclick = () => edit();
  $('#tpl', el)?.addEventListener('click', async () => {
    const r = await api('/budget/template', { method: 'POST' });
    toast(`${r.added} categorias adicionadas`);
    render();
  });
  el.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => edit(items.find((i) => i.id === Number(tr.dataset.id))));
}

// ---------- Convidados ----------
const guestFilter = { q: '', side: '', rsvp: '' };
const RSVP = [['pendente', 'Pendente'], ['confirmado', 'Confirmado'], ['recusado', 'Não vai']];
const rsvpChip = (r) => ({ confirmado: '<span class="chip ok">confirmado</span>', recusado: '<span class="chip danger">não vai</span>' }[r] || '<span class="chip warn">pendente</span>');

async function viewGuests(el) {
  const guests = await api('/guests');
  const sides = () => [...state.meta.users.map((u) => `Lado ${u.name.split(' ')[0]}`), 'Dos dois'];
  const edit = (g) => openForm({
    title: g ? 'Editar convidado' : 'Novo convite',
    fields: [
      { name: 'name', label: 'Nome (ou família)', required: true, full: true, placeholder: 'Ex.: Família Souza, Tia Maria' },
      { name: 'side', label: 'Lado', type: 'select', options: sides() },
      { name: 'group_name', label: 'Grupo', type: 'datalist', options: [...new Set(['Família', 'Amigos', 'Trabalho', 'Padrinhos', ...guests.map((x) => x.group_name).filter(Boolean)])] },
      { name: 'adults', label: 'Adultos no convite', type: 'number', default: 1 },
      { name: 'children', label: 'Crianças', type: 'number', default: 0 },
      { name: 'phone', label: 'WhatsApp', type: 'tel', placeholder: '(11) 99999-9999' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'rsvp', label: 'Presença', type: 'select', options: RSVP, blank: false, default: 'pendente' },
      { name: 'table_name', label: 'Mesa' },
      { name: 'invite_sent', label: 'Convite já enviado', type: 'checkbox' },
      { name: 'dietary', label: 'Restrições alimentares', full: true, placeholder: 'Ex.: vegetariano, sem glúten' },
      { name: 'notes', label: 'Observações', type: 'textarea' },
    ],
    values: g || {},
    onSave: async (data) => { await api(g ? `/guests/${g.id}` : '/guests', { method: g ? 'PATCH' : 'POST', body: data }); toast('Convidado salvo'); render(); },
    onDelete: g && (async () => { await api(`/guests/${g.id}`, { method: 'DELETE' }); toast('Convidado excluído'); render(); }),
  });

  const people = (list) => list.reduce((s, g) => s + g.adults + g.children, 0);
  const by = (r) => people(guests.filter((g) => g.rsvp === r));
  const q = guestFilter.q.toLowerCase();
  const visible = guests.filter((g) =>
    (!guestFilter.side || g.side === guestFilter.side) &&
    (!guestFilter.rsvp || g.rsvp === guestFilter.rsvp) &&
    (!q || `${g.name} ${g.group_name} ${g.phone} ${g.table_name}`.toLowerCase().includes(q)));

  el.innerHTML = `
    ${pageHead('Convidados', `${guests.length} convites · ${people(guests)} pessoas`, `
      ${guests.length ? '<button class="btn" id="csv">Exportar planilha</button>' : ''}
      <button class="btn primary" id="add">+ Novo convite</button>`)}
    <div class="grid stats">
      <div class="card stat"><div class="label">Confirmados</div><div class="value" style="color:var(--ok)">${by('confirmado')}</div></div>
      <div class="card stat"><div class="label">Pendentes</div><div class="value" style="color:var(--warn)">${by('pendente')}</div></div>
      <div class="card stat"><div class="label">Não vão</div><div class="value" style="color:var(--danger)">${by('recusado')}</div></div>
      <div class="card stat"><div class="label">Convites enviados</div><div class="value">${guests.filter((g) => g.invite_sent).length}<span class="muted" style="font-size:1.1rem"> / ${guests.length}</span></div></div>
    </div>
    <div class="toolbar">
      <input class="input" id="q" placeholder="Buscar por nome, grupo, mesa…" value="${esc(guestFilter.q)}">
      <select class="input" id="side"><option value="">Todos os lados</option>${sides().map((s) => `<option ${guestFilter.side === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select class="input" id="rsvp"><option value="">Toda presença</option>${RSVP.map(([v, l]) => `<option value="${v}" ${guestFilter.rsvp === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="card table-wrap">
      ${guests.length ? `<table class="table">
        <thead><tr><th>Nome</th><th class="num">Pessoas</th><th class="hide-sm">Lado / grupo</th><th>Presença</th><th class="hide-sm">Convite</th><th class="hide-sm">Código</th></tr></thead>
        <tbody>${visible.map((g) => `<tr data-id="${g.id}">
          <td><div>${esc(g.name)}</div>${g.dietary ? `<div class="small muted">🍽 ${esc(g.dietary)}</div>` : ''}</td>
          <td class="num">${g.adults + g.children}${g.children ? `<div class="small muted">${g.children} criança${g.children > 1 ? 's' : ''}</div>` : ''}</td>
          <td class="hide-sm"><div>${esc(g.side || '')}</div><div class="small muted">${esc(g.group_name || '')}</div></td>
          <td>${rsvpChip(g.rsvp)}</td>
          <td class="hide-sm">${g.invite_sent ? '<span class="chip accent">enviado</span>' : '<span class="chip">não enviado</span>'}</td>
          <td class="hide-sm"><span class="code">${esc(g.invite_code || '')}</span></td></tr>`).join('')}</tbody>
      </table>${!visible.length ? '<p class="empty" style="padding:.6rem">Ninguém com esses filtros.</p>' : ''}`
      : '<p class="empty" style="padding:.6rem">Nenhum convidado ainda. Cada linha é um <b>convite</b> (uma pessoa, um casal ou uma família) — depois cada convite vai ganhar um link próprio para confirmar presença.</p>'}
    </div>`;

  $('#add', el).onclick = () => edit();
  const qInput = $('#q', el);
  qInput.oninput = () => { guestFilter.q = qInput.value; viewGuests(el).then(() => { const i = $('#q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); };
  $('#side', el).onchange = (e) => { guestFilter.side = e.target.value; render(); };
  $('#rsvp', el).onchange = (e) => { guestFilter.rsvp = e.target.value; render(); };
  el.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => edit(guests.find((g) => g.id === Number(tr.dataset.id))));
  $('#csv', el)?.addEventListener('click', () => exportCsv(guests));
}

function exportCsv(guests) {
  const cols = [['name', 'Nome'], ['side', 'Lado'], ['group_name', 'Grupo'], ['adults', 'Adultos'], ['children', 'Crianças'],
    ['phone', 'WhatsApp'], ['email', 'E-mail'], ['rsvp', 'Presença'], ['invite_sent', 'Convite enviado'], ['table_name', 'Mesa'],
    ['dietary', 'Restrições'], ['invite_code', 'Código'], ['notes', 'Observações']];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(([, l]) => cell(l)).join(';'),
    ...guests.map((g) => cols.map(([k]) => cell(k === 'invite_sent' ? (g[k] ? 'sim' : 'não') : g[k])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `convidados-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Fornecedores ----------
const VENDOR_STATUS = [['pesquisando', 'Pesquisando'], ['orcamento', 'Orçamento pedido'], ['negociando', 'Negociando'], ['contratado', 'Contratado'], ['descartado', 'Descartado']];
const vendorChip = (s) => {
  const label = Object.fromEntries(VENDOR_STATUS)[s] || s || 'Pesquisando';
  const cls = { contratado: 'ok', descartado: 'danger', negociando: 'warn', orcamento: 'accent' }[s] || '';
  return `<span class="chip ${cls}">${esc(label)}</span>`;
};

async function viewVendors(el) {
  const vendors = await api('/vendors');
  const edit = (v) => openForm({
    title: v ? 'Editar fornecedor' : 'Novo fornecedor',
    fields: [
      { name: 'name', label: 'Nome', required: true },
      { name: 'category', label: 'Categoria', type: 'datalist', options: state.meta.budgetCategories },
      { name: 'status', label: 'Situação', type: 'select', options: VENDOR_STATUS, blank: false, default: 'pesquisando' },
      { name: 'price', label: 'Valor (R$)', type: 'money' },
      { name: 'contact_name', label: 'Contato' },
      { name: 'phone', label: 'WhatsApp / telefone', type: 'tel' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'instagram', label: 'Instagram / site', placeholder: '@perfil ou https://…' },
      { name: 'notes', label: 'Observações', type: 'textarea', placeholder: 'O que está incluso, condições de pagamento, impressões da visita…' },
    ],
    values: v || {},
    onSave: async (data) => { await api(v ? `/vendors/${v.id}` : '/vendors', { method: v ? 'PATCH' : 'POST', body: data }); toast('Fornecedor salvo'); render(); },
    onDelete: v && (async () => { await api(`/vendors/${v.id}`, { method: 'DELETE' }); toast('Fornecedor excluído'); render(); }),
  });

  const wa = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length <= 11 ? '55' + d : d}` : ''; };
  const ig = (s) => { if (!s) return ''; if (/^https?:\/\//.test(s)) return s; return `https://instagram.com/${s.replace(/^@/, '')}`; };

  const groups = new Map();
  for (const v of vendors) {
    const k = v.category || 'Outros';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }

  el.innerHTML = `
    ${pageHead('Fornecedores', `${vendors.filter((v) => v.status === 'contratado').length} contratados de ${vendors.length} cadastrados`, '<button class="btn primary" id="add">+ Novo fornecedor</button>')}
    ${vendors.length ? [...groups].map(([cat, list]) => `
      <section class="group">
        <h3 style="margin-bottom:.6rem">${esc(cat)}</h3>
        <div class="grid vendor-grid">${list.map((v) => `
          <article class="card vendor" data-id="${v.id}">
            <div class="row"><strong>${esc(v.name)}</strong>${vendorChip(v.status)}</div>
            ${v.price ? `<div>${brl(v.price)}</div>` : ''}
            ${v.contact_name ? `<div class="small muted">${esc(v.contact_name)}</div>` : ''}
            ${v.notes ? `<div class="small muted" style="white-space:pre-line;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">${esc(v.notes)}</div>` : ''}
            <div class="links">
              ${v.phone ? `<a href="${esc(wa(v.phone))}" target="_blank" rel="noopener" data-stop>WhatsApp</a>` : ''}
              ${v.email ? `<a href="mailto:${esc(v.email)}" data-stop>E-mail</a>` : ''}
              ${v.instagram ? `<a href="${esc(ig(v.instagram))}" target="_blank" rel="noopener" data-stop>Instagram/site</a>` : ''}
            </div>
          </article>`).join('')}</div>
      </section>`).join('')
    : '<div class="card"><p class="empty">Nenhum fornecedor ainda. Cadastrem aqui todo mundo que estão pesquisando — buffet, fotógrafo, decoração… — e marquem a situação de cada um.</p></div>'}`;

  $('#add', el).onclick = () => edit();
  el.querySelectorAll('[data-stop]').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  el.querySelectorAll('.vendor').forEach((c) => c.onclick = () => edit(vendors.find((v) => v.id === Number(c.dataset.id))));
}

// ---------- Detalhes do casamento ----------
async function viewDetails(el) {
  const s = await api('/settings');
  state.settings = s;
  const fields = [
    { type: 'section', label: 'O casal e a data' },
    { name: 'couple_names', label: 'Nomes do casal', placeholder: 'Lucas & Karen', full: true },
    { name: 'wedding_date', label: 'Data do casamento', type: 'date' },
    { name: 'total_budget', label: 'Teto do orçamento (R$)', type: 'money' },
    { type: 'section', label: 'Cerimônia' },
    { name: 'ceremony_venue', label: 'Local' },
    { name: 'ceremony_time', label: 'Horário', type: 'time' },
    { name: 'ceremony_address', label: 'Endereço', full: true },
    { type: 'section', label: 'Festa' },
    { name: 'reception_venue', label: 'Local (se for diferente)' },
    { name: 'reception_time', label: 'Horário', type: 'time' },
    { name: 'reception_address', label: 'Endereço', full: true },
    { type: 'section', label: 'Para o convite' },
    { name: 'dress_code', label: 'Traje / o que vestir', type: 'textarea', placeholder: 'Ex.: Esporte fino. Evitem branco 😉' },
    { name: 'menu', label: 'Cardápio', type: 'textarea', placeholder: 'Entrada…\nPrato principal…\nSobremesa…' },
    { name: 'guest_message', label: 'Mensagem para os convidados', type: 'textarea' },
    { type: 'section', label: 'Presentes (Pix)' },
    { name: 'pix_key', label: 'Chave Pix' },
    { name: 'pix_name', label: 'Nome do recebedor' },
    { type: 'section', label: 'Anotações do casal' },
    { name: 'notes', label: 'Anotações livres', type: 'textarea', placeholder: 'Ideias, referências, links do Pinterest…' },
  ];
  el.innerHTML = `
    ${pageHead('Detalhes do casamento', 'Essas informações vão alimentar a página dos convidados quando ela ficar pronta.')}
    <form class="card" id="details">
      <div class="form-grid">${fields.map((f) => renderField(f, s[f.name])).join('')}</div>
      <div class="error" id="details-error"></div>
      <div class="actions" style="justify-content:flex-end;margin-top:.6rem">
        <button class="btn primary" type="submit">Salvar detalhes</button>
      </div>
    </form>
    <p class="actions" style="margin-top:1rem"><button class="btn small mobile-logout" id="logout2">Sair da conta</button></p>`;

  const form = $('#details', el);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) if (f.name) data[f.name] = form.elements[f.name].value;
    try {
      await api('/settings', { method: 'PUT', body: data });
      state.settings = { ...state.settings, ...data };
      updateBrand();
      toast('Detalhes salvos ♡');
    } catch (err) { $('#details-error').textContent = err.message; }
  };
  $('#logout2', el).onclick = doLogout;
}

// ---------- inicialização ----------
function updateBrand() {
  $('#brand-names').textContent = state.settings.couple_names || 'Nosso casamento';
  document.title = `Painel · ${state.settings.couple_names || 'Nosso casamento'}`;
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/entrar';
}

async function init() {
  const [{ user }, meta, settings] = await Promise.all([api('/me'), api('/meta'), api('/settings')]);
  state.me = user; state.meta = meta; state.settings = settings;
  $('#who').textContent = user.name;
  $('#logout').onclick = doLogout;
  updateBrand();
  window.addEventListener('hashchange', render);
  render();
}

init();
