# InnovadpStore - Painel Shopee (Picking & Faturamento)

Sistema web para a InnovadpStore integrado à Shopee Open Platform v2. Ele agiliza o processo de picking (separação de produtos), leitura de etiquetas oficiais e exibição de métricas diárias.

## Funcionalidades

- Leitura de etiqueta Shopee: escaneie o código (QR ou barras) e busque o pedido.
- Exibição clara dos itens: produtos, variações, SKU, quantidades e imagens.
- Dashboard do dia: total de pedidos, faturamento estimado e série por hora.
- Interface responsiva: usável em desktop, tablet e celular.
- Segurança: nenhuma chave é exposta no frontend; chamadas vão para o backend.

## Stack Técnica

- Framework: Next.js 14 (App Router)
- Linguagem: TypeScript
- Estilização: Tailwind CSS
- Estado remoto e caching: SWR
- Scanner: html5-qrcode (CARREGA no cliente, sem SSR)
- Deploy: Vercel

---

## Tokens e variáveis de ambiente

O backend utiliza exclusivamente variáveis de ambiente (`.env.local` em desenvolvimento ou Environment Variables no painel da Vercel). Sempre que gerar novos tokens pela Shopee:

1. Execute o fluxo OAuth: `GET /api/shopee/oauth/start` → autorize → callback `GET /api/shopee/oauth/callback`.
2. Anote `access_token`, `refresh_token` e o `shop_id` retornado.
3. Atualize as variáveis: `SHOPEE_ACCESS_TOKEN`, `SHOPEE_REFRESH_TOKEN` e `SHOPEE_SHOP_ID`.
4. Reinicie o servidor local (`npm run dev`) ou faça novo deploy na Vercel para aplicar.
5. Quando a Shopee indicar expiração do token, o backend tenta renová-lo automaticamente e registra nos logs os novos valores; copie-os para as variáveis para persistirem entre execuções/deploys.

### Variáveis obrigatórias e opcionais

- Obrigatórias:
  - `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`
  - `SHOPEE_ACCESS_TOKEN`, `SHOPEE_REFRESH_TOKEN`
- Opcionais / avançadas:
  - `SHOPEE_API_URL` (padrão: `https://partner.shopeemobile.com`)
  - `SCAN_ORDER_STATUSES` (lista de status para varrer no scan; padrão: `READY_TO_SHIP,PROCESSED,SHIPPED`)
  - `SCAN_ORDER_LOOKBACK_DAYS` (dias de histórico no scan; padrão: `15`)
  - `SHOPEE_MAX_ORDER_PAGES` (páginas por status; padrão: `5`)
  - `TODAY_STATS_CACHE_MS` (TTL do cache de métricas; padrão: `60000`)
  - `SHOPEE_PUSH_PARTNER_KEY` (recomendado para validar a assinatura do webhook Push)

Para iniciar, copie o template e preencha:

```bash
cp .env.example .env.local
```

---

## Como começar

### 1) Pré-requisitos

- Node.js 18+
- npm ou yarn

### 2) Instalação

```bash
npm install
# ou
yarn install
```

### 3) Desenvolvimento

```bash
npm run dev
# ou
yarn dev
```

Abra http://localhost:3000.

---

## Fluxo principal (resumo)

- Home (`app/page.tsx`) lê o código via câmera ou input. O valor é normalizado e enviado a `GET /api/scan?code=...`.
- API `scan` (`app/api/scan/route.ts`) usa `lib/shopee.ts` para encontrar o pedido por `order_sn` ou rastreio (ex.: BR...). Retorna itens, comprador, método de pagamento, transportadora e imagem.
- Métricas do dia em `GET /api/today` agregam totais e série por hora com cache em memória (`lib/cache.ts`).
- Webhook Push (`POST /api/shopee/push`) valida a assinatura (HMAC) com `SHOPEE_PUSH_PARTNER_KEY` e invalida o cache de métricas quando chegam eventos de pedido.

---

## Deploy na Vercel

1. Importe o repositório no painel da Vercel (Add New → Project).
2. Configure as variáveis de ambiente (Production/Preview/Development) com os mesmos valores do `.env.local`.
3. Clique em Deploy.

Dicas de sincronização via CLI:

```bash
vercel link              # associa a pasta ao projeto
vercel env add NAME env  # adiciona variáveis
vercel env pull .env.local
```

`vercel.json` define a região `gru1` (São Paulo). Ajuste se necessário.

---

## Configuração do Push (Webhook)

1) Endpoint

- URL: `https://SEU-PROJETO.vercel.app/api/shopee/push`
- Método: `POST`
- Content-Type: `application/json`
- Status: Ativado

2) Região de serviço (no painel Shopee)

- Selecione a região do seu deploy. O projeto aceita `gru1` (São Paulo) e `iad1` (US Leste).

3) Variáveis na Vercel

- `SHOPEE_PUSH_PARTNER_KEY` (Live Push Key de testes/produção)
- `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`, `SHOPEE_ACCESS_TOKEN`

4) Teste rápido

- `GET /api/shopee/push` → responde `{ ok: true }`.
- No painel Shopee, acione o Test Push (por exemplo, `order_status_push`).
- Verifique logs na Vercel (headers, resumo e `verified`).

---

## Notas e resolução de problemas

- Se `/api/today` falhar, revise as variáveis obrigatórias e faça novo deploy.
- O refresh do token é automático em runtime, mas não é persistido: copie os valores de `access_token`/`refresh_token` dos logs para o ambiente para manter após reiniciar ou fazer deploy.
- A busca por `order_sn` primeiro tenta direto; se falhar, a API varre pedidos recentes por status e compara contra o rastreio/order_sn lido.

