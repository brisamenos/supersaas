// Tela da Safira: o globo, a escolha da voz, a ativação por "Olá, Safira" e as últimas perguntas
(function () {
  'use strict';
  const { html, icon } = App;
  const Sf = () => App.safira;

  function voiceOptions(sel) {
    const vs = Sf().voices(), prem = vs.filter(x => x.premium), brw = vs.filter(x => !x.premium);
    const cur = sel || (vs[0] && vs[0].id);
    const opt = x => html`<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${x.label}${x.note ? ', ' + x.note : ''}${x.natural ? ' (natural)' : ''}${x.br ? '' : ' • Portugal'}</option>`;
    const grp = (label, list) => list.length ? html`<optgroup label="${label}">${list.map(opt)}</optgroup>` : '';
    return html`${prem.length ? html`${grp('Vozes premium (OpenAI) — femininas', prem.filter(x => x.gender === 'f'))}${grp('Vozes premium (OpenAI) — outras', prem.filter(x => x.gender !== 'f'))}` : html`<option value="" disabled>Vozes premium: coloque a chave da OpenAI em Configurações</option>`}
      ${grp('Navegador — femininas', brw.filter(x => x.gender === 'f'))}${grp('Navegador — outras', brw.filter(x => x.gender !== 'f' && x.gender !== 'm'))}${grp('Navegador — masculinas', brw.filter(x => x.gender === 'm'))}
      ${!vs.length ? html`<option value="">Nenhuma voz disponível neste navegador</option>` : ''}`;
  }
  const isPremium = id => /^openai:/.test(id || '');

  function historyList() {
    const h = Sf().history; const pairs = [];
    for (let i = 0; i < h.length; i++) if (h[i].role === 'user') pairs.push({ q: h[i].content, a: h[i + 1] && h[i + 1].role === 'assistant' ? h[i + 1].content : '' });
    if (!pairs.length) return html`<p class="muted small">Nada por aqui ainda. O que você perguntar à Safira aparece aqui para consultar depois.</p>`;
    return html`<ul class="saf-hist">${pairs.slice(-8).reverse().map(p => html`<li><b>${p.q}</b><span>${p.a}</span></li>`)}</ul>`;
  }

  App.views.assistente = {
    title: 'Safira',
    async render() {
      const st = await App.get('/settings'); Sf().setPremium(st.voice); const ready = st.assistant.ready, P = Sf().prefs;
      if (!P.voice && st.voice.ready) P.voice = 'openai:marin';
      const canMic = Sf().SR, secure = window.isSecureContext;
      App.render(html`
        ${ready ? '' : html`<div class="panel chat-banner" style="margin-top:8px"><span class="badge warn">${icon('alert')}Falta ligar</span> A Safira precisa da chave da API do Claude para consultar seus sistemas. <button class="linkish" data-act="goto" data-tab="config">Colocar a chave agora</button></div>`}
        ${canMic && !secure ? html`<div class="panel chat-banner" style="margin-top:8px"><span class="badge warn">${icon('alert')}Microfone bloqueado</span> Abra a central por um endereço <b>https://</b> para falar com a Safira.</div>` : ''}
        ${!canMic ? html`<div class="panel chat-banner" style="margin-top:8px"><span class="badge warn">${icon('alert')}Sem voz neste navegador</span> Use o Google Chrome ou o Microsoft Edge para falar com a Safira.</div>` : ''}
        <section class="saf-stage" style="margin-top:8px">
          <canvas id="safMini" aria-hidden="true"></canvas>
          <button class="saf-stage-hit" data-act="saf-open" aria-label="Falar com a Safira"></button>
          <div class="saf-stage-txt"><h2>Safira</h2><p>${P.wake ? html`Diga <b>“Olá, Safira”</b> em qualquer tela, ou toque no globo.` : html`Toque no globo para falar. Para chamar só com a voz, ligue <b>“Ouvir Olá, Safira”</b> abaixo.`}</p></div>
        </section>
        <div class="grid g2e">
          <section class="panel"><div class="panel-head"><h2>Voz da Safira</h2></div><div class="panel-body">
            <label class="field"><span>Voz</span><select id="safVoice">${voiceOptions(P.voice)}</select><small>${st.voice.ready ? 'As vozes premium soam iguais em qualquer computador ou celular.' : html`Para vozes premium (bem mais naturais), coloque a chave da OpenAI em <button class="linkish" data-act="goto" data-tab="config">Configurações</button>.`}</small></label>
            <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">
              <label class="field"><span>Velocidade <output id="safRateV">${P.rate.toFixed(2).replace('.', ',')}</output></span><input id="safRate" type="range" min="0.8" max="1.35" step="0.01" value="${P.rate}"></label>
              <label class="field"><span title="O tom vale só para as vozes do navegador">Tom <output id="safPitchV">${P.pitch.toFixed(2).replace('.', ',')}</output></span><input id="safPitch" type="range" min="0.7" max="1.4" step="0.01" value="${P.pitch}" ${isPremium(P.voice) ? 'disabled' : ''}></label>
            </div>
            <div class="row"><button class="btn btn-primary" data-act="saf-test">${icon('speaker')}Ouvir esta voz</button></div>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Como chamar</h2>${P.wake && canMic && secure ? html`<span class="badge good">${icon('check')}Ouvindo</span>` : ''}</div><div class="panel-body">
            <label class="switch"><input id="safWake" type="checkbox" ${P.wake ? 'checked' : ''} ${canMic && secure ? '' : 'disabled'}><span class="switch-ui" aria-hidden="true"></span><span><b>Ouvir “Olá, Safira”</b><small>Com o sistema aberto, ela atende quando você chama pelo nome. Se o microfone pedir permissão, clique em Permitir.</small></span></label>
            <label class="field" style="margin-top:14px"><span>Como ela te chama</span><input id="safName" value="${P.name}" maxlength="30" placeholder="Seu nome, por exemplo Igor"><small>Ela usa esse nome para cumprimentar: “Olá, Igor. Em que posso te ajudar?”</small></label>
            <p class="small muted" style="margin:6px 0 0">Ela responde sobre todos os sistemas e lojas: quem vence hoje, próximos vencimentos, atrasados, quanto entrou, movimento, funil e quedas. Ela só consulta; não altera nada.</p>
          </div></section>
        </div>
        <section class="panel"><div class="panel-head"><h2>Últimas perguntas</h2>${Sf().history.length ? html`<button class="linkish" data-act="saf-clear">Limpar</button>` : ''}</div><div class="panel-body">${historyList()}</div></section>`);

      const orb = Sf().Orb(document.getElementById('safMini'), true).start();
      App.cleanup.push(() => orb.stop());
      const $ = id => document.getElementById(id);
      $('safVoice').addEventListener('change', e => { P.voice = e.target.value; $('safPitch').disabled = isPremium(P.voice); Sf().test(P.voice); });
      $('safRate').addEventListener('input', e => { P.rate = Number(e.target.value); $('safRateV').textContent = P.rate.toFixed(2).replace('.', ','); });
      $('safPitch').addEventListener('input', e => { P.pitch = Number(e.target.value); $('safPitchV').textContent = P.pitch.toFixed(2).replace('.', ','); });
      $('safRate').addEventListener('change', () => Sf().test(P.voice)); $('safPitch').addEventListener('change', () => Sf().test(P.voice));
      $('safName').addEventListener('change', e => { P.name = e.target.value; App.toast('Pronto. A Safira vai te chamar de ' + (P.name || 'você') + '.'); });
      $('safWake').addEventListener('change', e => { Sf().setWake(e.target.checked); App.toast(e.target.checked ? 'Pode dizer “Olá, Safira”.' : 'A Safira parou de ouvir. Toque no botão Safira quando quiser falar.'); App.refresh({ silent: true }); });
      Sf().onVoices = () => { const s = $('safVoice'); if (s) s.innerHTML = voiceOptions(P.voice).s; };
      Sf().onChange = () => { if (App.current === 'assistente') App.refresh({ silent: true }); };
    }
  };
  App.actions['saf-open'] = () => Sf().open();
  App.actions['saf-test'] = () => Sf().test(document.getElementById('safVoice').value);
  App.actions['saf-clear'] = () => { Sf().clearHistory(); App.refresh({ silent: true }); };
})();
