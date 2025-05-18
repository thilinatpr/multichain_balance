import express from 'express';
import bitcoin from 'bitcoinjs-lib';

const app = express();
const PORT = process.env.PORT || 3000;

// Bitcoin network configuration
const BTC_CONFIG = {
  lib: bitcoin,
  network: bitcoin.networks.bitcoin,
  apiBase: 'https://blockstream.info/api/',
  prefixes: {
    p2pkh: ['1'],
    p2sh: ['3'],
    bech32: ['bc1'],
  },
  coinSymbol: 'BTC',
  unit: 'satoshi'
};

// Middleware
app.use(express.json());

// Standard response format
const standardResponse = (success, data, message = '') => ({
  success,
  data,
  message,
  timestamp: new Date().toISOString(),
});

// Validate Bitcoin address
const validateAddress = (address) => {
  try {
    const { lib, prefixes } = BTC_CONFIG;

    if (prefixes.p2pkh.some(p => address.startsWith(p))) {
      lib.address.fromBase58Check(address);
    } else if (prefixes.p2sh.some(p => address.startsWith(p))) {
      lib.address.fromBase58Check(address);
    } else if (prefixes.bech32.some(p => address.startsWith(p))) {
      lib.address.fromBech32(address);
    } else {
      throw new Error('Unsupported Bitcoin address format');
    }

    return 'bitcoin';
  } catch (e) {
    throw new Error(`Invalid Bitcoin address: ${address} (${e.message})`);
  }
};

// Get balance endpoint
app.get('/api/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    validateAddress(address);
    const { apiBase, coinSymbol, unit } = BTC_CONFIG;

    const response = await fetch(`${apiBase}address/${address}`);
    
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    const confirmed = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    const unconfirmed = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
    
    const balanceData = {
      network: 'bitcoin',
      coinSymbol,
      address,
      confirmed_balance: confirmed,
      unconfirmed_balance: unconfirmed,
      total_balance: confirmed + unconfirmed,
      unit,
      transaction_count: data.chain_stats.tx_count + data.mempool_stats.tx_count,
    };

    res.json(standardResponse(true, balanceData));
  } catch (error) {
    res.status(400).json(standardResponse(false, null, error.message));
  }
});

// Batch balance endpoint
app.post('/api/balances', async (req, res) => {
  try {
    const { addresses } = req.body;
    
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error('Please provide an array of addresses');
    }

    const results = await Promise.all(
      addresses.map(async (address) => {
        try {
          validateAddress(address);
          const { apiBase, coinSymbol, unit } = BTC_CONFIG;
          
          const response = await fetch(`${apiBase}address/${address}`);
          const data = await response.json();
          
          const confirmed = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
          const unconfirmed = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
          
          return {
            network: 'bitcoin',
            coinSymbol,
            address,
            confirmed_balance: confirmed,
            unconfirmed_balance: unconfirmed,
            total_balance: confirmed + unconfirmed,
            unit,
            transaction_count: data.chain_stats.tx_count + data.mempool_stats.tx_count,
            status: 'success'
          };
        } catch (error) {
          return {
            address,
            status: 'failed',
            error: error.message
          };
        }
      })
    );

    res.json(standardResponse(true, results));
  } catch (error) {
    res.status(400).json(standardResponse(false, null, error.message));
  }
});

// Network info endpoint
app.get('/api/networks', (req, res) => {
  res.json(standardResponse(true, [{
    name: 'bitcoin',
    coinSymbol: BTC_CONFIG.coinSymbol,
    prefixes: BTC_CONFIG.prefixes,
    apiBase: BTC_CONFIG.apiBase,
    unit: BTC_CONFIG.unit
  }]));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json(standardResponse(true, { 
    status: 'healthy',
    supportedNetworks: ['bitcoin'],
    timestamp: new Date().toISOString()
  }));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Supported network: Bitcoin (BTC)');
});