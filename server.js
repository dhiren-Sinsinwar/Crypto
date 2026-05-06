// BookMyCrypto Server
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
app.use(cors());

// ── Cache ──
const cache = {};
function getCache(key) {
  const e = cache[key];
  if (!e || Date.now() - e.ts > e.ttl) return null;
  return e.data;
}
function setCache(key, data, ttl) {
  cache[key] = { data, ts: Date.now(), ttl };
}

// ── CoinGecko headers with Demo API key ──
function cgHeaders() {
  const h = { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' };
  if (process.env.COINGECKO_API_KEY) h['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  return h;
}

const NEWS_HEADERS = { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' };

// ── Routes ──

app.get('/api/markets', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cached = getCache('markets');
    if (cached) return res.json(cached);
    const data = await fetchMarkets();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market data', details: err.message });
  }
});

async function fetchMarkets() {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=1h,24h,7d';
  const response = await fetch(url, { headers: cgHeaders() });
  if (!response.ok) throw new Error(`CoinGecko ${response.status}: ${await response.text()}`);
  const data = await response.json();
  setCache('markets', data, 120 * 1000); // 2 min cache
  return data;
}

app.get('/api/global', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cached = getCache('global');
    if (cached) return res.json(cached);
    const response = await fetch('https://api.coingecko.com/api/v3/global', { headers: cgHeaders() });
    if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
    const data = await response.json();
    setCache('global', data, 120 * 1000);
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
      fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`, { headers: cgHeaders() }),
      fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30`, { headers: cgHeaders() })
    ]);
    if (!coinRes.ok) throw new Error(`Coin not found: ${coinRes.status}`);
    const coin  = await coinRes.json();
    const chart = chartRes.ok ? await chartRes.json() : { prices: [] };
    const result = { coin, chart };
    setCache(`coin_${id}`, result, 3 * 60 * 1000);
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

    // Try CryptoCompare first
    try {
      const sortOrder = filter === 'latest' ? 'latest' : 'popular';
      const r = await fetch(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=${sortOrder}`, { headers: NEWS_HEADERS });
      if (r.ok) {
        const data = await r.json();
        if (data.Data && data.Data.length > 0) {
          setCache(`news_${filter}`, data, 5 * 60 * 1000);
          return res.json(data);
        }
      }
    } catch(e) {}

    // Fallback: CoinDesk RSS
    try {
      const r = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://www.coindesk.com/arc/outboundfeeds/rss/', { headers: NEWS_HEADERS });
      if (r.ok) {
        const rss = await r.json();
        const data = {
          Data: (rss.items || []).slice(0, 20).map((item, i) => ({
            id: i, title: item.title, url: item.link,
            source: 'CoinDesk', source_info: { name: 'CoinDesk' },
            published_on: Math.floor(new Date(item.pubDate).getTime() / 1000),
            categories: 'Crypto|Bitcoin|News'
          }))
        };
        setCache(`news_${filter}`, data, 5 * 60 * 1000);
        return res.json(data);
      }
    } catch(e) {}

    res.json({ Data: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BookMyCrypto running on http://localhost:${PORT}`);
  fetchMarkets().then(() => console.log('Cache warmed!')).catch(e => console.log('Warm failed:', e.message));
});
