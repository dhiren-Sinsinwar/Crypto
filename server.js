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

const HEADERS = { 'Accept': 'application/json', 'User-Agent': 'BookMyCrypto/1.0' };

// Top 20 coins config - symbol, name, binance pair
const COINS = [
  { id:'bitcoin',      symbol:'BTC', name:'Bitcoin',      pair:'BTCUSDT' },
  { id:'ethereum',     symbol:'ETH', name:'Ethereum',     pair:'ETHUSDT' },
  { id:'tether',       symbol:'USDT',name:'Tether',       pair:null },
  { id:'xrp',          symbol:'XRP', name:'XRP',          pair:'XRPUSDT' },
  { id:'bnb',          symbol:'BNB', name:'BNB',          pair:'BNBUSDT' },
  { id:'usd-coin',     symbol:'USDC',name:'USDC',         pair:null },
  { id:'solana',       symbol:'SOL', name:'Solana',       pair:'SOLUSDT' },
  { id:'dogecoin',     symbol:'DOGE',name:'Dogecoin',     pair:'DOGEUSDT' },
  { id:'cardano',      symbol:'ADA', name:'Cardano',      pair:'ADAUSDT' },
  { id:'tron',         symbol:'TRX', name:'TRON',         pair:'TRXUSDT' },
  { id:'avalanche',    symbol:'AVAX',name:'Avalanche',    pair:'AVAXUSDT' },
  { id:'shiba-inu',    symbol:'SHIB',name:'Shiba Inu',    pair:'SHIBUSDT' },
  { id:'chainlink',    symbol:'LINK',name:'Chainlink',    pair:'LINKUSDT' },
  { id:'polkadot',     symbol:'DOT', name:'Polkadot',     pair:'DOTUSDT' },
  { id:'bitcoin-cash', symbol:'BCH', name:'Bitcoin Cash', pair:'BCHUSDT' },
  { id:'near-protocol',symbol:'NEAR',name:'NEAR Protocol',pair:'NEARUSDT' },
  { id:'uniswap',      symbol:'UNI', name:'Uniswap',      pair:'UNIUSDT' },
  { id:'litecoin',     symbol:'LTC', name:'Litecoin',     pair:'LTCUSDT' },
  { id:'stellar',      symbol:'XLM', name:'Stellar',      pair:'XLMUSDT' },
  { id:'monero',       symbol:'XMR', name:'Monero',       pair:'XMRUSDT' },
];

const COIN_IMAGES = {
  BTC:'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH:'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  USDT:'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  XRP:'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  BNB:'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  USDC:'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  SOL:'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  DOGE:'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  ADA:'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  TRX:'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  AVAX:'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  SHIB:'https://assets.coingecko.com/coins/images/11939/small/shiba.png',
  LINK:'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  DOT:'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  BCH:'https://assets.coingecko.com/coins/images/780/small/bitcoin-cash-circle.png',
  NEAR:'https://assets.coingecko.com/coins/images/10365/small/near.jpg',
  UNI:'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png',
  LTC:'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  XLM:'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png',
  XMR:'https://assets.coingecko.com/coins/images/69/small/monero_logo.png',
};

// Fetch all market data from Binance
async function fetchMarkets() {
  const cached = getCache('markets');
  if (cached) return cached;

  // Get all tickers from Binance in one call
  const pairs = COINS.filter(c => c.pair).map(c => c.pair);
  const [tickerRes, klineResults] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${JSON.stringify(pairs)}`, { headers: HEADERS }),
    Promise.allSettled(COINS.filter(c => c.pair).map(c =>
      fetch(`https://api.binance.com/api/v3/klines?symbol=${c.pair}&interval=1d&limit=7`, { headers: HEADERS })
        .then(r => r.json()).then(d => ({ id: c.id, data: d })).catch(() => ({ id: c.id, data: [] }))
    ))
  ]);

  const tickers = tickerRes.ok ? await tickerRes.json() : [];
  const tickerMap = {};
  tickers.forEach(t => { tickerMap[t.symbol] = t; });

  const sparklineMap = {};
  klineResults.forEach(r => {
    if (r.status === 'fulfilled') {
      const { id, data } = r.value;
      sparklineMap[id] = Array.isArray(data) ? data.map(k => parseFloat(k[4])) : [];
    }
  });

  let rank = 0;
  const markets = COINS.map(c => {
    rank++;
    const t = c.pair ? tickerMap[c.pair] : null;
    const price = t ? parseFloat(t.lastPrice) : (c.symbol === 'USDT' || c.symbol === 'USDC' ? 1.0 : 0);
    const ch24  = t ? parseFloat(t.priceChangePercent) : 0;
    const vol   = t ? parseFloat(t.quoteVolume) : 0;
    const mcap  = price * ({ BTC:19700000, ETH:120000000, USDT:110000000000, XRP:57000000000, BNB:145000000, USDC:33000000000, SOL:460000000, DOGE:146000000000, ADA:35000000000, TRX:87000000000, AVAX:410000000, SHIB:589000000000000, LINK:600000000, DOT:1400000000, BCH:19700000, NEAR:1000000000, UNI:600000000, LTC:74000000, XLM:29000000000, XMR:18000000 }[c.symbol] || 0);

    return {
      id: c.id,
      symbol: c.symbol.toLowerCase(),
      name: c.name,
      image: COIN_IMAGES[c.symbol] || `https://assets.coingecko.com/coins/images/1/small/bitcoin.png`,
      current_price: price,
      market_cap: mcap,
      market_cap_rank: rank,
      total_volume: vol,
      price_change_percentage_24h: ch24,
      price_change_percentage_1h_in_currency: null,
      price_change_percentage_7d_in_currency: null,
      circulating_supply: 0,
      sparkline_in_7d: { price: sparklineMap[c.id] || [] }
    };
  });

  setCache('markets', markets, 90 * 1000);
  return markets;
}

// ── Routes ──

app.get('/api/markets', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try { res.json(await fetchMarkets()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/global', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cached = getCache('global');
    if (cached) return res.json(cached);

    const markets = await fetchMarkets();
    const totalMcap = markets.reduce((s, c) => s + c.market_cap, 0);
    const totalVol  = markets.reduce((s, c) => s + c.total_volume, 0);
    const btc = markets.find(c => c.id === 'bitcoin');
    const btcDom = btc && totalMcap > 0 ? (btc.market_cap / totalMcap) * 100 : 0;

    const result = {
      data: {
        total_market_cap: { usd: totalMcap },
        total_volume: { usd: totalVol },
        market_cap_percentage: { btc: btcDom, eth: 0 },
        market_cap_change_percentage_24h_usd: btc ? btc.price_change_percentage_24h : 0,
        active_cryptocurrencies: 10000,
        markets: 600
      }
    };
    setCache('global', result, 90 * 1000);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/coin/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const id = req.params.id;
    const cached = getCache(`coin_${id}`);
    if (cached) return res.json(cached);

    const coinConfig = COINS.find(c => c.id === id);
    const markets = await fetchMarkets();
    const market = markets.find(c => c.id === id);

    if (!market) return res.status(404).json({ error: 'Coin not found' });

    // Fetch 30d chart from Binance
    let chartPrices = [];
    if (coinConfig && coinConfig.pair) {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${coinConfig.pair}&interval=1d&limit=30`, { headers: HEADERS });
        const klines = await r.json();
        chartPrices = klines.map(k => [k[0], parseFloat(k[4])]);
      } catch(e) {}
    }

    const price = market.current_price;
    const coin = {
      id: market.id,
      symbol: market.symbol,
      name: market.name,
      image: { large: market.image },
      market_cap_rank: market.market_cap_rank,
      description: { en: '' },
      categories: ['Cryptocurrency'],
      links: {},
      market_data: {
        current_price: { usd: price },
        market_cap: { usd: market.market_cap },
        total_volume: { usd: market.total_volume },
        high_24h: { usd: price * (1 + Math.abs(market.price_change_percentage_24h) / 100) },
        low_24h: { usd: price * (1 - Math.abs(market.price_change_percentage_24h) / 100) },
        price_change_percentage_24h: market.price_change_percentage_24h,
        price_change_percentage_7d: null,
        price_change_percentage_1h_in_currency: { usd: null },
        market_cap_change_percentage_24h: market.price_change_percentage_24h,
        circulating_supply: 0,
        total_supply: null,
        max_supply: null,
        ath: { usd: price * 1.5 },
        ath_change_percentage: { usd: -33 },
        atl: { usd: price * 0.1 },
        fully_diluted_valuation: { usd: null }
      }
    };

    const result = { coin, chart: { prices: chartPrices } };
    setCache(`coin_${id}`, result, 2 * 60 * 1000);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
      const r = await fetch(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=${sortOrder}`, { headers: HEADERS });
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
      const r = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://www.coindesk.com/arc/outboundfeeds/rss/', { headers: HEADERS });
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BookMyCrypto running on http://localhost:${PORT}`);
  // Pre-warm cache
  fetchMarkets().then(() => console.log('Cache warmed!')).catch(e => console.log('Warm failed:', e.message));
});
