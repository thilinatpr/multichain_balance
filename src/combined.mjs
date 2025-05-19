//src/combined.mjs
import express from 'express';
import bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'node:buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// Network Configurations
// ======================

const NETWORKS_CONFIG = {
  bitcoin: {
    lib: bitcoin,
    network: bitcoin.networks.bitcoin,
    apiBase: 'https://blockstream.info/api/',
    prefixes: {
      p2pkh: ['1'],
      p2sh: ['3'],
      bech32: ['bc1'],
    },
    coinSymbol: 'BTC',
    unit: 'satoshi',
    name: 'Bitcoin'
  },
  dogecoin: {
    apiBase: 'https://api.blockcypher.com/v1/doge/main/',
    prefixes: {
      p2pkh: ['D'],
      p2sh: ['9', 'A'],
    },
    coinSymbol: 'DOGE',
    unit: '',
    name: 'Dogecoin'
  },
  litecoin: {
    apiBase: 'https://api.blockcypher.com/v1/ltc/main/',
    prefixes: {
      p2pkh: ['L'],
      p2sh: ['M'],
      bech32: ['ltc1'],
    },
    coinSymbol: 'LTC',
    unit: 'litoshi',
    name: 'Litecoin'
  },
  near: {
    RPC_ENDPOINT: 'https://rpc.mainnet.near.org',
    CACHE_TTL: 30_000,
    SCAM_PATTERNS: [
      /(?:free|airdrop|reward|giveaway|claim|won|raffle)/i,
      /(?:http|www|\.com|\.org|\.net)/i,
      /[🎉💰🤑🔵👉]/
    ],
    VERIFIED_TOKENS: new Set([
      'usdt.tether-token.near',
      '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      'wrap.near',
      'token.v2.ref-finance.near',
      'meta-pool.near',
      'linear-protocol.near'
    ]),
    coinSymbol: 'NEAR',
    unit: 'yoctoNEAR',
    name: 'NEAR Protocol'
  },
  solana: {
    RPC_ENDPOINT: 'https://api.mainnet-beta.solana.com',
    CACHE_TTL: 30_000,
    SCAM_PATTERNS: [
      /(?:free|airdrop|reward|giveaway|claim|won|raffle)/i,
      /(?:http|www|\.com|\.org|\.net)/i,
      /[🎉💰🤑🔵👉]/
    ],
    VERIFIED_TOKENS: new Set([
      'So11111111111111111111111111111111111111112', // Wrapped SOL
      'Es9vMFrzaCERbb5xqW6Xh5U9k9XbV7bXv9b6o8u6Xx6u', // USDT
    ]),
    coinSymbol: 'SOL',
    unit: 'lamports',
    name: 'Solana',
    connection: null // Will be initialized later
  }
};

// Initialize Solana connection
NETWORKS_CONFIG.solana.connection = new Connection(NETWORKS_CONFIG.solana.RPC_ENDPOINT);

// ======================
// Shared Utilities
// ======================

app.use(express.json());

const standardResponse = (success, data, message = '') => ({
  success,
  data,
  message,
  timestamp: new Date().toISOString(),
});

// Start the server (only in non-Vercel environments)
//if (!process.env.VERCEL) {
//  app.listen(PORT, () => {
//    console.log(`Server listening on port ${PORT}`);
//  });
//}

// Validate address for supported networks
const validateAddress = (network, address) => {
  const config = NETWORKS_CONFIG[network];
  if (!config) throw new Error(`Unsupported network: ${network}`);

  try {
    if (network === 'bitcoin') {
      if (config.prefixes.p2pkh.some(p => address.startsWith(p)) ||
          config.prefixes.p2sh.some(p => address.startsWith(p))) {
        config.lib.address.fromBase58Check(address);
      } else if (config.prefixes.bech32.some(p => address.startsWith(p))) {
        config.lib.address.fromBech32(address);
      } else {
        throw new Error('Unsupported Bitcoin address format');
      }
    } 
    else if (network === 'dogecoin') {
      if (!config.prefixes.p2pkh.some(p => address.startsWith(p)) && 
          !config.prefixes.p2sh.some(p => address.startsWith(p))) {
        throw new Error('Invalid Dogecoin address format');
      }
      if (address.length < 27 || address.length > 34) {
        throw new Error('Invalid Dogecoin address length');
      }
    }
    else if (network === 'litecoin') {
      if (!config.prefixes.p2pkh.some(p => address.startsWith(p)) && 
          !config.prefixes.p2sh.some(p => address.startsWith(p)) &&
          !config.prefixes.bech32.some(p => address.startsWith(p))) {
        throw new Error('Invalid Litecoin address format');
      }
      if (address.length < 26 || address.length > 34) {
        throw new Error('Invalid Litecoin address length');
      }
    }
    else if (network === 'solana') {
      try {
        new PublicKey(address);
      } catch {
        throw new Error('Invalid Solana address format');
      }
    }
    // NEAR addresses don't need validation in the same way
    
    return network;
  } catch (e) {
    throw new Error(`Invalid ${config.name} address: ${address} (${e.message})`);
  }
};

// ======================
// NEAR Token Utilities
// ======================

const nearTokenCache = new Map();

function isNearLikelyScamToken(token) {
  return NETWORKS_CONFIG.near.SCAM_PATTERNS.some(pattern =>
    pattern.test(token.symbol) ||
    pattern.test(token.contract) ||
    (token.reference && pattern.test(token.reference))
  );
}

async function getNearTokenBalance(accountId, contractId) {
  try {
    const response = await fetch(NETWORKS_CONFIG.near.RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dontcare",
        method: "query",
        params: {
          request_type: "call_function",
          account_id: contractId,
          method_name: "ft_balance_of",
          args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString("base64"),
          finality: "final"
        }
      })
    });

    const { result } = await response.json();
    if (!result?.result) return null;

    return Buffer.from(result.result).toString();
  } catch {
    return null;
  }
}

async function getNearTokenMetadata(contractId) {
  const cached = nearTokenCache.get(contractId);
  if (cached && (Date.now() - cached.timestamp) < NETWORKS_CONFIG.near.CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(NETWORKS_CONFIG.near.RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dontcare",
        method: "query",
        params: {
          request_type: "call_function",
          account_id: contractId,
          method_name: "ft_metadata",
          args_base64: Buffer.from(JSON.stringify({})).toString("base64"),
          finality: "final"
        }
      })
    });

    const { result } = await response.json();
    if (!result?.result) return null;

    const metadata = JSON.parse(Buffer.from(result.result).toString());
    if (!metadata?.symbol || metadata.decimals === undefined) return null;

    const tokenData = {
      symbol: metadata.symbol.trim(),
      decimals: Number(metadata.decimals),
      icon: metadata.icon || null,
      reference: metadata.reference || null
    };

    nearTokenCache.set(contractId, {
      data: tokenData,
      timestamp: Date.now()
    });

    return tokenData;
  } catch {
    return null;
  }
}

async function processNearTokensWithBalances(accountId, contractIds, concurrency = 5) {
  const results = [];

  for (let i = 0; i < contractIds.length; i += concurrency) {
    const batch = contractIds.slice(i, i + concurrency);
    const batchPromises = batch.map(async (contractId) => {
      const [metadata, balance] = await Promise.all([
        getNearTokenMetadata(contractId),
        getNearTokenBalance(accountId, contractId)
      ]);

      if (!metadata || balance === null) return null;

      const token = {
        contract: contractId,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
        balance: balance,
        formatted_balance: (Number(balance) / (10 ** metadata.decimals)).toFixed(4),
        icon: metadata.icon,
        reference: metadata.reference,
        verified: NETWORKS_CONFIG.near.VERIFIED_TOKENS.has(contractId)
      };

      if (NETWORKS_CONFIG.near.VERIFIED_TOKENS.has(contractId)) return token;
      if (isNearLikelyScamToken(token)) return null;
      if (metadata.reference || metadata.icon) return token;

      return null;
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

// ======================
// Solana Token Utilities
// ======================

function isSolanaLikelyScamToken(mint) {
  return NETWORKS_CONFIG.solana.SCAM_PATTERNS.some(pattern => pattern.test(mint));
}

async function getSolanaSplTokens(pubkey) {
  const tokenAccounts = await NETWORKS_CONFIG.solana.connection.getParsedTokenAccountsByOwner(pubkey, {
    programId: TOKEN_PROGRAM_ID
  });

  const tokens = [];

  for (const { account } of tokenAccounts.value) {
    const parsedInfo = account.data.parsed.info;
    const mint = parsedInfo.mint;
    const amountRaw = parsedInfo.tokenAmount.amount;
    const decimals = parsedInfo.tokenAmount.decimals;

    // Filter out NFTs: decimals=0 and balance=1
    if (decimals === 0 && amountRaw === "1") continue;
    // Filter out tokens matching scam patterns on mint address
    if (isSolanaLikelyScamToken(mint)) continue;

    tokens.push({
      mint,
      balance: amountRaw,
      decimals,
      formatted_balance: (Number(amountRaw) / (10 ** decimals)).toFixed(4),
      verified: NETWORKS_CONFIG.solana.VERIFIED_TOKENS.has(mint)
    });
  }

  return tokens;
}

async function getSolanaBalances(account) {
  try {
    const pubkey = new PublicKey(account);

    // Native SOL balance
    const lamports = await NETWORKS_CONFIG.solana.connection.getBalance(pubkey);
    const solBalance = lamports / 1e9;

    // SPL tokens
    const tokens = await getSolanaSplTokens(pubkey);

    return {
      sol: {
        symbol: 'SOL',
        balance: lamports.toString(),
        formatted_balance: solBalance.toFixed(9),
        verified: true,
        logoURI: 'https://cryptologos.cc/logos/solana-sol-logo.png?v=025'
      },
      tokens
    };
  } catch (error) {
    return { sol: null, tokens: [] };
  }
}

// ======================
// API Endpoints
// ======================

// Get balance endpoint for Bitcoin, Dogecoin, and Litecoin
app.get('/api/balance/:network/:address', async (req, res) => {
  try {
    const { network, address } = req.params;
    
    if (!NETWORKS_CONFIG[network]) {
      throw new Error(`Unsupported network: ${network}`);
    }

    validateAddress(network, address);
    const config = NETWORKS_CONFIG[network];

    if (network === 'bitcoin') {
      const response = await fetch(`${config.apiBase}address/${address}`);
      if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
      const data = await response.json();
      const confirmed = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
      const unconfirmed = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
      const balanceData = {
        network,
        coinSymbol: config.coinSymbol,
        address,
        confirmed_balance: confirmed,
        unconfirmed_balance: unconfirmed,
        total_balance: confirmed + unconfirmed,
        unit: config.unit,
        transaction_count: data.chain_stats.tx_count + data.mempool_stats.tx_count,
      };
      res.json(standardResponse(true, balanceData));
    } 
    else if (network === 'dogecoin' || network === 'litecoin') {
      const response = await fetch(`${config.apiBase}addrs/${address}/balance`);
      if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
      const data = await response.json();
      const balanceData = {
        network,
        coinSymbol: config.coinSymbol,
        address: data.address,
        total_received: data.total_received,
        total_sent: data.total_sent,
        balance: data.balance,
        unconfirmed_balance: data.unconfirmed_balance,
        final_balance: data.final_balance,
        transaction_count: data.n_tx,
        unconfirmed_transaction_count: data.unconfirmed_n_tx,
        final_transaction_count: data.final_n_tx,
        unit: config.unit,
      };
      res.json(standardResponse(true, balanceData));
    }
    else if (network === 'solana') {
      const result = await getSolanaBalances(address);
      res.json(standardResponse(true, result));
    }
    else if (network === 'near') {
      // Native NEAR balance
      const response = await fetch(NETWORKS_CONFIG.near.RPC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "dontcare",
          method: "query",
          params: {
            request_type: "view_account",
            account_id: address,
            finality: "final"
          }
        })
      });
      const { result } = await response.json();
      if (!result) throw new Error("Account not found");
      // Get tokens (for demo, use a small list or fetch from indexer)
      const tokenContracts = Array.from(NETWORKS_CONFIG.near.VERIFIED_TOKENS);
      const tokens = await processNearTokensWithBalances(address, tokenContracts);
      res.json(standardResponse(true, {
        near: {
          symbol: 'NEAR',
          balance: result.amount,
          formatted_balance: (Number(result.amount) / 1e24).toFixed(5),
          storage_usage: result.storage_usage,
        },
        tokens
      }));
    }
    else {
      throw new Error('Network not implemented in this endpoint');
    }
  } catch (error) {
    res.status(400).json(standardResponse(false, null, error.message));
  }
});

export default app;

// Batch balance endpoint for Bitcoin, Dogecoin, and Litecoin
app.post('/api/balances/:network', async (req, res) => {
  try {
    const { network } = req.params;
    const { addresses } = req.body;
    if (!NETWORKS_CONFIG[network]) throw new Error(`Unsupported network: ${network}`);
    if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('Please provide an array of addresses');
    if (addresses.length > 20) throw new Error('Batch limit exceeded (max 20 addresses per request)');

    const config = NETWORKS_CONFIG[network];
    const results = await Promise.all(
      addresses.map(async (address) => {
        try {
          validateAddress(network, address);
          if (network === 'bitcoin') {
            const response = await fetch(`${config.apiBase}address/${address}`);
            const data = await response.json();
            const confirmed = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
            const unconfirmed = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
            return {
              network,
              coinSymbol: config.coinSymbol,
              address,
              confirmed_balance: confirmed,
              unconfirmed_balance: unconfirmed,
              total_balance: confirmed + unconfirmed,
              unit: config.unit,
              transaction_count: data.chain_stats.tx_count + data.mempool_stats.tx_count,
              status: 'success'
            };
          } 
          else if (network === 'dogecoin' || network === 'litecoin') {
            const response = await fetch(`${config.apiBase}addrs/${address}/balance`);
            const data = await response.json();
            return {
              network,
              coinSymbol: config.coinSymbol,
              address: data.address,
              total_received: data.total_received,
              total_sent: data.total_sent,
              balance: data.balance,
              unconfirmed_balance: data.unconfirmed_balance,
              final_balance: data.final_balance,
              transaction_count: data.n_tx,
              unconfirmed_transaction_count: data.unconfirmed_n_tx,
              final_transaction_count: data.final_n_tx,
              unit: config.unit,
              status: 'success'
            };
          }
          else if (network === 'solana') {
            const result = await getSolanaBalances(address);
            return { ...result, status: 'success' };
          }
          else if (network === 'near') {
            const response = await fetch(NETWORKS_CONFIG.near.RPC_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: "dontcare",
                method: "query",
                params: {
                  request_type: "view_account",
                  account_id: address,
                  finality: "final"
                }
              })
            });
            const { result } = await response.json();
            if (!result) throw new Error("Account not found");
            const tokenContracts = Array.from(NETWORKS_CONFIG.near.VERIFIED_TOKENS);
            const tokens = await processNearTokensWithBalances(address, tokenContracts);
            return {
              near: {
                symbol: 'NEAR',
                balance: result.amount,
                formatted_balance: (Number(result.amount) / 1e24).toFixed(5),
                storage_usage: result.storage_usage,
              },
              tokens,
              status: 'success'
            };
          }
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

