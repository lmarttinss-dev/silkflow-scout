# ML Scout — Extensão Chrome para Mercado Livre

Extensão no estilo Olist Scout para análise de produtos no Mercado Livre.

## Funcionalidades

- **Score de produto** (0–100) calculado a partir de 4 dimensões:
  - Demanda (vendas e avaliações)
  - Oportunidade (concorrência)
  - Qualidade (nota/reviews)
  - Vendedor (reputação)
- **Painel lateral** com análise completa na página do produto
- **Posicionamento de preço** em relação aos concorrentes
- **Badge Scout** nos resultados de busca
- **Busca rápida** no popup da extensão
- **Cache inteligente** (5 minutos) para evitar excesso de requisições

## Instalação

1. Abra o Chrome e acesse `chrome://extensions`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `ml-scout`
5. A extensão aparecerá na barra de ferramentas

## Estrutura

```
ml-scout/
├── manifest.json       — Configuração da extensão (Manifest V3)
├── background.js       — Service worker: busca dados na API do ML com cache
├── content.js          — Script injetado nas páginas do ML
├── content.css         — Estilos do painel lateral e badges
├── popup.html/js/css   — Interface do popup da extensão
└── icons/              — Ícones 16×16, 48×48 e 128×128
```

## API utilizada

Utiliza exclusivamente a **API pública oficial do Mercado Livre** (sem autenticação):

- `GET /items/{id}` — Dados do produto
- `GET /users/{id}` — Reputação do vendedor
- `GET /categories/{id}` — Nome e hierarquia da categoria
- `GET /reviews/item/{id}` — Avaliações e nota média
- `GET /sites/MLB/search?q=...` — Busca para análise de concorrência

## Como funciona o Score

| Dimensão    | Peso | Base de cálculo                        |
|-------------|------|----------------------------------------|
| Demanda     | 35%  | `sold_quantity` + total de reviews     |
| Oportunidade| 25%  | Número de vendedores do mesmo produto  |
| Qualidade   | 20%  | `rating_average` + volume de reviews   |
| Vendedor    | 20%  | `level_id` de reputação + power seller |
