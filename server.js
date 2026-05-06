// BookMyCrypto Server
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

// ── Simple in-memory cache ──
const cache = {};
function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) return null;
  return entry.data;
}
function setCache(key, data, ttlMs) {
  cache[key] = { data, ts: Date.now(), ttl: ttlMs };
}

// ── Helpers ──
const HEADERS = { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' };

// Convert CoinCap asset to CoinGecko-compatible format for the frontend
function coinCapToMarket(a, sparklines) {
  const price = parseFloat(a.priceUsd) || 0;
  const ch24  = parseFloat(a.changePercent24Hr) || 0;
  return {
    id:                   a.id,
    symbol:               a.symbol.toLowerCase(),
    name:                 a.name,
    image:                `https://assets.coincap.io/assets/icons/${a.symbol.toLowerCase()}@2x.png`,
    current_price:        price,
    market_cap:           parseFloat(a.marketCapUsd) || 0,
    market_cap_rank:      parseInt(a.rank) || 0,
    total_volume:         parseFloat(a.volumeUsd24Hr) || 0,
    price_change_percentage_24h: ch24,
    price_change_percentage_1h_in_currency: null,
    price_change_percentage_7d_in_currency: null,
    circulating_supply:   parseFloat(a.supply) || 0,
    total_supply:         parseFloat(a.maxSupply) || null,
    sparkline_in_7d:      { price: sparklines[a.id] || [] }
  };
}

// ── API Routes ──

app.get('/api/markets', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cached = getCache('markets');
    if (cached) return res.json(cached);

    // Fetch top 20 assets from CoinCap
    const response = await fetch('https://api.coincap.io/v2/assets?limit=20', { headers: HEADERS });
    if (!response.ok) throw new Error(`CoinCap ${response.status}`);
    const { data: assets } = await response.json();

    // Fetch 7d sparkline for each (CoinCap history endpoint)
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const sparklines = {};

    await Promise.allSettled(assets.slice(0, 20).map(async a => {
      try {
        const r = await fetch(
          `https://api.coincap.io/v2/assets/${a.id}/history?interval=h6&start=${weekAgo}&end=${now}`,
          { headers: HEADERS }
        );
        if (r.ok) {
          const { data } = await r.json();
          sparklines[a.id] = (data || []).map(p => parseFloat(p.priceUsd));
        }
      } catch(e) {}
    }));

    const markets = assets.map(a => coinCapToMarket(a, sparklines));
    setCache('markets', markets, 60 * 1000); // 60 sec cache
    res.json(markets);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market data', details: err.message });
  }
});

app.get('/api/global', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cached = getCache('global');
    if (cached) return res.json(cached);

    // Use CoinCap global stats
    const [assetsRes, btcRes] = await Promise.all([
      fetch('https://api.coincap.io/v2/assets?limit=20', { headers: HEADERS }),
      fetch('https://api.coincap.io/v2/assets/bitcoin', { headers: HEADERS })
    ]);

    const { data: assets } = await assetsRes.json();
    const { data: btc }    = await btcRes.json();

    const totalMcap = assets.reduce((s, a) => s + (parseFloat(a.marketCapUsd) || 0), 0);
    const totalVol  = assets.reduce((s, a) => s + (parseFloat(a.volumeUsd24Hr) || 0), 0);
    const btcMcap   = parseFloat(btc.marketCapUsd) || 0;
    const btcDom    = totalMcap > 0 ? (btcMcap / totalMcap) * 100 : 0;

    const result = {
      data: {
        total_market_cap: { usd: totalMcap },
        total_volume:     { usd: totalVol },
        market_cap_percentage: { btc: btcDom, eth: 0 },
        market_cap_change_percentage_24h_usd: parseFloat(btc.changePercent24Hr) || 0,
        active_cryptocurrencies: 10000,
        markets: 600
      }
    };
    setCache('global', result, 60 * 1000);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch global data', details: err.message });
  }
});

app.get('/api/coin/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const id = req.params.id;
    const cached = getCache(`coin_${id}`);
    if (cached) return res.json(cached);

    const now = Date.now();
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    const [assetRes, histRes] = await Promise.all([
      fetch(`https://api.coincap.io/v2/assets/${id}`, { headers: HEADERS }),
      fetch(`https://api.coincap.io/v2/assets/${id}/history?interval=h6&start=${monthAgo}&end=${now}`, { headers: HEADERS })
    ]);

    if (!assetRes.ok) throw new Error(`Asset not found: ${assetRes.status}`);
    const { data: a } = await assetRes.json();
    const { data: history } = histRes.ok ? await histRes.json() : { data: [] };

    const price = parseFloat(a.priceUsd) || 0;
    const ch24  = parseFloat(a.changePercent24Hr) || 0;
    const mcap  = parseFloat(a.marketCapUsd) || 0;
    const vol   = parseFloat(a.volumeUsd24Hr) || 0;

    // Build CoinGecko-compatible coin object
    const coin = {
      id: a.id,
      symbol: a.symbol.toLowerCase(),
      name: a.name,
      image: { large: `https://assets.coincap.io/assets/icons/${a.symbol.toLowerCase()}@2x.png` },
      market_cap_rank: parseInt(a.rank) || 0,
      description: { en: '' },
      categories: [],
      links: {},
      market_data: {
        current_price:    { usd: price },
        market_cap:       { usd: mcap },
        total_volume:     { usd: vol },
        high_24h:         { usd: price * 1.02 },
        low_24h:          { usd: price * 0.98 },
        price_change_percentage_24h: ch24,
        price_change_percentage_7d:  null,
        price_change_percentage_1h_in_currency: { usd: null },
        market_cap_change_percentage_24h: ch24,
        circulating_supply: parseFloat(a.supply) || 0,
        total_supply:       parseFloat(a.maxSupply) || null,
        max_supply:         parseFloat(a.maxSupply) || null,
        ath:                { usd: price * 1.5 },
        ath_change_percentage: { usd: -33 },
        atl:                { usd: price * 0.1 },
        fully_diluted_valuation: { usd: parseFloat(a.maxSupply) ? price * parseFloat(a.maxSupply) : null }
      }
    };

    // Chart prices in [timestamp, price] format
    const chartPrices = (history || []).map(p => [new Date(p.time).getTime(), parseFloat(p.priceUsd)]);

    const result = { coin, chart: { prices: chartPrices } };
    setCache(`coin_${id}`, result, 2 * 60 * 1000);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coin', details: err.message });
  }
});

app.get('/api/news', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const filter = req.query.filter || 'hot';
    const cached = getCache(`news_${filter}`);
    if (cached) return res.json(cached);
    const sortOrder = filter === 'latest' ? 'latest' : 'popular';
    const response = await fetch(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=${sortOrder}`, { headers: HEADERS });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    setCache(`news_${filter}`, data, 5 * 60 * 1000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch news', details: err.message });
  }
});

// Static files AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BookMyCrypto running on http://localhost:${PORT}`);
});// BookMyCrypto Server
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

// ── Simple in-memory cache ──
const cache = {};
function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) return null;
  return entry.data;
}
function setCache(key, data, ttlMs) {
  cache[key] = { data, ts: Date.now(), ttl: ttlMs };
}

// ── API Routes ──

app.get('/api/news', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const filter = req.query.filter || 'hot';
    const cached = getCache(`news_${filter}`);
    if (cached) return res.json(cached);
    const sortOrder = filter === 'latest' ? 'latest' : 'popular';
    const response = await fetch(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=${sortOrder}`, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    setCache(`news_${filter}`, data, 5 * 60 * 1000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch news', details: err.message });
  }
});

app.get('/api/markets', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cached = getCache('markets');
    if (cached) return res.json(cached);
    const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=1h,24h,7d', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' }
    });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    setCache('markets', data, 60 * 1000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market data', details: err.message });
  }
});

app.get('/api/global', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cached = getCache('global');
    if (cached) return res.json(cached);
    const response = await fetch('https://api.coingecko.com/api/v3/global', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' }
    });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    setCache('global', data, 60 * 1000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch global data', details: err.message });
  }
});

app.get('/api/coin/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const id = req.params.id;
    const cached = getCache(`coin_${id}`);
    if (cached) return res.json(cached);
    const [coinRes, chartRes] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' }
      }),
      fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' }
      })
    ]);
    if (!coinRes.ok) throw new Error(`Coin not found: ${coinRes.status}`);
    const coin = await coinRes.json();
    const chart = chartRes.ok ? await chartRes.json() : { prices: [] };
    const result = { coin, chart };
    setCache(`coin_${id}`, result, 2 * 60 * 1000);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coin', details: err.message });
  }
});

// Static files AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BookMyCrypto running on http://localhost:${PORT}`);
});
