# Arquitetura — Silkflow Scout

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

## Calculadora de custo de importação

```
Produto (BRL) = Preço China (U$) × 5,70
Imposto       = (Produto + Frete) × alíquota do regime
Custo total   = Produto + Frete + Imposto
Comissão ML   = Preço ML × 12%
Margem bruta  = Preço ML − Custo total − Comissão ML
```

| Regime                  | Faixa (U$)    | Imposto  |
|-------------------------|---------------|----------|
| Remessa Conforme        | Até 50        | 0%       |
| Importação Simplificada | 51–3.000      | 20%      |
| Importação Formal       | Acima de 3000 | Variável |

A cotação U$ 1 ≈ R$ 5,70 é estática e serve apenas como referência visual.

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
