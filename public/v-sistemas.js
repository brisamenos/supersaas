// Sistemas conectados: ligar, conferir, editar e remover
(function () {
  'use strict';
  const { html, icon, fmt: F } = App;
  const S = App.state = App.state || {};
  let data = null;

  const card = s => html`<section class="panel sys-card">
    ${App.sysTile(s.kind, 'lg')}
    <div style="min-width:0"><div class="row" style="gap:10px"><h3>${s.name}</h3>${App.sysBadge(s.status)}</div>
      <div class="meta">${s.kind_label} • ${s.base_url}</div>
      <div class="small muted" style="margin-top:4px">${F.int(s.clients)} ${s.client_word}${s.clients === 1 ? '' : 's'} • ${s.status === 'offline' ? html`<span style="color:var(--bad)">${s.last_error || 'sem resposta'}</span>` : s.last_ok_at ? 'última resposta ' + F.ago(s.last_ok_at) + (s.latency_ms ? ' (' + s.latency_ms + ' ms)' : '') : 'ainda sem leitura'}</div></div>
    <div class="row admin-only" style="gap:6px"><button class="btn btn-sm" data-act="sys-sync" data-id="${s.id}">${icon('refresh')}Atualizar</button><button class="btn btn-sm" data-act="sys-edit" data-id="${s.id}">${icon('edit')}Editar</button><button class="icon-btn" data-act="sys-del" data-id="${s.id}" aria-label="Remover ${s.name}">${icon('trash')}</button></div>
  </section>`;

  App.views.sistemas = {
    title: 'Sistemas',
    async render() {
      const d = data = await App.get('/systems'); App.meta.systems = d.systems;
      App.render(html`
        <div class="row between" style="margin:6px 0 16px"><p class="muted" style="margin:0;max-width:62ch">Cada sistema aparece aqui depois de conectado. A central confere a saúde de cada um a cada 30 segundos e avisa no WhatsApp se algum cair.</p><button class="btn btn-primary admin-only" data-act="sys-new">${icon('plus')}Conectar sistema</button></div>
        ${d.systems.length ? d.systems.map(card) : html`<section class="panel empty"><h3>Nenhum sistema conectado</h3>Siga os passos abaixo para ligar o primeiro.</section>`}
        <section class="panel panel-pad" style="margin-top:22px"><h2 style="font-size:18px;margin-bottom:14px">Como conectar um sistema</h2>
          <ol class="steps">
            <li><b>Coloque o conector no sistema.</b> Cada zip de conector traz só os arquivos que mudam. Copie por cima do projeto, mantendo as pastas.</li>
            <li><b>Crie a variável <span class="code">HUB_TOKEN</span></b> no EasyPanel do sistema, com uma senha longa e só sua. Salve e reconstrua a imagem.</li>
            <li><b>Clique em “Conectar sistema”</b>, informe o endereço público do sistema (ex.: <span class="code">https://barbearia.seudominio.com</span>) e o mesmo token.</li>
            <li><b>Pronto.</b> Os clientes aparecem na hora e você já pode criar acessos, renovar e cobrar por aqui.</li>
          </ol></section>`);
    }
  };

  const form = s => html`<form data-form="sys"><input type="hidden" name="id" value="${s ? s.id : ''}">
    ${s ? '' : html`<label class="field"><span>Tipo de sistema</span><select name="kind"><option value="">Detectar sozinho</option><option value="barbersync">BarberSync (barbearias)</option><option value="estimafood">EstimaFood (delivery e restaurantes)</option><option value="motostock">MotoStock (lojas de moto)</option><option value="controlefacil">Controle Fácil (cobranças e parcelas)</option><option value="custom">Outro</option></select></label>`}
    <label class="field"><span>Nome na central</span><input name="name" value="${s ? s.name : ''}" placeholder="ex.: BarberSync" ${s ? 'required' : ''}></label>
    <label class="field"><span>Endereço do sistema</span><input name="base_url" type="url" required value="${s ? s.base_url : ''}" placeholder="https://meusistema.com"></label>
    <label class="field"><span>Token do conector${s ? ' (deixe em branco para manter)' : ''}</span><input name="token" ${s ? '' : 'required'} minlength="8" autocomplete="off" placeholder="${s ? s.token_hint : 'o mesmo valor de HUB_TOKEN do sistema'}"><small>É a variável HUB_TOKEN que você criou no EasyPanel do sistema.</small></label>
    ${s ? html`<label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Sistema ligado (desmarque para pausar a leitura)</label>` : ''}
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">${s ? 'Salvar' : 'Conectar'}</button></div></form>`;

  App.actions['sys-new'] = () => App.openModal('Conectar sistema', form(null));
  App.actions['sys-edit'] = d => App.openModal('Editar sistema', form(data.systems.find(s => s.id === Number(d.id))));
  App.forms.sys = async d => {
    if (d.id) { const b = { name: d.name, base_url: d.base_url, enabled: d.enabled }; if (d.token) b.token = d.token; await App.put('/systems/' + d.id, b); App.toast('Sistema atualizado.'); }
    else { const r = await App.post('/systems', { name: d.name || undefined, kind: d.kind || undefined, base_url: d.base_url, token: d.token }); App.toast(`${r.system.name} conectado: ${r.system.clients} cliente${r.system.clients === 1 ? '' : 's'} encontrado${r.system.clients === 1 ? '' : 's'}.`); }
    App.closeModal(); App.refresh();
  };
  App.actions['sys-sync'] = async (d, btn) => {
    await App.busy(btn, async () => { const r = await App.post(`/systems/${d.id}/sync`); if (r.ok) App.toast('Dados atualizados.'); else App.toast('Não consegui ler o sistema: ' + r.error, true); });
    App.refresh();
  };
  App.actions['sys-del'] = async d => {
    const s = data.systems.find(x => x.id === Number(d.id));
    if (!await App.confirm(`Remover ${s.name}?`, 'Os clientes deixam de aparecer na central e o histórico deste sistema é apagado aqui. O sistema em si não é alterado.', 'Remover', true)) return;
    await App.del('/systems/' + d.id); App.toast('Sistema removido.'); App.refresh();
  };
})();
