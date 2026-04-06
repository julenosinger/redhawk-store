# redhawk-store

## Project Overview
- **Name**: redhawk-store
- **Goal**: Decentralized marketplace on Arc Testnet with trustless escrow via FxEscrow contract
- **Language**: English-only
- **Features**: Browse products, cart, checkout with escrow, order tracking, dispute resolution, seller dashboard

## URLs
- **GitHub**: https://github.com/julenosinger/redhawk-store
- **Arc Testnet Explorer**: https://testnet.arcscan.app
- **Faucet**: https://faucet.circle.com

## Escrow Architecture

### Token Flow (correct, trustless)
```
Buyer → approve(Permit2)          [on-chain, ERC-20, once per token]
Buyer → sign EIP-712 witness      [off-chain, no gas]
Relayer → recordTrade(FxEscrow)   [on-chain — tx "to" = escrow contract]
                                    ↳ FxEscrow pulls tokens from buyer
                                    ↳ Tokens locked in FxEscrow contract
                                    ↳ Seller address NEVER receives direct transfer
Buyer confirms delivery → sign release permit
Relayer → takerDeliver(FxEscrow)  [on-chain — releases to seller]
```

### Contracts on Arc Testnet
| Contract   | Address |
|------------|---------|
| USDC       | `0x3600000000000000000000000000000000000000` |
| EURC       | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| Permit2    | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| FxEscrow   | `0x867650F5eAe8df91445971f14d89fd84F0C9a9f8` |

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/escrow/record-trade` | Relayer: call `recordTrade()` on FxEscrow |
| POST | `/api/escrow/deliver` | Relayer: call `takerDeliver/makerDeliver` to release funds |
| POST | `/api/orders` | Save order metadata after escrow tx |
| GET  | `/api/arc-config` | Returns ARC network config + contract addresses |
| GET  | `/api/products` | List products |
| POST | `/api/products` | Create product |

## Dispute System
- Buyer or seller can open dispute on any active order
- Funds remain locked in FxEscrow during dispute (`disputeLockedFunds: true`)
- "Release Funds" button hidden while status is `dispute`
- Evidence (PNG/JPG/PDF) uploaded via drag-and-drop, stored in localStorage
- Both parties can view uploaded evidence on the Disputes page

## Relayer Configuration
To enable live escrow transactions, set the `RELAYER_PRIVATE_KEY` Cloudflare secret:
```bash
npx wrangler pages secret put RELAYER_PRIVATE_KEY --project-name <project>
```
Without this key, orders are saved as `escrow_pending` — no tokens are ever sent directly to the seller.

## Data Architecture
- **Orders**: stored in `localStorage` key `rh_orders` (client-side)
- **Dispute evidence**: stored in `localStorage` key `rh_dispute_evidence`
- **Products**: stored in Cloudflare D1 SQLite database
- **Storage**: Cloudflare D1 for product listings

## Deployment
- **Platform**: Cloudflare Pages / Workers
- **Tech Stack**: Hono + TypeScript + Tailwind CSS + ethers.js v6
- **Build**: `npm run build` → `dist/_worker.js`
- **Status**: Active

## User Guide
1. Connect wallet (MetaMask or create internal wallet)
2. Browse marketplace → Add to cart → Checkout
3. Confirm & Lock Funds → 3-step escrow process:
   - Approve Permit2 (once per token)
   - Sign the escrow permit (off-chain)
   - Relayer submits to FxEscrow contract
4. Seller marks as shipped → Buyer confirms delivery
5. Funds released via `takerDeliver` on FxEscrow

## Last Updated
2026-04-06
