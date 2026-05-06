const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
    const cacheKey = `news_${filter}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const sortOrder = filter === 'latest' ? 'latest' : 'popular';
    const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=${sortOrder}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    setCache(cacheKey, data, 5 * 60 * 1000); // cache 5 mins
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

    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=1h,24h,7d';
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BookMyCrypto/1.0'
      }
    });
    if (!response.ok) throw new Error(`Upstream ${response.status}: ${await response.text()}`);
    const data = await response.json();
    setCache('markets', data, 60 * 1000); // cache 60 secs
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
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BookMyCrypto/1.0'
      }
    });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    setCache('global', data, 60 * 1000); // cache 60 secs
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch global data', details: err.message });
  }
});

app.get('/api/coin/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const id = req.params.id;
    const cacheKey = `coin_${id}`;
    const cached = getCache(cacheKey);
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
    const coin  = await coinRes.json();
    const chart = chartRes.ok ? await chartRes.json() : { prices: [] };
    const result = { coin, chart };
    setCache(cacheKey, result, 2 * 60 * 1000); // cache 2 mins
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coin', details: err.message });
  }
});

// Static files and SPA fallback AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BookMyCrypto running on http://localhost:${PORT}`);
});


// API routes MUST come before static files and catch-all
app.get('/api/news', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const filter = req.query.filter || 'hot';
    const sortOrder = filter === 'latest' ? 'latest' : 'popular';
    const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=${sortOrder}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch news', details: err.message });
  }
});

app.get('/api/markets', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=1h,24h,7d';
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`Upstream ${response.status}: ${await response.text()}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market data', details: err.message });
  }
});

// Coin detail page data
app.get('/api/coin/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const id = req.params.id;
    const [coinRes, chartRes] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`, { headers: { 'Accept': 'application/json' } }),
      fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30`, { headers: { 'Accept': 'application/json' } })
    ]);
    if (!coinRes.ok) throw new Error(`Coin not found: ${coinRes.status}`);
    const coin  = await coinRes.json();
    const chart = chartRes.ok ? await chartRes.json() : { prices: [] };
    res.json({ coin, chart });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coin', details: err.message });
  }
});

app.get('/api/global', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/global', {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch global data', details: err.message });
  }
});

// Static files and SPA fallback AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BookMyCrypto running on port ${PORT}`);
});
