const axios = require('axios');

async function getCryptoPrices() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true');
    const data = response.data;
    
    return {
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
  } catch (error) {
    console.error('[CryptoService] Error fetching prices:', error.message);
    return null;
  }
}

module.exports = { getCryptoPrices };
