// Nomes parecidos: o reconhecimento de voz erra ("assaí do lipe" em vez de "ACAI do Lipe").
// Comparamos pelo som em português, sem acentos e sem maiúsculas, e pegamos o mais parecido.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'the', 'loja', 'cliente']);

// chave "pelo som": ç/ss/s/z/c(e,i) viram s; ch/sh/x viram x; qu/k/c viram k; lh/nh; h mudo; letras dobradas
function phon(s) {
  let t = String(s || '').toLowerCase().replace(/ç/g, 's').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ');
  t = t.replace(/ph/g, 'f').replace(/[wy]/g, m => m === 'w' ? 'v' : 'i').replace(/ch|sh/g, 'x').replace(/lh/g, 'li').replace(/nh/g, 'ni')
    .replace(/qu(?=[ei])/g, 'k').replace(/qu/g, 'kw').replace(/c(?=[ei])/g, 's').replace(/c/g, 'k').replace(/sc(?=[ei])/g, 's').replace(/ss/g, 's')
    .replace(/(?<=[aeiou])s(?=[aeiou])/g, 'z').replace(/\bh/g, '').replace(/(?<![csnl])h/g, '').replace(/(.)\1+/g, '$1');
  // "assaí" ~ "açaí" ~ "acai": s/z/k entre vogais se confundem na fala; deixa tudo como s
  t = t.replace(/(?<=[aeiou])[zk](?=[aeiou])/g, 's');
  return t.replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
const ratio = (a, b) => { const m = Math.max(a.length, b.length); return m ? 1 - lev(a, b) / m : 1; };
const words = s => s.split(' ').filter(w => w && !STOP.has(w));

// 0 a 1: quão parecido o que foi dito é com o nome cadastrado
function score(query, name) {
  const qn = norm(query), nn = norm(name); if (!qn || !nn) return 0;
  if (qn === nn) return 1;
  const qp = phon(query), np = phon(name);
  let best = Math.max(ratio(qn, nn), ratio(qp, np));
  if (nn.includes(qn) || np.includes(qp)) best = Math.max(best, 0.9);
  // palavra por palavra (ordem e palavras extras importam menos)
  const qw = words(qp), nw = words(np);
  if (qw.length && nw.length) {
    const per = qw.map(w => Math.max(...nw.map(x => ratio(w, x)))); const avg = per.reduce((a, b) => a + b, 0) / per.length;
    const cover = nw.filter(x => qw.some(w => ratio(w, x) >= 0.75)).length / nw.length;
    best = Math.max(best, avg * 0.8 + cover * 0.2);
  }
  return Math.round(best * 1000) / 1000;
}
// melhores candidatos, do mais parecido para o menos
function rank(query, items, nameOf, min = 0.6) {
  return items.map(it => ({ it, s: score(query, nameOf(it)) })).filter(x => x.s >= min).sort((a, b) => b.s - a.s);
}
// decide: um vencedor claro, ou uma lista para perguntar "você quis dizer…?"
function pick(query, items, nameOf) {
  const r = rank(query, items, nameOf);
  if (!r.length) return { none: true };
  if (r[0].s >= 0.72 && (r.length === 1 || r[0].s - r[1].s >= 0.08)) return { one: r[0].it, score: r[0].s };
  return { many: r.slice(0, 5).map(x => x.it) };
}

module.exports = { norm, phon, score, rank, pick };
