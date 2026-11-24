// Financeiro: o que entra, o que sai, quem está atrasado e quem vai vencer
(function () {
  'use strict';
  const { html, icon, fmt: F } = App;
  const S = App.state = App.state || {};
  let data = null;
  const CATS = ['Mensalidade', 'Anúncios', 'Servidor e domínio', 'Ferramentas', 'Impostos', 'Equipe', 'Outros'];

  const clientLine = (c, late) => html`<div class="lrow" style="grid-template-columns:minmax(0,1fr) 110px auto;padding:11px 0">
    <div class="main-cell wrap"><b>${c.name}</b><small>${c.system_name} • ${late ? html`<span style="color:var(--bad)">venceu em ${F.date(c.expires_at)} (${c.days_late} dia${c.days_late === 1 ? '' : 's'})</span>` : (c.days_left === 0 ? 'vence hoje' : `vence em ${c.days_left} dia${c.days_left === 1 ? '' : 's'} (${F.date(c.expires_at)})`)}</small></div>
    <b class="right">${c.price ? F.brl(c.price) : '—'}</b>
    <div class="row admin-only" style="gap:6px;flex-wrap:nowrap"><button class="btn btn-sm" data-act="fin-charge" data-sys="${c.system_id}" data-ext="${c.ext_id}" data-late="${late ? 1 : 0}" ${String(c.phone || '').replace(/\D/g, '') ? '' : 'disabled title="Sem telefone"'}>${icon('send')}Cobrar</button><button class="btn btn-sm btn-primary" data-act="fin-renew" data-sys="${c.system_id}" data-ext="${c.ext_id}">Renovar</button></div>
  </div>`;

  function ledgerRow(l) {
    const neg = l.type === 'despesa';
    return html`<div class="lrow lg">
      <span class="small">${F.date(l.date)}</span>
      <div class="main-cell c-desc"><b>${l.description || l.category}</b><small>${l.category}${l.system_name ? ' • ' + l.system_name : ''}</small></div>
      <span class="c-hide small muted">${l.client_name || ''}</span>
      <span class="c-hide">${l.type === 'receita' ? html`<span class="badge good">${icon('trend')}Entrada</span>` : html`<span class="badge warn">Saída</span>`}</span>
      <b class="${neg ? '' : 'val-good'} right" style="text-align:right">${neg ? '−' : '+'} ${F.brl(l.amount)}</b>
      <span class="right admin-only nowrap"><button class="icon-btn" data-act="ledger-edit" data-id="${l.id}" aria-label="Editar lançamento">${icon('edit')}</button><button class="icon-btn" data-act="ledger-del" data-id="${l.id}" aria-label="Excluir lançamento">${icon('trash')}</button></span>
    </div>`;
  }

  App.views.financeiro = {
    title: 'Financeiro',
    async render() {
      const month = S.finMonth || '';
      const d = data = await App.get('/finance' + (month ? '?month=' + month : '')); S.finMonth = d.month;
      App.render(html`
        <div class="row between" style="margin:6px 0 4px">
          <label class="row" style="gap:8px"><span class="small muted">Mês</span><input id="finMonth" type="month" value="${d.month}" style="width:auto"></label>
          <div class="row"><button class="btn" data-act="fin-export">${icon('download')}Baixar planilha</button><button class="btn btn-primary admin-only" data-act="ledger-new">${icon('plus')}Novo lançamento</button></div>
        </div>
        <section class="panel strip" aria-label="Resumo do mês">
          <div><div class="kpi-label">Receita mensal prevista</div><div class="kpi-value">${F.brl0(d.mrr)}</div><div class="kpi-note">${d.payers} clientes em dia • ticket ${F.brl0(d.ticket)}</div></div>
          <div><div class="kpi-label">Recebido no mês</div><div class="kpi-value">${F.brl0(d.received)}</div><div class="kpi-note ${d.expected_gap > 0 ? '' : 'good'}">${d.expected_gap > 0 ? 'faltam ' + F.brl0(d.expected_gap) + ' do previsto' : 'meta do mês atingida'}</div></div>
          <div><div class="kpi-label">Despesas</div><div class="kpi-value">${F.brl0(d.expenses)}</div><div class="kpi-note">no mês</div></div>
          <div><div class="kpi-label">Lucro</div><div class="kpi-value" style="${d.profit < 0 ? 'color:var(--bad)' : ''}">${F.brl0(d.profit)}</div><div class="kpi-note ${d.profit < 0 ? 'bad' : ''}">${d.profit < 0 ? 'no vermelho' : 'recebido − despesas'}</div></div>
          <div><div class="kpi-label">Em atraso</div><div class="kpi-value" style="${d.late.length ? 'color:var(--bad)' : ''}">${F.brl0(d.late_total)}</div><div class="kpi-note ${d.late.length ? 'bad' : ''}">${d.late.length} cliente${d.late.length === 1 ? '' : 's'}</div></div>
        </section>
        <div class="grid g2">
          <section class="panel"><div class="panel-head"><h2>Entradas e saídas, mês a mês</h2><span class="hint">últimos 6 meses</span></div><div class="panel-body"><div id="chMonthly"></div></div></section>
          <section class="panel"><div class="panel-head"><h2>Por sistema</h2></div><div class="panel-body">
            ${d.by_system.length ? html`<table class="data-table"><thead><tr><th>Sistema</th><th class="num">Em dia</th><th class="num">Mensal</th><th class="num">Atrasados</th></tr></thead><tbody>
              ${d.by_system.map(s => html`<tr><td>${s.name}</td><td class="num">${s.clients}</td><td class="num">${F.brl0(s.mrr)}</td><td class="num" style="${s.late ? 'color:var(--bad);font-weight:600' : ''}">${s.late}</td></tr>`)}</tbody></table>` : html`<p class="muted small">Conecte um sistema para ver a divisão.</p>`}
            <h3 style="font:600 15px var(--f-body);margin:22px 0 6px">Despesas por categoria</h3><div id="chCats"></div>
          </div></section>
        </div>
        <div class="stack fin-lists">
          <section class="panel"><div class="panel-head"><h2>Em atraso</h2><span class="hint">${F.brl0(d.late_total)} por mês parados</span></div><div class="panel-body">
            ${d.late.length ? d.late.map(c => clientLine(c, true)) : html`<p class="muted small">Ninguém em atraso.</p>`}</div></section>
          <section class="panel"><div class="panel-head"><h2>Vencem nos próximos 7 dias</h2><span class="hint">${F.brl0(d.due7_total)} a receber</span></div><div class="panel-body">
            ${d.due7.length ? d.due7.map(c => clientLine(c, false)) : html`<p class="muted small">Nenhum vencimento nesta semana. Em 30 dias: ${d.due30.length} cliente${d.due30.length === 1 ? '' : 's'} (${F.brl0(d.due30_total)}).</p>`}</div></section>
        </div>
        <section class="panel" style="margin-top:18px;padding-bottom:6px"><div class="panel-head"><h2>Lançamentos de ${F.month(d.month)}</h2><span class="hint">${d.ledger.length} lançamento${d.ledger.length === 1 ? '' : 's'}</span></div>
          <div class="list" style="margin-top:8px">${d.ledger.length ? html`<div class="lrow lg head"><span>Data</span><span>Descrição</span><span>Cliente</span><span>Tipo</span><span class="right">Valor</span><span></span></div>${d.ledger.map(ledgerRow)}` : html`<div class="empty"><h3>Nenhum lançamento neste mês</h3>Quando você renova um cliente aqui no painel, o pagamento entra sozinho. Despesas você lança à mão.</div>`}</div></section>`);
      document.getElementById('finMonth').addEventListener('change', e => { if (e.target.value) { S.finMonth = e.target.value; App.refresh(); } });
      Charts.bars(document.getElementById('chMonthly'), { label: 'Entradas e saídas dos últimos 6 meses', groups: d.monthly.map(m => ({ label: F.monthShort(m.month), long: F.month(m.month), values: [{ name: 'Recebido', color: 'var(--s1)', v: m.received }, { name: 'Despesas', color: 'var(--s2)', v: m.expenses }] })) });
      Charts.hbars(document.getElementById('chCats'), d.expenses_by_category.map(c => ({ label: c.category, value: c.amount, text: F.brl0(c.amount), color: 'var(--s2)' })), { empty: 'Sem despesas lançadas neste mês.' });
    }
  };

  App.actions['fin-export'] = async () => {
    const blob = await App.api('/finance/export.csv?month=' + (S.finMonth || ''), { blob: true });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `financeiro-${S.finMonth}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  App.actions['fin-renew'] = d => App.openClientById(d.sys, d.ext);
  App.actions['fin-charge'] = async d => {
    const c = [...data.late, ...data.due7].find(x => x.system_id === Number(d.sys) && String(x.ext_id) === d.ext); if (!c) return;
    const late = d.late === '1';
    const text = late ? 'Olá, {nome}! 👋 Passando para avisar que a mensalidade do {sistema} ({valor}) venceu em {vencimento}. Para continuar usando sem interrupção é só pagar pelo Pix e o acesso é liberado na hora. Qualquer dúvida, é só responder aqui. 🙏'
      : 'Oi, {nome}! Sua mensalidade do {sistema} vence em {dias} dia(s) ({vencimento}), no valor de {valor}. Pague pelo Pix e já fica tudo renovado. Obrigado por estar com a gente! 🚀';
    S.charge = { sys: d.sys, ext: d.ext };
    App.openModal('Cobrar ' + c.name, html`<p class="muted">Mensagem para ${F.phone(c.phone)}. Você pode editar antes de enviar.</p><form data-form="fin-charge"><label class="field"><span>Mensagem</span><textarea name="text" required>${text}</textarea></label><p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">${icon('send')}Enviar cobrança</button></div></form>`);
  };
  App.forms['fin-charge'] = async d => { await App.post(`/clients/${S.charge.sys}/${encodeURIComponent(S.charge.ext)}/message`, { text: d.text }); App.closeModal(); App.toast('Cobrança enviada.'); };

  // ---------- lançamentos ----------
  function ledgerForm(l) {
    return html`<form data-form="ledger"><input type="hidden" name="id" value="${l ? l.id : ''}">
      <div class="fields-2"><label class="field"><span>Tipo</span><select name="type"><option value="despesa" ${l && l.type === 'receita' ? '' : 'selected'}>Despesa (saiu)</option><option value="receita" ${l && l.type === 'receita' ? 'selected' : ''}>Receita (entrou)</option></select></label>
      <label class="field"><span>Valor (R$)</span><input name="amount" inputmode="decimal" required value="${l ? l.amount.toFixed(2).replace('.', ',') : ''}" placeholder="0,00"></label></div>
      <div class="fields-2"><label class="field"><span>Data</span><input name="date" type="date" required value="${l ? l.date : new Date().toLocaleDateString('en-CA')}"></label>
      <label class="field"><span>Categoria</span><input name="category" list="cats" value="${l ? l.category : ''}" placeholder="ex.: Anúncios"><datalist id="cats">${CATS.map(c => html`<option value="${c}">`)}</datalist></label></div>
      <label class="field"><span>Descrição</span><input name="description" value="${l ? l.description : ''}" placeholder="ex.: Anúncios do Instagram"></label>
      <label class="field"><span>Sistema (opcional)</span><select name="system_id"><option value="">Nenhum em especial</option>${App.meta.systems.map(s => html`<option value="${s.id}" ${l && l.system_id === s.id ? 'selected' : ''}>${s.name}</option>`)}</select></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Salvar lançamento</button></div></form>`;
  }
  App.actions['ledger-new'] = () => App.openModal('Novo lançamento', ledgerForm(null));
  App.actions['ledger-edit'] = d => { const l = data.ledger.find(x => x.id === Number(d.id)); if (l) App.openModal('Editar lançamento', ledgerForm(l)); };
  App.actions['ledger-del'] = async d => { if (!await App.confirm('Excluir lançamento?', 'Isso muda os totais do mês e não dá para desfazer.', 'Excluir', true)) return; await App.del('/ledger/' + d.id); App.toast('Lançamento excluído.'); App.refresh(); };
  App.forms.ledger = async d => {
    const body = { type: d.type, amount: App.parseMoney(d.amount), date: d.date, category: d.category || (d.type === 'receita' ? 'Mensalidade' : 'Outros'), description: d.description, system_id: d.system_id ? Number(d.system_id) : null };
    if (!body.amount) throw new Error('Informe o valor.');
    if (d.id) await App.put('/ledger/' + d.id, body); else await App.post('/ledger', body);
    App.closeModal(); App.toast('Lançamento salvo.'); S.finMonth = d.date.slice(0, 7); App.refresh();
  };
})();
