// WuzAPI (WhatsApp): lista de instancias, escolha da instancia que envia os relatorios e envio de texto.
// A URL e o token de admin ficam salvos no painel (Configuracoes); WUZAPI_URL / WUZAPI_ADMIN_TOKEN servem de padrao.
const { db, getSetting, setSetting } = require('./db');
const { phone55, sleep } = require('./util');

function cfg() {
  return {
    url: String(getSetting('wuzapi_url') || process.env.WUZAPI_URL || '').replace(/\/$/, '').replace(/\/api$/, ''),
    admin: getSetting('wuzapi_admin_token') || process.env.WUZAPI_ADMIN_TOKEN || '',
    token: getSetting('wuzapi_instance_token') || '',
    name: getSetting('wuzapi_instance_name') || ''
  };
}
const ready = () => { const c = cfg(); return !!(c.url && c.token); };

async function wz(path, { method = 'GET', body, token, admin = false } = {}) {
  const c = cfg();
  if (!c.url) throw new Error('Informe o endereço da WuzAPI em Configurações.');
  const headers = { 'Content-Type': 'application/json' };
  if (admin) { if (!c.admin) throw new Error('Informe o token de administrador da WuzAPI em Configurações.'); headers.Authorization = c.admin; } else headers.token = token;
  const res = await fetch(c.url + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
    .catch(e => { throw new Error(e.name === 'TimeoutError' ? 'A WuzAPI demorou demais para responder.' : `Não consegui acessar a WuzAPI (${e.message}).`); });
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok || (data && data.success === false)) throw new Error(String((data && (data.error || data.message)) || `A WuzAPI retornou ${res.status}.`));
  return data && Object.prototype.hasOwnProperty.call(data, 'data') ? data.data : data;
}

async function listInstances() {
  const list = await wz('/admin/users', { admin: true });
  const selected = cfg().token;
  return (Array.isArray(list) ? list : []).map(u => ({
    id: String(u.id || u.Id || ''), name: u.name || u.Name || '(sem nome)',
    connected: !!(u.connected ?? u.Connected), logged_in: !!(u.loggedIn ?? u.LoggedIn),
    phone: String(u.jid || u.Jid || '').split('@')[0].split(':')[0] || null,
    selected: !!selected && selected === (u.token || u.Token)
  }));
}
async function chooseInstance(id) {
  const list = await wz('/admin/users', { admin: true });
  const u = (Array.isArray(list) ? list : []).find(x => String(x.id || x.Id) === String(id));
  if (!u) throw new Error('Instância não encontrada na WuzAPI.');
  setSetting('wuzapi_instance_token', u.token || u.Token || ''); setSetting('wuzapi_instance_name', u.name || u.Name || '');
  return { name: u.name || u.Name, connected: !!(u.connected ?? u.Connected), logged_in: !!(u.loggedIn ?? u.LoggedIn) };
}

// Envia texto e guarda no historico. Nunca lanca erro: devolve { ok, error }.
async function sendText(phone, text, { kind = 'mensagem', name = null } = {}) {
  const c = cfg(); const number0 = phone55(phone);
  const log = (ok, error) => { try { db.prepare('INSERT INTO message_log (kind, to_phone, to_name, text, ok, error) VALUES (?,?,?,?,?,?)').run(kind, number0 || String(phone || ''), name, String(text).slice(0, 4000), ok ? 1 : 0, error || null); } catch (_) { /* historico e opcional */ } };
  try {
    if (!c.url || !c.token) throw new Error('WhatsApp não configurado (escolha a instância em Configurações).');
    if (!number0) throw new Error('Telefone inválido.');
    let number = number0;
    try { // confere o numero real (ex.: celular com o 9 a mais)
      const r = await wz('/user/check', { method: 'POST', token: c.token, body: { Phone: [number] } });
      const found = ((r && r.Users) || []).find(u => u.IsInWhatsapp && u.JID);
      if (found) number = String(found.JID).split('@')[0].split(':')[0] || number;
    } catch (_) { /* segue com o numero informado */ }
    await wz('/chat/send/text', { method: 'POST', token: c.token, body: { Phone: number, Body: String(text) } });
    log(true); return { ok: true };
  } catch (e) { log(false, e.message); return { ok: false, error: e.message }; }
}

// Para os donos (relatorios e alertas): manda para todos os numeros cadastrados
const ownerPhones = () => { try { return JSON.parse(getSetting('owner_phones') || '[]').map(phone55).filter(Boolean); } catch { return []; } };
async function notifyOwners(text, kind = 'alerta') {
  const phones = ownerPhones(); if (!phones.length) return { ok: false, error: 'Nenhum WhatsApp de dono cadastrado em Configurações.' };
  let okCount = 0, err = null;
  for (const p of phones) { const r = await sendText(p, text, { kind, name: 'Dono' }); if (r.ok) okCount++; else err = r.error; if (phones.length > 1) await sleep(1500); }
  return okCount ? { ok: true, sent: okCount } : { ok: false, error: err };
}

module.exports = { cfg, ready, listInstances, chooseInstance, sendText, notifyOwners, ownerPhones };
