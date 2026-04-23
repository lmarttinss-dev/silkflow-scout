# Silkflow Scout

Extensão Chrome para validação de produtos no Mercado Livre, Shopee e Amazon. Calcula um score 0–100 baseado em demanda, oportunidade, qualidade e reputação do vendedor, exibido em um painel lateral injetado diretamente na página do produto.

Parte do ecossistema [Silkflow](https://github.com/lmarttinss-dev) — plataforma de gestão de importação simplificada da China.

## Instalação

1. Clone o repositório e acesse `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação** e selecione a pasta `silkflow-scout`

Não há etapa de build — a extensão roda direto do código-fonte.

## Marketplaces suportados

| Marketplace   | Detecção | Extração DOM | API               |
|---------------|----------|--------------|-------------------|
| Mercado Livre | ✅        | ✅            | ✅ API pública ML  |
| Shopee        | ✅        | ✅            | 🔜 Em desenvolvimento |
| Amazon        | ✅        | ✅            | 🔜 Em desenvolvimento |

## Funcionalidades

- Score 0–100 com sub-scores de demanda, oportunidade, qualidade e vendedor
- Simulador de margem com margem bruta, margem líquida e ROI estimado
- Elegibilidade de importação: detecta automaticamente certificações exigidas (ANATEL, ANVISA, INMETRO)
- Regime aduaneiro automático (Remessa Conforme, Simplificada ou Formal)
- Demanda total do nicho estimada via `sold_quantity` dos concorrentes
- Posicionamento de preço em relação aos concorrentes
- Estimativa de vendas mensais do produto
- Fallback via DOM quando a API retorna 403
- Busca rápida no popup com fallback para autosuggest
- Cache de 5 minutos no service worker

## Documentação

- [Arquitetura e referência técnica](docs/architecture.md)
- [Integração com a plataforma Silkflow](docs/integracao-ml-scout.md)
