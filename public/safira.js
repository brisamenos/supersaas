// Safira: assistente de voz. Fica ouvindo "Olá, Safira", responde falando e mostra um globo de luz no meio da tela.
(function () {
  'use strict';
  const { icon } = App;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ok */ } } };
  const sstore = { get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* ok */ } } };

  // ---------- preferências (ficam neste aparelho, porque as vozes são do aparelho) ----------
  const prefs = {
    get wake() { return store.get('saf_wake') === '1'; }, set wake(v) { store.set('saf_wake', v ? '1' : '0'); },
    get voice() { return store.get('saf_voice') || ''; }, set voice(v) { store.set('saf_voice', v || ''); },
    get rate() { return Number(store.get('saf_rate')) || 1.02; }, set rate(v) { store.set('saf_rate', String(v)); },
    get pitch() { return Number(store.get('saf_pitch')) || 1.05; }, set pitch(v) { store.set('saf_pitch', String(v)); },
    get name() { const n = store.get('saf_name'); if (n !== null) return n; const u = (App.user && App.user.name || '').trim().split(/\s+/)[0] || ''; return /^(admin|administrador|dono|usu[aá]rio)$/i.test(u) ? '' : u; },
    set name(v) { store.set('saf_name', String(v || '').trim().slice(0, 30)); }
  };

  // ---------- vozes ----------
  const FEM = /maria|francisca|thalita|luciana|fernanda|vit[oó]ria|camila|raquel|joana|helena|leila|brenda|elza|giovanna|let[ií]cia|manuela|yara|\bana\b|catarina|in[eê]s|female|feminin|mulher|google portugu[eê]s do brasil|google português/i;
  const MASC = /daniel|ant[oô]nio|donato|f[aá]bio|humberto|j[uú]lio|nicolau|val[eé]rio|duarte|felipe|male\b|masculin|reed|eddy|rocko|grandpa|jo[aã]o/i;
  function voices() {
    if (!TTS) return [];
    return speechSynthesis.getVoices().filter(v => /^pt/i.test(v.lang)).map(v => {
      const female = FEM.test(v.name) && !/male\b/i.test(v.name.replace(/female/i, '')), male = !female && MASC.test(v.name);
      const natural = /natural|online|neural|premium|enhanced|aprimorad/i.test(v.name), google = /google/i.test(v.name);
      let label = v.name.replace(/^Microsoft\s+/i, '').replace(/\s*Online\s*\(Natural\)/i, '').replace(/\s*-\s*Portuguese.*$/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
      if (google) label = 'Google (padrão do Chrome)';
      return { v, id: v.voiceURI || v.name, label, gender: female ? 'f' : male ? 'm' : '', br: /pt[-_]BR/i.test(v.lang), natural, score: (/pt[-_]BR/i.test(v.lang) ? 100 : 0) + (female ? 50 : 0) + (natural ? 30 : 0) + (google ? 12 : 0) + (v.localService ? 0 : 3) };
    }).sort((a, b) => b.score - a.score);
  }
  function currentVoice() { const vs = voices(); return (vs.find(x => x.id === prefs.voice) || vs[0] || {}).v || null; }
  if (TTS) speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', () => App.safira && App.safira.onVoices && App.safira.onVoices());

  // ---------- texto -> fala natural ----------
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function toSpeech(t) {
    let s = String(t || '');
    s = s.replace(/\*\*|__|`|#+\s/g, '').replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '').replace(/\p{Extended_Pictographic}|️/gu, '');
    s = s.replace(/−\s*R\$/g, 'menos R$');
    s = s.replace(/R\$\s*([\d.]+)(?:,(\d{1,2}))?/g, (_, r, c) => { const reais = Number(r.replace(/\./g, '')); const cent = c ? Number(c.padEnd(2, '0')) : 0; return `${reais} ${reais === 1 ? 'real' : 'reais'}${cent ? ` e ${cent} ${cent === 1 ? 'centavo' : 'centavos'}` : ''}`; });
    s = s.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d, mo, y) => MESES[Number(mo) - 1] ? `${Number(d)} de ${MESES[Number(mo) - 1]} de ${y}` : m);
    s = s.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (m, d, mo) => Number(mo) >= 1 && Number(mo) <= 12 && Number(d) <= 31 ? `${Number(d)} de ${MESES[Number(mo) - 1]}` : m);
    s = s.replace(/\bMRR\b/g, 'receita mensal').replace(/\bARR\b/g, 'receita anual').replace(/\s*[|]\s*/g, ', ').replace(/ — | – /g, ', ').replace(/(\d)%/g, '$1 por cento');
    s = s.split('\n').map(l => l.trim()).filter(Boolean).map(l => /[.!?:]$/.test(l) ? l : l + '.').join(' ');
    return s.replace(/\s+/g, ' ').trim();
  }
  function chunks(s) { // pedaços curtos: o Chrome corta falas longas
    const out = []; let cur = '';
    for (const part of s.split(/(?<=[.!?;])\s+/)) { if ((cur + ' ' + part).length > 170 && cur) { out.push(cur); cur = part; } else cur = cur ? cur + ' ' + part : part; }
    if (cur) out.push(cur); return out;
  }

  let speakToken = 0, speechBlocked = false, voiceBroken = '', keep = [];
  function speak(text, opt = {}) {
    return new Promise(resolve => {
      if (!TTS) return resolve();
      const parts = chunks(toSpeech(text)); if (!parts.length) return resolve();
      const my = ++speakToken; let i = 0, guard = null, startT = null;
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); // cancelar e falar no mesmo instante faz o Chrome engolir a fala
      const done = () => { clearTimeout(guard); clearTimeout(startT); keep = []; resolve(); };
      const say = (txt, useVoice) => {
        const u = new SpeechSynthesisUtterance(txt); keep.push(u); u.lang = 'pt-BR';
        u.rate = opt.rate || prefs.rate; u.pitch = opt.pitch || prefs.pitch;
        const v = useVoice ? (opt.voice || currentVoice()) : null; if (v) { u.voice = v; u.lang = v.lang; }
        let started = false;
        u.onstart = () => { started = true; clearTimeout(startT); orbKick(0.4); };
        u.onboundary = () => orbKick(0.32);
        u.onend = () => { if (started || !useVoice) next(); };
        u.onerror = e => { clearTimeout(startT); if (e && e.error === 'not-allowed') speechBlocked = true; if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; if (!started && useVoice && v) { voiceBroken = v.name; return say(txt, false); } next(); };
        // a voz escolhida não começou a falar: tenta com a voz padrão do navegador
        startT = setTimeout(() => { if (started || my !== speakToken) return; if (useVoice && v) { voiceBroken = v.name; speechSynthesis.cancel(); setTimeout(() => say(txt, false), 80); } else next(); }, 2500);
        clearTimeout(guard); guard = setTimeout(next, 6000 + txt.length * 110); // se o navegador "esquecer" de avisar o fim
        try { speechSynthesis.resume(); } catch (_) { /* ok */ }
        speechSynthesis.speak(u);
      };
      const next = () => {
        clearTimeout(guard); clearTimeout(startT); if (my !== speakToken) return done();
        if (i >= parts.length) return done();
        say(parts[i++], true);
      };
      setTimeout(next, 90);
    });
  }
  function stopSpeaking() { speakToken++; if (TTS) speechSynthesis.cancel(); }

  // ---------- globo ----------
  const orbs = new Set();
  function orbKick(v) { orbs.forEach(o => o.kick(v)); }
  function Orb(cv, mini) {
    const ctx = cv.getContext('2d'); const N = mini ? 650 : 1500; const pts = [];
    for (let i = 0; i < N; i++) { const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963; pts.push([Math.cos(th) * r, y, Math.sin(th) * r, th, Math.asin(y)]); }
    let w = 0, h = 0, raf = 0, last = performance.now(), t = 0, level = 0, kick = 0, hue = 212, spin = 0, state = 'idle', input = null, lastRipple = 0; const ripples = [];
    const HUE = { idle: 212, listening: 196, thinking: 262, speaking: 214 };
    function size() { const dpr = Math.min(window.devicePixelRatio || 1, 2), b = cv.getBoundingClientRect(); w = b.width; h = b.height; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      let dt = Math.min((now - last) / 1000, 0.05); last = now; if (REDUCED) dt *= 0.35; t += dt;
      if (!w) size(); if (!w || !h) return;
      const ext = input ? input() : 0;
      let tg = 0.07 + 0.03 * Math.sin(t * 1.5);
      if (state === 'listening') tg = 0.13 + Math.min(ext * 2.4, 0.75);
      else if (state === 'thinking') tg = 0.24 + 0.07 * Math.sin(t * 6);
      else if (state === 'speaking') tg = 0.3 + 0.22 * Math.abs(Math.sin(t * 7.1) * Math.sin(t * 2.9 + 1)) + kick;
      kick *= Math.pow(0.04, dt); level += (tg - level) * Math.min(1, dt * 9); hue += ((HUE[state] || 212) - hue) * Math.min(1, dt * 2.5);
      spin += dt * (state === 'thinking' ? 1.15 : state === 'speaking' ? 0.45 : 0.22);
      const cx = w / 2, cy = h * (mini ? 0.4 : 0.43), R = Math.min(w, h) * (mini ? 0.2 : 0.165) * (1 + level * 0.1);
      ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter';
      // halo
      let g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 2.8);
      g.addColorStop(0, `hsla(${hue},100%,62%,${0.3 + level * 0.32})`); g.addColorStop(0.35, `hsla(${hue + 28},100%,56%,${0.12 + level * 0.12})`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // ondas que saem enquanto ela fala
      if (state === 'speaking' && !REDUCED && t - lastRipple > 0.26 && level > 0.36) { ripples.push({ r: R * 1.1, a: 0.5, h: hue + Math.random() * 40 - 10 }); lastRipple = t; }
      for (let i = ripples.length - 1; i >= 0; i--) { const rp = ripples[i]; rp.r += R * 1.25 * dt; rp.a *= Math.pow(0.18, dt); if (rp.a < 0.015) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `hsla(${rp.h},100%,66%,${rp.a})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, rp.r, 0, 6.2832); ctx.stroke(); }
      // anéis magnéticos ondulando
      const rings = mini ? 3 : 4;
      for (let k = 0; k < rings; k++) {
        const rad = R * (1.2 + k * 0.14), amp = R * (0.025 + level * 0.17) * (1 - k * 0.16), c = `hsla(${hue + 14 + k * 26},100%,64%,${0.55 - k * 0.1})`;
        ctx.strokeStyle = c; ctx.lineWidth = mini ? 1.1 : 1.6; if (!mini) { ctx.shadowColor = c; ctx.shadowBlur = 14; }
        ctx.beginPath();
        for (let s = 0; s <= 160; s++) { const a = s / 160 * 6.2832; const rr = rad + amp * (Math.sin(a * (3 + k * 2) + t * (1.6 + k * 0.7)) * 0.6 + Math.sin(a * (7 + k) - t * (2.4 + k * 0.5)) * 0.4);
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.98; if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // órbitas inclinadas
      for (let k = 0; k < 2; k++) { ctx.strokeStyle = `hsla(${hue + 40 + k * 50},100%,70%,${0.18 + level * 0.25})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, cy, R * (1.55 + k * 0.12), R * (0.34 + k * 0.08), spin * (k ? -0.6 : 0.4) + k * 1.1, 0, 6.2832); ctx.stroke(); }
      // esfera de partículas
      const cy0 = Math.cos(spin), sy0 = Math.sin(spin), tilt = 0.24 + 0.08 * Math.sin(t * 0.4), cx0 = Math.cos(tilt), sx0 = Math.sin(tilt);
      for (let i = 0; i < N; i++) {
        const p = pts[i]; let x = p[0] * cy0 + p[2] * sy0, z = -p[0] * sy0 + p[2] * cy0, y = p[1];
        const y2 = y * cx0 - z * sx0; z = y * sx0 + z * cx0; y = y2;
        const d = 1 + level * (0.07 * Math.sin(p[4] * 6 - t * 5.2) + 0.045 * Math.sin(p[3] * 4 + t * 3) * Math.cos(p[4]) + 0.025 * Math.sin(t * 13 + p[3] * 9));
        const per = 4.2 / (4.2 - z * d), sx = cx + x * d * R * per, sy = cy + y * d * R * per, dep = (z + 1) / 2;
        const sz = (mini ? 0.8 : 1.05) + dep * (mini ? 1.3 : 1.8) * (1 + level * 0.8);
        ctx.fillStyle = `hsla(${hue + p[4] * 38 + dep * 30},100%,${52 + dep * 30}%,${0.22 + dep * 0.72})`; ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
      // contorno de neon do globo
      ctx.strokeStyle = `hsla(${hue + 10},100%,70%,${0.22 + level * 0.3})`; ctx.lineWidth = mini ? 1 : 1.5; if (!mini) { ctx.shadowColor = `hsla(${hue},100%,65%,.9)`; ctx.shadowBlur = 22; }
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.03 + level * 0.05), 0, 6.2832); ctx.stroke(); ctx.shadowBlur = 0;
      // núcleo
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.7 + level * 0.4));
      g.addColorStop(0, `hsla(${hue - 10},100%,92%,${0.35 + level * 0.4})`); g.addColorStop(0.4, `hsla(${hue},100%,62%,${0.12 + level * 0.2})`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.2, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    const o = {
      start() { if (!raf) { size(); last = performance.now(); raf = requestAnimationFrame(frame); } orbs.add(o); return o; },
      stop() { cancelAnimationFrame(raf); raf = 0; orbs.delete(o); },
      resize: size, setState(s) { state = s; }, kick(v) { kick = Math.min(kick + v, 0.6); }, setInput(fn) { input = fn; }
    };
    return o;
  }
  window.addEventListener('resize', () => orbs.forEach(o => o.resize()));

  // ---------- microfone (só para o globo reagir à sua voz) ----------
  let mic = null;
  async function micOn() {
    if (mic || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize); mic = { stream, ac, read() { an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); } };
    } catch (_) { mic = null; }
  }
  function micOff() { if (!mic) return; try { mic.stream.getTracks().forEach(t => t.stop()); mic.ac.close(); } catch (_) { /* ok */ } mic = null; }

  // ---------- frases ----------
  const pick = (arr, key) => { const lastI = Number(sstore.get(key)); let i; do { i = Math.floor(Math.random() * arr.length); } while (arr.length > 1 && i === lastI); sstore.set(key, String(i)); return arr[i]; };
  function greeting() {
    const n = prefs.name, hNow = new Date().getHours(), part = hNow < 12 ? 'Bom dia' : hNow < 18 ? 'Boa tarde' : 'Boa noite', N = n ? ', ' + n : '';
    return pick([`Olá${N}. Em que posso te ajudar?`, `Oi${N}. Estou ouvindo.`, `Pois não${N}?`, `${part}${N}. O que você quer saber?`, `Estou aqui${N}. Pode perguntar.`, `Oi${N}. Como posso ajudar agora?`, `${part}${N}. Em que posso ser útil?`, `Pode falar${N}, estou ouvindo.`], 'saf_g');
  }
  function goodbye() { const N = prefs.name ? ', ' + prefs.name : ''; return pick([`Por nada${N}. Estou por aqui.`, `Disponha${N}.`, `Quando precisar, é só chamar.`, `Combinado${N}. Até já.`, `Imagina${N}. Qualquer coisa, me chama.`], 'saf_b'); }

  // ---------- normalização e palavra de ativação ----------
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const WAKE = /(?:^|\s)(?:(?:ola|oi|ei|hey|alo|fala|e ai|eae)\s+)?(?:safira|zafira|safyra|saphira|sapphira|safire|sa fira|safila)(?:\s+|$)/;
  const FAREWELL = /^(obrigad[oa]|obrigad[oa] safira|valeu|tchau|ate mais|ate logo|so isso|era so isso|nada|nao|nao obrigado|pode fechar|fechar|encerrar|cancelar|para|pare|chega|ok obrigado|beleza obrigado)$/;

  // ---------- reconhecimento: um só por vez ----------
  let rec = null;
  function killRec() { if (!rec) return; const r = rec; rec = null; r.onresult = r.onerror = r.onend = r.onstart = null; try { r.abort(); } catch (_) { /* ok */ } }
  const canListen = () => !!SR && window.isSecureContext;

  // ---------- estado ----------
  let mode = 'off'; // off | wake | open
  let phase = 'idle'; // dentro da janela: greet | listening | thinking | speaking | idle
  let wakeBackoff = 300, wakeTimer = null, ctxMsgs = [], ctxAt = 0, busy = false;
  try { ctxMsgs = JSON.parse(sstore.get('saf_ctx') || '[]'); } catch (_) { ctxMsgs = []; }
  const saveCtx = () => sstore.set('saf_ctx', JSON.stringify(ctxMsgs.slice(-24)));

  // ---------- ouvir "Olá, Safira" em segundo plano ----------
  function startWake() {
    clearTimeout(wakeTimer);
    if (!prefs.wake || !canListen() || !App.user || mode === 'open' || document.hidden) { if (mode === 'wake') mode = 'off'; paintTop(); return; }
    killRec(); mode = 'wake'; paintTop();
    const r = new SR(); rec = r; r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let pending = null;
    const fire = after => { clearTimeout(pending); if (rec !== r) return; killRec(); wakeBackoff = 300; open(after); };
    r.onstart = () => { wakeBackoff = 300; };
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], txt = norm(res[0].transcript), m = WAKE.exec(txt); if (!m) continue;
        const after = txt.slice(m.index + m[0].length).trim();
        clearTimeout(pending);
        if (res.isFinal) return fire(after);
        pending = setTimeout(() => fire(after), after ? 1400 : 850); // parou de falar depois do nome
      }
    };
    r.onerror = e => {
      if (rec !== r) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { prefs.wake = false; killRec(); mode = 'off'; paintTop(); App.toast('O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.', true); App.safira.onChange && App.safira.onChange(); }
      else if (e.error === 'network') wakeBackoff = 4000;
      else if (e.error === 'audio-capture') { wakeBackoff = 8000; }
    };
    r.onend = () => { if (rec !== r) return; rec = null; if (mode === 'wake') wakeTimer = setTimeout(startWake, wakeBackoff); wakeBackoff = Math.min(wakeBackoff * 1.5, 8000); };
    try { r.start(); } catch (_) { rec = null; wakeTimer = setTimeout(startWake, 1500); }
  }
  function stopWake() { clearTimeout(wakeTimer); if (mode === 'wake') { killRec(); mode = 'off'; } paintTop(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (mode === 'wake') stopWake(); } else if (mode !== 'open') startWake(); });

  // ---------- janela da Safira ----------
  let ov = null, bigOrb = null;
  function build() {
    if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'safira'; ov.className = 'saf'; ov.hidden = true;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Safira, assistente de voz');
    ov.innerHTML = `<canvas class="saf-cv" aria-hidden="true"></canvas>
      <button class="saf-orb-hit" type="button" aria-label="Tocar no globo: falar com a Safira ou interromper"></button>
      <div class="saf-top"><span class="saf-name">Safira</span><button class="saf-x" type="button" aria-label="Fechar a Safira">${icon('x').s}</button></div>
      <div class="saf-cap" aria-live="polite"><p class="saf-state"></p><p class="saf-you"></p><p class="saf-say"></p></div>
      <form class="saf-type" autocomplete="off"><label class="sr" for="safIn">Digitar pergunta para a Safira</label><input id="safIn" maxlength="600" placeholder="Prefere digitar? Escreva aqui"><button type="submit" aria-label="Enviar pergunta">${icon('send').s}</button></form>`;
    document.body.appendChild(ov);
    bigOrb = Orb(ov.querySelector('.saf-cv'), false);
    bigOrb.setInput(() => (mic && phase === 'listening') ? mic.read() : 0);
    ov.querySelector('.saf-x').addEventListener('click', () => close());
    ov.querySelector('.saf-orb-hit').addEventListener('click', () => {
      if (phase === 'speaking' || phase === 'greet') { stopSpeaking(); listen(); }
      else if (phase === 'idle') listen();
    });
    ov.querySelector('.saf-type').addEventListener('submit', e => { e.preventDefault(); const i = ov.querySelector('#safIn'); const q = i.value.trim(); if (!q) return; i.value = ''; killRec(); stopSpeaking(); ask(q, false); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    return ov;
  }
  const STATE_TXT = { greet: 'Safira', listening: 'Ouvindo', thinking: 'Consultando seus sistemas', speaking: 'Safira', idle: 'Toque no globo para falar' };
  function setPhase(p) {
    phase = p; if (!ov) return; bigOrb.setState(p === 'greet' ? 'speaking' : p);
    ov.dataset.phase = p; ov.querySelector('.saf-state').textContent = STATE_TXT[p] || '';
  }
  function caption(you, say) { if (!ov) return; if (you !== undefined) ov.querySelector('.saf-you').textContent = you; if (say !== undefined) ov.querySelector('.saf-say').textContent = say; }

  function open(after) {
    build(); stopWake(); killRec(); mode = 'open'; paintTop();
    if (ov.hidden) { ov.hidden = false; requestAnimationFrame(() => ov.classList.add('on')); bigOrb.start(); caption('', ''); }
    ov.querySelector('.saf-x').focus({ preventScroll: true });
    if (Date.now() - ctxAt > 5 * 60000) { ctxMsgs = []; saveCtx(); }
    if (after && after.split(' ').length >= 2) return ask(after, true);
    greet();
  }
  async function greet() {
    const g = greeting(); setPhase('greet'); caption('', g);
    await speak(g); if (mode !== 'open') return;
    if (speechBlocked) { speechBlocked = false; App.toast('Clique uma vez em qualquer lugar da tela para a Safira poder falar.', true); }
    listen();
  }
  function close() {
    if (!ov || ov.hidden) return; stopSpeaking(); killRec(); micOff(); busy = false;
    ov.classList.remove('on'); setTimeout(() => { if (!ov.classList.contains('on')) { ov.hidden = true; bigOrb.stop(); } }, 260);
    mode = 'off'; phase = 'idle'; setTimeout(startWake, 500);
  }

  function listen() {
    if (mode !== 'open') return;
    if (!canListen()) { setPhase('idle'); caption('', !SR ? 'Este navegador não entende voz. Use o Google Chrome ou o Microsoft Edge. Você pode digitar abaixo.' : 'O microfone só funciona com o endereço em https://. Você pode digitar abaixo.'); return; }
    killRec(); setPhase('listening'); caption('', ''); micOn();
    const r = new SR(); rec = r; r.lang = 'pt-BR'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    let fin = '', interim = '';
    r.onresult = e => { interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fin += x[0].transcript; else interim += x[0].transcript; } caption((fin + interim).trim()); };
    r.onerror = e => {
      if (rec !== r) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { killRec(); setPhase('idle'); caption('', 'O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.'); }
      else if (e.error === 'network') { killRec(); setPhase('idle'); caption('', 'O reconhecimento de voz precisa de internet e não conseguiu conectar.'); }
    };
    r.onend = () => {
      if (rec !== r) return; rec = null;
      const q = (fin || interim).trim();
      if (q) return ask(q, true);
      close(); // silêncio: fecha e volta a esperar "Olá, Safira"
    };
    try { r.start(); } catch (_) { rec = null; setPhase('idle'); }
  }

  async function ask(q, spoken) {
    if (busy) return; busy = true;
    caption(q, ''); const nq = norm(q).replace(/\bsafira\b/g, '').trim();
    if (spoken && FAREWELL.test(nq)) { busy = false; const b = goodbye(); setPhase('speaking'); caption(q, b); await speak(b); return close(); }
    setPhase('thinking');
    ctxMsgs.push({ role: 'user', content: q }); ctxAt = Date.now(); saveCtx();
    let reply, failed = false;
    try {
      const r = await App.post('/assistant', { voice: true, name: prefs.name, messages: ctxMsgs.slice(-16) });
      reply = r.reply; ctxMsgs.push({ role: 'assistant', content: reply, used: r.used }); saveCtx();
    } catch (e) {
      failed = true; ctxMsgs.pop(); saveCtx();
      reply = /ainda não está ligado/.test(e.message) ? 'Ainda não estou ligada. Coloque a chave da API do Claude em Configurações, na parte do assistente.' : e.message;
    }
    busy = false; if (mode !== 'open') return;
    setPhase('speaking'); caption(q, reply);
    await speak(reply); if (mode !== 'open' || phase !== 'speaking') return;
    if (speechBlocked) { speechBlocked = false; App.toast('Clique uma vez em qualquer lugar da tela para a Safira poder falar.', true); }
    if (failed) { setPhase('idle'); return; }
    listen(); // continua a conversa sem precisar chamar de novo
  }

  // ---------- botão no topo ----------
  function paintTop() {
    const b = document.getElementById('safBtn'); if (!b) return;
    b.classList.toggle('waking', mode === 'wake');
    b.title = mode === 'wake' ? 'A Safira está esperando você dizer “Olá, Safira”' : 'Falar com a Safira';
    b.querySelector('span').textContent = mode === 'wake' ? 'Diga “Olá, Safira”' : 'Safira';
  }
  function mountTop() {
    if (document.getElementById('safBtn')) return paintTop();
    const live = document.getElementById('live'); if (!live) return;
    const b = document.createElement('button'); b.id = 'safBtn'; b.className = 'saf-btn'; b.type = 'button';
    b.innerHTML = '<i class="saf-dot" aria-hidden="true"></i><span>Safira</span>';
    b.addEventListener('click', () => open(''));
    live.parentNode.insertBefore(b, live); paintTop();
  }

  App.safira = {
    Orb, voices, currentVoice, prefs, speak, stopSpeaking, toSpeech, greeting, TTS, SR: !!SR, canListen,
    get mode() { return mode; }, get history() { return ctxMsgs.slice(); },
    clearHistory() { ctxMsgs = []; saveCtx(); },
    open: () => open(''), close,
    start() { mountTop(); startWake(); },
    stop() { close(); stopWake(); mode = 'off'; },
    setWake(on) { prefs.wake = on; if (on) startWake(); else stopWake(); },
    test(voiceId, rate, pitch) {
      const v = voices().find(x => x.id === voiceId); voiceBroken = ''; speechBlocked = false;
      return speak(greeting(), { voice: v && v.v, rate, pitch }).then(() => {
        if (speechBlocked) App.toast('O navegador bloqueou o som. Clique uma vez na página e tente de novo.', true);
        else if (voiceBroken) App.toast('A voz “' + (v ? v.label : voiceBroken) + '” não funcionou neste navegador. Usei a voz padrão; escolha outra na lista.', true);
      });
    },
  };
})();
