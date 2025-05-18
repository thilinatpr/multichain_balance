import express from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const app = express();
const PORT = 3000;

const config = {
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
    // Add more verified token mint addresses here
  ])
};

const connection = new Connection(config.RPC_ENDPOINT);

function isLikelyScamToken(mint) {
  return config.SCAM_PATTERNS.some(pattern => pattern.test(mint));
}

async function getSplTokens(pubkey) {
  console.log(`[Info] Fetching SPL tokens via getParsedTokenAccountsByOwner`);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
    programId: TOKEN_PROGRAM_ID
  });

  console.log(`[Info] Found ${tokenAccounts.value.length} token accounts`);

  const tokens = [];

  for (const { account } of tokenAccounts.value) {
    const parsedInfo = account.data.parsed.info;
    const mint = parsedInfo.mint;
    const amountRaw = parsedInfo.tokenAmount.amount;
    const decimals = parsedInfo.tokenAmount.decimals;

    // Filter out NFTs: decimals=0 and balance=1
    if (decimals === 0 && amountRaw === "1") {
      console.log(`[Filter] Skipping likely NFT token mint: ${mint}`);
      continue;
    }

    // Filter out tokens matching scam patterns on mint address
    if (isLikelyScamToken(mint)) {
      console.log(`[Filter] Skipping likely scam token mint: ${mint}`);
      continue;
    }

    tokens.push({
      mint,
      balance: amountRaw,
      decimals,
      formatted_balance: (Number(amountRaw) / (10 ** decimals)).toFixed(4),
      verified: config.VERIFIED_TOKENS.has(mint)
    });
  }

  return tokens;
}

async function getBalances(account) {
  try {
    const pubkey = new PublicKey(account);

    // Native SOL balance
    const lamports = await connection.getBalance(pubkey);
    const solBalance = lamports / 1e9;
    console.log(`[Info] Native SOL balance: ${solBalance} SOL`);

    // SPL tokens
    const tokens = await getSplTokens(pubkey);

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
    console.error(`[Error] Failed to fetch balances for account: ${account}`, error);
    return { sol: null, tokens: [] };
  }
}

app.get('/verified-tokens/:account', async (req, res) => {
  try {
    const { account } = req.params;
    console.log(`[Request] Incoming request for account: ${account}`);

    try {
      new PublicKey(account);
    } catch {
      console.warn(`[Invalid] Invalid Solana account address: ${account}`);
      return res.status(400).json({ error: 'Invalid Solana account address' });
    }

    const balances = await getBalances(account);

    res.json({
      account,
      sol_balance: balances.sol,
      tokens: balances.tokens.sort((a, b) => b.verified - a.verified),
      updated_at: new Date().toISOString()
    });
    console.log(`[Response] Sent token balances for account: ${account}`);
  } catch (error) {
    console.error(`[Error] Unexpected error in /verified-tokens/:account route`, error);
    res.status(500).json({ error: error.message || 'Unknown error' });
  }
});

app.listen(PORT, () => {
  console.log(`Solana token server running on http://localhost:${PORT}`);
});
