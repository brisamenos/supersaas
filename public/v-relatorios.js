// Relatórios: prévia do que chega no WhatsApp, envio na hora e agenda automática
(function () {
  'use strict';
  const { html, raw, esc, icon, fmt: F } = App;
  const S = App.state = App.state || {};
  const KINDS = [['daily', 'Diário'], ['weekly', 'Semanal'], ['monthly', 'Mensal']];
  const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  App.waFormat = t => raw(esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>'));
  const hourOpts = sel => Array.from({ length: 24 }, (_, h) => html`<option value="${h}" ${Number(sel) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`);

  function schedRow(st, kind, label, extra) {
    const on = st['report_' + kind + '_on'] === '1';
    return html`<div class="sec" style="margin-top:12px;padding-top:12px"><label class="check" style="margin-bottom:8px"><input type="checkbox" name="report_${kind}_on" ${on ? 'checked' : ''}> <b>${label}</b></label>
      <div class="fields-2" style="margin-left:28px">${extra}<label class="field"><span>Horário</span><select name="report_${kind}_hour">${hourOpts(st['report_' + kind + '_hour'])}</select></label></div></div>`;
  }

  App.views.relatorios = {
    title: 'Relatórios',
    async render() {
      const kind = S.repKind || 'daily';
      const [prev, st, log] = await Promise.all([App.get('/reports/preview?kind=' + kind), App.get('/settings'), App.get('/reports/log')]);
      const ready = st.wuzapi.ready, phones = st.owner_phones || [];
      App.render(html`
        <div class="tabs" role="tablist" aria-label="Tipo de relatório">${KINDS.map(([k, l]) => html`<button role="tab" aria-selected="${k === kind}" data-act="rep-kind" data-k="${k}">${l}</button>`)}</div>
        <div class="grid g2" style="margin-top:0">
          <section class="panel"><div class="panel-head"><h2>Como chega no WhatsApp</h2><span class="hint">com os números de agora</span></div><div class="panel-body">
            <div class="wa">${App.waFormat(prev.text)}</div>
            <div class="row" style="margin-top:18px">
              <button class="btn btn-primary admin-only" data-act="rep-send" ${ready && phones.length ? '' : 'disabled'}>${icon('send')}Enviar agora</button>
              <button class="btn" data-act="copy" data-text="${prev.text}">${icon('copy')}Copiar texto</button>
            </div>
            <p class="small muted" style="margin-top:10px">${!ready ? html`O WhatsApp ainda não está ligado. <button class="linkish" data-act="goto" data-tab="config">Configurar agora</button>` : !phones.length ? html`Cadastre o WhatsApp de quem recebe os relatórios. <button class="linkish" data-act="goto" data-tab="config">Cadastrar</button>` : html`Vai para ${phones.map(p => F.phone(p)).join(', ')}.`}</p>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Envio automático</h2></div><div class="panel-body">
            <form data-form="rep-sched">
              ${schedRow(st, 'daily', 'Relatório diário', '')}
              ${schedRow(st, 'weekly', 'Relatório semanal', html`<label class="field"><span>Dia da semana</span><select name="report_weekly_day">${DAYS.map((d, i) => html`<option value="${i}" ${Number(st.report_weekly_day) === i ? 'selected' : ''}>${d}</option>`)}</select></label>`)}
              ${schedRow(st, 'monthly', 'Fechamento mensal', html`<label class="field"><span>Dia do mês</span><select name="report_monthly_day">${Array.from({ length: 28 }, (_, i) => html`<option value="${i + 1}" ${Number(st.report_monthly_day) === i + 1 ? 'selected' : ''}>${i + 1}</option>`)}</select></label>`)}
              <div class="sec" style="margin-top:12px;padding-top:12px"><label class="check"><input type="checkbox" name="alerts_enabled" ${st.alerts_enabled === '1' ? 'checked' : ''}> <b>Avisar no WhatsApp se um sistema sair do ar</b></label></div>
              <p class="form-error" role="alert" hidden></p>
              <button class="btn btn-primary admin-only" type="submit">Salvar agenda</button>
            </form>
          </div></section>
        </div>
        <section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Últimos envios</h2></div><div class="panel-body">
          ${log.log.length ? html`<ul class="feed">${log.log.map(l => html`<li>${l.ok ? html`<span class="badge good">${icon('check')}Enviado</span>` : html`<span class="badge bad">${icon('alert')}Falhou</span>`}<span><b style="font-weight:600">${(KINDS.find(k => k[0] === l.kind) || [0, l.kind])[1]}</b> <span class="sys">${l.trigger === 'agendado' ? 'automático' : 'manual'}${l.error ? ' • ' + l.error : ''}</span></span><time>${F.clock(l.ts)}</time></li>`)}</ul>` : html`<p class="muted small">Nenhum relatório enviado ainda.</p>`}
        </div></section>`);
    }
  };

  App.actions['rep-kind'] = d => { S.repKind = d.k; App.refresh(); };
  App.actions['rep-send'] = async (d, btn) => {
    await App.busy(btn, async () => {
      const r = await App.post('/reports/send', { kind: S.repKind || 'daily' });
      if (r.ok) App.toast(`Relatório enviado para ${r.sent} número${r.sent === 1 ? '' : 's'}.`); else App.toast('Não enviou: ' + r.error, true);
    });
    App.refresh();
  };
  App.forms['rep-sched'] = async d => {
    const b = {}; ['daily', 'weekly', 'monthly'].forEach(k => { b[`report_${k}_on`] = d[`report_${k}_on`] ? '1' : '0'; b[`report_${k}_hour`] = d[`report_${k}_hour`]; });
    b.report_weekly_day = d.report_weekly_day; b.report_monthly_day = d.report_monthly_day; b.alerts_enabled = d.alerts_enabled ? '1' : '0';
    await App.put('/settings', b); App.toast('Agenda salva.');
  };
})();
