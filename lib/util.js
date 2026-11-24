// Utilidades: datas no fuso de Brasilia, dinheiro, telefones, senhas
const crypto = require('crypto');
const TZ = process.env.TZ || 'America/Sao_Paulo';

const todayBR = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const hourBR = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24;
const minuteBR = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, minute: '2-digit' }).format(new Date()));
const weekdayBR = () => new Date(Date.parse(todayBR() + 'T12:00:00Z')).getUTCDay(); // 0 = domingo
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const monthOf = d => String(d).slice(0, 7);
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (m - 1) + n, ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const fmtDate = d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = v => Math.round((Number(v) || 0) * 100) / 100;

// Telefone: so digitos, com 55 na frente (DDD + numero)
function phone55(v) {
  const n = String(v || '').replace(/\D/g, '');
  if (n.length === 10 || n.length === 11) return '55' + n;
  if (n.startsWith('55') && (n.length === 12 || n.length === 13)) return n;
  return null;
}
// Senha legivel (sem 0/O/1/l/I) para entregar ao cliente
function randomPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = ''; const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { TZ, todayBR, hourBR, minuteBR, weekdayBR, addDays, daysBetween, monthOf, addMonths, fmtDate, brl, round2, phone55, randomPassword, sleep };
