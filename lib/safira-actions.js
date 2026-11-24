// Ações da Safira. Regra de ouro: ela NUNCA executa direto.
// 1) A IA escolhe a ação e os dados; 2) o servidor confere tudo no banco e monta um resumo EXATO;
// 3) só depois do "sim" do dono (rota /assistant/confirm) a ação roda, com o mesmo código das telas.
const crypto = require('crypto');
const { db, audit } = require('./db');
const { todayBR, fmtDate, brl, phone55, round2 } = require('./util');
const M = require('./metrics');
const wa = require('./wuzapi');
const R = require('./reports');
const ACT = require('./actions');
const FZ = require('./fuzzy');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim();
const fd = d => d ? fmtDate(String(d).slice(0, 10)) : 'sem data';
const plain = t => String(t || '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const sysRow = id => db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
const sysMatch = (c, nome) => { if (!nome) return true; const q = norm(nome).replace(/ /g, ''), n = norm(c.system_name).replace(/ /g, ''); return n.includes(q) || q.includes(n) || norm(c.system_kind) === q || FZ.score(nome, c.system_name) >= 0.75; };

function findSystem(nome) {
  const all = db.prepare('SELECT * FROM systems').all(); const q = norm(nome);
  if (!q) return all.length === 1 ? { sys: all[0] } : { erro: 'Pergunte em qual sistema (' + all.map(s => s.name).join(', ') + ').' };
  const hit = all.filter(s => norm(s.name) === q || norm(s.kind) === q); const loose = hit.length ? hit : all.filter(s => norm(s.name).includes(q) || q.includes(norm(s.name)));
  if (loose.length === 1) return { sys: loose[0] };
  if (!loose.length) { const p = FZ.pick(nome, all, s => s.name); if (p.one) return { sys: p.one }; }
  if (!loose.length) return { erro: `Não existe sistema chamado "${nome}". Sistemas conectados: ${all.map(s => s.name).join(', ') || 'nenhum'}.` };
  return { erro: 'Mais de um sistema combina. Pergunte qual.', opcoes: loose.map(s => s.name) };
}

function findClient(nome, sistema) {
  const q = norm(nome); if (!q) return { erro: 'Pergunte o nome do cliente.' };
  const all = M.allClients().filter(c => sysMatch(c, sistema));
  if (!all.length) return { erro: sistema ? `Não há clientes no sistema "${sistema}".` : 'Ainda não há clientes nos sistemas conectados.' };
  let hits = all.filter(c => [c.name, c.email].some(v => v && norm(v) === q));
  if (!hits.length) hits = all.filter(c => norm(c.name).includes(q) || (c.email && norm(c.email).startsWith(q)));
  if (!hits.length) { const words = q.split(' ').filter(w => w.length > 2); if (words.length) hits = all.filter(c => words.every(w => norm(c.name).includes(w))); }
  if (!hits.length) { // a voz pode ter entendido errado ("assaí do lipe" = "ACAI do Lipe"): pega o mais parecido pelo som
    const p = FZ.pick(nome, all, c => c.name);
    if (p.one) hits = [p.one];
    else if (p.many) return { erro: `Não achei "${nome}" exatamente. Pergunte ao usuário se ele quis dizer um destes (fale o nome como está aqui):`, opcoes: p.many.map(c => ({ nome: c.name, sistema: c.system_name, vencimento: fd(c.expires_at) })) };
  }
  if (!hits.length) {
    const words = q.split(' ').filter(w => w.length > 2);
    const sug = all.map(c => ({ c, s: words.filter(w => norm(c.name).includes(w)).length })).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, 4).map(x => `${x.c.name} (${x.c.system_name})`);
    return { erro: `Não encontrei nenhum cliente "${nome}"${sistema ? ' no ' + sistema : ''}. Não invente: diga isso ao usuário${sug.length ? ' e pergunte se é um destes' : ''}.`, parecidos: sug };
  }
  if (hits.length > 1) return { erro: 'Há mais de um cliente com esse nome. Pergunte ao usuário qual deles.', opcoes: hits.slice(0, 8).map(c => ({ nome: c.name, sistema: c.system_name, vencimento: fd(c.expires_at) })) };
  return { c: hits[0], sys: sysRow(hits[0].system_id) };
}
const fresh = c => db.prepare('SELECT * FROM clients WHERE system_id = ? AND ext_id = ?').get(c.system_id, c.ext_id);
function parseDate(v) {
  const s = String(v || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const money = v => { if (v === undefined || v === null || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isFinite(n) ? round2(Math.abs(n)) : null; };
const waIssue = c => !wa.ready() ? 'o WhatsApp da central não está configurado' : !phone55(c.phone) ? `${c.name} não tem WhatsApp cadastrado` : null;
const S = (type, props, req) => ({ type: 'object', properties: props, required: req || [] });
const CLIENTE = { type: 'string', description: 'Nome (ou e-mail) do cliente, como o usuário falou.' }, SISTEMA = { type: 'string', description: 'Nome do sistema, se o usuário disse (EstimaFood, BarberSync, MotoStock...).' };

const ACTIONS = {
  renovar_cliente: {
    label: 'renovar', def: { description: 'Renovar a mensalidade de um cliente (estende o vencimento), lançar o pagamento no financeiro e avisar o cliente. Use quando pedirem para renovar, dar baixa ou registrar pagamento.',
      input_schema: S('object', { cliente: CLIENTE, sistema: SISTEMA, meses: { type: 'integer', description: 'Quantos meses (padrão 1).' }, dias: { type: 'integer', description: 'Em vez de meses, quantos dias.' }, ate_data: { type: 'string', description: 'Em vez de meses, até que data (dd/mm/aaaa).' },
        valor_recebido: { type: 'number', description: 'Valor pago. Se não disserem, use a mensalidade do cliente (não pergunte).' }, lancar_no_financeiro: { type: 'boolean', description: 'Padrão true.' }, avisar_cliente: { type: 'boolean', description: 'Avisar no WhatsApp. Padrão true.' } }, ['cliente']) },
    prepare(a) {
      const f = findClient(a.cliente, a.sistema); if (!f.c) return f; const { c, sys } = f;
      const date = a.ate_data ? parseDate(a.ate_data) : null; if (a.ate_data && !date) return { erro: 'Data inválida. Peça no formato dia/mês/ano.' };
      if (date && date <= todayBR()) return { erro: 'A data para renovar precisa ser depois de hoje.' };
      const months = !date && !a.dias ? Math.max(1, Math.min(36, Number(a.meses) || 1)) : undefined, days = !date && a.dias ? Math.max(1, Math.min(3650, Number(a.dias))) : undefined;
      const next = ACT.nextExpiry(c.expires_at, { months, days, date });
      const amount = money(a.valor_recebido) ?? (c.price || 0), record = a.lancar_no_financeiro !== false && amount > 0;
      const issue = waIssue(c), notify = a.avisar_cliente !== false && !issue;
      const per = date ? `até ${fd(date)}` : days ? `por ${days} dia${days > 1 ? 's' : ''}` : `por ${months} ${months > 1 ? 'meses' : 'mês'}`;
      const summary = `Vou renovar ${c.name}, do ${sys.name}, ${per}: o vencimento passa de ${fd(c.expires_at)} para ${fd(next)}.` + (record ? ` Lanço ${brl(amount)} no financeiro.` : ' Não lanço nada no financeiro.') + (notify ? ' E aviso o cliente no WhatsApp.' : a.avisar_cliente !== false && issue ? ` Não vou avisar no WhatsApp porque ${issue}.` : '');
      return { summary, run: async actor => {
        const cc = fresh(c); if (!cc) throw new Error('o cliente não existe mais');
        const r = await ACT.renew(sys, cc, { months, days, date, amount, record, notify }, actor); await ACT.after(sys);
        let txt = `Pronto. Renovei ${cc.name} até ${fd(r.expires_at)}.`; if (r.ledger_id) txt += ` Lancei ${brl(amount)} no financeiro.`;
        if (notify) txt += r.whatsapp && r.whatsapp.ok ? ' O cliente foi avisado no WhatsApp.' : ` Mas não consegui avisar no WhatsApp${r.whatsapp && r.whatsapp.error ? ': ' + r.whatsapp.error : ''}.`;
        return { reply: txt };
      } };
    }
  },
  suspender_cliente: {
    label: 'suspender', def: { description: 'Suspender (bloquear) o acesso de um cliente ao sistema.', input_schema: S('object', { cliente: CLIENTE, sistema: SISTEMA }, ['cliente']) },
    prepare(a) {
      const f = findClient(a.cliente, a.sistema); if (!f.c) return f; const { c, sys } = f;
      if (!c.active) return { erro: `${c.name} já está suspenso. Diga isso ao usuário.` };
      return { summary: `Vou suspender o acesso de ${c.name}, do ${sys.name}. Ele não vai conseguir entrar até ser reativado.`, run: async actor => { const cc = fresh(c); await ACT.setStatus(sys, cc, false, actor); await ACT.after(sys); return { reply: `Pronto. ${cc.name} está suspenso.` }; } };
    }
  },
  reativar_cliente: {
    label: 'reativar', def: { description: 'Reativar (desbloquear) o acesso de um cliente suspenso.', input_schema: S('object', { cliente: CLIENTE, sistema: SISTEMA }, ['cliente']) },
    prepare(a) {
      const f = findClient(a.cliente, a.sistema); if (!f.c) return f; const { c, sys } = f;
      if (c.active) return { erro: `${c.name} já está ativo. Diga isso ao usuário.` };
      return { summary: `Vou reativar o acesso de ${c.name}, do ${sys.name}.` + (c.days_left !== null && c.days_left < 0 ? ` Atenção: a mensalidade dele venceu em ${fd(c.expires_at)}.` : ''), run: async actor => { const cc = fresh(c); await ACT.setStatus(sys, cc, true, actor); await ACT.after(sys); return { reply: `Pronto. ${cc.name} está ativo de novo.` }; } };
    }
  },
  enviar_cobranca: {
    label: 'cobrança', def: { description: 'Mandar a mensagem de cobrança pronta (com valor e vencimento reais) para UM cliente no WhatsApp.', input_schema: S('object', { cliente: CLIENTE, sistema: SISTEMA }, ['cliente']) },
    prepare(a) {
      const f = findClient(a.cliente, a.sistema); if (!f.c) return f; const { c, sys } = f;
      const issue = waIssue(c); if (issue) return { erro: `Não dá para enviar: ${issue}. Diga isso ao usuário.` };
      const text = ACT.renderFor(sys, c, ACT.billingText(c));
      const when = c.days_left === null ? 'sem vencimento cadastrado' : c.days_left < 0 ? `que venceu em ${fd(c.expires_at)}` : c.days_left === 0 ? 'que vence hoje' : `que vence em ${fd(c.expires_at)}`;
      return { summary: `Vou mandar no WhatsApp de ${c.name}, do ${sys.name}, a cobrança da mensalidade de ${brl(c.price)}, ${when}.`, detail: text,
        run: async actor => { await ACT.message(sys, fresh(c), ACT.billingText(c), actor, 'cobranca'); return { reply: `Pronto. A cobrança foi enviada para ${c.name}.` }; } };
    }
  },
  cobrar_em_lote: {
    label: 'cobrança em lote', def: { description: 'Mandar cobrança no WhatsApp para VÁRIOS clientes de uma vez: os vencidos, os que vencem hoje ou os que vencem nos próximos 7 dias. Pode filtrar por sistema.',
      input_schema: S('object', { grupo: { type: 'string', enum: ['vencidos', 'vence_hoje', 'vencendo'] }, sistema: SISTEMA }, ['grupo']) },
    prepare(a) {
      if (!wa.ready()) return { erro: 'O WhatsApp da central não está configurado. Diga isso ao usuário.' };
      let list = M.allClients().filter(c => sysMatch(c, a.sistema) && c.active);
      list = a.grupo === 'vencidos' ? list.filter(c => c.state === 'vencido') : a.grupo === 'vence_hoje' ? list.filter(c => c.days_left === 0) : list.filter(c => c.state === 'vencendo');
      const ok = list.filter(c => phone55(c.phone)), sem = list.length - ok.length;
      const lbl = { vencidos: 'com mensalidade vencida', vence_hoje: 'que vencem hoje', vencendo: 'que vencem nos próximos 7 dias' }[a.grupo] || '';
      if (!ok.length) return { erro: list.length ? `Há ${list.length} cliente(s) ${lbl}, mas nenhum tem WhatsApp cadastrado.` : `Não há nenhum cliente ${lbl}${a.sistema ? ' no ' + a.sistema : ''}. Diga isso ao usuário.` };
      const names = ok.slice(0, 4).map(c => c.name).join(', ') + (ok.length > 4 ? ` e mais ${ok.length - 4}` : '');
      const total = round2(ok.reduce((s, c) => s + (c.price || 0), 0));
      return { summary: `Vou mandar cobrança no WhatsApp para ${ok.length} cliente${ok.length > 1 ? 's' : ''} ${lbl}${a.sistema ? ' do ' + a.sistema : ''}: ${names}. Somam ${brl(total)}.` + (sem ? ` ${sem} sem WhatsApp ficam de fora.` : ''),
        detail: ok.map(c => `${c.name} (${c.system_name}) • ${brl(c.price)} • ${fd(c.expires_at)}`).join('\n'),
        run: async actor => { const job = ACT.sendBatch(ok, c => ACT.billingText(c), 'cobranca', actor, lbl); const min = Math.max(1, Math.ceil(job.total * 4 / 60)); return { reply: `Pronto. Comecei a mandar as ${job.total} cobranças, uma de cada vez. Leva uns ${min} minuto${min > 1 ? 's' : ''}.` }; } };
    }
  },
  enviar_mensagem: {
    label: 'mensagem', def: { description: 'Mandar uma mensagem de WhatsApp com texto livre para um cliente. Pode usar {nome}, {sistema}, {valor}, {vencimento}, {dias}.', input_schema: S('object', { cliente: CLIENTE, sistema: SISTEMA, texto: { type: 'string', description: 'O texto da mensagem, como o usuário pediu.' } }, ['cliente', 'texto']) },
    prepare(a) {
      const f = findClient(a.cliente, a.sistema); if (!f.c) return f; const { c, sys } = f;
      const issue = waIssue(c); if (issue) return { erro: `Não dá para enviar: ${issue}.` };
      const t = String(a.texto || '').trim(); if (t.length < 2) return { erro: 'Pergunte o que escrever na mensagem.' };
      const text = ACT.renderFor(sys, c, t);
      return { summary: `Vou mandar para ${c.name}, no WhatsApp: ${plain(text)}`, detail: text, run: async actor => { await ACT.message(sys, fresh(c), t, actor); return { reply: `Pronto. Mensagem enviada para ${c.name}.` }; } };
    }
  },
  trocar_senha: {
    label: 'nova senha', def: { description: 'Gerar uma senha nova para o cliente entrar no sistema e (opcional) mandar no WhatsApp dele.', input_schema: S('object', { cliente: CLIENTE, sistema: SISTEMA, enviar_whatsapp: { type: 'boolean', description: 'Padrão true.' } }, ['cliente']) },
    prepare(a) {
      const f = findClient(a.cliente, a.sistema); if (!f.c) return f; const { c, sys } = f;
      const send = a.enviar_whatsapp !== false && !waIssue(c);
      return { summary: `Vou criar uma senha nova para ${c.name}, do ${sys.name}` + (send ? ' e mandar no WhatsApp dele.' : '. Ela vai aparecer aqui na tela.') + ' A senha antiga para de funcionar.',
        run: async actor => { const r = await ACT.resetPassword(sys, fresh(c), { send }, actor); return { reply: `Pronto. A senha de ${c.name} foi trocada${send ? (r.whatsapp && r.whatsapp.ok ? ' e enviada no WhatsApp' : ', mas não consegui mandar no WhatsApp') : ''}. A nova senha está na tela.`, detail: `Nova senha de ${c.name}: ${r.password}` }; } };
    }
  },
  criar_acesso: {
    label: 'criar acesso', def: { description: 'Criar um cliente novo (acesso) em um sistema. Precisa de sistema, nome e e-mail; o resto é opcional.',
      input_schema: S('object', { sistema: SISTEMA, nome: { type: 'string' }, email: { type: 'string' }, telefone: { type: 'string' }, plano: { type: 'string' }, valor: { type: 'number', description: 'Mensalidade.' }, vencimento: { type: 'string', description: 'dd/mm/aaaa' }, enviar_whatsapp: { type: 'boolean', description: 'Mandar o acesso no WhatsApp. Padrão true.' } }, ['sistema', 'nome', 'email']) },
    prepare(a) {
      const fs = findSystem(a.sistema); if (!fs.sys) return fs; const sys = fs.sys;
      const nome = String(a.nome || '').trim(), email = String(a.email || '').trim().toLowerCase().replace(/\s+/g, '');
      if (nome.length < 2) return { erro: 'Pergunte o nome do cliente.' }; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erro: 'Pergunte um e-mail válido (ele será o login).' };
      if (M.allClients().some(c => c.system_id === sys.id && norm(c.email) === norm(email))) return { erro: `Já existe um cliente com o e-mail ${email} no ${sys.name}.` };
      const exp = a.vencimento ? parseDate(a.vencimento) : null; if (a.vencimento && !exp) return { erro: 'Vencimento inválido. Peça no formato dia/mês/ano.' };
      const price = money(a.valor), phone = a.telefone ? String(a.telefone) : '', send = a.enviar_whatsapp !== false && !!phone55(phone) && wa.ready();
      return { summary: `Vou criar o acesso de ${nome} no ${sys.name}, com o login ${email}` + (price ? `, mensalidade de ${brl(price)}` : '') + (exp ? `, vencendo em ${fd(exp)}` : '') + '.' + (send ? ' E mando os dados de acesso no WhatsApp dele.' : ''),
        run: async actor => { const r = await ACT.createAccess(sys, { name: nome, email, phone: phone || undefined, plan: a.plano || undefined, price: price || undefined, expires_at: exp || undefined, send_whatsapp: send }, actor);
          return { reply: `Pronto. Criei o acesso de ${nome} no ${sys.name}` + (send ? (r.whatsapp && r.whatsapp.ok ? ' e mandei os dados no WhatsApp' : ', mas não consegui mandar no WhatsApp') : '') + '. A senha está na tela.', detail: `Link: ${r.login_url}\nE-mail: ${r.email || email}\nSenha: ${r.password}` }; } };
    }
  },
  lancar_financeiro: {
    label: 'lançamento', def: { description: 'Lançar uma receita ou despesa no financeiro da central.', input_schema: S('object', { tipo: { type: 'string', enum: ['receita', 'despesa'] }, valor: { type: 'number' }, descricao: { type: 'string' }, categoria: { type: 'string' }, data: { type: 'string', description: 'dd/mm/aaaa (padrão hoje)' } }, ['tipo', 'valor', 'descricao']) },
    prepare(a) {
      const v = money(a.valor); if (!v) return { erro: 'Pergunte o valor.' };
      const tipo = a.tipo === 'despesa' ? 'despesa' : 'receita', date = a.data ? parseDate(a.data) : todayBR(); if (!date) return { erro: 'Data inválida.' };
      const desc = String(a.descricao || '').trim().slice(0, 200) || (tipo === 'despesa' ? 'Despesa' : 'Receita'), cat = String(a.categoria || 'Outros').slice(0, 60);
      return { summary: `Vou lançar uma ${tipo} de ${brl(v)} no financeiro: ${desc}, categoria ${cat}, em ${fd(date)}.`,
        run: async actor => { db.prepare('INSERT INTO ledger (date, type, category, description, amount, system_id) VALUES (?,?,?,?,?,NULL)').run(date, tipo, cat, desc, v); audit(actor, 'lançou no financeiro', `${tipo} ${brl(v)} ${desc}`); require('./events').emit('change', {}); return { reply: `Pronto. Lancei a ${tipo} de ${brl(v)}.` }; } };
    }
  },
  enviar_relatorio: {
    label: 'relatório', def: { description: 'Mandar agora o relatório (diário, semanal ou mensal) no WhatsApp dos donos.', input_schema: S('object', { tipo: { type: 'string', enum: ['daily', 'weekly', 'monthly'] } }, ['tipo']) },
    prepare(a) {
      if (!wa.ready() || !wa.ownerPhones().length) return { erro: 'O WhatsApp ou os números dos donos não estão configurados (Configurações).' };
      const kind = ['daily', 'weekly', 'monthly'].includes(a.tipo) ? a.tipo : 'daily', nome = { daily: 'diário', weekly: 'semanal', monthly: 'mensal' }[kind];
      return { summary: `Vou mandar o relatório ${nome} agora no WhatsApp dos donos.`, run: async actor => { const r = await R.send(kind, 'safira'); audit(actor, 'enviou relatório', kind); return { reply: r.ok ? `Pronto. O relatório ${nome} foi enviado.` : `Não consegui enviar o relatório: ${r.error}.` }; } };
    }
  },
  mover_lead: {
    label: 'funil', def: { description: 'Mudar a etapa de um contato (lead) no funil de vendas.', input_schema: S('object', { lead: { type: 'string', description: 'Nome do contato.' }, etapa: { type: 'string', enum: ['novo', 'contato', 'demo', 'proposta', 'fechado', 'perdido'] } }, ['lead', 'etapa']) },
    prepare(a) {
      const q = norm(a.lead), all = db.prepare('SELECT id, name, stage FROM leads').all();
      let hits = all.filter(l => norm(l.name) === q); if (!hits.length) hits = all.filter(l => norm(l.name).includes(q));
      if (!hits.length) return { erro: `Não encontrei nenhum contato "${a.lead}" no funil.` };
      if (hits.length > 1) return { erro: 'Há mais de um contato com esse nome. Pergunte qual.', opcoes: hits.slice(0, 8).map(l => l.name) };
      const l = hits[0]; if (l.stage === a.etapa) return { erro: `${l.name} já está na etapa ${a.etapa}.` };
      return { summary: `Vou mover ${l.name} de ${l.stage} para ${a.etapa} no funil.`, run: async actor => { db.prepare("UPDATE leads SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(a.etapa, l.id); audit(actor, 'moveu lead', `${l.name} → ${a.etapa}`); require('./events').emit('change', {}); return { reply: `Pronto. ${l.name} agora está em ${a.etapa}.` }; } };
    }
  }
};
const actionDefs = () => Object.entries(ACTIONS).map(([name, t]) => ({ name, description: t.def.description, input_schema: t.def.input_schema }));

// ---------- ações aguardando o "sim" ----------
const pending = new Map(); // id -> { uid, summary, detail, run, at }
function hold(uid, p) {
  for (const [k, v] of pending) if (v.uid === uid || Date.now() - v.at > 10 * 60000) pending.delete(k); // uma por pessoa
  const id = crypto.randomBytes(9).toString('hex'); pending.set(id, { uid, ...p, at: Date.now() }); return id;
}
async function confirm(id, user, cancel) {
  const uid = user.sub || user.id || user.email, p = pending.get(String(id || ''));
  if (!p || p.uid !== uid) throw new Error('Essa ação não está mais aguardando confirmação. Peça de novo.');
  pending.delete(String(id));
  if (cancel) return { reply: 'Tudo bem, não fiz nada.' };
  if (Date.now() - p.at > 5 * 60000) throw new Error('Passou muito tempo desde o pedido. Peça de novo para eu conferir os dados atualizados.');
  try { return await p.run((user.email || 'usuário') + ' (pela Safira)'); }
  catch (e) { throw new Error('Não consegui concluir: ' + (e.message || 'erro desconhecido') + '.'); }
}

module.exports = { ACTIONS, actionDefs, hold, confirm, findClient };
