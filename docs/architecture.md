# Arquitetura — Silkflow Scout

## Índice

- [Por que uma extensão?](#por-que-uma-extensão)
- [Estrutura de arquivos](#estrutura-de-arquivos)
- [Fluxo de execução](#fluxo-de-execução)
- [Contrato dos módulos de marketplace](#contrato-dos-módulos-de-marketplace)
- [Comunicação content ↔ background](#comunicação-content--background)
- [Cadeia de fallback da API (Mercado Livre)](#cadeia-de-fallback-da-api-mercado-livre)
- [Endpoints da API](#endpoints-da-api)
- [Score](#score)
  - [Pesos](#pesos)
  - [Tabela de Demanda](#tabela-de-demanda)
  - [Interpretação](#interpretação)
- [Demanda do nicho](#demanda-do-nicho)
- [Simulador de Margem](#simulador-de-margem)
- [Comparativo de Preço](#comparativo-de-preço)
- [Buscar Fornecedor](#buscar-fornecedor)
- [Elegibilidade de importação](#elegibilidade-de-importação)
  - [Mapa por ID de categoria](#mapa-por-id-de-categoria-prioritário)
  - [Fallback por palavras-chave](#fallback-por-palavras-chave-modo-dom)
- [Adicionando um novo marketplace](#adicionando-um-novo-marketplace)
- [Convenções de commit](#convenções-de-commit)

## Por que uma extensão?

A API pública do Mercado Livre não expõe tudo que um vendedor precisa para tomar decisões de importação.

**Lacunas da API:**
- Histórico de preços
- Posicionamento real dentro de uma categoria
- Volume de buscas orgânicas por termo

**O que a extensão acessa e a API não fornece:**
- Dados visíveis apenas no DOM — como contadores de "X vendidos" que o ML exibe para usuários logados mas não retorna na API
- Contexto de páginas de catálogo, que agrega vários vendedores em uma visão unificada
- Reação em tempo real a mudanças de layout do ML, sem depender de atualizações de contrato de API

**Vantagens operacionais:**
- Roda no contexto do navegador do usuário, aparecendo como tráfego orgânico — menos sujeito a bloqueios por rate limiting
- Acessa páginas que exigem login sem precisar gerenciar tokens OAuth
- Não requer servidor próprio para as requisições — o service worker faz as chamadas diretamente

É por isso que o fallback via DOM existe neste projeto: quando a API retorna 403, os dados ainda estão renderizados na página e a extensão os lê diretamente.

## Estrutura de arquivos

```
silkflow-scout/
├── manifest.json              — Configuração da extensão (Manifest V3)
├── background.js              — Service worker: API, cache, score e análise
├── content.js                 — Orquestrador: detecta marketplace e renderiza painel
├── content.css                — Estilos do painel lateral (dark theme)
├── popup.html / popup.js / popup.css — Interface do popup
├── marketplaces/
│   ├── mercadolivre.js        — Detecção e extração DOM do Mercado Livre
│   ├── shopee.js              — Detecção e extração DOM da Shopee
│   └── amazon.js              — Detecção e extração DOM da Amazon
└── docs/
    ├── architecture.md        — Este arquivo
    └── integracao-ml-scout.md — Integração com a plataforma Silkflow
```

## Fluxo de execução

Os content scripts são injetados na ordem do `manifest.json`:

1. `marketplaces/mercadolivre.js` → expõe global `MercadoLivre`
2. `marketplaces/shopee.js` → expõe global `Shopee`
3. `marketplaces/amazon.js` → expõe global `Amazon`
4. `content.js` → consome os três globais via `MODULES = [MercadoLivre, Shopee, Amazon]`

```
Página do produto
      │
      ▼
 content.js detecta marketplace e produto
      │  extractDomData() → título, preço, avaliações...
      ▼
 chrome.runtime.sendMessage(ANALYZE_PRODUCT)
      │
      ▼
 background.js (service worker)
      │  resolveItem() → API ML com fallback via DOM
      │  fetchML(seller, category, reviews, competition)
      │  calculateScore() + buildAnalysis()
      ▼
 content.js renderiza painel lateral
```

## Contrato dos módulos de marketplace

Cada módulo em `marketplaces/` é um IIFE que retorna:

| Função | Retorno |
|--------|---------|
| `isMatch(url)` | `true` se a URL pertence a esse marketplace |
| `detect(url)` | `{ id, isCatalog, marketplace }` ou `null` |
| `extractDomData()` | `{ title, price, currency, condition, seller, rating, reviewCount, category, soldEstimate }` ou `null` |

## Comunicação content ↔ background

| `type` | Payload | Finalidade |
|--------|---------|------------|
| `ANALYZE_PRODUCT` | `{ itemId, isCatalog, marketplace, domData }` | Análise completa do produto |
| `SEARCH_PRODUCTS` | `{ query, site }` | Busca rápida no popup |
| `TRANSLATE_TITLE` | `{ title, targetLang? }` | Traduz o título via Google Translate (`zh-CN` ou `en`; padrão: `zh-CN`) |
| `CLEAR_CACHE` | — | Limpa o cache de 5 min do service worker |

## Cadeia de fallback da API (Mercado Livre)

Quando a API retorna 403, `background.js` tenta três caminhos em sequência:

1. `GET /items/{id}` direto (ou busca por `catalog_product_id` em URLs `/p/`)
2. Busca por título via DOM: `GET /sites/MLB/search?q={título}`
3. Item sintético construído 100% a partir dos dados do DOM (`_fromDom: true`)

Quando `item._fromDom === true`, as chamadas de vendedor/categoria/reviews são puladas e o painel exibe um banner de dados parciais.

## Endpoints da API

API pública oficial do Mercado Livre, sem autenticação:

| Endpoint | Uso |
|----------|-----|
| `GET /items/{id}` | Dados do produto |
| `GET /users/{id}` | Reputação e histórico do vendedor |
| `GET /categories/{id}` | Hierarquia da categoria |
| `GET /reviews/item/{id}` | Avaliações e nota média |
| `GET /sites/{site}/search?q=` | Concorrência e busca por título |
| `GET /sites/{site}/search?catalog_product_id=` | Resolve páginas de catálogo |
| `GET /sites/{site}/autosuggest?q=` | Fallback de busca no popup |

API externa (sem autenticação):

| Endpoint | Uso |
|----------|-----|
| `GET translate.googleapis.com/translate_a/single` | Tradução do título para mandarim (1688) ou inglês (Alibaba) via `client=gtx` |

## Score

### Pesos

| Dimensão     | Peso | Fonte |
|--------------|------|-------|
| Demanda      | 35%  | `sold_quantity` + total de avaliações |
| Oportunidade | 25%  | Nº de vendedores do mesmo item + concorrência total |
| Qualidade    | 20%  | `rating_average` + volume de reviews |
| Vendedor     | 20%  | Nível de reputação + power seller status |

### Tabela de Demanda

| `sold_quantity`          | Pontuação |
|--------------------------|-----------|
| > 500                    | 100       |
| > 200                    | 85        |
| > 100                    | 70        |
| > 50                     | 55        |
| > 20                     | 40        |
| > 5                      | 25        |
| Sem vendas, > 50 reviews | 60        |
| Sem dados                | 10        |

### Interpretação

| Faixa  | Label     |
|--------|-----------|
| 75–100 | Excelente |
| 50–74  | Bom       |
| 30–49  | Regular   |
| 0–29   | Fraco     |

## Demanda do nicho

A função `getNicheDemand(competition)` em `background.js` aproveita o campo `sold_quantity` presente em cada item retornado pelo endpoint `/search`. Com os até 50 resultados da busca por título do produto, ela calcula:

- **Total**: soma de `sold_quantity` de todos os itens com pelo menos uma venda
- **Média**: média de vendas por anúncio na amostra
- **Tamanho da amostra**: número de itens com dados de venda

O resultado é exposto em `competition.nicheDemand` e exibido no painel abaixo da seção de oportunidade. Por ser uma amostra dos top 50 resultados de busca, o total representa um piso conservador do volume do nicho — não o mercado completo.

## Simulador de Margem

Permite calcular viabilidade financeira diretamente no painel, comparando o custo de importação da China com o preço atual do produto no marketplace.

**Fórmulas:**

```
Produto (BRL)      = Preço China (U$) × 5,70
Imposto importação = Produto (BRL) × alíquota do regime
Custo de importação = Produto + Imposto

Margem bruta       = Preço ML − Custo de importação
Margem líquida     = Preço ML − Custo de importação − Frete nacional − Comissão ML (12%)
ROI                = Margem líquida / (Custo de importação + Frete nacional) × 100%
```

| Regime                  | Faixa (U$)    | Imposto  |
|-------------------------|---------------|----------|
| Remessa Conforme        | Até 50        | 0%       |
| Importação Simplificada | 51–3.000      | 20%      |
| Importação Formal       | Acima de 3.000 | Variável |

A alíquota é determinada automaticamente pela elegibilidade de importação. A cotação U$ 1 ≈ R$ 5,70 é estática e serve apenas como referência visual.

**Interpretação das margens:**

| Resultado | Verde (≥30%) | Amarelo (≥15%) | Laranja (<15%) |
|-----------|-------------|----------------|----------------|
| Margem bruta | Excelente spread de importação | Margem razoável | Importação arriscada |
| Margem líquida | Operação saudável | Margem apertada | Prejuízo provável |
| ROI | Alto retorno | Retorno moderado | Retorno baixo |

## Comparativo de Preço

Card automático que mostra o preço-alvo de compra na China para três faixas de margem líquida, calculado diretamente do preço do marketplace sem nenhuma entrada do usuário.

**Fórmula (para cada margem alvo M):**

```
productBRL = (mlPrice × (1 - 0.12 - M) - freteNacional) / (1 + alíquota)
productUSD = productBRL / 5.70
```

| Parâmetro | Valor fixo |
|-----------|-----------|
| Comissão ML | 12% |
| Frete nacional | R$ 30 |
| Câmbio | U$ 1 ≈ R$ 5,70 |
| Alíquota | Determinada pelo regime de importação do produto |

| Resultado | Cor |
|-----------|-----|
| Margem 30% | Verde |
| Margem 20% | Amarelo |
| Margem 10% | Laranja |
| Inviável (productUSD ≤ 0) | Vermelho |

## Buscar Fornecedor

Dois botões no painel que abrem plataformas de fornecedores chineses com o título do produto traduzido automaticamente.

| Botão | Método | URL de destino | Observação |
|-------|--------|----------------|------------|
| 1688 | Tradução (Mandarim) | `s.1688.com/selloffer/offer_search.htm?keywords=` | — |
| Alibaba | Tradução (Inglês) | `alibaba.com/trade/search?SearchText=&fsb=y&IndexArea=product_en` | Trade Assurance ativo |
| Buscar por Imagem | Thumbnail do produto | `lens.google.com/uploadbyurl?url=` | Mais assertivo; desabilitado se sem thumbnail |

**Fluxo — botões de texto (1688 e Alibaba):**

1. Usuário clica no botão
2. `content.js` envia `TRANSLATE_TITLE` com `{ title, targetLang }` ao service worker
3. `background.js` chama `translate.googleapis.com` (`client=gtx`) e retorna o título traduzido
4. O título (primeiros 80 caracteres) monta a URL de busca; página abre em nova aba
5. Fallback: se a tradução falhar, usa o título original

**Fluxo — Google Lens:**

1. Usuário clica em "Buscar por Imagem"
2. `content.js` abre diretamente `lens.google.com/uploadbyurl?url=<thumbnail>` em nova aba
3. Se `data.thumbnail` não estiver disponível (modo DOM), o botão aparece desabilitado

## Elegibilidade de importação

### Mapa por ID de categoria (prioritário)

Quando a API retorna `category.path_from_root`, cada nó é verificado contra um mapa estático de IDs do Mercado Livre:

- **ANVISA**: Beleza, cuidados com a pele, maquiagem, farmácia, alimentos e bebidas
- **ANATEL**: Smartphones, tablets, notebooks, roteadores, câmeras IP, drones, TVs, áudio, redes
- **INMETRO**: Brinquedos em geral

### Fallback por palavras-chave (modo DOM)

Quando não há IDs de categoria (`_fromDom: true`), a verificação usa regex no título e categoria:

| Agência | Termos detectados (exemplos) |
|---------|------------------------------|
| ANATEL  | smartphone, tablet, notebook, roteador, drone, câmera IP |
| ANVISA  | cosmético, creme, shampoo, suplemento, whey, colágeno |
| INMETRO | brinquedo, boneca, capacete, tomada, extensão elétrica |

Produtos com termos como "arma de fogo", "munição" ou "medicamento controlado" são marcados como **Proibidos**.

## Adicionando um novo marketplace

1. Crie `marketplaces/novaPlataforma.js`:
   ```js
   const NovaPlataforma = (() => {
     function isMatch(url)     { /* true se for esse marketplace */ }
     function detect(url)      { /* { id, isCatalog, marketplace } ou null */ }
     function extractDomData() { /* dados do DOM ou null */ }
     return { isMatch, detect, extractDomData };
   })();
   ```
2. Adicione ao array `MODULES` em `content.js`
3. Inclua o script na lista `js` de `content_scripts` no `manifest.json` (antes de `content.js`)
4. Adicione os domínios em `matches` e `host_permissions` no `manifest.json`

## Convenções de commit

Padrão **Conventional Commits** em inglês:

| Tipo | Quando usar |
|------|-------------|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `refactor` | Refatoração sem mudança de comportamento |
| `docs` | Alterações em documentação |
| `style` | Ajustes de CSS/layout sem lógica |
| `chore` | Tarefas de manutenção |
