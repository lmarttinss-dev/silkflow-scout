(() => {
  'use strict';

  const ITEM_ID_REGEX = /ML[A-Z]\d{6,12}/;

  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    }).format(value);
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora mesmo';
    if (mins < 60) return `há ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `há ${hours}h`;
    return `há ${Math.floor(hours / 24)}d`;
  }

  function truncate(str, len) {
    return str && str.length > len ? str.substring(0, len) + '…' : (str || '');
  }

  function scoreColor(score) {
    if (score >= 75) return '#00C853';
    if (score >= 50) return '#FFD600';
    if (score >= 30) return '#FF6D00';
    return '#D50000';
  }

  // ── Status Detection ─────────────────────────────────────────────────────────

  async function updateStatus() {
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    indicator.className = 'status-indicator loading';
    statusText.textContent = 'Verificando página...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) {
        setStatus('inactive', 'Abra o Mercado Livre para usar o Scout.');
        return;
      }

      const url = tab.url;
      const isMl = url.includes('mercadolivre.com') || url.includes('mercadolibre.com');

      if (!isMl) {
        setStatus('inactive', 'Navegue para o Mercado Livre para ativar o Scout.');
        return;
      }

      const itemMatch = url.match(ITEM_ID_REGEX);
      if (itemMatch) {
        setStatus('active', `Produto detectado: ${itemMatch[0]}\nO painel de análise está ativo nessa página.`);
        return;
      }

      if (url.includes('lista.mercadolivre') || url.includes('/busca') || url.includes('_OrderId_')) {
        setStatus('search', 'Página de busca detectada.\nBadges Scout estão ativos nos resultados.');
        return;
      }

      setStatus('inactive', 'Abra uma página de produto para ver a análise completa.');
    } catch {
      setStatus('inactive', 'Não foi possível verificar a página atual.');
    }
  }

  function setStatus(type, text) {
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    indicator.className = `status-indicator ${type}`;
    statusText.textContent = text;
  }

  // ── Last Analysis ────────────────────────────────────────────────────────────

  async function loadLastAnalysis() {
    const result = await chrome.storage.local.get('lastAnalysis');
    const section = document.getElementById('last-analysis-section');

    if (!result.lastAnalysis) {
      section.style.display = 'none';
      return;
    }

    const { data, url, ts } = result.lastAnalysis;
    section.style.display = 'block';

    document.getElementById('la-title').textContent = truncate(data.title, 70);
    document.getElementById('la-score').textContent =
      `Score: ${data.score.total} — ${scoreLabel(data.score.total)}`;
    document.getElementById('la-score').style.color = scoreColor(data.score.total);
    document.getElementById('la-price').textContent = formatCurrency(data.price);
    document.getElementById('la-time').textContent = `Analisado ${timeAgo(ts)}`;

    const openBtn = document.getElementById('la-open');
    openBtn.href = url;
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url });
    });
  }

  function scoreLabel(score) {
    if (score >= 75) return 'Excelente';
    if (score >= 50) return 'Bom';
    if (score >= 30) return 'Regular';
    return 'Fraco';
  }

  // ── Quick Search ─────────────────────────────────────────────────────────────

  let searchTimeout = null;

  function setupSearch() {
    const input = document.getElementById('popup-search');
    const btn = document.getElementById('popup-search-btn');

    function doSearch() {
      const query = input.value.trim();
      if (query.length < 3) return;
      runSearch(query);
    }

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const query = input.value.trim();
      if (query.length >= 4) {
        searchTimeout = setTimeout(() => runSearch(query), 600);
      }
    });
  }

  function runSearch(query) {
    const container = document.getElementById('search-results');
    container.innerHTML = '<div class="search-loading">🔍 Buscando...</div>';

    chrome.runtime.sendMessage({ type: 'SEARCH_PRODUCTS', query }, (response) => {
      if (chrome.runtime.lastError) {
        container.innerHTML = '<div class="search-empty">Extensão desconectada. Recarregue a página.</div>';
        return;
      }

      // Fallback: se API falhou totalmente, abre busca no site
      if (!response?.success) {
        const mlUrl = `https://www.mercadolivre.com.br/busca?q=${encodeURIComponent(query)}`;
        container.innerHTML = `
          <div class="search-empty">
            API indisponível.<br>
            <a class="la-open-btn" href="${mlUrl}" target="_blank">Buscar no Mercado Livre ↗</a>
          </div>`;
        return;
      }

      // Resultado do autosuggest (fallback quando search retorna vazio)
      if (response.isSuggest) {
        const queries = response.data?.suggested_queries?.slice(0, 6) || [];
        if (!queries.length) {
          container.innerHTML = '<div class="search-empty">Nenhuma sugestão encontrada.</div>';
          return;
        }
        container.innerHTML = queries.map(q => {
          const text = q.q || q.query || '';
          const mlUrl = `https://www.mercadolivre.com.br/busca?q=${encodeURIComponent(text)}`;
          return `
            <a class="search-result-item" href="${mlUrl}" target="_blank">
              <div class="sri-info">
                <div class="sri-title">🔍 ${escapeHtml(text)}</div>
                <div class="sri-price">Ver resultados ↗</div>
              </div>
            </a>`;
        }).join('');
        return;
      }

      // Resultado normal da busca
      const results = response.data?.results?.slice(0, 6) || [];
      if (!results.length) {
        const mlUrl = `https://www.mercadolivre.com.br/busca?q=${encodeURIComponent(query)}`;
        container.innerHTML = `
          <div class="search-empty">
            Nenhum resultado via API.<br>
            <a class="la-open-btn" href="${mlUrl}" target="_blank">Buscar no Mercado Livre ↗</a>
          </div>`;
        return;
      }

      container.innerHTML = results.map(item => {
        const price = new Intl.NumberFormat('pt-BR', {
          style: 'currency', currency: 'BRL'
        }).format(item.price);
        const title = (item.title || '').substring(0, 45) + (item.title?.length > 45 ? '…' : '');
        const thumb = (item.thumbnail || '').replace('http://', 'https://');
        const url = item.permalink || '#';

        return `
          <a class="search-result-item" href="${url}" target="_blank">
            ${thumb ? `<img class="sri-thumb" src="${thumb}" alt="" loading="lazy">` : ''}
            <div class="sri-info">
              <div class="sri-title">${escapeHtml(title)}</div>
              <div class="sri-price">${price}</div>
            </div>
          </a>`;
      }).join('');
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  async function loadSettings() {
    const result = await chrome.storage.local.get({
      settingAutoPanel: true,
      settingSearchBadges: true
    });

    document.getElementById('setting-auto-panel').checked = result.settingAutoPanel;
    document.getElementById('setting-search-badges').checked = result.settingSearchBadges;
  }

  function setupSettings() {
    document.getElementById('setting-auto-panel').addEventListener('change', (e) => {
      chrome.storage.local.set({ settingAutoPanel: e.target.checked });
    });
    document.getElementById('setting-search-badges').addEventListener('change', (e) => {
      chrome.storage.local.set({ settingSearchBadges: e.target.checked });
    });
  }

  // ── Clear Cache ───────────────────────────────────────────────────────────────

  function setupClearCache() {
    document.getElementById('clear-cache').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, () => {
        const btn = document.getElementById('clear-cache');
        const orig = btn.textContent;
        btn.textContent = '✓ Limpo!';
        btn.style.color = '#00C853';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.color = '';
        }, 1500);
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  async function init() {
    await Promise.all([updateStatus(), loadLastAnalysis(), loadSettings()]);
    setupSearch();
    setupSettings();
    setupClearCache();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
