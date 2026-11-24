// Marketing: segmentos de clientes, comunicados em massa pelo WhatsApp e estrategias prontas
const { db } = require('./db');
const { todayBR, fmtDate, brl, daysBetween, phone55, sleep, round2 } = require('./util');
const M = require('./metrics');
const wa = require('./wuzapi');

const SEGMENTS = {
  todos_ativos: 'Todos os clientes ativos', vencendo: 'Vencem em até 7 dias', vencidos: 'Mensalidade vencida', inativos: 'Pagando mas sem usar há 7+ dias',
  novos: 'Clientes novos (14 dias)', upgrade: 'Prontos para plano maior', suspensos: 'Suspensos', todos: 'Todos (inclusive suspensos)'
};

function segment(name, systemId) {
  const today = todayBR();
  let list = M.allClients();
  if (systemId) list = list.filter(c => c.system_id === Number(systemId));
  const paying = c => M.isPaying(c.state) || c.state === 'sem_vencimento'; // comunicados: ativos sem data também recebem
  switch (name) {
    case 'todos_ativos': return list.filter(paying);
    case 'vencendo': return list.filter(c => c.state === 'vencendo');
    case 'vencidos': return list.filter(c => c.state === 'vencido');
    case 'suspensos': return list.filter(c => c.state === 'suspenso');
    case 'inativos': return list.filter(c => paying(c) && (!c.last_activity || daysBetween(String(c.last_activity).slice(0, 10), today) >= 7) && daysBetween(String(c.remote_created_at || c.first_seen_at || today).slice(0, 10), today) >= 14);
    case 'novos': return list.filter(c => paying(c) && daysBetween(String(c.remote_created_at || c.first_seen_at || today).slice(0, 10), today) <= 14);
    case 'upgrade': {
      const out = [];
      for (const s of new Set(list.map(c => c.system_id))) {
        const cs = list.filter(c => c.system_id === s && paying(c) && c.price > 0); if (cs.length < 4) continue;
        const prices = [...new Set(cs.map(c => c.price))].sort((a, b) => a - b); if (prices.length < 2) continue;
        const act = cs.map(c => c.activity_month || 0).sort((a, b) => a - b), p75 = act[Math.floor(act.length * 0.75)] || 0;
        out.push(...cs.filter(c => c.price === prices[0] && (c.activity_month || 0) >= Math.max(p75, 1)));
      }
      return out;
    }
    default: return list;
  }
}

const render = (tpl, c) => String(tpl)
  .replace(/\{nome\}/gi, c.name || '').replace(/\{sistema\}/gi, c.system_name || '').replace(/\{vencimento\}/gi, c.expires_at ? fmtDate(c.expires_at) : '')
  .replace(/R\$\s*\{valor\}/gi, brl(c.price)).replace(/\{valor\}/gi, brl(c.price)).replace(/\{dias\}/gi, c.days_left === null || c.days_left === undefined ? '' : String(Math.abs(c.days_left)));

function preview(name, systemId, text) {
  const list = segment(name, systemId);
  const withPhone = list.filter(c => phone55(c.phone));
  return { total: list.length, with_phone: withPhone.length, without_phone: list.length - withPhone.length,
    sample: withPhone.slice(0, 2).map(c => ({ to: c.name, text: render(text || '', c) })), names: list.slice(0, 12).map(c => c.name) };
}

// Disparo em segundo plano (um por vez, com intervalo, para nao bloquear o numero do WhatsApp)
const jobs = new Map(); let seq = 0;
function startBroadcast(name, systemId, text, kind = 'comunicado') {
  const list = segment(name, systemId).filter(c => phone55(c.phone));
  const id = ++seq;
  const job = { id, total: list.length, sent: 0, failed: 0, done: false, errors: [], started_at: new Date().toISOString() };
  jobs.set(id, job);
  (async () => {
    for (const c of list) {
      const r = await wa.sendText(c.phone, render(text, c), { kind, name: c.name });
      if (r.ok) job.sent++; else { job.failed++; if (job.errors.length < 5) job.errors.push(`${c.name}: ${r.error}`); }
      await sleep(4000);
    }
    job.done = true;
  })().catch(e => { job.done = true; job.errors.push(e.message); });
  return job;
}
const getJob = id => jobs.get(Number(id)) || null;

// Estrategias prontas (ideias testadas + mensagem pronta para copiar)
const PLAYBOOKS = [
  { id: 'cobranca', icon: 'card', title: 'Cobrança amigável (vencidos)', goal: 'Recuperar mensalidades atrasadas sem estremecer a relação.', segment: 'vencidos',
    steps: ['Mande a mensagem no mesmo dia do vencimento e repita com 3 e 7 dias.', 'Sempre ofereça o Pix e diga que o acesso volta na hora.', 'Passados 10 dias, ligue: muitas vezes é esquecimento.'],
    message: 'Olá, {nome}! 👋 Passando para avisar que a mensalidade do {sistema} ({valor}) venceu em {vencimento}. Para continuar usando sem interrupção é só pagar pelo Pix e o acesso é liberado na hora. Qualquer dúvida, é só responder aqui. 🙏' },
  { id: 'renovacao', icon: 'clock', title: 'Lembrete de renovação', goal: 'Cobrar antes de vencer para evitar atraso.', segment: 'vencendo',
    steps: ['Envie 5 a 7 dias antes do vencimento.', 'Lembre o valor e a data.', 'Quem pagar adiantado pode ganhar um mimo (ex.: 1 semana grátis no plano anual).'],
    message: 'Oi, {nome}! Sua mensalidade do {sistema} vence em {dias} dia(s) ({vencimento}), no valor de {valor}. Pague pelo Pix e já fica tudo renovado. Obrigado por estar com a gente! 🚀' },
  { id: 'reativar', icon: 'sleep', title: 'Reativar quem não usa', goal: 'Evitar cancelamentos: quem não usa cancela.', segment: 'inativos',
    steps: ['Ofereça ajuda individual de 15 minutos (chamada ou áudio).', 'Mostre 1 recurso que gera dinheiro rápido.', 'Pergunte o que está faltando: vira ideia de melhoria.'],
    message: 'Oi, {nome}! Notei que você não tem usado o {sistema} ultimamente. Posso te ajudar a configurar e tirar mais resultado? Se quiser, marco 15 minutinhos com você. 😊' },
  { id: 'boasvindas', icon: 'rocket', title: 'Boas-vindas e primeiros passos', goal: 'Fazer o cliente novo ativar nos primeiros dias.', segment: 'novos',
    steps: ['Envie no dia seguinte ao cadastro.', 'Peça para ele cadastrar 3 itens/serviços e testar um pedido/agendamento.', 'Ofereça suporte direto no WhatsApp.'],
    message: 'Bem-vindo, {nome}! 🎉 Já conseguiu fazer os primeiros testes no {sistema}? Se precisar de ajuda para cadastrar tudo, me chama aqui que eu te guio passo a passo.' },
  { id: 'upgrade', icon: 'trend', title: 'Oferta de plano maior', goal: 'Aumentar o ticket de quem já usa bastante.', segment: 'upgrade',
    steps: ['Abordar só quem usa muito (o sistema já seleciona).', 'Mostrar o que ele ganha a mais, não o preço.', 'Oferecer 1 mês de teste do plano maior.'],
    message: 'Oi, {nome}! Vi que você usa bastante o {sistema} 👏 Tem um plano com mais recursos que combina com o seu momento. Quer testar 1 mês por nossa conta? Respondo qualquer dúvida por aqui.' },
  { id: 'indicacao', icon: 'handshake', title: 'Indicação premiada', goal: 'Trazer clientes novos sem gastar com anúncio.', segment: 'todos_ativos',
    steps: ['Ofereça 1 mês grátis para quem indicar e fechar.', 'Divulgue para quem usa há mais de 30 dias.', 'Registre cada indicação no funil como origem "Indicação".'],
    message: 'Oi, {nome}! Quer ganhar 1 mês grátis do {sistema}? 🎁 Indique um colega e, quando ele fechar, você ganha o mês. É só mandar o contato dele aqui!' },
  { id: 'pesquisa', icon: 'star', title: 'Pesquisa de satisfação', goal: 'Descobrir problemas antes do cancelamento e colher depoimentos.', segment: 'todos_ativos',
    steps: ['Pergunte uma nota de 0 a 10.', 'Quem der 9 ou 10: peça um depoimento curto.', 'Quem der menos de 7: ligue em até 24 horas.'],
    message: 'Oi, {nome}! De 0 a 10, quanto você recomendaria o {sistema} para um amigo? Sua resposta me ajuda muito a melhorar. 🙏' },
  { id: 'novidade', icon: 'sparkle', title: 'Anunciar novidade', goal: 'Mostrar valor contínuo e puxar o cliente de volta ao sistema.', segment: 'todos_ativos',
    steps: ['Fale do benefício, não do recurso técnico.', 'Inclua um vídeo curto de 30 segundos.', 'Convide para testar hoje.'],
    message: 'Novidade no {sistema}, {nome}! 🚀 Acabamos de lançar uma função nova que vai te poupar tempo. Entra lá hoje e me conta o que achou!' }
];

module.exports = { SEGMENTS, segment, preview, startBroadcast, getJob, PLAYBOOKS, render };
