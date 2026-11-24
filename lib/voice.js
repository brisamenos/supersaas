// Voz da Safira pela OpenAI: transforma o texto da resposta em áudio (mp3) com a chave guardada no servidor.
// Atenção: a OpenAI avisou que gpt-4o-mini-tts / tts-1 serão desligados em 06/01/2027.
// Quando sair o substituto, basta trocar o modelo na variável TTS_MODEL (ou aqui no padrão).
const { getSetting } = require('./db');

const VOICES = [
  { id: 'marin', label: 'Marin', gender: 'f', note: 'feminina, a mais natural' },
  { id: 'coral', label: 'Coral', gender: 'f', note: 'feminina, calorosa' },
  { id: 'nova', label: 'Nova', gender: 'f', note: 'feminina, jovem e clara' },
  { id: 'shimmer', label: 'Shimmer', gender: 'f', note: 'feminina, suave' },
  { id: 'sage', label: 'Sage', gender: 'f', note: 'feminina, calma' },
  { id: 'alloy', label: 'Alloy', gender: '', note: 'neutra' },
  { id: 'cedar', label: 'Cedar', gender: 'm', note: 'masculina, a mais natural' },
  { id: 'ash', label: 'Ash', gender: 'm', note: 'masculina' },
  { id: 'ballad', label: 'Ballad', gender: 'm', note: 'masculina, suave' },
  { id: 'echo', label: 'Echo', gender: 'm', note: 'masculina' },
  { id: 'verse', label: 'Verse', gender: 'm', note: 'masculina, expressiva' },
  { id: 'onyx', label: 'Onyx', gender: 'm', note: 'masculina, grave' },
  { id: 'fable', label: 'Fable', gender: 'm', note: 'masculina' }
];
const STYLE = 'Fale em português do Brasil, com sotaque brasileiro natural. Tom de assistente pessoal profissional: calorosa, segura e simpática, em ritmo de conversa, sem pressa. Leia números e valores em reais de forma natural.';

function cfg() {
  return {
    key: getSetting('openai_key', '') || process.env.OPENAI_API_KEY || '',
    model: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
    base: (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '')
  };
}
const ready = () => !!cfg().key;

// cache pequeno: cumprimentos e frases repetidas não custam de novo
const cache = new Map(); const CACHE_MAX = 60;
const hits = new Map();
function allowed(uid) { const now = Date.now(), arr = (hits.get(uid) || []).filter(t => now - t < 60000); if (arr.length >= 60) return false; arr.push(now); hits.set(uid, arr); return true; }

async function speech(text, voice, user) {
  const c = cfg(); if (!c.key) { const e = new Error('A voz premium não está ligada. Coloque a chave da OpenAI em Configurações.'); e.code = 'no_key'; throw e; }
  const input = String(text || '').trim().slice(0, 1200); if (!input) throw new Error('Texto vazio.');
  const v = VOICES.some(x => x.id === voice) ? voice : 'marin';
  if (user && !allowed(user.sub || user.id || user.email)) throw new Error('Muitas falas em pouco tempo. Aguarde um instante.');
  const key = v + '|' + input; if (cache.has(key)) { const b = cache.get(key); cache.delete(key); cache.set(key, b); return b; }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
  let r;
  try {
    r = await fetch(c.base + '/v1/audio/speech', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.model, voice: v, input, instructions: /tts-1/.test(c.model) ? undefined : STYLE, response_format: 'mp3' }) });
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'A OpenAI demorou demais para gerar a voz.' : 'Não consegui falar com a OpenAI. Confira a internet do servidor.'); }
  finally { clearTimeout(t); }
  if (!r.ok) {
    let body = ''; try { body = await r.text(); } catch (_) { /* ok */ }
    if (r.status === 401) throw new Error('A chave da OpenAI foi recusada. Confira se copiou a chave inteira.');
    if (r.status === 429) throw new Error(/quota|billing|credit/i.test(body) ? 'Acabou o crédito da OpenAI. Coloque saldo em platform.openai.com.' : 'A OpenAI pediu para esperar um pouco (muitas falas seguidas).');
    if (r.status === 404 || /model/i.test(body)) throw new Error('O modelo de voz da OpenAI não está disponível (' + c.model + ').');
    throw new Error('A OpenAI não gerou a voz agora (erro ' + r.status + ').');
  }
  const buf = Buffer.from(await r.arrayBuffer());
  cache.set(key, buf); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return buf;
}

module.exports = { VOICES, cfg, ready, speech };
