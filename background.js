const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchML(url, { optional = false } = {}) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      // O ML bloqueia requests sem Referer do próprio domínio
      'Referer': 'https://www.mercadolivre.com.br/'
    }
  });
  if (!response.ok) {
    if (optional) return null;
    throw new Error(`API ${response.status} em ${new URL(url).pathname}`);
  }
  const data = await response.json();
  cache.set(url, { data, timestamp: Date.now() });
  return data;
}

function getSiteFromItemId(itemId) {
  // Extrai apenas as letras iniciais antes dos dígitos
  const siteCode = itemId.match(/^[A-Z]+/)?.[0] || 'MLB';
  const sites = { MLB: 'MLB', MLA: 'MLA', MLM: 'MLM', MCO: 'MCO', MLU: 'MLU' };
  return sites[siteCode] || 'MLB';
}

async function searchFirstItem(site, BASE, query) {
  const q = encodeURIComponent(query.substring(0, 60).replace(/[^\w\s]/g, '').trim());
  const result = await fetchML(`${BASE}/sites/${site}/search?q=${q}&limit=5`, { optional: true });
  return result?.results?.[0] ?? null;
}

// Cria um item sintético a partir dos dados do DOM quando a API não responde
function buildSyntheticItem(itemId, domData) {
  return {
    id: itemId,
    title: domData.title,
    price: domData.price || 0,
    currency_id: domData.currency || 'BRL',
    condition: domData.condition === 'used' ? 'used' : 'new',
    sold_quantity: domData.soldEstimate || 0,
    available_quantity: null,
    seller_id: null,
    category_id: null,
    date_created: null,
    _fromDom: true   // indica que veio do DOM, não da API
  };
}

async function resolveItem(itemId, isCatalog, site, BASE, domData) {
  // Catálogo: busca pelos itens listados nesse produto
  if (isCatalog) {
    const catalogSearch = await fetchML(
      `${BASE}/sites/${site}/search?catalog_product_id=${itemId}&limit=20`,
      { optional: true }
    );
    if (catalogSearch?.results?.length) {
      const found = await fetchML(`${BASE}/items/${catalogSearch.results[0].id}`, { optional: true });
      if (found) return found;
    }
    // Fallback: busca por título do DOM
    if (domData?.title) {
      const found = await searchFirstItem(site, BASE, domData.title);
      if (found) {
        const item = await fetchML(`${BASE}/items/${found.id}`, { optional: true });
        if (item) return item;
      }
    }
    if (domData?.title) return buildSyntheticItem(itemId, domData);
    throw new Error('Produto de catálogo não encontrado.');
  }

  // Tenta acesso direto ao item
  const directItem = await fetchML(`${BASE}/items/${itemId}`, { optional: true });
  if (directItem) return directItem;

  // Fallback 1: busca por título do DOM e tenta o primeiro resultado
  if (domData?.title) {
    const found = await searchFirstItem(site, BASE, domData.title);
    if (found) {
      const item = await fetchML(`${BASE}/items/${found.id}`, { optional: true });
      if (item) return item;
    }
  }

  // Fallback 2: item sintético completo a partir do DOM — sempre funciona
  if (domData?.title) return buildSyntheticItem(itemId, domData);

  throw new Error('Produto não encontrado. Abra a página de um anúncio específico.');
}

async function analyzeProduct(itemId, isCatalog = false, domData = null) {
  const BASE = 'https://api.mercadolibre.com';
  const site = getSiteFromItemId(itemId);

  const item = await resolveItem(itemId, isCatalog, site, BASE, domData);

  // Quando veio do DOM, pula chamadas que precisam de seller_id / category_id
  let seller = null, category = null, reviews = null;

  if (!item._fromDom) {
    const [sellerRes, categoryRes, reviewsRes] = await Promise.allSettled([
      fetchML(`${BASE}/users/${item.seller_id}`),
      fetchML(`${BASE}/categories/${item.category_id}`),
      fetchML(`${BASE}/reviews/item/${item.id}`, { optional: true })
    ]);
    seller   = sellerRes.status   === 'fulfilled' ? sellerRes.value   : null;
    category = categoryRes.status === 'fulfilled' ? categoryRes.value : null;
    reviews  = reviewsRes.status  === 'fulfilled' ? reviewsRes.value  : null;
  } else if (domData) {
    // Constrói reviews e seller sintéticos a partir do DOM
    reviews = {
      rating_average: domData.rating || 0,
      paging: { total: domData.reviewCount || 0 }
    };
    if (domData.seller) {
      seller = { nickname: domData.seller, seller_reputation: null };
    }
    if (domData.category) {
      category = { name: domData.category, path_from_root: [] };
    }
  }

  const searchTitle = item.title.substring(0, 60).replace(/[^\w\s]/g, '').trim();
  const encodedTitle = encodeURIComponent(searchTitle);

  const [competitionResult, sameItemResult] = await Promise.allSettled([
    fetchML(`${BASE}/sites/${site}/search?q=${encodedTitle}&limit=50`, { optional: true }),
    fetchML(`${BASE}/sites/${site}/search?item_id=${item.id}&limit=20`, { optional: true })
  ]);

  const competition = competitionResult.status === 'fulfilled' ? competitionResult.value : null;
  const sameItem    = sameItemResult.status    === 'fulfilled' ? sameItemResult.value    : null;

  const score    = calculateScore({ item, seller, reviews, competition, sameItem });
  const analysis = buildAnalysis({ item, seller, category, reviews, competition, sameItem, score });

  if (item._fromDom) analysis.partialData = true;

  return analysis;
}

function calculateScore({ item, seller, reviews, competition, sameItem }) {
  let demandScore = 0;
  let opportunityScore = 0;
  let qualityScore = 0;
  let sellerScore = 0;

  // Demand: based on sold_quantity and reviews
  const sold = item.sold_quantity || 0;
  const reviewCount = reviews?.paging?.total || 0;
  if (sold > 500) demandScore = 100;
  else if (sold > 200) demandScore = 85;
  else if (sold > 100) demandScore = 70;
  else if (sold > 50) demandScore = 55;
  else if (sold > 20) demandScore = 40;
  else if (sold > 5) demandScore = 25;
  else if (reviewCount > 50) demandScore = 60;
  else if (reviewCount > 20) demandScore = 40;
  else if (reviewCount > 5) demandScore = 25;
  else demandScore = 10;

  // Opportunity: fewer same-item sellers = better opportunity
  const numSellers = sameItem?.paging?.total || 0;
  const totalCompetition = competition?.paging?.total || 0;
  if (numSellers <= 1) opportunityScore = 100;
  else if (numSellers <= 3) opportunityScore = 80;
  else if (numSellers <= 10) opportunityScore = 60;
  else if (numSellers <= 30) opportunityScore = 40;
  else opportunityScore = 20;

  // Adjust by total category competition
  if (totalCompetition < 100) opportunityScore = Math.min(100, opportunityScore + 10);
  else if (totalCompetition > 5000) opportunityScore = Math.max(0, opportunityScore - 10);

  // Quality: based on reviews rating
  const rating = reviews?.rating_average || 0;
  if (rating >= 4.8) qualityScore = 100;
  else if (rating >= 4.5) qualityScore = 85;
  else if (rating >= 4.0) qualityScore = 70;
  else if (rating >= 3.5) qualityScore = 50;
  else if (rating >= 3.0) qualityScore = 35;
  else if (rating > 0) qualityScore = 20;
  else qualityScore = 50; // No reviews yet

  if (reviewCount > 100) qualityScore = Math.min(100, qualityScore + 5);

  // Seller: based on reputation
  const repLevel = seller?.seller_reputation?.level_id || '';
  const powerSeller = seller?.seller_reputation?.power_seller_status || '';
  const reputationMap = {
    '5_green': 100, '4_light_green': 80,
    '3_yellow': 60, '2_orange': 40, '1_red': 20
  };
  sellerScore = reputationMap[repLevel] || 50;
  if (powerSeller === 'platinum') sellerScore = Math.min(100, sellerScore + 10);
  else if (powerSeller === 'gold') sellerScore = Math.min(100, sellerScore + 5);

  const total = Math.round(
    demandScore * 0.35 +
    opportunityScore * 0.25 +
    qualityScore * 0.20 +
    sellerScore * 0.20
  );

  return { total, demand: demandScore, opportunity: opportunityScore, quality: qualityScore, seller: sellerScore };
}

function estimateMonthlySales(item, reviews) {
  const sold = item.sold_quantity || 0;
  if (sold > 0) {
    // Estimate based on listing age
    const created = new Date(item.date_created);
    const now = new Date();
    const monthsOld = Math.max(1, (now - created) / (1000 * 60 * 60 * 24 * 30));
    return Math.round(sold / monthsOld);
  }
  // Fallback: estimate from reviews (roughly 10% of buyers leave reviews)
  const reviewCount = reviews?.paging?.total || 0;
  return Math.round(reviewCount * 0.5);
}

function getPriceStats(competition, currentPrice) {
  if (!competition?.results?.length) return null;

  const prices = competition.results
    .map(r => r.price)
    .filter(p => p > 0 && p < currentPrice * 3);

  if (prices.length === 0) return null;

  prices.sort((a, b) => a - b);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const position = prices.findIndex(p => p >= currentPrice);
  const percentile = Math.round((position / prices.length) * 100);

  return { min, max, avg: Math.round(avg * 100) / 100, percentile };
}

// Regras de certificação por palavras-chave no caminho da categoria / título
const IMPORT_RULES = [
  {
    agency: 'ANATEL',
    reason: 'Equipamentos com rádio ou telecomunicação exigem certificação',
    pattern: /celular|smartphone|tablet|notebook|computador|roteador|modem|wi-fi|wifi|bluetooth|drone|câmera\s*ip|gps|walkie|radio|antena|tv\s|televisão|monitor|console|videogame|fone|headset|caixa\s*de\s*som|speaker/i
  },
  {
    agency: 'ANVISA',
    reason: 'Cosméticos, suplementos e alimentos exigem registro sanitário',
    // Categorias ML: "Beleza e Cuidado Pessoal", "Saúde", "Alimentos e Bebidas"
    // Formas cosméticas: emulsão, sérum, loção, gel, tônico, esfoliante, máscara...
    // Produtos capilares: capilar, leave-in, finalizador, alisamento, tintura, coloração...
    pattern: /beleza\s*e\s*cuidado|cuidado\s*pessoal|higiene\s*pessoal|saúde\s*e\s*bem[-\s]estar|alimentos\s*e\s*bebidas|cosmético|perfume|creme|protetor\s*solar|shampoo|condicionador|maquiagem|batom|base\s*facial|capilar|emulsão|sérum|séro|loção|tônico|esfoliante|máscara\s*(capilar|facial|de\s*cabelo)|leave[-\s]in|finalizador|alisamento|tintura|coloração\s*capilar|hidratante|sabonete|desodorante|creme\s*dental|pasta\s*de\s*dente|enxaguante|suplemento|vitamina|proteína|whey|colágeno|alimento|bebida|café|chá\s|energético/i
  },
  {
    agency: 'INMETRO',
    reason: 'Brinquedos e equipamentos elétricos exigem certificação de segurança',
    pattern: /brinquedo|boneca|carrinho\s*de\s*brinquedo|lego|massinha|quebra-cabeça|capacete|extintor|cabo\s*elétrico|tomada|extensão\s*elétrica/i
  }
];

const PROHIBITED_PATTERN = /arma\s*de\s*fogo|munição|explosivo|narcótico|medicamento\s*controlado|remédio\s*controlado/i;

// Mapa estático: category_id do ML → agência reguladora
// Cobre automaticamente todos os filhos via path_from_root — sem depender de keywords no título
const CATEGORY_AGENCY_MAP = {
  // ANVISA — Beleza, Higiene, Alimentos
  'MLB1246':   { agency: 'ANVISA',  reason: 'Beleza e Cuidado Pessoal exige registro sanitário' },
  'MLB1263':   { agency: 'ANVISA',  reason: 'Cuidados com o Cabelo exige registro sanitário' },
  'MLB199407': { agency: 'ANVISA',  reason: 'Cuidados com a Pele exige registro sanitário' },
  'MLB1248':   { agency: 'ANVISA',  reason: 'Maquiagem exige registro sanitário' },
  'MLB6284':   { agency: 'ANVISA',  reason: 'Perfumes exigem registro sanitário' },
  'MLB198312': { agency: 'ANVISA',  reason: 'Higiene Pessoal exige registro sanitário' },
  'MLB278194': { agency: 'ANVISA',  reason: 'Tratamentos de Beleza exigem registro sanitário' },
  'MLB264787': { agency: 'ANVISA',  reason: 'Produtos de Barbearia exigem registro sanitário' },
  'MLB5383':   { agency: 'ANVISA',  reason: 'Depilação exige registro sanitário' },
  'MLB29884':  { agency: 'ANVISA',  reason: 'Manicure e Pedicure exige registro sanitário' },
  'MLB431646': { agency: 'ANVISA',  reason: 'Farmácia exige registro sanitário' },
  'MLB1403':   { agency: 'ANVISA',  reason: 'Alimentos e Bebidas exigem registro sanitário' },
  // ANATEL — apenas dispositivos que transmitem/recebem sinal (não acessórios passivos)
  // MLB1051 (Celulares e Telefones) excluído — contém MLB3813 (Acessórios para Celulares)
  // que são itens passivos (suportes, capas, cabos) sem necessidade de certificação
  'MLB1055':   { agency: 'ANATEL', reason: 'Celulares e Smartphones exigem certificação ANATEL' },
  'MLB417704': { agency: 'ANATEL', reason: 'Smartwatches exigem certificação ANATEL' },
  'MLB2908':   { agency: 'ANATEL', reason: 'Rádio Comunicadores exigem certificação ANATEL' },
  'MLB438581': { agency: 'ANATEL', reason: 'Telefonia Fixa e Sem Fio exige certificação ANATEL' },
  'MLB1039':   { agency: 'ANATEL', reason: 'Câmeras e Acessórios exigem certificação ANATEL' },
  'MLB264065': { agency: 'ANATEL', reason: 'Drones e Acessórios exigem certificação ANATEL' },
  'MLB1002':   { agency: 'ANATEL', reason: 'Televisores exigem certificação ANATEL' },
  'MLB133950': { agency: 'ANATEL', reason: 'Media Streaming exige certificação ANATEL' },
  'MLB3835':   { agency: 'ANATEL', reason: 'Equipamentos de Áudio exigem certificação ANATEL' },
  'MLB1700':   { agency: 'ANATEL', reason: 'Conectividade e Redes exige certificação ANATEL' },
  'MLB91757':  { agency: 'ANATEL', reason: 'Tablets e Acessórios exigem certificação ANATEL' },
  'MLB430687': { agency: 'ANATEL', reason: 'Notebooks e Portáteis exigem certificação ANATEL' },
  // INMETRO — Brinquedos
  'MLB1132':   { agency: 'INMETRO', reason: 'Brinquedos exigem certificação INMETRO' },
  'MLB264337': { agency: 'INMETRO', reason: 'Bonecos e Bonecas exigem certificação INMETRO' },
  'MLB2961':   { agency: 'INMETRO', reason: 'Brinquedos Eletrônicos exigem certificação INMETRO' },
  'MLB432818': { agency: 'INMETRO', reason: 'Brinquedos de Faz de Conta exigem certificação INMETRO' },
  'MLB455425': { agency: 'INMETRO', reason: 'Brinquedos de Montar exigem certificação INMETRO' },
  'MLB3655':   { agency: 'INMETRO', reason: 'Brinquedos para Bebês exigem certificação INMETRO' },
  'MLB6911':   { agency: 'INMETRO', reason: 'Ar Livre e Playground exige certificação INMETRO' },
};

// Cotação indicativa — usada apenas como referência visual para o usuário
const USD_RATE_INDICATIVE = 5.7;

function checkImportEligibility(categoryPath, title, pathFromRoot = []) {
  const text = `${categoryPath} ${title}`.toLowerCase();

  if (PROHIBITED_PATTERN.test(text)) {
    return { status: 'prohibited', label: 'Proibido', restrictions: [],
             note: 'Categoria com restrição total à importação.' };
  }

  // Caminho por ID — disponível quando a API retornou category.path_from_root
  if (pathFromRoot.length > 0) {
    const seen = new Set();
    const restrictions = [];
    for (const node of pathFromRoot) {
      const entry = CATEGORY_AGENCY_MAP[node.id];
      if (entry && !seen.has(entry.agency)) {
        seen.add(entry.agency);
        restrictions.push({ agency: entry.agency, reason: entry.reason });
      }
    }
    return {
      status: restrictions.length > 0 ? 'restricted' : 'eligible',
      label:  restrictions.length > 0 ? 'Requer certificação' : 'Elegível',
      restrictions
    };
  }

  // Fallback por keyword — cenário DOM-only (_fromDom: true, sem IDs de categoria)
  const restrictions = IMPORT_RULES
    .filter(r => r.pattern.test(text))
    .map(r => ({ agency: r.agency, reason: r.reason }));
  return {
    status: restrictions.length > 0 ? 'restricted' : 'eligible',
    label:  restrictions.length > 0 ? 'Requer certificação' : 'Elegível',
    restrictions
  };
}

function buildImportRegime(priceUSD) {
  if (priceUSD <= 50)   return { label: 'Remessa Conforme', taxFree: true,  tax: 0,  maxUSD: 50 };
  if (priceUSD <= 3000) return { label: 'Importação Simplificada', taxFree: false, tax: 20, maxUSD: 3000 };
  return { label: 'Importação Formal', taxFree: false, tax: null, maxUSD: null };
}

function buildAnalysis({ item, seller, category, reviews, competition, sameItem, score }) {
  const monthlySales = estimateMonthlySales(item, reviews);
  const priceStats = getPriceStats(competition, item.price);

  const reputationLabel = {
    '5_green': 'Ótima', '4_light_green': 'Boa',
    '3_yellow': 'Regular', '2_orange': 'Ruim', '1_red': 'Muito ruim'
  };
  const powerSellerLabel = {
    'platinum': 'MercadoLíder Platinum',
    'gold': 'MercadoLíder Gold',
    'silver': 'MercadoLíder'
  };
  const repLevel = seller?.seller_reputation?.level_id || '';
  const powerSeller = seller?.seller_reputation?.power_seller_status || '';

  const numSellers = sameItem?.paging?.total || 0;
  const totalSearch = competition?.paging?.total || 0;

  let opportunityLabel, opportunityClass;
  if (score.opportunity >= 80) { opportunityLabel = 'Alta'; opportunityClass = 'high'; }
  else if (score.opportunity >= 50) { opportunityLabel = 'Média'; opportunityClass = 'medium'; }
  else { opportunityLabel = 'Baixa'; opportunityClass = 'low'; }

  const categoryPath = category?.path_from_root?.map(c => c.name).join(' › ') || category?.name || '';

  const priceUSD = Math.round((item.price || 0) / USD_RATE_INDICATIVE);
  const eligibility = checkImportEligibility(
    categoryPath,
    item.title || '',
    category?.path_from_root || []
  );
  const regime = buildImportRegime(priceUSD);

  return {
    itemId: item.id,
    title: item.title,
    price: item.price,
    currencyId: item.currency_id,
    condition: item.condition === 'new' ? 'Novo' : 'Usado',
    thumbnail: item.thumbnail,
    permalink: item.permalink,
    soldQuantity: item.sold_quantity || 0,
    availableQuantity: item.available_quantity || 0,
    monthlySales,
    score,
    reviews: {
      total: reviews?.paging?.total || 0,
      rating: reviews?.rating_average || 0
    },
    seller: {
      id: item.seller_id,
      nickname: seller?.nickname || 'Desconhecido',
      reputation: reputationLabel[repLevel] || 'Sem dados',
      powerSeller: powerSellerLabel[powerSeller] || null,
      totalSales: seller?.seller_reputation?.transactions?.completed || 0,
      level: repLevel
    },
    competition: {
      sameItem: numSellers,
      totalSearch,
      priceStats
    },
    opportunity: {
      label: opportunityLabel,
      class: opportunityClass
    },
    category: {
      id: item.category_id,
      name: category?.name || '',
      path: categoryPath
    },
    importEligibility: {
      status: eligibility.status,
      label: eligibility.label,
      restrictions: eligibility.restrictions,
      note: eligibility.note || null,
      regime,
      priceUSD
    }
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_PRODUCT') {
    analyzeProduct(message.itemId, message.isCatalog || false, message.domData || null)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SEARCH_PRODUCTS') {
    const BASE = 'https://api.mercadolibre.com';
    const site = message.site || 'MLB';
    const encodedQ = encodeURIComponent(message.query);

    // Tenta a busca completa; em caso de 403 usa autosuggest como fallback
    fetchML(`${BASE}/sites/${site}/search?q=${encodedQ}&limit=10`, { optional: true })
      .then(data => {
        if (data?.results?.length) {
          sendResponse({ success: true, data });
        } else {
          // Fallback: autosuggest retorna sugestões sem auth
          return fetchML(`${BASE}/sites/${site}/autosuggest?q=${encodedQ}&limit=10`, { optional: true })
            .then(suggest => sendResponse({ success: true, data: suggest, isSuggest: true }));
        }
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CLEAR_CACHE') {
    cache.clear();
    sendResponse({ success: true });
    return true;
  }
});
