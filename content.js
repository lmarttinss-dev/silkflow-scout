/**
 * Silkflow Scout — content script orquestrador.
 * Detecta o marketplace atual e delega para o módulo correspondente.
 * Os módulos (MercadoLivre, Shopee, Amazon) são injetados antes deste arquivo.
 */
(() => {
  'use strict';

  const MODULES = [MercadoLivre, Shopee, Amazon];

  let currentPageInfo = null;
  let analysisStarted = false;

  function detectModule() {
    for (const mod of MODULES) {
      try { if (mod.isMatch(location.href)) return mod; } catch { }
    }
    return null;
  }

  function findProductOnPage() {
    const mod = detectModule();
    return mod ? mod.detect(location.href) : null;
  }

  function formatCurrency(value, currency) {
    const cur = (currency && currency !== 'BRL') ? currency : 'BRL';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(value);
  }

  function formatNumber(n) { return new Intl.NumberFormat('pt-BR').format(n); }

  function scoreColor(s) {
    if (s >= 75) return '#00C853'; if (s >= 50) return '#FFD600';
    if (s >= 30) return '#FF6D00'; return '#D50000';
  }

  function scoreLabel(s) {
    if (s >= 75) return 'Excelente'; if (s >= 50) return 'Bom';
    if (s >= 30) return 'Regular';  return 'Fraco';
  }

  function reputationColor(level) {
    return { '5_green': '#00C853', '4_light_green': '#69F0AE', '3_yellow': '#FFD600',
             '2_orange': '#FF6D00', '1_red': '#D50000' }[level] || '#90A4AE';
  }

  function renderStars(rating) {
    const full = Math.floor(rating), half = rating - full >= 0.5 ? 1 : 0;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);
  }

  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
  function truncate(str, len) { return str && str.length > len ? str.substring(0, len) + '…' : (str || ''); }

  function renderScoreCircle(score) {
    const color = scoreColor(score), r = 44, c = 2 * Math.PI * r, progress = (score / 100) * c;
    return `<div class="mls-score-container">
      <svg viewBox="0 0 100 100" width="100" height="100">
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="#1E2A3A" stroke-width="8"/>
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="8"
          stroke-dasharray="${progress} ${c}" stroke-linecap="round" transform="rotate(-90 50 50)"/>
        <text x="50" y="45" text-anchor="middle" dominant-baseline="middle"
          fill="${color}" font-size="22" font-weight="bold" font-family="sans-serif">${score}</text>
        <text x="50" y="63" text-anchor="middle" dominant-baseline="middle"
          fill="#8892A4" font-size="9" font-family="sans-serif">SCORE</text>
      </svg>
      <div class="mls-score-label" style="color:${color}">${scoreLabel(score)}</div>
    </div>`;
  }

  function renderSubScoreBar(label, value) {
    const color = scoreColor(value);
    return `<div class="mls-subscore-row">
      <span class="mls-subscore-label">${label}</span>
      <div class="mls-subscore-track"><div class="mls-subscore-fill" style="width:${value}%;background:${color}"></div></div>
      <span class="mls-subscore-value" style="color:${color}">${value}</span>
    </div>`;
  }

  function renderImportEligibility(imp) {
    if (!imp) return '';
    const statusColors = { eligible: '#00C853', restricted: '#FFD600', prohibited: '#D50000' };
    const statusIcons  = { eligible: '✅', restricted: '⚠️', prohibited: '🚫' };
    const color = statusColors[imp.status] || '#90A4AE';
    const icon  = statusIcons[imp.status]  || '•';

    const regimeColor = imp.regime.taxFree ? '#00C853' : imp.regime.tax != null ? '#FFD600' : '#FF6D00';
    const regimeTax   = imp.regime.taxFree
      ? 'Isento de imposto de importação'
      : imp.regime.tax != null
        ? `${imp.regime.tax}% de imposto de importação`
        : 'Requer despacho aduaneiro formal';

    const restrictionChips = imp.restrictions.map(r =>
      `<div class="mls-import-chip" title="${escapeHtml(r.reason)}">
        <span class="mls-import-chip-agency">${r.agency}</span>
        <span class="mls-import-chip-reason">${escapeHtml(r.reason)}</span>
       </div>`
    ).join('');

    return `
      <div class="mls-divider"></div>
      <div class="mls-section-title">Importação Simplificada</div>
      <div class="mls-import-card">
        <div class="mls-import-status-row">
          <span class="mls-import-badge" style="background:${color}20;color:${color};border-color:${color}40">
            ${icon} ${escapeHtml(imp.label)}
          </span>
          <span class="mls-import-price">≈ U$ ${imp.priceUSD}</span>
        </div>
        ${imp.note ? `<div class="mls-import-note">${escapeHtml(imp.note)}</div>` : ''}
        <div class="mls-import-regime" style="border-left-color:${regimeColor}">
          <span class="mls-import-regime-label" style="color:${regimeColor}">${escapeHtml(imp.regime.label)}</span>
          <span class="mls-import-regime-tax">${regimeTax}</span>
        </div>
        ${restrictionChips ? `<div class="mls-import-chips">${restrictionChips}</div>` : ''}
        <div class="mls-import-footnote">Cotação indicativa (U$ 1 ≈ R$ 5,70). Valor de referência baseado no preço do anúncio.</div>
      </div>`;
  }

  function renderCostCalculator(data) {
    const taxRate = data.importEligibility?.regime?.taxFree ? 0
                  : (data.importEligibility?.regime?.tax ?? 20);
    return `
      <div class="mls-divider"></div>
      <div class="mls-section-title">Simulador de Margem</div>
      <div class="mls-calc-card">
        <div class="mls-calc-input-row">
          <label class="mls-calc-label" for="mls-china-price">Preço China (U$)</label>
          <input class="mls-calc-input" id="mls-china-price" type="number" min="0" step="0.01" placeholder="0,00">
        </div>
        <div class="mls-calc-input-row">
          <label class="mls-calc-label" for="mls-shipping">Frete nacional (R$)</label>
          <input class="mls-calc-input" id="mls-shipping" type="number" min="0" step="1" value="30">
        </div>
        <div class="mls-calc-result" id="mls-calc-result" style="display:none">
          <div class="mls-calc-row"><span>Produto (BRL)</span><span id="cr-product">—</span></div>
          <div class="mls-calc-row mls-calc-tax" id="cr-tax-row"><span>Imposto import. (${taxRate}%)</span><span id="cr-tax">—</span></div>
          <div class="mls-calc-row mls-calc-subtotal"><span>Custo de importação</span><span id="cr-import-cost">—</span></div>
          <div class="mls-calc-divider"></div>
          <div class="mls-calc-row"><span>Frete nacional</span><span id="cr-shipping">—</span></div>
          <div class="mls-calc-row"><span>Comissão ML (~12%)</span><span id="cr-commission">—</span></div>
          <div class="mls-calc-divider"></div>
          <div class="mls-calc-margin-block">
            <div class="mls-calc-margin-item">
              <div class="mls-calc-margin-header">
                <span class="mls-calc-margin-label">Margem bruta</span>
                <span class="mls-calc-margin-hint">sem frete e comissão</span>
              </div>
              <div class="mls-calc-margin-values">
                <span id="cr-gross-margin">—</span>
                <span class="mls-calc-margin-pct" id="cr-gross-pct">—</span>
              </div>
              <div class="mls-calc-margin-bar"><div class="mls-calc-margin-fill" id="cr-gross-fill"></div></div>
            </div>
            <div class="mls-calc-margin-item">
              <div class="mls-calc-margin-header">
                <span class="mls-calc-margin-label">Margem líquida</span>
                <span class="mls-calc-margin-hint">após todos os custos</span>
              </div>
              <div class="mls-calc-margin-values">
                <span id="cr-net-margin">—</span>
                <span class="mls-calc-margin-pct" id="cr-net-pct">—</span>
              </div>
              <div class="mls-calc-margin-bar"><div class="mls-calc-margin-fill" id="cr-net-fill"></div></div>
            </div>
            <div class="mls-calc-roi-row">
              <span>ROI estimado</span>
              <span id="cr-roi">—</span>
            </div>
          </div>
        </div>
        <div class="mls-calc-footnote" id="mls-calc-empty">Informe o preço de compra na China para calcular.</div>
      </div>`;
  }

  function initCalculator(data) {
    const USD_RATE  = 5.7;
    const ML_FEE    = 0.12;
    const mlPrice   = data.price || 0;
    const taxRate   = data.importEligibility?.regime?.taxFree ? 0
                    : (data.importEligibility?.regime?.tax ?? 20) / 100;

    function marginColor(pct) {
      return pct >= 30 ? '#00C853' : pct >= 15 ? '#FFD600' : '#FF6D00';
    }

    function setMarginEl(valueId, pctId, fillId, value, pct) {
      const valueEl = document.getElementById(valueId);
      const pctEl   = document.getElementById(pctId);
      const fillEl  = document.getElementById(fillId);
      const color   = marginColor(pct);
      const fillPct = Math.max(0, Math.min(100, pct));
      if (valueEl) { valueEl.textContent = formatCurrency(value, 'BRL'); valueEl.style.color = color; }
      if (pctEl)   { pctEl.textContent = `${pct.toFixed(1)}%`; pctEl.style.color = color; }
      if (fillEl)  { fillEl.style.width = `${fillPct}%`; fillEl.style.background = color; }
    }

    function recalc() {
      const chinaUSD = parseFloat(document.getElementById('mls-china-price')?.value) || 0;
      const shipping = parseFloat(document.getElementById('mls-shipping')?.value)    || 0;
      const result   = document.getElementById('mls-calc-result');
      const empty    = document.getElementById('mls-calc-empty');
      if (!result || !empty) return;

      if (chinaUSD <= 0) { result.style.display = 'none'; empty.style.display = 'block'; return; }
      result.style.display = 'block'; empty.style.display = 'none';

      const productBRL  = chinaUSD * USD_RATE;
      const importTax   = productBRL * taxRate;
      const importCost  = productBRL + importTax;
      const commission  = mlPrice * ML_FEE;

      const grossMargin = mlPrice - importCost;
      const grossPct    = mlPrice > 0 ? (grossMargin / mlPrice) * 100 : 0;

      const netMargin   = mlPrice - importCost - shipping - commission;
      const netPct      = mlPrice > 0 ? (netMargin / mlPrice) * 100 : 0;

      const invested    = importCost + shipping;
      const roi         = invested > 0 ? (netMargin / invested) * 100 : 0;

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      const fmt = v => formatCurrency(v, 'BRL');

      set('cr-product',     fmt(productBRL));
      set('cr-tax',         fmt(importTax));
      set('cr-import-cost', fmt(importCost));
      set('cr-shipping',    fmt(shipping));
      set('cr-commission',  fmt(commission));

      setMarginEl('cr-gross-margin', 'cr-gross-pct', 'cr-gross-fill', grossMargin, grossPct);
      setMarginEl('cr-net-margin',   'cr-net-pct',   'cr-net-fill',   netMargin,   netPct);

      const roiEl = document.getElementById('cr-roi');
      if (roiEl) {
        roiEl.textContent = `${roi.toFixed(1)}%`;
        roiEl.style.color = marginColor(roi);
      }

      const taxRow = document.getElementById('cr-tax-row');
      if (taxRow) taxRow.style.display = taxRate > 0 ? 'flex' : 'none';
    }

    document.getElementById('mls-china-price')?.addEventListener('input', recalc);
    document.getElementById('mls-shipping')?.addEventListener('input', recalc);
    recalc();
  }

  function renderSupplierSection(thumbnail) {
    const hasImage = !!thumbnail;
    return `
      <div class="mls-divider"></div>
      <div class="mls-section-title">Buscar Fornecedor</div>
      <div class="mls-supplier-section">
        <div class="mls-supplier-btns">
          <button class="mls-supplier-btn" id="mls-search-1688">
            <span class="mls-supplier-flag">🇨🇳</span> 1688
          </button>
          <button class="mls-supplier-btn" id="mls-search-alibaba">
            <span class="mls-supplier-flag">🌐</span> Alibaba
          </button>
        </div>
        <div class="mls-supplier-hints">
          <span class="mls-supplier-hint">Mandarim</span>
          <span class="mls-supplier-hint">Inglês · Trade Assurance</span>
        </div>
        <button class="mls-supplier-btn mls-supplier-btn-image" id="mls-search-lens"
          ${hasImage ? '' : 'disabled title="Imagem não disponível para este produto"'}>
          🔍 Buscar por Imagem ${hasImage ? '' : '<span class="mls-supplier-no-img">(sem imagem)</span>'}
        </button>
        ${hasImage ? '<div class="mls-supplier-hint mls-supplier-hint-center">Google Lens · mais assertivo que texto</div>' : ''}
      </div>`;
  }

  function initSupplierButtons(data) {
    const btn1688 = document.getElementById('mls-search-1688');
    if (btn1688) {
      btn1688.addEventListener('click', () => {
        btn1688.textContent = '...';
        btn1688.disabled = true;
        chrome.runtime.sendMessage({ type: 'TRANSLATE_TITLE', title: data.title, targetLang: 'zh-CN' }, (response) => {
          const query = response?.translated || data.title;
          window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(query)}`, '_blank');
          btn1688.innerHTML = '<span class="mls-supplier-flag">🇨🇳</span> 1688';
          btn1688.disabled = false;
        });
      });
    }

    const btnAlibaba = document.getElementById('mls-search-alibaba');
    if (btnAlibaba) {
      btnAlibaba.addEventListener('click', () => {
        btnAlibaba.textContent = '...';
        btnAlibaba.disabled = true;
        chrome.runtime.sendMessage({ type: 'TRANSLATE_TITLE', title: data.title, targetLang: 'en' }, (response) => {
          const query = response?.translated || data.title;
          window.open(`https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}&fsb=y&IndexArea=product_en`, '_blank');
          btnAlibaba.innerHTML = '<span class="mls-supplier-flag">🌐</span> Alibaba';
          btnAlibaba.disabled = false;
        });
      });
    }

    const btnLens = document.getElementById('mls-search-lens');
    if (btnLens && data.thumbnail) {
      btnLens.addEventListener('click', () => {
        window.open(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(data.thumbnail)}`, '_blank');
      });
    }
  }

  function buildPanelHTML(data) {
    const { score, seller, reviews, competition, monthlySales, opportunity, category } = data;
    const priceStats = competition.priceStats, currency = data.currencyId || 'BRL';
    const salesRange = monthlySales > 0
      ? `~${formatNumber(Math.max(1, monthlySales - 10))}–${formatNumber(monthlySales + 15)}` : 'Sem dados';
    const competitionText = competition.sameItem > 0
      ? `${formatNumber(competition.sameItem)} ${competition.sameItem === 1 ? 'vendedor' : 'vendedores'}` : 'Exclusivo';
    const avgPrice = priceStats ? formatCurrency(priceStats.avg, currency) : 'N/D';
    let pricePosition = 'N/D', priceClass = '';
    if (priceStats) {
      if (priceStats.percentile <= 33)      { pricePosition = '⬇ Abaixo da média'; priceClass = 'mls-low'; }
      else if (priceStats.percentile <= 66) { pricePosition = '➡ Na média';        priceClass = 'mls-mid'; }
      else                                  { pricePosition = '⬆ Acima da média';  priceClass = 'mls-high-price'; }
    }
    const oppColors = { high: '#00C853', medium: '#FFD600', low: '#FF6D00' };
    const oppColor  = oppColors[opportunity.class] || '#90A4AE';
    const mktLabel  = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' }[data.marketplace] || '';

    return `
      <div class="mls-header">
        <div class="mls-logo"><span class="mls-logo-icon">🔍</span><span class="mls-logo-text">Silkflow Scout</span></div>
        <button class="mls-close-btn" id="mls-close">✕</button>
      </div>
      ${data.partialData ? `<div class="mls-partial-banner">⚠️ Dados parciais — API indisponível para este item</div>` : ''}
      ${mktLabel ? `<div class="mls-marketplace-tag">${mktLabel}</div>` : ''}
      <div class="mls-product-title" title="${escapeHtml(data.title)}">${escapeHtml(truncate(data.title, 55))}</div>
      <div class="mls-price-chip">${formatCurrency(data.price, currency)}<span class="mls-condition">${data.condition}</span></div>
      <div class="mls-score-section">
        ${renderScoreCircle(score.total)}
        <div class="mls-subscores">
          ${renderSubScoreBar('Demanda', score.demand)}
          ${renderSubScoreBar('Oportunidade', score.opportunity)}
          ${renderSubScoreBar('Qualidade', score.quality)}
          ${renderSubScoreBar('Vendedor', score.seller)}
        </div>
      </div>
      <div class="mls-divider"></div>
      <div class="mls-metrics-grid">
        <div class="mls-metric-card"><div class="mls-metric-icon">📦</div><div class="mls-metric-value">${salesRange}</div><div class="mls-metric-label">Vendas/mês est.</div></div>
        <div class="mls-metric-card"><div class="mls-metric-icon">👥</div><div class="mls-metric-value">${competitionText}</div><div class="mls-metric-label">Vendedores</div></div>
        <div class="mls-metric-card"><div class="mls-metric-icon">💲</div><div class="mls-metric-value">${avgPrice}</div><div class="mls-metric-label">Preço médio</div></div>
        <div class="mls-metric-card"><div class="mls-metric-icon">⭐</div><div class="mls-metric-value">${reviews.rating > 0 ? reviews.rating.toFixed(1) : 'N/D'}</div><div class="mls-metric-label">${reviews.total > 0 ? formatNumber(reviews.total) + ' avaliações' : 'Sem avaliações'}</div></div>
      </div>
      ${reviews.rating > 0 ? `<div class="mls-stars-row"><span class="mls-stars">${renderStars(reviews.rating)}</span><span class="mls-rating-num">${reviews.rating.toFixed(1)}</span></div>` : ''}
      <div class="mls-divider"></div>
      <div class="mls-section-title">Posicionamento de Preço</div>
      <div class="mls-price-row">
        <span class="mls-price-pos ${priceClass}">${pricePosition}</span>
        ${priceStats ? `<span class="mls-price-range">${formatCurrency(priceStats.min, currency)} – ${formatCurrency(priceStats.max, currency)}</span>` : ''}
      </div>
      ${priceStats ? `<div class="mls-price-bar-wrapper"><div class="mls-price-bar"><div class="mls-price-bar-fill" style="width:${priceStats.percentile}%"></div><div class="mls-price-bar-marker" style="left:${priceStats.percentile}%">▲</div></div><div class="mls-price-bar-labels"><span>Min</span><span>Máx</span></div></div>` : ''}
      <div class="mls-divider"></div>
      <div class="mls-section-title">Vendedor</div>
      <div class="mls-seller-card">
        <div class="mls-seller-name">${escapeHtml(seller.nickname)}</div>
        ${seller.powerSeller ? `<div class="mls-power-seller">${escapeHtml(seller.powerSeller)}</div>` : ''}
        <div class="mls-seller-rep"><span class="mls-rep-dot" style="background:${reputationColor(seller.level)}"></span><span>Reputação: <strong>${seller.reputation}</strong></span></div>
        ${seller.totalSales > 0 ? `<div class="mls-seller-sales">${formatNumber(seller.totalSales)} vendas concluídas</div>` : ''}
      </div>
      <div class="mls-divider"></div>
      <div class="mls-section-title">Categoria</div>
      <div class="mls-category-text">${escapeHtml(category.path || category.name || 'N/D')}</div>
      <div class="mls-divider"></div>
      <div class="mls-opportunity-section">
        <span class="mls-opp-title">Oportunidade de Mercado</span>
        <span class="mls-opportunity-badge" style="background:${oppColor};color:#0D1117">${opportunity.label}</span>
      </div>
      <div class="mls-opp-detail">${competition.totalSearch > 0 ? `${formatNumber(competition.totalSearch)} produtos similares nessa categoria` : 'Sem dados de concorrência'}</div>
      ${competition.nicheDemand ? `
      <div class="mls-niche-demand">
        <div class="mls-niche-row">
          <span class="mls-niche-label">Vendas totais no nicho</span>
          <span class="mls-niche-total">${formatNumber(competition.nicheDemand.total)}+</span>
        </div>
        <div class="mls-niche-sub">média de ${formatNumber(competition.nicheDemand.avg)} por anúncio · amostra de ${competition.nicheDemand.sampleSize} produtos</div>
      </div>` : ''}
      ${renderImportEligibility(data.importEligibility)}
      ${renderCostCalculator(data)}
      ${renderSupplierSection(data.thumbnail)}
      <div class="mls-footer"><span>${data.itemId}</span><button class="mls-refresh-btn" id="mls-refresh">↻ Atualizar</button></div>`;
  }

  function ensureToggle() {
    if (document.getElementById('ml-scout-toggle')) return;
    const btn = document.createElement('div');
    btn.id = 'ml-scout-toggle'; btn.className = 'ml-scout-toggle';
    btn.innerHTML = `<span>🔍</span><span class="mls-toggle-label">Scout</span>`;
    btn.addEventListener('click', onToggleClick);
    document.body.appendChild(btn);
  }

  function ensurePanel() {
    if (document.getElementById('ml-scout-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'ml-scout-panel';
    panel.innerHTML = `<div class="mls-header"><div class="mls-logo"><span class="mls-logo-icon">🔍</span><span class="mls-logo-text">Silkflow Scout</span></div><button class="mls-close-btn" id="mls-close">✕</button></div><div class="mls-loader"><div class="mls-spinner"></div><div class="mls-loading-text">Analisando produto...</div></div>`;
    document.body.appendChild(panel);
    panel.querySelector('#mls-close').addEventListener('click', hidePanel);
  }

  function showPanel() {
    document.getElementById('ml-scout-panel')?.classList.add('mls-visible');
    document.getElementById('ml-scout-toggle')?.classList.add('mls-toggle-active');
  }

  function hidePanel() {
    document.getElementById('ml-scout-panel')?.classList.remove('mls-visible');
    document.getElementById('ml-scout-toggle')?.classList.remove('mls-toggle-active');
  }

  function onToggleClick() {
    const panel = document.getElementById('ml-scout-panel');
    if (!panel) return;
    panel.classList.contains('mls-visible') ? hidePanel() : showPanel();
  }

  function setLoading() {
    const panel = document.getElementById('ml-scout-panel');
    if (!panel) return;
    panel.innerHTML = `<div class="mls-header"><div class="mls-logo"><span class="mls-logo-icon">🔍</span><span class="mls-logo-text">Silkflow Scout</span></div><button class="mls-close-btn" id="mls-close">✕</button></div><div class="mls-loader"><div class="mls-spinner"></div><div class="mls-loading-text">Analisando produto...</div></div>`;
    panel.querySelector('#mls-close').addEventListener('click', hidePanel);
  }

  function setError(message) {
    const panel = document.getElementById('ml-scout-panel');
    if (!panel) return;
    panel.innerHTML = `<div class="mls-header"><div class="mls-logo"><span class="mls-logo-icon">🔍</span><span class="mls-logo-text">Silkflow Scout</span></div><button class="mls-close-btn" id="mls-close">✕</button></div><div class="mls-error"><div class="mls-error-icon">⚠️</div><div class="mls-error-msg">${escapeHtml(message)}</div><button class="mls-retry-btn" id="mls-retry">Tentar novamente</button></div>`;
    panel.querySelector('#mls-close').addEventListener('click', hidePanel);
    panel.querySelector('#mls-retry').addEventListener('click', () => {
      if (currentPageInfo) { setLoading(); requestAnalysis(currentPageInfo); }
    });
  }

  function setNotAProduct() {
    const panel = document.getElementById('ml-scout-panel');
    if (!panel) return;
    panel.innerHTML = `<div class="mls-header"><div class="mls-logo"><span class="mls-logo-icon">🔍</span><span class="mls-logo-text">Silkflow Scout</span></div><button class="mls-close-btn" id="mls-close">✕</button></div><div class="mls-error"><div class="mls-error-icon">📋</div><div class="mls-error-msg">Nenhum produto detectado nesta página.<br><br>Abra a página de um anúncio específico para ver a análise.</div></div>`;
    panel.querySelector('#mls-close').addEventListener('click', hidePanel);
  }

  function renderData(data) {
    const panel = document.getElementById('ml-scout-panel');
    if (!panel) return;
    panel.innerHTML = buildPanelHTML(data);
    panel.querySelector('#mls-close')?.addEventListener('click', hidePanel);
    panel.querySelector('#mls-refresh')?.addEventListener('click', () => {
      if (!currentPageInfo) return;
      setLoading();
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, () => requestAnalysis(currentPageInfo));
    });
    initCalculator(data);
    initSupplierButtons(data);
  }

  function requestAnalysis(pageInfo) {
    const mod = detectModule();
    chrome.runtime.sendMessage(
      { type: 'ANALYZE_PRODUCT', itemId: pageInfo.id, isCatalog: pageInfo.isCatalog,
        marketplace: pageInfo.marketplace, domData: mod ? mod.extractDomData() : null },
      (response) => {
        if (chrome.runtime.lastError) { setError('Extensão desconectada. Recarregue a página (F5).'); return; }
        if (response?.success) {
          renderData(response.data);
          chrome.storage.local.set({ lastAnalysis: { data: response.data, url: location.href, ts: Date.now() } });
        } else {
          setError(response?.error || 'Erro ao buscar dados da API.');
        }
      }
    );
  }

  function startAnalysis() {
    if (analysisStarted) return;
    setTimeout(() => {
      const pageInfo = findProductOnPage();
      if (!pageInfo) { setNotAProduct(); return; }
      analysisStarted = true;
      currentPageInfo = pageInfo;
      requestAnalysis(pageInfo);
      showPanel();
    }, 1200);
  }

  function observeNavigation() {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      analysisStarted = false; currentPageInfo = null;
      setTimeout(() => {
        const pageInfo = findProductOnPage();
        if (pageInfo) {
          currentPageInfo = pageInfo; analysisStarted = true;
          ensurePanel(); setLoading(); requestAnalysis(pageInfo); showPanel();
        } else { ensurePanel(); setNotAProduct(); }
      }, 1200);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    if (!detectModule()) return;
    ensureToggle(); ensurePanel(); startAnalysis(); observeNavigation();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
