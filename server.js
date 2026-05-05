const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// API routes MUST come before static files and catch-all
app.get('/api/news', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const apiKey = process.env.CRYPTOPANIC_API_KEY || '';
    const filter = req.query.filter || 'hot';
    const url = apiKey
      ? `https://cryptopanic.com/api/v1/posts/?auth_token=${apiKey}&public=true&filter=${filter}`
      : `https://cryptopanic.com/api/v1/posts/?public=true&filter=${filter}`;
    const response = await fetch(url);
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

app.listen(PORT, () => {
  console.log(`CryptoPulse running on http://localhost:${PORT}`);
});
