# SuperSaaS — a central dos seus sistemas

Um painel só para ver e mandar em tudo: **BarberSync, MotoStock, EstimaFood e Controle Fácil** (e qualquer sistema novo que ganhar o conector).

O que ele faz:
- **Painel em tempo real**: cada sistema tem um "batimento" (no ar / fora do ar), mais receita mensal, vencidos, movimento do dia.
- **Clientes de todos os sistemas numa lista só**: renovar, suspender, trocar senha, mandar mensagem.
- **Criar acessos** em qualquer sistema, direto daqui, com o login já funcionando e envio por WhatsApp.
- **Financeiro**: recebido, despesas, lucro, atrasados, quem vence nos próximos dias, planilha para baixar.
- **Relatórios por WhatsApp** (WuzAPI): diário, semanal e fechamento do mês, no horário que você escolher. Também avisa se um sistema cair.
- **Marketing**: sugestões automáticas, 8 estratégias prontas, comunicados em massa, funil de vendas e campanhas (custo por lead e por cliente).
- **Equipe**: crie pessoas "só visualiza" ou "administrador".

Os bancos de dados dos sistemas **não são misturados**. A central só conversa com cada sistema por um conector seguro.

---

## Passo 1 — Colocar o SuperSaaS no ar (EasyPanel)

1. Crie um projeto novo no EasyPanel e um serviço de aplicativo com esta pasta (GitHub ou upload).
2. Em **Variáveis de ambiente**, coloque:
   - `HUB_ADMIN_EMAIL` = seu e-mail (será seu login)
   - `HUB_ADMIN_PASSWORD` = uma senha forte (mínimo 8 caracteres)
3. Em **Volumes/Mounts**, crie um volume apontando para `/app/data` (é onde fica o banco; sem isso você perde tudo a cada atualização).
4. Porta do aplicativo: `3000`. Ligue o domínio com HTTPS.
5. Faça o deploy e abra o endereço. Entre com o e-mail e a senha que você definiu.

> Se você não definir `HUB_ADMIN_PASSWORD`, o sistema cria uma senha aleatória e mostra **uma vez** no log do serviço.

## Passo 2 — Colocar o conector em cada sistema

Cada zip de conector traz **só os arquivos que mudam**. Copie por cima do projeto do sistema, mantendo as pastas:

| Sistema | Arquivos |
|---|---|
| BarberSync | `hub-connector.js` e `server.js` |
| MotoStock | `routes/hub_connector.js` e `server.js` |
| EstimaFood | `hub-connector.js` e `routes.js` |
| Controle Fácil | `hub-connector.js` e `server.js` |

Depois, no EasyPanel **de cada sistema**:
1. Crie a variável `HUB_TOKEN` com uma senha longa e diferente para cada sistema (ex.: 40 letras e números aleatórios).
2. **Reconstrua a imagem** (Deploy/Rebuild). Só reiniciar não basta, porque os arquivos mudaram.

Sem `HUB_TOKEN`, o conector fica desligado e o sistema funciona exatamente como antes.

**Controle Fácil:** na central, cada **administrador** do Controle Fácil aparece como um cliente (vencimento = "acesso até", bloquear/desbloquear, renovar, nova senha). O Controle Fácil não guardava quanto cada administrador paga: use **Alterar** ao lado de "Mensalidade" na ficha do cliente (ou peça para a Safira). Opcional: a variável `HUB_PRECO_PADRAO` (ex.: `49.90`) vale para quem ainda não tem valor. "Uso" do administrador = recebimentos que ele lançou no Controle Fácil.

## Passo 3 — Conectar na central

Na central, vá em **Sistemas → Conectar sistema** e informe:
- o endereço público do sistema (ex.: `https://barbearia.seudominio.com`);
- o mesmo token que você criou em `HUB_TOKEN` daquele sistema.

Se o token estiver errado, ou o sistema fora do ar, a tela diz o motivo.

## Passo 4 — Ligar o WhatsApp (relatórios, avisos, cobranças)

Em **Configurações**:
1. **WhatsApp (WuzAPI)**: endereço da sua WuzAPI + token de administrador → Salvar → **Escolher número de envio** (o número precisa estar conectado lá).
2. **Quem recebe relatórios e avisos**: seu WhatsApp (um por linha) → Salvar → **Enviar teste**.
3. Em **Relatórios**, escolha o que quer receber e a hora (o diário já vem ligado às 8h).

## Passo 5 — Ligar a Safira (assistente de voz)

A Safira responde por voz qualquer pergunta sobre os seus sistemas (quem vence hoje, próximos vencimentos, atrasados, quanto entrou no mês, movimento, funil, quedas) e também **age**: renova, suspende, reativa, manda cobrança (para um cliente ou para todos os vencidos), manda mensagem, troca senha, cria acesso, lança no financeiro, envia relatório e move contatos no funil.

**Segurança das ações:** ela nunca executa direto. Antes, confere tudo no banco e diz exatamente o que vai fazer (ex.: "o vencimento passa de 25/11/2026 para 25/12/2026, lanço R$ 99,90 e aviso no WhatsApp. Posso fazer?"). Só depois do seu **"sim"** (ou do botão Confirmar) a ação acontece. "Não", fechar a janela ou mudar de assunto cancelam. Se o nome do cliente for ambíguo ou não existir, ela pergunta em vez de chutar. Só administradores podem mandar ela agir; quem só visualiza pode apenas perguntar. Tudo fica no Registro de ações como "(pela Safira)".

1. Crie uma chave em **console.anthropic.com → API Keys** (o uso é cobrado na sua conta da Anthropic, por pergunta; defina um limite de gasto mensal lá).
2. Na central, vá em **Configurações → Assistente (IA)**, cole a chave, clique em **Salvar** e depois em **Testar conexão**.
3. Abra a tela **Safira** no menu:
   - escolha a **voz** (as femininas aparecem primeiro) e clique em **Ouvir esta voz**;
   - em **Como ela te chama**, escreva o seu nome (ex.: Igor);
   - ligue **Ouvir "Olá, Safira"** e clique em **Permitir** quando o navegador pedir o microfone.
4. Pronto: com o sistema aberto, diga **"Olá, Safira"**. Ela cumprimenta, ouve a pergunta e responde falando. Pode emendar outra pergunta logo depois. Para encerrar, fique em silêncio ou diga "obrigado".
   Também dá para chamar pelo botão **Safira** no topo da tela, ou falar tudo de uma vez: "Safira, quem vence hoje?".

**Voz premium (opcional, recomendado):** em **Configurações → Voz premium da Safira (OpenAI)** cole uma chave da OpenAI (platform.openai.com → API keys, com saldo). Aí a Safira fala com vozes naturais (Marin, Coral, Nova, Shimmer, Sage…) igual em qualquer computador ou celular, e o globo reage à voz dela. Escolha a voz na tela **Safira**. Cada resposta custa poucos centavos; frases repetidas (cumprimentos) não são cobradas de novo. Se a OpenAI falhar, ela usa a voz do navegador automaticamente.
Observação: a OpenAI anunciou que o modelo de voz atual (gpt-4o-mini-tts) será desligado em 06/01/2027. Quando sair o substituto, basta definir a variável `TTS_MODEL` com o novo nome (ou atualizar o SuperSaaS).

Importante:
- O microfone **só funciona com endereço https://** (o domínio do EasyPanel já é https). Por IP sem https o navegador bloqueia.
- Use **Google Chrome** ou **Microsoft Edge** no computador. Sem a voz premium, as vozes vêm do navegador: no Edge aparecem as mais naturais (Francisca e Thalita). No **Linux**, o Chrome não tem voz em português: use o Edge ou a voz premium.
- Dica: no Edge, menu ⋯ → Aplicativos → **Instalar este site como aplicativo** deixa o SuperSaaS com ícone e janela própria.
- A voz, o nome e a ativação ficam guardados **em cada aparelho** (configure de novo se abrir em outro computador).
- No celular funciona tocando no botão Safira; deixar ouvindo "Olá, Safira" o tempo todo funciona melhor no computador.

---

## Combinados importantes

- **Senhas geradas aparecem uma única vez** na tela. Copie e entregue ao cliente (ou deixe a central enviar por WhatsApp).
- A central confere os sistemas a cada **30 segundos**. Se um sistema falhar duas vezes seguidas, ele aparece "Fora do ar" e você recebe um aviso no WhatsApp (e outro quando voltar).
- Renovar pela central **lança o pagamento no financeiro** (você pode desmarcar) e pode avisar o cliente.
- O faturamento "previsto" (receita mensal, a receber) soma **só os clientes ativos com a mensalidade em dia**. Bloqueados, vencidos e quem está sem data de vencimento ficam de fora; voltam a contar quando forem renovados ou reativados. O "recebido" é o que foi lançado no financeiro.
- Faça backup do volume `/app/data` da central de vez em quando.

## Variáveis opcionais da central

| Variável | Para que serve |
|---|---|
| `HUB_SYNC_SECONDS` | Intervalo de leitura dos sistemas (padrão 30, mínimo 15) |
| `HUB_JWT_SECRET` | Chave dos logins (se não definir, é criada e guardada sozinha) |
| `WUZAPI_URL`, `WUZAPI_ADMIN_TOKEN` | Valores iniciais da WuzAPI (dá para configurar pela tela) |
| `ANTHROPIC_API_KEY` | Chave da Safira (opcional: dá para colar pela tela) |
| `ASSISTANT_MODEL` | Modelo da Safira (opcional: dá para escolher pela tela) |
| `OPENAI_API_KEY` | Chave da voz premium (opcional: dá para colar pela tela) |
| `TTS_MODEL` | Modelo de voz da OpenAI (padrão `gpt-4o-mini-tts`) |
| `DB_PATH` | Troca o local do banco (padrão `/app/data/supersaas.db`) |

## Adicionar outro sistema no futuro

Mande o código do sistema (EvoCRM, Controle Fácil, MicroCred, ModaFlow…) que eu gero o conector no mesmo molde. Ele só precisa responder a 4 coisas: estado, lista de clientes, criar cliente e renovar/suspender/trocar senha.
