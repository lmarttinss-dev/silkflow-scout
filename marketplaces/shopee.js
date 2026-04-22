/**
 * Módulo Shopee — detecção de página e extração de dados do DOM.
 * Expõe o objeto global `Shopee` consumido pelo content.js.
 */
const Shopee = (() => {
  const NON_PRODUCT_PATHS = /\/(search|buyer|account|cart|checkout|help|chat|mall)\b/i;

  function isMatch(url) {
    return /shopee\.com\.br|shopee\.com/.test(new URL(url).hostname);
  }

  function isNonProductPage(url) {
    try {
      const { pathname } = new URL(url);
      if (pathname === '/' || pathname === '') return true;
      if (NON_PRODUCT_PATHS.test(pathname)) return true;
    } catch { /* URL inválida */ }
    return false;
  }

  // Shopee usa URLs no formato: /nome-do-produto-i.{shopId}.{itemId}
  function detect(url) {
    if (!isMatch(url) || isNonProductPage(url)) return null;

    const match = url.match(/\.(\d+)\.(\d+)(?:[?#]|$)/);
    if (match) {
      return { id: `${match[1]}.${match[2]}`, isCatalog: false, marketplace: 'shopee' };
    }

    return null;
  }

  function extractDomData() {
    try {
      const d = { title: '', price: 0, currency: 'BRL', condition: 'new',
                  seller: '', rating: 0, reviewCount: 0, category: '', soldEstimate: 0 };

      d.title = document.querySelector('._44qnta, [class*="product-name"]')
                  ?.textContent?.trim()
                || document.querySelector('meta[property="og:title"]')?.content
                || document.title.split('|')[0].trim();

      const priceEl = document.querySelector('._3n5NQx, [class*="price-current"]');
      if (priceEl) {
        d.price = parseFloat(priceEl.textContent.replace(/[R$.\s]/g, '').replace(',', '.')) || 0;
      }

      const ratingEl = document.querySelector('._3Oj5_n, [class*="rating-stars__star"]');
      d.rating = parseFloat(ratingEl?.textContent?.trim()) || 0;

      const soldEl    = document.querySelector('._22sp0A, [class*="sold"]');
      const soldMatch = soldEl?.textContent?.match(/([\d.]+)\s*(mil)?/i);
      if (soldMatch) {
        d.soldEstimate = soldMatch[2]
          ? Math.round(parseFloat(soldMatch[1]) * 1000)
          : parseInt(soldMatch[1].replace('.', ''));
      }

      d.seller = document.querySelector('._3Lybjn, [class*="seller-name"]')
                   ?.textContent?.trim() || '';

      return d.title ? d : null;
    } catch { return null; }
  }

  return { isMatch, detect, extractDomData };
})();
