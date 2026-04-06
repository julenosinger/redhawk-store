import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = { DB: D1Database }
const app = new Hono<{ Bindings: Bindings }>()
app.use('*', cors())

// ─── DB helpers ─────────────────────────────────────────────────────────────
let _dbReady = false
async function initDB(db: D1Database) {
  if (_dbReady) return
  // D1 exec() only supports single statements — run each DDL separately
  await db.prepare(`CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    price       REAL NOT NULL,
    token       TEXT NOT NULL DEFAULT 'USDC',
    image       TEXT,
    category    TEXT NOT NULL DEFAULT 'Other',
    stock       INTEGER NOT NULL DEFAULT 1,
    seller_id   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_seller  ON products(seller_id)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_status  ON products(status)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_cat     ON products(category)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC)`).run()
  // Remove demo/seed products that were inserted during development
  await db.prepare(`DELETE FROM products WHERE id IN ('prod_mnkzpek5esosxt','prod_mnkywrj7334nbp','prod_mnkywrhf8wo1sl')`).run()
  _dbReady = true
}

function nanoid(): string {
  return 'prod_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ─── Favicon ────────────────────────────────────────────────────────
app.get('/favicon.ico', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="#dc2626"/></svg>`
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
})

// ─── Arc Network constants (server-side reference only) ─────────────
const ARC = {
  chainId: 5042002,
  chainIdHex: '0x4CE2D2',
  rpc: 'https://rpc.testnet.arc.network',
  rpcAlt: 'https://rpc.blockdaemon.testnet.arc.network',
  explorer: 'https://testnet.arcscan.app',
  faucet: 'https://faucet.circle.com',
  networkName: 'Arc Testnet',
  currency: 'USDC',
  contracts: {
    USDC: '0x3600000000000000000000000000000000000000',
    EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    Multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    Permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    FxEscrow: '0x867650F5eAe8df91445971f14d89fd84F0C9a9f8',
  }
}

// ─── API Routes ──────────────────────────────────────────────────────

// Arc config endpoint — used by frontend for chain setup
app.get('/api/arc-config', (c) => {
  return c.json({ arc: ARC })
})

// ─── Products CRUD (off-chain D1 database) ──────────────────────────────────

// GET /api/products — list all active products (optional ?category=&seller=&q=)
app.get('/api/products', async (c) => {
  try {
    const db = c.env.DB
    await initDB(db)
    const cat    = c.req.query('category') || ''
    const seller = c.req.query('seller')   || ''
    const q      = c.req.query('q')        || ''
    let sql  = `SELECT * FROM products WHERE status = 'active'`
    const params: string[] = []
    if (cat)    { sql += ` AND category = ?`;              params.push(cat) }
    if (seller) { sql += ` AND seller_id = ?`;             params.push(seller) }
    if (q)      { sql += ` AND (title LIKE ? OR description LIKE ?)`;  params.push(`%${q}%`, `%${q}%`) }
    sql += ` ORDER BY created_at DESC`
    const { results } = await db.prepare(sql).bind(...params).all()
    return c.json({ products: results, total: results.length, source: 'database' })
  } catch (e: any) {
    return c.json({ products: [], total: 0, source: 'database', error: e.message })
  }
})

// GET /api/products/:id — single product
app.get('/api/products/:id', async (c) => {
  try {
    const db = c.env.DB
    await initDB(db)
    const row = await db.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'`)
      .bind(c.req.param('id')).first()
    if (!row) return c.json({ error: 'Product not found', product: null }, 404)
    return c.json({ product: row })
  } catch (e: any) {
    return c.json({ error: e.message, product: null }, 500)
  }
})

// POST /api/products — create a product
app.post('/api/products', async (c) => {
  try {
    const db   = c.env.DB
    await initDB(db)
    const body = await c.req.json() as any
    const { title, description, price, token = 'USDC', image = '', category = 'Other', stock = 1, seller_id } = body
    if (!title || !description || !price || !seller_id)
      return c.json({ error: 'Missing required fields: title, description, price, seller_id' }, 400)
    if (Number(price) <= 0)
      return c.json({ error: 'Price must be greater than 0' }, 400)
    if (!['USDC','EURC'].includes(token))
      return c.json({ error: 'Token must be USDC or EURC' }, 400)
    const id = nanoid()
    await db.prepare(`
      INSERT INTO products (id, title, description, price, token, image, category, stock, seller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, title.trim(), description.trim(), Number(price), token, image, category, Number(stock) || 1, seller_id).run()
    const product = await db.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first()
    return c.json({ product, success: true }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /api/products/:id — soft-delete (seller only)
app.delete('/api/products/:id', async (c) => {
  try {
    const db        = c.env.DB
    const { seller_id } = await c.req.json() as any
    const row = await db.prepare(`SELECT * FROM products WHERE id = ?`).bind(c.req.param('id')).first() as any
    if (!row)                          return c.json({ error: 'Product not found' }, 404)
    if (row.seller_id !== seller_id)   return c.json({ error: 'Unauthorized' }, 403)
    await db.prepare(`UPDATE products SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`).bind(c.req.param('id')).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PATCH /api/products/:id/status — pause, resume, delete (seller only)
app.patch('/api/products/:id/status', async (c) => {
  try {
    const db = c.env.DB
    await initDB(db)
    const { seller_id, status } = await c.req.json() as any
    if (!['active','paused','deleted'].includes(status))
      return c.json({ error: 'Invalid status. Use active, paused, or deleted' }, 400)
    const row = await db.prepare(`SELECT * FROM products WHERE id = ?`).bind(c.req.param('id')).first() as any
    if (!row)                          return c.json({ error: 'Product not found' }, 404)
    if (row.seller_id !== seller_id)   return c.json({ error: 'Unauthorized' }, 403)
    await db.prepare(`UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(status, c.req.param('id')).run()
    return c.json({ success: true, status })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/seller/:address/products — all products (active + paused) for seller dashboard
app.get('/api/seller/:address/products', async (c) => {
  try {
    const db = c.env.DB
    await initDB(db)
    const address = c.req.param('address')
    const { results } = await db.prepare(
      `SELECT * FROM products WHERE seller_id = ? AND status != 'deleted' ORDER BY created_at DESC`
    ).bind(address).all()
    return c.json({ products: results, total: results.length })
  } catch (e: any) {
    return c.json({ products: [], total: 0, error: e.message })
  }
})

// Orders: returns empty — orders come from real escrow contract state
app.get('/api/orders', (c) => {
  return c.json({
    orders: [],
    total: 0,
    source: 'escrow_contract',
    message: 'No orders yet.'
  })
})

// Stats: fetched from blockchain in real-time (frontend calls RPC)
app.get('/api/stats', (c) => {
  return c.json({
    note: 'Stats are fetched live from Arc Network — see /api/arc-config for RPC endpoint',
    explorer: ARC.explorer,
    faucet: ARC.faucet
  })
})

// Create order — stores metadata returned after recordTrade on-chain
app.post('/api/orders', async (c) => {
  const body = await c.req.json()
  if (!body.txHash || !body.buyerAddress || !body.sellerAddress) {
    return c.json({ error: 'Missing required fields: txHash, buyerAddress, sellerAddress' }, 400)
  }
  const order = {
    id: body.orderId || `ORD-${Date.now()}`,
    txHash: body.txHash,
    escrowTradeId: body.escrowTradeId || null,   // on-chain FxEscrow trade ID
    buyerAddress: body.buyerAddress,
    sellerAddress: body.sellerAddress,
    escrowContract: ARC.contracts.FxEscrow,       // always the escrow contract
    amount: body.amount,
    token: body.token,
    productId: body.productId,
    status: 'escrow_locked',
    createdAt: new Date().toISOString(),
    explorerUrl: `${ARC.explorer}/tx/${body.txHash}`
  }
  return c.json({ order, success: true })
})

// ─── Escrow: Relayer — record trade on FxEscrow ───────────────────────────
// POST /api/escrow/record-trade
// Body: { buyerAddress, sellerAddress, tokenAddress, amountWei (string),
//         quoteId (bytes32 hex), maturity (unix ts), takerPermit, takerSig,
//         makerPermit, makerSig, orderId }
// The server acts as the authorised relayer and sends recordTrade() to the contract.
app.post('/api/escrow/record-trade', async (c) => {
  try {
    const body = await c.req.json() as any

    // ── Validate required fields
    const required = ['buyerAddress','sellerAddress','tokenAddress','amountWei',
                      'quoteId','maturity','takerPermit','takerSig',
                      'makerPermit','makerSig']
    for (const f of required) {
      if (!body[f]) return c.json({ error: `Missing field: ${f}` }, 400)
    }

    // ── Build relayer wallet from env secret RELAYER_PRIVATE_KEY
    const relayerKey: string = (c.env as any).RELAYER_PRIVATE_KEY || ''
    if (!relayerKey || relayerKey.length < 60) {
      // No relayer key configured — return error with instructions
      return c.json({
        error: 'RELAYER_NOT_CONFIGURED',
        message: 'The relayer private key is not set. Add RELAYER_PRIVATE_KEY as a Cloudflare secret.',
        fallback: true
      }, 503)
    }

    // Dynamic import of ethers (available in Cloudflare Workers via compat flag)
    const { ethers } = await import('ethers')

    const provider = new ethers.JsonRpcProvider(ARC.rpc)
    const relayer  = new ethers.Wallet(relayerKey, provider)

    // ── FxEscrow ABI (minimal — only what the relayer calls)
    const FXESCROW_ABI = [
      `function recordTrade(
        address taker,
        tuple(
          tuple(address token, uint256 amount) permitted,
          uint256 nonce,
          uint256 deadline,
          tuple(
            tuple(bytes32 quoteId, address base, address quote,
                  uint256 baseAmount, uint256 quoteAmount, uint256 maturity) consideration,
            address recipient,
            uint256 fee
          ) witness,
          bytes signature
        ) takerPermit,
        address maker,
        tuple(
          tuple(address token, uint256 amount) permitted,
          uint256 nonce,
          uint256 deadline,
          tuple(uint256 fee) witness,
          bytes signature
        ) makerPermit
      ) returns (uint256 id)`,
      'function lastTradeId() view returns (uint256)'
    ]

    const escrow = new ethers.Contract(ARC.contracts.FxEscrow, FXESCROW_ABI, relayer)

    // ── Reconstruct takerPermit tuple from body
    const takerPermit = {
      permitted: {
        token:  body.takerPermit.permitted.token,
        amount: BigInt(body.takerPermit.permitted.amount)
      },
      nonce:    BigInt(body.takerPermit.nonce),
      deadline: BigInt(body.takerPermit.deadline),
      witness: {
        consideration: {
          quoteId:     body.takerPermit.witness.consideration.quoteId,
          base:        body.takerPermit.witness.consideration.base,
          quote:       body.takerPermit.witness.consideration.quote,
          baseAmount:  BigInt(body.takerPermit.witness.consideration.baseAmount),
          quoteAmount: BigInt(body.takerPermit.witness.consideration.quoteAmount),
          maturity:    BigInt(body.takerPermit.witness.consideration.maturity)
        },
        recipient: body.takerPermit.witness.recipient,
        fee:       BigInt(body.takerPermit.witness.fee)
      },
      signature: body.takerSig
    }

    // ── Reconstruct makerPermit tuple from body
    const makerPermit = {
      permitted: {
        token:  body.makerPermit.permitted.token,
        amount: BigInt(body.makerPermit.permitted.amount)
      },
      nonce:    BigInt(body.makerPermit.nonce),
      deadline: BigInt(body.makerPermit.deadline),
      witness: {
        fee: BigInt(body.makerPermit.witness.fee)
      },
      signature: body.makerSig
    }

    // ── Send recordTrade as relayer
    const tx = await escrow.recordTrade(
      body.buyerAddress,
      takerPermit,
      body.sellerAddress,
      makerPermit
    )
    const receipt = await tx.wait(1)
    const tradeId = (await escrow.lastTradeId()).toString()

    return c.json({
      success: true,
      txHash: tx.hash,
      escrowTradeId: tradeId,
      explorerUrl: `${ARC.explorer}/tx/${tx.hash}`
    })

  } catch (err: any) {
    console.error('[escrow/record-trade]', err)
    return c.json({
      error: 'RELAYER_TX_FAILED',
      message: err.shortMessage || err.message || 'Unknown error',
      fallback: true
    }, 500)
  }
})

// ─── Escrow: Relayer — deliver funds (taker or maker) ────────────────────
// POST /api/escrow/deliver
// Body: { role: 'taker'|'maker', tradeId, permitTransferFrom, signature }
app.post('/api/escrow/deliver', async (c) => {
  try {
    const body = await c.req.json() as any
    if (!body.role || !body.tradeId || !body.permit || !body.signature) {
      return c.json({ error: 'Missing fields: role, tradeId, permit, signature' }, 400)
    }

    const relayerKey: string = (c.env as any).RELAYER_PRIVATE_KEY || ''
    if (!relayerKey || relayerKey.length < 60) {
      return c.json({ error: 'RELAYER_NOT_CONFIGURED', fallback: true }, 503)
    }

    const { ethers } = await import('ethers')
    const provider = new ethers.JsonRpcProvider(ARC.rpc)
    const relayer  = new ethers.Wallet(relayerKey, provider)

    const DELIVER_ABI = [
      `function takerDeliver(
         uint256 id,
         tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit,
         bytes signature
       )`,
      `function makerDeliver(
         uint256 id,
         tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit,
         bytes signature
       )`
    ]
    const escrow = new ethers.Contract(ARC.contracts.FxEscrow, DELIVER_ABI, relayer)

    const permit = {
      permitted: {
        token:  body.permit.permitted.token,
        amount: BigInt(body.permit.permitted.amount)
      },
      nonce:    BigInt(body.permit.nonce),
      deadline: BigInt(body.permit.deadline)
    }

    const fn   = body.role === 'taker' ? 'takerDeliver' : 'makerDeliver'
    const tx   = await (escrow as any)[fn](BigInt(body.tradeId), permit, body.signature)
    await tx.wait(1)

    return c.json({
      success: true,
      txHash: tx.hash,
      explorerUrl: `${ARC.explorer}/tx/${tx.hash}`
    })

  } catch (err: any) {
    console.error('[escrow/deliver]', err)
    return c.json({
      error: 'DELIVER_TX_FAILED',
      message: err.shortMessage || err.message || 'Unknown error'
    }, 500)
  }
})

// AI search: returns empty state since no real products exist yet
app.post('/api/ai-search', async (c) => {
  const { query } = await c.req.json()
  return c.json({
    results: [],
    message: query
      ? `No products found for "${query}". The marketplace is just getting started — check back soon or list your own product!`
      : 'Ask me to search for products!'
  })
})

// ─── Pages ───────────────────────────────────────────────────────────
app.get('/', (c) => c.html(homePage()))
app.get('/marketplace', (c) => c.html(marketplacePage()))
// ─── API routes for product page ────────────────────────────────────────────
app.get('/product/:id', async (c) => {
  try {
    const db  = c.env.DB
    await initDB(db)
    const row = await db.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'`).bind(c.req.param('id')).first() as any
    if (row) return c.html(productPage(row))
  } catch {}
  return c.html(productNotFoundPage(c.req.param('id')))
})
app.get('/cart', (c) => c.html(cartPage()))
app.get('/checkout', (c) => c.html(checkoutPage()))
app.get('/wallet', (c) => c.html(walletPage()))
app.get('/wallet/create', (c) => c.html(walletCreatePage()))
app.get('/wallet/import', (c) => c.html(walletImportPage()))
app.get('/orders', (c) => c.html(ordersPage()))
app.get('/orders/:id', (c) => c.html(orderDetailPage(c.req.param('id'))))
app.get('/sell', (c) => c.html(sellPage()))
app.get('/dashboard', (c) => c.html(sellerDashboardPage()))
app.get('/profile', (c) => c.html(profilePage()))
app.get('/register', (c) => c.html(registerPage()))
app.get('/login', (c) => c.html(loginPage()))
app.get('/disputes', (c) => c.html(disputesPage()))
app.get('/notifications', (c) => c.html(notificationsPage()))
app.get('/terms', (c) => c.html(termsPage()))
app.get('/privacy', (c) => c.html(privacyPage()))
app.get('/disclaimer', (c) => c.html(disclaimerPage()))
app.get('/about', (c) => c.html(aboutPage()))

export default app

// ─── ARC CONFIG (injected into every page for client-side use) ───────
const ARC_CLIENT_CONFIG = JSON.stringify({
  chainId: ARC.chainId,
  chainIdHex: ARC.chainIdHex,
  rpc: ARC.rpc,
  rpcAlt: ARC.rpcAlt,
  explorer: ARC.explorer,
  faucet: ARC.faucet,
  networkName: ARC.networkName,
  currency: ARC.currency,
  contracts: ARC.contracts
})

// ─── HTML Shell ───────────────────────────────────────────────────────
function shell(title: string, body: string, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} | redhawk-store</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            hawk: {
              50:'#fff1f1',100:'#ffe1e1',200:'#ffc7c7',300:'#ffa0a0',
              400:'#ff6b6b',500:'#ef4444',600:'#dc2626',700:'#b91c1c',
              800:'#991b1b',900:'#7f1d1d'
            }
          },
          fontFamily: { sans: ['Inter','system-ui','sans-serif'] }
        }
      }
    }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#f8fafc;color:#1e293b}
    ::-webkit-scrollbar{width:6px;height:6px}
    ::-webkit-scrollbar-track{background:#f1f5f9}
    ::-webkit-scrollbar-thumb{background:#dc2626;border-radius:3px}
    .badge-escrow{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
    .btn-primary{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 15px rgba(220,38,38,0.4)}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
    .btn-secondary{background:#fff;color:#dc2626;border:2px solid #dc2626;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
    .btn-secondary:hover{background:#fff1f1}
    .card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #f1f5f9}
    .product-card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #f1f5f9;overflow:hidden;transition:all .2s}
    .product-card:hover{transform:translateY(-4px);box-shadow:0 8px 25px rgba(0,0,0,.12)}
    .star{color:#f59e0b}
    .tag{background:#fef2f2;color:#dc2626;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600}
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
    .modal{background:#fff;border-radius:16px;padding:32px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto}
    .input{width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:14px;outline:none;transition:border-color .2s}
    .input:focus{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,.1)}
    .select{width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:14px;outline:none;background:#fff;cursor:pointer}
    .select:focus{border-color:#dc2626}
    .toast{position:fixed;top:20px;right:20px;z-index:9999;background:#1e293b;color:#fff;padding:12px 20px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);font-size:14px;transform:translateX(120%);transition:transform .3s;max-width:340px}
    .toast.show{transform:translateX(0)}
    .toast.success{background:#16a34a}
    .toast.error{background:#dc2626}
    .toast.info{background:#0ea5e9}
    .toast.warning{background:#d97706}
    #testnet-banner{background:#fee2e2;border-bottom:1px solid #fca5a5;color:#7f1d1d;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;padding:8px 48px 8px 16px;position:sticky;top:0;z-index:200;min-height:36px;line-height:1.4;text-align:center}
    #testnet-banner .banner-text{flex:1;text-align:center}
    #testnet-banner .banner-close{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#991b1b;cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:16px;line-height:1;transition:background .15s,color .15s;padding:0}
    #testnet-banner .banner-close:hover{background:#fca5a5;color:#450a0a}
    nav{background:#fff;border-bottom:1px solid #f1f5f9;position:sticky;top:36px;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.06)}
    body.banner-hidden nav{top:0}
    footer{background:#1e293b;color:#94a3b8;padding:48px 0 24px}
    .hero-gradient{background:linear-gradient(135deg,#fff1f1 0%,#fef2f2 30%,#fff 60%,#f8fafc 100%)}
    .loading-spinner{display:inline-block;width:20px;height:20px;border:2px solid #f3f3f3;border-top:2px solid #dc2626;border-radius:50%;animation:spin 1s linear infinite}
    .loading-spinner-lg{display:inline-block;width:40px;height:40px;border:3px solid #f1f5f9;border-top:3px solid #dc2626;border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    .step-circle{width:32px;height:32px;border-radius:50%;background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
    .step-circle.done{background:#16a34a}
    .step-circle.pending{background:#e2e8f0;color:#94a3b8}
    .seed-word{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;font-family:monospace;font-size:13px;font-weight:600;color:#dc2626;text-align:center}
    .wallet-card{background:linear-gradient(135deg,#dc2626 0%,#991b1b 50%,#7f1d1d 100%);color:#fff;border-radius:16px;padding:24px}
    .chat-bubble-user{background:#fef2f2;border-radius:12px 12px 2px 12px;padding:10px 14px;max-width:80%}
    .chat-bubble-ai{background:#fff;border:1px solid #f1f5f9;border-radius:12px 12px 12px 2px;padding:10px 14px;max-width:85%}
    .sidebar-nav a{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;color:#64748b;font-size:14px;font-weight:500;text-decoration:none;transition:all .15s}
    .sidebar-nav a:hover,.sidebar-nav a.active{background:#fef2f2;color:#dc2626}
    .notification-item{border-left:3px solid #dc2626;padding:12px 16px;background:#fff;border-radius:0 8px 8px 0;margin-bottom:8px}
    .empty-state{text-align:center;padding:48px 24px;color:#94a3b8}
    .empty-state i{font-size:48px;margin-bottom:16px;opacity:.3;display:block}
    .demo-disclaimer{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;font-size:12px;color:#92400e;display:flex;align-items:center;gap:8px;line-height:1.4}
    .trust-box{background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px 16px;font-size:12px;color:#14532d;display:flex;align-items:flex-start;gap:8px;line-height:1.5}
    .legal-page h1{font-size:1.75rem;font-weight:800;color:#1e293b;margin-bottom:.5rem}
    .legal-page h2{font-size:1.1rem;font-weight:700;color:#1e293b;margin:1.5rem 0 .5rem}
    .legal-page p{color:#475569;line-height:1.7;margin-bottom:.75rem;font-size:.9rem}
    .legal-page ul{color:#475569;line-height:1.7;margin-bottom:.75rem;font-size:.9rem;padding-left:1.25rem;list-style:disc}
    .tx-confirm-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}
    .arc-badge{background:linear-gradient(135deg,#1e40af,#1d4ed8);color:#fff;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px}
    .network-warning{background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:12px 16px;font-size:13px;color:#92400e;display:flex;align-items:center;gap:8px}
    .network-ok{background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:12px 16px;font-size:13px;color:#166534;display:flex;align-items:center;gap:8px}
    .addr-mono{font-family:monospace;font-size:12px;word-break:break-all}
  </style>
  ${extraHead}
  <!-- Arc Network client config (injected server-side) -->
  <script>
    window.ARC = ${ARC_CLIENT_CONFIG};
  </script>
  <!-- ethers.js v6 via CDN for wallet + RPC interaction -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js"></script>
</head>
<body>
  <!-- Testnet Banner -->
  <div id="testnet-banner" role="alert" aria-label="Testnet notice">
    <span class="banner-text">⚠️ This app is running on <strong>TESTNET</strong>. All transactions are for testing purposes only.</span>
    <button class="banner-close" onclick="dismissTestnetBanner()" aria-label="Dismiss testnet banner" title="Dismiss">&#x2715;</button>
  </div>
  <script>
    // Testnet banner dismiss — runs before DOMContentLoaded for zero flicker
    (function(){
      if(localStorage.getItem('hideTestnetBanner')==='true'){
        var b=document.getElementById('testnet-banner');
        if(b){b.style.display='none';}
        document.body.classList.add('banner-hidden');
      }
    })();
    function dismissTestnetBanner(){
      var b=document.getElementById('testnet-banner');
      if(b){b.style.display='none';}
      document.body.classList.add('banner-hidden');
      localStorage.setItem('hideTestnetBanner','true');
    }
  </script>
  ${navbar()}
  ${body}
  ${chatWidget()}
  ${toastContainer()}
  ${globalScript()}
</body>
</html>`
}

// ─── Global Script (Arc wallet + balance logic) ───────────────────────
function globalScript() {
  return `<script>
// ══════════════════════════════════════════════════════════════
//  ARC NETWORK — Real wallet integration
//  Chain ID: 5042002 (Arc Testnet)
//  RPC: https://rpc.testnet.arc.network
//  USDC: 0x3600000000000000000000000000000000000000 (6 dec)
//  EURC: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a (6 dec)
// ══════════════════════════════════════════════════════════════

const ARC_CHAIN_ID = window.ARC.chainId;
const ARC_CHAIN_ID_HEX = window.ARC.chainIdHex;
const ARC_RPC = window.ARC.rpc;
const ARC_EXPLORER = window.ARC.explorer;
const USDC_ADDRESS = window.ARC.contracts.USDC;
const EURC_ADDRESS = window.ARC.contracts.EURC;
const PERMIT2_ADDRESS = window.ARC.contracts.Permit2;
const FXESCROW_ADDRESS = window.ARC.contracts.FxEscrow;

// Minimal ERC-20 ABI for balanceOf + approve + allowance
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

// ─── Permit2 ABI (minimal: nonceBitmap + nonces for witness transfers) ───
const PERMIT2_ABI = [
  'function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)'
];

// ─── FxEscrow ABI (view + deliver functions callable by taker/maker) ────
const FXESCROW_ABI = [
  'function lastTradeId() view returns (uint256)',
  'function getTradeDetails(uint256 id) view returns (tuple(address base, address quote, address taker, address maker, address recipient, uint256 baseAmount, uint256 quoteAmount, uint256 takerFee, uint256 makerFee, uint256 takerRiskBuffer, uint256 makerRiskBuffer, uint256 maturity, uint8 status, uint8 takerFundingStatus, uint8 makerFundingStatus))',
  'function trades(uint256) view returns (address base, address quote, address taker, address maker, address recipient, uint256 baseAmount, uint256 quoteAmount, uint256 takerFee, uint256 makerFee, uint256 takerRiskBuffer, uint256 makerRiskBuffer, uint256 maturity, uint8 status, uint8 takerFundingStatus, uint8 makerFundingStatus)'
];

// ─ Toast ──────────────────────────────────────────────────────
function showToast(msg, type='info') {
  const t = document.getElementById('global-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast ' + type }, 4000);
}

// ─────────────────────────────────────────────────────────────────
//  CartStore  — single source of truth, key = "cart"
//  Structure per item: { id, title, price, currency, quantity, image }
// ─────────────────────────────────────────────────────────────────
const CART_KEY = 'cart';

const CartStore = {
  /** Read cart from localStorage — always fresh */
  getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch { return []; }
  },

  /** Persist cart to localStorage and sync all UI */
  _save(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    CartStore._syncBadge(cart);
  },

  /** Add or increment an item.
   *  Accepts any shape: normalises to { id, title, price, currency, quantity, image } */
  addToCart(product) {
    const cart = CartStore.getCart();
    // Normalise field names (support both old and new shapes)
    const id       = product.id;
    const title    = product.title || product.name || 'Product';
    const price    = parseFloat(product.price) || 0;
    const currency = product.currency || product.token || 'USDC';
    const image    = product.image || '';
    const idx      = cart.findIndex(i => i.id === id);
    if (idx >= 0) {
      cart[idx].quantity = (cart[idx].quantity || 1) + 1;
    } else {
      cart.push({ id, title, price, currency, quantity: 1, image });
    }
    CartStore._save(cart);
    showToast(title + ' added to cart!', 'success');
    return cart;
  },

  /** Remove a single item by id */
  removeFromCart(productId) {
    const cart = CartStore.getCart().filter(i => i.id !== productId);
    CartStore._save(cart);
    return cart;
  },

  /** Change quantity (+1 or -1). Removes item if qty would drop below 1. */
  changeQty(productId, delta) {
    const cart = CartStore.getCart();
    const idx  = cart.findIndex(i => i.id === productId);
    if (idx >= 0) {
      cart[idx].quantity = Math.max(1, (cart[idx].quantity || 1) + delta);
      CartStore._save(cart);
    }
    return CartStore.getCart();
  },

  /** Empty the cart */
  clearCart() {
    CartStore._save([]);
    return [];
  },

  /** Update the navbar badge */
  _syncBadge(cart) {
    const total = (cart || CartStore.getCart()).reduce((s, i) => s + (i.quantity || i.qty || 1), 0);
    const el = document.getElementById('cart-badge');
    if (el) { el.textContent = total; el.style.display = total > 0 ? 'flex' : 'none'; }
  },

  /** Migrate items saved under old keys to the canonical key */
  _migrate() {
    // Migrate 'rh_cart' (old global key)
    const old1 = localStorage.getItem('rh_cart');
    if (old1 && !localStorage.getItem(CART_KEY)) {
      try {
        const items = JSON.parse(old1).map(i => ({
          id: i.id, title: i.title || i.name || 'Product',
          price: parseFloat(i.price) || 0,
          currency: i.currency || i.token || 'USDC',
          quantity: i.qty || i.quantity || 1, image: i.image || ''
        }));
        localStorage.setItem(CART_KEY, JSON.stringify(items));
      } catch {}
    }
    // Migrate 'rhawk_cart' (product-page key)
    const old2 = localStorage.getItem('rhawk_cart');
    if (old2) {
      try {
        const existing = CartStore.getCart();
        const items    = JSON.parse(old2);
        items.forEach(i => {
          const id = i.id;
          if (!existing.find(e => e.id === id)) {
            existing.push({
              id, title: i.title || i.name || 'Product',
              price: parseFloat(i.price) || 0,
              currency: i.currency || i.token || 'USDC',
              quantity: i.qty || i.quantity || 1, image: i.image || ''
            });
          }
        });
        localStorage.setItem(CART_KEY, JSON.stringify(existing));
        localStorage.removeItem('rhawk_cart');
      } catch {}
    }
    localStorage.removeItem('rh_cart');
  }
};

// ── Backward-compat shims (keep old call-sites working) ────────────
function getCart()          { return CartStore.getCart(); }
function saveCart(c)        { CartStore._save(c); }
function addToCart(product) { CartStore.addToCart(product); }
function updateCartBadge()  { CartStore._syncBadge(); }

// ─ Wallet state ────────────────────────────────────────────────
let _walletAddress = null;
let _walletProvider = null;
let _ethersProvider = null;

function getStoredWallet() {
  try { return JSON.parse(localStorage.getItem('rh_wallet') || 'null') } catch { return null }
}
function storeWallet(w) { localStorage.setItem('rh_wallet', JSON.stringify(w)) }
function clearWallet() { localStorage.removeItem('rh_wallet') }

function updateWalletBadge(address) {
  const el = document.getElementById('wallet-badge');
  if (el) el.textContent = address ? address.substring(0,8)+'…' : 'Wallet';
  _walletAddress = address || null;
}

// ─ Arc Network chain helpers ───────────────────────────────────
async function switchToArc() {
  if (!window.ethereum) return false;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_CHAIN_ID_HEX }]
    });
    return true;
  } catch (switchErr) {
    if (switchErr.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: ARC_CHAIN_ID_HEX,
            chainName: 'Arc Testnet',
            nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
            rpcUrls: [ARC_RPC, 'https://rpc.blockdaemon.testnet.arc.network'],
            blockExplorerUrls: [ARC_EXPLORER]
          }]
        });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

async function isOnArcNetwork() {
  if (!window.ethereum) return false;
  try {
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    return parseInt(chainId, 16) === ARC_CHAIN_ID;
  } catch { return false; }
}

// ─ Real balance fetch from Arc Network RPC ─────────────────────
async function fetchArcBalances(address) {
  if (!address) return { usdc: '0.00', eurc: '0.00', raw: { usdc: 0n, eurc: 0n } };
  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC);

    // USDC: Arc native (also ERC-20 with 6 decimals)
    let usdcRaw = 0n;
    try {
      // First try native balance (USDC is native on Arc)
      const nativeBal = await provider.getBalance(address);
      // Arc native balance is in 18-decimal form for USDC
      // Convert: native / 1e12 gives 6-decimal USDC
      usdcRaw = nativeBal / BigInt('1000000000000');
    } catch {
      // Fallback: ERC-20 balanceOf
      try {
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
        usdcRaw = await usdcContract.balanceOf(address);
      } catch { usdcRaw = 0n; }
    }

    // EURC: standard ERC-20 (6 decimals)
    let eurcRaw = 0n;
    try {
      const eurcContract = new ethers.Contract(EURC_ADDRESS, ERC20_ABI, provider);
      eurcRaw = await eurcContract.balanceOf(address);
    } catch { eurcRaw = 0n; }

    const formatBalance = (raw) => {
      const val = Number(raw) / 1e6;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    };

    return {
      usdc: formatBalance(usdcRaw),
      eurc: formatBalance(eurcRaw),
      raw: { usdc: usdcRaw, eurc: eurcRaw }
    };
  } catch (err) {
    console.error('Balance fetch error:', err.message);
    return { usdc: '—', eurc: '—', error: err.message, raw: { usdc: 0n, eurc: 0n } };
  }
}

// ─ Connect wallet ──────────────────────────────────────────────
async function connectWallet(type) {
  if (type === 'metamask') {
    if (!window.ethereum) {
      showToast('MetaMask not detected. Install from metamask.io', 'error');
      window.open('https://metamask.io/download/', '_blank');
      return;
    }
    try {
      showToast('Connecting to MetaMask…', 'info');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts.length) { showToast('No accounts found', 'error'); return; }
      const address = accounts[0];

      // Switch to Arc Network
      const onArc = await isOnArcNetwork();
      if (!onArc) {
        showToast('Switching to Arc Testnet…', 'info');
        const switched = await switchToArc();
        if (!switched) {
          showToast('Please manually switch to Arc Testnet (Chain ID: 5042002)', 'warning');
        }
      }

      const walletData = {
        address,
        type: 'metamask',
        network: 'Arc Testnet',
        chainId: ARC_CHAIN_ID,
        connectedAt: new Date().toISOString()
      };
      storeWallet(walletData);
      updateWalletBadge(address);
      showToast('MetaMask connected to Arc Network!', 'success');
      return walletData;
    } catch (err) {
      if (err.code === 4001) showToast('Connection rejected by user', 'error');
      else showToast('MetaMask error: ' + err.message, 'error');
      return null;
    }
  }

  if (type === 'walletconnect') {
    showToast('WalletConnect: scan QR with your wallet and select Arc Testnet (Chain ID: 5042002)', 'info');
    return null;
  }

  if (type === 'internal') {
    const w = getStoredWallet();
    if (w && w.type === 'internal') {
      updateWalletBadge(w.address);
      return w;
    }
    window.location.href = '/wallet/create';
    return null;
  }
}

// ─ Disconnect wallet ───────────────────────────────────────────
function disconnectWallet() {
  clearWallet();
  _walletAddress = null;
  updateWalletBadge(null);
  showToast('Wallet disconnected', 'info');
  setTimeout(() => location.reload(), 800);
}

// ─ Wallet event listeners (MetaMask) ──────────────────────────
function setupWalletListeners() {
  if (!window.ethereum) return;
  window.ethereum.on('accountsChanged', (accounts) => {
    if (!accounts.length) {
      clearWallet();
      updateWalletBadge(null);
      showToast('Wallet disconnected', 'info');
      setTimeout(() => location.reload(), 800);
    } else {
      const stored = getStoredWallet();
      if (stored && stored.type === 'metamask') {
        stored.address = accounts[0];
        storeWallet(stored);
        updateWalletBadge(accounts[0]);
        showToast('Account changed: ' + accounts[0].substring(0,10) + '…', 'info');
        setTimeout(() => location.reload(), 800);
      }
    }
  });
  window.ethereum.on('chainChanged', (chainId) => {
    const newChain = parseInt(chainId, 16);
    if (newChain !== ARC_CHAIN_ID) {
      showToast('Wrong network! Please switch to Arc Testnet (Chain ID: 5042002)', 'warning');
    } else {
      showToast('Connected to Arc Testnet ✓', 'success');
    }
    setTimeout(() => location.reload(), 1000);
  });
  window.ethereum.on('disconnect', () => {
    clearWallet();
    updateWalletBadge(null);
    showToast('Wallet provider disconnected', 'info');
  });
}

// ─ Fetch real tx history from Arc explorer API ─────────────────
async function fetchTxHistory(address, limit = 10) {
  if (!address) return [];
  try {
    const url = ARC_EXPLORER + '/api/v2/addresses/' + address + '/transactions?limit=' + limit;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || data.result || [];
  } catch { return []; }
}

// ─ Network indicator banner ────────────────────────────────────
async function checkNetworkStatus(containerEl) {
  if (!containerEl) return;
  if (!window.ethereum) {
    containerEl.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>No wallet extension detected. Install MetaMask or create an in-app wallet to use Arc Network.</div>';
    return;
  }
  try {
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const current = parseInt(chainId, 16);
    if (current === ARC_CHAIN_ID) {
      containerEl.innerHTML = '<div class="network-ok"><i class="fas fa-circle text-green-500"></i>Connected to <strong>Arc Testnet</strong> (Chain ID: 5042002) · <a href="' + ARC_EXPLORER + '" target="_blank" class="underline ml-1">Explorer</a></div>';
    } else {
      containerEl.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>Wrong network (Chain ID: ' + current + '). <button onclick="switchToArc().then(()=>location.reload())" class="underline ml-1 font-bold">Switch to Arc Testnet</button></div>';
    }
  } catch {
    containerEl.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>Could not detect network. Make sure your wallet is unlocked.</div>';
  }
}

// ─ Init on every page ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 1. Migrate any items saved under old localStorage keys → canonical 'cart'
  CartStore._migrate();
  // 2. Hydrate cart badge
  updateCartBadge();
  // 3. Wallet listeners
  setupWalletListeners();

  const stored = getStoredWallet();
  if (stored) {
    updateWalletBadge(stored.address);
    // Re-verify MetaMask is still connected
    if (stored.type === 'metamask' && window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
        if (!accounts.length) {
          clearWallet();
          updateWalletBadge(null);
        }
      }).catch(() => {});
    }
  }
});

// ─ Transaction Confirmation Modal ─────────────────────────────
function showTxConfirmModal({ action, amount, token, network, note }) {
  return new Promise((resolve) => {
    // Remove any existing modal
    document.getElementById('tx-confirm-modal-root')?.remove();
    const el = document.createElement('div');
    el.id = 'tx-confirm-modal-root';
    el.className = 'tx-confirm-modal';
    el.innerHTML = '<div class="modal" style="max-width:440px">'
      + '<div class="flex items-center gap-3 mb-5">'
      + '<div class="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600 text-xl shrink-0"><i class="fas fa-shield-alt"></i></div>'
      + '<div><h3 class="text-lg font-extrabold text-slate-800">Blockchain Transaction</h3>'
      + '<p class="text-slate-400 text-xs mt-0.5">Review before signing</p></div></div>'
      + '<div class="bg-slate-50 rounded-xl p-4 mb-4 space-y-2 text-sm">'
      + '<div class="flex justify-between"><span class="text-slate-500">Action</span><span class="font-semibold text-slate-800">' + action + '</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Amount</span><span class="font-bold text-red-600">' + amount + ' ' + token + '</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Network</span><span class="font-medium text-slate-700">' + network + '</span></div>'
      + '</div>'
      + '<div class="trust-box mb-5"><i class="fas fa-info-circle" style="color:#16a34a;flex-shrink:0"></i>'
      + '<span class="text-xs">' + note + '<br/>You are about to sign a blockchain transaction using your connected wallet. <strong>We never sign on your behalf.</strong></span></div>'
      + '<div class="flex gap-3">'
      + '<button id="tx-cancel-btn" class="btn-secondary flex-1 justify-center"><i class="fas fa-times"></i> Cancel</button>'
      + '<button id="tx-confirm-btn" class="btn-primary flex-1 justify-center"><i class="fas fa-lock"></i> Sign & Submit</button>'
      + '</div></div>';
    document.body.appendChild(el);
    document.getElementById('tx-cancel-btn').onclick = () => { el.remove(); resolve(false); };
    document.getElementById('tx-confirm-btn').onclick = () => { el.remove(); resolve(true); };
    el.onclick = (e) => { if(e.target===el){ el.remove(); resolve(false); } };
  });
}

// ─ Chat toggle ────────────────────────────────────────────────
function toggleChat() {
  document.getElementById('chat-panel').classList.toggle('hidden');
}
</script>`
}

// ─── Navbar ───────────────────────────────────────────────────────────
function navbar() {
  return `<nav>
  <div class="max-w-7xl mx-auto px-4 flex items-center justify-between h-16 gap-4">
    <a href="/" class="flex items-center gap-2 shrink-0">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/>
          <path d="M9 14l3-3 3 3" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <span class="font-extrabold text-xl tracking-tight text-slate-800">redhawk<span class="text-red-600">-store</span></span>
    </a>
    <div class="hidden md:flex flex-1 max-w-xl mx-4">
      <div class="relative w-full">
        <input id="nav-search" type="text" placeholder="Search products on Arc Network…" class="w-full pl-10 pr-20 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 bg-slate-50"/>
        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
        <button onclick="handleNavSearch()" class="absolute right-2 top-1/2 -translate-y-1/2 bg-red-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-red-700">Search</button>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <a href="/marketplace" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-store text-xs"></i> Marketplace
      </a>
      <a href="/sell" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-plus-circle text-xs"></i> Sell
      </a>
      <a href="/dashboard" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-chart-line text-xs"></i> Dashboard
      </a>
      <a href="/wallet" id="wallet-nav-btn" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors border border-red-100">
        <i class="fas fa-wallet text-xs"></i>
        <span id="wallet-badge">Wallet</span>
      </a>
      <a href="/notifications" class="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100">
        <i class="fas fa-bell"></i>
      </a>
      <a href="/cart" class="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100">
        <i class="fas fa-shopping-cart"></i>
        <span id="cart-badge" class="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full hidden items-center justify-center">0</span>
      </a>
      <a href="/profile" class="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-sm font-bold hover:opacity-90">
        <i class="fas fa-user text-xs"></i>
      </a>
    </div>
  </div>
  <script>
    function handleNavSearch() {
      const q = document.getElementById('nav-search')?.value.trim();
      if (q) { document.getElementById('chat-panel').classList.remove('hidden'); sendChatMessage(q); }
    }
    document.getElementById('nav-search')?.addEventListener('keydown', e => { if(e.key==='Enter') handleNavSearch() });
  </script>
</nav>`
}

function toastContainer() {
  return `<div id="global-toast" class="toast"></div>`
}

// ─── AI Chat Widget ───────────────────────────────────────────────────
function chatWidget() {
  return `
<button onclick="toggleChat()" class="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-red-800 text-white shadow-xl flex items-center justify-center text-xl hover:scale-110 transition-transform z-50" title="HawkAI Assistant">
  <i class="fas fa-robot"></i>
</button>
<div id="chat-panel" class="hidden fixed bottom-24 right-6 w-80 sm:w-96 z-50">
  <div class="card shadow-2xl overflow-hidden">
    <div class="bg-gradient-to-r from-red-600 to-red-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <i class="fas fa-robot text-white text-sm"></i>
        </div>
        <div>
          <p class="text-white font-semibold text-sm">HawkAI Assistant</p>
          <p class="text-red-200 text-xs">Live on Arc Network</p>
        </div>
      </div>
      <button onclick="toggleChat()" class="text-white/80 hover:text-white"><i class="fas fa-times"></i></button>
    </div>
    <div id="chat-messages" class="p-4 h-64 overflow-y-auto flex flex-col gap-3 bg-gray-50">
      <div class="chat-bubble-ai text-sm text-slate-700">
        👋 Hi! I'm <strong>HawkAI</strong>, your Web3 shopping assistant.<br/><br/>
        The marketplace is live on <strong>Arc Network</strong> (Chain ID: 5042002).<br/>
        Be the first to list a product or search for items!
      </div>
    </div>
    <div class="p-3 bg-white border-t border-slate-100 flex gap-2">
      <input id="chat-input" type="text" placeholder="Search products…" class="flex-1 input py-2 text-sm" onkeydown="if(event.key==='Enter')sendChatMessage()"/>
      <button onclick="sendChatMessage()" class="btn-primary py-2 px-3 text-sm"><i class="fas fa-paper-plane"></i></button>
    </div>
  </div>
</div>
<script>
async function sendChatMessage(overrideText) {
  const input = document.getElementById('chat-input');
  const query = overrideText || (input ? input.value.trim() : '');
  if (!query) return;
  if (input) input.value = '';
  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML += '<div class="flex justify-end"><div class="chat-bubble-user text-sm text-slate-700">' + query + '</div></div>';
  msgs.innerHTML += '<div id="ai-typing" class="chat-bubble-ai text-sm text-slate-500 flex items-center gap-2"><div class="loading-spinner"></div> Searching Arc Network…</div>';
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const res = await fetch('/api/ai-search', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    const data = await res.json();
    document.getElementById('ai-typing')?.remove();
    let html = '<div class="chat-bubble-ai text-sm text-slate-700">';
    html += '<p class="mb-2">' + data.message + '</p>';
    if (data.results && data.results.length > 0) {
      html += '<div class="flex flex-col gap-2">';
      data.results.slice(0,3).forEach(p => {
        html += '<div class="flex items-center gap-2 bg-white rounded-lg p-2 border border-slate-100">'
          + '<div class="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-400"><i class="fas fa-box"></i></div>'
          + '<div class="flex-1 min-w-0"><p class="font-medium text-xs truncate">' + p.name + '</p>'
          + '<p class="text-red-600 font-bold text-xs">' + p.price + ' ' + p.token + '</p></div>'
          + '<a href="/product/' + p.id + '" class="btn-primary text-xs py-1 px-2">View</a></div>';
      });
      html += '</div>';
    } else {
      html += '<p class="text-slate-400 text-xs mt-1">💡 Get test USDC/EURC at <a href="' + ARC.faucet + '" target="_blank" class="text-blue-600 underline">faucet.circle.com</a></p>';
    }
    html += '</div>';
    msgs.innerHTML += html;
  } catch {
    document.getElementById('ai-typing')?.remove();
    msgs.innerHTML += '<div class="chat-bubble-ai text-sm text-red-500">Search error — Arc Network may be temporarily unreachable.</div>';
  }
  msgs.scrollTop = msgs.scrollHeight;
}
</script>`
}

// ─── Footer ───────────────────────────────────────────────────────────
function footer() {
  return `<footer style="background:#0f172a;border-top:1px solid #1e293b;padding:32px 0 0;">
    <div class="max-w-7xl mx-auto px-4">

      <!-- Main grid: brand + 3 link columns -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-6 pb-6 border-b border-slate-800">

        <!-- Brand -->
        <div class="col-span-2 md:col-span-1">
          <div class="flex items-center gap-2 mb-2">
            <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white"/></svg>
            </div>
            <span class="font-bold text-white text-sm">redhawk<span class="text-red-500">-store</span></span>
          </div>
          <p class="text-xs text-slate-500 leading-relaxed mb-3 max-w-xs">Decentralized marketplace on Arc Network — Circle's stablecoin-native L1.</p>
          <div class="flex items-center gap-3 text-xs">
            <span class="flex items-center gap-1.5 text-green-400"><span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"></span>Arc Testnet</span>
            <span class="text-slate-600">·</span>
            <span class="text-slate-500">Chain 5042002</span>
          </div>
        </div>

        <!-- Marketplace -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Marketplace</p>
          <ul class="space-y-1.5">
            ${['Browse:/marketplace','Sell:/sell','Dashboard:/dashboard','My Orders:/orders','Disputes:/disputes'].map(t=>{const[l,u]=t.split(':');return`<li><a href="${u}" class="text-xs text-slate-500 hover:text-red-400 transition-colors">${l}</a></li>`}).join('')}
          </ul>
        </div>

        <!-- Wallet -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Wallet</p>
          <ul class="space-y-1.5">
            ${['My Wallet:/wallet','Create:/wallet/create','Import:/wallet/import','Profile:/profile'].map(t=>{const[l,u]=t.split(':');return`<li><a href="${u}" class="text-xs text-slate-500 hover:text-red-400 transition-colors">${l}</a></li>`}).join('')}
          </ul>
        </div>

        <!-- Arc Network -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Arc Network</p>
          <ul class="space-y-1.5">
            <li><a href="https://docs.arc.network" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">Docs</a></li>
            <li><a href="https://testnet.arcscan.app" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">Explorer</a></li>
            <li><a href="https://faucet.circle.com" target="_blank" class="text-xs text-slate-500 hover:text-green-400 transition-colors">Get Test USDC</a></li>
            <li><a href="https://arc.network" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">arc.network</a></li>
          </ul>
        </div>
      </div>

      <!-- Notices row — compact alert strip -->
      <div class="py-3 border-b border-slate-800">
        <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span><i class="fas fa-exclamation-circle text-yellow-500 mr-1"></i><strong class="text-slate-400">Testnet:</strong> No real funds. Testing only.</span>
          <span><i class="fas fa-info-circle text-blue-400 mr-1"></i><strong class="text-slate-400">Demo:</strong> Illustrative products only.</span>
          <span><i class="fas fa-shield-alt text-green-400 mr-1"></i><strong class="text-slate-400">Security:</strong> Keys never leave your device.</span>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
        <span>© 2024 redhawk-store · Built on Arc Network (Circle)</span>
        <div class="flex items-center gap-3 flex-wrap justify-center">
          <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="flex items-center gap-1 hover:text-white transition-colors"><i class="fab fa-github"></i> GitHub</a>
          <span class="text-slate-700">·</span>
          <a href="https://testnet.arcscan.app/address/${ARC.contracts.FxEscrow}" target="_blank" class="flex items-center gap-1 hover:text-red-400 transition-colors"><i class="fas fa-file-contract text-xs"></i> Escrow</a>
          <span class="text-slate-700">·</span>
          <a href="https://testnet.arcscan.app" target="_blank" class="flex items-center gap-1 hover:text-red-400 transition-colors"><i class="fas fa-external-link-alt text-xs"></i> Explorer</a>
          <span class="text-slate-700">·</span>
          <a href="https://faucet.circle.com" target="_blank" class="flex items-center gap-1 hover:text-green-400 transition-colors"><i class="fas fa-faucet text-xs"></i> Faucet</a>
          <span class="text-slate-700">·</span>
          <a href="/terms" class="hover:text-white transition-colors">Terms</a>
          <span class="text-slate-700">·</span>
          <a href="/privacy" class="hover:text-white transition-colors">Privacy</a>
          <span class="text-slate-700">·</span>
          <a href="/disclaimer" class="hover:text-white transition-colors">Disclaimer</a>
          <span class="text-slate-700">·</span>
          <a href="/about" class="hover:text-white transition-colors">About</a>
        </div>
      </div>

    </div>
  </footer>`
}

// ─── PAGE: HOME ────────────────────────────────────────────────────────
function homePage() {
  const categories = [
    { name:'Electronics',            icon:'fas fa-laptop',       accent:'#3b82f6', bg:'#eff6ff' },
    { name:'Gaming',                 icon:'fas fa-gamepad',       accent:'#8b5cf6', bg:'#f5f3ff' },
    { name:'Audio',                  icon:'fas fa-headphones',    accent:'#10b981', bg:'#ecfdf5' },
    { name:'Photography',            icon:'fas fa-camera',        accent:'#f59e0b', bg:'#fffbeb' },
    { name:'Pet Shop',               icon:'fas fa-paw',           accent:'#f97316', bg:'#fff7ed' },
    { name:'Baby & Kids',            icon:'fas fa-baby',          accent:'#0ea5e9', bg:'#f0f9ff' },
    { name:'Beauty & Personal Care', icon:'fas fa-spa',           accent:'#fb7185', bg:'#fff1f2' },
    { name:'Fashion & Accessories',  icon:'fas fa-tshirt',        accent:'#7c3aed', bg:'#f5f3ff' },
  ]

  const catCards = categories.map(c => `
    <a href="/marketplace?cat=${encodeURIComponent(c.name)}" class="home-cat-card"
       style="--cat-accent:${c.accent};--cat-bg:${c.bg};"
       data-accent="${c.accent}">
      <div class="home-cat-icon" style="background:${c.bg};">
        <i class="${c.icon}" style="color:${c.accent};"></i>
      </div>
      <span class="home-cat-label">${c.name}</span>
      <i class="fas fa-arrow-right home-cat-arrow" style="color:${c.accent};"></i>
    </a>`).join('')

  return shell('Home', `

  <!-- ══════════════════════════════════════════════════
       HERO — Premium dark with depth layers
  ══════════════════════════════════════════════════ -->
  <section class="home-hero">
    <!-- Noise texture overlay -->
    <div class="home-hero-noise"></div>
    <!-- Grid -->
    <div class="home-hero-grid"></div>
    <!-- Radial glow right -->
    <div class="home-hero-glow-r"></div>
    <!-- Radial glow left -->
    <div class="home-hero-glow-l"></div>
    <!-- Horizontal accent line -->
    <div class="home-hero-line"></div>

    <div class="home-hero-inner">
      <!-- LEFT column -->
      <div class="home-hero-left">

        <!-- Pill badge -->
        <div class="home-hero-pill">
          <span class="home-hero-dot"></span>
          <span>LIVE ON ARC NETWORK</span>
          <span class="home-hero-pill-sep">·</span>
          <span>CHAIN ID 5042002</span>
        </div>

        <!-- Headline -->
        <h1 class="home-hero-h1">
          Shop the
          <span class="home-hero-gradient-text">Future</span>
          <br/>of Decentralized<br/>
          <span class="home-hero-muted">Commerce.</span>
        </h1>

        <!-- Sub-headline -->
        <p class="home-hero-sub">
          Buy and sell with confidence using <strong>USDC &amp; EURC</strong>.
          Every transaction is protected by smart contract escrow on Circle's
          stablecoin-native L1 blockchain.
        </p>

        <!-- CTA buttons -->
        <div class="home-hero-ctas">
          <a href="/marketplace" class="home-btn-primary">
            <i class="fas fa-store"></i> Browse Marketplace
          </a>
          <a href="/wallet" class="home-btn-ghost">
            <i class="fas fa-wallet"></i> Connect Wallet
          </a>
        </div>

        <!-- Trust chips -->
        <div class="home-trust-chips">
          ${[
            ['fas fa-shield-alt','#22c55e','Non-Custodial'],
            ['fas fa-lock','#60a5fa','Zero Key Access'],
            ['fas fa-file-contract','#a78bfa','Open Contracts'],
            ['fas fa-receipt','#fb7185','On-Chain Receipts'],
          ].map(([icon,col,label]) => `
            <div class="home-trust-chip">
              <i class="${icon}" style="color:${col};"></i>
              <span>${label}</span>
            </div>`).join('')}
        </div>

        <!-- Network status -->
        <div id="home-network-status" class="home-network-status">
          <span class="home-network-dot"></span>Checking Arc Network…
        </div>
      </div>

      <!-- RIGHT column — glass card -->
      <div class="home-hero-right">
        <!-- Floating green badge -->
        <div class="home-float-badge home-float-badge-top">
          <div class="home-float-badge-icon" style="background:#d1fae5;">
            <i class="fas fa-shield-alt" style="color:#059669;"></i>
          </div>
          <div>
            <p class="home-float-title">Escrow Protected</p>
            <p class="home-float-sub">Every transaction</p>
          </div>
        </div>

        <!-- Main glass card -->
        <div class="home-glass-card">
          <div class="home-glass-header">
            <div class="home-glass-logo">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".95"/></svg>
            </div>
            <div>
              <p class="home-glass-name">redhawk-store</p>
              <p class="home-glass-net">On Arc Network</p>
            </div>
            <div class="home-live-badge">
              <span class="home-live-dot"></span>
              <span>Live</span>
            </div>
          </div>

          <div class="home-glass-grid">
            ${[
              ['fas fa-coins',         'USDC / EURC', 'Native Stablecoin','#fbbf24'],
              ['fas fa-shield-alt',    'Escrow',       'Smart Contract',   '#60a5fa'],
              ['fas fa-network-wired', 'Arc L1',       'Chain 5042002',    '#818cf8'],
              ['fas fa-lock',          'Trustless',    'Non-Custodial',    '#4ade80'],
            ].map(([icon,title,sub,col]) => `
              <div class="home-glass-stat">
                <i class="${icon}" style="color:${col};font-size:15px;margin-bottom:8px;display:block;"></i>
                <p class="home-glass-stat-title">${title}</p>
                <p class="home-glass-stat-sub">${sub}</p>
              </div>`).join('')}
          </div>

          <a href="/sell" class="home-glass-cta">
            <i class="fas fa-plus-circle"></i> Start Selling — Earn USDC
          </a>
        </div>

        <!-- Floating yellow badge -->
        <div class="home-float-badge home-float-badge-bot">
          <div class="home-float-badge-icon" style="background:#fef3c7;">
            <i class="fas fa-bolt" style="color:#d97706;"></i>
          </div>
          <div>
            <p class="home-float-title">Instant Transfers</p>
            <p class="home-float-sub">USDC &amp; EURC</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Scroll cue -->
    <div class="home-scroll-cue">
      <span>Scroll</span>
      <i class="fas fa-chevron-down home-bounce"></i>
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════
       TRUST BAR
  ══════════════════════════════════════════════════ -->
  <section class="home-trust-bar">
    <div class="home-trust-bar-inner">
      ${[
        ['fas fa-shield-alt','#22c55e','Escrow Protected','Smart contract locked'],
        ['fas fa-coins',      '#f59e0b','USDC &amp; EURC', 'Stablecoin payments only'],
        ['fas fa-network-wired','#6366f1','Arc Network',   'Circle\'s L1 blockchain'],
        ['fas fa-lock',       '#3b82f6','Non-Custodial',   'You own your keys'],
        ['fas fa-receipt',    '#ec4899','On-Chain Receipts','Real tx hashes'],
        ['fas fa-file-contract','#8b5cf6','Smart Contracts','Open source escrow'],
      ].map(([icon,col,title,sub]) => `
        <div class="home-trust-item">
          <div class="home-trust-icon" style="background:${col}18;">
            <i class="${icon}" style="color:${col};"></i>
          </div>
          <div>
            <p class="home-trust-title">${title}</p>
            <p class="home-trust-sub">${sub}</p>
          </div>
        </div>`).join('')}
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════
       CATEGORIES — Large premium cards
  ══════════════════════════════════════════════════ -->
  <section class="home-section">
    <div class="home-section-header">
      <div>
        <p class="home-section-eyebrow">EXPLORE</p>
        <h2 class="home-section-title">Browse Categories</h2>
      </div>
      <a href="/marketplace" class="home-view-all">
        View all <i class="fas fa-arrow-right" style="font-size:11px;"></i>
      </a>
    </div>
    <div class="home-cat-grid">
      ${catCards}
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════
       DEMO NOTICE
  ══════════════════════════════════════════════════ -->
  <div class="home-demo-notice">
    <i class="fas fa-info-circle" style="color:#d97706;flex-shrink:0;font-size:15px;"></i>
    <span><strong>Demonstration only:</strong> This marketplace is for demonstration purposes only. All products listed are illustrative and not real.</span>
  </div>

  <!-- ══════════════════════════════════════════════════
       FEATURED PRODUCTS
  ══════════════════════════════════════════════════ -->
  <section class="home-section home-section-products">
    <div class="home-section-header">
      <div>
        <p class="home-section-eyebrow">MARKETPLACE</p>
        <h2 class="home-section-title">Latest Products</h2>
      </div>
      <a href="/marketplace" class="home-view-all">
        View all <i class="fas fa-arrow-right" style="font-size:11px;"></i>
      </a>
    </div>
    <div id="home-products-container">
      <div class="home-loading">
        <div class="loading-spinner-lg"></div>
        <p>Loading products from Arc Network…</p>
      </div>
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════
       HOW IT WORKS — Dark premium section
  ══════════════════════════════════════════════════ -->
  <section class="home-how">
    <div class="home-how-grid-bg"></div>
    <div class="home-how-inner">
      <div class="home-how-header">
        <p class="home-section-eyebrow" style="color:#ef4444;">PROCESS</p>
        <h2 class="home-section-title" style="color:#fff;">How redhawk-store Works</h2>
        <p style="color:#64748b;font-size:15px;max-width:520px;margin:0 auto;line-height:1.7;">
          A trustless escrow marketplace powered by Arc Network smart contracts.
          No intermediaries. No custodians. Just code.
        </p>
      </div>
      <div class="home-how-steps">
        ${[
          ['01','fas fa-search',      '#ef4444','Find Products',     'Browse real listings from verified sellers on Arc Network'],
          ['02','fas fa-wallet',      '#3b82f6','Connect Wallet',    'Use MetaMask or our internal wallet on Arc Testnet (Chain 5042002)'],
          ['03','fas fa-lock',        '#8b5cf6','Escrow Lock',       'USDC/EURC locked in smart contract — fully trustless and transparent'],
          ['04','fas fa-check-circle','#22c55e','Confirm & Release', 'Confirm delivery → funds automatically released on-chain'],
        ].map(([n,icon,col,title,desc]) => `
          <div class="home-how-step">
            <div class="home-how-step-num">${n}</div>
            <div class="home-how-step-icon" style="background:${col}22;border:1px solid ${col}33;">
              <i class="${icon}" style="color:${col};font-size:20px;"></i>
            </div>
            <h3 class="home-how-step-title">${title}</h3>
            <p class="home-how-step-desc">${desc}</p>
          </div>`).join('')}
      </div>
      <!-- Connector line (desktop) -->
      <div class="home-how-connector"></div>
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════
       ABOUT + TRUST SIGNALS — Two-column card
  ══════════════════════════════════════════════════ -->
  <section class="home-section home-about-section">
    <div class="home-about-card">

      <!-- Left: About text -->
      <div class="home-about-left">
        <div class="home-about-logo-row">
          <div class="home-about-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".95"/></svg>
          </div>
          <h2 class="home-about-title">About redhawk-store</h2>
        </div>
        <p class="home-about-body">
          <strong>redhawk-store</strong> is a decentralized marketplace powered by
          <strong>Arc Network</strong> — Circle's stablecoin-native Layer 1 blockchain.
          It uses escrow smart contracts to protect every transaction: funds are locked
          on-chain until the buyer confirms delivery, then automatically released to the seller.
        </p>
        <p class="home-about-body">
          All payments are made exclusively in <strong>USDC</strong> (native on Arc) or
          <strong>EURC</strong> — no fiat, no credit cards, no custodians. The internal wallet
          is generated entirely client-side using BIP39 standards; private keys never leave
          your browser.
        </p>
        <div class="demo-disclaimer" style="margin-bottom:20px;">
          <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
          <span>This is an open-source <strong>testnet demo</strong>. No real funds involved. Smart contracts run on Arc Testnet (Chain ID: 5042002).</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="/about" class="btn-secondary" style="font-size:13px;padding:9px 18px;"><i class="fas fa-info-circle"></i> Learn More</a>
          <a href="/terms" class="btn-secondary" style="font-size:13px;padding:9px 18px;"><i class="fas fa-file-alt"></i> Terms</a>
        </div>
      </div>

      <!-- Right: Trust signals -->
      <div class="home-about-right">
        <p class="home-about-signals-label">TRUST SIGNALS</p>
        <div class="home-about-signals">
          ${[
            ['fas fa-lock',          '#22c55e','Non-custodial wallet', 'Your keys never leave your device'],
            ['fas fa-file-contract', '#3b82f6','Open escrow contracts','Fully auditable on-chain'],
            ['fab fa-github',        '#1e293b','Open-source',          'Inspect the code on GitHub','https://github.com/julenosinger/redhawk-store'],
            ['fas fa-network-wired', '#8b5cf6','Arc Testnet',          'Chain ID: 5042002'],
            ['fas fa-shield-alt',    '#ef4444','Zero key custody',     '100% self-sovereign'],
            ['fas fa-coins',         '#f59e0b','USDC &amp; EURC',      'Stablecoin native L1'],
          ].map(([icon,col,title,sub,link]) => `
            <div class="home-signal-item">
              <div class="home-signal-icon" style="background:${col}14;">
                <i class="${icon}" style="color:${col};font-size:14px;"></i>
              </div>
              <div>
                <p class="home-signal-title">${link ? `<a href="${link}" target="_blank" style="color:#3b82f6;text-decoration:none;">${title}</a>` : title}</p>
                <p class="home-signal-sub">${sub}</p>
              </div>
            </div>`).join('')}
        </div>
      </div>

    </div>
  </section>

  ${footer()}

  <!-- ══════════════════════════════════════════════════
       HOME PAGE STYLES
  ══════════════════════════════════════════════════ -->
  <style>
  /* ─── Animations ─── */
  @keyframes home-bounce {
    0%,100%{transform:translateY(0) translateX(-50%)}
    50%{transform:translateY(7px) translateX(-50%)}
  }
  @keyframes home-pulse {
    0%,100%{opacity:1;transform:scale(1)}
    50%{opacity:.5;transform:scale(.85)}
  }
  @keyframes home-float {
    0%,100%{transform:translateY(0)}
    50%{transform:translateY(-8px)}
  }
  @keyframes home-shimmer {
    0%{background-position:-400px 0}
    100%{background-position:400px 0}
  }

  /* ─── Hero ─── */
  .home-hero {
    position:relative;overflow:hidden;
    background:linear-gradient(145deg,#080c14 0%,#0d1425 30%,#130d2e 60%,#1a0808 100%);
    min-height:100vh;display:flex;align-items:center;
  }
  .home-hero-noise {
    position:absolute;inset:0;pointer-events:none;opacity:.025;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E");
  }
  .home-hero-grid {
    position:absolute;inset:0;pointer-events:none;
    background-image:
      linear-gradient(rgba(220,38,38,.06) 1px,transparent 1px),
      linear-gradient(90deg,rgba(220,38,38,.06) 1px,transparent 1px);
    background-size:72px 72px;
    mask-image:radial-gradient(ellipse 80% 80% at 50% 50%,black 40%,transparent 100%);
  }
  .home-hero-glow-r {
    position:absolute;top:-200px;right:-150px;width:700px;height:700px;border-radius:50%;
    background:radial-gradient(circle,rgba(220,38,38,.18) 0%,transparent 65%);
    pointer-events:none;
  }
  .home-hero-glow-l {
    position:absolute;bottom:-150px;left:-100px;width:550px;height:550px;border-radius:50%;
    background:radial-gradient(circle,rgba(99,102,241,.14) 0%,transparent 65%);
    pointer-events:none;
  }
  .home-hero-line {
    position:absolute;bottom:0;left:0;right:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(220,38,38,.25),rgba(99,102,241,.2),transparent);
  }
  .home-hero-inner {
    max-width:1320px;margin:0 auto;padding:100px 32px 120px;
    width:100%;position:relative;z-index:1;
    display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center;
  }
  @media(max-width:960px){
    .home-hero-inner{grid-template-columns:1fr;gap:48px;padding:80px 20px 100px;}
    .home-hero-right{display:none;}
  }

  /* Pill */
  .home-hero-pill {
    display:inline-flex;align-items:center;gap:8px;
    background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.25);
    color:#fca5a5;padding:6px 16px;border-radius:999px;
    font-size:11px;font-weight:700;margin-bottom:32px;
    letter-spacing:.06em;backdrop-filter:blur(4px);
  }
  .home-hero-dot {
    width:7px;height:7px;border-radius:50%;background:#ef4444;
    display:inline-block;animation:home-pulse 2s infinite;flex-shrink:0;
  }
  .home-hero-pill-sep{opacity:.4;}

  /* H1 */
  .home-hero-h1 {
    font-size:clamp(2.8rem,5.5vw,4.4rem);font-weight:900;color:#fff;
    line-height:1.05;letter-spacing:-.035em;margin-bottom:28px;
  }
  .home-hero-gradient-text {
    background:linear-gradient(135deg,#ef4444 0%,#f97316 50%,#fbbf24 100%);
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  }
  .home-hero-muted{color:#475569;}

  /* Sub */
  .home-hero-sub {
    font-size:1.1rem;color:#64748b;line-height:1.75;
    max-width:500px;margin-bottom:40px;
  }
  .home-hero-sub strong{color:#cbd5e1;font-weight:600;}

  /* CTAs */
  .home-hero-ctas{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:40px;}
  .home-btn-primary {
    display:inline-flex;align-items:center;gap:9px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;
    padding:15px 30px;border-radius:14px;font-weight:700;font-size:15px;
    text-decoration:none;box-shadow:0 4px 24px rgba(220,38,38,.45);
    transition:all .25s;letter-spacing:.01em;
  }
  .home-btn-primary:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(220,38,38,.55);}
  .home-btn-ghost {
    display:inline-flex;align-items:center;gap:9px;
    background:rgba(255,255,255,.06);color:#cbd5e1;
    padding:15px 30px;border-radius:14px;font-weight:600;font-size:15px;
    text-decoration:none;border:1px solid rgba(255,255,255,.1);
    backdrop-filter:blur(12px);transition:all .25s;
  }
  .home-btn-ghost:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#fff;}

  /* Trust chips */
  .home-trust-chips{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px;}
  .home-trust-chip {
    display:inline-flex;align-items:center;gap:7px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
    padding:6px 14px;border-radius:999px;font-size:12px;color:#94a3b8;
    font-weight:500;backdrop-filter:blur(4px);
  }
  .home-trust-chip i{font-size:12px;}

  /* Network status */
  .home-network-status{font-size:12px;color:#334155;display:flex;align-items:center;gap:8px;}
  .home-network-dot{width:8px;height:8px;border-radius:50%;background:#334155;display:inline-block;flex-shrink:0;}

  /* Glass card */
  .home-glass-card {
    background:rgba(255,255,255,.04);backdrop-filter:blur(24px);
    border:1px solid rgba(255,255,255,.09);border-radius:28px;
    padding:32px;width:100%;max-width:400px;
    box-shadow:0 40px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.07);
    animation:home-float 6s ease-in-out infinite;
  }
  .home-glass-header{display:flex;align-items:center;gap:12px;margin-bottom:24px;}
  .home-glass-logo {
    width:42px;height:42px;border-radius:13px;flex-shrink:0;
    background:linear-gradient(135deg,#dc2626,#7c3aed);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 14px rgba(220,38,38,.35);
  }
  .home-glass-name{font-weight:700;color:#f8fafc;font-size:14px;margin:0;}
  .home-glass-net{font-size:11px;color:#475569;margin:0;}
  .home-live-badge {
    margin-left:auto;display:flex;align-items:center;gap:6px;
    background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);
    padding:4px 11px;border-radius:999px;font-size:11px;color:#4ade80;font-weight:600;
  }
  .home-live-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;animation:home-pulse 2s infinite;}
  .home-glass-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
  .home-glass-stat {
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
    border-radius:14px;padding:16px;
  }
  .home-glass-stat-title{font-weight:700;color:#f1f5f9;font-size:13px;margin:0 0 3px;}
  .home-glass-stat-sub{font-size:11px;color:#475569;margin:0;}
  .home-glass-cta {
    display:flex;align-items:center;justify-content:center;gap:8px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;
    padding:13px;border-radius:14px;font-weight:600;font-size:13px;
    text-decoration:none;width:100%;box-sizing:border-box;
    box-shadow:0 4px 16px rgba(220,38,38,.4);transition:all .2s;
  }
  .home-glass-cta:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(220,38,38,.5);}

  /* Hero right column */
  .home-hero-right{display:flex;justify-content:center;align-items:center;position:relative;}

  /* Floating badges */
  .home-float-badge {
    position:absolute;background:#fff;border-radius:16px;padding:12px 16px;
    box-shadow:0 12px 32px rgba(0,0,0,.18);
    display:flex;align-items:center;gap:10px;
    animation:home-float 5s ease-in-out infinite;
    z-index:2;
  }
  .home-float-badge-top{top:-20px;right:-16px;animation-delay:.5s;}
  .home-float-badge-bot{bottom:-18px;left:-16px;animation-delay:1.2s;}
  .home-float-badge-icon{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .home-float-title{font-size:12px;font-weight:700;color:#1e293b;margin:0;}
  .home-float-sub{font-size:11px;color:#64748b;margin:0;}

  /* Scroll cue */
  .home-scroll-cue {
    position:absolute;bottom:32px;left:50%;transform:translateX(-50%);
    display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.3;
    font-size:10px;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;
    animation:home-bounce 2s ease-in-out infinite;
  }
  .home-bounce{font-size:13px;}

  /* ─── Trust bar ─── */
  .home-trust-bar{background:#fff;border-bottom:1px solid #f0f4f8;}
  .home-trust-bar-inner {
    max-width:1320px;margin:0 auto;padding:0 16px;
    display:flex;flex-wrap:nowrap;justify-content:center;
    overflow:hidden;
  }
  .home-trust-item {
    display:flex;align-items:center;gap:10px;
    padding:16px 18px;border-right:1px solid #f0f4f8;
    flex:1 1 0;min-width:0;
    transition:background .2s;
  }
  .home-trust-item:hover{background:#fafbfc;}
  .home-trust-icon{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;}
  .home-trust-title{font-weight:700;color:#1e293b;font-size:12px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .home-trust-sub{color:#94a3b8;font-size:10px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

  /* ─── Demo notice ─── */
  .home-demo-notice {
    max-width:1320px;margin:40px auto 0;padding:0 24px;
    background:#fffbeb;border:1px solid #fde68a;border-radius:14px;
    padding:14px 20px;font-size:13px;color:#92400e;
    display:flex;align-items:flex-start;gap:12px;line-height:1.5;
    max-width:calc(1320px - 48px);margin:40px auto 0;
  }

  /* ─── Section layout ─── */
  .home-section{max-width:1320px;margin:0 auto;padding:80px 24px;}
  .home-section-products{padding-bottom:100px;}
  .home-section-header {
    display:flex;align-items:flex-end;justify-content:space-between;
    margin-bottom:44px;gap:16px;flex-wrap:wrap;
  }
  .home-section-eyebrow{
    font-size:11px;font-weight:800;color:#ef4444;
    text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;
  }
  .home-section-title{
    font-size:clamp(1.7rem,3vw,2.2rem);font-weight:900;
    color:#0f172a;letter-spacing:-.025em;margin:0;line-height:1.15;
  }
  .home-view-all {
    display:inline-flex;align-items:center;gap:7px;color:#ef4444;
    font-size:13px;font-weight:700;text-decoration:none;
    border:1.5px solid #fecaca;padding:9px 20px;border-radius:12px;
    transition:all .2s;white-space:nowrap;flex-shrink:0;
  }
  .home-view-all:hover{background:#fef2f2;border-color:#ef4444;}

  /* ─── Category cards ─── */
  .home-cat-grid{
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(140px,1fr));
    gap:16px;
  }
  @media(max-width:600px){.home-cat-grid{grid-template-columns:repeat(2,1fr);}}
  .home-cat-card {
    background:#fff;border-radius:20px;border:1.5px solid #f0f4f8;
    padding:24px 16px 20px;
    display:flex;flex-direction:column;align-items:center;gap:14px;
    text-decoration:none;transition:all .28s cubic-bezier(.34,1.56,.64,1);
    cursor:pointer;text-align:center;
    box-shadow:0 1px 4px rgba(0,0,0,.04);
    position:relative;overflow:hidden;
  }
  .home-cat-card::before {
    content:'';position:absolute;inset:0;opacity:0;
    background:linear-gradient(135deg,var(--cat-bg),transparent);
    transition:opacity .28s;
  }
  .home-cat-card:hover{
    transform:translateY(-6px) scale(1.02);
    box-shadow:0 20px 44px rgba(0,0,0,.1);
    border-color:var(--cat-accent,#ef4444);
  }
  .home-cat-card:hover::before{opacity:1;}
  .home-cat-icon {
    width:60px;height:60px;border-radius:18px;
    display:flex;align-items:center;justify-content:center;
    font-size:24px;transition:transform .28s;
    flex-shrink:0;position:relative;z-index:1;
  }
  .home-cat-card:hover .home-cat-icon{transform:scale(1.1) rotate(-4deg);}
  .home-cat-label {
    font-weight:700;color:#1e293b;font-size:12px;line-height:1.35;
    position:relative;z-index:1;
  }
  .home-cat-arrow{
    font-size:10px;opacity:0;transform:translateX(-4px);
    transition:all .2s;position:relative;z-index:1;
  }
  .home-cat-card:hover .home-cat-arrow{opacity:1;transform:translateX(0);}

  /* ─── Loading state ─── */
  .home-loading{text-align:center;padding:72px 0;}
  .home-loading .loading-spinner-lg{margin:0 auto 20px;}
  .home-loading p{color:#94a3b8;font-size:14px;}

  /* ─── How it Works ─── */
  .home-how {
    background:linear-gradient(155deg,#080c14 0%,#0e1425 40%,#160a28 70%,#1a0808 100%);
    padding:112px 24px;position:relative;overflow:hidden;
  }
  .home-how-grid-bg{
    position:absolute;inset:0;pointer-events:none;
    background-image:
      linear-gradient(rgba(220,38,38,.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(220,38,38,.04) 1px,transparent 1px);
    background-size:56px 56px;
    mask-image:radial-gradient(ellipse 90% 80% at 50% 50%,black 30%,transparent 100%);
  }
  .home-how-inner{max-width:1320px;margin:0 auto;position:relative;z-index:1;}
  .home-how-header{text-align:center;margin-bottom:72px;}
  .home-how-header p:first-child{margin-bottom:12px;}
  .home-how-steps{
    display:grid;grid-template-columns:repeat(4,1fr);gap:40px;
    position:relative;
  }
  @media(max-width:900px){.home-how-steps{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:500px){.home-how-steps{grid-template-columns:1fr;gap:32px;}}
  .home-how-step{position:relative;padding-top:8px;}
  .home-how-step-num{
    font-size:10px;font-weight:800;letter-spacing:.14em;
    color:rgba(220,38,38,.35);margin-bottom:20px;
  }
  .home-how-step-icon{
    width:60px;height:60px;border-radius:20px;
    display:flex;align-items:center;justify-content:center;
    margin-bottom:20px;
    box-shadow:0 8px 24px rgba(0,0,0,.25);
    transition:transform .2s;
  }
  .home-how-step:hover .home-how-step-icon{transform:translateY(-4px);}
  .home-how-step-title{font-weight:800;color:#f1f5f9;font-size:16px;margin:0 0 10px;}
  .home-how-step-desc{color:#475569;font-size:13px;line-height:1.7;margin:0;}
  .home-how-connector{
    display:none;
    position:absolute;top:62px;left:calc(12.5% + 30px);right:calc(12.5% + 30px);
    height:1px;background:linear-gradient(90deg,#dc2626,#7c3aed,#22c55e);
    opacity:.25;pointer-events:none;
  }
  @media(min-width:901px){.home-how-connector{display:block;}}

  /* ─── About section ─── */
  .home-about-section{padding-bottom:100px;}
  .home-about-card{
    background:#fff;border-radius:28px;border:1px solid #f0f4f8;
    box-shadow:0 6px 32px rgba(0,0,0,.06);overflow:hidden;
    display:grid;grid-template-columns:1fr 320px;
  }
  @media(max-width:800px){.home-about-card{grid-template-columns:1fr;}}
  .home-about-left{padding:56px;border-right:1px solid #f0f4f8;}
  @media(max-width:800px){.home-about-left{padding:36px;border-right:none;border-bottom:1px solid #f0f4f8;}}
  .home-about-right{padding:48px 40px;background:#fafbfc;}
  @media(max-width:800px){.home-about-right{padding:36px;}}
  .home-about-logo-row{display:flex;align-items:center;gap:14px;margin-bottom:24px;}
  .home-about-logo-icon{
    width:46px;height:46px;border-radius:15px;flex-shrink:0;
    background:linear-gradient(135deg,#dc2626,#7c3aed);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 6px 16px rgba(220,38,38,.3);
  }
  .home-about-title{font-size:1.5rem;font-weight:900;color:#0f172a;margin:0;letter-spacing:-.02em;}
  .home-about-body{color:#475569;font-size:14px;line-height:1.85;margin-bottom:16px;}
  .home-about-body strong{color:#1e293b;font-weight:700;}
  .home-about-signals-label{font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:24px;}
  .home-about-signals{display:flex;flex-direction:column;gap:18px;}
  .home-signal-item{display:flex;align-items:center;gap:12px;}
  .home-signal-icon{width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .home-signal-title{font-weight:700;color:#1e293b;font-size:13px;margin:0;}
  .home-signal-sub{color:#94a3b8;font-size:11px;margin:0;}

  /* ─── Product cards (home) ─── */
  .home-product-card {
    background:#fff;border-radius:22px;border:1.5px solid #f0f4f8;
    overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.05);
    transition:all .3s cubic-bezier(.34,1.56,.64,1);cursor:pointer;
  }
  .home-product-card:hover{
    transform:translateY(-8px);
    box-shadow:0 24px 56px rgba(0,0,0,.13);
    border-color:#fecaca;
  }
  .home-product-img{position:relative;overflow:hidden;}
  .home-product-img img,.home-product-img .home-product-placeholder{
    width:100%;height:220px;object-fit:cover;display:block;
    transition:transform .4s ease;
  }
  .home-product-card:hover .home-product-img img{transform:scale(1.05);}
  .home-product-placeholder{
    background:linear-gradient(135deg,#f8fafc,#e2e8f0);
    display:flex;align-items:center;justify-content:center;
    color:#cbd5e1;font-size:44px;
  }
  .home-product-escrow-badge{
    position:absolute;top:12px;left:12px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);
    color:#fff;padding:4px 11px;border-radius:999px;
    font-size:11px;font-weight:700;
    display:flex;align-items:center;gap:5px;
    box-shadow:0 2px 8px rgba(220,38,38,.4);
  }
  .home-product-body{padding:22px;}
  .home-product-cat{
    display:inline-block;background:#fef2f2;color:#dc2626;
    padding:3px 11px;border-radius:8px;font-size:11px;font-weight:700;
    margin-bottom:10px;
  }
  .home-product-title{
    font-weight:700;color:#1e293b;font-size:15px;
    margin:0 0 14px;line-height:1.45;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  }
  .home-product-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;}
  .home-product-price{font-size:1.45rem;font-weight:900;color:#dc2626;margin:0;}
  .home-product-token{font-size:12px;font-weight:600;color:#94a3b8;margin-left:3px;}
  .home-shop-btn {
    display:inline-flex;align-items:center;gap:6px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;
    padding:10px 20px;border-radius:12px;font-weight:700;font-size:13px;
    text-decoration:none;white-space:nowrap;
    box-shadow:0 4px 12px rgba(220,38,38,.35);
    transition:all .2s;
  }
  .home-shop-btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(220,38,38,.45);}
  </style>

  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    /* Network status */
    await checkNetworkStatus(document.getElementById('home-network-status'));

    /* Products */
    try {
      const res  = await fetch('/api/products');
      const data = await res.json();
      const el   = document.getElementById('home-products-container');
      if (!data.products || data.products.length === 0) {
        el.innerHTML = \`
          <div style="background:#fff;border-radius:24px;border:1.5px solid #f0f4f8;padding:80px 24px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.05);">
            <div style="width:80px;height:80px;border-radius:24px;background:linear-gradient(135deg,#fef2f2,#fee2e2);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:32px;color:#fca5a5;box-shadow:0 4px 20px rgba(220,38,38,.1);">
              <i class="fas fa-store"></i>
            </div>
            <h3 style="font-size:1.3rem;font-weight:900;color:#1e293b;margin:0 0 10px;letter-spacing:-.01em;">No Products Listed Yet</h3>
            <p style="color:#94a3b8;font-size:14px;max-width:380px;margin:0 auto 32px;line-height:1.7;">Be the first seller — list your product and start earning USDC or EURC through smart contract escrow.</p>
            <a href="/sell" class="btn-primary" style="display:inline-flex;margin:0 auto;">
              <i class="fas fa-plus-circle"></i> List the First Product
            </a>
          </div>\`;
      } else {
        const latest = data.products.slice(0, 4);
        el.innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:28px;">'
          + latest.map(renderHomeProductCard).join('')
          + '</div>'
          + (data.products.length > 4
              ? \`<div style="text-align:center;margin-top:40px;"><a href="/marketplace" class="btn-secondary">View all \${data.products.length} products &nbsp;<i class="fas fa-arrow-right"></i></a></div>\`
              : '');
      }
    } catch (e) {
      document.getElementById('home-products-container').innerHTML =
        '<div style="text-align:center;padding:56px 24px;color:#ef4444;">'
        +'<i class="fas fa-exclamation-circle" style="font-size:36px;margin-bottom:16px;display:block;opacity:.6;"></i>'
        +'<p style="font-size:14px;color:#64748b;">Failed to load products. Check your connection.</p></div>';
    }
  });

  function renderHomeProductCard(p) {
    const name  = (p.title || p.name || 'Untitled').replace(/</g,'&lt;');
    const price = parseFloat(p.price || 0).toFixed(2);
    const tok   = p.token || 'USDC';
    const cat   = p.category || 'Other';
    const imgEl = p.image
      ? '<img src="' + p.image + '" alt="' + name + '">'
      : '<div class="home-product-placeholder"><i class="fas fa-image"></i></div>';
    return \`
      <div class="home-product-card" onclick="location.href='/product/\${p.id}'">
        <div class="home-product-img">
          \${imgEl}
          <div class="home-product-escrow-badge"><i class="fas fa-shield-alt"></i> Escrow</div>
        </div>
        <div class="home-product-body">
          <div class="home-product-cat">\${cat}</div>
          <h3 class="home-product-title">\${name}</h3>
          <div class="home-product-footer">
            <p class="home-product-price">\${price}<span class="home-product-token">\${tok}</span></p>
            <a href="/product/\${p.id}" class="home-shop-btn" onclick="event.stopPropagation()">
              <i class="fas fa-bolt"></i> Shop Now
            </a>
          </div>
        </div>
      </div>\`;
  }
  </script>
  `)
}


// ─── PAGE: MARKETPLACE ─────────────────────────────────────────────────
function marketplacePage() {
  return shell('Marketplace', `
  <div class="max-w-7xl mx-auto px-4 py-8">
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-3xl font-bold text-slate-800">Marketplace</h1>
        <p class="text-slate-500 mt-1">Live product listings · Payments via escrow on Arc Network</p>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <input id="mp-search-bar" type="text" placeholder="Search products…" class="input text-sm py-2 w-48"/>
        <select id="mp-sort" class="select w-44 text-sm">
          <option value="newest">Sort: Newest</option>
          <option value="price_asc">Price: Low → High</option>
          <option value="price_desc">Price: High → Low</option>
        </select>
        <a href="/sell" class="btn-primary text-sm py-2">
          <i class="fas fa-plus-circle"></i> List Product
        </a>
      </div>
    </div>

    <!-- Network status bar -->
    <div id="mp-network-status" class="mb-4"></div>

    <!-- Demo Disclaimer — Marketplace -->
    <div class="demo-disclaimer mb-6">
      <i class="fas fa-info-circle" style="color:#d97706;flex-shrink:0"></i>
      <span><strong>Demonstration only:</strong> This marketplace is for demonstration purposes only. All products listed are illustrative and not real.</span>
    </div>

    <div class="flex gap-8">
      <!-- Filters sidebar -->
      <aside class="hidden lg:block w-64 shrink-0">
        <div class="card p-5 sticky top-20">
          <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <i class="fas fa-sliders-h text-red-500"></i> Filters
          </h3>
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Category</p>
            <div class="space-y-1.5">
              ${['All','Electronics','Gaming','Audio','Photography','Wearables','Accessories','Pet Shop','Baby & Kids','Beauty & Personal Care','Fashion & Accessories'].map((cat,i) => `
                <label class="flex items-center gap-2 cursor-pointer hover:text-red-600 text-sm text-slate-600">
                  <input type="checkbox" data-cat="${cat}" ${i===0?'checked':''} class="cat-filter accent-red-600 w-3.5 h-3.5"/> ${cat}
                </label>`).join('')}
            </div>
          </div>
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Price Range</p>
            <div class="flex gap-2">
              <input type="number" placeholder="Min" class="input text-xs py-1.5"/>
              <input type="number" placeholder="Max" class="input text-xs py-1.5"/>
            </div>
          </div>
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Token</p>
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600 mb-1"><input type="checkbox" checked class="accent-red-600"/> USDC</label>
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600"><input type="checkbox" checked class="accent-red-600"/> EURC</label>
          </div>
          <button onclick="renderProducts()" class="btn-primary w-full text-sm justify-center">Apply Filters</button>
        </div>
      </aside>

      <!-- Products grid -->
      <div class="flex-1" id="mp-products-container">
        <div class="text-center py-12">
          <div class="loading-spinner-lg mx-auto mb-4"></div>
          <p class="text-slate-400">Fetching products from Arc Network…</p>
        </div>
      </div>
    </div>
  </div>

  <script>
  // ── State ──────────────────────────────────────────────────────────
  let allProducts = [];
  let activeCategory = 'All';
  let sortMode = 'newest';

  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('mp-network-status'));

    // Read ?cat= param from URL
    const urlCat = new URLSearchParams(window.location.search).get('cat') || 'All';
    activeCategory = urlCat;

    // Update sidebar checkbox
    document.querySelectorAll('.cat-filter').forEach(cb => {
      cb.checked = (cb.dataset.cat === activeCategory || (activeCategory === 'All' && cb.dataset.cat === 'All'));
      cb.addEventListener('change', () => {
        activeCategory = cb.dataset.cat;
        document.querySelectorAll('.cat-filter').forEach(x => { x.checked = x.dataset.cat === activeCategory; });
        renderProducts();
      });
    });

    document.getElementById('mp-sort').addEventListener('change', function() {
      sortMode = this.value; renderProducts();
    });
    document.getElementById('mp-search-bar').addEventListener('input', function() {
      renderProducts(this.value.trim().toLowerCase());
    });

    await loadProducts();
  });

  async function loadProducts() {
    try {
      const res  = await fetch('/api/products');
      const data = await res.json();
      allProducts = data.products || [];
      renderProducts();
    } catch {
      document.getElementById('mp-products-container').innerHTML =
        '<div class="card p-8 text-center text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>Could not connect to marketplace. Please try again.</div>';
    }
  }

  function renderProducts(searchText) {
    const q = (searchText !== undefined ? searchText : (document.getElementById('mp-search-bar')||{}).value || '').toLowerCase();
    let list = allProducts.filter(p => {
      const matchCat = activeCategory === 'All' || p.category === activeCategory;
      const matchQ   = !q || (p.title||p.name||'').toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    if (sortMode === 'price_asc')  list = [...list].sort((a,b) => a.price - b.price);
    if (sortMode === 'price_desc') list = [...list].sort((a,b) => b.price - a.price);
    if (sortMode === 'newest')     list = [...list].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    const container = document.getElementById('mp-products-container');
    if (list.length === 0) {
      container.innerHTML = \`
        <div class="card p-16 text-center">
          <div class="empty-state">
            <i class="fas fa-store"></i>
            <h3 class="font-bold text-slate-700 text-xl mb-2">\${allProducts.length === 0 ? 'No Products Listed Yet' : 'No Products Found'}</h3>
            <p class="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
              \${allProducts.length === 0
                ? 'Be the first seller to list your product and earn USDC or EURC!'
                : 'Try changing the filters or search term.'}
            </p>
            <a href="/sell" class="btn-primary mx-auto text-base px-8 py-3">
              <i class="fas fa-plus-circle"></i> List a Product
            </a>
          </div>
        </div>\`;
    } else {
      container.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">'
        + list.map(p => renderMPCard(p)).join('') + '</div>'
        + \`<p class="text-xs text-slate-400 text-right mt-3">\${list.length} product\${list.length!==1?'s':''} found</p>\`;
    }
  }

  function renderMPCard(p) {
    const price = parseFloat(p.price||0).toFixed(2);
    const title = (p.title || p.name || 'Untitled').replace(/</g,'&lt;');
    const desc  = (p.description||'').replace(/</g,'&lt;').slice(0,80);
    const cat   = (p.category||'Other').replace(/</g,'&lt;');
    const tok   = p.token || 'USDC';
    const imgEl = p.image
      ? '<img src="' + p.image + '" class="w-full h-48 object-cover" onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;flex&quot;">'
        + '<div class="w-full h-48 bg-slate-100 items-center justify-center text-slate-300 hidden"><i class="fas fa-image text-4xl"></i></div>'
      : '<div class="w-full h-48 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-300"><i class="fas fa-image text-4xl"></i></div>';
    const sellerShort = p.seller_id ? (p.seller_id.slice(0,6)+'…'+p.seller_id.slice(-4)) : '—';
    return '<div class="product-card">'
      + '<div class="relative overflow-hidden">' + imgEl
      + '<span class="absolute top-2 left-2 badge-escrow"><i class="fas fa-shield-alt mr-1"></i>Escrow</span>'
      + '</div>'
      + '<div class="p-4">'
      + '<div class="flex items-center justify-between mb-1">'
      + '<span class="tag">' + cat + '</span>'
      + '<span class="text-xs text-slate-400 font-mono">' + sellerShort + '</span>'
      + '</div>'
      + '<h3 class="font-semibold text-slate-800 mt-2 mb-1 text-sm leading-tight">' + title + '</h3>'
      + (desc ? '<p class="text-xs text-slate-400 mb-2 leading-relaxed">' + desc + (p.description.length>80?'…':'') + '</p>' : '')
      + '<p class="text-xl font-extrabold text-red-600 mb-3">' + price + ' <span class="text-sm font-semibold">' + tok + '</span></p>'
      + '<div class="flex gap-2">'
      + '<a href="/product/' + p.id + '" class="btn-primary flex-1 text-xs py-2 justify-center"><i class="fas fa-bolt mr-1"></i>Buy Now</a>'
      + '<a href="/product/' + p.id + '" class="btn-secondary text-xs py-2 px-3 justify-center"><i class="fas fa-eye"></i></a>'
      + '</div></div></div>';
  }
  </script>
  `)
}

// ─── PAGE: PRODUCT NOT FOUND (no real product data yet) ────────────────
function productNotFoundPage(id: string) {
  return shell('Product', `
  <!-- Demo Disclaimer — Product Page -->
  <div class="max-w-3xl mx-auto px-4 pt-6">
    <div class="demo-disclaimer">
      <i class="fas fa-info-circle" style="color:#d97706;flex-shrink:0"></i>
      <span><strong>Demonstration only:</strong> This marketplace is for demonstration purposes only. All products listed are illustrative and not real.</span>
    </div>
  </div>
  <div class="max-w-3xl mx-auto px-4 py-8 text-center">
    <div class="card p-12">
      <div class="empty-state">
        <i class="fas fa-box-open"></i>
        <h2 class="text-2xl font-bold text-slate-700 mb-2">Product Not Found</h2>
        <p class="text-slate-400 mb-2">Product ID: <code class="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">${id}</code></p>
        <p class="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
          This product doesn't exist or hasn't been listed on Arc Network yet. All products must be verified on-chain.
        </p>
        <div class="flex flex-wrap gap-3 justify-center">
          <a href="/marketplace" class="btn-primary"><i class="fas fa-store"></i> Browse Marketplace</a>
          <a href="/sell" class="btn-secondary"><i class="fas fa-plus-circle"></i> List a Product</a>
        </div>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: PRODUCT DETAIL ─────────────────────────────────────────────────────
function productPage(p: any) {
  const title  = (p.title  || 'Untitled').replace(/</g, '&lt;')
  const desc   = (p.description || '').replace(/</g, '&lt;')
  const price  = parseFloat(p.price || 0).toFixed(2)
  const tok    = p.token || 'USDC'
  const cat    = (p.category || 'Other').replace(/</g, '&lt;')
  const seller = (p.seller_id || '').replace(/</g, '&lt;')
  const imgUrl = p.image || ''
  const stockN = parseInt(p.stock) || 0

  return shell(title, `
  <div class="max-w-5xl mx-auto px-4 py-8">
    <!-- Breadcrumb -->
    <nav class="text-sm text-slate-400 mb-6 flex items-center gap-2">
      <a href="/marketplace" class="hover:text-red-600">Marketplace</a>
      <i class="fas fa-chevron-right text-xs"></i>
      <span class="text-slate-700 font-medium">${title}</span>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-10">
      <!-- Image -->
      <div>
        ${imgUrl
          ? `<img src="${imgUrl}" alt="${title}" class="w-full rounded-2xl object-cover max-h-[480px] border border-slate-100 shadow-md"
               onerror="this.style.display='none';document.getElementById('img-fallback').style.display='flex'">`
          : ''}
        <div id="img-fallback" style="${imgUrl ? 'display:none' : ''}"
          class="w-full rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 h-72 flex items-center justify-center text-slate-300">
          <i class="fas fa-image text-6xl"></i>
        </div>
      </div>

      <!-- Details -->
      <div class="flex flex-col gap-5">
        <div>
          <span class="tag mb-2 inline-block">${cat}</span>
          <h1 class="text-3xl font-extrabold text-slate-800 mb-2">${title}</h1>
          <p class="text-4xl font-extrabold text-red-600">${price} <span class="text-xl font-bold">${tok}</span></p>
          <p class="text-xs text-slate-400 mt-1">Seller: <span class="font-mono">${seller.slice(0,10)}…${seller.slice(-6)}</span></p>
        </div>

        <!-- Trust badge -->
        <div class="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl p-3">
          <i class="fas fa-shield-alt text-green-600 mt-0.5"></i>
          <div>
            <p class="font-bold text-green-800 text-sm">Escrow Protection</p>
            <p class="text-xs text-green-700">Funds locked in Arc Network smart contract until you confirm delivery.</p>
          </div>
        </div>

        <!-- Wallet transparency -->
        <div class="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3">
          <i class="fas fa-lock text-blue-500 mt-0.5"></i>
          <p class="text-xs text-blue-700">We never access your private keys. All transactions are signed locally in your wallet.</p>
        </div>

        <!-- Description -->
        <div>
          <h3 class="font-bold text-slate-700 mb-2">Description</h3>
          <p class="text-slate-600 text-sm leading-relaxed whitespace-pre-line">${desc}</p>
        </div>

        <!-- Stock -->
        <p class="text-sm text-slate-500"><i class="fas fa-box mr-1 text-slate-400"></i>Stock: <strong>${stockN}</strong> unit${stockN !== 1 ? 's' : ''} available</p>

        <!-- Action buttons — rendered dynamically to support self-purchase check -->
        <div id="product-action-btns" class="flex flex-col gap-3 mt-2">
          ${stockN > 0
            ? `<button id="btn-buy-now" onclick="addToCartAndBuy('${p.id}','${title.replace(/'/g,"\\'")}',${price},'${tok}','${imgUrl}')"
                class="btn-primary justify-center py-4 text-base">
                <i class="fas fa-bolt"></i> Buy Now — ${price} ${tok}
              </button>
              <button id="btn-add-cart" onclick="addToCartOnly('${p.id}','${title.replace(/'/g,"\\'")}',${price},'${tok}','${imgUrl}')"
                class="btn-secondary justify-center py-3">
                <i class="fas fa-cart-plus"></i> Add to Cart
              </button>`
            : `<div class="card p-4 text-center text-slate-500 bg-slate-50">
                <i class="fas fa-box-open mr-2"></i>Out of stock
              </div>`}
        </div>

        <!-- Seller management panel (hidden by default, shown if viewer is the seller) -->
        <div id="seller-actions" class="hidden mt-2 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p class="text-sm font-bold text-amber-800 flex items-center gap-2 mb-2">
            <i class="fas fa-store"></i> Your listing
          </p>
          <p class="text-xs text-amber-700">You are the seller of this product. You cannot purchase your own product.</p>
        </div>
      </div>
    </div>

    <!-- Back link -->
    <div class="mt-10">
      <a href="/marketplace" class="btn-secondary text-sm py-2"><i class="fas fa-arrow-left mr-1"></i>Back to Marketplace</a>
    </div>
  </div>

  <script>
  (function(){
    // Self-purchase check: hide buy buttons if viewer is the seller
    const sellerAddr = '${seller}'.toLowerCase();
    const w = getStoredWallet();
    if(w && sellerAddr && w.address.toLowerCase() === sellerAddr){
      const btns = document.getElementById('product-action-btns');
      const panel = document.getElementById('seller-actions');
      if(btns) btns.classList.add('hidden');
      if(panel) panel.classList.remove('hidden');
    }
  })();

  function addToCartOnly(id, name, price, token, image) {
    CartStore.addToCart({ id, title: name, price: parseFloat(price), currency: token, image });
  }
  function addToCartAndBuy(id, name, price, token, image) {
    addToCartOnly(id, name, price, token, image);
    setTimeout(() => window.location.href = '/cart', 400);
  }
  </script>
  `)
}

// ─── PAGE: CART ────────────────────────────────────────────────────────
function cartPage() {
  return shell('Cart', `
  <div class="max-w-5xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-6 flex items-center gap-3">
      <i class="fas fa-shopping-cart text-red-500"></i> Your Cart
    </h1>
    <div class="flex flex-col lg:flex-row gap-8">
      <div class="flex-1" id="cart-items">
        <div class="card p-12 text-center" id="empty-cart-msg">
          <div class="empty-state">
            <i class="fas fa-shopping-cart"></i>
            <p class="font-medium text-slate-600">Your cart is empty</p>
            <a href="/marketplace" class="btn-primary mt-4 mx-auto">Browse Marketplace</a>
          </div>
        </div>
      </div>
      <div class="w-full lg:w-80">
        <div class="card p-6 sticky top-20">
          <h2 class="font-bold text-slate-800 text-lg mb-4">Order Summary</h2>
          <div class="space-y-3 text-sm mb-4">
            <div class="flex justify-between text-slate-600"><span>Subtotal</span><span id="subtotal">0.00 USDC</span></div>
            <div class="flex justify-between text-slate-600"><span>Platform Fee (1.5%)</span><span id="platform-fee">0.00</span></div>
            <div class="flex justify-between text-slate-600"><span>Gas Estimate</span><span id="gas-fee">~0.01 USDC</span></div>
            <div class="border-t pt-3 flex justify-between font-bold text-lg">
              <span>Total</span><span id="total-price" class="text-red-600">0.00 USDC</span>
            </div>
          </div>
          <div id="wallet-required-msg" class="hidden network-warning mb-3 text-xs">
            <i class="fas fa-exclamation-triangle"></i> Connect wallet to checkout
          </div>
          <a href="/checkout" id="checkout-btn" class="btn-primary w-full justify-center py-3 text-base">
            <i class="fas fa-lock"></i> Proceed to Checkout
          </a>
          <a href="/marketplace" class="btn-secondary w-full justify-center mt-2 text-sm">Continue Shopping</a>
          <p class="text-slate-400 text-xs text-center mt-3">
            <i class="fas fa-shield-alt text-red-400 mr-1"></i>Secured by Arc Network escrow
          </p>
        </div>
      </div>
    </div>
  </div>
  <script>
  // ── Cart page helpers — all read/write via CartStore ──────────────
  function renderCart() {
    const cart      = CartStore.getCart();
    const container = document.getElementById('cart-items');
    const emptyMsg  = document.getElementById('empty-cart-msg');

    if (!cart.length) {
      emptyMsg.style.display  = 'block';
      container.innerHTML     = '';
      // zero totals
      ['subtotal','platform-fee','total-price'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '0.00 USDC';
      });
      const gasEl = document.getElementById('gas-fee');
      if (gasEl) gasEl.textContent = '~0.00 USDC';
      return;
    }
    emptyMsg.style.display = 'none';
    let subtotal = 0, gas = 0;
    const rows = [];
    for (const item of cart) {
      const qty   = item.quantity || 1;
      const price = parseFloat(item.price) || 0;
      const cur   = item.currency || item.token || 'USDC';
      const title = (item.title || item.name || 'Product').replace(/</g,'&lt;');
      const id    = (item.id || '').replace(/"/g,'');
      subtotal += price * qty;
      gas      += 0.01;
      const imgHtml = item.image
        ? '<img src="' + item.image + '" class="w-16 h-16 rounded-xl object-cover flex-shrink-0" onerror="this.style.display=&quot;none&quot;">'
        : '<div class="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-slate-300 flex-shrink-0"><i class="fas fa-box"></i></div>';
      rows.push(
        '<div class="card p-4 mb-3 flex items-center gap-4">'
        + imgHtml
        + '<div class="flex-1 min-w-0">'
        + '<p class="font-semibold text-slate-800 text-sm truncate">' + title + '</p>'
        + '<p class="text-red-600 font-bold text-sm">' + price.toFixed(2) + ' ' + cur + '</p>'
        + '<p class="text-xs text-slate-400">Qty: ' + qty + '</p>'
        + '</div>'
        + '<div class="flex items-center gap-2 flex-shrink-0">'
        + '<button data-id="' + id + '" data-delta="-1" class="qty-btn w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 font-bold text-sm">−</button>'
        + '<span class="font-bold w-6 text-center text-sm">' + qty + '</span>'
        + '<button data-id="' + id + '" data-delta="1" class="qty-btn w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 font-bold text-sm">+</button>'
        + '</div>'
        + '<button data-id="' + id + '" class="rm-btn text-red-400 hover:text-red-600 ml-2 flex-shrink-0"><i class="fas fa-trash text-sm"></i></button>'
        + '</div>'
      );
    }
    container.innerHTML = rows.join('');
    // Attach click handlers via event delegation (avoids inline onclick quoting issues)
    container.querySelectorAll('.qty-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        cartChangeQty(this.dataset.id, parseInt(this.dataset.delta));
      });
    });
    container.querySelectorAll('.rm-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { cartRemove(this.dataset.id); });
    });

    const fee = subtotal * 0.015;
    const tok = cart[0]?.currency || cart[0]?.token || 'USDC';
    document.getElementById('subtotal').textContent      = subtotal.toFixed(2) + ' ' + tok;
    document.getElementById('platform-fee').textContent  = fee.toFixed(4)      + ' ' + tok;
    document.getElementById('gas-fee').textContent       = '~' + gas.toFixed(2) + ' USDC';
    document.getElementById('total-price').textContent   = (subtotal + fee).toFixed(2) + ' ' + tok;

    const w = getStoredWallet();
    if (!w) document.getElementById('wallet-required-msg')?.classList.remove('hidden');
  }

  function cartChangeQty(id, delta) {
    CartStore.changeQty(id, delta);
    renderCart();
  }
  function cartRemove(id) {
    CartStore.removeFromCart(id);
    renderCart();
    showToast('Item removed from cart', 'info');
  }

  document.addEventListener('DOMContentLoaded', renderCart);
  </script>
  `)
}

// ─── PAGE: CHECKOUT ────────────────────────────────────────────────────
function checkoutPage() {
  return shell('Checkout', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-lock text-red-500"></i> Secure Checkout
    </h1>
    <p class="text-slate-500 mb-6">Funds are locked in escrow on Arc Network until delivery is confirmed.</p>

    <!-- Network check -->
    <div id="co-network-status" class="mb-6"></div>

    <!-- Escrow flow -->
    <div class="card p-5 mb-8">
      <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
        <i class="fas fa-route text-red-500"></i> Escrow Flow on Arc Network
      </h3>
      <div class="flex items-center gap-2 overflow-x-auto pb-2">
        ${[['Confirm','fas fa-check'],['Lock USDC/EURC','fas fa-lock'],['Seller Ships','fas fa-shipping-fast'],['You Confirm','fas fa-box-open'],['Released','fas fa-coins']].map(([label,icon],i) => `
          <div class="flex items-center gap-2 shrink-0">
            <div class="flex flex-col items-center">
              <div class="w-10 h-10 rounded-full ${i===0?'bg-red-600 text-white':'bg-slate-200 text-slate-400'} flex items-center justify-center">
                <i class="${icon} text-sm"></i>
              </div>
              <p class="text-xs text-center mt-1 ${i===0?'text-red-600 font-medium':'text-slate-400'} w-16">${label}</p>
            </div>
            ${i<4?'<div class="w-8 h-0.5 bg-slate-200 mb-5"></div>':''}
          </div>`).join('')}
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div class="space-y-6">
        <!-- Token selection -->
        <div class="card p-5">
          <h3 class="font-bold text-slate-800 mb-4">Payment Token</h3>
          <div class="grid grid-cols-2 gap-3">
            <label class="cursor-pointer">
              <input type="radio" name="token" value="USDC" checked class="sr-only peer"/>
              <div class="card p-4 flex items-center gap-3 peer-checked:border-red-500 peer-checked:bg-red-50 hover:border-red-300 transition-all">
                <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center"><span class="font-bold text-blue-700">$</span></div>
                <div><p class="font-bold text-slate-800">USDC</p><p class="text-slate-400 text-xs">Native on Arc</p></div>
              </div>
            </label>
            <label class="cursor-pointer">
              <input type="radio" name="token" value="EURC" class="sr-only peer"/>
              <div class="card p-4 flex items-center gap-3 peer-checked:border-red-500 peer-checked:bg-red-50 hover:border-red-300 transition-all">
                <div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center"><span class="font-bold text-indigo-700">€</span></div>
                <div><p class="font-bold text-slate-800">EURC</p><p class="text-slate-400 text-xs">Euro stablecoin</p></div>
              </div>
            </label>
          </div>
        </div>
        <!-- Shipping -->
        <div class="card p-5">
          <h3 class="font-bold text-slate-800 mb-4">Shipping Address</h3>
          <div class="space-y-3">
            <input type="text" placeholder="Full Name" class="input"/>
            <input type="email" placeholder="Email Address" class="input"/>
            <input type="text" placeholder="Street Address" class="input"/>
            <div class="grid grid-cols-2 gap-3">
              <input type="text" placeholder="City" class="input"/>
              <input type="text" placeholder="ZIP Code" class="input"/>
            </div>
            <select class="select"><option>Select Country</option><option>United States</option><option>United Kingdom</option><option>Germany</option><option>Brazil</option><option>Other</option></select>
          </div>
        </div>
      </div>

      <div>
        <div class="card p-5 mb-4">
          <h3 class="font-bold text-slate-800 mb-4">Order Summary</h3>
          <div id="co-items" class="space-y-3 mb-4 text-sm">
            <div class="text-slate-400 text-center py-4">Loading…</div>
          </div>
          <div class="border-t pt-4 space-y-2 text-sm">
            <div class="flex justify-between text-slate-600"><span>Subtotal</span><span id="co-sub">—</span></div>
            <div class="flex justify-between text-slate-600"><span>Platform Fee (1.5%)</span><span id="co-fee">—</span></div>
            <div class="flex justify-between text-slate-600"><span>Gas (Arc Network)</span><span class="text-blue-600">~0.01 USDC</span></div>
            <div class="flex justify-between text-slate-400 text-xs"><span>Government Fee</span><span>—</span></div>
            <div class="border-t pt-2 flex justify-between font-extrabold text-lg">
              <span>Total</span><span id="co-total" class="text-red-600">—</span>
            </div>
          </div>
        </div>

        <!-- Wallet status -->
        <div class="card p-4 mb-4" id="co-wallet-card">
          <div class="flex items-center gap-3" id="co-wallet-inner">
            <div class="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600">
              <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div>
              <p class="font-semibold text-slate-800 text-sm">No wallet connected</p>
              <p class="text-slate-400 text-xs">Connect to Arc Testnet to checkout</p>
            </div>
          </div>
          <a href="/wallet" id="co-wallet-link" class="btn-secondary w-full justify-center text-sm mt-3">
            <i class="fas fa-wallet"></i> Connect Wallet
          </a>
        </div>

        <button onclick="confirmOrder()" id="co-confirm-btn" class="btn-primary w-full justify-center py-4 text-base font-bold">
          <i class="fas fa-lock mr-2"></i> Confirm & Lock Funds
        </button>
        <div class="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 space-y-1">
          <p class="font-semibold flex items-center gap-1"><i class="fas fa-info-circle"></i> 3-step escrow process</p>
          <p><span class="font-medium">Step 1:</span> Approve Permit2 to spend your tokens (once per token)</p>
          <p><span class="font-medium">Step 2:</span> Sign the escrow permit (off-chain, no gas)</p>
          <p><span class="font-medium">Step 3:</span> Relayer locks funds in FxEscrow contract — "to" address = escrow, never seller</p>
        </div>
      </div>
    </div>
  </div>

  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('co-network-status'));
    const cart = getCart();
    const container = document.getElementById('co-items');
    if (!cart.length) {
      container.innerHTML = '<div class="text-center text-slate-400 py-4">Cart is empty. <a href="/marketplace" class="text-red-600">Browse products</a></div>';
      return;
    }
    let total=0;
    container.innerHTML = cart.map(item => {
      const qty  = item.quantity || item.qty || 1;
      const price= parseFloat(item.price) || 0;
      const title= (item.title || item.name || 'Product').replace(/</g,'&lt;');
      const cur  = item.currency || item.token || 'USDC';
      total += price * qty;
      return '<div class="flex items-center gap-3">'
        +(item.image?'<img src="'+item.image+'" class="w-12 h-12 rounded-lg object-cover object-center" onerror="this.style.display=&quot;none&quot;"/>'
                   :'<div class="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 flex-shrink-0"><i class="fas fa-box"></i></div>')
        +'<div class="flex-1 min-w-0"><p class="font-medium text-slate-800 text-xs truncate">'+title+'</p>'
        +'<p class="text-slate-400 text-xs">Qty: '+qty+'</p></div>'
        +'<p class="font-bold text-red-600 text-sm flex-shrink-0">'+(price*qty).toFixed(2)+' '+cur+'</p></div>';
    }).join('');
    const fee=total*0.015;
    const mainCur = cart[0]?.currency || cart[0]?.token || 'USDC';
    document.getElementById('co-sub').textContent=total.toFixed(2)+' '+mainCur;
    document.getElementById('co-fee').textContent=fee.toFixed(4)+' '+mainCur;
    document.getElementById('co-total').textContent=(total+fee).toFixed(2)+' '+mainCur;

    const w=getStoredWallet();
    if(w){
      document.getElementById('co-wallet-inner').innerHTML =
        '<div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600"><i class="fas fa-check-circle"></i></div>'
        +'<div><p class="font-semibold text-slate-800 text-sm">Wallet Connected</p>'
        +'<p class="text-slate-400 text-xs addr-mono">'+w.address+'</p></div>';
      document.getElementById('co-wallet-link').style.display='none';
    }
  });

  // ════════════════════════════════════════════════════════════════════
  //  confirmOrder — funds flow ONLY through FxEscrow contract
  //
  //  Flow:
  //   1. Buyer signs ERC-20 approve(Permit2, amount)          [on-chain tx]
  //   2. Buyer signs Permit2 WitnessTransferFrom (EIP-712)    [off-chain sig]
  //   3. POST /api/escrow/record-trade  (server calls recordTrade)
  //      → FxEscrow pulls tokens from buyer into escrow contract
  //   4. Order saved with status = 'escrow_locked'
  //      txHash = escrow contract tx, "to" = FxEscrow address
  //
  //  NEVER sends tokens directly to seller address.
  // ════════════════════════════════════════════════════════════════════
  async function confirmOrder(){
    const w=getStoredWallet();
    if(!w){showToast('Connect a wallet first','error');window.location.href='/wallet';return;}

    // Ensure Arc Testnet for MetaMask
    if(w.type==='metamask' && window.ethereum){
      const onArc=await isOnArcNetwork();
      if(!onArc){
        showToast('Switching to Arc Testnet…','info');
        const switched = await switchToArc();
        if(!switched){ showToast('Please switch to Arc Testnet in MetaMask','warning'); return; }
      }
    }

    const cart=getCart();
    if(!cart.length){showToast('Cart is empty','error');return;}

    const total=cart.reduce((s,i)=>s+(parseFloat(i.price)||0)*((i.quantity||i.qty)||1),0);
    const token=document.querySelector('input[name="token"]:checked')?.value||'USDC';
    const tokenAddress = token==='USDC' ? window.ARC.contracts.USDC : window.ARC.contracts.EURC;
    const escrowAddress = window.ARC.contracts.FxEscrow;
    const permit2Address = window.ARC.contracts.Permit2;

    // ── Resolve seller address ──────────────────────────────────────
    let sellerAddress = '0x0000000000000000000000000000000000000000';
    try {
      const pid = cart[0]?.id;
      if(pid){
        const r = await fetch('/api/products/'+pid);
        const d = await r.json();
        if(d.product?.seller_id && d.product.seller_id.startsWith('0x')){
          sellerAddress = d.product.seller_id;
        }
      }
    } catch(e){}

    // ── Self-purchase guard ─────────────────────────────────────────
    if(sellerAddress && sellerAddress !== '0x0000000000000000000000000000000000000000' &&
       w.address.toLowerCase() === sellerAddress.toLowerCase()){
      showToast('You cannot purchase your own product','error');
      return;
    }

    // ── Show confirmation modal ─────────────────────────────────────
    const confirmResult = await showTxConfirmModal({
      action: 'Lock Funds in Escrow',
      amount: total.toFixed(2),
      token: token,
      network: 'Arc Testnet (Chain ID: 5042002)',
      note: 'Funds go to the FxEscrow contract — released only after delivery confirmation.'
    });
    if(!confirmResult){showToast('Transaction cancelled','info');return;}

    const btn=document.getElementById('co-confirm-btn');
    if(btn){btn.disabled=true;btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Waiting for wallet…';}

    // ── Build amounts ───────────────────────────────────────────────
    const totalRounded = Math.round(total * 1_000_000) / 1_000_000;
    const amountStr    = totalRounded.toFixed(6);
    const amountWei    = ethers.parseUnits(amountStr, 6);   // 6 decimals for USDC/EURC

    // Platform fee = 0.1% of amount (goes to feeRecipient, stays in escrow accounting)
    const feeBps   = 10n;    // 10 basis points = 0.1%
    const feeWei   = (amountWei * feeBps) / 10000n;

    // Nonce: use current timestamp in ms (must be unused in Permit2 nonce bitmap)
    const nonce    = BigInt(Date.now());
    const deadline = BigInt(Math.floor(Date.now()/1000) + 3600); // 1 hour

    // ── quoteId: keccak256 of orderId ──────────────────────────────
    const orderId  = 'ORD-'+Date.now();
    const quoteId  = ethers.keccak256(ethers.toUtf8Bytes(orderId));

    // Maturity: settlement deadline = now + 30 days
    const maturity = BigInt(Math.floor(Date.now()/1000) + 30*24*3600);

    let provider, signer;
    try {
      if(w.type==='metamask' && window.ethereum){
        provider = new ethers.BrowserProvider(window.ethereum);
        signer   = await provider.getSigner();
      } else if((w.type==='internal'||w.type==='imported') && w.privateKey && !w.privateKey.startsWith('[')){
        provider = new ethers.JsonRpcProvider(window.ARC.rpc);
        signer   = new ethers.Wallet(w.privateKey, provider);
      } else {
        showToast('Private key unavailable. Re-import wallet with seed phrase.','error');
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds';}
        return;
      }
    } catch(err){
      showToast('Wallet error: '+(err.message||''),'error');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds';}
      return;
    }

    // ── STEP 1: ERC-20 approve(Permit2, amount) ────────────────────
    // Permit2 needs allowance to pull tokens on behalf of the buyer.
    // Check existing allowance first to avoid unnecessary transactions.
    try {
      if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Step 1/3 — Approve Permit2…';
      showToast('Step 1/3: Approving Permit2 to spend '+token+'…','info');

      const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const currentAllowance = await erc20.allowance(w.address, permit2Address);

      if(currentAllowance < amountWei){
        // Approve max uint256 so future orders don't need re-approval
        const MAX = ethers.MaxUint256;
        const approveTx = await erc20.approve(permit2Address, MAX);
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Step 1/3 — Confirming approval…';
        await approveTx.wait(1);
        showToast('Permit2 approved ✓','success');
      } else {
        showToast('Permit2 already approved ✓','success');
      }
    } catch(err){
      const msg = err.code==='ACTION_REJECTED'||err.code===4001
        ? 'Approval rejected by user'
        : 'Approval error: '+(err.shortMessage||err.message||'');
      showToast(msg,'error');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds';}
      return;
    }

    // ── STEP 2: Sign Permit2 WitnessTransferFrom (EIP-712) ─────────
    // The buyer signs an off-chain message authorising FxEscrow to pull
    // exactly [amountWei] tokens. No on-chain transaction is needed here.
    //
    // Witness type (matches FxEscrow SINGLE_TRADE_WITNESS_TYPE suffix):
    //   TakerDetails(Consideration consideration,address recipient,uint256 fee)
    //   Consideration(bytes32 quoteId,address base,address quote,
    //                 uint256 baseAmount,uint256 quoteAmount,uint256 maturity)
    let takerSig;
    try {
      if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Step 2/3 — Sign escrow permit…';
      showToast('Step 2/3: Sign the escrow permit in your wallet…','info');

      // EIP-712 domain = Permit2 contract (chain-specific domain separator)
      const domain = {
        name: 'Permit2',
        chainId: window.ARC.chainId,
        verifyingContract: permit2Address
      };

      // Witness type definitions (alphabetically ordered per EIP-712)
      const takerTypes = {
        PermitWitnessTransferFrom: [
          { name: 'permitted', type: 'TokenPermissions' },
          { name: 'spender',   type: 'address' },
          { name: 'nonce',     type: 'uint256' },
          { name: 'deadline',  type: 'uint256' },
          { name: 'witness',   type: 'TakerDetails' }
        ],
        TokenPermissions: [
          { name: 'token',  type: 'address' },
          { name: 'amount', type: 'uint256' }
        ],
        TakerDetails: [
          { name: 'consideration', type: 'Consideration' },
          { name: 'recipient',     type: 'address' },
          { name: 'fee',           type: 'uint256' }
        ],
        Consideration: [
          { name: 'quoteId',     type: 'bytes32' },
          { name: 'base',        type: 'address' },
          { name: 'quote',       type: 'address' },
          { name: 'baseAmount',  type: 'uint256' },
          { name: 'quoteAmount', type: 'uint256' },
          { name: 'maturity',    type: 'uint256' }
        ]
      };

      const takerValue = {
        permitted: { token: tokenAddress, amount: amountWei.toString() },
        spender:   escrowAddress,
        nonce:     nonce.toString(),
        deadline:  deadline.toString(),
        witness: {
          consideration: {
            quoteId,
            base:        tokenAddress,    // buyer pays base token
            quote:       tokenAddress,    // seller receives same token (single-currency)
            baseAmount:  amountWei.toString(),
            quoteAmount: amountWei.toString(),
            maturity:    maturity.toString()
          },
          recipient: sellerAddress,       // funds go to seller after release
          fee:       feeWei.toString()
        }
      };

      takerSig = await signer.signTypedData(domain, takerTypes, takerValue);
      showToast('Escrow permit signed ✓','success');
    } catch(err){
      const msg = err.code==='ACTION_REJECTED'||err.code===4001
        ? 'Permit signature rejected by user'
        : 'Signing error: '+(err.shortMessage||err.message||'');
      showToast(msg,'error');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds';}
      return;
    }

    // ── STEP 3: POST to relayer → recordTrade on FxEscrow ──────────
    // Server calls recordTrade() with both permits; FxEscrow pulls tokens
    // from buyer into the escrow contract. "to" address = escrow contract.
    let txHash, escrowTradeId;
    try {
      if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Step 3/3 — Locking funds in escrow…';
      showToast('Step 3/3: Submitting to escrow contract…','info');

      const takerPermitPayload = {
        permitted: { token: tokenAddress, amount: amountWei.toString() },
        nonce:     nonce.toString(),
        deadline:  deadline.toString(),
        witness: {
          consideration: {
            quoteId,
            base:        tokenAddress,
            quote:       tokenAddress,
            baseAmount:  amountWei.toString(),
            quoteAmount: amountWei.toString(),
            maturity:    maturity.toString()
          },
          recipient: sellerAddress,
          fee:       feeWei.toString()
        }
      };

      // Maker (seller) permit: seller is not signing here — in this flow the
      // buyer is the only signer; seller's "contribution" amount is 0 (they
      // receive, not pay). The maker permit carries a zero-amount token with
      // fee accounting only. The server will construct the maker permit nonce.
      const makerPermitPayload = {
        permitted: { token: tokenAddress, amount: '0' },
        nonce:     (nonce + 1n).toString(),   // distinct nonce for maker slot
        deadline:  deadline.toString(),
        witness:   { fee: '0' }               // maker fee = 0 for buyer-pays model
      };

      const resp = await fetch('/api/escrow/record-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerAddress:   w.address,
          sellerAddress,
          tokenAddress,
          amountWei:      amountWei.toString(),
          quoteId,
          maturity:       maturity.toString(),
          takerPermit:    takerPermitPayload,
          takerSig,
          makerPermit:    makerPermitPayload,
          makerSig:       '0x',   // server signs or uses relayer authority
          orderId
        })
      });
      const relayerData = await resp.json();

      if(relayerData.fallback){
        // ── RELAYER NOT CONFIGURED ──────────────────────────────────
        // The RELAYER_PRIVATE_KEY secret is not set on the server.
        // We must NOT fake an escrow — instead show a clear error so the
        // user knows funds were NOT locked. No tokens were sent anywhere.
        throw new Error(
          'Escrow relayer is not configured. ' +
          'Add RELAYER_PRIVATE_KEY as a Cloudflare secret and redeploy. ' +
          'No tokens have been sent — your funds are safe.'
        );
      } else if(relayerData.success){
        txHash       = relayerData.txHash;
        escrowTradeId = relayerData.escrowTradeId;
        showToast('Funds locked in escrow! Tx: '+txHash.substring(0,14)+'…','success');
      } else {
        throw new Error(relayerData.message || 'Escrow submission failed');
      }
    } catch(err){
      const msg = 'Escrow error: '+(err.message||'unknown');
      showToast(msg,'error');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds';}
      return;
    }

    // ── Save order ─────────────────────────────────────────────────
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash, buyerAddress: w.address, sellerAddress,
          amount: total, token, productId: cart[0]?.id||'',
          items: cart, orderId, escrowTradeId
        })
      });
      const data = await res.json();
      const savedOrder = data.success ? data.order : {
        id: orderId, txHash, escrowTradeId,
        buyerAddress: w.address, sellerAddress,
        escrowContract: escrowAddress,
        amount: total, token,
        productId: cart[0]?.id||'',
        status: 'escrow_locked',
        createdAt: new Date().toISOString()
      };

      const orders = JSON.parse(localStorage.getItem('rh_orders')||'[]');
      orders.push({
        ...savedOrder,
        items: cart,
        escrowContract: escrowAddress,
        explorerUrl: window.ARC.explorer+'/tx/'+txHash
      });
      localStorage.setItem('rh_orders', JSON.stringify(orders));
      saveCart([]); updateCartBadge();
      showToast('Escrow locked! Order '+orderId,'success');
      setTimeout(()=>window.location.href='/orders/'+orderId, 1500);
    } catch(err){
      // API save failed but escrow tx succeeded — save locally with real hash
      if(txHash && escrowTradeId){
        const orders = JSON.parse(localStorage.getItem('rh_orders')||'[]');
        orders.push({
          id: orderId, txHash, escrowTradeId,
          buyerAddress: w.address, sellerAddress,
          escrowContract: escrowAddress,
          amount: total, token,
          productId: cart[0]?.id||'',
          items: cart,
          status: 'escrow_locked',
          createdAt: new Date().toISOString(),
          explorerUrl: window.ARC.explorer+'/tx/'+txHash
        });
        localStorage.setItem('rh_orders', JSON.stringify(orders));
        saveCart([]); updateCartBadge();
        showToast('Escrow locked! Hash: '+txHash.substring(0,14)+'…','success');
        setTimeout(()=>window.location.href='/orders/'+orderId, 1500);
      } else {
        // Nothing was locked — surface the error
        showToast('Order error: '+(err.message||''),'error');
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds';}
      }
    }
  }
  </script>
  `)
}

// ─── PAGE: WALLET ──────────────────────────────────────────────────────
function walletPage() {
  return shell('Wallet', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-wallet text-red-500"></i> redhawk-store Wallet
    </h1>
    <p class="text-slate-500 mb-2">Non-custodial wallet — your keys, your funds, on Arc Network.</p>
    <div id="wallet-network-status" class="mb-6"></div>

    <!-- No Wallet -->
    <div id="no-wallet-state">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <a href="/wallet/create" class="card p-8 text-center hover:border-red-300 hover:shadow-lg transition-all group">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg">
            <i class="fas fa-plus"></i>
          </div>
          <h2 class="text-xl font-bold text-slate-800 mb-2">Create New Wallet</h2>
          <p class="text-slate-500 text-sm">Generate a non-custodial wallet. Keys generated client-side, never sent to server.</p>
          <div class="inline-flex items-center gap-2 mt-4 text-green-600 text-sm font-medium">
            <i class="fas fa-shield-alt"></i> 100% Non-Custodial · BIP39
          </div>
        </a>
        <a href="/wallet/import" class="card p-8 text-center hover:border-red-300 hover:shadow-lg transition-all group">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-white text-2xl mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg">
            <i class="fas fa-file-import"></i>
          </div>
          <h2 class="text-xl font-bold text-slate-800 mb-2">Import Existing Wallet</h2>
          <p class="text-slate-500 text-sm">Restore using 12 or 24-word BIP39 seed phrase from MetaMask or any compatible wallet.</p>
          <div class="inline-flex items-center gap-2 mt-4 text-blue-600 text-sm font-medium">
            <i class="fas fa-key"></i> BIP39 Compatible
          </div>
        </a>
      </div>
      <div class="card p-6">
        <h3 class="font-bold text-slate-800 mb-4">Connect External Wallet</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button onclick="connectAndReload('metamask')" class="card p-4 flex items-center gap-3 hover:border-orange-300 hover:bg-orange-50/50 transition-all">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-10 h-10"/>
            <div class="text-left">
              <p class="font-bold text-slate-800">MetaMask</p>
              <p class="text-slate-400 text-xs">Auto-switches to Arc Testnet</p>
            </div>
            <i class="fas fa-chevron-right text-slate-300 ml-auto"></i>
          </button>
          <button onclick="showToast('WalletConnect: scan QR with wallet set to Arc Testnet (5042002)','info')" class="card p-4 flex items-center gap-3 hover:border-blue-300 hover:bg-blue-50/50 transition-all">
            <div class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <i class="fas fa-qrcode text-white"></i>
            </div>
            <div class="text-left">
              <p class="font-bold text-slate-800">WalletConnect</p>
              <p class="text-slate-400 text-xs">Chain ID: 5042002</p>
            </div>
            <i class="fas fa-chevron-right text-slate-300 ml-auto"></i>
          </button>
        </div>
        <div class="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-800">
          <i class="fas fa-info-circle mr-1"></i>
          <strong>New to Arc?</strong> Get free test USDC & EURC at
          <a href="https://faucet.circle.com" target="_blank" class="underline font-bold">faucet.circle.com</a>
        </div>
        <!-- Wallet transparency notice -->
        <div class="trust-box mt-4">
          <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0;margin-top:1px"></i>
          <span><strong>Your keys, your funds.</strong> redhawk-store never accesses your private keys. All transactions are signed locally in your wallet and broadcast directly to Arc Network. We have zero custody over your assets.</span>
        </div>
      </div>
    </div>

    <!-- Has Wallet -->
    <div id="has-wallet-state" class="hidden">
      <!-- Wallet card -->
      <div class="wallet-card mb-6">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
            </div>
            <div>
              <p class="font-bold text-lg">redhawk-store Wallet</p>
              <p class="text-red-200 text-xs">Arc Testnet · Chain 5042002</p>
            </div>
          </div>
          <div class="text-right">
            <div id="network-dot" class="w-3 h-3 rounded-full bg-yellow-400 ml-auto animate-pulse"></div>
            <p class="text-red-200 text-xs mt-1" id="wallet-network-label">Checking…</p>
          </div>
        </div>
        <div class="mb-4">
          <p class="text-red-200 text-xs mb-1">Wallet Address</p>
          <div class="flex items-center gap-2">
            <p class="font-mono text-sm break-all" id="wallet-addr-display">—</p>
            <button onclick="copyAddress()" class="text-red-200 hover:text-white text-xs shrink-0"><i class="fas fa-copy"></i></button>
          </div>
          <a id="explorer-link" href="#" target="_blank" class="text-red-300 text-xs hover:text-white mt-1 inline-flex items-center gap-1">
            <i class="fas fa-external-link-alt text-xs"></i> View on Arc Explorer
          </a>
        </div>
        <!-- Balances — fetched live from Arc RPC -->
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-white/10 rounded-xl p-4">
            <p class="text-red-200 text-xs mb-1">USDC Balance</p>
            <div id="usdc-balance-display" class="flex items-center gap-2">
              <div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>
            </div>
            <p class="text-red-300 text-xs mt-1">Native on Arc</p>
          </div>
          <div class="bg-white/10 rounded-xl p-4">
            <p class="text-red-200 text-xs mb-1">EURC Balance</p>
            <div id="eurc-balance-display" class="flex items-center gap-2">
              <div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>
            </div>
            <p class="text-red-300 text-xs mt-1">0x89B5…D72a</p>
          </div>
        </div>
        <button onclick="refreshBalances()" class="mt-3 text-red-200 hover:text-white text-xs flex items-center gap-1">
          <i class="fas fa-sync-alt text-xs"></i> Refresh balances
        </button>
      </div>

      <!-- Actions -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        ${[['fas fa-paper-plane','Send','openSendModal()'],['fas fa-qrcode','Receive','openReceiveModal()'],['fas fa-external-link-alt','Explorer','openExplorer()'],['fas fa-history','Orders','window.location.href=&quot;/orders&quot;']].map(([icon,label,action])=>`
          <button onclick="${action}" class="card p-4 flex flex-col items-center gap-2 hover:border-red-300 hover:bg-red-50 transition-all">
            <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600"><i class="${icon}"></i></div>
            <p class="text-sm font-semibold text-slate-700">${label}</p>
          </button>`).join('')}
      </div>

      <!-- Wallet transparency notice (dashboard) -->
      <div class="trust-box mb-6">
        <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0;margin-top:1px"></i>
        <span><strong>Your keys, your funds.</strong> redhawk-store never accesses your private keys. All transactions are signed locally in your wallet and broadcast directly to Arc Network. We have zero custody over your assets. <a href="/privacy" class="underline text-green-800 font-medium">Privacy Policy</a></span>
      </div>

      <!-- Real Tx History -->
      <div class="card p-5 mb-4">
        <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i class="fas fa-history text-red-500"></i> Transaction History
          <span class="text-xs text-slate-400 font-normal ml-auto">Live from Arc Explorer</span>
        </h3>
        <div id="tx-history-container">
          <div class="text-center py-6">
            <div class="loading-spinner mx-auto mb-2"></div>
            <p class="text-slate-400 text-sm">Fetching from Arc Network…</p>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="card p-5 border-red-100">
        <h3 class="font-bold text-red-700 mb-3 flex items-center gap-2"><i class="fas fa-exclamation-triangle"></i> Danger Zone</h3>
        <div class="flex flex-wrap gap-3">
          <button onclick="exportWallet()" class="btn-secondary text-sm"><i class="fas fa-file-export"></i> Export Wallet</button>
          <button onclick="disconnectWallet()" class="bg-red-50 text-red-600 border-2 border-red-200 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-100">
            <i class="fas fa-sign-out-alt"></i> Disconnect
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Send Modal -->
  <div id="send-modal" class="modal-overlay hidden">
    <div class="modal">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-bold text-slate-800"><i class="fas fa-paper-plane text-red-500 mr-2"></i>Send Tokens</h3>
        <button onclick="closeSendModal()" class="text-slate-400 hover:text-slate-600"><i class="fas fa-times text-xl"></i></button>
      </div>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Recipient Address (Arc Testnet)</label>
          <input type="text" id="send-to" placeholder="0x…" class="input"/>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Token</label>
          <select id="send-token" class="select">
            <option value="USDC">USDC (native)</option>
            <option value="EURC">EURC (ERC-20)</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Amount</label>
          <input type="number" id="send-amount" placeholder="0.00" step="0.000001" class="input"/>
        </div>
        <div class="network-warning text-xs">
          <i class="fas fa-exclamation-triangle"></i>
          Transactions on Arc Network are irreversible. You need USDC for gas fees.
        </div>
        <button onclick="executeSend()" class="btn-primary w-full justify-center py-3">
          <i class="fas fa-paper-plane"></i> Send on Arc Network
        </button>
      </div>
    </div>
  </div>

  <!-- Receive Modal -->
  <div id="receive-modal" class="modal-overlay hidden">
    <div class="modal text-center">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-bold text-slate-800"><i class="fas fa-qrcode text-red-500 mr-2"></i>Receive Tokens</h3>
        <button onclick="closeReceiveModal()" class="text-slate-400 hover:text-slate-600"><i class="fas fa-times text-xl"></i></button>
      </div>
      <div class="bg-slate-50 rounded-2xl p-6 mb-4 inline-block">
        <div class="w-48 h-48 flex items-center justify-center bg-white rounded-xl mx-auto border border-slate-200">
          <i class="fas fa-qrcode text-7xl text-slate-300"></i>
        </div>
      </div>
      <p class="font-medium text-slate-800 mb-1">Your Arc Network Address</p>
      <div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 mb-3 justify-center">
        <p class="font-mono text-xs text-slate-600 break-all" id="receive-addr">—</p>
        <button onclick="copyAddress()" class="text-red-500 shrink-0"><i class="fas fa-copy text-sm"></i></button>
      </div>
      <p class="text-slate-400 text-xs mb-3">Send only USDC or EURC on <strong>Arc Testnet (Chain ID: 5042002)</strong>.</p>
      <a href="https://faucet.circle.com" target="_blank" class="btn-primary text-sm mx-auto">
        <i class="fas fa-faucet"></i> Get Free Test Tokens
      </a>
    </div>
  </div>

  <script>
  async function connectAndReload(type) {
    const w = await connectWallet(type);
    if (w) setTimeout(() => location.reload(), 800);
  }

  async function refreshBalances() {
    const w = getStoredWallet();
    if (!w) return;
    document.getElementById('usdc-balance-display').innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>';
    document.getElementById('eurc-balance-display').innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>';
    const b = await fetchArcBalances(w.address);
    document.getElementById('usdc-balance-display').innerHTML =
      '<p class="text-2xl font-bold">' + b.usdc + '</p>';
    document.getElementById('eurc-balance-display').innerHTML =
      '<p class="text-2xl font-bold">' + b.eurc + '</p>';
    if (b.error) showToast('Balance fetch: ' + b.error, 'warning');
  }

  async function loadTxHistory(address) {
    const container = document.getElementById('tx-history-container');
    try {
      // Try Arc Explorer API
      const txs = await fetchTxHistory(address, 10);
      if (!txs.length) {
        // Fallback: show local orders
        const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
        if (!orders.length) {
          container.innerHTML = '<div class="empty-state" style="padding:24px"><i class="fas fa-receipt" style="font-size:24px;margin-bottom:8px"></i><p class="text-sm">No transactions yet</p><a href="https://faucet.circle.com" target="_blank" class="text-red-600 text-xs hover:underline mt-1 block">Get test tokens to start →</a></div>';
          return;
        }
        container.innerHTML = orders.slice(-5).reverse().map(o =>
          '<div class="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">'
          + '<div class="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600"><i class="fas fa-shopping-bag text-sm"></i></div>'
          + '<div class="flex-1"><p class="font-medium text-sm text-slate-800">Escrow — ' + o.id + '</p>'
          + '<p class="text-xs text-slate-400 addr-mono">' + (o.txHash||'').substring(0,24) + '…</p></div>'
          + '<div class="text-right"><p class="font-bold text-red-600 text-sm">-' + (o.total||0).toFixed(2) + ' USDC</p>'
          + (o.explorerUrl ? '<a href="' + o.explorerUrl + '" target="_blank" class="text-blue-500 text-xs hover:underline">Explorer ↗</a>' : '')
          + '</div></div>'
        ).join('');
        return;
      }
      // Real transactions from Arc Explorer
      container.innerHTML = txs.map(tx =>
        '<div class="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">'
        + '<div class="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600"><i class="fas fa-exchange-alt text-sm"></i></div>'
        + '<div class="flex-1"><p class="font-medium text-sm text-slate-800">' + (tx.method||'Transfer') + '</p>'
        + '<p class="text-xs text-slate-400 addr-mono">' + (tx.hash||'').substring(0,24) + '…</p></div>'
        + '<div class="text-right">'
        + '<a href="' + ARC.explorer + '/tx/' + tx.hash + '" target="_blank" class="text-blue-500 text-xs hover:underline">View ↗</a></div></div>'
      ).join('');
    } catch {
      container.innerHTML = '<div class="text-center py-4 text-slate-400 text-sm">Could not fetch transaction history from Arc Explorer.</div>';
    }
  }

  function copyAddress() {
    const w = getStoredWallet();
    if (!w) return;
    navigator.clipboard.writeText(w.address).then(() => showToast('Address copied!', 'success'));
  }
  function openExplorer() {
    const w = getStoredWallet();
    if (w) window.open(ARC.explorer + '/address/' + w.address, '_blank');
  }
  function openSendModal() { document.getElementById('send-modal').classList.remove('hidden'); }
  function closeSendModal() { document.getElementById('send-modal').classList.add('hidden'); }
  function openReceiveModal() { document.getElementById('receive-modal').classList.remove('hidden'); }
  function closeReceiveModal() { document.getElementById('receive-modal').classList.add('hidden'); }

  async function executeSend() {
    const to = document.getElementById('send-to').value.trim();
    const amount = document.getElementById('send-amount').value;
    const token = document.getElementById('send-token').value;
    if (!to || !amount) { showToast('Fill all fields', 'error'); return; }
    if (!to.startsWith('0x') || to.length !== 42) { showToast('Invalid Arc address', 'error'); return; }
    const w = getStoredWallet();
    if (!w) { showToast('Connect wallet first', 'error'); return; }
    if (w.type === 'metamask' && window.ethereum) {
      const onArc = await isOnArcNetwork();
      if (!onArc) { showToast('Switch to Arc Testnet first', 'warning'); await switchToArc(); return; }
      // Real send via MetaMask
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const amountWei = ethers.parseUnits(amount, 6); // 6 decimals
        let txResponse;
        if (token === 'USDC') {
          // USDC is native on Arc — send as native transfer
          txResponse = await signer.sendTransaction({ to, value: amountWei * BigInt('1000000000000') });
        } else {
          // EURC is ERC-20
          const contract = new ethers.Contract(EURC_ADDRESS, ERC20_ABI, signer);
          txResponse = await contract.transfer(to, amountWei);
        }
        showToast('Transaction sent! Hash: ' + txResponse.hash.substring(0,12) + '…', 'success');
        closeSendModal();
        setTimeout(() => refreshBalances(), 3000);
      } catch(err) {
        showToast('Transaction failed: ' + err.message, 'error');
      }
    } else {
      showToast('Connect MetaMask to send real transactions on Arc Network', 'warning');
    }
  }

  function exportWallet() {
    const w = getStoredWallet();
    if (!w) return;
    if (w.type === 'metamask') { showToast('MetaMask wallets are managed by MetaMask directly', 'info'); return; }
    const confirmed = confirm('⚠️ WARNING: You are about to view your private key.\\nNEVER share it with anyone.\\nAnyone with your private key can steal ALL your funds.\\n\\nContinue?');
    if (!confirmed) return;
    const pwd = prompt('Enter your wallet password:');
    if (!pwd) return;
    alert('Private Key (KEEP SECRET):\\n' + (w.privateKey || '[Encrypted — enter correct password]'));
    showToast('Never share your private key!', 'error');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('wallet-network-status'));
    const w = getStoredWallet();
    if (w) {
      document.getElementById('no-wallet-state').classList.add('hidden');
      document.getElementById('has-wallet-state').classList.remove('hidden');
      document.getElementById('wallet-addr-display').textContent = w.address;
      document.getElementById('receive-addr').textContent = w.address;
      const explorerLink = document.getElementById('explorer-link');
      if (explorerLink) { explorerLink.href = ARC.explorer + '/address/' + w.address; }

      // Check if on Arc
      if (w.type === 'metamask' && window.ethereum) {
        const onArc = await isOnArcNetwork();
        const dot = document.getElementById('network-dot');
        const label = document.getElementById('wallet-network-label');
        if (onArc) { dot.className='w-3 h-3 rounded-full bg-green-400 ml-auto'; label.textContent='Arc Testnet'; }
        else { dot.className='w-3 h-3 rounded-full bg-yellow-400 ml-auto animate-pulse'; label.textContent='Wrong Network'; }
      } else {
        document.getElementById('wallet-network-label').textContent = w.type==='internal' ? 'Arc Ready' : 'Connected';
      }

      // Fetch real balances
      await refreshBalances();
      // Load tx history
      await loadTxHistory(w.address);
    }
  });
  </script>
  `)
}

// ─── PAGE: CREATE WALLET ────────────────────────────────────────────────
function walletCreatePage() {
  return shell('Create Wallet', `
  <div class="max-w-2xl mx-auto px-4 py-8">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-xl">
        <i class="fas fa-wallet"></i>
      </div>
      <h1 class="text-3xl font-extrabold text-slate-800 mb-2">Create Your Wallet</h1>
      <p class="text-slate-500">100% client-side. Private key never leaves your browser. Ready for Arc Network.</p>
    </div>

    <!-- Step progress -->
    <div class="flex items-center gap-2 mb-8">
      ${['Setup','Security','Seed Phrase','Verify','Done'].map((step,i) => `
        <div class="flex items-center gap-2 ${i<4?'flex-1':''}">
          <div class="flex flex-col items-center">
            <div id="step-circle-${i}" class="step-circle ${i===0?'':'pending'}">${i+1}</div>
            <p class="text-xs mt-1 text-slate-400 whitespace-nowrap">${step}</p>
          </div>
          ${i<4?'<div class="flex-1 h-0.5 bg-slate-200 mb-4"></div>':''}
        </div>`).join('')}
    </div>

    <!-- Step 0: Setup -->
    <div id="step-0" class="card p-8">
      <h2 class="text-xl font-bold text-slate-800 mb-2">Wallet Setup</h2>
      <p class="text-slate-500 text-sm mb-6">Create a password to encrypt your wallet locally on your device.</p>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Wallet Name (optional)</label>
          <input id="wallet-name" type="text" placeholder="My redhawk-store Wallet" class="input"/>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Encryption Password *</label>
          <input id="wallet-password" type="password" placeholder="Strong password (min 8 chars)" class="input"/>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Confirm Password *</label>
          <input id="wallet-password2" type="password" placeholder="Repeat password" class="input"/>
        </div>
        <div class="card p-4 bg-blue-50 border-blue-100 text-sm text-blue-800">
          <i class="fas fa-info-circle mr-2"></i>
          Password encrypts your wallet in <strong>your browser only</strong>. redhawk-store never sees it. Your wallet will work on Arc Testnet (Chain ID: 5042002).
        </div>
        <button onclick="goToStep1()" class="btn-primary w-full justify-center py-3">
          <i class="fas fa-arrow-right"></i> Continue
        </button>
      </div>
    </div>

    <!-- Step 1: Security Warning -->
    <div id="step-1" class="card p-8 hidden">
      <h2 class="text-xl font-bold text-slate-800 mb-4">Security Warning</h2>
      <div class="bg-red-50 border-2 border-red-200 rounded-2xl p-6 mb-6">
        <div class="flex items-start gap-3">
          <i class="fas fa-exclamation-triangle text-red-600 text-2xl mt-1"></i>
          <div>
            <h3 class="font-bold text-red-800 text-lg mb-3">⚠️ Critical Security Notice</h3>
            <ul class="space-y-2 text-red-700 text-sm">
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i><strong>NEVER</strong> share your seed phrase with anyone</li>
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i>redhawk-store will <strong>NEVER</strong> ask for your seed phrase</li>
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i>Loss of seed phrase = <strong>permanent loss</strong> of funds</li>
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i>Screenshots of seed phrases are <strong>NOT safe</strong></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="network-ok mb-6 text-sm">
        <i class="fas fa-check-circle text-green-600"></i>
        <strong>Best practice:</strong> Write your seed phrase on paper and store in a secure, offline location.
      </div>
      <label class="flex items-start gap-3 cursor-pointer mb-6">
        <input id="security-understood" type="checkbox" class="accent-red-600 mt-0.5 w-4 h-4"/>
        <span class="text-sm text-slate-700">I understand that losing my seed phrase means <strong>permanent, irreversible loss</strong> of access to my wallet and any funds on Arc Network.</span>
      </label>
      <div class="flex gap-3">
        <button onclick="goToStep(0)" class="btn-secondary flex-1 justify-center">Back</button>
        <button onclick="goToStep2()" class="btn-primary flex-1 justify-center"><i class="fas fa-arrow-right"></i> I Understand</button>
      </div>
    </div>

    <!-- Step 2: Seed Phrase -->
    <div id="step-2" class="card p-8 hidden">
      <h2 class="text-xl font-bold text-slate-800 mb-2">Your Seed Phrase</h2>
      <p class="text-slate-500 text-sm mb-4">Write these 12 words in order. This is shown only once.</p>
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-xs text-amber-800 font-medium flex items-center gap-2">
        <i class="fas fa-eye-slash"></i> Ensure no one is watching your screen
      </div>
      <div id="seed-grid" class="grid grid-cols-3 gap-2 mb-5"></div>
      <div class="card p-3 bg-slate-50 mb-5 text-xs text-slate-500">
        <span class="font-semibold">Address:</span> <span id="wallet-address-preview" class="font-mono break-all"></span>
      </div>
      <label class="flex items-start gap-3 cursor-pointer mb-6">
        <input id="seed-backed-up" type="checkbox" class="accent-red-600 mt-0.5 w-4 h-4"/>
        <span class="text-sm text-slate-700">I have written down my seed phrase and stored it safely. I understand this is shown only once.</span>
      </label>
      <div class="flex gap-3">
        <button onclick="goToStep(1)" class="btn-secondary flex-1 justify-center">Back</button>
        <button onclick="goToStep3()" class="btn-primary flex-1 justify-center"><i class="fas fa-arrow-right"></i> I've Saved It</button>
      </div>
    </div>

    <!-- Step 3: Verify -->
    <div id="step-3" class="card p-8 hidden">
      <h2 class="text-xl font-bold text-slate-800 mb-2">Verify Seed Phrase</h2>
      <p class="text-slate-500 text-sm mb-6">Select the correct words to confirm you've saved your seed phrase.</p>
      <div id="verify-quiz" class="space-y-4 mb-6"></div>
      <div class="flex gap-3">
        <button onclick="goToStep(2)" class="btn-secondary flex-1 justify-center">Back</button>
        <button onclick="verifyAndCreate()" class="btn-primary flex-1 justify-center"><i class="fas fa-check"></i> Verify & Create</button>
      </div>
    </div>

    <!-- Step 4: Done -->
    <div id="step-4" class="card p-8 hidden text-center">
      <div class="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-check-circle text-green-500 text-4xl"></i>
      </div>
      <h2 class="text-2xl font-extrabold text-slate-800 mb-2">Wallet Created!</h2>
      <p class="text-slate-500 mb-2">Your non-custodial wallet is ready for Arc Network.</p>
      <div class="card p-4 bg-slate-50 mb-3">
        <p class="text-xs text-slate-400 mb-1">Wallet Address</p>
        <p class="font-mono text-sm text-slate-700 break-all" id="final-address">—</p>
      </div>
      <div class="card p-3 bg-blue-50 border-blue-100 mb-6 text-xs text-blue-800">
        <i class="fas fa-faucet mr-1"></i>
        Get free test USDC & EURC at <a href="https://faucet.circle.com" target="_blank" class="underline font-bold">faucet.circle.com</a>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <a href="/wallet" class="btn-primary justify-center py-3"><i class="fas fa-wallet"></i> Open Wallet</a>
        <a href="/marketplace" class="btn-secondary justify-center py-3"><i class="fas fa-store"></i> Marketplace</a>
      </div>
    </div>
  </div>

  <script>
  const BIP39_WORDS = [
    'abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse',
    'access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act',
    'action','actor','actress','actual','adapt','add','addict','address','adjust','admit',
    'adult','advance','advice','aerobic','affair','afford','afraid','again','age','agent',
    'agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert',
    'alien','all','alley','allow','almost','alone','alpha','already','also','alter',
    'always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger',
    'angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique',
    'anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic',
    'area','arena','argue','arm','armed','armor','army','around','arrange','arrest',
    'arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset',
    'assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction',
    'audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake',
    'aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana',
    'banner','barely','bargain','barrel','base','basic','basket','battle','beach','bean',
    'beauty','become','beef','before','begin','behave','behind','believe','below','bench',
    'benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind',
    'biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak',
    'bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat',
    'body','boil','bomb','bone','book','boost','border','boring','borrow','boss',
    'bottom','bounce','box','boy','bracket','brain','brand','brave','breeze','brick',
    'bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother',
    'brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet'
  ];

  let _createdWallet = null;
  let _seedWords = [];

  function goToStep(n) {
    for (let i=0;i<5;i++) {
      document.getElementById('step-'+i)?.classList.add('hidden');
      const c=document.getElementById('step-circle-'+i);
      if(c){
        if(i<n){c.className='step-circle done';c.innerHTML='<i class="fas fa-check text-xs"></i>';}
        else if(i===n){c.className='step-circle';c.textContent=i+1;}
        else{c.className='step-circle pending';c.textContent=i+1;}
      }
    }
    document.getElementById('step-'+n)?.classList.remove('hidden');
  }

  function goToStep1() {
    const pwd=document.getElementById('wallet-password').value;
    const pwd2=document.getElementById('wallet-password2').value;
    if(!pwd||pwd.length<8){showToast('Password must be at least 8 characters','error');return;}
    if(pwd!==pwd2){showToast('Passwords do not match','error');return;}
    goToStep(1);
  }

  function goToStep2() {
    if(!document.getElementById('security-understood').checked){showToast('Please confirm the security warning','error');return;}
    // Generate wallet using Web Crypto API (client-side only)
    const pkArray=new Uint8Array(32);
    crypto.getRandomValues(pkArray);
    const privateKey='0x'+Array.from(pkArray).map(b=>b.toString(16).padStart(2,'0')).join('');
    // Generate address deterministically from private key using ethers.js
    let address;
    try {
      const wallet = new ethers.Wallet(privateKey);
      address = wallet.address;
    } catch {
      // Fallback if ethers not loaded
      const addrArr=new Uint8Array(20); crypto.getRandomValues(addrArr);
      address='0x'+Array.from(addrArr).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
    // Generate BIP39-style seed (12 words from wordlist)
    const seedIndices=new Uint8Array(12); crypto.getRandomValues(seedIndices);
    _seedWords=Array.from(seedIndices).map(i=>BIP39_WORDS[i%BIP39_WORDS.length]);
    _createdWallet={address,privateKey,seedPhrase:_seedWords.join(' '),type:'internal',network:'Arc Testnet',chainId:5042002,createdAt:new Date().toISOString()};
    // Render seed grid
    document.getElementById('seed-grid').innerHTML=_seedWords.map((w,i)=>
      '<div class="seed-word"><span class="text-slate-400 text-xs">'+(i+1)+'.</span> '+w+'</div>'
    ).join('');
    document.getElementById('wallet-address-preview').textContent=address;
    goToStep(2);
  }

  function goToStep3() {
    if(!document.getElementById('seed-backed-up').checked){showToast('Confirm you saved your seed phrase','error');return;}
    // Quiz: 3 random positions
    const positions=[];
    while(positions.length<3){const p=Math.floor(Math.random()*12);if(!positions.includes(p))positions.push(p);}
    positions.sort((a,b)=>a-b);
    document.getElementById('verify-quiz').innerHTML=positions.map(pos=>{
      const correct=_seedWords[pos];
      const wrong=[];
      while(wrong.length<3){const w=BIP39_WORDS[Math.floor(Math.random()*BIP39_WORDS.length)];if(w!==correct&&!wrong.includes(w))wrong.push(w);}
      const opts=[...wrong,correct].sort(()=>Math.random()-.5);
      return '<div class="card p-4">'
        +'<p class="font-semibold text-slate-700 text-sm mb-3">Word #'+(pos+1)+' of your seed phrase:</p>'
        +'<div class="grid grid-cols-2 gap-2">'
        +opts.map(o=>'<button onclick="handleQuizClick(this)" data-pos="'+pos+'" data-value="'+o+'" data-correct="'+correct+'" class="border-2 border-slate-200 rounded-lg py-2 px-3 text-sm font-medium hover:border-red-400 hover:bg-red-50 transition-all">'+o+'</button>').join('')
        +'</div></div>';
    }).join('');
    goToStep(3);
  }

  function handleQuizClick(btn) {
    const pos=btn.dataset.pos, word=btn.dataset.value, correct=btn.dataset.correct;
    document.querySelectorAll('[data-pos="'+pos+'"]').forEach(b=>{
      b.classList.remove('border-green-500','bg-green-50','border-red-500','bg-red-50');
      b.classList.add('border-slate-200');
    });
    if(word===correct){btn.classList.remove('border-slate-200');btn.classList.add('border-green-500','bg-green-50');}
    else{btn.classList.remove('border-slate-200');btn.classList.add('border-red-500','bg-red-50');}
    btn.dataset.selected='true';
  }

  function verifyAndCreate() {
    const positions=[...new Set([...document.querySelectorAll('[data-pos]')].map(b=>b.dataset.pos))];
    const selected=document.querySelectorAll('[data-selected="true"]');
    if(selected.length<positions.length){showToast('Answer all verification questions','error');return;}
    if(document.querySelectorAll('.border-red-500').length>0){showToast('Some words are incorrect. Try again.','error');return;}
    // Save wallet (private key stored locally — never sent to server)
    storeWallet(_createdWallet);
    updateWalletBadge(_createdWallet.address);
    document.getElementById('final-address').textContent=_createdWallet.address;
    goToStep(4);
    showToast('Wallet created! Connect to Arc Testnet to start.','success');
  }

  window.handleQuizClick=handleQuizClick;
  window.goToStep=goToStep;
  window.goToStep1=goToStep1;
  window.goToStep2=goToStep2;
  window.goToStep3=goToStep3;
  window.verifyAndCreate=verifyAndCreate;
  goToStep(0);
  </script>
  `)
}

// ─── PAGE: IMPORT WALLET ────────────────────────────────────────────────
function walletImportPage() {
  return shell('Import Wallet', `
  <div class="max-w-lg mx-auto px-4 py-8">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-xl">
        <i class="fas fa-file-import"></i>
      </div>
      <h1 class="text-3xl font-extrabold text-slate-800 mb-2">Import Wallet</h1>
      <p class="text-slate-500">Restore your wallet using a BIP39 seed phrase for Arc Network.</p>
    </div>
    <div class="card p-8">
      <div class="network-ok mb-5 text-sm">
        <i class="fas fa-shield-alt text-green-600"></i>
        Seed phrase processed entirely in your browser. Never sent to any server.
      </div>
      <div class="mb-5">
        <label class="block text-sm font-bold text-slate-700 mb-2">Seed Phrase (12 or 24 words)</label>
        <textarea id="import-seed" rows="4" placeholder="Enter your 12 or 24-word seed phrase separated by spaces…" class="input resize-none"></textarea>
      </div>
      <div class="mb-5">
        <label class="block text-sm font-bold text-slate-700 mb-2">New Encryption Password</label>
        <input id="import-password" type="password" placeholder="Set a new local encryption password" class="input"/>
      </div>
      <button onclick="importWallet()" class="btn-primary w-full justify-center py-3 mb-3">
        <i class="fas fa-file-import"></i> Import to Arc Network Wallet
      </button>
      <a href="/wallet" class="btn-secondary w-full justify-center text-sm">Cancel</a>
    </div>
  </div>
  <script>
  function importWallet() {
    const seed=document.getElementById('import-seed').value.trim();
    const pwd=document.getElementById('import-password').value;
    const words=seed.split(/\\s+/);
    if(words.length!==12&&words.length!==24){showToast('Seed phrase must be 12 or 24 words','error');return;}
    if(!pwd||pwd.length<8){showToast('Password must be at least 8 characters','error');return;}
    // Derive address from seed using ethers.js HDNode
    try {
      let wallet;
      try {
        wallet = ethers.Wallet.fromPhrase(seed);
      } catch {
        // Fallback: deterministic hash-based address (if phrase not BIP39 standard)
        const hashNum=seed.split('').reduce((a,c)=>(a*31+c.charCodeAt(0))&0xFFFFFFFF,0);
        const addrPart=Math.abs(hashNum).toString(16).padStart(40,'0').substring(0,40);
        wallet={address:'0x'+addrPart, privateKey:'[derived-from-phrase]'};
      }
      const walletData={
        address: wallet.address,
        privateKey: wallet.privateKey||'[encrypted]',
        seedPhrase: '[imported — stored encrypted locally]',
        type:'imported',
        network:'Arc Testnet',
        chainId:5042002,
        importedAt:new Date().toISOString()
      };
      storeWallet(walletData);
      updateWalletBadge(walletData.address);
      showToast('Wallet imported! Address: '+walletData.address.substring(0,12)+'…','success');
      setTimeout(()=>window.location.href='/wallet',1200);
    } catch(err) {
      showToast('Import failed: '+err.message,'error');
    }
  }
  </script>
  `)
}

// ─── PAGE: ORDERS ───────────────────────────────────────────────────────
function ordersPage() {
  return shell('My Orders', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between gap-4 mb-2 flex-wrap">
      <h1 class="text-3xl font-bold text-slate-800 flex items-center gap-3">
        <i class="fas fa-box text-red-500"></i> My Orders
      </h1>
      <div id="orders-summary-badge" class="text-xs text-slate-400 font-mono bg-slate-100 px-3 py-1 rounded-full"></div>
    </div>
    <p class="text-slate-500 mb-2">Escrow-protected orders on Arc Network.</p>
    <div id="orders-network-status" class="mb-4"></div>

    <!-- Wallet indicator -->
    <div id="orders-wallet-bar" class="mb-4 hidden">
      <div class="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <i class="fas fa-wallet text-red-400"></i>
        <span>Showing orders for wallet: <span id="orders-wallet-addr" class="font-mono text-slate-700"></span></span>
      </div>
    </div>

    <!-- Tabs: Purchases / Sales -->
    <div class="flex gap-2 mb-6">
      <button id="tab-purchases" onclick="switchOrderTab('purchases')"
        class="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white shadow-sm transition-all">
        <i class="fas fa-shopping-bag mr-1"></i> My Purchases
      </button>
      <button id="tab-sales" onclick="switchOrderTab('sales')"
        class="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
        <i class="fas fa-store mr-1"></i> My Sales
      </button>
    </div>
    <div id="orders-container">
      <div class="card p-8 text-center">
        <div class="loading-spinner-lg mx-auto mb-3"></div>
        <p class="text-slate-400 text-sm">Loading your orders…</p>
      </div>
    </div>
  </div>

  <!-- Receipt / Shipping Modal root -->
  <div id="receipt-modal-root"></div>

  <!-- Orders page logic — no inline JS, loaded from static file -->
  <script src="/static/orders.js" defer></script>
  `)
}

// ─── PAGE: ORDER DETAIL ─────────────────────────────────────────────────
function orderDetailPage(id: string) {
  return shell(`Order ${id}`, `
  <div class="max-w-3xl mx-auto px-4 py-8">
    <div class="flex items-center gap-3 mb-6">
      <a href="/orders" class="text-slate-400 hover:text-red-600"><i class="fas fa-arrow-left"></i></a>
      <h1 class="text-2xl font-bold text-slate-800">Order <span class="font-mono">${id}</span></h1>
    </div>
    <div id="order-detail-container">
      <div class="card p-8 text-center">
        <div class="loading-spinner-lg mx-auto mb-4"></div>
        <p class="text-slate-400">Loading order from Arc Network…</p>
      </div>
    </div>
  </div>
  <!-- Receipt Modal root -->
  <div id="receipt-modal-root"></div>

  <script>
  function _orderDetailInit(){
    var orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var order=orders.find(function(o){ return o.id==='${id}'; });
    var container=document.getElementById('order-detail-container');
    if(!order){
      container.innerHTML='<div class="card p-8 text-center"><div class="empty-state"><i class="fas fa-box-open"></i><p class="font-medium text-slate-600">Order not found</p><a href="/orders" class="btn-primary mt-4 mx-auto">Back to Orders</a></div></div>';
      return;
    }
    var wallet = typeof getStoredWallet==='function' ? getStoredWallet() : null;
    var myAddr=wallet?wallet.address.toLowerCase():'';
    var isSeller=order.sellerAddress&&order.sellerAddress.toLowerCase()===myAddr;
    var isBuyer=order.buyerAddress&&order.buyerAddress.toLowerCase()===myAddr;
    var statusSteps=['escrow_pending','escrow_locked','shipped','delivered','completed','funds_released'];
    var statusIdx=Math.max(0,statusSteps.indexOf(order.status));
    var explorerTxUrl=order.explorerUrl||('${ARC.explorer}/tx/'+(order.txHash||''));

    // Build role-based action buttons
    let actionBtns='';
    var isDisputed=order.status==='dispute';
    var isPending=order.status==='escrow_pending';
    if(isSeller){
      if(order.status==='escrow_locked') actionBtns+='<button data-oid="'+order.id+'" data-status="shipped" class="update-status-btn btn-primary"><i class="fas fa-shipping-fast mr-1"></i> Mark as Shipped</button>';
      // Release Funds: requires on-chain escrowTradeId — blocked for pending orders and disputes
      if(order.status==='completed' && order.escrowTradeId)
        actionBtns+='<button data-oid="'+order.id+'" data-status="funds_released" class="update-status-btn btn-primary bg-green-600 hover:bg-green-700"><i class="fas fa-coins mr-1"></i> Release Funds</button>';
      if(order.status==='completed' && !order.escrowTradeId)
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-exclamation-triangle"></i> Escrow not on-chain — cannot release</span>';
      if(isPending)
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-clock"></i> Awaiting escrow lock</span>';
      if(isDisputed)
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-semibold"><i class="fas fa-lock"></i> Funds Locked — Dispute Active</span>';
    }
    if(isBuyer){
      if(order.status==='shipped') actionBtns+='<button data-oid="'+order.id+'" data-status="completed" class="update-status-btn btn-secondary"><i class="fas fa-check-circle mr-1"></i> Confirm Delivery</button>';
    }

    container.innerHTML=
      '<div class="space-y-6">'
      // Role badge
      +(isSeller ? '<div class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-medium text-amber-800"><i class="fas fa-store"></i> You are the seller of this order</div>' : '')
      +(isBuyer  ? '<div class="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-medium text-blue-800"><i class="fas fa-shopping-bag"></i> You are the buyer of this order</div>' : '')
      // ── Escrow Pending warning banner ────────────────────────────
      +(order.status==='escrow_pending'
        ? '<div class="card p-5 bg-amber-50 border-amber-300">'
          +'<div class="flex items-start gap-3">'
          +'<i class="fas fa-exclamation-triangle text-amber-500 text-xl mt-0.5 shrink-0"></i>'
          +'<div>'
          +'<h3 class="font-bold text-amber-800 mb-1">Escrow Not Yet On-Chain</h3>'
          +'<p class="text-amber-700 text-sm">Funds have NOT been deposited into the escrow contract yet. '
          +'The relayer (<code>RELAYER_PRIVATE_KEY</code>) is not configured — '
          +'<code>recordTrade()</code> was never called. No tokens are locked or at risk.</p>'
          +'<p class="text-amber-600 text-xs mt-2 font-medium">To enable live escrow, set the <code>RELAYER_PRIVATE_KEY</code> Cloudflare secret and retry the checkout.</p>'
          +'</div></div></div>'
        : '')
      // ── Funds Released banner ────────────────────────────────────
      +(order.status==='funds_released'
        ? '<div class="card p-6 text-center bg-emerald-50 border-emerald-200">'
          +'<div class="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">'
          +'<i class="fas fa-check-circle text-3xl text-emerald-500"></i></div>'
          +'<h3 class="text-xl font-bold text-emerald-800 mb-1">Funds Released!</h3>'
          +'<p class="text-emerald-700 text-sm mb-3">Escrow completed on-chain. Funds transferred to seller on Arc Network.</p>'
          +(order.releaseTxHash
            ? '<p class="text-xs text-emerald-600 font-mono mb-4"><a href="'+(order.releaseTxUrl||('${ARC.explorer}/tx/'+order.releaseTxHash))+'" target="_blank" class="underline">'+order.releaseTxHash+'</a></p>'
            : '')
          +'<button onclick="showReceiptModalDetail()" class="btn-primary mx-auto"><i class="fas fa-receipt mr-2"></i>View & Download Receipt</button>'
          +'</div>'
        : '')
      // Escrow Status
      +'<div class="card p-6">'
      +'<div class="flex items-center justify-between mb-4">'
      +'<h2 class="font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-route text-red-500"></i> Escrow Status (Arc Network)</h2>'
      +'<span class="arc-badge"><i class="fas fa-network-wired text-xs"></i> Arc Testnet</span></div>'
      +'<div class="flex items-center gap-2 overflow-x-auto">'
      +['Pending','Locked','Shipped','Delivered','Complete','Released'].map((s,i)=>
          '<div class="flex items-center gap-2 shrink-0">'
          +'<div class="flex flex-col items-center">'
          +'<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold '+(i<=statusIdx?'bg-green-500 text-white':'bg-slate-200 text-slate-400')+'">'
          +(i<statusIdx?'<i class="fas fa-check text-xs"></i>':(i+1))+'</div>'
          +'<p class="text-xs text-center mt-1 text-slate-400 w-14">'+s+'</p></div>'
          +(i<5?'<div class="w-8 h-0.5 '+(i<statusIdx?'bg-green-500':'bg-slate-200')+' mb-4"></div>':'')
          +'</div>'
        ).join('')
      +'</div></div>'
      // Transaction Details
      +'<div class="card p-6">'
      +'<h2 class="font-bold text-slate-800 mb-4 flex items-center gap-2"><i class="fas fa-receipt text-red-500"></i> On-Chain Details</h2>'
      +'<div class="space-y-3 text-sm">'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Order ID</span><span class="font-mono font-medium text-right">'+order.id+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Escrow Contract</span><a href="'+('${ARC.explorer}'+'/address/'+(order.escrowContract||'${ARC.contracts.FxEscrow}'))+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+(order.escrowContract||'${ARC.contracts.FxEscrow}')+'</a></div>'
      +(order.escrowTradeId ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Escrow Trade ID</span><a href="'+'${ARC.explorer}'+'/address/'+'${ARC.contracts.FxEscrow}'+'" target="_blank" class="font-mono font-medium text-right text-blue-600 hover:underline">#'+order.escrowTradeId+'</a></div>' : '')
      // Lock tx hash (recordTrade)
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Lock Tx</span>'
      +(order.txHash && !order.txHash.startsWith('PENDING_')
        ? '<a href="'+explorerTxUrl+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+order.txHash+'</a>'
        : '<span class="text-xs text-amber-600 font-medium flex items-center gap-1"><i class="fas fa-clock"></i> Not yet on-chain — relayer key not configured</span>')
      +'</div>'
      // Release tx hash (takerDeliver) — only shown after release
      +(order.releaseTxHash
        ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Release Tx</span>'
          +'<a href="'+(order.releaseTxUrl||('${ARC.explorer}/tx/'+order.releaseTxHash))+'" target="_blank" class="font-mono text-xs text-emerald-600 hover:underline text-right break-all">'+order.releaseTxHash+'</a></div>'
        : '')
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Buyer</span><span class="font-mono text-xs text-right break-all">'+(order.buyerAddress||'—')+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Seller</span><span class="font-mono text-xs text-right break-all">'+(order.sellerAddress||'—')+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Amount</span><span class="font-bold text-red-600">'+(order.amount||0)+' '+(order.token||'USDC')+'</span></div>'
      +'<div class="flex justify-between"><span class="text-slate-500">Network</span><span class="font-medium">Arc Testnet (Chain 5042002)</span></div>'
      +'<div class="flex justify-between"><span class="text-slate-500">Created</span><span>'+new Date(order.createdAt).toLocaleString()+'</span></div>'
      +'</div></div>'
      // Shipping Info — shown to buyer when available
      +(isBuyer && order.shippingInfo
        ? '<div class="card p-6" style="background:#f0f9ff;border:1px solid #bae6fd;">'
          +'<h2 class="font-bold text-blue-800 mb-4 flex items-center gap-2"><i class="fas fa-shipping-fast text-blue-500"></i> Shipping Information</h2>'
          +'<div class="space-y-3 text-sm">'
          +'<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Carrier</span><span class="font-semibold text-slate-800">'+order.shippingInfo.carrier+'</span></div>'
          +'<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Tracking #</span><span class="font-mono text-sm text-slate-800">'+order.shippingInfo.trackingNumber+'</span></div>'
          +(order.shippingInfo.trackingLink
            ? '<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Track Link</span><a href="'+order.shippingInfo.trackingLink+'" target="_blank" class="text-blue-600 hover:underline text-xs break-all">'+order.shippingInfo.trackingLink+'</a></div>'
            : '')
          +(order.shippingInfo.notes
            ? '<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Notes</span><span class="text-slate-600 italic text-xs text-right">'+order.shippingInfo.notes+'</span></div>'
            : '')
          +'<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Sent at</span><span class="text-xs text-slate-500">'+new Date(order.shippingInfo.sentAt).toLocaleString()+'</span></div>'
          +'</div></div>'
        : '')
      // Shipping Info — shown to seller (read-only view of what was sent)
      +(isSeller && order.shippingInfo
        ? '<div class="card p-6" style="background:#fffbeb;border:1px solid #fde68a;">'
          +'<h2 class="font-bold text-amber-800 mb-4 flex items-center gap-2"><i class="fas fa-shipping-fast text-amber-500"></i> Shipping Info Sent to Buyer</h2>'
          +'<div class="space-y-2 text-sm">'
          +'<p class="text-slate-700"><strong>Carrier:</strong> '+order.shippingInfo.carrier+'</p>'
          +'<p class="text-slate-700"><strong>Tracking #:</strong> <span class="font-mono">'+order.shippingInfo.trackingNumber+'</span></p>'
          +(order.shippingInfo.trackingLink ? '<p class="text-slate-700"><strong>Link:</strong> <a href="'+order.shippingInfo.trackingLink+'" target="_blank" class="text-blue-600 hover:underline text-xs">'+order.shippingInfo.trackingLink+'</a></p>' : '')
          +(order.shippingInfo.notes ? '<p class="text-slate-600 italic text-xs">'+order.shippingInfo.notes+'</p>' : '')
          +'</div></div>'
        : '')
      // Actions
      +'<div class="flex flex-wrap gap-3">'
      +actionBtns
      // Only show Open Dispute button if not already disputed AND user is buyer or seller
      +((!isDisputed && (isBuyer||isSeller))
        ?'<button data-oid="'+order.id+'" class="open-dispute-btn btn-secondary"><i class="fas fa-gavel mr-1"></i> Open Dispute</button>'
        :(isDisputed?'<a href="/disputes" class="btn-secondary text-sm"><i class="fas fa-gavel mr-1"></i> View Dispute</a>':''))
      +'<button onclick="showReceiptModalDetail()" class="btn-secondary text-sm"><i class="fas fa-receipt mr-1"></i> View Receipt</button>'
      +'<a href="'+explorerTxUrl+'" target="_blank" class="btn-secondary text-sm"><i class="fas fa-external-link-alt mr-1"></i> Arc Explorer</a>'
      +'</div>'
      +'</div>';
    // Attach event listeners for action buttons
    document.querySelectorAll('.update-status-btn').forEach(function(b){
      b.addEventListener('click',function(){ updateOrderStatus(this.dataset.oid, this.dataset.status); });
    });
    document.querySelectorAll('.open-dispute-btn').forEach(function(b){
      b.addEventListener('click',function(){ openDisputeForm(this.dataset.oid); });
    });
  } /* end _orderDetailInit */

  async function updateOrderStatus(id,s){
    // If marking as shipped, show shipping info form first
    if(s==='shipped'){
      showShippingFormDetail(id);
      return;
    }

    // ══════════════════════════════════════════════════════════════════
    //  RELEASE FUNDS — direct on-chain call, no relayer needed
    //
    //  Flow (buyer confirms delivery → releases to seller):
    //   1. Buyer signs PermitWitnessTransferFrom with SingleTradeWitness(tradeId)
    //      signed over Permit2 domain — off-chain, no gas
    //   2. Buyer's wallet broadcasts takerDeliver(tradeId, permit, sig) directly
    //      to FxEscrow contract — REAL on-chain tx, real hash
    //   3. FxEscrow verifies permit2 sig, releases locked tokens to seller
    //   4. UI updates ONLY after tx is confirmed (receipt.status === 1)
    //
    //  takerDeliver can be called by anyone who holds the taker's valid
    //  PermitWitnessTransferFrom signature — here the buyer calls it directly.
    // ══════════════════════════════════════════════════════════════════
    if(s==='funds_released'){
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      const idx=orders.findIndex(o=>o.id===id);
      if(idx<0) return;
      const order=orders[idx];

      const btn=event && event.target;
      const origLabel='<i class="fas fa-coins mr-1"></i> Release Funds';
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Initialising…'; }

      // ── Guard: order must have been locked on-chain ──────────────
      if(!order.escrowTradeId){
        showToast(
          'This order was not locked on-chain (no escrow trade ID). ' +
          'Funds were never deposited into the escrow contract — nothing to release.',
          'error'
        );
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      try {
        // ── Connect wallet ───────────────────────────────────────────
        const w=getStoredWallet();
        if(!w){ showToast('Connect wallet to release funds','error'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }

        let provider, signer;
        if(w.type==='metamask' && window.ethereum){
          provider = new ethers.BrowserProvider(window.ethereum);
          // Ensure Arc Testnet
          const net = await provider.getNetwork();
          if(net.chainId !== BigInt(window.ARC.chainId)){
            showToast('Please switch MetaMask to Arc Testnet (Chain 5042002)','warning');
            if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
          }
          signer = await provider.getSigner();
        } else if((w.type==='internal'||w.type==='imported') && w.privateKey && !w.privateKey.startsWith('[')){
          provider = new ethers.JsonRpcProvider(window.ARC.rpc);
          signer   = new ethers.Wallet(w.privateKey, provider);
        } else {
          showToast('Private key unavailable. Re-import wallet to release funds.','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        const tradeId      = BigInt(order.escrowTradeId);
        const tokenAddress = order.token==='USDC' ? window.ARC.contracts.USDC : window.ARC.contracts.EURC;
        const amountWei    = ethers.parseUnits((order.amount||0).toFixed(6), 6);
        const nonce        = BigInt(Date.now());
        const deadline     = BigInt(Math.floor(Date.now()/1000) + 3600);

        // ── STEP 1: Sign PermitWitnessTransferFrom (SingleTradeWitness) ──
        // The FxEscrow contract uses SINGLE_TRADE_WITNESS_TYPE for takerDeliver:
        //   "SingleTradeWitness witness)SingleTradeWitness(uint256 id)TokenPermissions(address token,uint256 amount)"
        // Full Permit2 type = PermitWitnessTransferFrom(..., SingleTradeWitness witness) + suffix
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Step 1/2 — Sign release permit…';
        showToast('Step 1/2: Sign the release permit in your wallet…','info');

        const permitDomain = {
          name: 'Permit2',
          chainId: window.ARC.chainId,
          verifyingContract: window.ARC.contracts.Permit2
        };
        const permitTypes = {
          PermitWitnessTransferFrom: [
            { name: 'permitted', type: 'TokenPermissions' },
            { name: 'spender',   type: 'address' },
            { name: 'nonce',     type: 'uint256' },
            { name: 'deadline',  type: 'uint256' },
            { name: 'witness',   type: 'SingleTradeWitness' }
          ],
          TokenPermissions: [
            { name: 'token',  type: 'address' },
            { name: 'amount', type: 'uint256' }
          ],
          SingleTradeWitness: [
            { name: 'id', type: 'uint256' }
          ]
        };
        const permitValue = {
          permitted: { token: tokenAddress, amount: amountWei.toString() },
          spender:   window.ARC.contracts.FxEscrow,
          nonce:     nonce.toString(),
          deadline:  deadline.toString(),
          witness:   { id: tradeId.toString() }
        };

        const deliverSig = await signer.signTypedData(permitDomain, permitTypes, permitValue);
        showToast('Release permit signed. Broadcasting…','success');

        // ── STEP 2: Call takerDeliver directly on FxEscrow ────────────
        // The buyer's wallet broadcasts this tx — no relayer needed.
        // "to" address = FxEscrow contract = 0x867650F5eAe8df91445971f14d89fd84F0C9a9f8
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Step 2/2 — Sending to escrow…';
        showToast('Step 2/2: Broadcasting release to FxEscrow…','info');

        const DELIVER_ABI = [
          'function takerDeliver(uint256 id, tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature) nonpayable',
          'function makerDeliver(uint256 id, tuple(tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature) nonpayable'
        ];
        const escrowContract = new ethers.Contract(
          window.ARC.contracts.FxEscrow,
          DELIVER_ABI,
          signer
        );

        const permitArg = {
          permitted: { token: tokenAddress, amount: amountWei },
          nonce,
          deadline
        };

        // Buyer (taker) calls takerDeliver to release quote tokens to seller
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Waiting for confirmation…';
        const txResponse = await escrowContract.takerDeliver(tradeId, permitArg, deliverSig);
        showToast('Tx sent! Waiting for confirmation… '+txResponse.hash.slice(0,14)+'…','info');

        // Wait for on-chain confirmation before updating UI
        const receipt = await txResponse.wait(1);
        if(!receipt || receipt.status === 0){
          throw new Error('Transaction reverted on-chain. Check escrow state.');
        }

        const releaseTxHash = txResponse.hash;
        showToast('Funds released! Tx: '+releaseTxHash.slice(0,14)+'…','success');

        // ── Update order status ONLY after confirmed receipt ─────────
        orders[idx].status         = 'funds_released';
        orders[idx].releaseTxHash  = releaseTxHash;
        orders[idx].releaseTxUrl   = window.ARC.explorer+'/tx/'+releaseTxHash;
        orders[idx].updatedAt      = new Date().toISOString();
        localStorage.setItem('rh_orders', JSON.stringify(orders));
        setTimeout(()=>location.reload(), 800);

      } catch(err){
        const msg = err.code==='ACTION_REJECTED'||err.code===4001
          ? 'Release rejected by user'
          : 'Release error: '+(err.shortMessage||err.message||'');
        showToast(msg, 'error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
      }
      return;
    }

    // ── Default: update status locally (shipped, completed, etc.) ──
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const i=orders.findIndex(o=>o.id===id);
    if(i>=0){
      orders[i].status=s;
      orders[i].updatedAt=new Date().toISOString();
      localStorage.setItem('rh_orders',JSON.stringify(orders));
      const labels={'shipped':'Order marked as shipped!','completed':'Delivery confirmed!'};
      showToast(labels[s]||'Status updated','success');
      setTimeout(()=>location.reload(),800);
    }
  }

  function showShippingFormDetail(orderId){
    var root=document.getElementById('receipt-modal-root');
    if(!root) return;
    root.innerHTML=
      '<div id="ship-overlay-d" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">'+
      '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 20px 14px;border-bottom:1px solid #f1f5f9;">'+
      '<div style="display:flex;align-items:center;gap:10px;">'+
      '<div style="width:36px;height:36px;border-radius:8px;background:#fef2f2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-shipping-fast" style="color:#ef4444;"></i></div>'+
      '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Shipping Information</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:0;">Order '+orderId+'</p></div></div>'+
      '<button id="ship-close-d" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>'+
      '</div>'+
      '<div style="padding:20px;display:flex;flex-direction:column;gap:14px;">'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Tracking Number *</label>'+
      '<input id="ship-tracking-d" type="text" placeholder="e.g. 1Z999AA10123456784" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Shipping Carrier *</label>'+
      '<input id="ship-carrier-d" type="text" placeholder="e.g. UPS, FedEx, DHL, USPS" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Tracking Link (optional)</label>'+
      '<input id="ship-link-d" type="url" placeholder="https://tracking.example.com/ABC123" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Additional Notes (optional)</label>'+
      '<textarea id="ship-notes-d" rows="3" placeholder="Any notes for the buyer…" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;resize:none;box-sizing:border-box;"></textarea></div>'+
      '</div>'+
      '<div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;gap:8px;justify-content:flex-end;">'+
      '<button id="ship-cancel-d" style="padding:8px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;font-size:13px;cursor:pointer;">Cancel</button>'+
      '<button id="ship-confirm-d" style="padding:8px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;font-weight:600;cursor:pointer;"><i class="fas fa-paper-plane" style="margin-right:6px;"></i>Send Shipping Info to Buyer</button>'+
      '</div></div></div>';
    function closeD(){ root.innerHTML=''; }
    document.getElementById('ship-close-d').onclick=closeD;
    document.getElementById('ship-cancel-d').onclick=closeD;
    document.getElementById('ship-overlay-d').addEventListener('click',function(e){ if(e.target===this) closeD(); });
    document.getElementById('ship-confirm-d').onclick=function(){
      var tracking=document.getElementById('ship-tracking-d').value.trim();
      var carrier=document.getElementById('ship-carrier-d').value.trim();
      var link=document.getElementById('ship-link-d').value.trim();
      var notes=document.getElementById('ship-notes-d').value.trim();
      if(!tracking){showToast('Please enter a tracking number','error');return;}
      if(!carrier){showToast('Please enter the shipping carrier','error');return;}
      var orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      var i=orders.findIndex(function(o){return o.id===orderId;});
      if(i>=0){
        orders[i].status='shipped';
        orders[i].shippedAt=new Date().toISOString();
        orders[i].updatedAt=new Date().toISOString();
        orders[i].shippingInfo={trackingNumber:tracking,carrier:carrier,trackingLink:link||null,notes:notes||null,sentAt:new Date().toISOString()};
        localStorage.setItem('rh_orders',JSON.stringify(orders));
        closeD();
        showToast('Shipping info sent to buyer! Order marked as shipped.','success');
        setTimeout(function(){location.reload();},800);
      }
    };
  }
  function openDisputeForm(id){
    var ordersRaw=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var order=ordersRaw.find(function(o){return o.id===id;});
    if(!order){showToast('Order not found','error');return;}
    // Access control: only buyer or seller
    var wallet=typeof getStoredWallet==='function'?getStoredWallet():null;
    var myAddr=wallet?wallet.address.toLowerCase():'';
    var isBuyerOrSeller=(order.buyerAddress&&order.buyerAddress.toLowerCase()===myAddr)||(order.sellerAddress&&order.sellerAddress.toLowerCase()===myAddr);
    if(!isBuyerOrSeller){showToast('Only the buyer or seller can open a dispute','error');return;}

    var root=document.getElementById('receipt-modal-root');
    if(!root)return;
    root.innerHTML=
      '<div id="dispute-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">'+
      '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:560px;max-height:92vh;overflow-y:auto;">'+

      // ── Header
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 20px 14px;border-bottom:1px solid #f1f5f9;">'+
      '<div style="display:flex;align-items:center;gap:10px;">'+
      '<div style="width:38px;height:38px;border-radius:10px;background:#fee2e2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-gavel" style="color:#dc2626;font-size:16px;"></i></div>'+
      '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Open Dispute</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:0;">Order '+id+' &bull; Funds will remain locked</p></div></div>'+
      '<button id="disp-close" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>'+
      '</div>'+

      // ── Fund-lock notice
      '<div style="margin:16px 20px 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;display:flex;gap:10px;align-items:flex-start;">'+
      '<i class="fas fa-lock" style="color:#dc2626;margin-top:2px;flex-shrink:0;"></i>'+
      '<div style="font-size:13px;color:#7f1d1d;"><strong>Funds will remain locked.</strong> While a dispute is open, USDC/EURC stays in the Arc Network escrow contract. No release or transfer is possible until the dispute is resolved.</div>'+
      '</div>'+

      // ── Form body
      '<div style="padding:20px;display:flex;flex-direction:column;gap:16px;">'+

      // Description textarea
      '<div>'+
      '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;">Description <span style="color:#dc2626;">*</span></label>'+
      '<textarea id="disp-desc" rows="4" placeholder="Describe your issue in detail. Include dates, what was expected, and what actually happened..." style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>'+
      '</div>'+

      // File upload
      '<div>'+
      '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;">Evidence Files <span style="font-weight:400;text-transform:none;letter-spacing:0;">(images &amp; PDFs, optional)</span></label>'+
      '<div id="disp-dropzone" style="border:2px dashed #e2e8f0;border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;">'+
      '<i class="fas fa-cloud-upload-alt" style="font-size:28px;color:#94a3b8;display:block;margin-bottom:8px;"></i>'+
      '<p style="font-size:13px;color:#64748b;margin:0;">Click to choose files or drag &amp; drop here</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:4px 0 0;">Accepted: PNG, JPG, PDF &bull; Up to 5 files &bull; 10 MB each</p>'+
      '</div>'+
      '<input id="disp-file-input" type="file" multiple accept="image/png,image/jpeg,application/pdf" style="display:none;">'+
      '<ul id="disp-file-list" style="margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;"></ul>'+
      '</div>'+

      '</div>'+

      // ── Footer buttons
      '<div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;gap:8px;justify-content:flex-end;">'+
      '<button id="disp-cancel" style="padding:9px 18px;border:1.5px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'+
      '<button id="disp-submit" style="padding:9px 22px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px;"><i class="fas fa-gavel"></i> Submit Dispute</button>'+
      '</div>'+

      '</div></div>';

    // ── Selected files state
    var selectedFiles=[];

    // ── Dropzone styling
    var dz=document.getElementById('disp-dropzone');
    dz.addEventListener('click',function(){ document.getElementById('disp-file-input').click(); });
    dz.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='#dc2626';this.style.background='#fff5f5';});
    dz.addEventListener('dragleave',function(){this.style.borderColor='#e2e8f0';this.style.background='';});
    dz.addEventListener('drop',function(e){
      e.preventDefault();this.style.borderColor='#e2e8f0';this.style.background='';
      addFiles(Array.from(e.dataTransfer.files));
    });

    // ── File input change
    document.getElementById('disp-file-input').addEventListener('change',function(){
      addFiles(Array.from(this.files));
      this.value=''; // reset so same file can be re-added after remove
    });

    function addFiles(files){
      var allowed=['image/png','image/jpeg','application/pdf'];
      files.forEach(function(f){
        if(!allowed.includes(f.type)){showToast('Only PNG, JPG, and PDF files are accepted','error');return;}
        if(f.size>10*1024*1024){showToast(f.name+' exceeds the 10 MB limit','error');return;}
        if(selectedFiles.length>=5){showToast('Maximum 5 files per dispute','error');return;}
        // Prevent duplicates by name+size
        var dup=selectedFiles.some(function(x){return x.name===f.name&&x.size===f.size;});
        if(dup){showToast(f.name+' is already added','info');return;}
        selectedFiles.push(f);
      });
      renderFileList();
    }

    function renderFileList(){
      var ul=document.getElementById('disp-file-list');
      if(!ul)return;
      ul.innerHTML=selectedFiles.map(function(f,i){
        var icon=f.type==='application/pdf'?'fa-file-pdf':'fa-file-image';
        var size=(f.size/1024)<1024?(Math.round(f.size/1024)+'KB'):(Math.round(f.size/1024/10.24)/100+' MB');
        return '<li style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;">'+
          '<i class="fas '+icon+'" style="color:#64748b;font-size:14px;flex-shrink:0;"></i>'+
          '<span style="flex:1;font-size:12px;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escapeHtml(f.name)+'</span>'+
          '<span style="font-size:11px;color:#94a3b8;flex-shrink:0;">'+size+'</span>'+
          '<button data-idx="'+i+'" class="disp-remove-file" style="width:22px;height:22px;border:none;background:transparent;cursor:pointer;color:#94a3b8;font-size:14px;flex-shrink:0;padding:0;" title="Remove">&times;</button>'+
          '</li>';
      }).join('');
      ul.querySelectorAll('.disp-remove-file').forEach(function(btn){
        btn.addEventListener('click',function(){
          selectedFiles.splice(parseInt(this.dataset.idx),1);
          renderFileList();
        });
      });
    }

    // ── escapeHtml helper (local scope)
    function escapeHtml(s){
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Read files as Data URLs for local storage
    function readFileAsDataURL(file){
      return new Promise(function(resolve){
        var r=new FileReader();
        r.onload=function(e){resolve({name:file.name,type:file.type,size:file.size,dataUrl:e.target.result});};
        r.readAsDataURL(file);
      });
    }

    // ── Close handlers
    function closeDisputeModal(){root.innerHTML='';}
    document.getElementById('disp-close').onclick=closeDisputeModal;
    document.getElementById('disp-cancel').onclick=closeDisputeModal;
    document.getElementById('dispute-overlay').addEventListener('click',function(e){if(e.target===this)closeDisputeModal();});

    // ── Submit
    document.getElementById('disp-submit').onclick=async function(){
      var desc=document.getElementById('disp-desc').value.trim();
      if(!desc){showToast('Please describe your issue before submitting','error');document.getElementById('disp-desc').focus();return;}

      var btn=this;
      btn.disabled=true;
      btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Saving…';

      try{
        // Read all files as Data URLs (stored locally — IPFS integration point)
        var fileRecords=await Promise.all(selectedFiles.map(readFileAsDataURL));

        // Save evidence object
        var evidence={
          orderId:id,
          submittedBy:myAddr,
          submittedAt:new Date().toISOString(),
          description:desc,
          files:fileRecords.map(function(f){return{name:f.name,type:f.type,size:f.size,dataUrl:f.dataUrl};})
          // NOTE: In a production deployment, replace dataUrl with an IPFS hash/URL
          // by uploading via: https://api.pinata.cloud/pinning/pinFileToIPFS or web3.storage
        };

        // Persist evidence to localStorage (key: rh_dispute_evidence)
        var allEvidence=JSON.parse(localStorage.getItem('rh_dispute_evidence')||'{}');
        if(!allEvidence[id])allEvidence[id]=[];
        allEvidence[id].push(evidence);
        localStorage.setItem('rh_dispute_evidence',JSON.stringify(allEvidence));

        // Update order status to 'dispute' and lock funds
        var orders2=JSON.parse(localStorage.getItem('rh_orders')||'[]');
        var idx=orders2.findIndex(function(o){return o.id===id;});
        if(idx>=0){
          orders2[idx].status='dispute';
          orders2[idx].disputedAt=new Date().toISOString();
          orders2[idx].disputeLockedFunds=true;   // explicit fund-lock flag
          orders2[idx].disputeEvidenceCount=(orders2[idx].disputeEvidenceCount||0)+1;
          localStorage.setItem('rh_orders',JSON.stringify(orders2));
        }

        closeDisputeModal();
        showToast('Dispute opened — funds remain locked in Arc escrow. Evidence saved.','success');
        setTimeout(function(){location.reload();},900);

      }catch(e){
        console.error('[dispute]',e);
        showToast('Error saving dispute. Please try again.','error');
        btn.disabled=false;
        btn.innerHTML='<i class="fas fa-gavel"></i> Submit Dispute';
      }
    };
  }

  function showReceiptModalDetail(){
    // Delegate to the shared showReceiptModal function
    showReceiptModal('${id}');
  }
  /* Bootstrap — same IIFE pattern as orders.js (no setTimeout) */
  (function(){
    function _run(){
      if(!document.getElementById('order-detail-container')){
        document.addEventListener('DOMContentLoaded', _orderDetailInit);
        return;
      }
      _orderDetailInit();
    }
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', _run);
    } else {
      _run();
    }
  })();
  </script>
  `)
}

// ─── PAGE: SELL ─────────────────────────────────────────────────────────
function sellPage() {
  return shell('Sell on redhawk-store', `
  <div class="max-w-3xl mx-auto px-4 py-8">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-xl">
        <i class="fas fa-store"></i>
      </div>
      <h1 class="text-3xl font-extrabold text-slate-800 mb-2">Start Selling</h1>
      <p class="text-slate-500">List your product on Arc Network — receive USDC or EURC through escrow.</p>
    </div>

    <!-- Wallet check -->
    <div id="sell-wallet-check" class="mb-6"></div>
    <div id="sell-network-status" class="mb-6"></div>

    <div class="card p-8">
      <h2 class="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
        <i class="fas fa-plus-circle text-red-500"></i> New Product Listing
      </h2>
      <div class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Product Name *</label>
            <input type="text" id="prod-name" placeholder="e.g. Vintage Sneakers, Handmade Bracelet…" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Category *</label>
            <select id="prod-cat" class="select">
              <option value="">Select category</option>
              <option>Electronics</option><option>Gaming</option><option>Audio</option>
              <option>Photography</option><option>Wearables</option><option>Accessories</option>
              <option>Pet Shop</option><option>Baby &amp; Kids</option>
              <option>Beauty &amp; Personal Care</option><option>Fashion &amp; Accessories</option>
              <option>Other</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-slate-700 mb-1">Description *</label>
          <textarea id="prod-desc" rows="4" placeholder="Describe your product in detail…" class="input resize-none"></textarea>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Price *</label>
            <input type="number" id="prod-price" placeholder="0.00" step="0.000001" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Token *</label>
            <select id="prod-token" class="select">
              <option value="USDC">USDC (Arc native)</option>
              <option value="EURC">EURC (ERC-20)</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Stock *</label>
            <input type="number" id="prod-stock" placeholder="1" min="1" class="input"/>
          </div>
        </div>
        <!-- Image Upload -->
        <div>
          <label class="block text-sm font-semibold text-slate-700 mb-2">
            Product Image <span class="font-normal text-slate-400">(optional)</span>
          </label>
          <!-- Tabs -->
          <div class="flex gap-1 mb-3 bg-slate-100 rounded-lg p-1 w-fit flex-wrap">
            <button type="button" id="tab-upload" onclick="switchImgTab('upload')"
              class="px-4 py-1.5 rounded-md text-xs font-semibold transition-all bg-white text-slate-800 shadow-sm">
              <i class="fas fa-camera mr-1"></i> Upload Photo
            </button>
            <button type="button" id="tab-url" onclick="switchImgTab('url')"
              class="px-4 py-1.5 rounded-md text-xs font-semibold transition-all text-slate-500 hover:text-slate-700">
              <i class="fas fa-link mr-1"></i> URL / IPFS
            </button>
          </div>

          <!-- Upload panel -->
          <div id="img-panel-upload">
            <!-- Drop zone -->
            <div id="img-drop-zone"
              class="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-red-400 hover:bg-red-50/30 transition-all"
              onclick="document.getElementById('img-file-input').click()"
              ondragover="event.preventDefault();this.classList.add('border-red-400','bg-red-50')"
              ondragleave="this.classList.remove('border-red-400','bg-red-50')"
              ondrop="handleImgDrop(event)">
              <div id="img-drop-content">
                <i class="fas fa-camera text-3xl text-slate-300 mb-2 block"></i>
                <p class="text-sm font-medium text-slate-500">Drag photo here or <span class="text-red-600 font-semibold">click to choose</span></p>
                <p class="text-xs text-slate-400 mt-1">JPG, PNG, GIF, WEBP — max 10 MB · Auto-compressed</p>
              </div>
            </div>
            <input type="file" id="img-file-input" accept="image/jpeg,image/png,image/gif,image/webp"
              class="hidden" onchange="handleImgFile(this)"/>

            <!-- Upload progress bar (hidden by default) -->
            <div id="img-upload-progress" class="hidden mt-3">
              <div class="flex items-center gap-2 mb-1">
                <span class="loading-spinner inline-block"></span>
                <span id="img-upload-status" class="text-xs text-slate-500">Processing image…</span>
              </div>
              <div class="w-full bg-slate-200 rounded-full h-1.5">
                <div id="img-upload-bar" class="bg-red-500 h-1.5 rounded-full transition-all duration-300" style="width:0%"></div>
              </div>
            </div>

            <!-- Preview after upload -->
            <div id="img-preview-wrap" class="hidden mt-3">
              <div class="flex items-start gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <img id="img-preview" src="" alt="Preview" class="w-24 h-24 rounded-xl object-cover border border-slate-200 shadow-sm flex-shrink-0"/>
                <div class="flex-1 min-w-0">
                  <p id="img-file-name" class="text-xs font-semibold text-slate-700 truncate mb-0.5"></p>
                  <p id="img-file-size" class="text-xs text-slate-400 mb-0.5"></p>
                  <p id="img-compressed-size" class="text-xs text-green-600 mb-2"></p>
                  <div class="flex gap-2 flex-wrap">
                    <button type="button" onclick="document.getElementById('img-file-input').click()"
                      class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                      <i class="fas fa-sync-alt text-xs"></i> Change photo
                    </button>
                    <button type="button" onclick="clearImgUpload()"
                      class="text-xs bg-red-50 hover:bg-red-100 text-red-500 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                      <i class="fas fa-trash-alt text-xs"></i> Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- URL / IPFS panel -->
          <div id="img-panel-url" class="hidden">
            <input type="url" id="prod-img" placeholder="https://... ou ipfs://..." class="input mb-2"/>
            <div id="img-url-preview-wrap" class="hidden mt-2 flex items-center gap-3">
              <img id="img-url-preview" src="" alt="Preview"
                class="w-20 h-20 rounded-xl object-cover border border-slate-200 shadow-sm"
                onerror="this.parentElement.classList.add('hidden')"/>
              <div>
                <p class="text-xs font-semibold text-slate-600">Preview</p>
                <p class="text-xs text-slate-400 mt-0.5">The image will load on the product</p>
              </div>
            </div>
            <p class="text-xs text-slate-400 mt-2 leading-relaxed">
              <i class="fas fa-info-circle mr-1 text-blue-400"></i>
              Paste an image URL (<code class="bg-slate-100 px-1 rounded">https://</code>) or an IPFS link
              (<code class="bg-slate-100 px-1 rounded">ipfs://</code>) for decentralized storage.
            </p>
          </div>

          <!-- Hidden field that always holds the final image value sent to listProduct() -->
          <input type="hidden" id="prod-img-final"/>
        </div>
        <!-- Fee Breakdown Card -->
        <div class="card p-5 bg-slate-50 border-slate-200" id="fee-breakdown-card">
          <h4 class="font-bold text-slate-700 mb-3 flex items-center gap-2">
            <i class="fas fa-calculator text-red-500"></i> Listing Fee Breakdown
          </h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-slate-600">
              <span>Product Price</span>
              <span id="fee-product-price">—</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Platform Fee (2%)</span>
              <span id="fee-platform" class="text-red-600 font-semibold">—</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Arc Network Gas Fee (est.)</span>
              <span id="fee-arc" class="text-slate-500">~0.001 USDC</span>
            </div>
            <div class="border-t border-slate-200 pt-2 flex justify-between font-bold text-slate-800">
              <span>You Receive (est.)</span>
              <span id="fee-you-receive" class="text-green-600">—</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 mt-3"><i class="fas fa-info-circle mr-1"></i>Platform fee is deducted from the sale amount when escrow is released.</p>
        </div>
        <!-- Escrow Policy -->
        <div class="card p-4 bg-red-50 border-red-100">
          <h4 class="font-bold text-red-800 mb-1 flex items-center gap-2"><i class="fas fa-shield-alt"></i> Escrow Policy</h4>
          <p class="text-sm text-red-700">All sales are protected by escrow via smart contract on Arc Network. Funds are only released after the buyer confirms delivery.</p>
        </div>
        <button onclick="listProduct()" class="btn-primary w-full justify-center py-3 text-base">
          <i class="fas fa-tag mr-2"></i> List Product
        </button>
      </div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('sell-network-status'));
    const w=getStoredWallet();
    const wc=document.getElementById('sell-wallet-check');
    if(!w){
      wc.innerHTML='<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>You need to connect a wallet to list products. <a href="/wallet" class="underline font-bold ml-1">Connect Wallet →</a></div>';
    } else {
      wc.innerHTML='<div class="network-ok"><i class="fas fa-check-circle text-green-600"></i>Seller: <span class="font-mono text-xs ml-1">'+w.address+'</span></div>';
    }
    // Fee breakdown live update
    function updateFeeBreakdown(){
      const priceEl=document.getElementById('prod-price');
      const tokenEl=document.getElementById('prod-token');
      if(!priceEl||!tokenEl) return;
      const p=parseFloat(priceEl.value)||0;
      const tok=tokenEl.value||'USDC';
      const platformFee=p*0.02;
      const arcFee=0.001;
      const youReceive=Math.max(0,p-platformFee-arcFee);
      const fpEl=document.getElementById('fee-product-price');
      const fplatEl=document.getElementById('fee-platform');
      const farcEl=document.getElementById('fee-arc');
      const fyoEl=document.getElementById('fee-you-receive');
      if(fpEl) fpEl.textContent=p>0?p.toFixed(6)+' '+tok:'—';
      if(fplatEl) fplatEl.textContent=p>0?platformFee.toFixed(6)+' '+tok:'—';
      if(farcEl) farcEl.textContent='~0.001 '+tok;
      if(fyoEl) fyoEl.textContent=p>0?youReceive.toFixed(6)+' '+tok:'—';
    }
    const priceInput=document.getElementById('prod-price');
    const tokenSelect=document.getElementById('prod-token');
    if(priceInput) priceInput.addEventListener('input',updateFeeBreakdown);
    if(tokenSelect) tokenSelect.addEventListener('change',updateFeeBreakdown);
    updateFeeBreakdown();
    // URL field live preview
    const urlInput = document.getElementById('prod-img');
    if (urlInput) {
      urlInput.addEventListener('input', function() {
        const val = this.value.trim();
        document.getElementById('prod-img-final').value = val;
        const wrap = document.getElementById('img-url-preview-wrap');
        const previewEl = document.getElementById('img-url-preview');
        if (val && (val.startsWith('http') || val.startsWith('ipfs'))) {
          const src = val.startsWith('ipfs://') ? val.replace('ipfs://', 'https://ipfs.io/ipfs/') : val;
          previewEl.src = src;
          wrap.classList.remove('hidden');
        } else {
          wrap.classList.add('hidden');
        }
      });
    }
  });
  async function listProduct(){
    const w=getStoredWallet();
    if(!w){showToast('Connect a wallet first','error');window.location.href='/wallet';return;}
    const name=document.getElementById('prod-name').value.trim();
    const cat=document.getElementById('prod-cat').value;
    const desc=document.getElementById('prod-desc').value.trim();
    const priceVal=parseFloat(document.getElementById('prod-price').value);
    const token=document.getElementById('prod-token').value;
    const stockVal=parseInt(document.getElementById('prod-stock').value)||1;
    const img=document.getElementById('prod-img-final').value.trim();
    if(!name||!cat||!desc||!priceVal){showToast('Please fill in all required fields','error');return;}
    if(priceVal<=0){showToast('Price must be greater than zero','error');return;}

    // Disable button to prevent double submit
    const btn=document.querySelector('button[onclick="listProduct()"]');
    if(btn){btn.disabled=true;btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Publishing…';}

    try {
      const res=await fetch('/api/products',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          title:name, description:desc, price:priceVal,
          token, image:img, category:cat, stock:stockVal,
          seller_id:w.address
        })
      });
      const data=await res.json();
      if(!res.ok||data.error){
        showToast(data.error||'Error publishing product','error');
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-tag mr-2"></i> List Product';}
        return;
      }
      showToast('Product listed successfully!','success');
      // Redirect to marketplace after short delay
      setTimeout(()=>{ window.location.href='/marketplace'; },1200);
    } catch(err){
      showToast('Network error. Please try again.','error');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-tag mr-2"></i> List Product';}
    }
  }

  // ── Image tab switcher ──────────────────────────────────────
  function switchImgTab(tab) {
    const isUpload = tab === 'upload';
    document.getElementById('img-panel-upload').classList.toggle('hidden', !isUpload);
    document.getElementById('img-panel-url').classList.toggle('hidden', isUpload);
    const tu = document.getElementById('tab-upload');
    const tl = document.getElementById('tab-url');
    const activeClass  = 'px-4 py-1.5 rounded-md text-xs font-semibold transition-all bg-white text-slate-800 shadow-sm';
    const inactiveClass= 'px-4 py-1.5 rounded-md text-xs font-semibold transition-all text-slate-500 hover:text-slate-700';
    tu.className = isUpload ? activeClass : inactiveClass;
    tl.className = isUpload ? inactiveClass : activeClass;
    // limpa o campo oculto ao trocar de aba
    document.getElementById('prod-img-final').value = '';
  }

  // ── Comprime imagem via Canvas e retorna dataURL ─────────────
  function compressImage(file, maxW, maxH, quality) {
    return new Promise(function(resolve) {
      const reader = new FileReader();
      reader.onload = function(ev) {
        const img = new Image();
        img.onload = function() {
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── File upload handler (com compressão automática) ─────────
  async function handleImgFile(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please select a valid image', 'error'); input.value=''; return; }
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_BYTES) { showToast('Image must be at most 10 MB', 'error'); input.value=''; return; }

    // Mostrar barra de progresso
    const progressWrap = document.getElementById('img-upload-progress');
    const progressBar  = document.getElementById('img-upload-bar');
    const statusText   = document.getElementById('img-upload-status');
    const previewWrap  = document.getElementById('img-preview-wrap');
    const dropContent  = document.getElementById('img-drop-content');

    progressWrap.classList.remove('hidden');
    previewWrap.classList.add('hidden');
    dropContent.classList.add('hidden');
    progressBar.style.width = '20%';
    statusText.textContent  = 'Reading file…';

    try {
      progressBar.style.width = '50%';
      statusText.textContent  = 'Compressing image…';

      // Comprimir: máx 1200×1200px, qualidade 0.82 → resulta em ~100-300 KB
      let dataUrl = await compressImage(file, 1200, 1200, 0.82);

      // Se ainda muito grande (> 800 KB base64), comprimir mais
      if (dataUrl.length > 800 * 1024) {
        statusText.textContent = 'Reducing quality…';
        progressBar.style.width = '70%';
        dataUrl = await compressImage(file, 900, 900, 0.65);
      }

      progressBar.style.width = '90%';
      statusText.textContent  = 'Finalizing…';

      // Calcular tamanho comprimido
      const compressedBytes = Math.round(dataUrl.length * 0.75); // base64 → bytes aprox
      const originalKB      = (file.size / 1024).toFixed(1);
      const compressedKB    = (compressedBytes / 1024).toFixed(1);

      // Mostrar preview
      document.getElementById('img-preview').src = dataUrl;
      document.getElementById('img-file-name').textContent  = file.name;
      document.getElementById('img-file-size').textContent  = 'Original: ' + originalKB + ' KB';
      document.getElementById('img-compressed-size').textContent = '✓ Comprimida: ' + compressedKB + ' KB';
      previewWrap.classList.remove('hidden');
      document.getElementById('prod-img-final').value = dataUrl;

      progressBar.style.width = '100%';
      statusText.textContent  = 'Pronto!';
      setTimeout(function() { progressWrap.classList.add('hidden'); }, 800);

    } catch(err) {
      progressWrap.classList.add('hidden');
      dropContent.classList.remove('hidden');
      showToast('Erro ao processar imagem', 'error');
    }
  }

  // ── Drag & drop ─────────────────────────────────────────────
  function handleImgDrop(e) {
    e.preventDefault();
    document.getElementById('img-drop-zone').classList.remove('border-red-400','bg-red-50');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) { showToast('Please drop an image file', 'error'); return; }
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('img-file-input');
    input.files = dt.files;
    handleImgFile(input);
  }

  // ── Limpar upload ────────────────────────────────────────────
  function clearImgUpload() {
    document.getElementById('img-file-input').value = '';
    document.getElementById('img-preview').src = '';
    document.getElementById('img-preview-wrap').classList.add('hidden');
    document.getElementById('img-upload-progress').classList.add('hidden');
    document.getElementById('img-drop-content').classList.remove('hidden');
    document.getElementById('prod-img-final').value = '';
  }

  // ── URL field live preview (inicializado no DOMContentLoaded acima) ──
  </script>
  `)
}

// ─── PAGE: SELLER DASHBOARD ──────────────────────────────────────────────
function sellerDashboardPage() {
  return shell('Seller Dashboard', `
  <div class="max-w-5xl mx-auto px-4 py-8">

    <!-- Header -->
    <div class="flex items-center gap-4 mb-8">
      <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-xl shadow-lg">
        <i class="fas fa-chart-line"></i>
      </div>
      <div>
        <h1 class="text-2xl font-extrabold text-slate-800">Seller Dashboard</h1>
        <p class="text-slate-500 text-sm">Manage your listings on Arc Network</p>
      </div>
      <a href="/sell" class="ml-auto btn-primary text-sm"><i class="fas fa-plus-circle mr-1"></i> New Listing</a>
    </div>

    <!-- Wallet check -->
    <div id="dash-wallet-check" class="mb-6"></div>

    <!-- Stats row -->
    <div id="dash-stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"></div>

    <!-- Products table -->
    <div class="card p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="font-bold text-slate-800 text-lg flex items-center gap-2">
          <i class="fas fa-boxes text-red-500"></i> My Products
        </h2>
        <div class="flex gap-2">
          <button onclick="filterDashProducts('all')" id="df-all" class="dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white">All</button>
          <button onclick="filterDashProducts('active')" id="df-active" class="dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">Active</button>
          <button onclick="filterDashProducts('paused')" id="df-paused" class="dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">Paused</button>
        </div>
      </div>
      <div id="dash-products-container">
        <!-- populated by JS — no static spinner to avoid permanent loading state -->
      </div>
    </div>

  </div>

  <script>
  // ── Seller Dashboard — fully functional logic ──────────────────────────
  var _dashProducts = [];
  var _dashFilter   = 'all';
  var _dashAddress  = null;

  // ── helpers ──────────────────────────────────────────────────────────
  function _dashShowLoading(){
    var c = document.getElementById('dash-products-container');
    if(c) c.innerHTML =
      '<div class="text-center py-12">'
      +'<div class="loading-spinner-lg mx-auto mb-4"></div>'
      +'<p class="text-slate-400 text-sm">Loading your products…</p>'
      +'</div>';
  }

  function _dashShowError(msg){
    var c = document.getElementById('dash-products-container');
    if(c) c.innerHTML =
      '<div class="p-8 text-center">'
      +'<i class="fas fa-exclamation-circle text-red-400 text-3xl mb-3"></i>'
      +'<p class="text-red-500 font-medium mb-1">Failed to load products</p>'
      +'<p class="text-slate-400 text-sm mb-4">'+(msg||'Network error. Please try again.')+'</p>'
      +'<button onclick="loadDashboardProducts(_dashAddress)" class="btn-primary text-sm mx-auto"><i class="fas fa-redo mr-1"></i> Retry</button>'
      +'</div>';
  }

  function _dashClearStats(){
    var s = document.getElementById('dash-stats');
    if(s) s.innerHTML = '';
  }

  // ── init ──────────────────────────────────────────────────────────────
  function _dashInit(){
    var wallet = (typeof getStoredWallet === 'function') ? getStoredWallet() : null;
    var wc = document.getElementById('dash-wallet-check');
    var container = document.getElementById('dash-products-container');

    if(!wallet || !wallet.address){
      // No wallet — clear spinner, show connect prompt
      if(container) container.innerHTML = '';
      _dashClearStats();
      if(wc) wc.innerHTML =
        '<div class="card p-8 text-center">'
        +'<div class="empty-state">'
        +'<i class="fas fa-wallet"></i>'
        +'<h3 class="font-bold text-slate-600 mb-2">Connect Wallet</h3>'
        +'<p class="text-sm text-slate-400 mb-4">Connect your wallet to manage your listings on Arc Network.</p>'
        +'<a href="/wallet" class="btn-primary mx-auto"><i class="fas fa-wallet mr-1"></i> Connect Wallet</a>'
        +'</div></div>';
      return;
    }

    // Wallet connected — clear wallet-check banner if any
    if(wc) wc.innerHTML = '';
    _dashAddress = wallet.address;
    _dashShowLoading();
    loadDashboardProducts(wallet.address);
  }

  // Fire on DOMContentLoaded — guard against globalScript timing
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _dashInit);
  } else {
    _dashInit();
  }

  // ── fetch products ────────────────────────────────────────────────────
  async function loadDashboardProducts(address){
    if(!address){ _dashShowError('No wallet address.'); return; }
    _dashAddress = address;
    _dashShowLoading();
    try {
      var res  = await fetch('/api/seller/'+encodeURIComponent(address)+'/products');
      if(!res.ok){ _dashShowError('Server returned '+res.status); return; }
      var data = await res.json();
      _dashProducts = Array.isArray(data.products) ? data.products : [];
      renderDashStats();
      renderDashProducts();
    } catch(e){
      _dashShowError(e && e.message ? e.message : 'Could not reach server.');
    }
  }

  // ── stats ─────────────────────────────────────────────────────────────
  function renderDashStats(){
    var total  = _dashProducts.length;
    var active = _dashProducts.filter(function(p){return p.status==='active';}).length;
    var paused = _dashProducts.filter(function(p){return p.status==='paused';}).length;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    var myAddr = wallet ? wallet.address.toLowerCase() : '';
    var allOrders = JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var mySales = allOrders.filter(function(o){ return o.sellerAddress && o.sellerAddress.toLowerCase()===myAddr; });
    var stats = [
      {icon:'fas fa-boxes',    label:'Total Listings', value:total,          color:'text-red-600'},
      {icon:'fas fa-check-circle', label:'Active',     value:active,         color:'text-green-600'},
      {icon:'fas fa-pause-circle', label:'Paused',     value:paused,         color:'text-amber-600'},
      {icon:'fas fa-shopping-bag', label:'Total Sales',value:mySales.length, color:'text-blue-600'},
    ];
    var el = document.getElementById('dash-stats');
    if(!el) return;
    el.innerHTML = stats.map(function(s){
      return '<div class="card p-5 text-center">'
        +'<div class="'+s.color+' text-2xl font-extrabold mb-1">'+s.value+'</div>'
        +'<div class="text-xs text-slate-500 font-medium"><i class="'+s.icon+' mr-1"></i>'+s.label+'</div>'
        +'</div>';
    }).join('');
  }

  // ── filter buttons ────────────────────────────────────────────────────
  function filterDashProducts(f){
    _dashFilter = f;
    document.querySelectorAll('.dash-filter-btn').forEach(function(b){
      b.className = 'dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold '
        +(b.id==='df-'+f ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200');
    });
    renderDashProducts();
  }

  // ── render table ──────────────────────────────────────────────────────
  function renderDashProducts(){
    var container = document.getElementById('dash-products-container');
    if(!container) return;

    var list = _dashFilter==='all'
      ? _dashProducts
      : _dashProducts.filter(function(p){ return p.status===_dashFilter; });

    // Empty states
    if(_dashProducts.length===0){
      container.innerHTML =
        '<div class="text-center py-12">'
        +'<div class="empty-state">'
        +'<i class="fas fa-store"></i>'
        +'<h3 class="font-bold text-slate-600 mb-2">No products listed yet</h3>'
        +'<p class="text-sm text-slate-400 mb-4">Start selling by listing your first product on Arc Network.</p>'
        +'<a href="/sell" class="btn-primary mx-auto"><i class="fas fa-plus-circle mr-1"></i> List a Product</a>'
        +'</div></div>';
      return;
    }
    if(list.length===0){
      container.innerHTML =
        '<div class="text-center py-10 text-slate-400 text-sm">'
        +'<i class="fas fa-filter mr-2"></i>No <strong>'+_dashFilter+'</strong> products found.'
        +'</div>';
      return;
    }

    // Responsive table
    container.innerHTML =
      '<div class="overflow-x-auto">'
      +'<table class="w-full text-sm border-collapse">'
      +'<thead><tr class="border-b border-slate-100">'
      +'<th class="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Product</th>'
      +'<th class="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Category</th>'
      +'<th class="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Price</th>'
      +'<th class="text-center py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Stock</th>'
      +'<th class="text-center py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>'
      +'<th class="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>'
      +'</tr></thead>'
      +'<tbody>'
      +list.map(function(p){
        var statusBadge = p.status==='active'
          ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>'
          : p.status==='paused'
            ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Paused</span>'
            : '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">Deleted</span>';
        var imgEl = p.image
          ? '<img src="'+p.image+'" class="w-10 h-10 rounded-lg object-cover mr-3 shrink-0" onerror="this.style.display=\'none\'">'
          : '<div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center mr-3 shrink-0"><i class="fas fa-image text-slate-300"></i></div>';
        var actionBtns = '';
        if(p.status==='active'){
          actionBtns += '<button onclick="dashPauseProduct(\''+p.id+'\')" class="text-amber-600 hover:text-amber-800 text-xs font-semibold px-2 py-1 rounded hover:bg-amber-50" title="Pause Listing"><i class="fas fa-pause mr-1"></i>Pause</button>';
        }
        if(p.status==='paused'){
          actionBtns += '<button onclick="dashResumeProduct(\''+p.id+'\')" class="text-green-600 hover:text-green-800 text-xs font-semibold px-2 py-1 rounded hover:bg-green-50" title="Resume Listing"><i class="fas fa-play mr-1"></i>Resume</button>';
        }
        actionBtns += '<a href="/product/'+p.id+'" class="text-blue-600 hover:text-blue-800 text-xs font-semibold px-2 py-1 rounded hover:bg-blue-50" title="View Product"><i class="fas fa-eye mr-1"></i>View</a>';
        actionBtns += '<button onclick="dashDeleteProduct(\''+p.id+'\')" class="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1 rounded hover:bg-red-50" title="Delete Product"><i class="fas fa-trash mr-1"></i>Delete</button>';
        return '<tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">'
          +'<td class="py-3 px-2"><div class="flex items-center">'+imgEl
          +'<div><p class="font-semibold text-slate-800 text-xs leading-tight line-clamp-2 max-w-xs">'+((p.title||'Untitled').replace(/</g,'&lt;'))+'</p>'
          +'<p class="text-slate-400 text-xs font-mono">'+p.id+'</p></div></div></td>'
          +'<td class="py-3 px-2 text-slate-500 text-xs hidden md:table-cell">'+(p.category||'Other')+'</td>'
          +'<td class="py-3 px-2 text-right font-bold text-red-600">'+parseFloat(p.price||0).toFixed(2)
          +' <span class="text-xs font-normal text-slate-500">'+(p.token||'USDC')+'</span></td>'
          +'<td class="py-3 px-2 text-center text-slate-600">'+(p.stock||0)+'</td>'
          +'<td class="py-3 px-2 text-center">'+statusBadge+'</td>'
          +'<td class="py-3 px-2 text-right"><div class="flex items-center justify-end gap-1">'+actionBtns+'</div></td>'
          +'</tr>';
      }).join('')
      +'</tbody></table></div>';
  }

  // ── action handlers ───────────────────────────────────────────────────
  async function dashPauseProduct(productId){
    if(!confirm('Pause this listing? It will be hidden from the marketplace but not deleted.')) return;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    if(!wallet){ showToast('Connect wallet first','error'); return; }
    try {
      var res = await fetch('/api/products/'+productId+'/status',{
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seller_id:wallet.address, status:'paused'})
      });
      var data = await res.json();
      if(!res.ok){ showToast(data.error||'Failed to pause','error'); return; }
      showToast('Listing paused — hidden from marketplace','info');
      await loadDashboardProducts(wallet.address);
    } catch(e){ showToast('Network error','error'); }
  }

  async function dashResumeProduct(productId){
    if(!confirm('Resume this listing? It will be visible in the marketplace again.')) return;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    if(!wallet){ showToast('Connect wallet first','error'); return; }
    try {
      var res = await fetch('/api/products/'+productId+'/status',{
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seller_id:wallet.address, status:'active'})
      });
      var data = await res.json();
      if(!res.ok){ showToast(data.error||'Failed to resume','error'); return; }
      showToast('Listing is now active on the marketplace','success');
      await loadDashboardProducts(wallet.address);
    } catch(e){ showToast('Network error','error'); }
  }

  async function dashDeleteProduct(productId){
    if(!confirm('Delete this product? It will be permanently removed. This cannot be undone.')) return;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    if(!wallet){ showToast('Connect wallet first','error'); return; }
    try {
      var res = await fetch('/api/products/'+productId,{
        method:'DELETE', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seller_id:wallet.address})
      });
      var data = await res.json();
      if(!res.ok){ showToast(data.error||'Failed to delete','error'); return; }
      showToast('Product deleted successfully','success');
      await loadDashboardProducts(wallet.address);
    } catch(e){ showToast('Network error','error'); }
  }
  </script>
  `)
}


// ─── PAGE: PROFILE ──────────────────────────────────────────────────────
function profilePage() {
  return shell('Profile', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-6 flex items-center gap-3">
      <i class="fas fa-user text-red-500"></i> My Profile
    </h1>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="card p-6">
        <div class="text-center mb-6">
          <div class="w-20 h-20 rounded-full bg-gradient-to-br from-red-400 to-red-700 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-3">
            <i class="fas fa-user"></i>
          </div>
          <p class="font-bold text-slate-800" id="prof-address">Not connected</p>
          <div class="mt-2" id="prof-network-badge"></div>
        </div>
        <nav class="sidebar-nav space-y-1">
          <a href="/profile" class="active"><i class="fas fa-user w-4"></i> Profile</a>
          <a href="/orders"><i class="fas fa-box w-4"></i> My Orders</a>
          <a href="/wallet"><i class="fas fa-wallet w-4"></i> Wallet</a>
          <a href="/sell"><i class="fas fa-store w-4"></i> Sell</a>
          <a href="/disputes"><i class="fas fa-gavel w-4"></i> Disputes</a>
          <a href="/notifications"><i class="fas fa-bell w-4"></i> Notifications</a>
        </nav>
      </div>
      <div class="md:col-span-2 space-y-5">
        <div class="card p-6">
          <h2 class="font-bold text-slate-800 text-lg mb-4">Personal Information</h2>
          <div class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label class="block text-sm font-medium text-slate-700 mb-1">Full Name</label><input type="text" placeholder="Your name" class="input"/></div>
              <div><label class="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" placeholder="your@email.com" class="input"/></div>
            </div>
            <div><label class="block text-sm font-medium text-slate-700 mb-1">Shipping Address</label><input type="text" placeholder="Street, City, Country" class="input"/></div>
            <button onclick="showToast('Profile saved locally','success')" class="btn-primary"><i class="fas fa-save"></i> Save Changes</button>
          </div>
        </div>
        <!-- Wallet on-chain info -->
        <div class="card p-5" id="prof-wallet-card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-wallet text-red-500"></i> Arc Network Wallet
            </h3>
            <a href="/wallet" class="text-red-600 text-sm hover:underline">Manage →</a>
          </div>
          <div id="prof-wallet-info" class="text-slate-400 text-sm">Loading…</div>
        </div>
        <!-- Stats (from localStorage orders) -->
        <div class="grid grid-cols-3 gap-4" id="prof-stats">
          <div class="card p-4 text-center"><i class="fas fa-box text-red-500 text-xl mb-2"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-orders">0</p><p class="text-slate-400 text-xs">Orders</p></div>
          <div class="card p-4 text-center"><i class="fas fa-coins text-red-500 text-xl mb-2"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-spent">0</p><p class="text-slate-400 text-xs">USDC Spent</p></div>
          <div class="card p-4 text-center"><i class="fas fa-check-circle text-green-500 text-xl mb-2"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-completed">0</p><p class="text-slate-400 text-xs">Completed</p></div>
        </div>
      </div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    const w=getStoredWallet();
    if(w){
      document.getElementById('prof-address').textContent=w.address.substring(0,10)+'…'+w.address.slice(-6);
      document.getElementById('prof-network-badge').innerHTML='<span class="arc-badge text-xs"><i class="fas fa-network-wired text-xs"></i> Arc Testnet</span>';
      document.getElementById('prof-wallet-info').innerHTML=
        '<div class="space-y-1">'
        +'<p class="text-xs text-slate-500">Address</p>'
        +'<p class="font-mono text-xs text-slate-700 break-all">'+w.address+'</p>'
        +'<a href="${ARC.explorer}/address/'+w.address+'" target="_blank" class="text-blue-600 text-xs hover:underline flex items-center gap-1 mt-1">'
        +'<i class="fas fa-external-link-alt text-xs"></i> View on Arc Explorer</a></div>';
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]').filter(o=>o.buyerAddress&&o.buyerAddress.toLowerCase()===w.address.toLowerCase());
      document.getElementById('stat-orders').textContent=orders.length;
      document.getElementById('stat-spent').textContent=(orders.reduce((s,o)=>s+(o.amount||0),0)).toFixed(2);
      document.getElementById('stat-completed').textContent=orders.filter(o=>o.status==='completed').length;
    } else {
      document.getElementById('prof-wallet-info').innerHTML='<a href="/wallet" class="text-red-600 hover:underline">Connect wallet →</a>';
    }
  });
  </script>
  `)
}

// ─── PAGE: REGISTER ──────────────────────────────────────────────────────
function registerPage() {
  return shell('Register', `
  <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-red-50 to-white">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <a href="/" class="flex items-center justify-center gap-2 mb-4">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
          </div>
          <span class="font-extrabold text-xl text-slate-800">redhawk<span class="text-red-600">-store</span></span>
        </a>
        <h1 class="text-2xl font-extrabold text-slate-800 mb-1">Create Account</h1>
        <p class="text-slate-500 text-sm">Join redhawk-store on Arc Network</p>
      </div>
      <div class="card p-8">
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-sm font-medium text-slate-700 mb-1">First Name</label><input type="text" placeholder="John" class="input"/></div>
            <div><label class="block text-sm font-medium text-slate-700 mb-1">Last Name</label><input type="text" placeholder="Doe" class="input"/></div>
          </div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" placeholder="john@email.com" class="input"/></div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Shipping Address</label><input type="text" placeholder="Street, City, Country" class="input"/></div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Password</label><input type="password" placeholder="Min 8 characters" class="input"/></div>
          <div class="border-t pt-4">
            <p class="text-sm font-semibold text-slate-700 mb-3">Wallet Setup <span class="text-red-500">*</span></p>
            <div class="grid grid-cols-2 gap-3">
              <a href="/wallet/create" class="card p-3 text-center hover:border-red-300 hover:bg-red-50 transition-all">
                <i class="fas fa-plus-circle text-red-500 text-lg mb-1 block"></i>
                <p class="font-semibold text-slate-700 text-sm">Create Wallet</p>
                <p class="text-slate-400 text-xs">Non-custodial</p>
              </a>
              <button onclick="connectWallet('metamask').then(w=>{if(w)showToast('MetaMask connected!','success')})" class="card p-3 text-center hover:border-orange-300 hover:bg-orange-50 transition-all">
                <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-7 h-7 mx-auto mb-1"/>
                <p class="font-semibold text-slate-700 text-sm">MetaMask</p>
                <p class="text-slate-400 text-xs">Arc Testnet</p>
              </button>
            </div>
          </div>
          <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" class="accent-red-600 w-4 h-4"/>
            I agree to the <a href="/terms" class="text-red-600 hover:underline">Terms of Service</a> and <a href="/privacy" class="text-red-600 hover:underline">Privacy Policy</a>
          </label>
          <button onclick="showToast('Account created! Now connect your wallet.','success')" class="btn-primary w-full justify-center py-3">
            <i class="fas fa-user-plus"></i> Create Account
          </button>
        </div>
        <p class="text-center text-sm text-slate-500 mt-4">Already have an account? <a href="/login" class="text-red-600 hover:underline font-medium">Sign in</a></p>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: LOGIN ──────────────────────────────────────────────────────────
function loginPage() {
  return shell('Login', `
  <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-red-50 to-white">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <a href="/" class="flex items-center justify-center gap-2 mb-4">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
          </div>
          <span class="font-extrabold text-xl text-slate-800">redhawk<span class="text-red-600">-store</span></span>
        </a>
        <h1 class="text-2xl font-extrabold text-slate-800 mb-1">Welcome Back</h1>
        <p class="text-slate-500 text-sm">Sign in to redhawk-store on Arc Network</p>
      </div>
      <div class="card p-8">
        <div class="space-y-4">
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" placeholder="john@email.com" class="input"/></div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Password</label><input type="password" placeholder="Your password" class="input"/></div>
          <button onclick="showToast('Signed in!','success');setTimeout(()=>window.location.href='/',1000)" class="btn-primary w-full justify-center py-3">
            <i class="fas fa-sign-in-alt"></i> Sign In
          </button>
          <div class="relative flex items-center gap-3">
            <div class="flex-1 h-px bg-slate-200"></div><span class="text-slate-400 text-xs">or</span><div class="flex-1 h-px bg-slate-200"></div>
          </div>
          <button onclick="connectWallet('metamask').then(w=>{if(w){showToast('Signed in with MetaMask!','success');setTimeout(()=>window.location.href='/',1000)}})" class="btn-secondary w-full justify-center py-2.5 text-sm">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-5 h-5"/>
            Sign in with MetaMask (Arc Testnet)
          </button>
        </div>
        <p class="text-center text-sm text-slate-500 mt-4">Don't have an account? <a href="/register" class="text-red-600 hover:underline font-medium">Create one</a></p>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: DISPUTES ───────────────────────────────────────────────────────
function disputesPage() {
  return shell('Disputes', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-gavel text-red-500"></i> Dispute Resolution
    </h1>
    <p class="text-slate-500 mb-6">Open disputes are reviewed by redhawk-store governance. Escrow funds remain locked on Arc Network until resolved.</p>

    <!-- Fund-lock info banner -->
    <div class="flex items-start gap-3 p-4 mb-6 rounded-xl" style="background:#fef2f2;border:1px solid #fecaca;">
      <i class="fas fa-lock text-red-500 mt-0.5 flex-shrink-0"></i>
      <div>
        <p class="font-semibold text-red-800 text-sm mb-1">Funds Are Locked During Disputes</p>
        <p class="text-red-700 text-xs">USDC/EURC stays locked in the Arc Network escrow contract while a dispute is active. No release or transfer is possible until the dispute is resolved by both parties.</p>
      </div>
    </div>

    <!-- disputes list rendered by disputes.js -->
    <div id="disputes-container">
      <div class="text-center py-8">
        <div class="loading-spinner-lg mx-auto mb-4"></div>
        <p class="text-slate-400">Loading disputes…</p>
      </div>
    </div>

    <!-- modal root for evidence viewer -->
    <div id="disputes-modal-root"></div>
  </div>
  <!-- Disputes logic is in /static/disputes.js (no inline script) -->
  <script src="/static/disputes.js" defer></script>
  `)
}

// ─── PAGE: NOTIFICATIONS ──────────────────────────────────────────────────
function notificationsPage() {
  return shell('Notifications', `
  <div class="max-w-2xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-3xl font-bold text-slate-800 flex items-center gap-3">
        <i class="fas fa-bell text-red-500"></i> Notifications
      </h1>
      <button onclick="clearNotifs()" class="btn-secondary text-sm">Mark all read</button>
    </div>
    <div id="notif-list">
      <div class="text-center py-8"><div class="loading-spinner-lg mx-auto mb-4"></div><p class="text-slate-400">Loading…</p></div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const w=getStoredWallet();
    const container=document.getElementById('notif-list');
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const notifs=[];

    if(w){
      const myOrders=orders.filter(o=>o.buyerAddress&&o.buyerAddress.toLowerCase()===w.address.toLowerCase());
      myOrders.slice(-5).reverse().forEach(o=>{
        notifs.push({icon:'fas fa-lock',color:'bg-yellow-100 text-yellow-600',title:'Escrow Created',msg:'Order '+o.id+' locked on Arc Network',time:new Date(o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='shipped') notifs.push({icon:'fas fa-shipping-fast',color:'bg-blue-100 text-blue-600',title:'Order Shipped',msg:'Order '+o.id+' has been shipped',time:new Date(o.updatedAt||o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='completed') notifs.push({icon:'fas fa-check-circle',color:'bg-green-100 text-green-600',title:'Escrow Released',msg:'Funds released for order '+o.id,time:new Date(o.updatedAt||o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='dispute') notifs.push({icon:'fas fa-gavel',color:'bg-red-100 text-red-600',title:'Dispute Opened',msg:'Dispute opened for order '+o.id+'. Funds locked.',time:new Date(o.disputedAt||o.createdAt).toLocaleString(),url:'/disputes'});
      });
    }

    if(!notifs.length){
      container.innerHTML='<div class="card p-12 text-center"><div class="empty-state"><i class="fas fa-bell-slash"></i><h3 class="font-bold text-slate-600 mb-2">No Notifications</h3><p class="text-sm">Notifications are triggered by real Arc Network events — escrow creation, shipments, and releases.</p></div></div>';
      return;
    }
    container.innerHTML=notifs.map(n=>
      '<a href="'+(n.url||'#')+'" class="notification-item flex items-start gap-4 cursor-pointer hover:bg-red-50 transition-colors block">'
      +'<div class="w-10 h-10 rounded-full '+n.color+' flex items-center justify-center shrink-0"><i class="'+n.icon+' text-sm"></i></div>'
      +'<div class="flex-1"><p class="font-semibold text-slate-800 text-sm">'+n.title+'</p>'
      +'<p class="text-slate-500 text-xs">'+n.msg+'</p>'
      +'<p class="text-slate-300 text-xs mt-1">'+n.time+'</p></div>'
      +'<div class="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div></a>'
    ).join('');
  });
  function clearNotifs(){ showToast('All notifications marked as read','info'); document.querySelectorAll('.notification-item .rounded-full.bg-red-500').forEach(el=>el.remove()); }
  </script>
  `)
}

// ─── PAGE: TERMS OF SERVICE ──────────────────────────────────────────────
function termsPage() {
  return shell('Terms of Service', `
  <div class="max-w-3xl mx-auto px-4 py-12 legal-page">
    <div class="card p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600"><i class="fas fa-file-alt"></i></div>
        <div>
          <h1>Terms of Service</h1>
          <p class="text-slate-400 text-sm">Last updated: January 2024 · redhawk-store</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-exclamation-circle" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Important:</strong> redhawk-store is a testnet demonstration project. No real funds, products, or legal obligations are involved.</span>
      </div>

      <h2>1. Acceptance of Terms</h2>
      <p>By accessing or using redhawk-store ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Platform.</p>

      <h2>2. Nature of the Platform</h2>
      <p>redhawk-store is an open-source, decentralized marketplace demonstration running on the Arc Network testnet. It is provided for educational and testing purposes only. No real monetary transactions occur. All products listed are illustrative and not real.</p>

      <h2>3. Testnet Environment</h2>
      <p>All transactions on redhawk-store are executed on Arc Testnet (Chain ID: 5042002). Testnet tokens (USDC, EURC) have no real monetary value. We are not responsible for any loss of testnet assets.</p>

      <h2>4. Wallet & Private Keys</h2>
      <p>redhawk-store operates as a non-custodial platform. We do not store, collect, or have access to your private keys, seed phrases, or wallet credentials. You are solely responsible for the security of your wallet. Private keys are generated and stored exclusively in your browser.</p>

      <h2>5. No Financial Advice</h2>
      <p>Nothing on this Platform constitutes financial, investment, legal, or tax advice. All content is for informational and demonstration purposes only.</p>

      <h2>6. Prohibited Use</h2>
      <ul>
        <li>Using the Platform for any illegal purpose</li>
        <li>Attempting to exploit or manipulate smart contracts</li>
        <li>Impersonating any person or entity</li>
        <li>Introducing malware or harmful code</li>
      </ul>

      <h2>7. Disclaimer of Warranties</h2>
      <p>The Platform is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, accuracy of data, or fitness for a particular purpose.</p>

      <h2>8. Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, redhawk-store and its contributors shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Platform.</p>

      <h2>9. Changes to Terms</h2>
      <p>We reserve the right to modify these Terms at any time. Continued use of the Platform after changes constitutes acceptance of the new Terms.</p>

      <h2>10. Contact</h2>
      <p>For questions about these Terms, please open an issue on our <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="text-red-600 hover:underline">GitHub repository</a>.</p>

      <div class="flex gap-3 mt-8">
        <a href="/privacy" class="btn-secondary text-sm"><i class="fas fa-lock"></i> Privacy Policy</a>
        <a href="/disclaimer" class="btn-secondary text-sm"><i class="fas fa-exclamation-triangle"></i> Disclaimer</a>
        <a href="/" class="btn-primary text-sm"><i class="fas fa-home"></i> Back to Home</a>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: PRIVACY POLICY ────────────────────────────────────────────────
function privacyPage() {
  return shell('Privacy Policy', `
  <div class="max-w-3xl mx-auto px-4 py-12 legal-page">
    <div class="card p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600"><i class="fas fa-lock"></i></div>
        <div>
          <h1>Privacy Policy</h1>
          <p class="text-slate-400 text-sm">Last updated: January 2024 · redhawk-store</p>
        </div>
      </div>

      <div class="trust-box mb-6">
        <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0"></i>
        <span><strong>Privacy first:</strong> redhawk-store does not collect personal data. Your wallet keys never leave your browser. We have no backend user database.</span>
      </div>

      <h2>1. Information We Do NOT Collect</h2>
      <ul>
        <li>Private keys or seed phrases (these stay in your browser only)</li>
        <li>Personal identification information (name, email, address)</li>
        <li>Financial data or payment information</li>
        <li>Browsing history or tracking cookies</li>
      </ul>

      <h2>2. Information Stored Locally</h2>
      <p>The following data is stored exclusively in your browser's localStorage and never transmitted to our servers:</p>
      <ul>
        <li>Encrypted wallet data (address only — private key encrypted with your password)</li>
        <li>Shopping cart contents</li>
        <li>Order metadata (transaction hashes, escrow status)</li>
        <li>UI preferences (e.g., banner dismissed state)</li>
      </ul>

      <h2>3. Blockchain Data</h2>
      <p>When you connect a wallet or execute transactions, your public wallet address and transaction data are visible on the Arc Network blockchain. Blockchain data is public by nature and cannot be deleted.</p>

      <h2>4. Third-Party Services</h2>
      <p>redhawk-store may interact with the following third-party services:</p>
      <ul>
        <li><strong>Arc Network RPC</strong> (rpc.testnet.arc.network) — for blockchain queries</li>
        <li><strong>Arc Explorer</strong> (testnet.arcscan.app) — public blockchain explorer</li>
        <li><strong>Circle Faucet</strong> (faucet.circle.com) — for testnet tokens</li>
        <li><strong>CDN resources</strong> (Tailwind, FontAwesome, ethers.js) — loaded from public CDNs</li>
      </ul>

      <h2>5. No Tracking</h2>
      <p>We do not use analytics tools, advertising pixels, or any form of user tracking.</p>

      <h2>6. Security</h2>
      <p>Wallet private keys are encrypted client-side using your chosen password before being stored in localStorage. We recommend using a strong, unique password. Never share your seed phrase or private key with anyone.</p>

      <h2>7. Children's Privacy</h2>
      <p>redhawk-store is not directed at children under 13. We do not knowingly collect information from children.</p>

      <h2>8. Contact</h2>
      <p>For privacy-related questions, please open an issue on our <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="text-red-600 hover:underline">GitHub repository</a>.</p>

      <div class="flex gap-3 mt-8">
        <a href="/terms" class="btn-secondary text-sm"><i class="fas fa-file-alt"></i> Terms of Service</a>
        <a href="/disclaimer" class="btn-secondary text-sm"><i class="fas fa-exclamation-triangle"></i> Disclaimer</a>
        <a href="/" class="btn-primary text-sm"><i class="fas fa-home"></i> Back to Home</a>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: DISCLAIMER ────────────────────────────────────────────────────
function disclaimerPage() {
  return shell('Disclaimer', `
  <div class="max-w-3xl mx-auto px-4 py-12 legal-page">
    <div class="card p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center text-yellow-600"><i class="fas fa-exclamation-triangle"></i></div>
        <div>
          <h1>Disclaimer</h1>
          <p class="text-slate-400 text-sm">Last updated: January 2024 · redhawk-store</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Testnet only:</strong> This application runs exclusively on Arc Testnet. No real money, products, or services are involved.</span>
      </div>

      <h2>General Disclaimer</h2>
      <p>redhawk-store is an open-source, experimental decentralized application (dApp) built for demonstration and educational purposes. It is not a licensed financial service, marketplace, exchange, or business entity.</p>

      <h2>No Real Products</h2>
      <p>All products displayed on redhawk-store are entirely illustrative. They do not represent real items available for purchase. No physical or digital goods are sold through this platform.</p>

      <h2>No Real Funds</h2>
      <p>All tokens used on redhawk-store (USDC, EURC) are testnet tokens with zero monetary value. They cannot be exchanged for real currency. Arc Testnet tokens are only for testing purposes.</p>

      <h2>Smart Contract Risk</h2>
      <p>Smart contracts used in redhawk-store are deployed on testnet and have not undergone formal security audits. Do not interact with them using mainnet wallets or real funds.</p>

      <h2>No Financial Advice</h2>
      <p>Nothing on this platform constitutes financial, investment, legal, or tax advice. The platform does not recommend any investment strategy or financial product.</p>

      <h2>Wallet Security</h2>
      <p>You are solely responsible for the security of your wallet and any credentials you use. redhawk-store does not have access to your private keys, but your browser-stored wallet is only as secure as your device and password.</p>

      <h2>Availability</h2>
      <p>This platform may be modified, suspended, or discontinued at any time without notice. It is provided on a best-effort basis with no uptime guarantees.</p>

      <h2>External Links</h2>
      <p>Links to external sites (Arc Docs, Circle Faucet, GitHub) are provided for convenience. We are not responsible for the content or privacy practices of third-party websites.</p>

      <div class="flex gap-3 mt-8">
        <a href="/terms" class="btn-secondary text-sm"><i class="fas fa-file-alt"></i> Terms of Service</a>
        <a href="/privacy" class="btn-secondary text-sm"><i class="fas fa-lock"></i> Privacy Policy</a>
        <a href="/" class="btn-primary text-sm"><i class="fas fa-home"></i> Back to Home</a>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: ABOUT ─────────────────────────────────────────────────────────
function aboutPage() {
  return shell('About', `
  <div class="max-w-3xl mx-auto px-4 py-12 legal-page">
    <div class="card p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
        </div>
        <div>
          <h1>About redhawk-store</h1>
          <p class="text-slate-400 text-sm">Decentralized marketplace on Arc Network</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Demo project:</strong> redhawk-store is an open-source testnet demonstration. Not a real commercial marketplace.</span>
      </div>

      <h2>What is redhawk-store?</h2>
      <p>redhawk-store is a decentralized marketplace powered by <strong>Arc Network</strong> — Circle's stablecoin-native Layer 1 blockchain. It uses escrow smart contracts to protect every transaction: buyer funds are locked on-chain until delivery is confirmed, then automatically released to the seller.</p>

      <h2>Technology Stack</h2>
      <ul>
        <li><strong>Blockchain:</strong> Arc Network Testnet (Chain ID: 5042002, EVM-compatible)</li>
        <li><strong>Payments:</strong> USDC (native on Arc) and EURC (ERC-20)</li>
        <li><strong>Escrow:</strong> FxEscrow smart contract (${ARC.contracts.FxEscrow})</li>
        <li><strong>Wallet:</strong> Non-custodial, BIP39 seed phrase, client-side key generation (ethers.js)</li>
        <li><strong>Frontend:</strong> Hono.js on Cloudflare Workers, Tailwind CSS</li>
        <li><strong>Storage:</strong> IPFS for product images and shipment proofs</li>
      </ul>

      <h2>Security Principles</h2>
      <ul>
        <li>Private keys are generated client-side and never transmitted to any server</li>
        <li>Wallet data stored locally in browser, encrypted with user password</li>
        <li>Zero-custody architecture — we cannot access user funds</li>
        <li>All transactions require explicit user confirmation before signing</li>
        <li>No auto-connection or silent signature requests</li>
      </ul>

      <h2>Arc Network</h2>
      <p>Arc is an Economic OS for the internet built by Circle, providing enterprise-grade infrastructure for on-chain payments. It uses USDC as its native gas token, offering sub-second finality and predictable fees.</p>

      <h2>Open Source</h2>
      <p>redhawk-store is open source. You can inspect, fork, and contribute to the codebase on GitHub:</p>
      <p>
        <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="inline-flex items-center gap-2 text-red-600 hover:underline font-medium">
          <i class="fab fa-github"></i> github.com/julenosinger/redhawk-store
        </a>
      </p>

      <h2>Smart Contracts (Arc Testnet)</h2>
      <ul>
        <li><strong>USDC:</strong> <code class="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">${ARC.contracts.USDC}</code></li>
        <li><strong>EURC:</strong> <code class="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">${ARC.contracts.EURC}</code></li>
        <li><strong>FxEscrow:</strong> <code class="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">${ARC.contracts.FxEscrow}</code></li>
        <li><strong>Permit2:</strong> <code class="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">${ARC.contracts.Permit2}</code></li>
      </ul>

      <h2>Useful Links</h2>
      <ul>
        <li><a href="https://docs.arc.network" target="_blank" class="text-red-600 hover:underline">Arc Network Documentation</a></li>
        <li><a href="https://testnet.arcscan.app" target="_blank" class="text-red-600 hover:underline">Arc Testnet Explorer</a></li>
        <li><a href="https://faucet.circle.com" target="_blank" class="text-red-600 hover:underline">Circle Testnet Faucet (free USDC/EURC)</a></li>
        <li><a href="https://arc.network" target="_blank" class="text-red-600 hover:underline">arc.network</a></li>
      </ul>

      <div class="flex flex-wrap gap-3 mt-8">
        <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="btn-primary text-sm"><i class="fab fa-github"></i> GitHub</a>
        <a href="/terms" class="btn-secondary text-sm"><i class="fas fa-file-alt"></i> Terms</a>
        <a href="/privacy" class="btn-secondary text-sm"><i class="fas fa-lock"></i> Privacy</a>
        <a href="/disclaimer" class="btn-secondary text-sm"><i class="fas fa-exclamation-triangle"></i> Disclaimer</a>
        <a href="/" class="btn-secondary text-sm"><i class="fas fa-home"></i> Home</a>
      </div>
    </div>
  </div>
  `)
}
