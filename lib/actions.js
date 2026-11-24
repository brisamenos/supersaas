// Ações sobre os clientes, usadas pelas telas E pela Safira (o mesmo código, o mesmo resultado).
const { db, audit } = require('./db');
const { todayBR, addDays, addMonths, fmtDate, phone55, randomPassword, daysBetween, brl, sleep } = require('./util');
const sync = require('./sync');
const events = require('./events');
const wa = require('./wuzapi');
const MK = require('./marketing');

// Mesma conta que os conectores fazem: soma a partir do vencimento atual (se ainda não venceu) ou de hoje.
function nextExpiry(current, { months, days, date }) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return date;
  const hoje = todayBR(), atual = current ? String(current).slice(0, 10) : null;
  const base = atual && atual > hoje ? atual : hoje;
  return days ? addDays(base, Math.max(1, Math.min(3650, Number(days) || 30))) : addMonths(base, Math.max(1, Math.min(36, Number(months) || 1)));
}

async function after(sys) { try { await sync.syncSystem(sys.id); } catch (_) { /* a próxima leitura corrige */ } events.emit('change', {}); }

async function renew(sys, c, b, actor) {
  const r = await sync.call(sys, 'POST', `/tenants/${encodeURIComponent(c.ext_id)}/renew`, b.date ? { date: b.date } : (b.days ? { days: Number(b.days) } : { months: Number(b.months) || 1 }));
  audit(actor, 'renovou', `${c.name} (${sys.name}) até ${r.expires_at}`);
  let ledger = null;
  if (b.record !== false && Number(b.amount) > 0) { // registra o pagamento no financeiro
    ledger = db.prepare("INSERT INTO ledger (date, type, category, description, amount, system_id, client_ext_id, client_name, source) VALUES (?, 'receita', 'Mensalidade', ?, ?, ?, ?, ?, 'renovacao')")
      .run(todayBR(), `Mensalidade ${c.name} (${sys.name})`, Number(b.amount), sys.id, c.ext_id, c.name).lastInsertRowid;
  }
  let whatsapp = null;
  if (b.notify && phone55(c.phone)) whatsapp = await wa.sendText(c.phone, `✅ *Pagamento recebido!*\n\nObrigado, *${c.name}*! Sua mensalidade do ${sys.name} foi renovada e o acesso está liberado até *${fmtDate(r.expires_at)}*. 🙌`, { kind: 'pagamento', name: c.name });
  return { expires_at: r.expires_at, ledger_id: ledger, whatsapp };
}
async function setStatus(sys, c, active, actor) {
  await sync.call(sys, 'POST', `/tenants/${encodeURIComponent(c.ext_id)}/status`, { active: !!active });
  audit(actor, active ? 'reativou' : 'suspendeu', `${c.name} (${sys.name})`); return { active: !!active };
}
function accessMessage(sys, name, email, password, loginUrl) {
  return `Olá, ${name}! 🎉\n\nSeu acesso ao *${sys.name}* está pronto.\n\n🔗 Link: ${loginUrl}\n👤 E-mail: ${email}\n🔑 Senha: ${password}\n\nTroque a senha no primeiro acesso. Qualquer dúvida, é só chamar por aqui!`;
}
const loginUrl = sys => sync.norm(sys.base_url) + (sys.login_path || '/');
async function resetPassword(sys, c, b, actor) {
  const password = b && String(b.password || '').length >= 6 ? String(b.password) : randomPassword(10);
  await sync.call(sys, 'POST', `/tenants/${encodeURIComponent(c.ext_id)}/password`, { password });
  audit(actor, 'trocou senha', `${c.name} (${sys.name})`);
  let whatsapp = null;
  if (b && b.send && phone55(c.phone)) whatsapp = await wa.sendText(c.phone, accessMessage(sys, c.name, c.email || '', password, loginUrl(sys)), { kind: 'acesso', name: c.name });
  return { password, whatsapp };
}
const renderFor = (sys, c, text) => MK.render(text, { ...c, system_name: sys.name, days_left: c.expires_at ? daysBetween(todayBR(), c.expires_at) : null });
async function message(sys, c, text, actor, kind = 'cliente') {
  const r = await wa.sendText(c.phone, renderFor(sys, c, text), { kind, name: c.name });
  if (!r.ok) throw Object.assign(new Error(r.error), { status: 400 });
  audit(actor, 'enviou mensagem', `${c.name} (${sys.name})`); return {};
}
async function createAccess(sys, b, actor) {
  const password = b.password && String(b.password).length >= 6 ? String(b.password) : randomPassword(10);
  const r = await sync.call(sys, 'POST', '/tenants', { name: String(b.name).trim(), email: String(b.email).trim(), password, plan: b.plan || undefined, price: Number(b.price) || undefined, phone: b.phone || undefined, expires_at: b.expires_at || undefined, slug: b.slug || undefined, segmento: b.segmento || undefined });
  audit(actor, 'criou acesso', `${b.name} em ${sys.name}`);
  await sync.syncSystem(sys.id);
  let whatsapp = null;
  if (b.send_whatsapp && phone55(b.phone)) whatsapp = await wa.sendText(b.phone, accessMessage(sys, String(b.name).trim(), String(b.email).trim(), password, loginUrl(sys)), { kind: 'acesso', name: b.name });
  events.emit('change', {});
  return { id: r.id, slug: r.slug, email: r.email, expires_at: r.expires_at, password, login_url: loginUrl(sys), whatsapp };
}

// Cobrança: texto pronto conforme a situação (já venceu ou vai vencer), com os dados reais do cliente
const BILL = Object.fromEntries(MK.PLAYBOOKS.filter(p => ['cobranca', 'renovacao'].includes(p.id)).map(p => [p.id, p.message]));
const BILL_TODAY = 'Oi, {nome}! Passando para lembrar que a mensalidade do {sistema} ({valor}) vence hoje, {vencimento}. É só pagar pelo Pix e fica tudo renovado. Obrigado! 🙏';
function billingText(c) {
  if (c.days_left !== null && c.days_left !== undefined && c.days_left < 0) return BILL.cobranca;
  if (c.days_left === 0) return BILL_TODAY;
  return BILL.renovacao;
}
// Envio em lote, em segundo plano, com intervalo (não bloqueia o número do WhatsApp)
function sendBatch(list, textFor, kind, actor, label) {
  const targets = list.filter(c => phone55(c.phone));
  const job = { total: targets.length, sent: 0, failed: 0, done: false, errors: [] };
  audit(actor, 'iniciou cobrança em lote', `${label} (${targets.length})`);
  (async () => {
    for (const c of targets) {
      const sys = db.prepare('SELECT * FROM systems WHERE id = ?').get(c.system_id);
      const r = await wa.sendText(c.phone, renderFor(sys || { name: c.system_name }, c, textFor(c)), { kind, name: c.name });
      if (r.ok) job.sent++; else { job.failed++; if (job.errors.length < 5) job.errors.push(`${c.name}: ${r.error}`); }
      await sleep(4000);
    }
    job.done = true;
  })().catch(e => { job.done = true; job.errors.push(e.message); });
  return job;
}

// Mudar a mensalidade (só nos sistemas cujo conector permite; os outros avisam)
async function setPrice(sys, c, price, actor) {
  const v = Math.round(Number(price) * 100) / 100;
  if (!(v >= 0) || v > 100000) throw Object.assign(new Error('Valor inválido.'), { status: 400 });
  try { await sync.call(sys, 'POST', `/tenants/${encodeURIComponent(c.ext_id)}/price`, { price: v }); }
  catch (e) { if (e.status === 404 && !/(barbearia|administrador|loja|cliente|restaurante|empresa|tenant)\S* n[aã]o encontrad/i.test(e.message)) throw Object.assign(new Error(`O ${sys.name} ainda não permite mudar a mensalidade pela central. Mude no próprio sistema.`), { status: 400 }); throw e; }
  audit(actor, 'mudou mensalidade', `${c.name} (${sys.name}): ${brl(c.price || 0)} → ${brl(v)}`);
  return { price: v };
}

module.exports = { setPrice, nextExpiry, after, renew, setStatus, resetPassword, message, createAccess, accessMessage, loginUrl, billingText, renderFor, sendBatch, brl };
