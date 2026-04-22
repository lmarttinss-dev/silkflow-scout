/**
 * Módulo Amazon — detecção de página e extração de dados do DOM.
 * Expõe o objeto global `Amazon` consumido pelo content.js.
 */
const Amazon = (() => {
  const NON_PRODUCT_PATHS = /\/(s|gp\/cart|gp\/account|ap\/|help|deals|b)\b/i;

  function isMatch(url) {
    return /amazon\.com\.br|amazon\.com/.test(new URL(url).hostname);
  }

  function isNonProductPage(url) {
    try {
      const { pathname } = new URL(url);
      if (pathname === '/' || pathname === '') return true;
      if (NON_PRODUCT_PATHS.test(pathname)) return true;
    } catch { /* URL inválida */ }
    return false;
  }

  // Amazon usa URLs no formato: /dp/{ASIN} ou /product/{ASIN}
  function detect(url) {
    if (!isMatch(url) || isNonProductPage(url)) return null;

    const match = url.match(/\/(?:dp|product)\/([A-Z0-9]{10})/i);
    if (match) {
      return { id: match[1], isCatalog: false, marketplace: 'amazon' };
    }

    return null;
  }

  function extractDomData() {
    try {
      const d = { title: '', price: 0, currency: 'BRL', condition: 'new',
                  seller: '', rating: 0, reviewCount: 0, category: '', soldEstimate: 0 };

      d.title = document.querySelector('#productTitle, #title')
                  ?.textContent?.trim()
                || document.querySelector('meta[name="title"]')?.content
                || document.title.split(':')[0].trim();

      const priceEl = document.querySelector('.a-price-whole, #priceblock_ourprice');
      const centsEl = document.querySelector('.a-price-fraction');
      if (priceEl) {
        const intPart  = priceEl.textContent.replace(/[R$.\s]/g, '').trim();
        const centPart = centsEl?.textContent?.trim() || '00';
        d.price = parseFloat(`${intPart}.${centPart}`) || 0;
      }

      const ratingEl = document.querySelector('#acrPopover, .a-icon-star');
      const ratingMatch = ratingEl?.getAttribute('title')?.match(/([\d,]+)/);
      d.rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : 0;

      const rcEl = document.querySelector('#acrCustomerReviewText');
      const rcMatch = rcEl?.textContent?.match(/([\d.,]+)/);
      d.reviewCount = rcMatch ? parseInt(rcMatch[1].replace(/[.,]/g, '')) : 0;

      d.seller = document.querySelector('#sellerProfileTriggerId, #bylineInfo')
                   ?.textContent?.trim() || '';

      const breadcrumbs = document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a');
      d.category = [...breadcrumbs].at(-1)?.textContent?.trim() || '';

      return d.title ? d : null;
    } catch { return null; }
  }

  return { isMatch, detect, extractDomData };
})();
