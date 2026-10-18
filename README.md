# MUNCH ($MUNCH) — Autonomous Buyback & Burn Engine (Pons Family v2)

The public site is MUNCH, a pixel virtual pet that only eats $MUNCH: every trade fills its bowl (the fee escrow), the auto-feeder (the bot) buys $MUNCH back and MUNCH eats it at `0x…dEaD`. It evolves with the real share of supply burned. See `PRODUCT.md` for the lore.

Site: **https://feedmunch.fun** · X: **[@munch_rh](https://x.com/munch_rh)**

An autonomous token liquidity, buyback, and burn engine deployed on **Robinhood Chain (Chain ID: 4663)** integrated with **Pons Family v2**.

---

## Overview

The engine operates on a perpetual closed-loop mechanism:
1. **Trade & Tax Inflow**: Trading activity generates creator fees in native ETH accumulating in the Fee Escrow (`0xd3AFEB...Ac9e`).
2. **Auto-Claim Fee**: When claimable fees reach the configured threshold (e.g. `0.015 ETH`), the engine executes `escrow.claim()`.
3. **Auto-Buyback DEX**: Claimed ETH is immediately swapped for tokens on the DEX (Uniswap v4 / Curve).
4. **Permanent Dead Burn**: All acquired tokens are transferred directly to `0x000000000000000000000000000000000000dEaD`, permanently destroying circulating supply.

---

## Official Contracts (Robinhood Chain ID: 4663)

| Contract | Address |
|---|---|
| **Token Contract** | `0xc5547b341002dcdad191512d5f6f52a928e41bf4` |
| **Pons Factory** | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| **Uniswap v4 Router** | `0x8876789976dEcBfCbBbe364623C63652db8C0904` |
| **Fee Escrow Vault** | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| **Dead Address Sink** | `0x000000000000000000000000000000000000dEaD` |
| **RPC Endpoint** | `https://rpc.mainnet.chain.robinhood.com` |

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Copy the template and configure your parameters:
```bash
cp .env.example .env
```

Edit `.env`:
```env
VITE_TOKEN_NAME="BLAZE"
VITE_TOKEN_SYMBOL="BLAZE"
VITE_TOKEN_ADDRESS="0xc5547b341002dcdad191512d5f6f52a928e41bf4"
VITE_CURVE_ADDRESS="0x..."
VITE_CREATOR_ADDRESS="0x..."
VITE_CLAIM_THRESHOLD_ETH="0.015"
VITE_RPC_URL="https://rpc.mainnet.chain.robinhood.com"

# Server Daemon Wallet Private Key (for on-chain bot):
CREATOR_PRIVATE_KEY=""
```

### 3. Run Development Web Server
```bash
npm run dev
```

### 4. Run Autonomous 24/7 Bot Daemon (Headless)
```bash
npm run bot
```

---

## Security

- The frontend web application is strictly **read-only / public tracker**.
- The `CREATOR_PRIVATE_KEY` variable is never exposed to the client-side bundle.
- Tokens sent to `0x0...dEaD` are provably unrecoverable.

---

## Documentation
- **Pons v2 Documentation**: [docs.ponsfamily.com/v2](https://docs.ponsfamily.com/v2)
