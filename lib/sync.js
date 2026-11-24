// Fala com os conectores de cada sistema: sincroniza clientes, mede se esta online e executa acoes (criar acesso, suspender, renovar...)
const { db, getSetting } = require('./db');
const { todayBR, fmtDate } = require('./util');
const events = require('./events');

const norm = url => String(url || '').trim().replace(/\/+$/, '');

async function call(sys, method, path, body, timeout = 15000) {
  const url = norm(sys.base_url) + '/api/hub/v1' + path;
  let res;
  try {
    res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + sys.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  } catch (e) { throw new Error(e.name === 'TimeoutError' ? 'o sistema demorou demais para responder' : `não consegui acessar o sistema (${e.cause && e.cause.code ? e.cause.code : e.message})`); }
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || (res.status === 404 ? 'o conector não está instalado/ligado nesse sistema (HUB_TOKEN)' : `o sistema respondeu ${res.status}`));
    err.status = res.status; throw err;
  }
  return data;
}

const running = new Set();
let lastPrune = 0;

async function syncSystem(id) {
  const sys = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  if (!sys || !sys.enabled || running.has(id)) return null;
  running.add(id);
  const t0 = Date.now(); const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    const data = await call(sys, 'GET', '/overview', null);
    if (!data || !Array.isArray(data.tenants)) throw new Error('resposta inesperada do conector');
    const latency = Date.now() - t0;
    const up = db.prepare(`INSERT INTO clients (system_id, ext_id, name, slug, plan, active, expires_at, price, phone, email, remote_created_at, activity_today, volume_today, activity_month, volume_month, last_activity, last_seen_at, gone)
      VALUES (@system_id,@ext_id,@name,@slug,@plan,@active,@expires_at,@price,@phone,@email,@created,@at,@vt,@am,@vm,@la,@seen,0)
      ON CONFLICT(system_id, ext_id) DO UPDATE SET name=excluded.name, slug=excluded.slug, plan=excluded.plan, active=excluded.active, expires_at=excluded.expires_at, price=excluded.price, phone=excluded.phone, email=excluded.email,
        remote_created_at=excluded.remote_created_at, activity_today=excluded.activity_today, volume_today=excluded.volume_today, activity_month=excluded.activity_month, volume_month=excluded.volume_month, last_activity=excluded.last_activity, last_seen_at=excluded.last_seen_at, gone=0`);
    db.transaction(() => {
      for (const t of data.tenants) {
        const s = t.stats || {};
        up.run({ system_id: id, ext_id: String(t.id), name: t.name || '(sem nome)', slug: t.slug || null, plan: t.plan || null, active: t.active ? 1 : 0, expires_at: t.expires_at || null, price: Number(t.price) || 0,
          phone: t.phone || null, email: t.email || null, created: t.created_at || null, at: s.activity_today || 0, vt: s.volume_today || 0, am: s.activity_month || 0, vm: s.volume_month || 0, la: s.last_activity || null, seen: stamp });
      }
      db.prepare('UPDATE clients SET gone = 1 WHERE system_id = ? AND last_seen_at < ?').run(id, stamp);
      const meta = data.system || {};
      db.prepare("UPDATE systems SET status='online', latency_ms=?, last_error=NULL, last_ok_at=datetime('now'), last_sync_at=datetime('now'), fail_count=0, unit=COALESCE(?,unit), client_word=COALESCE(?,client_word), login_path=COALESCE(?,login_path) WHERE id=?")
        .run(latency, meta.unit || null, meta.client_word || null, meta.login_path || null, id);
    })();
    if (sys.status === 'offline') {
      db.prepare("INSERT INTO health_events (system_id, type, message) VALUES (?, 'up', ?)").run(id, 'Voltou a responder');
      alertOwners(`🟢 *${sys.name}* voltou ao ar.`);
    }
    snapshot(id, latency, 1);
    events.emit('sync', { system_id: id, status: 'online' });
    return { ok: true };
  } catch (e) {
    const fails = (sys.fail_count || 0) + 1;
    const goingDown = fails >= 2 && sys.status !== 'offline'; // 2 falhas seguidas = fora do ar (evita alarme falso)
    db.prepare("UPDATE systems SET last_error=?, last_sync_at=datetime('now'), fail_count=?, status=? WHERE id=?").run(e.message, fails, fails >= 2 ? 'offline' : sys.status, id);
    if (goingDown) {
      db.prepare("INSERT INTO health_events (system_id, type, message) VALUES (?, 'down', ?)").run(id, e.message);
      alertOwners(`🔴 *${sys.name}* está FORA DO AR.\nMotivo: ${e.message}`);
      snapshot(id, null, 0, true);
    }
    events.emit('sync', { system_id: id, status: fails >= 2 ? 'offline' : sys.status });
    return { ok: false, error: e.message };
  } finally { running.delete(id); }
}

function alertOwners(text) {
  if (getSetting('alerts_enabled', '1') !== '1') return;
  try { require('./wuzapi').notifyOwners(text, 'alerta').catch(() => {}); } catch (_) { /* sem WhatsApp configurado */ }
}

// Foto do sistema (no maximo 1 a cada 10 min) para os graficos de evolucao
function snapshot(systemId, latency, online, force = false) {
  const last = db.prepare('SELECT ts FROM snapshots WHERE system_id = ? ORDER BY id DESC LIMIT 1').get(systemId);
  if (!force && last && Date.now() - Date.parse(last.ts.replace(' ', 'T') + 'Z') < 10 * 60 * 1000) return;
  const today = todayBR();
  const r = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN active=1 AND expires_at IS NOT NULL AND expires_at >= @t THEN 1 ELSE 0 END) act,
      SUM(CASE WHEN active=1 AND expires_at IS NOT NULL AND expires_at < @t THEN 1 ELSE 0 END) exp,
      SUM(CASE WHEN active=1 AND expires_at IS NOT NULL AND expires_at >= @t THEN price ELSE 0 END) mrr,
      SUM(volume_today) vt, SUM(volume_month) vm, SUM(activity_today) at_
    FROM clients WHERE system_id = @id AND gone = 0`).get({ t: today, id: systemId });
  db.prepare('INSERT INTO snapshots (day, system_id, clients_total, clients_active, expired, mrr, volume_today, volume_month, activity_today, latency_ms, online) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(today, systemId, r.total || 0, r.act || 0, r.exp || 0, r.mrr || 0, r.vt || 0, r.vm || 0, r.at_ || 0, latency, online);
}

async function syncAll() {
  const list = db.prepare('SELECT id FROM systems WHERE enabled = 1').all();
  await Promise.all(list.map(s => syncSystem(s.id)));
  if (Date.now() - lastPrune > 6 * 3600 * 1000) { // limpeza: guarda 60 dias de historico
    lastPrune = Date.now();
    db.prepare("DELETE FROM snapshots WHERE ts < datetime('now','-60 days')").run();
    db.prepare("DELETE FROM message_log WHERE ts < datetime('now','-90 days')").run();
  }
}

let timer = null;
function startSync() {
  if (timer) return;
  const interval = Math.max(15, Number(process.env.HUB_SYNC_SECONDS) || 30) * 1000;
  timer = setInterval(() => syncAll().catch(e => console.error('[sync]', e.message)), interval);
  setTimeout(() => syncAll().catch(() => {}), 2000);
}

module.exports = { call, syncSystem, syncAll, startSync, norm, fmtDate };
