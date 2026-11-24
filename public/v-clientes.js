// Clientes de todos os sistemas: lista única, renovar, suspender, trocar senha, mandar mensagem e criar acessos
(function () {
  'use strict';
  const { html, raw, icon, fmt: F } = App;
  const S = App.state = App.state || {};
  const f = S.clientFilter = { system_id: '', state: '', q: '' };
  let list = [], cur = null, timer;

  const STATES = [['', 'Todos', 'todos'], ['em_dia', 'Em dia', 'em_dia'], ['vencendo', 'Vencendo', 'vencendo'], ['vencido', 'Vencidos', 'vencido'], ['suspenso', 'Suspensos', 'suspenso']];

  function row(c) {
    return html`<div class="lrow cl click" data-act="client-open" data-sys="${c.system_id}" data-ext="${c.ext_id}" role="button" tabindex="0" aria-label="Abrir ${c.name}">
      <div class="main-cell"><b>${c.name}</b><small>${c.email || F.phone(c.phone) || 'sem contato'}</small></div>
      <div class="c-sys row" style="gap:8px;flex-wrap:nowrap">${App.sysTile(c.system_kind, 'xs')}<span class="small">${c.system_name}</span></div>
      <div class="c-hide">${c.price ? F.brl(c.price) : html`<span class="muted">—</span>`}<small class="muted" style="display:block">${c.plan || ''}</small></div>
      <div>${App.stateBadge(c.state, c.days_left)}<small class="muted" style="display:block;margin-top:2px">${c.expires_at ? 'até ' + F.date(c.expires_at) : ''}</small></div>
      <div class="c-hide small"><b style="font-weight:600">${F.int(c.activity_month)}</b> ${c.unit}<small class="muted" style="display:block">${c.last_activity ? 'visto ' + F.ago(c.last_activity) : 'sem movimento'}</small></div>
      <div class="c-hide right"><span class="btn btn-sm" aria-hidden="true">Abrir</span></div>
    </div>`;
  }

  async function load() {
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const d = await App.get('/clients?' + qs);
    list = d.clients; App.setBadge('clientes', d.counts.vencido);
    const chips = document.getElementById('clChips'); if (!chips) return;
    chips.innerHTML = STATES.map(([v, l, k]) => `<button class="chip" data-act="client-state" data-v="${v}" aria-pressed="${f.state === v}">${l} <b>${d.counts[k]}</b></button>`).join('');
    document.getElementById('clList').innerHTML = (list.length ? html`<div class="lrow cl head"><span>Cliente</span><span>Sistema</span><span>Mensalidade</span><span>Situação</span><span>Uso no mês</span><span></span></div>${list.map(row)}` :
      html`<div class="empty"><h3>${App.meta.systems.length ? 'Nenhum cliente encontrado' : 'Nenhum sistema conectado'}</h3>${App.meta.systems.length ? 'Tente outro filtro ou crie um acesso novo.' : 'Conecte um sistema para ver os clientes aqui.'}</div>`).s;
  }

  App.views.clientes = {
    title: 'Clientes',
    async render(o = {}) {
      if (!o.silent || !document.getElementById('clList')) {
        if (!App.meta.systems.length) { try { App.meta.systems = (await App.get('/systems')).systems; } catch (_) { /* segue sem lista */ } }
        App.render(html`
          <div class="row between" style="margin:6px 0 16px">
            <div id="clChips" class="chips" role="group" aria-label="Filtrar por situação"></div>
            <button class="btn btn-primary admin-only" data-act="client-new">${icon('plus')}Novo acesso</button>
          </div>
          <div class="row" style="margin-bottom:14px">
            <label class="search"><span class="sr" style="position:absolute;left:-999px">Buscar cliente</span>${icon('search')}<input id="clQ" type="search" placeholder="Buscar por nome, e-mail ou telefone" value="${f.q}"></label>
            <select id="clSys" aria-label="Filtrar por sistema" style="width:auto;min-width:200px">${App.systemOptions(f.system_id, true)}</select>
          </div>
          <section class="panel" style="padding-bottom:6px"><div id="clList" class="list"></div></section>`);
        document.getElementById('clQ').addEventListener('input', e => { f.q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(() => load().catch(App.fail), 250); });
        document.getElementById('clSys').addEventListener('change', e => { f.system_id = e.target.value; load().catch(App.fail); });
        document.getElementById('clList').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.act === 'client-open') { e.preventDefault(); e.target.click(); } });
      }
      await load();
      if (!o.silent && cur && document.getElementById('drawer').open) reloadCur(); // mantém a ficha aberta atualizada
    }
  };

  App.actions['client-state'] = d => { f.state = d.v; load().catch(App.fail); };

  // ---------- ficha do cliente ----------
  const find = () => cur;
  async function reloadCur() { // busca de novo (sem filtros) e redesenha a ficha
    if (!cur) return; const d = await App.get('/clients'); const n = d.clients.find(c => c.system_id === cur.system_id && String(c.ext_id) === String(cur.ext_id));
    if (!n) { App.closeDrawer(); return; } cur = n; fillDrawer();
  }
  App.actions['client-open'] = d => { cur = list.find(c => c.system_id === Number(d.sys) && String(c.ext_id) === String(d.ext)); if (!cur) return; App.openDrawer('', html``); fillDrawer(); };
  App.openClientById = async (sys, ext) => { // usado pelo Financeiro e Marketing
    const d = await App.get('/clients'); cur = d.clients.find(c => c.system_id === Number(sys) && String(c.ext_id) === String(ext));
    if (!cur) return App.toast('Cliente não encontrado.', true); App.openDrawer('', html``); fillDrawer();
  };
  const afterAction = async () => { await reloadCur(); App.refresh({ silent: true }); };
  function fillDrawer() {
    const c = find(); if (!c) { App.closeDrawer(); return; }
    document.getElementById('drawerTitle').textContent = c.name;
    const hasPhone = !!String(c.phone || '').replace(/\D/g, '');
    App.setDrawerBody(html`
      <div class="row" style="margin-bottom:6px">${App.stateBadge(c.state, c.days_left)}<span class="small muted">${c.system_name}</span></div>
      <dl class="facts">
        <dt>Mensalidade</dt><dd>${c.price ? F.brl(c.price) : '—'}${c.plan ? ' • ' + c.plan : ''} <button class="linkish admin-only" data-act="client-price">Alterar</button></dd>
        <dt>Vencimento</dt><dd>${c.expires_at ? F.date(c.expires_at) : 'sem data'}</dd>
        <dt>WhatsApp</dt><dd>${F.phone(c.phone) || '—'}</dd>
        <dt>E-mail (login)</dt><dd>${c.email || '—'}</dd>
        <dt>Cliente desde</dt><dd>${F.date(String(c.created_at || '').slice(0, 10))}</dd>
        <dt>Uso hoje</dt><dd>${F.int(c.activity_today)} ${c.unit} • ${F.brl(c.volume_today)}</dd>
        <dt>Uso no mês</dt><dd>${F.int(c.activity_month)} ${c.unit} • ${F.brl(c.volume_month)}</dd>
        <dt>Último movimento</dt><dd>${c.last_activity ? F.ago(c.last_activity) : '—'}</dd>
        ${c.also_in.length ? html`<dt>Também usa</dt><dd>${c.also_in.join(', ')}</dd>` : ''}
      </dl>
      <div class="row"><a class="btn btn-sm" href="${c.login_url}" target="_blank" rel="noopener">${icon('ext')}Abrir o sistema</a></div>
      <div class="admin-only">
        <div class="sec"><h3>Renovar mensalidade</h3>
          <form data-form="client-renew">
            <input type="hidden" name="sys" value="${c.system_id}"><input type="hidden" name="ext" value="${c.ext_id}">
            <div class="fields-2">
              <label class="field"><span>Período</span><select name="months"><option value="1">1 mês</option><option value="2">2 meses</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option></select></label>
              <label class="field"><span>Valor recebido (R$)</span><input name="amount" inputmode="decimal" value="${c.price ? c.price.toFixed(2).replace('.', ',') : ''}" placeholder="0,00"></label>
            </div>
            <label class="check"><input type="checkbox" name="record" checked> Lançar no financeiro</label>
            <label class="check"><input type="checkbox" name="notify" ${hasPhone ? 'checked' : 'disabled'}> Avisar o cliente no WhatsApp${hasPhone ? '' : ' (sem telefone)'}</label>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn-primary" type="submit">${icon('check')}Renovar agora</button>
          </form></div>
        <div class="sec"><h3>Outras ações</h3><div class="row">
          <button class="btn btn-sm" data-act="client-toggle">${icon(c.active ? 'pause' : 'play')}${c.active ? 'Suspender acesso' : 'Reativar acesso'}</button>
          <button class="btn btn-sm" data-act="client-pass">${icon('key')}Nova senha</button>
          <button class="btn btn-sm" data-act="client-msg" ${hasPhone ? '' : 'disabled'}>${icon('send')}Enviar mensagem</button>
        </div></div>
      </div>`);
  }

  const parseMoney = v => { const n = Number(String(v || '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  App.parseMoney = parseMoney;
  const cPath = c => `/clients/${c.system_id}/${encodeURIComponent(c.ext_id)}`;

  App.forms['client-renew'] = async (d) => {
    const c = find(); const r = await App.post(cPath(c) + '/renew', { months: Number(d.months), amount: parseMoney(d.amount), record: d.record, notify: d.notify });
    App.toast(`Renovado até ${F.date(r.expires_at)}.` + (r.whatsapp && !r.whatsapp.ok ? ' Mas o WhatsApp não saiu: ' + r.whatsapp.error : ''), r.whatsapp && !r.whatsapp.ok);
    await afterAction();
  };
  App.actions['client-toggle'] = async () => {
    const c = find(); const ok = await App.confirm(c.active ? 'Suspender o acesso?' : 'Reativar o acesso?', c.active ? `${c.name} não conseguirá entrar no ${c.system_name} até você reativar.` : `${c.name} volta a poder entrar no ${c.system_name}.`, c.active ? 'Suspender' : 'Reativar', c.active);
    if (!ok) return; await App.post(cPath(c) + '/status', { active: !c.active }); App.toast(c.active ? 'Acesso suspenso.' : 'Acesso reativado.'); await afterAction();
  };
  App.actions['client-pass'] = () => {
    const c = find(); const hasPhone = !!String(c.phone || '').replace(/\D/g, '');
    App.openModal('Nova senha', html`<p class="muted">Deixe em branco para criar uma senha segura automaticamente.</p>
      <form data-form="client-pass"><label class="field"><span>Senha nova (opcional)</span><input name="password" minlength="6" autocomplete="off" placeholder="mínimo de 6 caracteres"></label>
      <label class="check"><input type="checkbox" name="send" ${hasPhone ? 'checked' : 'disabled'}> Enviar o acesso por WhatsApp${hasPhone ? '' : ' (sem telefone)'}</label>
      <p class="form-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Trocar senha</button></div></form>`);
  };
  App.forms['client-pass'] = async d => {
    const c = find(); const r = await App.post(cPath(c) + '/password', { password: d.password || undefined, send: d.send });
    showCreds('Senha trocada', { name: c.name, login_url: c.login_url, email: c.email, password: r.password, whatsapp: r.whatsapp });
  };
  App.actions['client-price'] = () => {
    const c = find();
    App.openModal('Alterar mensalidade', html`<p class="muted">${c.name} • ${c.system_name}. O novo valor vale para as próximas renovações e para as contas da central.</p>
      <form data-form="client-price"><label class="field"><span>Mensalidade (R$)</span><input name="price" inputmode="decimal" required value="${c.price ? c.price.toFixed(2).replace('.', ',') : ''}" placeholder="0,00"></label>
      <p class="form-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Salvar</button></div></form>`);
  };
  App.forms['client-price'] = async d => { const r = await App.post(cPath(find()) + '/price', { price: parseMoney(d.price) }); App.closeModal(); App.toast('Mensalidade agora é ' + F.brl(r.price) + '.'); await afterAction(); };
  App.actions['client-msg'] = () => {
    const c = find();
    App.openModal('Mensagem no WhatsApp', html`<p class="muted">Para ${c.name} (${F.phone(c.phone)}). Você pode usar {nome}, {sistema}, {valor}, {vencimento} e {dias}.</p>
      <form data-form="client-msg"><label class="field"><span>Mensagem</span><textarea name="text" required minlength="3" placeholder="Olá, {nome}! …"></textarea></label>
      <p class="form-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">${icon('send')}Enviar</button></div></form>`);
  };
  App.forms['client-msg'] = async d => { await App.post(cPath(find()) + '/message', { text: d.text }); App.closeModal(); App.toast('Mensagem enviada.'); };

  // ---------- criar acesso ----------
  function showCreds(title, r, extra) {
    const wa = r.whatsapp ? (r.whatsapp.ok ? html`<p class="badge good" style="margin:0">${icon('check')}Enviado por WhatsApp</p>` : html`<p class="form-error">O WhatsApp não saiu: ${r.whatsapp.error}</p>`) : '';
    App.openModal(title, html`<p>Entregue estes dados ao cliente. <b>A senha só aparece agora</b>; depois só dá para trocar.</p>
      <div class="cred"><div><span>Link de acesso</span><b>${r.login_url}</b></div><div><span>E-mail</span><b>${r.email || ''}</b></div><div><span>Senha</span><b>${r.password}</b></div>${r.expires_at ? html`<div><span>Vence em</span><b>${F.date(r.expires_at)}</b></div>` : ''}</div>
      ${wa}
      <div class="modal-actions"><button class="btn" data-act="copy" data-text="${`Acesso ao sistema\nLink: ${r.login_url}\nE-mail: ${r.email || ''}\nSenha: ${r.password}`}">${icon('copy')}Copiar dados</button><button class="btn btn-primary" data-act="close-modal">Pronto</button></div>`);
  }
  App.actions['client-new'] = () => {
    if (!App.meta.systems.length) return App.toast('Conecte um sistema antes de criar acessos.', true);
    App.openModal('Novo acesso', html`<p class="muted">Cria o cliente direto no sistema escolhido, já com login funcionando.</p>
      <form data-form="client-new">
        <label class="field"><span>Sistema</span><select name="system_id" required>${App.systemOptions(f.system_id)}</select></label>
        <label class="field"><span>Nome do cliente ou do negócio</span><input name="name" required minlength="2" autocomplete="off"></label>
        <div class="fields-2"><label class="field"><span>E-mail (será o login)</span><input name="email" type="email" required autocomplete="off"></label>
        <label class="field"><span>WhatsApp</span><input name="phone" inputmode="tel" placeholder="(11) 99999-9999" autocomplete="off"></label></div>
        <div class="fields-2"><label class="field"><span>Mensalidade (R$)</span><input name="price" inputmode="decimal" placeholder="padrão do sistema"></label>
        <label class="field"><span>Vence em</span><input name="expires_at" type="date"><small>Em branco: usa o período de teste do sistema.</small></label></div>
        <div class="fields-2"><label class="field"><span>Plano (opcional)</span><input name="plan" placeholder="ex.: pro" autocomplete="off"></label>
        <label class="field"><span>Senha (opcional)</span><input name="password" minlength="6" autocomplete="off" placeholder="em branco = automática"></label></div>
        <label class="check"><input type="checkbox" name="send_whatsapp" checked> Enviar o acesso por WhatsApp (se tiver telefone)</label>
        <p class="form-error" role="alert" hidden></p>
        <div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Criar acesso</button></div>
      </form>`);
  };
  App.forms['client-new'] = async d => {
    const r = await App.post('/clients', { system_id: Number(d.system_id), name: d.name, email: d.email, phone: d.phone || undefined, price: parseMoney(d.price) || undefined, expires_at: d.expires_at || undefined, plan: d.plan || undefined, password: d.password || undefined, send_whatsapp: d.send_whatsapp });
    showCreds('Acesso criado', { ...r, name: d.name }); App.refresh();
  };
  App.showCreds = showCreds;
})();
