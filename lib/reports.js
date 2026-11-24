// Relatorios (diario, semanal, mensal): montados com os numeros reais e enviados por WhatsApp (WuzAPI) aos donos
const { db, getSetting, setSetting } = require('./db');
const { todayBR, hourBR, weekdayBR, addDays, addMonths, monthOf, fmtDate, brl, round2 } = require('./util');
const M = require('./metrics');
const I = require('./insights');
const wa = require('./wuzapi');

const KINDS = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal' };
const delta = (now, before, money = true) => { if (before === null || before === undefined) return ''; const d = round2(now - before); if (!d) return ' (=)'; return ` (${d > 0 ? '▲ +' : '▼ -'}${money ? brl(Math.abs(d)) : Math.abs(d)})`; };
const sysLines = ov => ov.systems.filter(s => s.enabled).map(s => `${s.status === 'online' ? '🟢' : s.status === 'offline' ? '🔴' : '⚪'} *${s.name}*: ${s.active} ${s.client_word}(s) ativo(s) • ${s.activity_today} ${s.unit} hoje • ${brl(s.volume_today)}`);
const alertLines = ins => ins.filter(i => i.level !== 'info').slice(0, 4).map(i => `${i.icon} ${i.title}`);

function build(kind) {
  const today = todayBR(), ov = M.overview(), k = ov.kpis, ins = I.build();
  const head = `📊 *SuperSaaS — Relatório ${KINDS[kind] || ''}*`;
  const lines = [];
  if (kind === 'daily') {
    lines.push(head, `📅 ${fmtDate(today)}`, '');
    lines.push(`🖥️ Sistemas: *${k.systems_online}/${k.systems_total}* online`);
    lines.push(`👥 Clientes: *${k.clients_total}* (${k.payers} pagando)`);
    lines.push(`⚠️ Vencendo em 7 dias: *${k.vencendo}* • 🔴 Vencidos: *${k.vencido}*`);
    lines.push(`💰 MRR (receita mensal): *${brl(k.mrr)}*`);
    lines.push(`📈 Movimento dos clientes hoje: *${k.activity_today}* • ${brl(k.volume_today)}`);
    const sl = sysLines(ov); if (sl.length) lines.push('', '*Por sistema*', ...sl);
  } else if (kind === 'weekly') {
    const ser = M.series(8), first = ser.length > 1 ? ser[0] : null;
    const from = addDays(today, -7);
    const rec = db.prepare("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM ledger WHERE type='receita' AND date > ?").get(from);
    const leadsNew = db.prepare("SELECT COUNT(*) c FROM leads WHERE date(created_at) > ?").get(from).c;
    const leadsWon = db.prepare("SELECT COUNT(*) c FROM leads WHERE stage='fechado' AND date(updated_at) > ?").get(from).c;
    lines.push(head, `📅 Semana até ${fmtDate(today)}`, '');
    lines.push(`💰 MRR: *${brl(k.mrr)}*${delta(k.mrr, first ? first.mrr : null)}`);
    lines.push(`👥 Clientes pagando: *${k.payers}*${delta(k.payers, first ? first.clients : null, false)}`);
    lines.push(`🆕 Novos clientes (30 dias): *${k.new_30d}*`);
    lines.push(`💵 Recebido na semana: *${brl(rec.v)}* (${rec.n} pagamento(s))`);
    lines.push(`🔴 Vencidos: *${k.vencido}* (${brl(k.mrr_risk)}/mês parados)`);
    lines.push(`📊 Movimento no mês: *${k.activity_month}* • ${brl(k.volume_month)}`);
    if (leadsNew || leadsWon) lines.push(`🎯 Leads: *${leadsNew}* novos • *${leadsWon}* fechados`);
    if (ov.top.length) lines.push('', '*Clientes que mais movimentam*', ...ov.top.slice(0, 3).map((c, i) => `${i + 1}. ${c.name} (${c.system_name}) — ${brl(c.volume_month)}`));
  } else {
    const prev = addMonths(today.slice(0, 8) + '01', -1).slice(0, 7), fin = M.financeSummary(prev);
    const label = new Date(prev + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const won = db.prepare("SELECT COUNT(*) c FROM leads WHERE stage='fechado' AND substr(updated_at,1,7)=?").get(prev).c;
    const spent = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE type='despesa' AND category = 'Anúncios' AND substr(date,1,7)=?").get(prev).v;
    lines.push(head, `🗓️ Fechamento de *${label}*`, '');
    lines.push(`💵 Recebido: *${brl(fin.received)}*`, `🧾 Despesas: *${brl(fin.expenses)}*`, `✅ Lucro: *${brl(fin.profit)}*`);
    lines.push('', `📌 Hoje: MRR *${brl(k.mrr)}* • ${k.payers} clientes pagando • ${k.vencido} vencido(s)`);
    if (won) lines.push(`🎯 Clientes fechados no mês: *${won}*`);
    if (spent) lines.push(`📣 Investido em anúncios: *${brl(spent)}*`);
    if (fin.by_system.length) lines.push('', '*Receita mensal por sistema*', ...fin.by_system.map(s => `• ${s.name}: ${brl(s.mrr)} (${s.clients} clientes)`));
  }
  const al = alertLines(ins);
  if (al.length) lines.push('', '*Atenção*', ...al);
  lines.push('', '_Enviado pelo SuperSaaS_');
  return { kind, text: lines.join('\n'), data: { kpis: k, alerts: ins.slice(0, 6) } };
}

async function send(kind, trigger = 'manual') {
  const r = build(kind);
  const res = await wa.notifyOwners(r.text, 'relatorio');
  db.prepare('INSERT INTO report_log (kind, trigger, ok, error, text) VALUES (?,?,?,?,?)').run(kind, trigger, res.ok ? 1 : 0, res.error || null, r.text);
  return { ok: res.ok, error: res.error || null, sent: res.sent || 0, text: r.text };
}

// Agenda: confere a cada minuto se algum relatorio esta na hora (uma unica vez por periodo)
function tick() {
  if (!wa.ready() || !wa.ownerPhones().length) return;
  const today = todayBR(), h = hourBR();
  const todo = (kind, periodKey) => {
    if (getSetting(`report_${kind}_on`, kind === 'daily' ? '1' : '0') !== '1') return;
    if (h < Number(getSetting(`report_${kind}_hour`, '8'))) return;
    if (getSetting(`report_${kind}_last`) === periodKey) return;
    setSetting(`report_${kind}_last`, periodKey); // marca antes: nunca envia 2x, mesmo se der erro
    send(kind, 'agendado').catch(e => console.error('[relatorio]', e.message));
  };
  todo('daily', today);
  if (weekdayBR() === Number(getSetting('report_weekly_day', '1'))) todo('weekly', today);
  if (Number(today.slice(8, 10)) === Number(getSetting('report_monthly_day', '1'))) todo('monthly', monthOf(today));
}
let timer = null;
function startScheduler() { if (!timer) timer = setInterval(() => { try { tick(); } catch (e) { console.error('[relatorio]', e.message); } }, 60 * 1000); }

module.exports = { build, send, startScheduler, tick, KINDS };
