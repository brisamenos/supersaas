// Arranque: login, menu, rotas, tempo real (SSE) e tema
(function () {
  'use strict';
  const { html, icon, fmt: F } = App;
  const NAV = [['painel', 'Painel'], ['clientes', 'Clientes'], ['financeiro', 'Financeiro'], ['relatorios', 'Relatórios'], ['marketing', 'Marketing'], ['assistente', 'Safira'], ['sistemas', 'Sistemas'], ['config', 'Configurações']];
  const LIVE_VIEWS = ['painel', 'clientes', 'financeiro', 'sistemas']; // telas sem formulário aberto: podem se atualizar sozinhas
  App.seq = 0; App.current = null; App.lastSync = Date.now();
  const $ = id => document.getElementById(id);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* sem armazenamento */ } }, del(k) { try { localStorage.removeItem(k); } catch (_) { /* ok */ } } };

  // GET que ficou para trás (usuário já trocou de tela) é descartado em silêncio
  const baseApi = App.api;
  App.api = async function (path, opts = {}) {
    const seq = App.seq, isGet = !opts.method || opts.method === 'GET';
    const r = await baseApi(path, opts);
    if (isGet && seq !== App.seq) { const e = new Error('navegou'); e.name = 'AbortNav'; throw e; }
    return r;
  };
  App.fail = e => { if (e && e.name === 'AbortNav') return; App.toast(e && e.message ? e.message : String(e), true); };

  // ---------- menu ----------
  // menu em grupos: o que é o negócio, o que faz crescer, o que mantém tudo rodando
  const GROUPS = [['Negócio', ['painel', 'clientes', 'financeiro', 'relatorios']], ['Crescimento', ['marketing', 'assistente']], ['Operação', ['sistemas', 'config']]];
  function buildNav() {
    const label = Object.fromEntries(NAV);
    $('nav').innerHTML = GROUPS.map(([g, keys]) => `<div class="nav-group"><span class="nav-cap">${g}</span>` + keys.map(k => `<a href="#/${k}" data-tab="${k}">${icon(k).s}<span>${label[k]}</span><span class="count" hidden></span></a>`).join('') + '</div>').join('');
  }
  const today = () => { const t = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Fortaleza' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  App.setBadge = (tab, n) => { const el = document.querySelector(`#nav [data-tab="${tab}"] .count`); if (!el) return; el.hidden = !n; el.textContent = n > 99 ? '99+' : n; el.setAttribute('aria-label', `${n} pendente${n === 1 ? '' : 's'}`); };
  App.go = tab => { if (location.hash === '#/' + tab) App.refresh(); else location.hash = '#/' + tab; };

  async function show(tab) {
    const view = App.views[tab] || App.views.painel; if (!App.views[tab]) tab = 'painel';
    App.seq++; Charts.dispose(); App.cleanup.splice(0).forEach(fn => { try { fn(); } catch (_) { /* ok */ } });
    App.current = tab;
    document.querySelectorAll('#nav a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('pageTitle').textContent = view.title; document.title = view.title + ' • SuperSaaS';
    const sub = $('pageSub'); if (sub) sub.textContent = view.subtitle || today();
    $('main').innerHTML = '<div class="panel panel-pad muted" style="margin-top:12px">Carregando…</div>';
    window.scrollTo(0, 0);
    await runView(view, {});
  }
  async function runView(view, o) {
    try { await view.render(o); markSync(); }
    catch (e) {
      if (e && e.name === 'AbortNav') return;
      if (o.silent) return; // atualização automática que falhou: mantém a tela como está
      $('main').innerHTML = html`<div class="panel empty" style="margin-top:12px"><h3>Não consegui carregar esta tela</h3><p>${e.message}</p><button class="btn btn-primary" data-act="retry">Tentar de novo</button></div>`.s;
    }
  }
  App.refresh = (o = {}) => { const v = App.views[App.current]; return v ? runView(v, o) : null; };
  App.actions.retry = () => show(App.current);

  // ---------- tempo real ----------
  let es = null, esTimer = null, debounce = null;
  function setLive(state) {
    const el = $('live'); el.className = 'live ' + (state === 'on' ? 'on' : 'off');
    el.querySelector('span').textContent = state === 'on' ? 'Ao vivo • ' + (Date.now() - App.lastSync < 8000 ? 'agora' : F.ago(new Date(App.lastSync).toISOString())) : 'Reconectando…';
  }
  function markSync() { App.lastSync = Date.now(); if (es && es.readyState === 1) setLive('on'); }
  function startStream() {
    stopStream();
    es = new EventSource('/api/stream?token=' + encodeURIComponent(App.token));
    es.onopen = () => setLive('on');
    es.onerror = () => setLive('off');
    const onChange = () => { clearTimeout(debounce); debounce = setTimeout(() => { if (LIVE_VIEWS.includes(App.current) && !document.hidden) App.refresh({ silent: true }); else markSync(); }, 700); };
    es.addEventListener('sync', onChange); es.addEventListener('change', onChange);
    esTimer = setInterval(() => { if (es && es.readyState === 1) setLive('on'); }, 5000);
  }
  function stopStream() { if (es) es.close(); es = null; clearInterval(esTimer); clearTimeout(debounce); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && App.token && LIVE_VIEWS.includes(App.current)) App.refresh({ silent: true }); });

  // ---------- tema ----------
  const effectiveDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  function paintTools() {
    document.querySelectorAll('[data-ico]').forEach(e => { if (!e.firstChild) e.innerHTML = icon(e.dataset.ico === 'hard-pulse' ? 'sistemas' : e.dataset.ico).s; });
    const dark = effectiveDark();
    document.querySelectorAll('[data-act=theme]').forEach(b => { b.innerHTML = icon(dark ? 'sun' : 'moon').s; b.title = dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'; });
    document.querySelectorAll('[data-act=logout]').forEach(b => { b.innerHTML = icon('logout').s; });
    document.querySelectorAll('.icon-btn[data-act=close-modal],.icon-btn[data-act=close-drawer]').forEach(b => { b.innerHTML = icon('x').s; });
  }
  App.actions.theme = () => { const next = effectiveDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); store.set('ss_theme', next); paintTools(); if (App.current) App.refresh({ silent: true }); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTools);

  // ---------- login / sessão ----------
  // canto do menu: foto (ou iniciais), nome e e-mail; clicar leva ao "Meu perfil" nas Configurações
  App.paintWho = () => { const user = App.user; if (!user) return;
    $('who').innerHTML = html`<a class="who-link" href="#/config" title="Meu perfil: trocar foto e senha">${App.avatar(user)}<span class="who-txt"><b>${user.name}</b><span>${user.role === 'admin' ? user.email : 'Só visualiza • ' + user.email}</span></span></a>`.s; };
  function enter(user) {
    App.user = user; $('login').hidden = true; $('app').hidden = false;
    document.body.classList.toggle('readonly', user.role !== 'admin');
    App.paintWho();
    buildNav(); paintTools(); startStream(); if (App.safira) App.safira.start();
    const tab = (location.hash.match(/^#\/(\w+)/) || [])[1]; show(App.views[tab] ? tab : 'painel');
  }
  function showLogin(msg) {
    stopStream(); if (App.safira) App.safira.stop(); App.user = null; $('app').hidden = true; $('login').hidden = false; App.closeModal(); App.closeDrawer();
    const e = $('loginError'); if (msg) { e.textContent = msg; e.hidden = false; } else e.hidden = true;
    const f = $('loginForm'); if (f.password) f.password.value = ''; paintTools();
  }
  App.logout = expired => { App.token = null; store.del('ss_token'); showLogin(expired ? 'Sua sessão expirou. Entre de novo.' : ''); };
  App.actions.logout = () => App.logout(false);
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, btn = f.querySelector('[type=submit]'), err = $('loginError'); err.hidden = true; btn.disabled = true;
    try {
      const r = await baseApi('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
      App.token = r.token; store.set('ss_token', r.token); enter(r.user);
    } catch (x) { err.textContent = x.message; err.hidden = false; } finally { btn.disabled = false; }
  });
  window.addEventListener('hashchange', () => { if (App.user) { const tab = (location.hash.match(/^#\/(\w+)/) || [])[1]; show(App.views[tab] ? tab : 'painel'); } });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { /* dialog nativo já fecha */ } });

  (async function boot() {
    paintTools(); App.token = store.get('ss_token');
    if (!App.token) return showLogin();
    try { const r = await baseApi('/me'); if (!r.user) throw new Error(); enter(r.user); } catch (_) { App.token = null; store.del('ss_token'); showLogin(); }
  })();
})();
