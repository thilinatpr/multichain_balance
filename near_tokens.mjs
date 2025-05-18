import express from 'express';
import { Buffer } from 'node:buffer';

const app = express();
const PORT = 3000;

// Configuration
const config = {
  RPC_ENDPOINT: 'https://rpc.mainnet.near.org',
  KITWALLET_API: 'https://api.kitwallet.app/account',
  CACHE_TTL: 30_000, // 30 seconds cache
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
  ])
};

const tokenCache = new Map();

// Scam detection function
function isLikelyScamToken(token) {
  return config.SCAM_PATTERNS.some(pattern =>
    pattern.test(token.symbol) ||
    pattern.test(token.contract) ||
    (token.reference && pattern.test(token.reference))
  );
}

// Get token balance for an account
async function getTokenBalance(accountId, contractId) {
  try {
    const response = await fetch(config.RPC_ENDPOINT, {
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

    // result.result is Uint8Array in base64
    return Buffer.from(result.result).toString();
  } catch {
    return null;
  }
}

// Get token metadata with cache
async function getFullTokenMetadata(contractId) {
  const cached = tokenCache.get(contractId);
  if (cached && (Date.now() - cached.timestamp) < config.CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(config.RPC_ENDPOINT, {
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

    tokenCache.set(contractId, {
      data: tokenData,
      timestamp: Date.now()
    });

    return tokenData;
  } catch {
    return null;
  }
}

// Process tokens with balances
async function processTokensWithBalances(accountId, contractIds, concurrency = 5) {
  const results = [];

  for (let i = 0; i < contractIds.length; i += concurrency) {
    const batch = contractIds.slice(i, i + concurrency);
    const batchPromises = batch.map(async (contractId) => {
      const [metadata, balance] = await Promise.all([
        getFullTokenMetadata(contractId),
        getTokenBalance(accountId, contractId)
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
        verified: config.VERIFIED_TOKENS.has(contractId)
      };

      if (config.VERIFIED_TOKENS.has(contractId)) return token;
      if (isLikelyScamToken(token)) return null;
      if (metadata.reference || metadata.icon) return token;

      return null;
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

app.get('/verified-tokens/:account', async (req, res) => {
  let timeout;
  try {
    const { account } = req.params;
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10000);

    const tokenContracts = await fetch(`${config.KITWALLET_API}/${account}/likelyTokens`, {
      signal: controller.signal
    }).then(r => r.json());

    const tokens = await processTokensWithBalances(account, tokenContracts);

    res.json({
      account,
      tokens: tokens.sort((a, b) => b.verified - a.verified), // Verified first
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unknown error' });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
