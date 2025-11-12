# InnovadpStore - Painel Shopee (Picking & Faturamento)

Este é um sistema web para a InnovadpStore, integrado à Shopee Open Platform v2, para facilitar o processo de picking (separação de produtos) e visualização de métricas diárias.

## Funcionalidades

- **Leitura de Etiqueta Shopee**: Ao escanear o código de barras da etiqueta oficial, o sistema busca os detalhes do pedido.
- **Exibição Clara dos Itens**: Mostra produtos, variações, SKU e quantidades de forma organizada.
- **Dashboard Diário**: Apresenta a quantidade de pedidos e o faturamento estimado para o dia.
- **Interface Responsiva**: Otimizada para uso em desktops, tablets e celulares.
- **Segurança**: Nenhuma chave de API é exposta no frontend. Toda a comunicação com a Shopee é feita via backend.

## Stack Técnica

- **Framework**: Next.js 14 (App Router)
- **Linguagem**: TypeScript
- **Estilização**: Tailwind CSS
- **Plataforma de Deploy**: Vercel

---

## Tokens automáticos (Supabase)

Para evitar atualizar manualmente `SHOPEE_ACCESS_TOKEN`/`SHOPEE_REFRESH_TOKEN`, você pode armazenar o par no Supabase:

1. Crie a tabela:
   ```sql
   create table if not exists shopee_tokens (
     id text primary key,
     access_token text not null,
     refresh_token text,
     expires_at timestamptz,
     updated_at timestamptz default now()
   );
   ```
2. Adicione as variáveis no ambiente:
   ```
   SUPABASE_URL=https://SEU-PROJETO.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
   SHOPEE_TOKEN_TABLE=shopee_tokens
   SHOPEE_TOKEN_ID=default
   # Opcional: afinar a busca por pedidos lidos
   SCAN_ORDER_LOOKBACK_DAYS=15
   SCAN_ORDER_STATUSES=READY_TO_SHIP,PROCESSED,SHIPPED
   ```
3. Rode o fluxo OAuth (`/api/shopee/oauth/start`). O backend salva automaticamente o novo `access_token`/`refresh_token` e passa a renová-los quando a Shopee responder que expirou.


## 🚀 Começando

Siga os passos abaixo para configurar e rodar o projeto localmente.

### 1. Pré-requisitos

- [Node.js](https://nodejs.org/en/) (versão 18 ou superior)
- [npm](https://www.npmjs.com/) ou [yarn](https://yarnpkg.com/)

### 2. Configuração do Ambiente

Primeiro, clone o repositório e navegue até a pasta do projeto.

Em seguida, crie um arquivo para as variáveis de ambiente. Você pode copiar o arquivo de exemplo:

```bash
cp .env.example .env.local
```

Abra o arquivo `.env.local` e preencha com as suas credenciais da Shopee Open Platform:

```
SHOPEE_PARTNER_ID=SEU_PARTNER_ID
SHOPEE_PARTNER_KEY=SUA_PARTNER_KEY
SHOPEE_SHOP_ID=SEU_SHOP_ID
SHOPEE_ACCESS_TOKEN=SEU_ACCESS_TOKEN
SHOPEE_PUSH_PARTNER_KEY=SUA_CHAVE_DE_TESTE_PUSH (opcional)
```

### 3. Instalação das Dependências

Instale os pacotes necessários para o projeto:

```bash
npm install
# ou
yarn install
```

### 4. Rodando o Projeto

Com tudo configurado, inicie o servidor de desenvolvimento:

```bash
npm run dev
# ou
yarn dev
```

Abra [http://localhost:3000](http://localhost:3000) no seu navegador para ver a aplicação.

---

## 🛫 Deploy na Vercel

O deploy deste projeto na Vercel é um processo simples e direto.

1. **Crie uma conta na Vercel**: Acesse [vercel.com](https://vercel.com) e crie uma conta (pode usar sua conta do GitHub).
2. **Importe o Projeto**: No seu dashboard da Vercel, clique em "Add New..." → "Project" e importe o repositório do Git onde este código está.
3. **Configure as Variáveis de Ambiente**: Durante o processo de importação, a Vercel pedirá para configurar as variáveis de ambiente. Adicione as mesmas chaves e valores do seu arquivo `.env.local`.
4. **Deploy**: Clique em "Deploy". A Vercel irá construir e publicar seu site automaticamente. O framework (Next.js) será detectado e configurado sem a necessidade de ajustes manuais.

Após o deploy, você receberá uma URL pública para acessar sua aplicação.

---

## 🔔 Configuração do Push (Mecanismo de Empurrar)

Para receber notificações da Shopee (ex.: `order_status_push`), configure o webhook:

1) URL de Retorno de Chamada
- `https://SEU-PROJETO.vercel.app/api/shopee/push`
- Método: `POST`
- Content-Type: `application/json`
- Status: `LIGADO`

2) Área de Serviço de Implantação
- No painel Shopee: “Configurar Notificações Push” → “Área de Serviço de Implantação para URL de Retorno de Chamada”.
- Selecione a região mais próxima do seu deploy. O projeto aceita `gru1` (São Paulo) e `iad1` (US Leste).

3) Variáveis de Ambiente (Vercel → Project → Settings → Environment Variables)
- `SHOPEE_PUSH_PARTNER_KEY` → use a “Chave de parceiro de teste push” (para testes) ou a chave de produção.
- As chaves principais da Shopee também devem estar configuradas (`SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`, `SHOPEE_ACCESS_TOKEN`).

4) Teste
- Abra: `GET /api/shopee/push` → responde `{ ok: true }`.
- No painel Shopee, use “Obtenha o Test Push” e envie um evento (ex.: `order_status_push`).
- Veja os logs na Vercel: o endpoint registra headers, um resumo (`summary`) e `verified` com base na assinatura HMAC.
