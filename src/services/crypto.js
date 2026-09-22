const axios = require('axios');

const CACHE_TTL_MS = 30 * 1000;
let cachedPrices = null;
let cachedAt = 0;

async function getCryptoPrices() {
  const now = Date.now();
  if (cachedPrices && now - cachedAt < CACHE_TTL_MS) {
    return cachedPrices;
  }

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true');
    const data = response.data;

    cachedPrices = {
      btc: {
        price: data.bitcoin.usd,
        change: data.bitcoin.usd_24h_change
      },
      eth: {
        price: data.ethereum.usd,
        change: data.ethereum.usd_24h_change
      },
      sol: {
        price: data.solana.usd,
        change: data.solana.usd_24h_change
      },
      timestamp: new Date().toISOString()
    };
    cachedAt = now;
    return cachedPrices;
  } catch (error) {
    console.error('[CryptoService] Error fetching prices:', error.message);
    if (cachedPrices) return cachedPrices;
    return null;
  }
}

module.exports = { getCryptoPrices };
