// Calculos compartilhados: estado dos clientes, MRR, dashboard, financeiro, series de evolucao
const { db } = require('./db');
const { todayBR, addDays, daysBetween, monthOf, addMonths, round2 } = require('./util');

function stateOf(c, today = todayBR()) {
  if (!c.active) return 'suspenso';
  if (!c.expires_at) return 'sem_vencimento';
  const d = daysBetween(today, c.expires_at);
  if (d < 0) return 'vencido';
  if (d <= 7) return 'vencendo';
  return 'em_dia';
}
const isPaying = st => st === 'em_dia' || st === 'vencendo' || st === 'sem_vencimento';

// Todos os clientes de sistemas ligados, ja com o estado calculado
function allClients() {
  const today = todayBR();
  return db.prepare(`SELECT c.*, s.name AS system_name, s.kind AS system_kind, s.unit AS system_unit, s.client_word AS client_word, s.base_url, s.login_path
      FROM clients c JOIN systems s ON s.id = c.system_id WHERE c.gone = 0 AND s.enabled = 1 ORDER BY c.name COLLATE NOCASE`).all()
    .map(c => ({ ...c, active: !!c.active, state: stateOf(c, today), days_left: c.expires_at ? daysBetween(today, c.expires_at) : null }));
}

function series(days = 30) {
  const from = addDays(todayBR(), -(days - 1));
  return db.prepare(`SELECT day, SUM(mrr) mrr, SUM(clients_active) clients, SUM(volume_today) volume_day, SUM(volume_month) volume_month, SUM(activity_today) activity_day
      FROM snapshots WHERE id IN (SELECT MAX(id) FROM snapshots WHERE day >= ? GROUP BY system_id, day) GROUP BY day ORDER BY day`).all(from)
    .map(r => ({ ...r, mrr: round2(r.mrr), volume_day: round2(r.volume_day), volume_month: round2(r.volume_month) }));
}

// O ponto de hoje usa os números ao vivo (o registro de 10 em 10 min pode estar defasado)
function liveSeries(days, now) {
  const ser = series(days), t = ser.find(x => x.day === now.day);
  if (t) Object.assign(t, now); else ser.push(now);
  return ser;
}

function overview() {
  const today = todayBR();
  const clients = allClients();
  const systems = db.prepare('SELECT * FROM systems ORDER BY id').all();
  const k = { clients_total: clients.length, em_dia: 0, vencendo: 0, vencido: 0, suspenso: 0, sem_vencimento: 0 };
  let mrr = 0, payers = 0, volumeToday = 0, volumeMonth = 0, activityToday = 0, activityMonth = 0, mrrRisk = 0, new30 = 0;
  const cutoff = addDays(today, -30);
  const perSystem = new Map(systems.map(s => [s.id, { clients: 0, active: 0, vencido: 0, vencendo: 0, mrr: 0, volume_today: 0, volume_month: 0, activity_today: 0, activity_month: 0 }]));
  for (const c of clients) {
    k[c.state]++;
    const ps = perSystem.get(c.system_id);
    ps.clients++;
    if (isPaying(c.state)) { mrr += c.price || 0; payers++; ps.mrr += c.price || 0; ps.active++; }
    if (c.state === 'vencido') { mrrRisk += c.price || 0; ps.vencido++; }
    if (c.state === 'vencendo') ps.vencendo++;
    volumeToday += c.volume_today || 0; volumeMonth += c.volume_month || 0; activityToday += c.activity_today || 0; activityMonth += c.activity_month || 0;
    ps.volume_today += c.volume_today || 0; ps.volume_month += c.volume_month || 0; ps.activity_today += c.activity_today || 0; ps.activity_month += c.activity_month || 0;
    const created = (c.remote_created_at || c.first_seen_at || '').slice(0, 10);
    if (created && created >= cutoff) new30++;
  }
  const top = clients.filter(c => c.volume_month > 0).sort((a, b) => b.volume_month - a.volume_month).slice(0, 6)
    .map(c => ({ name: c.name, system_name: c.system_name, volume_month: round2(c.volume_month), activity_month: c.activity_month, unit: c.system_unit }));
  const live = clients.filter(c => c.last_activity).sort((a, b) => String(b.last_activity).localeCompare(String(a.last_activity))).slice(0, 8)
    .map(c => ({ name: c.name, system_name: c.system_name, last_activity: c.last_activity, unit: c.system_unit }));
  return {
    today,
    kpis: { ...k, mrr: round2(mrr), arr: round2(mrr * 12), ticket: payers ? round2(mrr / payers) : 0, payers, mrr_risk: round2(mrrRisk), new_30d: new30,
      volume_today: round2(volumeToday), volume_month: round2(volumeMonth), activity_today: activityToday, activity_month: activityMonth,
      systems_total: systems.length, systems_online: systems.filter(s => s.status === 'online').length, systems_offline: systems.filter(s => s.status === 'offline').length },
    systems: systems.map(s => ({ id: s.id, name: s.name, kind: s.kind, unit: s.unit, client_word: s.client_word, enabled: !!s.enabled, status: s.enabled ? s.status : 'desligado', latency_ms: s.latency_ms, last_error: s.last_error, last_ok_at: s.last_ok_at, last_sync_at: s.last_sync_at, base_url: s.base_url,
      ...Object.fromEntries(Object.entries(perSystem.get(s.id)).map(([a, b]) => [a, round2(b)])) })),
    top, live, series: liveSeries(30, { day: today, mrr: round2(mrr), clients: payers, volume_day: round2(volumeToday), volume_month: round2(volumeMonth), activity_day: activityToday })
  };
}

// ---------- financeiro ----------
function financeSummary(month) {
  const today = todayBR(); month = /^\d{4}-\d{2}$/.test(month || '') ? month : monthOf(today);
  const clients = allClients();
  const paying = clients.filter(c => isPaying(c.state));
  const mrr = paying.reduce((s, c) => s + (c.price || 0), 0);
  const ledger = db.prepare("SELECT l.*, s.name AS system_name FROM ledger l LEFT JOIN systems s ON s.id = l.system_id WHERE substr(l.date,1,7) = ? ORDER BY l.date DESC, l.id DESC").all(month);
  const received = ledger.filter(l => l.type === 'receita').reduce((s, l) => s + l.amount, 0);
  const expenses = ledger.filter(l => l.type === 'despesa').reduce((s, l) => s + l.amount, 0);
  const byCat = {};
  for (const l of ledger.filter(l => l.type === 'despesa')) byCat[l.category || 'Outros'] = (byCat[l.category || 'Outros'] || 0) + l.amount;
  const late = clients.filter(c => c.state === 'vencido').map(c => ({ system_id: c.system_id, ext_id: c.ext_id, name: c.name, system_name: c.system_name, price: c.price, expires_at: c.expires_at, days_late: -c.days_left, phone: c.phone }))
    .sort((a, b) => b.days_late - a.days_late);
  const dueSoon = (n) => paying.filter(c => c.expires_at && c.days_left >= 0 && c.days_left <= n).map(c => ({ system_id: c.system_id, ext_id: c.ext_id, name: c.name, system_name: c.system_name, price: c.price, expires_at: c.expires_at, days_left: c.days_left, phone: c.phone }))
    .sort((a, b) => a.days_left - b.days_left);
  const d7 = dueSoon(7), d30 = dueSoon(30);
  const bySystem = db.prepare('SELECT id, name FROM systems ORDER BY id').all().map(s => {
    const cs = paying.filter(c => c.system_id === s.id);
    const rec = ledger.filter(l => l.type === 'receita' && l.system_id === s.id).reduce((a, l) => a + l.amount, 0);
    return { id: s.id, name: s.name, clients: cs.length, mrr: round2(cs.reduce((a, c) => a + (c.price || 0), 0)), received: round2(rec), late: clients.filter(c => c.system_id === s.id && c.state === 'vencido').length };
  });
  // ultimos 6 meses (livro-caixa)
  const months = []; let m = addMonths(month + '-01', -5).slice(0, 7);
  for (let i = 0; i < 6; i++) { months.push(m); m = addMonths(m + '-01', 1).slice(0, 7); }
  const monthly = months.map(mm => {
    const r = db.prepare("SELECT type, SUM(amount) v FROM ledger WHERE substr(date,1,7) = ? GROUP BY type").all(mm);
    const rec = (r.find(x => x.type === 'receita') || {}).v || 0, des = (r.find(x => x.type === 'despesa') || {}).v || 0;
    return { month: mm, received: round2(rec), expenses: round2(des), profit: round2(rec - des) };
  });
  return {
    month, mrr: round2(mrr), arr: round2(mrr * 12), ticket: paying.length ? round2(mrr / paying.length) : 0, payers: paying.length,
    received: round2(received), expenses: round2(expenses), profit: round2(received - expenses), expected_gap: round2(mrr - received),
    late_total: round2(late.reduce((s, c) => s + (c.price || 0), 0)), late, due7: d7, due7_total: round2(d7.reduce((s, c) => s + (c.price || 0), 0)), due30: d30, due30_total: round2(d30.reduce((s, c) => s + (c.price || 0), 0)),
    suspended: clients.filter(c => c.state === 'suspenso').length, gone: db.prepare('SELECT COUNT(*) c FROM clients WHERE gone = 1').get().c,
    by_system: bySystem, expenses_by_category: Object.entries(byCat).map(([category, v]) => ({ category, amount: round2(v) })).sort((a, b) => b.amount - a.amount),
    monthly, ledger
  };
}

module.exports = { stateOf, isPaying, allClients, overview, series, financeSummary };
