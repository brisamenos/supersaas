// Todas as rotas da API do SuperSaaS
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting, getJSON, setJSON, audit } = require('./db');
const { signToken, requireAuth, requireAdmin, loginBlocked, loginFail, loginOk } = require('./auth');
const { todayBR, phone55, randomPassword, fmtDate, brl, round2, addMonths, daysBetween } = require('./util');
const events = require('./events');
const sync = require('./sync');
const M = require('./metrics');
const I = require('./insights');
const wa = require('./wuzapi');
const R = require('./reports');
const MK = require('./marketing');

const api = express.Router();
const err = (res, code, msg) => res.status(code).json({ error: msg });
const who = req => (req.user && req.user.email) || 'sistema';
const KINDS = { barbersync: 'BarberSync', estimafood: 'EstimaFood', motostock: 'MotoStock', custom: 'Outro sistema' };
const STAGES = ['novo', 'contato', 'demo', 'proposta', 'fechado', 'perdido'];

// ---------- publico ----------
api.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return err(res, 400, 'Informe e-mail e senha.');
  const key = (req.ip || '') + ':' + String(email).toLowerCase();
  if (loginBlocked(key)) return err(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!u || !bcrypt.compareSync(String(password), u.password_hash)) { loginFail(key); return err(res, 401, 'E-mail ou senha incorretos.'); }
  loginOk(key); audit(u.email, 'login', '');
  res.json({ token: signToken(u), user: { id: u.id, email: u.email, name: u.name, role: u.role } });
});

api.use(requireAuth);
api.get('/me', (req, res) => { const u = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(req.user.sub); res.json({ user: u }); });
api.get('/stream', (req, res) => events.addClient(res));
api.post('/password', (req, res) => {
  const { current, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return err(res, 400, 'A senha atual está errada.');
  if (String(password || '').length < 8) return err(res, 400, 'A nova senha precisa ter pelo menos 8 caracteres.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), u.id);
  audit(u.email, 'trocou a própria senha', ''); res.json({ ok: true });
});
api.use((req, res, next) => req.method === 'GET' ? next() : requireAdmin(req, res, next)); // so administrador altera

// ---------- dashboard ----------
api.get('/dashboard', (req, res) => {
  const ov = M.overview();
  ov.insights = I.build().slice(0, 6);
  ov.events = db.prepare("SELECT h.*, s.name AS system_name FROM health_events h JOIN systems s ON s.id = h.system_id ORDER BY h.id DESC LIMIT 6").all();
  ov.audit = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 8').all();
  ov.realtime = events.count();
  res.json(ov);
});

// ---------- sistemas ----------
const publicSystem = s => ({ id: s.id, name: s.name, kind: s.kind, kind_label: KINDS[s.kind] || KINDS.custom, base_url: s.base_url, token_hint: '••••' + String(s.token).slice(-4), enabled: !!s.enabled, status: s.enabled ? s.status : 'desligado',
  latency_ms: s.latency_ms, last_error: s.last_error, last_ok_at: s.last_ok_at, last_sync_at: s.last_sync_at, unit: s.unit, client_word: s.client_word,
  clients: db.prepare('SELECT COUNT(*) c FROM clients WHERE system_id = ? AND gone = 0').get(s.id).c });
const cleanUrl = u => { const x = String(u || '').trim().replace(/\/+$/, ''); return /^https?:\/\/[^\s]+$/i.test(x) ? x : null; };

api.get('/systems', (req, res) => res.json({ systems: db.prepare('SELECT * FROM systems ORDER BY id').all().map(publicSystem), kinds: KINDS }));
api.post('/systems', async (req, res) => {
  const { name, kind, token } = req.body || {}; const base_url = cleanUrl(req.body && req.body.base_url);
  if (!base_url) return err(res, 400, 'Informe o endereço do sistema (ex.: https://meusistema.com).');
  if (!token || String(token).trim().length < 8) return err(res, 400, 'Informe o token do conector (o mesmo HUB_TOKEN do sistema).');
  const probe = { base_url, token: String(token).trim() };
  let ping;
  try { ping = await sync.call(probe, 'GET', '/ping', null, 12000); } catch (e) { return err(res, 400, `Não consegui conectar: ${String(e.message).replace(/[.\s]+$/, "")}.`); }
  if (!ping || !ping.ok) return err(res, 400, 'O endereço respondeu, mas não parece ser um conector do SuperSaaS.');
  const k = KINDS[kind] ? kind : (KINDS[ping.key] ? ping.key : 'custom');
  const id = db.prepare('INSERT INTO systems (name, kind, base_url, token, unit, client_word, login_path) VALUES (?,?,?,?,?,?,?)')
    .run(String(name || ping.label || 'Sistema').trim(), k, base_url, probe.token, ping.unit || 'movimentos', ping.client_word || 'cliente', ping.login_path || '/').lastInsertRowid;
  audit(who(req), 'conectou sistema', name || ping.label);
  await sync.syncSystem(id);
  res.status(201).json({ system: publicSystem(db.prepare('SELECT * FROM systems WHERE id = ?').get(id)) });
});
api.put('/systems/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.id); if (!s) return err(res, 404, 'Sistema não encontrado.');
  const b = req.body || {}; const url = b.base_url ? cleanUrl(b.base_url) : s.base_url;
  if (!url) return err(res, 400, 'Endereço inválido.');
  db.prepare('UPDATE systems SET name = ?, base_url = ?, token = ?, enabled = ?, fail_count = 0 WHERE id = ?')
    .run(String(b.name || s.name).trim(), url, b.token && String(b.token).trim().length >= 8 ? String(b.token).trim() : s.token, b.enabled === undefined ? s.enabled : (b.enabled ? 1 : 0), s.id);
  audit(who(req), 'editou sistema', s.name); sync.syncSystem(s.id).catch(() => {});
  res.json({ ok: true });
});
api.delete('/systems/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.id); if (!s) return err(res, 404, 'Sistema não encontrado.');
  db.prepare('DELETE FROM systems WHERE id = ?').run(s.id); audit(who(req), 'removeu sistema', s.name); res.json({ ok: true });
});
api.post('/systems/:id/sync', async (req, res) => {
  const r = await sync.syncSystem(Number(req.params.id)); const s = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.id);
  if (!s) return err(res, 404, 'Sistema não encontrado.');
  res.json({ ok: !!(r && r.ok), error: r && r.error || null, system: publicSystem(s) });
});

// ---------- clientes ----------
function publicClient(c, groups) {
  const key = (c.email || '').toLowerCase() || String(c.phone || '').replace(/\D/g, '').slice(-11);
  const others = key && groups.get(key) ? [...groups.get(key)].filter(n => n !== c.system_name) : [];
  return { system_id: c.system_id, ext_id: c.ext_id, name: c.name, slug: c.slug, plan: c.plan, active: c.active, state: c.state, expires_at: c.expires_at, days_left: c.days_left, price: c.price, phone: c.phone, email: c.email,
    system_name: c.system_name, system_kind: c.system_kind, unit: c.system_unit, client_word: c.client_word, login_url: c.base_url + (c.login_path || '/'), created_at: c.remote_created_at || c.first_seen_at,
    activity_today: c.activity_today, volume_today: c.volume_today, activity_month: c.activity_month, volume_month: c.volume_month, last_activity: c.last_activity, also_in: others };
}
api.get('/clients', (req, res) => {
  let list = M.allClients();
  const groups = new Map();
  for (const c of list) { const key = (c.email || '').toLowerCase() || String(c.phone || '').replace(/\D/g, '').slice(-11); if (!key) continue; if (!groups.has(key)) groups.set(key, new Set()); groups.get(key).add(c.system_name); }
  const counts = { todos: list.length, em_dia: 0, vencendo: 0, vencido: 0, suspenso: 0, sem_vencimento: 0 };
  list.forEach(c => counts[c.state]++);
  const { system_id, state, q } = req.query;
  if (system_id) list = list.filter(c => c.system_id === Number(system_id));
  if (state) list = list.filter(c => c.state === state);
  if (q) { const t = String(q).toLowerCase(); list = list.filter(c => [c.name, c.email, c.phone, c.slug, c.system_name].some(v => String(v || '').toLowerCase().includes(t))); }
  res.json({ clients: list.map(c => publicClient(c, groups)), counts });
});

function accessMessage(sys, name, email, password, loginUrl) {
  return `Olá, ${name}! 🎉\n\nSeu acesso ao *${sys.name}* está pronto.\n\n🔗 Link: ${loginUrl}\n👤 E-mail: ${email}\n🔑 Senha: ${password}\n\nTroque a senha no primeiro acesso. Qualquer dúvida, é só chamar por aqui!`;
}
api.post('/clients', async (req, res) => {
  const b = req.body || {}; const sys = db.prepare('SELECT * FROM systems WHERE id = ?').get(b.system_id);
  if (!sys) return err(res, 400, 'Escolha o sistema.');
  if (!b.name || String(b.name).trim().length < 2) return err(res, 400, 'Informe o nome.');
  if (!b.email || !String(b.email).includes('@')) return err(res, 400, 'Informe um e-mail válido (será o login).');
  const password = b.password && String(b.password).length >= 6 ? String(b.password) : randomPassword(10);
  try {
    const r = await sync.call(sys, 'POST', '/tenants', { name: String(b.name).trim(), email: String(b.email).trim(), password, plan: b.plan || undefined, price: Number(b.price) || undefined, phone: b.phone || undefined, expires_at: b.expires_at || undefined, slug: b.slug || undefined, segmento: b.segmento || undefined });
    audit(who(req), 'criou acesso', `${b.name} em ${sys.name}`);
    await sync.syncSystem(sys.id);
    const login_url = sync.norm(sys.base_url) + (sys.login_path || '/');
    let whatsapp = null;
    if (b.send_whatsapp && phone55(b.phone)) whatsapp = await wa.sendText(b.phone, accessMessage(sys, String(b.name).trim(), String(b.email).trim(), password, login_url), { kind: 'acesso', name: b.name });
    events.emit('change', {});
    res.status(201).json({ ok: true, id: r.id, slug: r.slug, email: r.email, expires_at: r.expires_at, password, login_url, whatsapp });
  } catch (e) { err(res, e.status && e.status < 500 ? e.status : 502, e.message); }
});

async function clientAction(req, res, fn) {
  const sys = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.systemId); if (!sys) return err(res, 404, 'Sistema não encontrado.');
  const c = db.prepare('SELECT * FROM clients WHERE system_id = ? AND ext_id = ?').get(sys.id, req.params.extId); if (!c) return err(res, 404, 'Cliente não encontrado.');
  try { const out = await fn(sys, c); await sync.syncSystem(sys.id); events.emit('change', {}); res.json({ ok: true, ...out }); }
  catch (e) { err(res, e.status && e.status < 500 ? e.status : 502, e.message); }
}
api.post('/clients/:systemId/:extId/status', (req, res) => clientAction(req, res, async (sys, c) => {
  const active = !!(req.body && req.body.active);
  await sync.call(sys, 'POST', `/tenants/${encodeURIComponent(c.ext_id)}/status`, { active });
  audit(who(req), active ? 'reativou' : 'suspendeu', `${c.name} (${sys.name})`); return { active };
}));
api.post('/clients/:systemId/:extId/renew', (req, res) => clientAction(req, res, async (sys, c) => {
  const b = req.body || {};
  const r = await sync.call(sys, 'POST', `/tenants/${encodeURIComponent(c.ext_id)}/renew`, b.date ? { date: b.date } : (b.days ? { days: Number(b.days) } : { months: Number(b.months) || 1 }));
  audit(who(req), 'renovou', `${c.name} (${sys.name}) até ${r.expires_at}`);
  let ledger = null;
  if (b.record !== false && Number(b.amount) > 0) { // registra o pagamento no financeiro
    ledger = db.prepare("INSERT INTO ledger (date, type, category, description, amount, system_id, client_ext_id, client_name, source) VALUES (?, 'receita', 'Mensalidade', ?, ?, ?, ?, ?, 'renovacao')")
      .run(todayBR(), `Mensalidade ${c.name} (${sys.name})`, Number(b.amount), sys.id, c.ext_id, c.name).lastInsertRowid;
  }
  let whatsapp = null;
  if (b.notify && phone55(c.phone)) whatsapp = await wa.sendText(c.phone, `✅ *Pagamento recebido!*\n\nObrigado, *${c.name}*! Sua mensalidade do ${sys.name} foi renovada e o acesso está liberado até *${fmtDate(r.expires_at)}*. 🙌`, { kind: 'pagamento', name: c.name });
  return { expires_at: r.expires_at, ledger_id: ledger, whatsapp };
}));
api.post('/clients/:systemId/:extId/password', (req, res) => clientAction(req, res, async (sys, c) => {
  const password = req.body && String(req.body.password || '').length >= 6 ? String(req.body.password) : randomPassword(10);
  await sync.call(sys, 'POST', `/tenants/${encodeURIComponent(c.ext_id)}/password`, { password });
  audit(who(req), 'trocou senha', `${c.name} (${sys.name})`);
  let whatsapp = null;
  if (req.body && req.body.send && phone55(c.phone)) whatsapp = await wa.sendText(c.phone, accessMessage(sys, c.name, c.email || '', password, sync.norm(sys.base_url) + (sys.login_path || '/')), { kind: 'acesso', name: c.name });
  return { password, whatsapp };
}));
api.post('/clients/:systemId/:extId/message', (req, res) => clientAction(req, res, async (sys, c) => {
  const text = String((req.body && req.body.text) || '').trim(); if (!text) throw Object.assign(new Error('Escreva a mensagem.'), { status: 400 });
  const r = await wa.sendText(c.phone, MK.render(text, { ...c, system_name: sys.name, days_left: c.expires_at ? daysBetween(todayBR(), c.expires_at) : null }), { kind: 'cliente', name: c.name });
  if (!r.ok) throw Object.assign(new Error(r.error), { status: 400 }); return {};
}));

// ---------- financeiro ----------
api.get('/finance', (req, res) => res.json(M.financeSummary(req.query.month)));
const ledgerBody = b => ({ date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : todayBR(), type: b.type === 'despesa' ? 'despesa' : 'receita', category: String(b.category || 'Outros').slice(0, 60), description: String(b.description || '').slice(0, 200), amount: round2(Math.abs(Number(b.amount) || 0)), system_id: b.system_id ? Number(b.system_id) : null });
api.post('/ledger', (req, res) => {
  const l = ledgerBody(req.body || {}); if (!l.amount) return err(res, 400, 'Informe o valor.');
  const id = db.prepare('INSERT INTO ledger (date, type, category, description, amount, system_id) VALUES (?,?,?,?,?,?)').run(l.date, l.type, l.category, l.description, l.amount, l.system_id).lastInsertRowid;
  audit(who(req), 'lançou no financeiro', `${l.type} ${brl(l.amount)} ${l.description}`); res.status(201).json({ id });
});
api.put('/ledger/:id', (req, res) => {
  const l = ledgerBody(req.body || {}); if (!l.amount) return err(res, 400, 'Informe o valor.');
  const r = db.prepare('UPDATE ledger SET date=?, type=?, category=?, description=?, amount=?, system_id=? WHERE id=?').run(l.date, l.type, l.category, l.description, l.amount, l.system_id, req.params.id);
  if (!r.changes) return err(res, 404, 'Lançamento não encontrado.'); res.json({ ok: true });
});
api.delete('/ledger/:id', (req, res) => { db.prepare('DELETE FROM ledger WHERE id = ?').run(req.params.id); audit(who(req), 'excluiu lançamento', req.params.id); res.json({ ok: true }); });
api.get('/finance/export.csv', (req, res) => {
  const f = M.financeSummary(req.query.month);
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Sistema', 'Valor'].map(q).join(';')];
  for (const l of f.ledger) rows.push([fmtDate(l.date), l.type, l.category, l.description, l.system_name || '', String(l.type === 'despesa' ? -l.amount : l.amount).replace('.', ',')].map(q).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="financeiro-${f.month}.csv"`);
  res.send('﻿' + rows.join('\r\n'));
});

// ---------- relatorios ----------
api.get('/reports/preview', (req, res) => res.json(R.build(['daily', 'weekly', 'monthly'].includes(req.query.kind) ? req.query.kind : 'daily')));
api.post('/reports/send', async (req, res) => { const kind = ['daily', 'weekly', 'monthly'].includes(req.body && req.body.kind) ? req.body.kind : 'daily'; const r = await R.send(kind, 'manual'); audit(who(req), 'enviou relatório', kind); res.json(r); });
api.get('/reports/log', (req, res) => res.json({ log: db.prepare('SELECT id, ts, kind, trigger, ok, error FROM report_log ORDER BY id DESC LIMIT 30').all() }));
api.get('/messages', (req, res) => res.json({ messages: db.prepare('SELECT id, ts, kind, to_phone, to_name, ok, error, substr(text,1,160) AS text FROM message_log ORDER BY id DESC LIMIT 60').all() }));

// ---------- marketing ----------
api.get('/marketing/insights', (req, res) => res.json({ insights: I.build() }));
api.get('/marketing/playbooks', (req, res) => res.json({ playbooks: MK.PLAYBOOKS, segments: MK.SEGMENTS }));
api.get('/marketing/segments', (req, res) => res.json({ segments: Object.entries(MK.SEGMENTS).map(([id, label]) => { const l = MK.segment(id, req.query.system_id); return { id, label, count: l.length, with_phone: l.filter(c => phone55(c.phone)).length }; }) }));
api.post('/marketing/preview', (req, res) => res.json(MK.preview(req.body.segment, req.body.system_id, req.body.text)));
api.post('/marketing/broadcast', (req, res) => {
  const { segment, system_id, text } = req.body || {};
  if (!MK.SEGMENTS[segment]) return err(res, 400, 'Escolha o grupo de clientes.');
  if (!text || String(text).trim().length < 5) return err(res, 400, 'Escreva a mensagem.');
  if (!wa.ready()) return err(res, 400, 'Configure o WhatsApp em Configurações antes de enviar.');
  const job = MK.startBroadcast(segment, system_id, String(text)); audit(who(req), 'iniciou comunicado', `${MK.SEGMENTS[segment]} (${job.total})`);
  res.json({ job });
});
api.get('/marketing/broadcast/:id', (req, res) => { const j = MK.getJob(req.params.id); j ? res.json({ job: j }) : err(res, 404, 'Envio não encontrado.'); });

api.get('/leads', (req, res) => {
  const rows = db.prepare("SELECT l.*, c.name AS campaign_name FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id ORDER BY l.updated_at DESC").all();
  const today = todayBR(), by = {}; STAGES.forEach(s => by[s] = { count: 0, value: 0 });
  rows.forEach(l => { by[l.stage].count++; by[l.stage].value += l.value || 0; l.overdue = !!(l.next_followup && l.next_followup < today && !['fechado', 'perdido'].includes(l.stage)); });
  const closed = by.fechado.count, lost = by.perdido.count;
  res.json({ leads: rows, stages: STAGES, summary: by, conversion: closed + lost ? Math.round(closed / (closed + lost) * 100) : null });
});
const leadBody = b => ({ name: String(b.name || '').trim(), phone: String(b.phone || '').replace(/\D/g, '') || null, email: b.email || null, company: b.company || null, source: b.source || null, system_kind: b.system_kind || null,
  stage: STAGES.includes(b.stage) ? b.stage : 'novo', value: Number(b.value) || 0, next_followup: /^\d{4}-\d{2}-\d{2}$/.test(String(b.next_followup || '')) ? b.next_followup : null, notes: b.notes || null, campaign_id: b.campaign_id ? Number(b.campaign_id) : null });
api.post('/leads', (req, res) => {
  const l = leadBody(req.body || {}); if (!l.name) return err(res, 400, 'Informe o nome do lead.');
  const id = db.prepare('INSERT INTO leads (name, phone, email, company, source, system_kind, stage, value, next_followup, notes, campaign_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(l.name, l.phone, l.email, l.company, l.source, l.system_kind, l.stage, l.value, l.next_followup, l.notes, l.campaign_id).lastInsertRowid;
  res.status(201).json({ id });
});
api.put('/leads/:id', (req, res) => {
  const l = leadBody(req.body || {}); if (!l.name) return err(res, 400, 'Informe o nome do lead.');
  const r = db.prepare("UPDATE leads SET name=?, phone=?, email=?, company=?, source=?, system_kind=?, stage=?, value=?, next_followup=?, notes=?, campaign_id=?, updated_at=datetime('now') WHERE id=?").run(l.name, l.phone, l.email, l.company, l.source, l.system_kind, l.stage, l.value, l.next_followup, l.notes, l.campaign_id, req.params.id);
  if (!r.changes) return err(res, 404, 'Lead não encontrado.'); res.json({ ok: true });
});
api.post('/leads/:id/stage', (req, res) => { const st = req.body && req.body.stage; if (!STAGES.includes(st)) return err(res, 400, 'Etapa inválida.'); db.prepare("UPDATE leads SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(st, req.params.id); res.json({ ok: true }); });
api.delete('/leads/:id', (req, res) => { db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

api.get('/campaigns', (req, res) => {
  const rows = db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all().map(c => {
    const s = db.prepare("SELECT COUNT(*) leads, SUM(CASE WHEN stage='fechado' THEN 1 ELSE 0 END) won, COALESCE(SUM(CASE WHEN stage='fechado' THEN value ELSE 0 END),0) mrr FROM leads WHERE campaign_id = ?").get(c.id);
    const won = s.won || 0;
    return { ...c, leads: s.leads, won, new_mrr: round2(s.mrr), cpl: s.leads ? round2(c.spent / s.leads) : null, cac: won ? round2(c.spent / won) : null, roi: c.spent > 0 && won ? Math.round((s.mrr * 12 - c.spent) / c.spent * 100) : null };
  });
  res.json({ campaigns: rows });
});
const campBody = b => ({ name: String(b.name || '').trim(), channel: b.channel || null, system_kind: b.system_kind || null, start_date: b.start_date || null, end_date: b.end_date || null, spent: round2(Number(b.spent) || 0), status: ['ativa', 'pausada', 'encerrada'].includes(b.status) ? b.status : 'ativa', notes: b.notes || null });
api.post('/campaigns', (req, res) => { const c = campBody(req.body || {}); if (!c.name) return err(res, 400, 'Dê um nome à campanha.'); res.status(201).json({ id: db.prepare('INSERT INTO campaigns (name, channel, system_kind, start_date, end_date, spent, status, notes) VALUES (?,?,?,?,?,?,?,?)').run(c.name, c.channel, c.system_kind, c.start_date, c.end_date, c.spent, c.status, c.notes).lastInsertRowid }); });
api.put('/campaigns/:id', (req, res) => { const c = campBody(req.body || {}); if (!c.name) return err(res, 400, 'Dê um nome à campanha.'); const r = db.prepare('UPDATE campaigns SET name=?, channel=?, system_kind=?, start_date=?, end_date=?, spent=?, status=?, notes=? WHERE id=?').run(c.name, c.channel, c.system_kind, c.start_date, c.end_date, c.spent, c.status, c.notes, req.params.id); r.changes ? res.json({ ok: true }) : err(res, 404, 'Campanha não encontrada.'); });
api.delete('/campaigns/:id', (req, res) => { db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---------- configuracoes ----------
const SETTING_KEYS = ['report_daily_on', 'report_daily_hour', 'report_weekly_on', 'report_weekly_hour', 'report_weekly_day', 'report_monthly_on', 'report_monthly_hour', 'report_monthly_day', 'alerts_enabled'];
api.get('/settings', (req, res) => {
  const c = wa.cfg();
  const out = { wuzapi: { url: c.url, has_admin_token: !!c.admin, instance_name: c.name, ready: wa.ready() }, owner_phones: getJSON('owner_phones', []),
    report_daily_on: getSetting('report_daily_on', '1'), report_daily_hour: getSetting('report_daily_hour', '8'), report_weekly_on: getSetting('report_weekly_on', '0'), report_weekly_hour: getSetting('report_weekly_hour', '8'), report_weekly_day: getSetting('report_weekly_day', '1'),
    report_monthly_on: getSetting('report_monthly_on', '0'), report_monthly_hour: getSetting('report_monthly_hour', '8'), report_monthly_day: getSetting('report_monthly_day', '1'), alerts_enabled: getSetting('alerts_enabled', '1') };
  res.json(out);
});
api.put('/settings', (req, res) => {
  const b = req.body || {};
  if (b.wuzapi_url !== undefined) setSetting('wuzapi_url', String(b.wuzapi_url).trim().replace(/\/+$/, ''));
  if (b.wuzapi_admin_token) setSetting('wuzapi_admin_token', String(b.wuzapi_admin_token).trim());
  if (Array.isArray(b.owner_phones)) { const list = b.owner_phones.map(phone55).filter(Boolean); if (b.owner_phones.filter(x => String(x).trim()).length !== list.length) return err(res, 400, 'Há um telefone inválido (use DDD + número).'); setJSON('owner_phones', list); }
  for (const k of SETTING_KEYS) if (b[k] !== undefined) setSetting(k, String(b[k]));
  audit(who(req), 'alterou configurações', ''); res.json({ ok: true });
});
api.get('/wuzapi/instances', async (req, res) => { try { res.json({ instances: await wa.listInstances() }); } catch (e) { err(res, 400, e.message); } });
api.put('/wuzapi/instance', async (req, res) => { try { const r = await wa.chooseInstance(req.body && req.body.id); audit(who(req), 'escolheu instância', r.name); res.json(r); } catch (e) { err(res, 400, e.message); } });
api.post('/wuzapi/test', async (req, res) => {
  const phone = phone55(req.body && req.body.phone); if (!phone) return err(res, 400, 'Informe um WhatsApp com DDD.');
  const r = await wa.sendText(phone, '✅ *Teste do SuperSaaS*\n\nSe você recebeu esta mensagem, os relatórios e alertas vão chegar neste número.', { kind: 'teste', name: 'Teste' });
  r.ok ? res.json({ ok: true }) : err(res, 400, r.error);
});
api.get('/users', (req, res) => res.json({ users: db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY id').all() }));
api.post('/users', (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!email || !String(email).includes('@')) return err(res, 400, 'E-mail inválido.');
  if (String(password || '').length < 8) return err(res, 400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(String(email).toLowerCase().trim())) return err(res, 409, 'Já existe um usuário com esse e-mail.');
  const id = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)').run(String(email).toLowerCase().trim(), String(name || email).trim(), bcrypt.hashSync(String(password), 10), role === 'viewer' ? 'viewer' : 'admin').lastInsertRowid;
  audit(who(req), 'criou usuário', email); res.status(201).json({ id });
});
api.delete('/users/:id', (req, res) => {
  if (Number(req.params.id) === req.user.sub) return err(res, 400, 'Você não pode excluir o próprio acesso.');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id); audit(who(req), 'excluiu usuário', req.params.id); res.json({ ok: true });
});
api.get('/audit', (req, res) => res.json({ audit: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all() }));

module.exports = api;
