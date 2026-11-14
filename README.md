# Casamento Lucas & Karen

Site do casamento em duas partes:

1. **Área do casal** (`/painel`): painel privado para organizar o casamento, com login e só para os noivos. **Pronta.**
2. **Página dos convidados** (`/`): convite com data, local, traje, cardápio, confirmação de presença e lista de presentes (Pix/cartão). **Próxima etapa** (por enquanto é só um "em breve").

## O que tem no painel do casal

| Seção | Para que serve |
|---|---|
| **Início** | Contagem regressiva, progresso das tarefas, orçamento gasto, convidados confirmados, próximas tarefas e próximos pagamentos |
| **Tarefas** | Checklist por antecedência (12 meses antes → depois do casamento), com responsável (Lucas / Karen / Ambos), prazo e filtros. Botão para carregar um checklist sugerido com ~40 itens |
| **Orçamento** | Previsto × contratado × pago por categoria, teto do orçamento, vencimentos e vínculo com fornecedor |
| **Convidados** | Cada linha é um convite (pessoa, casal ou família): adultos/crianças, lado, grupo, presença, mesa, restrições alimentares, se o convite já foi enviado. Exporta planilha (CSV). Cada convite já ganha um **código único**, que vai virar o link pessoal de confirmação na página dos convidados |
| **Fornecedores** | Quem estão pesquisando e quem já contrataram, com valor, contato e links diretos para WhatsApp/Instagram |
| **Detalhes** | Data, locais, horários, traje, cardápio, mensagem e chave Pix: os dados que vão alimentar a página dos convidados |

## Ver o site antes de publicar

**Pelo navegador, sem instalar nada (GitHub Codespaces, gratuito):**
1. No GitHub, abra o repositório e escolha o branch `ccr-f32a6ecd-6jtww4`.
2. Clique em **Code → Codespaces → Create codespace on …** e espere carregar (1 a 2 minutos).
3. No terminal que aparece embaixo, digite `npm run demo` e aperte Enter.
4. Clique em **Open in Browser** no aviso que aparecer. Depois acrescente `/painel` no endereço.
5. Entre com `lucas@demo.com` (ou `karen@demo.com`), senha `demo1234`.
6. Quando terminar, feche a aba. O Codespace desliga sozinho depois de 30 minutos parado.

**No próprio computador:** instale o Node.js 22 (nodejs.org, versão LTS), baixe o projeto
(no GitHub: **Code → Download ZIP**), abra um terminal na pasta e rode `npm install` e depois `npm run demo`.
Abra http://localhost:3000/painel.

O `npm run demo` usa um banco separado com dados de exemplo e o recria do zero toda vez,
então pode mexer à vontade.

## Como rodar

Precisa do Node.js 22.13 ou mais novo. Não precisa instalar banco de dados: ele usa o SQLite que já vem no Node.

```bash
npm install

# criar as duas contas (rode uma vez para cada)
npm run user:create -- "Lucas" lucas@email.com "uma-senha-forte"
npm run user:create -- "Karen" karen@email.com "outra-senha-forte"

npm start
# abra http://localhost:3000/painel
```

Rodar `user:create` de novo com o mesmo e-mail troca a senha.

### Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DB_PATH` | `data/casamento.db` | Onde o banco fica salvo (a pasta `data/` não vai para o Git) |
| `COUPLE_USERS` | — | Cria as contas ao iniciar, útil em hospedagem: `Lucas:lucas@email.com:senha;Karen:karen@email.com:senha` |
| `NODE_ENV` | — | Use `production` em hospedagem com HTTPS (o cookie de login passa a ser só HTTPS) |

### Testes

```bash
npm test
```

## Segurança

- Senhas guardadas com hash (scrypt), nunca em texto puro.
- Login por sessão em cookie `HttpOnly`, que vale por 30 dias.
- O painel e toda a API do painel exigem login. Sem ele, a página redireciona para `/entrar` e a API responde 401.
- Limite de 10 tentativas de login a cada 15 minutos por IP.

## Estrutura

```
server/         servidor Express, banco SQLite, login e API
public/         páginas (convidados, login e painel do casal)
scripts/        criação de contas do casal
test/           testes automáticos da API
```
