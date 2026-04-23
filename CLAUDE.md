# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Chrome extension (Manifest V3) that analyzes products on Mercado Livre, Shopee, and Amazon. It calculates a 0–100 score based on demand, opportunity, and quality, displayed in a slide-in panel injected into the marketplace page.

## How to load and test

There is no build step — the extension runs directly from source files.

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory
4. After any code change, click the reload icon on the extension card (or press `R` on chrome://extensions)

To see `background.js` logs: on chrome://extensions, click **Service Worker** next to the extension entry.

To see `content.js` / marketplace module logs: open DevTools on the marketplace page (the content script runs in the page context).

## Architecture

### Execution flow

Content scripts are injected in this order (defined in `manifest.json`):
1. `marketplaces/mercadolivre.js` → global `MercadoLivre`
2. `marketplaces/shopee.js` → global `Shopee`
3. `marketplaces/amazon.js` → global `Amazon`
4. `content.js` — consumes the three globals via `MODULES = [MercadoLivre, Shopee, Amazon]`

All scripts share the same content script scope, so globals from earlier files are visible to later ones.

### Module contract

Each marketplace module in `marketplaces/` is an IIFE that returns `{ isMatch, detect, extractDomData }`:

- `isMatch(url)` — returns `true` if the URL belongs to this marketplace
- `detect(url)` — returns `{ id, isCatalog, marketplace }` or `null` if the page isn't a product
- `extractDomData()` — returns an object with `{ title, price, currency, condition, seller, rating, reviewCount, category, soldEstimate }` scraped from the DOM, or `null`

### Communication

`content.js` → `background.js` via `chrome.runtime.sendMessage`:

| `type` | Purpose |
|---|---|
| `ANALYZE_PRODUCT` | Full analysis; passes `{ itemId, isCatalog, marketplace, domData }` |
| `SEARCH_PRODUCTS` | Quick search from popup; passes `{ query, site }` |
| `CLEAR_CACHE` | Clears the in-memory 5-minute cache in the service worker |

### API fallback chain

`background.js` has a 3-tier fallback for when the Mercado Livre public API returns 403:

1. Direct `GET /items/{id}` (or catalog search for `/p/` URLs)
2. Search by title using `domData.title` from content script
3. Build a synthetic item from `domData` with `_fromDom: true`

When `item._fromDom === true`, `analyzeProduct()` skips API calls for seller/category/reviews and uses the DOM-extracted values instead. The panel shows a `.mls-partial-banner` warning in this case.

### Score weights

| Dimension | Weight | Source |
|---|---|---|
| Demand | 40% | `sold_quantity` + review count |
| Opportunity | 35% | Same-item seller count + total category competition |
| Quality | 25% | `rating_average` + volume of reviews |

### Key identifiers

- Mercado Livre item IDs: `ML[A-Z]\d{8,}` (e.g. `MLB1234567890`)
- Catalog page IDs: prefix `/p/` in URL (e.g. `/p/MLB123456`)
- Shopee: ID extracted from URL pattern `.{shopId}.{itemId}`
- Amazon: ASIN from `/dp/{ASIN}` or `/product/{ASIN}`

### Adding a new marketplace

1. Create `marketplaces/novaPlataforma.js` exposing the module contract above
2. Register it in `MODULES` array in `content.js`
3. Add URL patterns to `matches` and `host_permissions` in `manifest.json`

## Git conventions

Commits seguem o padrão **Conventional Commits** em inglês:

```
<tipo>: <descrição curta no imperativo>
```

Tipos usados:

| Tipo | Quando usar |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Alterações em documentação |
| `refactor` | Refatoração sem mudança de comportamento |
| `chore` | Tarefas de manutenção (deps, configs) |
| `style` | Ajustes de CSS/layout sem lógica |

Exemplos:
```
feat: add fractional price extraction for Amazon
fix(background): correct DOM fallback for catalog items
docs: update README with modular marketplace structure
```

Escopo opcional entre parênteses quando a mudança é isolada em um módulo.

## File roles

| File | Role |
|---|---|
| `manifest.json` | Extension config — permissions, content script injection order |
| `background.js` | Service worker — API calls, 5-min Map cache, score calculation |
| `content.js` | Orchestrator — detects marketplace, injects toggle/panel, handles SPA navigation |
| `content.css` | Panel styles — dark theme, fixed right-side slide-in |
| `popup.html/js/css` | Extension popup — status, last analysis, quick search, settings |
| `marketplaces/*.js` | Per-marketplace detection and DOM extraction modules |
