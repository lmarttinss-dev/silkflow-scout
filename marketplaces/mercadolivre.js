/**
 * Módulo Mercado Livre — detecção de página e extração de dados do DOM.
 * Expõe o objeto global `MercadoLivre` consumido pelo content.js.
 */
const MercadoLivre = (() => {
  const NON_PRODUCT_PATHS = /\/(perfil|loja|seller|stores?|deals|ofertas|cupons?|cart|checkout|minha-conta|subscriptions?|help|ajuda|faq)\b/i;

  function isMatch(url) {
    return /mercadolivre\.com|mercadolibre\.com/.test(new URL(url).hostname);
  }

  function isNonProductPage(url) {
    try {
      const { pathname, hostname } = new URL(url);
      if (pathname === '/' || pathname === '') return true;
      if (NON_PRODUCT_PATHS.test(pathname)) return true;
      if (/^(auth|login|myaccount|account)\./.test(hostname)) return true;
    } catch { /* URL inválida */ }
    return false;
  }

  function detect(url) {
    if (!isMatch(url) || isNonProductPage(url)) return null;

    const catalog = url.match(/\/p\/(ML[A-Z]\d+)/i);
    if (catalog) return { id: catalog[1], isCatalog: true, marketplace: 'mercadolivre' };

    const itemInUrl = url.match(/\/(ML[A-Z]\d{8,})(?=[-._?#]|$)/i);
    if (itemInUrl) return { id: itemInUrl[1], isCatalog: false, marketplace: 'mercadolivre' };

    // URLs publicitárias: /up/MLBUxxx?pdp_filters=item_id:MLBxxxxxxx
    try {
      const pdpFilters = new URL(url).searchParams.get('pdp_filters') || '';
      const adItem = pdpFilters.match(/item_id:(ML[A-Z]\d{8,})/i);
      if (adItem) return { id: adItem[1], isCatalog: false, marketplace: 'mercadolivre' };
    } catch { /* URL inválida */ }

    for (const sel of ['meta[property="og:url"]', 'link[rel="canonical"]']) {
      const val = document.querySelector(sel)?.getAttribute('content')
                || document.querySelector(sel)?.getAttribute('href') || '';
      const cat = val.match(/\/p\/(ML[A-Z]\d+)/i);
      if (cat) return { id: cat[1], isCatalog: true, marketplace: 'mercadolivre' };
      const it = val.match(/\/(ML[A-Z]\d{8,})(?=[-._?#]|$)/i);
      if (it) return { id: it[1], isCatalog: false, marketplace: 'mercadolivre' };
    }

    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const types = [].concat(data['@type'] || []);
        if (types.some(t => /product|offer/i.test(t))) {
          const m = s.textContent.match(/(ML[A-Z]\d{8,})/);
          if (m) return { id: m[1], isCatalog: false, marketplace: 'mercadolivre' };
        }
      } catch { /* JSON-LD inválido */ }
    }

    return null;
  }

  function extractDomData() {
    try {
      const d = { title: '', price: 0, currency: 'BRL', condition: 'new',
                  seller: '', rating: 0, reviewCount: 0, category: '', soldEstimate: 0 };

      d.title = document.querySelector('h1.ui-pdp-title, h1.item-title__primary, h1')
                  ?.textContent?.trim()
                || document.querySelector('meta[property="og:title"]')?.content
                || document.title.split('|')[0].trim();

      // Preço com desconto (segunda linha) tem prioridade sobre o preço cheio riscado
      const priceContainer = document.querySelector('.ui-pdp-price__second-line, .ui-pdp-price--andes')
        || [...document.querySelectorAll('.andes-money-amount')]
             .find(el => !el.closest('s') && !el.classList.contains('ui-pdp-price--original'));
      const frac  = priceContainer?.querySelector('.andes-money-amount__fraction')
                 || document.querySelector('.price-tag-fraction');
      const cents = priceContainer?.querySelector('.andes-money-amount__cents')
                 || document.querySelector('.price-tag-cents');
      if (frac) {
        const intPart  = frac.textContent.replace(/\./g, '').trim();
        const centPart = cents ? cents.textContent.replace(',', '.').trim() : '00';
        d.price = parseFloat(`${intPart}.${centPart}`) || 0;
      }

      const sym = priceContainer?.querySelector('.andes-money-amount__currency-symbol')?.textContent?.trim()
               || document.querySelector('.price-tag-symbol')?.textContent?.trim();
      if (sym === 'US$') d.currency = 'USD';

      const subtitle = document.querySelector('.ui-pdp-subtitle')?.textContent?.toLowerCase() || '';
      if (subtitle.includes('usado')) d.condition = 'used';

      d.seller = document.querySelector(
        '.ui-pdp-seller__header-title, [class*="seller__link"]'
      )?.textContent?.trim() || '';

      const ratingEl = document.querySelector('.ui-review-capability__rating__average');
      d.rating = parseFloat(ratingEl?.textContent?.trim()) || 0;

      const rcMatch = document.querySelector('.ui-review-capability__rating__label')
                        ?.textContent?.match(/(\d[\d.]*)/);
      d.reviewCount = rcMatch ? parseInt(rcMatch[1].replace('.', '')) : 0;

      let soldEl = document.querySelector('[class*="sold"], [class*="vendidos"]');
      if (!soldEl) {
        for (const el of document.querySelectorAll('span, p, strong')) {
          if (el.children.length === 0 && /\+?\d[\d.]*\s*(mil\s+)?vendidos?/i.test(el.textContent)) {
            soldEl = el;
            break;
          }
        }
      }
      const soldMatch = soldEl?.textContent?.match(/\+?([\d.]+)\s*(mil)?/i);
      if (soldMatch) {
        d.soldEstimate = soldMatch[2]
          ? Math.round(parseFloat(soldMatch[1]) * 1000)
          : parseInt(soldMatch[1].replace('.', ''));
      }

      const breadcrumbs = document.querySelectorAll('.andes-breadcrumb__item a');
      d.category = [...breadcrumbs].at(-1)?.textContent?.trim() || '';

      d.thumbnail = document.querySelector('meta[property="og:image"]')?.content
                 || document.querySelector('img.ui-pdp-image')?.src
                 || '';

      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j    = JSON.parse(s.textContent);
          const prod = [j, ...(j['@graph'] || [])].find(x => /product/i.test(x['@type'] || ''));
          if (!prod) continue;
          if (!d.title && prod.name) d.title = prod.name;
          if (!d.price && prod.offers) {
            d.price    = parseFloat(prod.offers.price || prod.offers.lowPrice) || 0;
            d.currency = prod.offers.priceCurrency || d.currency;
          }
          if (prod.aggregateRating) {
            d.rating      = d.rating      || parseFloat(prod.aggregateRating.ratingValue) || 0;
            d.reviewCount = d.reviewCount || parseInt(prod.aggregateRating.reviewCount)   || 0;
          }
          if (!d.thumbnail && prod.image) {
            d.thumbnail = Array.isArray(prod.image) ? prod.image[0] : prod.image;
          }
        } catch { /* JSON-LD inválido */ }
      }

      return d.title ? d : null;
    } catch { return null; }
  }

  return { isMatch, detect, extractDomData };
})();
