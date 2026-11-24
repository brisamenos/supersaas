// Base do painel: textos seguros, formatação, chamadas à API, janelas e avisos
(function () {
  'use strict';
  const App = window.App = { views: {}, actions: {}, forms: {}, user: null, token: null, meta: { systems: [] }, cleanup: [] };

  // ---------- html seguro: tudo que entra num ${} é escapado, exceto raw() ----------
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const val = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : (v === null || v === undefined || v === false) ? '' : esc(v);
  const html = (strs, ...vals) => new Raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));
  const raw = s => new Raw(s);
  Object.assign(App, { esc, html, raw, Raw });

  // ---------- formatação ----------
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const F = App.fmt = {
    brl: v => { const n = Number(v) || 0; return (n < 0 ? '−' : '') + 'R$ ' + nf2.format(Math.abs(n)); },
    brl0: v => { const n = Math.round(Number(v) || 0); return (n < 0 ? '−' : '') + 'R$ ' + nf0.format(Math.abs(n)); },
    int: v => nf0.format(Number(v) || 0),
    date: d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; },
    short: d => { if (!d) return ''; const [, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}`; },
    ts(v) { if (!v) return null; let s = String(v); if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s)) s = s.replace(' ', 'T') + 'Z'; const d = new Date(s); return isNaN(d) ? null : d; },
    ago(v) {
      const d = F.ts(v); if (!d) return '—';
      const s = Math.round((Date.now() - d.getTime()) / 1000);
      if (s < 10) return 'agora'; if (s < 60) return `há ${s} s`;
      const m = Math.round(s / 60); if (m < 60) return `há ${m} min`;
      const h = Math.round(m / 60); if (h < 24) return `há ${h} h`;
      const dd = Math.round(h / 24); return dd === 1 ? 'ontem' : `há ${dd} dias`;
    },
    clock: v => { const d = F.ts(v); return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; },
    month: m => { if (!m) return ''; return new Date(m + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); },
    monthShort: m => new Date(m + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
    phone: p => { const n = String(p || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`; if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`; return p || ''; }
  };

  // ---------- ícones (traço simples, 24x24) ----------
  const P = {
    painel: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>', clientes: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.2c1.8.6 3 2.1 3 4.8"/>',
    financeiro: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>', relatorios: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    assistente: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12c2.8-2.4 5.7-2.4 8.5 0s5.7 2.4 8.5 0M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>', marketing: '<path d="M4 14v-4l11-5v14z"/><path d="M15 9.5c1.8.4 3 1.2 3 2.5s-1.2 2.1-3 2.5M7 15l1.2 4.5h2.6L9.8 14.5"/>', sistemas: '<rect x="3" y="4" width="18" height="6" rx="1.8"/><rect x="3" y="14" width="18" height="6" rx="1.8"/><path d="M7 7h.01M7 17h.01"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.01"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pause: '<path d="M9 6v12M15 6v12"/>', play: '<path d="M8 5.5v13l10-6.5z"/>', infinity: '<path d="M7 9c-2.5 0-4 1.4-4 3s1.5 3 4 3c4 0 6-6 10-6 2.5 0 4 1.4 4 3s-1.5 3-4 3c-4 0-6-6-10-6z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>', speaker: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>', moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    logout: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    wifi: '<path d="M3 9a14 14 0 0 1 18 0M6 12.5a9.5 9.5 0 0 1 12 0M9 16a5 5 0 0 1 6 0M12 19.5v.01"/>', trend: '<path d="m3 17 6-6 4 4 8-9M15 6h6v6"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>'
  };
  const icon = (n, cls) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${P[n] || ''}</svg>`);
  App.icon = icon;

  // ---------- distintivos de estado (cor + ícone + texto, nunca só cor) ----------
  App.stateBadge = (state, daysLeft) => {
    const m = { em_dia: ['good', 'check', 'Em dia'], vencendo: ['warn', 'clock', daysLeft === 0 ? 'Vence hoje' : `Vence em ${daysLeft} d`], vencido: ['bad', 'alert', 'Vencido'], suspenso: ['', 'pause', 'Suspenso'], sem_vencimento: ['', 'infinity', 'Sem vencimento'] }[state] || ['', 'check', state];
    return html`<span class="badge ${m[0]}">${icon(m[1])}${m[2]}</span>`;
  };
  App.sysBadge = status => {
    const m = { online: ['good', 'check', 'No ar'], offline: ['bad', 'alert', 'Fora do ar'], desligado: ['', 'pause', 'Desligado'], desconhecido: ['', 'clock', 'Aguardando'] }[status] || ['', 'clock', 'Aguardando'];
    return html`<span class="badge ${m[0]}">${icon(m[1])}${m[2]}</span>`;
  };
  // Cor fixa por tipo de sistema (a cor segue o sistema, nunca a posição)
  const KIND_SLOT = { barbersync: 1, estimafood: 2, motostock: 3, custom: 4 };
  App.sysColor = kind => `var(--s${KIND_SLOT[kind] || 4})`;

  // ---------- API ----------
  App.api = async function (path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { Accept: 'application/json' } };
    if (App.token) init.headers.Authorization = 'Bearer ' + App.token;
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch('/api' + path, init); } catch (e) { throw new Error('Sem conexão com o servidor. Verifique sua internet.'); }
    if (opts.blob && res.ok) return res.blob();
    let data = null; try { data = await res.json(); } catch (_) { /* sem corpo */ }
    if (res.status === 401 && App.token) { App.logout(true); throw new Error((data && data.error) || 'Sua sessão expirou. Entre de novo.'); }
    if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}. Tente de novo.`);
    return data;
  };
  App.get = p => App.api(p); App.post = (p, b) => App.api(p, { method: 'POST', body: b || {} });
  App.put = (p, b) => App.api(p, { method: 'PUT', body: b || {} }); App.del = p => App.api(p, { method: 'DELETE' });

  // ---------- avisos ----------
  App.toast = (msg, err) => {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; if (err) t.setAttribute('role', 'alert');
    document.getElementById('toasts').appendChild(t); setTimeout(() => t.remove(), err ? 7000 : 3800);
  };
  App.fail = e => App.toast(e && e.message ? e.message : String(e), true);

  // ---------- janelas ----------
  const modal = () => document.getElementById('modal'), drawer = () => document.getElementById('drawer');
  function openDlg(dlg, titleEl, bodyEl, title, content) {
    document.getElementById(titleEl).textContent = title; document.getElementById(bodyEl).innerHTML = content.s !== undefined ? content.s : String(content);
    if (!dlg.open) dlg.showModal();
    const f = dlg.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea'); if (f && window.innerWidth > 860) f.focus();
  }
  App.openModal = (title, content, o = {}) => { modal().classList.toggle('wide', !!o.wide); openDlg(modal(), 'modalTitle', 'modalBody', title, content); };
  App.closeModal = () => { if (modal().open) modal().close(); };
  App.openDrawer = (title, content) => openDlg(drawer(), 'drawerTitle', 'drawerBody', title, content);
  App.closeDrawer = () => { if (drawer().open) drawer().close(); };
  App.setDrawerBody = content => { document.getElementById('drawerBody').innerHTML = content.s; };
  // clique no fundo escuro fecha
  ['modal', 'drawer'].forEach(id => document.addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById(id); d.addEventListener('mousedown', e => { if (e.target === d) d.close(); });
  }));

  // Confirmação simples (devolve uma promessa)
  App.confirm = (title, text, okLabel = 'Confirmar', danger = false) => new Promise(resolve => {
    App.openModal(title, html`<p>${text}</p><div class="modal-actions"><button class="btn" data-act="confirm-no">Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${okLabel}</button></div>`);
    const done = v => { App._confirm = null; App.closeModal(); resolve(v); };
    App._confirm = done; modal().addEventListener('close', () => { if (App._confirm) { App._confirm = null; resolve(false); } }, { once: true });
  });
  App.actions['confirm-yes'] = () => App._confirm && App._confirm(true);
  App.actions['confirm-no'] = () => App._confirm && App._confirm(false);
  App.actions['close-modal'] = () => App.closeModal();
  App.actions['close-drawer'] = () => App.closeDrawer();
  App.actions.copy = (d, el) => { navigator.clipboard.writeText(d.text || '').then(() => App.toast('Copiado.'), () => App.toast('Não consegui copiar. Selecione e copie à mão.', true)); };

  // ---------- eventos globais (um ouvinte só) ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const fn = App.actions[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
    Promise.resolve(fn(el.dataset, el, e)).catch(App.fail);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    const fn = App.forms[f.dataset.form]; if (!fn) return;
    const data = Object.fromEntries(new FormData(f).entries());
    f.querySelectorAll('input[type=checkbox]').forEach(c => { data[c.name] = c.checked; });
    const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
    const errEl = f.querySelector('.form-error'); if (errEl) errEl.hidden = true;
    Promise.resolve(fn(data, f)).catch(err => { if (errEl) { errEl.textContent = err.message; errEl.hidden = false; } else App.fail(err); }).finally(() => { if (btn) btn.disabled = false; });
  });

  // Botão que mostra "…" enquanto trabalha
  App.busy = async (el, fn) => { const old = el.innerHTML; el.disabled = true; el.textContent = 'Aguarde…'; try { return await fn(); } finally { el.disabled = false; el.innerHTML = old; } };

  // Campo de seleção de sistema reaproveitado
  App.systemOptions = (selected, withAll) => html`${withAll ? html`<option value="">Todos os sistemas</option>` : ''}${App.meta.systems.map(s => html`<option value="${s.id}" ${String(selected) === String(s.id) ? 'selected' : ''}>${s.name}</option>`)}`;
  App.render = (html_) => { document.getElementById('main').innerHTML = html_.s; };
})();
