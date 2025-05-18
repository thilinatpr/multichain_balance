import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Dogecoin network configuration
const DOGE_CONFIG = {
  apiBase: 'https://api.blockcypher.com/v1/doge/main/',
  prefixes: {
    p2pkh: ['D'],
    p2sh: ['9', 'A'],
  },
  coinSymbol: 'DOGE',
  unit: '' // 1 DOGE = 100,000,000 satoshis
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

// Validate Dogecoin address
const validateAddress = (address) => {
  try {
    const { prefixes } = DOGE_CONFIG;

    if (!prefixes.p2pkh.some(p => address.startsWith(p)) && 
        !prefixes.p2sh.some(p => address.startsWith(p))) {
      throw new Error('Invalid Dogecoin address format');
    }

    if (address.length < 27 || address.length > 34) {
      throw new Error('Invalid Dogecoin address length');
    }

    return 'dogecoin';
  } catch (e) {
    throw new Error(`Invalid Dogecoin address: ${address} (${e.message})`);
  }
};

// Get balance endpoint
app.get('/api/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    validateAddress(address);
    const { apiBase, coinSymbol, unit } = DOGE_CONFIG;

    const response = await fetch(`${apiBase}addrs/${address}/balance`);
    
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    const balanceData = {
      network: 'dogecoin',
      coinSymbol,
      address: data.address,
      total_received: data.total_received,
      total_sent: data.total_sent,
      balance: data.balance,
      unconfirmed_balance: data.unconfirmed_balance,
      final_balance: data.final_balance,
      transaction_count: data.n_tx,
      unconfirmed_transaction_count: data.unconfirmed_n_tx,
      final_transaction_count: data.final_n_tx,
      unit,
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
          const { apiBase, coinSymbol, unit } = DOGE_CONFIG;
          
          const response = await fetch(`${apiBase}addrs/${address}/balance`);
          
          if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
          }
          
          const data = await response.json();
          
          return {
            network: 'dogecoin',
            coinSymbol,
            address: data.address,
            total_received: data.total_received,
            total_sent: data.total_sent,
            balance: data.balance,
            unconfirmed_balance: data.unconfirmed_balance,
            final_balance: data.final_balance,
            transaction_count: data.n_tx,
            unconfirmed_transaction_count: data.unconfirmed_n_tx,
            final_transaction_count: data.final_n_tx,
            unit,
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
    name: 'dogecoin',
    coinSymbol: DOGE_CONFIG.coinSymbol,
    prefixes: DOGE_CONFIG.prefixes,
    apiBase: DOGE_CONFIG.apiBase,
    unit: DOGE_CONFIG.unit
  }]));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json(standardResponse(true, { 
    status: 'healthy',
    supportedNetworks: ['dogecoin'],
    timestamp: new Date().toISOString()
  }));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Supported network: Dogecoin (DOGE)');
});