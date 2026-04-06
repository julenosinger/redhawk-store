# Shukly Store

## Project Overview
- **Name**: Shukly Store
- **Goal**: Decentralized marketplace on Arc Network with fully on-chain escrow
- **Features**: Browse products, cart, checkout with on-chain escrow, seller dashboard, dispute system

## URLs
- **Production**: https://shukly-store.pages.dev
- **Latest Deploy**: https://ab3af930.shukly-store.pages.dev
- **GitHub**: https://github.com/julenosinger/redhawk-store

## Escrow Architecture (Direct On-Chain — No Relayer)

All escrow actions are direct smart-contract calls from the user's wallet via MetaMask or internal wallet. **No relayer, no RELAYER_PRIVATE_KEY, no Permit2.**

### ShuklyEscrow Contract Functions
| Function | Caller | Description |
|---|---|---|
| `createEscrow(orderId32, seller, token, amount)` | Buyer | Registers escrow slot on-chain |
| `fundEscrow(orderId32)` | Buyer | Pulls tokens from buyer → escrow contract |
| `confirmDelivery(orderId32)` | Buyer | Signals goods received |
| `releaseFunds(orderId32)` | Buyer | Releases locked tokens to seller |
| `refund(orderId32)` | Buyer | Returns tokens to buyer |
| `openDispute(orderId32)` | Buyer/Seller | Locks funds, triggers dispute |

### Full Transaction Flow
1. **Checkout**: `approve(ShuklyEscrow, amount)` → `createEscrow(...)` → `fundEscrow(...)`
2. **Seller ships**: Marks order as shipped (off-chain)
3. **Buyer confirms**: `confirmDelivery(orderId32)` on-chain
4. **Release**: `releaseFunds(orderId32)` → tokens transferred to seller

Every tx is sent to the **escrow contract address** — never directly to the seller.

### Deploy Escrow Contract
Visit `/deploy-escrow` to deploy the ShuklyEscrow contract via MetaMask. The deployed address is saved to localStorage and used for all subsequent checkouts.

## Smart Contracts (Arc Testnet, Chain ID: 5042002)
- **USDC**: `0x3600000000000000000000000000000000000000`
- **EURC**: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`
- **ShuklyEscrow**: Deploy via `/deploy-escrow` page (bytecode embedded in frontend)

## Data Architecture
- **Orders**: localStorage (`rh_orders` key)
- **Escrow address**: localStorage (`shukly_escrow_address` key)
- **Products**: Cloudflare D1 SQLite (off-chain metadata)
- **Dispute evidence**: localStorage (`rh_dispute_evidence` key)

## API Endpoints
- `GET /api/arc-config` — chain config for frontend
- `GET /api/products` — list products
- `POST /api/products` — create product
- `GET /api/products/:id` — product detail
- `POST /api/orders` — save order metadata

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: ✅ Active
- **Tech Stack**: Hono + TypeScript + TailwindCSS + ethers.js v6
- **Last Updated**: 2026-04-06
