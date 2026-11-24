// Painel: o "pulso" de cada sistema, números do dia, evolução e o que merece atenção
(function () {
  'use strict';
  const { html, raw, icon, fmt: F } = App;
  const BEAT_OK = 'M0 17H40L47 17L53 5L61 30L67 11L73 17H150';

  function beat(s) {
    const lat = s.latency_ms || 200, dur = Math.min(4, Math.max(1.4, 1.2 + lat / 500));
    if (s.status === 'online') return html`<svg class="beat ${lat > 1500 ? 'warn' : ''}" viewBox="0 0 150 34" style="--dur:${dur}s" role="img" aria-label="Sistema no ar"><path class="trail" d="${BEAT_OK}" pathLength="300"/><path class="run" d="${BEAT_OK}" pathLength="300"/></svg>`;
    if (s.status === 'offline') return html`<svg class="beat bad" viewBox="0 0 150 34" role="img" aria-label="Sistema fora do ar"><path class="trail" d="M0 17H150" pathLength="300"/></svg>`;
    return html`<svg class="beat off" viewBox="0 0 150 34" role="img" aria-label="Sistema sem sinal"><path class="trail" d="M0 17H150" pathLength="300"/></svg>`;
  }

  function pulseRow(s) {
    const word = s.client_word || 'cliente';
    const detail = s.status === 'offline' ? (s.last_error || 'Sem resposta') : s.last_ok_at ? `Resposta ${F.ago(s.last_ok_at)}${s.latency_ms ? ' • ' + s.latency_ms + ' ms' : ''}` : 'Aguardando primeira leitura';
    return html`<div class="pulse-row">
      <div class="pulse-name">${App.sysTile(s.kind)}<div style="min-width:0"><b>${s.name}</b><small>${F.int(s.clients)} ${word}${s.clients === 1 ? '' : 's'}${s.vencido ? html` • <span style="color:var(--bad)">${s.vencido} vencido${s.vencido === 1 ? '' : 's'}</span>` : ''}</small></div></div>
      <div class="beat-cell">${beat(s)}</div>
      <div class="pulse-state">${App.sysBadge(s.status)}<div class="small muted" style="margin-top:3px;max-width:230px">${detail}</div></div>
      <div class="pulse-cell hide-sm"><b>${F.int(s.active)}</b>em dia</div>
      <div class="pulse-cell hide-sm"><b>${F.int(s.activity_today)}</b>${s.unit} hoje</div>
      <div class="pulse-cell hide-sm hide-md"><b>${F.brl0(s.volume_today)}</b>movimentado hoje</div>
      <div class="pulse-line small muted">${F.int(s.active)} em dia • ${F.int(s.activity_today)} ${s.unit} hoje • ${F.brl0(s.volume_today)}</div>
    </div>`;
  }

  function onboarding() {
    return html`<section class="panel onboard" style="margin-top:12px"><h2>Conecte o primeiro sistema</h2>
      <p class="muted" style="max-width:60ch">A central lê seus sistemas por um conector seguro. Depois de conectado, aparecem aqui os clientes, o dinheiro e o movimento de cada um, em tempo real.</p>
      <ol class="steps" style="margin:18px 0 20px">
        <li><b>Coloque o conector no sistema.</b> Os arquivos estão no zip de cada sistema (BarberSync, MotoStock, EstimaFood).</li>
        <li><b>Crie a variável <span class="code">HUB_TOKEN</span></b> no EasyPanel do sistema com uma senha longa e reconstrua a imagem.</li>
        <li><b>Volte aqui</b> e conecte com o endereço do sistema e esse mesmo token.</li>
      </ol>
      <button class="btn btn-primary" data-act="goto" data-tab="sistemas">${icon('plus')}Conectar sistema</button></section>`;
  }

  // ---------- faixa de comando: o número que importa, a linha da receita e o resto do dia ----------
  function spark(series) {
    const pts = (series || []).map(p => Number(p.mrr) || 0); const W = 320, H = 84;
    if (pts.length < 2) return html`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="spark-line" d="M0 ${H * .55}H${W}"/></svg>`;
    const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1;
    const xy = pts.map((v, i) => [i / (pts.length - 1) * W, H - 8 - (v - min) / rng * (H - 20)]);
    const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const last = xy[xy.length - 1];
    return html`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="spg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <path class="spark-area" d="${line}L${W} ${H}L0 ${H}Z" fill="url(#spg)"/><path class="spark-line" d="${line}"/><circle class="spark-dot" cx="${last[0]}" cy="${last[1]}" r="3.5"/></svg>`;
  }
  function hero(k, series) {
    const pts = (series || []).filter(p => p.mrr !== null && p.mrr !== undefined);
    const delta = pts.length > 1 ? (pts[pts.length - 1].mrr - pts[0].mrr) : null;
    const kpi = (ic, tone, val, label, tab) => html`<button class="hk ${tone}" data-act="goto" data-tab="${tab}"><span class="hk-ico">${icon(ic)}</span><span class="hk-txt"><b>${val}</b><span>${label}</span></span></button>`;
    return html`<section class="hero" aria-label="Resumo do negócio">
      <div class="hero-main">
        <a class="hero-me" href="#/config" title="Meu perfil">${App.avatar(App.user, 'hero')}<span><b>${App.hello(App.user)}</b><span>${App.dayPart()}. Aqui está o seu negócio agora.</span></span></a>
        <div class="hero-label">Receita mensal recorrente</div>
        <div class="hero-value">${F.brl0(k.mrr)}</div>
        <div class="hero-note">${delta !== null && Math.abs(delta) >= 1 ? html`<span class="trend ${delta > 0 ? 'up' : 'down'}">${icon(delta > 0 ? 'up' : 'down')}${delta > 0 ? '+' : ''}${F.brl0(delta)} em ${pts.length} dias</span>` : ''}<span>${F.brl0(k.arr)} por ano • ticket médio ${F.brl0(k.ticket)}</span></div>
      </div>
      <div class="hero-spark">${spark(series)}</div>
      <div class="hero-kpis">
        ${kpi('users', 'good', F.int(k.payers), `em dia de ${F.int(k.clients_total)}`, 'clientes')}
        ${kpi('alert', k.vencido ? 'bad' : '', F.int(k.vencido), k.vencido ? `vencidos • ${F.brl0(k.mrr_risk)}/mês` : 'vencidos', 'financeiro')}
        ${kpi('clock', k.vencendo ? 'warn' : '', F.int(k.vencendo), 'vencem em 7 dias', 'financeiro')}
        ${kpi('bolt', '', F.int(k.activity_today), `movimentos hoje • ${F.brl0(k.volume_today)}`, 'clientes')}
      </div>
      <svg class="hero-pulse" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 26H520l14-18 18 32 16-26 10 12H1200" pathLength="1"/></svg>
    </section>`;
  }

  function alertList(list) {
    if (!list.length) return html`<div class="empty" style="padding:24px 0"><h3>Tudo em ordem</h3>Nenhuma pendência agora. Os avisos aparecem aqui quando algo precisar de você.</div>`;
    const MAX = 3, rest = list.length - MAX; // o painel mostra só as 3 mais importantes; o resto fica no Marketing
    return html`${list.slice(0, MAX).map(i => html`<div class="alert ${i.level}"><span class="ico">${icon(i.icon)}</span><div><h3>${i.title}</h3><p>${i.detail}</p></div>${i.action ? html`<button class="btn btn-sm" data-act="insight-go" data-tab="${i.action.tab}" data-segment="${i.action.segment || ''}">${i.action.label}</button>` : ''}</div>`)}${rest > 0 ? html`<button class="alert-more" data-act="goto" data-tab="marketing">Ver mais ${rest} sugest${rest === 1 ? 'ão' : 'ões'}</button>` : ''}`;
  }

  App.actions.goto = d => App.go(d.tab);
  App.actions['insight-go'] = d => { if (d.segment) App.state.broadcastSegment = d.segment; App.go(d.tab); };

  App.views.painel = {
    title: 'Painel',
    async render() {
      const d = await App.get('/dashboard'); App.meta.systems = d.systems; const k = d.kpis;
      App.setBadge('clientes', k.vencido);
      if (!d.systems.length) { App.render(onboarding()); return; }
      const systemsHtml = d.systems.map(pulseRow);
      App.render(html`
        ${hero(k, d.series)}
        <section class="panel pulse" aria-label="Estado dos sistemas">
          <div class="panel-head" style="padding-bottom:6px"><h2>Seus sistemas</h2><span class="hint">${k.systems_online} de ${k.systems_total} no ar • conferidos a cada 30 s</span></div>
          ${systemsHtml}
        </section>
        <div class="grid g2">
          <div class="stack">
          <section class="panel"><div class="panel-head"><h2>Receita mensal</h2><span class="hint">últimos 30 dias, soma dos sistemas</span></div><div class="panel-body"><div id="chMrr"></div></div></section>
          <section class="panel"><div class="panel-head"><h2>Quem mais movimenta</h2><span class="hint">no mês, em reais</span></div><div class="panel-body"><div id="chTop"></div></div></section>
          </div>
          <section class="panel"><div class="panel-head"><h2>Precisa de atenção</h2><button class="linkish" data-act="goto" data-tab="marketing">Ver todas as estratégias</button></div><div class="panel-body">${alertList(d.insights)}</div></section>
        </div>
        <div class="grid g2e">
          <section class="panel"><div class="panel-head"><h2>Acontecendo agora</h2><span class="hint">último movimento</span></div><div class="panel-body">
            ${d.live.length ? html`<ul class="feed">${d.live.map(c => html`<li><span class="dot" style="background:${App.sysColor(c.system_kind)}"></span><span class="feed-main"><b>${c.name}</b><span class="sys">${c.system_name}</span></span><time>${F.ago(c.last_activity)}</time></li>`)}</ul>` : html`<p class="muted small">Quando seus clientes começarem a usar os sistemas, o movimento aparece aqui.</p>`}
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Últimas ações</h2><span class="hint">equipe e Safira</span></div><div class="panel-body">
            ${d.audit.length ? html`<ul class="feed">${d.audit.map(a => html`<li><span class="feed-main"><b>${a.action}</b><span class="sys">${a.detail || ''}</span></span><time>${F.ago(a.ts)}</time></li>`)}</ul>` : html`<p class="muted small">Ainda não há ações registradas.</p>`}
          </div></section>
        </div>
        <section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Quedas e voltas dos sistemas</h2><span class="hint">histórico de disponibilidade</span></div><div class="panel-body">
          ${d.events.length ? html`<ul class="feed">${d.events.map(e => html`<li>${App.sysBadge(e.type === 'down' ? 'offline' : 'online')}<span class="feed-main"><b>${e.system_name}</b><span class="sys">${e.message || ''}</span></span><time>${F.ago(e.ts)}</time></li>`)}</ul>` : html`<p class="muted small">${icon('shield')} Nenhuma queda registrada. Se um sistema sair do ar, você recebe um aviso no WhatsApp.</p>`}
        </div></section>
        </div>`);
      Charts.line(document.getElementById('chMrr'), { label: 'Evolução da receita mensal', series: [{ name: 'Receita mensal (MRR)', color: 'var(--s1)', points: d.series.map(s => ({ x: s.day, y: s.mrr })) }] });
      Charts.hbars(document.getElementById('chTop'), d.top.map(c => ({ label: `${c.name}`, value: c.volume_month, text: F.brl0(c.volume_month), color: 'var(--s1)' })), { empty: 'Ainda não há movimento neste mês.' });
    }
  };
})();
