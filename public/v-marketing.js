// Marketing: estratégias prontas, comunicados em massa, funil de vendas e campanhas
(function () {
  'use strict';
  const { html, raw, icon, fmt: F } = App;
  const S = App.state = App.state || {};
  const TABS = [['estrategias', 'Estratégias'], ['comunicados', 'Comunicados'], ['funil', 'Funil de vendas'], ['campanhas', 'Campanhas']];
  const KINDS = { barbersync: 'BarberSync', estimafood: 'EstimaFood', motostock: 'MotoStock', controlefacil: 'Controle Fácil', custom: 'Outro' };
  const STAGE = { novo: 'Novo', contato: 'Em contato', demo: 'Demonstração', proposta: 'Proposta', fechado: 'Fechado', perdido: 'Perdido' };
  const SOURCES = ['Instagram', 'Indicação', 'Anúncio', 'Site', 'WhatsApp', 'Evento'];
  const CHANNELS = ['Instagram', 'Meta Ads', 'Google Ads', 'Indicação', 'Parceria', 'Outro'];
  let pollTimer = null;

  App.views.marketing = {
    title: 'Marketing',
    async render() {
      const tab = S.mkTab || 'estrategias';
      const body = await ({ estrategias: tabEstrategias, comunicados: tabComunicados, funil: tabFunil, campanhas: tabCampanhas }[tab] || tabEstrategias)();
      App.render(html`<div class="tabs" role="tablist" aria-label="Marketing">${TABS.map(([k, l]) => html`<button role="tab" aria-selected="${k === tab}" data-act="mk-tab" data-k="${k}">${l}</button>`)}</div>${body}`);
      if (tab === 'comunicados') wireBroadcast();
    }
  };
  App.actions['mk-tab'] = d => { S.mkTab = d.k; App.refresh(); };

  // ---------- Estratégias ----------
  async function tabEstrategias() {
    const [ins, pb] = await Promise.all([App.get('/marketing/insights'), App.get('/marketing/playbooks')]);
    return html`
      <section class="panel"><div class="panel-head"><h2>O que os seus números sugerem</h2><span class="hint">atualiza sozinho com os dados dos sistemas</span></div><div class="panel-body">
        ${ins.insights.length ? ins.insights.map(i => html`<div class="alert ${i.level}"><span class="ico">${icon(i.icon)}</span><div><h3>${i.title}</h3><p>${i.detail}</p></div>${i.action ? html`<button class="btn btn-sm" data-act="insight-go" data-tab="${i.action.tab}" data-segment="${i.action.segment || ''}">${i.action.label}</button>` : ''}</div>`) : html`<p class="muted">Sem sugestões por enquanto. Conecte sistemas e aguarde alguns dias de dados.</p>`}
      </div></section>
      <h2 class="section-title">Estratégias prontas para usar</h2>
      <div class="grid g2e" style="margin-top:0">${pb.playbooks.map(p => html`<section class="panel"><div class="panel-head"><h2 class="pb-title"><span class="pb-ico">${icon(p.icon)}</span>${p.title}</h2></div><div class="panel-body">
        <p class="muted" style="margin-bottom:10px">${p.goal}</p>
        <ul style="margin:0 0 14px;padding-left:20px">${p.steps.map(s => html`<li style="margin-bottom:3px">${s}</li>`)}</ul>
        <div class="wa">${App.waFormat(p.message)}</div>
        <button class="btn btn-sm admin-only" style="margin-top:14px" data-act="use-playbook" data-id="${p.id}">${icon('send')}Enviar para: ${pb.segments[p.segment]}</button>
      </div></section>`)}</div>`;
  }
  App.actions['use-playbook'] = async d => {
    const pb = await App.get('/marketing/playbooks'); const p = pb.playbooks.find(x => x.id === d.id);
    S.broadcastSegment = p.segment; S.broadcastText = p.message; S.mkTab = 'comunicados'; App.refresh();
  };

  // ---------- Comunicados ----------
  async function tabComunicados() {
    const seg = await App.get('/marketing/segments' + (S.broadcastSystem ? '?system_id=' + S.broadcastSystem : ''));
    if (!S.broadcastSegment) S.broadcastSegment = 'todos_ativos';
    return html`<section class="panel"><div class="panel-head"><h2>Enviar comunicado pelo WhatsApp</h2><span class="hint">1 mensagem a cada 4 segundos, para proteger seu número</span></div><div class="panel-body">
      <form id="bcForm" data-form="broadcast">
        <div class="fields-2">
          <label class="field"><span>Quem recebe</span><select name="segment" id="bcSeg">${seg.segments.map(s => html`<option value="${s.id}" ${S.broadcastSegment === s.id ? 'selected' : ''}>${s.label} — ${s.count} (${s.with_phone} com WhatsApp)</option>`)}</select></label>
          <label class="field"><span>Sistema</span><select name="system_id" id="bcSys">${App.systemOptions(S.broadcastSystem, true)}</select></label>
        </div>
        <label class="field"><span>Mensagem</span><textarea name="text" id="bcText" required minlength="5" placeholder="Olá, {nome}! …">${S.broadcastText || ''}</textarea>
          <small>Troca automática por cliente: <span class="code">{nome}</span> <span class="code">{sistema}</span> <span class="code">{valor}</span> <span class="code">{vencimento}</span> <span class="code">{dias}</span></small></label>
        <div id="bcPreview" aria-live="polite"></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="row"><button class="btn" type="button" data-act="bc-preview">Ver prévia</button><button class="btn btn-primary admin-only" type="submit">${icon('send')}Enviar comunicado</button></div>
      </form><div id="bcJob"></div></div></section>`;
  }
  function wireBroadcast() {
    const seg = document.getElementById('bcSeg'), sys = document.getElementById('bcSys'), txt = document.getElementById('bcText');
    seg.addEventListener('change', () => { S.broadcastSegment = seg.value; });
    sys.addEventListener('change', () => { S.broadcastSystem = sys.value; S.broadcastText = txt.value; App.refresh(); });
    txt.addEventListener('input', () => { S.broadcastText = txt.value; });
  }
  App.actions['bc-preview'] = async () => {
    const f = document.getElementById('bcForm'), d = Object.fromEntries(new FormData(f).entries());
    const r = await App.post('/marketing/preview', { segment: d.segment, system_id: d.system_id || undefined, text: d.text });
    document.getElementById('bcPreview').innerHTML = html`<div class="sec" style="margin:0 0 16px;padding-top:12px"><p><b>${r.total}</b> cliente${r.total === 1 ? '' : 's'} neste grupo: <b>${r.with_phone}</b> vão receber${r.without_phone ? html` e <b>${r.without_phone}</b> estão sem WhatsApp cadastrado` : ''}.</p>
      ${r.sample.map(s => html`<p class="small muted" style="margin:8px 0 4px">Exemplo para ${s.to}:</p><div class="wa">${App.waFormat(s.text)}</div>`)}</div>`.s;
  };
  App.forms.broadcast = async d => {
    const pv = await App.post('/marketing/preview', { segment: d.segment, system_id: d.system_id || undefined, text: d.text });
    if (!pv.with_phone) throw new Error('Ninguém neste grupo tem WhatsApp cadastrado.');
    if (!await App.confirm('Enviar comunicado?', `A mensagem vai para ${pv.with_phone} cliente${pv.with_phone === 1 ? '' : 's'}. O envio leva cerca de ${Math.max(1, Math.ceil(pv.with_phone * 4 / 60))} min e não dá para desfazer.`, 'Enviar agora')) return;
    const { job } = await App.post('/marketing/broadcast', { segment: d.segment, system_id: d.system_id || undefined, text: d.text });
    pollJob(job.id);
  };
  function pollJob(id) {
    clearInterval(pollTimer);
    const box = document.getElementById('bcJob');
    const tick = async () => {
      const el = document.getElementById('bcJob'); if (!el) { clearInterval(pollTimer); return; }
      const { job } = await App.get('/marketing/broadcast/' + id); const pct = job.total ? Math.round((job.sent + job.failed) / job.total * 100) : 100;
      el.innerHTML = html`<div class="sec"><h3>${job.done ? 'Envio concluído' : 'Enviando…'}</h3><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <p class="small">${job.sent} enviada${job.sent === 1 ? '' : 's'} de ${job.total}${job.failed ? html` • <span style="color:var(--bad)">${job.failed} com falha</span>` : ''}</p>
        ${job.errors.length ? html`<ul class="small" style="color:var(--bad);margin:6px 0 0;padding-left:18px">${job.errors.map(e => html`<li>${e}</li>`)}</ul>` : ''}</div>`.s;
      if (job.done) clearInterval(pollTimer);
    };
    tick().catch(App.fail); pollTimer = setInterval(() => tick().catch(() => clearInterval(pollTimer)), 2000);
    App.cleanup.push(() => clearInterval(pollTimer));
  }

  // ---------- Funil ----------
  let leadData = null, campData = null;
  async function tabFunil() {
    const d = leadData = await App.get('/leads'); campData = (await App.get('/campaigns')).campaigns;
    const open = d.stages.filter(s => !['fechado', 'perdido'].includes(s)).reduce((a, s) => a + d.summary[s].value, 0);
    const total = d.leads.length;
    return html`<div class="row between" style="margin-bottom:14px"><div class="row" style="gap:24px"><div><div class="kpi-label">Leads no funil</div><div class="kpi-value sm">${total}</div></div>
      <div><div class="kpi-label">Mensalidades em negociação</div><div class="kpi-value sm">${F.brl0(open)}</div></div>
      <div><div class="kpi-label">Taxa de fechamento</div><div class="kpi-value sm">${d.conversion === null ? '—' : d.conversion + '%'}</div></div></div>
      <button class="btn btn-primary admin-only" data-act="lead-new">${icon('plus')}Novo lead</button></div>
      <div class="funnel" role="list">${d.stages.map(st => html`<div class="col" role="listitem"><h3>${STAGE[st]} <span>${d.summary[st].count}${d.summary[st].value ? ' • ' + F.brl0(d.summary[st].value) : ''}</span></h3>
        ${d.leads.filter(l => l.stage === st).map(l => html`<div class="lead" data-act="lead-edit" data-id="${l.id}" role="button" tabindex="0"><b>${l.name}</b><small>${[l.company, l.source].filter(Boolean).join(' • ')}</small>
          ${l.value ? html`<small>${F.brl0(l.value)}/mês</small>` : ''}${l.next_followup ? html`<small class="${l.overdue ? 'late' : ''}">${l.overdue ? 'Retornar era ' : 'Retornar '}${F.short(l.next_followup)}</small>` : ''}</div>`)}
        ${d.summary[st].count ? '' : html`<p class="small muted" style="padding:4px">Vazio</p>`}</div>`)}</div>
      ${total ? '' : html`<p class="muted small" style="margin-top:12px">Anote aqui cada pessoa interessada. Mova o lead de etapa conforme a conversa avança e acompanhe quanto de mensalidade está em negociação.</p>`}`;
  }
  const leadForm = l => html`<form data-form="lead"><input type="hidden" name="id" value="${l ? l.id : ''}">
    <div class="fields-2"><label class="field"><span>Nome</span><input name="name" required value="${l ? l.name : ''}"></label><label class="field"><span>Empresa</span><input name="company" value="${l && l.company || ''}"></label></div>
    <div class="fields-2"><label class="field"><span>WhatsApp</span><input name="phone" inputmode="tel" value="${l && l.phone || ''}"></label><label class="field"><span>E-mail</span><input name="email" type="email" value="${l && l.email || ''}"></label></div>
    <div class="fields-2"><label class="field"><span>Etapa</span><select name="stage">${Object.entries(STAGE).map(([k, v]) => html`<option value="${k}" ${(l ? l.stage : 'novo') === k ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="field"><span>Mensalidade esperada (R$)</span><input name="value" inputmode="decimal" value="${l && l.value ? String(l.value).replace('.', ',') : ''}"></label></div>
    <div class="fields-2"><label class="field"><span>Sistema de interesse</span><select name="system_kind"><option value="">—</option>${Object.entries(KINDS).map(([k, v]) => html`<option value="${k}" ${l && l.system_kind === k ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="field"><span>De onde veio</span><input name="source" list="srcs" value="${l && l.source || ''}"><datalist id="srcs">${SOURCES.map(s => html`<option value="${s}">`)}</datalist></label></div>
    <div class="fields-2"><label class="field"><span>Voltar a falar em</span><input name="next_followup" type="date" value="${l && l.next_followup || ''}"></label>
    <label class="field"><span>Campanha</span><select name="campaign_id"><option value="">Nenhuma</option>${(campData || []).map(c => html`<option value="${c.id}" ${l && l.campaign_id === c.id ? 'selected' : ''}>${c.name}</option>`)}</select></label></div>
    <label class="field"><span>Anotações</span><textarea name="notes" style="min-height:80px">${l && l.notes || ''}</textarea></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions">${l ? html`<button class="btn btn-danger" type="button" data-act="lead-del" data-id="${l.id}" style="margin-right:auto">${icon('trash')}Excluir</button>` : ''}<button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Salvar</button></div></form>`;
  App.actions['lead-new'] = () => App.openModal('Novo lead', leadForm(null), { wide: true });
  App.actions['lead-edit'] = d => { const l = leadData.leads.find(x => x.id === Number(d.id)); if (l) App.openModal(l.name, leadForm(l), { wide: true }); };
  App.actions['lead-del'] = async d => { if (!await App.confirm('Excluir este lead?', 'Ele some do funil e das contas das campanhas.', 'Excluir', true)) return; await App.del('/leads/' + d.id); App.closeModal(); App.refresh(); };
  App.forms.lead = async d => {
    const body = { ...d, value: App.parseMoney(d.value), campaign_id: d.campaign_id || null }; delete body.id;
    if (d.id) await App.put('/leads/' + d.id, body); else await App.post('/leads', body);
    App.closeModal(); App.toast('Lead salvo.'); App.refresh();
  };

  // ---------- Campanhas ----------
  async function tabCampanhas() {
    const d = await App.get('/campaigns'); campData = d.campaigns;
    const cells = c => [c.cpl === null ? '—' : F.brl(c.cpl), c.cac === null ? '—' : F.brl(c.cac), c.roi === null ? '—' : c.roi + '%'];
    return html`<div class="row between" style="margin-bottom:14px"><p class="muted" style="margin:0;max-width:62ch">Registre quanto gastou em cada campanha e vincule os leads a ela. O painel calcula o custo por lead, o custo para fechar um cliente e o retorno em 12 meses.</p><button class="btn btn-primary admin-only" data-act="camp-new">${icon('plus')}Nova campanha</button></div>
      <section class="panel" style="overflow-x:auto">${d.campaigns.length ? html`<table class="data-table" style="min-width:760px"><thead><tr><th style="padding-left:22px">Campanha</th><th>Situação</th><th class="num">Investido</th><th class="num">Leads</th><th class="num">Fechados</th><th class="num">Custo por lead</th><th class="num">Custo por cliente</th><th class="num">Retorno</th><th></th></tr></thead><tbody>
        ${d.campaigns.map(c => { const x = cells(c); return html`<tr><td style="padding-left:22px"><b style="font-weight:600">${c.name}</b><small class="muted" style="display:block">${[c.channel, KINDS[c.system_kind]].filter(Boolean).join(' • ')}</small></td>
          <td><span class="badge ${c.status === 'ativa' ? 'good' : ''}">${c.status === 'ativa' ? icon('check') : ''}${c.status[0].toUpperCase() + c.status.slice(1)}</span></td><td class="num">${F.brl(c.spent)}</td><td class="num">${c.leads}</td><td class="num">${c.won}</td><td class="num">${x[0]}</td><td class="num">${x[1]}</td>
          <td class="num" style="${c.roi !== null ? (c.roi >= 0 ? 'color:var(--good);font-weight:600' : 'color:var(--bad);font-weight:600') : ''}">${x[2]}</td><td class="num admin-only"><button class="icon-btn" data-act="camp-edit" data-id="${c.id}" aria-label="Editar campanha">${icon('edit')}</button></td></tr>`; })}</tbody></table>`
        : html`<div class="empty"><h3>Nenhuma campanha ainda</h3>Cadastre a primeira para saber quanto custa cada cliente novo.</div>`}</section>`;
  }
  const campForm = c => html`<form data-form="camp"><input type="hidden" name="id" value="${c ? c.id : ''}">
    <label class="field"><span>Nome</span><input name="name" required value="${c ? c.name : ''}" placeholder="ex.: Anúncio barbearias — novembro"></label>
    <div class="fields-2"><label class="field"><span>Canal</span><input name="channel" list="chs" value="${c && c.channel || ''}"><datalist id="chs">${CHANNELS.map(s => html`<option value="${s}">`)}</datalist></label>
    <label class="field"><span>Sistema divulgado</span><select name="system_kind"><option value="">—</option>${Object.entries(KINDS).map(([k, v]) => html`<option value="${k}" ${c && c.system_kind === k ? 'selected' : ''}>${v}</option>`)}</select></label></div>
    <div class="fields-2"><label class="field"><span>Início</span><input name="start_date" type="date" value="${c && c.start_date || ''}"></label><label class="field"><span>Fim</span><input name="end_date" type="date" value="${c && c.end_date || ''}"></label></div>
    <div class="fields-2"><label class="field"><span>Investido (R$)</span><input name="spent" inputmode="decimal" value="${c && c.spent ? String(c.spent).replace('.', ',') : ''}"></label>
    <label class="field"><span>Situação</span><select name="status">${['ativa', 'pausada', 'encerrada'].map(s => html`<option value="${s}" ${(c ? c.status : 'ativa') === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`)}</select></label></div>
    <label class="field"><span>Anotações</span><textarea name="notes" style="min-height:70px">${c && c.notes || ''}</textarea></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions">${c ? html`<button class="btn btn-danger" type="button" data-act="camp-del" data-id="${c.id}" style="margin-right:auto">${icon('trash')}Excluir</button>` : ''}<button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Salvar</button></div></form>`;
  App.actions['camp-new'] = () => App.openModal('Nova campanha', campForm(null));
  App.actions['camp-edit'] = d => { const c = campData.find(x => x.id === Number(d.id)); if (c) App.openModal('Editar campanha', campForm(c)); };
  App.actions['camp-del'] = async d => { if (!await App.confirm('Excluir campanha?', 'Os leads continuam no funil, só perdem o vínculo.', 'Excluir', true)) return; await App.del('/campaigns/' + d.id); App.closeModal(); App.refresh(); };
  App.forms.camp = async d => { const body = { ...d, spent: App.parseMoney(d.spent) }; delete body.id; if (d.id) await App.put('/campaigns/' + d.id, body); else await App.post('/campaigns', body); App.closeModal(); App.toast('Campanha salva.'); App.refresh(); };

  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.act === 'lead-edit') { e.preventDefault(); e.target.click(); } });
})();
