// "Estrategias": o SuperSaaS olha os numeros e sugere o que fazer (cobrar, reativar, vender mais, captar...)
const { db } = require('./db');
const { todayBR, addDays, daysBetween, brl, round2 } = require('./util');
const M = require('./metrics');

function build() {
  const today = todayBR(), out = [];
  const clients = M.allClients();
  const systems = db.prepare('SELECT * FROM systems WHERE enabled = 1').all();
  const add = (level, icon, title, detail, action) => out.push({ level, icon, title, detail, action: action || null });

  // 1) sistemas fora do ar
  for (const s of systems.filter(s => s.status === 'offline')) add('alta', '🔴', `${s.name} está fora do ar`, `Os clientes do ${s.name} podem estar sem acesso. Último erro: ${s.last_error || 'sem resposta'}.`, { label: 'Ver sistemas', tab: 'sistemas' });

  // 2) inadimplentes
  const late = clients.filter(c => c.state === 'vencido');
  if (late.length) add('alta', '💸', `${late.length} cliente(s) com mensalidade vencida`, `São ${brl(late.reduce((s, c) => s + (c.price || 0), 0))} por mês parados. Cobre pelo WhatsApp hoje: a chance de pagar cai muito depois de 7 dias de atraso.`, { label: 'Cobrar agora', tab: 'marketing', segment: 'vencidos' });

  // 3) vencendo
  const soon = clients.filter(c => c.state === 'vencendo');
  if (soon.length) add('media', '⏰', `${soon.length} cliente(s) vencem nos próximos 7 dias`, `Renovação em risco de ${brl(soon.reduce((s, c) => s + (c.price || 0), 0))}. Envie um lembrete amigável com o valor e a forma de pagar.`, { label: 'Enviar lembrete', tab: 'marketing', segment: 'vencendo' });

  // 4) risco de cancelamento: ativo, ja tem 14+ dias de casa e sem movimento ha 7+ dias
  const idle = clients.filter(c => M.isPaying(c.state) && (!c.last_activity || daysBetween(String(c.last_activity).slice(0, 10), today) >= 7) && daysBetween(String(c.remote_created_at || c.first_seen_at || today).slice(0, 10), today) >= 14);
  if (idle.length) add('media', '😴', `${idle.length} cliente(s) pagando mas sem usar há 7+ dias`, `Quem não usa o sistema costuma cancelar. Ligue, ofereça um treinamento rápido ou ajuda para configurar. Hoje isso representa ${brl(idle.reduce((s, c) => s + (c.price || 0), 0))}/mês.`, { label: 'Falar com eles', tab: 'marketing', segment: 'inativos' });

  // 5) novos sem nenhum uso (onboarding)
  const fresh = clients.filter(c => M.isPaying(c.state) && daysBetween(String(c.remote_created_at || c.first_seen_at || today).slice(0, 10), today) <= 14 && (c.activity_month || 0) === 0);
  if (fresh.length) add('media', '🚀', `${fresh.length} cliente(s) novos ainda não usaram`, 'Os primeiros dias decidem se o cliente fica. Faça uma ligação de boas-vindas e ajude a cadastrar os primeiros itens.', { label: 'Ver clientes', tab: 'clientes' });

  // 6) upgrade: clientes de preco mais baixo do sistema com uso alto
  for (const s of systems) {
    const cs = clients.filter(c => c.system_id === s.id && M.isPaying(c.state) && c.price > 0);
    if (cs.length < 4) continue;
    const prices = [...new Set(cs.map(c => c.price))].sort((a, b) => a - b); if (prices.length < 2) continue;
    const low = cs.filter(c => c.price === prices[0]);
    const act = [...cs].map(c => c.activity_month || 0).sort((a, b) => a - b); const p75 = act[Math.floor(act.length * 0.75)] || 0;
    const up = low.filter(c => (c.activity_month || 0) >= Math.max(p75, 1));
    if (up.length) add('info', '📈', `${up.length} cliente(s) do ${s.name} prontos para um plano maior`, `Eles estão no plano mais barato (${brl(prices[0])}) e usam bastante o sistema. Oferecer o plano de ${brl(prices[prices.length - 1])} pode render +${brl(up.length * (prices[prices.length - 1] - prices[0]))}/mês.`, { label: 'Oferecer upgrade', tab: 'marketing', segment: 'upgrade', system_id: s.id });
  }

  // 7) venda cruzada: mesmo contato em um so sistema
  const groups = new Map();
  for (const c of clients.filter(c => M.isPaying(c.state))) { const key = (c.email || '').toLowerCase() || String(c.phone || '').replace(/\D/g, '').slice(-11); if (!key) continue; if (!groups.has(key)) groups.set(key, new Set()); groups.get(key).add(c.system_id); }
  const single = [...groups.values()].filter(g => g.size === 1).length;
  if (systems.length > 1 && single >= 3) add('info', '🔗', `${single} clientes usam só um dos seus sistemas`, 'Quem já confia em você compra de novo com facilidade. Mostre os outros sistemas (ex.: barbearia que também vende produtos, loja que quer delivery).', { label: 'Montar campanha', tab: 'marketing' });

  // 8) captacao: sistema sem cliente novo ha 30 dias
  for (const s of systems) {
    const cs = clients.filter(c => c.system_id === s.id); if (!cs.length) { add('media', '🌱', `${s.name} ainda não tem clientes`, 'Cadastre o primeiro cliente de teste ou comece uma campanha de captação para esse sistema.', { label: 'Criar acesso', tab: 'clientes' }); continue; }
    const novos = cs.filter(c => (c.remote_created_at || c.first_seen_at || '').slice(0, 10) >= addDays(today, -30)).length;
    if (!novos) add('media', '📣', `${s.name} não ganhou cliente novo em 30 dias`, 'Vale reforçar a captação: anúncio, indicação premiada ou demonstração gratuita.', { label: 'Ver campanhas', tab: 'marketing' });
  }

  // 9) concentracao de receita
  const mrr = clients.filter(c => M.isPaying(c.state)).reduce((s, c) => s + (c.price || 0), 0);
  const top = clients.filter(c => M.isPaying(c.state)).sort((a, b) => (b.price || 0) - (a.price || 0))[0];
  if (top && mrr > 0 && clients.length >= 5 && top.price / mrr > 0.25) add('info', '⚖️', `${top.name} responde por ${Math.round(top.price / mrr * 100)}% da sua receita`, 'Depender de um cliente só é arriscado. Diversifique captando mais clientes parecidos.', null);

  // 10) CRM: follow-ups atrasados e propostas paradas
  const fu = db.prepare("SELECT COUNT(*) c FROM leads WHERE stage NOT IN ('fechado','perdido') AND next_followup IS NOT NULL AND next_followup < ?").get(today).c;
  if (fu) add('alta', '📞', `${fu} lead(s) com retorno atrasado`, 'Lead que esfria é venda perdida. Retome o contato hoje.', { label: 'Abrir funil', tab: 'marketing', sub: 'funil' });
  const prop = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(value),0) v FROM leads WHERE stage = 'proposta'").get();
  if (prop.c) add('media', '🤝', `${prop.c} proposta(s) aguardando resposta`, `Há ${brl(prop.v)}/mês em negociação. Faça um follow-up curto e objetivo.`, { label: 'Abrir funil', tab: 'marketing', sub: 'funil' });

  // 11) campanhas: melhor e pior custo por cliente
  const camps = db.prepare("SELECT c.*, (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id) leads, (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id AND l.stage = 'fechado') fechados FROM campaigns c WHERE c.spent > 0").all().filter(c => c.fechados > 0);
  if (camps.length >= 2) { camps.forEach(c => c.cac = c.spent / c.fechados); camps.sort((a, b) => a.cac - b.cac); add('info', '🎯', `Melhor campanha: ${camps[0].name}`, `Custa ${brl(camps[0].cac)} por cliente fechado, contra ${brl(camps[camps.length - 1].cac)} da pior (${camps[camps.length - 1].name}). Mova o orçamento para a melhor.`, { label: 'Ver campanhas', tab: 'marketing', sub: 'campanhas' }); }

  const order = { alta: 0, media: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

module.exports = { build };
