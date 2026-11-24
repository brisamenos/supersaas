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
const AS = require('./assistant');
const VO = require('./voice');
const ACT = require('./actions');
const SA = require('./safira-actions');

const api = express.Router();
const err = (res, code, msg) => res.status(code).json({ error: msg });
const who = req => (req.user && req.user.email) || 'sistema';
const KINDS = { barbersync: 'BarberSync', estimafood: 'EstimaFood', motostock: 'MotoStock', controlefacil: 'Controle Fácil', custom: 'Outro sistema' };
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
  res.json({ token: signToken(u), user: { id: u.id, email: u.email, name: u.name, role: u.role, avatar: u.avatar || null } });
});

api.use(requireAuth);
api.get('/me', (req, res) => { const u = db.prepare('SELECT id, email, name, role, avatar FROM users WHERE id = ?').get(req.user.sub); res.json({ user: u }); });
api.get('/stream', (req, res) => events.addClient(res));
api.post('/password', (req, res) => {
  const { current, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return err(res, 400, 'A senha atual está errada.');
  if (String(password || '').length < 8) return err(res, 400, 'A nova senha precisa ter pelo menos 8 caracteres.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), u.id);
  audit(u.email, 'trocou a própria senha', ''); res.json({ ok: true });
});
// Foto de perfil: cada pessoa troca a própria (quem só visualiza também)
api.post('/me/avatar', (req, res) => {
  const img = req.body && req.body.image;
  if (img === null || img === '') { db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.sub); return res.json({ ok: true, avatar: null }); }
  if (typeof img !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) return err(res, 400, 'Envie uma imagem JPG, PNG ou WebP.');
  if (img.length > 400000) return err(res, 400, 'A foto ficou grande demais. Escolha outra.');
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(img, req.user.sub);
  audit(who(req), 'trocou a foto do perfil', ''); res.json({ ok: true, avatar: img });
});
// Assistente: só consulta dados, por isso quem só visualiza também pode perguntar
api.post('/assistant', async (req, res) => {
  try { res.json(await AS.ask(req.body && req.body.messages, req.user, { voice: !!(req.body && req.body.voice), name: String((req.body && req.body.name) || '').replace(/[^\p{L} '-]/gu, '').slice(0, 40) })); }
  catch (e) { err(res, e.code === 'no_key' ? 409 : 400, e.message); }
});
// Voz premium da Safira (OpenAI): devolve o áudio mp3 da frase
api.post('/assistant/speech', async (req, res) => {
  try { const b = req.body || {}; const buf = await VO.speech(b.text, b.voice, req.user); res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }); res.end(buf); }
  catch (e) { err(res, e.code === 'no_key' ? 409 : 400, e.message); }
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
    const r = await ACT.createAccess(sys, { ...b, password }, who(req));
    res.status(201).json({ ok: true, ...r });
  } catch (e) { err(res, e.status && e.status < 500 ? e.status : 502, e.message); }
});

async function clientAction(req, res, fn) {
  const sys = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.systemId); if (!sys) return err(res, 404, 'Sistema não encontrado.');
  const c = db.prepare('SELECT * FROM clients WHERE system_id = ? AND ext_id = ?').get(sys.id, req.params.extId); if (!c) return err(res, 404, 'Cliente não encontrado.');
  try { const out = await fn(sys, c); await sync.syncSystem(sys.id); events.emit('change', {}); res.json({ ok: true, ...out }); }
  catch (e) { err(res, e.status && e.status < 500 ? e.status : 502, e.message); }
}
api.post('/clients/:systemId/:extId/status', (req, res) => clientAction(req, res, (sys, c) => ACT.setStatus(sys, c, !!(req.body && req.body.active), who(req))));
api.post('/clients/:systemId/:extId/renew', (req, res) => clientAction(req, res, (sys, c) => ACT.renew(sys, c, req.body || {}, who(req))));
api.post('/clients/:systemId/:extId/password', (req, res) => clientAction(req, res, (sys, c) => ACT.resetPassword(sys, c, req.body || {}, who(req))));
api.post('/clients/:systemId/:extId/price', (req, res) => clientAction(req, res, (sys, c) => ACT.setPrice(sys, c, req.body && req.body.price, who(req))));
api.post('/clients/:systemId/:extId/message', (req, res) => clientAction(req, res, async (sys, c) => {
  const text = String((req.body && req.body.text) || '').trim(); if (!text) throw Object.assign(new Error('Escreva a mensagem.'), { status: 400 });
  return ACT.message(sys, c, text, who(req));
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
    report_monthly_on: getSetting('report_monthly_on', '0'), report_monthly_hour: getSetting('report_monthly_hour', '8'), report_monthly_day: getSetting('report_monthly_day', '1'), alerts_enabled: getSetting('alerts_enabled', '1'),
    assistant: { ready: AS.ready(), model: AS.cfg().model, models: AS.MODELS, has_key: !!getSetting('assistant_key', ''), key_from_env: !getSetting('assistant_key', '') && !!process.env.ANTHROPIC_API_KEY },
    voice: { ready: VO.ready(), voices: VO.VOICES, model: VO.cfg().model, has_key: !!getSetting('openai_key', ''), key_from_env: !getSetting('openai_key', '') && !!process.env.OPENAI_API_KEY } };
  res.json(out);
});
api.put('/settings', (req, res) => {
  const b = req.body || {};
  if (b.wuzapi_url !== undefined) setSetting('wuzapi_url', String(b.wuzapi_url).trim().replace(/\/+$/, ''));
  if (b.wuzapi_admin_token) setSetting('wuzapi_admin_token', String(b.wuzapi_admin_token).trim());
  if (b.assistant_key) setSetting('assistant_key', String(b.assistant_key).trim());
  if (b.assistant_key_clear) setSetting('assistant_key', '');
  if (b.openai_key) setSetting('openai_key', String(b.openai_key).trim());
  if (b.openai_key_clear) setSetting('openai_key', '');
  if (b.assistant_model && AS.MODELS.some(m => m.id === b.assistant_model)) setSetting('assistant_model', b.assistant_model);
  if (Array.isArray(b.owner_phones)) { const list = b.owner_phones.map(phone55).filter(Boolean); if (b.owner_phones.filter(x => String(x).trim()).length !== list.length) return err(res, 400, 'Há um telefone inválido (use DDD + número).'); setJSON('owner_phones', list); }
  for (const k of SETTING_KEYS) if (b[k] !== undefined) setSetting(k, String(b[k]));
  audit(who(req), 'alterou configurações', ''); res.json({ ok: true });
});
// Safira: executa (ou cancela) a ação que o dono acabou de confirmar. Só administrador.
api.post('/assistant/confirm', async (req, res) => {
  try { const b = req.body || {}; res.json({ ok: true, ...(await SA.confirm(b.id, req.user, !!b.cancel)) }); }
  catch (e) { err(res, 400, e.message); }
});
api.post('/assistant/test', async (req, res) => {
  const c = AS.cfg(); if (!c.key) return err(res, 400, 'Cole a chave da API primeiro.');
  try { await AS.callClaude(c, [{ role: 'user', content: 'Responda só: ok' }], { max_tokens: 16, noTools: true }); res.json({ ok: true, model: c.model }); } catch (e) { err(res, 400, e.message); }
});
api.get('/wuzapi/instances', async (req, res) => { try { res.json({ instances: await wa.listInstances() }); } catch (e) { err(res, 400, e.message); } });
api.put('/wuzapi/instance', async (req, res) => { try { const r = await wa.chooseInstance(req.body && req.body.id); audit(who(req), 'escolheu instância', r.name); res.json(r); } catch (e) { err(res, 400, e.message); } });
api.post('/wuzapi/test', async (req, res) => {
  const phone = phone55(req.body && req.body.phone); if (!phone) return err(res, 400, 'Informe um WhatsApp com DDD.');
  const r = await wa.sendText(phone, '✅ *Teste do SuperSaaS*\n\nSe você recebeu esta mensagem, os relatórios e alertas vão chegar neste número.', { kind: 'teste', name: 'Teste' });
  r.ok ? res.json({ ok: true }) : err(res, 400, r.error);
});
api.get('/users', (req, res) => res.json({ users: db.prepare('SELECT id, email, name, role, avatar, created_at FROM users ORDER BY id').all() }));
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
