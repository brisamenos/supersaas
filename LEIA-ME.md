# SuperSaaS — a central dos seus sistemas

Um painel só para ver e mandar em tudo: **BarberSync, MotoStock e EstimaFood** (e qualquer sistema novo que ganhar o conector).

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

Depois, no EasyPanel **de cada sistema**:
1. Crie a variável `HUB_TOKEN` com uma senha longa e diferente para cada sistema (ex.: 40 letras e números aleatórios).
2. **Reconstrua a imagem** (Deploy/Rebuild). Só reiniciar não basta, porque os arquivos mudaram.

Sem `HUB_TOKEN`, o conector fica desligado e o sistema funciona exatamente como antes.

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

---

## Combinados importantes

- **Senhas geradas aparecem uma única vez** na tela. Copie e entregue ao cliente (ou deixe a central enviar por WhatsApp).
- A central confere os sistemas a cada **30 segundos**. Se um sistema falhar duas vezes seguidas, ele aparece "Fora do ar" e você recebe um aviso no WhatsApp (e outro quando voltar).
- Renovar pela central **lança o pagamento no financeiro** (você pode desmarcar) e pode avisar o cliente.
- O faturamento "previsto" é a soma da mensalidade de quem está pagando. O "recebido" é o que foi lançado no financeiro.
- Faça backup do volume `/app/data` da central de vez em quando.

## Variáveis opcionais da central

| Variável | Para que serve |
|---|---|
| `HUB_SYNC_SECONDS` | Intervalo de leitura dos sistemas (padrão 30, mínimo 15) |
| `HUB_JWT_SECRET` | Chave dos logins (se não definir, é criada e guardada sozinha) |
| `WUZAPI_URL`, `WUZAPI_ADMIN_TOKEN` | Valores iniciais da WuzAPI (dá para configurar pela tela) |
| `DB_PATH` | Troca o local do banco (padrão `/app/data/supersaas.db`) |

## Adicionar outro sistema no futuro

Mande o código do sistema (EvoCRM, Controle Fácil, MicroCred, ModaFlow…) que eu gero o conector no mesmo molde. Ele só precisa responder a 4 coisas: estado, lista de clientes, criar cliente e renovar/suspender/trocar senha.
