# Silkflow Scout

Extensão Chrome para validação de produtos no Mercado Livre, Shopee e Amazon. Analisa demanda, concorrência, preços e reputação do vendedor para embasar decisões de importação.

Parte do ecossistema [Silkflow](https://github.com/lmarttinss-dev) — plataforma de gestão de importação simplificada da China.

---

## Funcionalidades

- **Score 0–100** calculado a partir de quatro dimensões: demanda, oportunidade, qualidade e vendedor
- **Painel lateral** com análise completa diretamente na página do produto
- **Posicionamento de preço** com barra visual em relação aos concorrentes
- **Estimativa de vendas mensais** baseada em `sold_quantity` e tempo do anúncio
- **Reputação do vendedor** com nível MercadoLíder e histórico de vendas
- **Buscar no 1688** — abre o 1688.com com o título traduzido para mandarim
- **Buscar no Alibaba** — abre o Alibaba.com com o título em inglês filtrando por Trade Assurance
- **Buscar por Imagem** — abre o Google Lens com a thumbnail do produto para correspondência visual exata
- **Fallback via DOM** quando a API retorna 403 — o painel sempre exibe alguma informação
- **Busca rápida** no popup da extensão com fallback para autosuggest
- **Cache de 5 minutos** no service worker para evitar excesso de requisições
- **Suporte a múltiplos marketplaces** com arquitetura modular

## Marketplaces suportados

| Marketplace    | Detecção | Extração DOM | API |
|----------------|----------|--------------|-----|
| Mercado Livre  | ✅ | ✅ | ✅ Mercado Livre API pública |
| Shopee         | ✅ | ✅ | 🔜 Em desenvolvimento |
| Amazon         | ✅ | ✅ | 🔜 Em desenvolvimento |

## Instalação

1. Clone o repositório
   ```bash
   git clone git@github.com:lmarttinss-dev/silkflow-scout.git
   ```
2. Abra o Chrome e acesse `chrome://extensions`
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação**
5. Selecione a pasta `silkflow-scout`

## Estrutura

```
silkflow-scout/
├── manifest.json             — Configuração da extensão (Manifest V3)
├── background.js             — Service worker: API, cache e análise de dados
├── content.js                — Orquestrador: detecta marketplace e renderiza painel
├── content.css               — Estilos do painel lateral
├── marketplaces/
│   ├── mercadolivre.js       — Detecção e extração DOM do Mercado Livre
│   ├── shopee.js             — Detecção e extração DOM da Shopee
│   └── amazon.js             — Detecção e extração DOM da Amazon
├── popup.html/js/css         — Interface do popup da extensão
├── icons/                    — Ícones 16×16, 48×48 e 128×128
└── docs/
    └── integracao-ml-scout.md — Integração com a plataforma Silkflow
```

## Como funciona o Score

| Dimensão     | Peso | Base de cálculo                        |
|--------------|------|----------------------------------------|
| Demanda      | 35%  | `sold_quantity` + total de avaliações  |
| Oportunidade | 25%  | Número de vendedores do mesmo produto  |
| Qualidade    | 20%  | `rating_average` + volume de reviews   |
| Vendedor     | 20%  | Nível de reputação + power seller      |

## API utilizada

Utiliza a **API pública oficial do Mercado Livre** sem autenticação:

| Endpoint | Uso |
|----------|-----|
| `GET /items/{id}` | Dados do produto |
| `GET /users/{id}` | Reputação do vendedor |
| `GET /categories/{id}` | Hierarquia da categoria |
| `GET /reviews/item/{id}` | Avaliações e nota média |
| `GET /sites/MLB/search?q=` | Análise de concorrência |

Quando a API retorna 403, a extensão extrai os dados diretamente do DOM da página (título, preço, avaliações, vendedor) e exibe a análise com indicador de dados parciais.

## Adicionando um novo marketplace

1. Crie `marketplaces/novaPlataforma.js` expondo o objeto:
   ```js
   const NovaPlataforma = (() => {
     function isMatch(url) { /* retorna true se for esse marketplace */ }
     function detect(url)   { /* retorna { id, isCatalog, marketplace } ou null */ }
     function extractDomData() { /* retorna dados extraídos do DOM */ }
     return { isMatch, detect, extractDomData };
   })();
   ```
2. Registre o módulo no array `MODULES` em `content.js`
3. Adicione os domínios em `matches` e `host_permissions` no `manifest.json`
