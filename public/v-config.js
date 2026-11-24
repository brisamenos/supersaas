// Configurações: WhatsApp (WuzAPI), quem recebe avisos, equipe, senha e histórico
(function () {
  'use strict';
  const { html, icon, fmt: F } = App;
  const S = App.state = App.state || {};
  const ROLE = { admin: 'Administrador', viewer: 'Só visualiza' };

  App.views.config = {
    title: 'Configurações',
    async render() {
      const [st, us, msg, au] = await Promise.all([App.get('/settings'), App.get('/users'), App.get('/messages'), App.get('/audit')]);
      const w = st.wuzapi, a = st.assistant;
      App.render(html`
        <div class="grid g2e" style="margin-top:8px">
          <section class="panel"><div class="panel-head"><h2>WhatsApp (WuzAPI)</h2>${w.ready ? html`<span class="badge good">${icon('check')}Ligado${w.instance_name ? ' • ' + w.instance_name : ''}</span>` : html`<span class="badge warn">${icon('alert')}Falta ligar</span>`}</div><div class="panel-body">
            <form data-form="wuz">
              <label class="field"><span>Endereço da WuzAPI</span><input name="wuzapi_url" type="url" value="${w.url}" placeholder="https://wuzapi.seudominio.com"></label>
              <label class="field"><span>Token de administrador</span><input name="wuzapi_admin_token" type="password" autocomplete="off" placeholder="${w.has_admin_token ? '•••••••• (já salvo; preencha só para trocar)' : 'o WUZAPI_ADMIN_TOKEN da sua WuzAPI'}"></label>
              <p class="form-error" role="alert" hidden></p>
              <div class="row"><button class="btn btn-primary admin-only" type="submit">Salvar</button><button class="btn admin-only" type="button" data-act="wuz-list">Escolher número de envio</button></div>
            </form>
            <div id="wuzList" style="margin-top:14px"></div>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Quem recebe relatórios e avisos</h2></div><div class="panel-body">
            <form data-form="owners"><label class="field"><span>WhatsApp dos donos (um por linha, com DDD)</span><textarea name="phones" style="min-height:90px" placeholder="(11) 99999-9999">${(st.owner_phones || []).map(p => F.phone(p)).join('\n')}</textarea></label>
              <p class="form-error" role="alert" hidden></p>
              <div class="row"><button class="btn btn-primary admin-only" type="submit">Salvar números</button><button class="btn admin-only" type="button" data-act="wuz-test" ${w.ready ? '' : 'disabled'}>${icon('send')}Enviar teste</button></div></form>
          </div></section>
        </div>
        <div class="grid g2e">
          <section class="panel"><div class="panel-head"><h2>Assistente (IA)</h2>${a.ready ? html`<span class="badge good">${icon('check')}Ligado</span>` : html`<span class="badge warn">${icon('alert')}Falta a chave</span>`}</div><div class="panel-body">
            <form data-form="assist">
              <label class="field"><span>Chave da API do Claude</span><input name="assistant_key" type="password" autocomplete="off" placeholder="${a.has_key ? '•••••••• (já salva; preencha só para trocar)' : a.key_from_env ? 'usando a chave configurada no servidor' : 'sk-ant-…'}"><small>Você cria a chave em console.anthropic.com → API Keys. Ela fica guardada só no seu servidor.</small></label>
              <label class="field"><span>Modelo</span><select name="assistant_model">${a.models.map(m => html`<option value="${m.id}" ${m.id === a.model ? 'selected' : ''}>${m.label}</option>`)}</select></label>
              <p class="form-error" role="alert" hidden></p>
              <div class="row"><button class="btn btn-primary admin-only" type="submit">Salvar</button><button class="btn admin-only" type="button" data-act="assist-test" ${a.ready ? '' : 'disabled'}>Testar conexão</button>${a.has_key ? html`<button class="btn btn-danger admin-only" type="button" data-act="assist-clear">Remover chave</button>` : ''}</div>
            </form></div></section>
          <section class="panel"><div class="panel-head"><h2>Como o assistente funciona</h2></div><div class="panel-body">
            <ul style="margin:0;padding-left:20px;line-height:1.7">
              <li>Você pergunta em português, na tela <b>Assistente</b>, e ele consulta os dados atuais dos seus sistemas.</li>
              <li>Ele <b>só lê</b>: não renova, não cobra e não altera nada.</li>
              <li>O uso é cobrado na sua conta da Anthropic, por pergunta. Defina um limite de gasto mensal no console para ficar tranquilo.</li>
              <li>Para perguntas simples, o modelo mais barato costuma bastar.</li>
            </ul></div></section>
        </div>
        <div class="grid g2e">
          <section class="panel"><div class="panel-head"><h2>Equipe</h2><button class="btn btn-sm admin-only" data-act="user-new">${icon('plus')}Adicionar pessoa</button></div><div class="panel-body">
            <ul class="feed">${us.users.map(u => html`<li><span><b style="font-weight:600">${u.name}</b><br><span class="sys">${u.email}</span></span><span class="badge" style="margin-left:auto">${ROLE[u.role] || u.role}</span>${u.email === App.user.email ? '' : html`<button class="icon-btn admin-only" data-act="user-del" data-id="${u.id}" data-name="${u.name}" aria-label="Remover ${u.name}">${icon('trash')}</button>`}</li>`)}</ul>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Minha senha</h2></div><div class="panel-body">
            <form data-form="mypass" autocomplete="off"><label class="field"><span>Senha atual</span><input name="current" type="password" required autocomplete="current-password"></label>
              <label class="field"><span>Nova senha</span><input name="password" type="password" required minlength="8" autocomplete="new-password"><small>Mínimo de 8 caracteres.</small></label>
              <p class="form-error" role="alert" hidden></p><button class="btn btn-primary" type="submit">Trocar senha</button></form>
          </div></section>
        </div>
        <div class="grid g2e">
          <section class="panel"><div class="panel-head"><h2>Mensagens enviadas</h2><span class="hint">últimas 60</span></div><div class="panel-body" style="max-height:380px;overflow:auto">
            ${msg.messages.length ? html`<ul class="feed">${msg.messages.map(m => html`<li>${m.ok ? html`<span class="badge good">${icon('check')}Enviada</span>` : html`<span class="badge bad" title="${m.error || ''}">${icon('alert')}Falhou</span>`}<span><b style="font-weight:600">${m.to_name || m.to_phone}</b> <span class="sys">${m.kind}${m.ok ? '' : ' • ' + (m.error || '')}</span></span><time>${F.clock(m.ts)}</time></li>`)}</ul>` : html`<p class="muted small">Nenhuma mensagem enviada ainda.</p>`}
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Registro de ações</h2><span class="hint">quem fez o quê</span></div><div class="panel-body" style="max-height:380px;overflow:auto">
            ${au.audit.length ? html`<ul class="feed">${au.audit.map(a => html`<li><span><b style="font-weight:600">${a.action}</b> <span class="sys">${a.detail || ''}<br>${a.user}</span></span><time>${F.clock(a.ts)}</time></li>`)}</ul>` : html`<p class="muted small">Sem registros.</p>`}
          </div></section>
        </div>`);
    }
  };

  App.forms.wuz = async d => {
    const b = { wuzapi_url: d.wuzapi_url }; if (d.wuzapi_admin_token) b.wuzapi_admin_token = d.wuzapi_admin_token;
    await App.put('/settings', b); App.toast('Salvo. Agora escolha o número de envio.'); App.refresh();
  };
  App.forms.assist = async d => {
    const b = { assistant_model: d.assistant_model }; if (d.assistant_key) b.assistant_key = d.assistant_key;
    await App.put('/settings', b); App.toast('Assistente salvo.'); App.refresh();
  };
  App.actions['assist-test'] = async (d, btn) => { await App.busy(btn, async () => { const r = await App.post('/assistant/test'); App.toast('Conexão ok com ' + r.model + '.'); }); };
  App.actions['assist-clear'] = async () => { if (!await App.confirm('Remover a chave?', 'O assistente para de responder até você colocar outra chave.', 'Remover', true)) return; await App.put('/settings', { assistant_key_clear: true }); App.toast('Chave removida.'); App.refresh(); };
  App.actions['wuz-list'] = async (d, btn) => {
    const box = document.getElementById('wuzList');
    await App.busy(btn, async () => {
      const r = await App.get('/wuzapi/instances');
      box.innerHTML = r.instances.length ? html`<p class="small muted" style="margin-bottom:8px">Escolha o número do WhatsApp que enviará as mensagens:</p>${r.instances.map(i => html`<div class="lrow" style="grid-template-columns:1fr auto;padding:10px 0"><div class="main-cell"><b>${i.name}</b><small>${i.phone ? F.phone(i.phone) : 'sem número'} • ${i.logged_in ? 'conectado ao WhatsApp' : 'desconectado'}</small></div>
        ${i.selected ? html`<span class="badge good">${icon('check')}Em uso</span>` : html`<button class="btn btn-sm" data-act="wuz-pick" data-id="${i.id}" ${i.logged_in ? '' : 'disabled title="Conecte o número na WuzAPI primeiro"'}>Usar este</button>`}</div>`)}`.s
        : '<p class="muted small">A WuzAPI não tem nenhuma instância ainda. Crie uma lá e leia o QR Code.</p>';
    });
  };
  App.actions['wuz-pick'] = async d => { const r = await App.put('/wuzapi/instance', { id: d.id }); App.toast(`Enviando por “${r.name}”.`); App.refresh(); };
  App.forms.owners = async d => {
    await App.put('/settings', { owner_phones: String(d.phones || '').split('\n').map(x => x.trim()).filter(Boolean) }); App.toast('Números salvos.'); App.refresh();
  };
  App.actions['wuz-test'] = async () => {
    const st = await App.get('/settings'); const p = (st.owner_phones || [])[0];
    if (!p) return App.toast('Salve primeiro o WhatsApp de quem recebe.', true);
    await App.post('/wuzapi/test', { phone: p }); App.toast('Teste enviado para ' + F.phone(p) + '.');
  };
  App.actions['user-new'] = () => App.openModal('Adicionar pessoa', html`<form data-form="user"><label class="field"><span>Nome</span><input name="name" required></label><label class="field"><span>E-mail</span><input name="email" type="email" required></label>
    <label class="field"><span>Senha inicial</span><input name="password" required minlength="8" autocomplete="new-password"><small>Mínimo de 8 caracteres. A pessoa troca depois em “Minha senha”.</small></label>
    <label class="field"><span>Permissão</span><select name="role"><option value="viewer">Só visualiza (não altera nada)</option><option value="admin">Administrador (pode tudo)</option></select></label>
    <p class="form-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" type="button" data-act="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Adicionar</button></div></form>`);
  App.forms.user = async d => { await App.post('/users', d); App.closeModal(); App.toast('Pessoa adicionada.'); App.refresh(); };
  App.actions['user-del'] = async d => { if (!await App.confirm(`Remover ${d.name}?`, 'A pessoa perde o acesso à central agora.', 'Remover', true)) return; await App.del('/users/' + d.id); App.toast('Acesso removido.'); App.refresh(); };
  App.forms.mypass = async (d, form) => { await App.post('/password', { current: d.current, password: d.password }); form.reset(); App.toast('Senha trocada.'); };
})();
