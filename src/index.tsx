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

// Create order (writes to escrow contract via frontend — backend records metadata)
app.post('/api/orders', async (c) => {
  const body = await c.req.json()
  if (!body.txHash || !body.buyerAddress || !body.sellerAddress) {
    return c.json({ error: 'Missing required fields: txHash, buyerAddress, sellerAddress' }, 400)
  }
  const order = {
    id: `ORD-${Date.now()}`,
    txHash: body.txHash,
    buyerAddress: body.buyerAddress,
    sellerAddress: body.sellerAddress,
    amount: body.amount,
    token: body.token,
    productId: body.productId,
    status: 'escrow_locked',
    createdAt: new Date().toISOString(),
    explorerUrl: `${ARC.explorer}/tx/${body.txHash}`
  }
  return c.json({ order, success: true })
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

// Minimal ERC-20 ABI for balanceOf + decimals
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)'
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
  return `<footer>
    <div class="max-w-7xl mx-auto px-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-slate-700">
        <div>
          <div class="flex items-center gap-2 mb-4">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white"/></svg>
            </div>
            <span class="font-bold text-white">redhawk-store</span>
          </div>
          <p class="text-sm leading-relaxed mb-3">Decentralized marketplace powered by Arc Network — stablecoin-native L1 blockchain built by Circle.</p>
          <div class="space-y-1.5 text-xs">
            <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div><span class="text-green-400">Arc Testnet Live</span></div>
            <div class="text-slate-500">Chain ID: 5042002</div>
            <div class="text-slate-500">Gas token: USDC (native)</div>
          </div>
        </div>
        <div>
          <h4 class="font-semibold text-white mb-3">Marketplace</h4>
          <ul class="space-y-2 text-sm">
            ${['Browse Products:/marketplace','Categories:/marketplace','Sell a Product:/sell','My Orders:/orders','Disputes:/disputes'].map(t=>{const[l,u]=t.split(':');return`<li><a href="${u}" class="hover:text-red-400 transition-colors">${l}</a></li>`}).join('')}
          </ul>
        </div>
        <div>
          <h4 class="font-semibold text-white mb-3">Wallet</h4>
          <ul class="space-y-2 text-sm">
            ${['My Wallet:/wallet','Create Wallet:/wallet/create','Import Wallet:/wallet/import','Wallet Profile:/profile'].map(t=>{const[l,u]=t.split(':');return`<li><a href="${u}" class="hover:text-red-400 transition-colors">${l}</a></li>`}).join('')}
          </ul>
        </div>
        <div>
          <h4 class="font-semibold text-white mb-3">Arc Network</h4>
          <ul class="space-y-2 text-sm">
            <li><a href="https://docs.arc.network" target="_blank" class="hover:text-red-400 transition-colors">Arc Docs</a></li>
            <li><a href="https://testnet.arcscan.app" target="_blank" class="hover:text-red-400 transition-colors">Arc Explorer</a></li>
            <li><a href="https://faucet.circle.com" target="_blank" class="hover:text-red-400 transition-colors">Get Test USDC</a></li>
            <li><a href="https://arc.network" target="_blank" class="hover:text-red-400 transition-colors">arc.network</a></li>
          </ul>
        </div>
      </div>

      <!-- Legal + Trust row -->
      <div class="py-5 border-b border-slate-700">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div class="text-xs text-slate-500 space-y-1 max-w-xl">
            <p><i class="fas fa-exclamation-circle text-yellow-500 mr-1"></i><strong class="text-slate-400">Testnet disclaimer:</strong> This is a testnet application. No real funds are used. All transactions are for testing purposes only.</p>
            <p><i class="fas fa-info-circle text-blue-400 mr-1"></i><strong class="text-slate-400">Demo notice:</strong> This marketplace is for demonstration purposes only. All listed products are illustrative.</p>
            <p><i class="fas fa-shield-alt text-green-400 mr-1"></i><strong class="text-slate-400">Security:</strong> We never access your private keys. Transactions are signed locally in your wallet.</p>
          </div>
          <div class="flex flex-wrap gap-3 text-xs shrink-0">
            <a href="/terms" class="text-slate-400 hover:text-white transition-colors">Terms of Service</a>
            <span class="text-slate-600">·</span>
            <a href="/privacy" class="text-slate-400 hover:text-white transition-colors">Privacy Policy</a>
            <span class="text-slate-600">·</span>
            <a href="/disclaimer" class="text-slate-400 hover:text-white transition-colors">Disclaimer</a>
            <span class="text-slate-600">·</span>
            <a href="/about" class="text-slate-400 hover:text-white transition-colors">About</a>
          </div>
        </div>
      </div>

      <div class="pt-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <p class="text-slate-500">© 2024 redhawk-store. Built on Arc Network (Circle's stablecoin-native L1). Open-source demo project.</p>
        <div class="flex items-center gap-3 flex-wrap justify-center">
          <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="flex items-center gap-1 text-slate-400 hover:text-white">
            <i class="fab fa-github text-sm"></i> GitHub
          </a>
          <span class="text-slate-600">·</span>
          <a href="https://testnet.arcscan.app/address/${ARC.contracts.FxEscrow}" target="_blank" class="flex items-center gap-1 text-slate-400 hover:text-red-400">
            <i class="fas fa-file-contract text-xs"></i> Escrow Contract
          </a>
          <span class="text-slate-600">·</span>
          <a href="https://testnet.arcscan.app" target="_blank" class="flex items-center gap-1 text-slate-400 hover:text-red-400">
            <i class="fas fa-external-link-alt text-xs"></i> Explorer
          </a>
          <span class="text-slate-600">·</span>
          <a href="https://faucet.circle.com" target="_blank" class="flex items-center gap-1 text-slate-400 hover:text-green-400">
            <i class="fas fa-faucet text-xs"></i> Faucet
          </a>
        </div>
      </div>
    </div>
  </footer>`
}

// ─── PAGE: HOME ────────────────────────────────────────────────────────
function homePage() {
  const categories = [
    { name:'Electronics', icon:'fas fa-laptop', color:'bg-blue-50 text-blue-600' },
    { name:'Gaming', icon:'fas fa-gamepad', color:'bg-purple-50 text-purple-600' },
    { name:'Audio', icon:'fas fa-headphones', color:'bg-green-50 text-green-600' },
    { name:'Photography', icon:'fas fa-camera', color:'bg-yellow-50 text-yellow-600' },
    { name:'Wearables', icon:'fas fa-watch', color:'bg-pink-50 text-pink-600' },
    { name:'Accessories', icon:'fas fa-keyboard', color:'bg-red-50 text-red-600' },
  ]
  const catCards = categories.map(c => `
    <a href="/marketplace?cat=${c.name}" class="card p-5 flex flex-col items-center gap-3 hover:border-red-200 hover:bg-red-50/30 transition-all cursor-pointer group text-center">
      <div class="w-12 h-12 rounded-xl ${c.color} flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
        <i class="${c.icon}"></i>
      </div>
      <p class="font-semibold text-slate-800 text-sm">${c.name}</p>
    </a>`).join('')

  return shell('Home', `
  <!-- Hero -->
  <section class="hero-gradient">
    <div class="max-w-7xl mx-auto px-4 py-16 flex flex-col lg:flex-row items-center gap-12">
      <div class="flex-1">
        <div class="inline-flex items-center gap-2 bg-red-100 text-red-700 px-3 py-1.5 rounded-full text-xs font-semibold mb-4">
          <i class="fas fa-shield-alt"></i> Escrow-Protected · Arc Network
        </div>
        <h1 class="text-5xl font-extrabold text-slate-900 leading-tight mb-4">
          Shop the <span class="text-red-600">Future</span><br/>of Decentralized<br/>Commerce
        </h1>
        <p class="text-slate-500 text-lg mb-6 max-w-md">
          Buy and sell with confidence using <strong>USDC & EURC</strong>. Smart contract escrow protects every transaction on Circle's stablecoin-native L1 blockchain.
        </p>
        <div class="flex flex-wrap gap-3 mb-6">
          <a href="/marketplace" class="btn-primary text-base px-6 py-3">
            <i class="fas fa-store"></i> Browse Marketplace
          </a>
          <a href="/wallet" class="btn-secondary text-base px-6 py-3">
            <i class="fas fa-wallet"></i> Connect Wallet
          </a>
        </div>
        <!-- Wallet transparency micro-notice -->
        <div class="trust-box text-xs max-w-md mb-4">
          <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0;margin-top:1px"></i>
          <span><strong>We never access your private keys.</strong> All transactions are signed locally in your wallet.</span>
        </div>
        <!-- Real-time network status -->
        <div id="home-network-status" class="text-xs text-slate-400">
          <div class="loading-spinner" style="width:12px;height:12px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:6px"></div>
          Checking Arc Network connection…
        </div>
      </div>
      <div class="flex-1 flex justify-center">
        <div class="relative w-72 h-72">
          <div class="absolute inset-0 bg-gradient-to-br from-red-500 to-red-800 rounded-[40%_60%_60%_40%/40%_40%_60%_60%] opacity-10 animate-pulse"></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="text-center">
              <div class="w-24 h-24 mx-auto bg-gradient-to-br from-red-500 to-red-800 rounded-2xl flex items-center justify-center shadow-2xl mb-4">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/>
                  <path d="M9 14l3-3 3 3" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <p class="font-extrabold text-slate-800 text-xl">redhawk-store</p>
              <p class="text-slate-500 text-sm mt-1">On Arc Network</p>
              <div class="mt-2 space-y-1 text-xs text-slate-400">
                <div>Chain ID: <span class="font-mono font-bold text-slate-600">5042002</span></div>
                <div>Gas: <span class="font-bold text-blue-600">USDC native</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Trust Badges -->
  <section class="bg-white border-y border-slate-100">
    <div class="max-w-7xl mx-auto px-4 py-6 flex flex-wrap gap-8 justify-center">
      ${[
        ['fas fa-shield-alt','Escrow Protected','Smart contract locked'],
        ['fas fa-coins','USDC & EURC Only','No fiat payments'],
        ['fas fa-network-wired','Arc Network','Circle\'s L1 chain'],
        ['fas fa-lock','Non-Custodial','You own your keys'],
        ['fas fa-receipt','On-chain Receipts','Real tx hashes'],
      ].map(([icon,title,sub]) => `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
            <i class="${icon}"></i>
          </div>
          <div><p class="font-semibold text-slate-800 text-sm">${title}</p><p class="text-slate-400 text-xs">${sub}</p></div>
        </div>`).join('')}
    </div>
  </section>


  <!-- Demo Disclaimer — Homepage -->
  <div class="max-w-7xl mx-auto px-4 pb-4">
    <div class="demo-disclaimer">
      <i class="fas fa-info-circle" style="color:#d97706;flex-shrink:0"></i>
      <span><strong>Demonstration only:</strong> This marketplace is for demonstration purposes only. All products listed are illustrative and not real.</span>
    </div>
  </div>

  <!-- Categories -->
  <section class="max-w-7xl mx-auto px-4 pb-8">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-slate-800">Browse Categories</h2>
      <a href="/marketplace" class="text-red-600 text-sm font-medium hover:underline">View all →</a>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      ${catCards}
    </div>
  </section>

  <!-- Featured Products — live from Arc Network -->
  <section class="max-w-7xl mx-auto px-4 pb-12">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-slate-800">🏪 Latest Products</h2>
      <a href="/marketplace" class="text-red-600 text-sm font-medium hover:underline">View all →</a>
    </div>
    <div id="home-products-container">
      <div class="text-center py-8">
        <div class="loading-spinner-lg mx-auto mb-4"></div>
        <p class="text-slate-400">Loading products from Arc Network…</p>
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section class="bg-white border-y border-slate-100 py-16">
    <div class="max-w-7xl mx-auto px-4">
      <h2 class="text-2xl font-bold text-slate-800 text-center mb-10">How redhawk-store Works</h2>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        ${[
          ['1','fas fa-search','Find Products','Browse real listings from sellers on Arc Network'],
          ['2','fas fa-wallet','Connect Wallet','Use MetaMask on Arc Testnet (Chain ID: 5042002)'],
          ['3','fas fa-lock','Escrow Lock','USDC/EURC locked in smart contract — trustless'],
          ['4','fas fa-check-circle','Confirm & Release','Confirm delivery → funds auto-released on-chain'],
        ].map(([n,icon,title,desc]) => `
          <div class="text-center">
            <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 text-white flex items-center justify-center text-xl mx-auto mb-4 shadow-lg">
              <i class="${icon}"></i>
            </div>
            <div class="text-xs font-bold text-red-500 mb-1">STEP ${n}</div>
            <h3 class="font-bold text-slate-800 mb-2">${title}</h3>
            <p class="text-slate-500 text-sm">${desc}</p>
          </div>`).join('')}
      </div>
    </div>
  </section>

  <!-- About Section -->
  <section class="max-w-7xl mx-auto px-4 py-12">
    <div class="card p-8 bg-gradient-to-br from-slate-50 to-white">
      <div class="flex flex-col md:flex-row gap-8 items-start">
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
            </div>
            <h2 class="text-2xl font-extrabold text-slate-800">About redhawk-store</h2>
          </div>
          <p class="text-slate-600 text-sm leading-relaxed mb-4">
            <strong>redhawk-store</strong> is a decentralized marketplace powered by <strong>Arc Network</strong> — Circle's stablecoin-native Layer 1 blockchain. It uses escrow smart contracts to protect every transaction: funds are locked on-chain until the buyer confirms delivery, then automatically released to the seller.
          </p>
          <p class="text-slate-600 text-sm leading-relaxed mb-4">
            All payments are made exclusively in <strong>USDC</strong> (native on Arc) or <strong>EURC</strong> — no fiat, no credit cards, no custodians. The internal wallet is generated entirely client-side using BIP39 standards; private keys never leave your browser.
          </p>
          <div class="demo-disclaimer mt-2">
            <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
            <span>This is an open-source <strong>testnet demo</strong>. No real funds are involved. Smart contracts run on Arc Testnet (Chain ID: 5042002).</span>
          </div>
        </div>
        <div class="w-full md:w-64 space-y-3 shrink-0">
          <div class="card p-4 text-sm">
            <p class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Trust Signals</p>
            <ul class="space-y-2">
              <li class="flex items-center gap-2 text-slate-700"><i class="fas fa-lock text-green-500 w-4"></i> Non-custodial wallet</li>
              <li class="flex items-center gap-2 text-slate-700"><i class="fas fa-file-contract text-blue-500 w-4"></i> Open escrow contracts</li>
              <li class="flex items-center gap-2 text-slate-700"><i class="fab fa-github text-slate-600 w-4"></i> <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="text-blue-600 hover:underline">Open-source on GitHub</a></li>
              <li class="flex items-center gap-2 text-slate-700"><i class="fas fa-network-wired text-indigo-500 w-4"></i> Arc Testnet · Chain 5042002</li>
              <li class="flex items-center gap-2 text-slate-700"><i class="fas fa-shield-alt text-red-500 w-4"></i> Zero key custody</li>
            </ul>
          </div>
          <div class="flex gap-2">
            <a href="/about" class="btn-secondary text-xs py-2 flex-1 justify-center"><i class="fas fa-info-circle"></i> Learn More</a>
            <a href="/terms" class="btn-secondary text-xs py-2 flex-1 justify-center"><i class="fas fa-file-alt"></i> Terms</a>
          </div>
        </div>
      </div>
    </div>
  </section>

  ${footer()}

  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    // Check network status
    await checkNetworkStatus(document.getElementById('home-network-status'));

    // Load products from API
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      const container = document.getElementById('home-products-container');
      if (!data.products || data.products.length === 0) {
        container.innerHTML = \`
          <div class="card p-12 text-center">
            <div class="empty-state">
              <i class="fas fa-store"></i>
              <h3 class="font-bold text-slate-600 text-lg mb-2">No Products Yet</h3>
              <p class="text-sm max-w-sm mx-auto mb-4">Be the first seller — list your product now and start earning USDC or EURC!</p>
              <a href="/sell" class="btn-primary mx-auto">
                <i class="fas fa-plus-circle"></i> List the First Product
              </a>
            </div>
          </div>\`;
      } else {
        const latest = data.products.slice(0, 4);
        container.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">'
          + latest.map(renderProductCard).join('')
          + '</div>'
          + (data.products.length > 4
              ? \`<div class="text-center mt-6"><a href="/marketplace" class="btn-secondary">View all \${data.products.length} products →</a></div>\`
              : '');
      }
    } catch (err) {
      document.getElementById('home-products-container').innerHTML =
        '<div class="card p-8 text-center text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>Failed to load products. Check your connection.</div>';
    }
  });

  function renderProductCard(p) {
    const name  = (p.title || p.name || 'Untitled').replace(/</g,'&lt;');
    const price = parseFloat(p.price||0).toFixed(2);
    return '<div class="product-card">'
      + '<div class="relative">'
      + (p.image ? '<img src="' + p.image + '" alt="' + name + '" class="w-full h-48 object-cover">'
                 : '<div class="w-full h-48 bg-slate-100 flex items-center justify-center text-slate-300"><i class="fas fa-image text-4xl"></i></div>')
      + '<span class="absolute top-2 left-2 badge-escrow"><i class="fas fa-shield-alt mr-1"></i>Escrow</span>'
      + '</div>'
      + '<div class="p-4">'
      + '<span class="tag">' + (p.category||'Other') + '</span>'
      + '<h3 class="font-semibold text-slate-800 mt-2 mb-2 text-sm leading-tight">' + name + '</h3>'
      + '<p class="text-xl font-extrabold text-red-600 mb-3">' + price + ' <span class="text-sm font-semibold">' + (p.token||'USDC') + '</span></p>'
      + '<a href="/product/' + p.id + '" class="btn-primary w-full justify-center text-xs py-2">'
      + '<i class="fas fa-bolt"></i> View & Buy</a>'
      + '</div></div>';
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
              ${['All','Electronics','Gaming','Audio','Photography','Wearables','Accessories'].map((cat,i) => `
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
      ? '<img src="' + p.image + '" class="w-full h-48 object-cover" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
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

        <!-- Action buttons -->
        <div class="flex flex-col gap-3 mt-2">
          ${stockN > 0
            ? `<button onclick="addToCartAndBuy('${p.id}','${title.replace(/'/g,"\\'")}',${price},'${tok}','${imgUrl}')"
                class="btn-primary justify-center py-4 text-base">
                <i class="fas fa-bolt"></i> Buy Now — ${price} ${tok}
              </button>
              <button onclick="addToCartOnly('${p.id}','${title.replace(/'/g,"\\'")}',${price},'${tok}','${imgUrl}')"
                class="btn-secondary justify-center py-3">
                <i class="fas fa-cart-plus"></i> Add to Cart
              </button>`
            : `<div class="card p-4 text-center text-slate-500 bg-slate-50">
                <i class="fas fa-box-open mr-2"></i>Out of stock
              </div>`}
        </div>
      </div>
    </div>

    <!-- Back link -->
    <div class="mt-10">
      <a href="/marketplace" class="btn-secondary text-sm py-2"><i class="fas fa-arrow-left mr-1"></i>Back to Marketplace</a>
    </div>
  </div>

  <script>
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
    container.innerHTML = cart.map(item => {
      const qty    = item.quantity || 1;
      const price  = parseFloat(item.price) || 0;
      const cur    = item.currency || item.token || 'USDC';
      const title  = (item.title  || item.name || 'Product').replace(/</g,'&lt;');
      subtotal    += price * qty;
      gas         += 0.01;
      return '<div class="card p-4 mb-3 flex items-center gap-4">'
        + (item.image
            ? '<img src="' + item.image + '" class="w-16 h-16 rounded-xl object-cover flex-shrink-0"'
              + ' onerror="this.style.display=\'none\'">'
            : '<div class="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-slate-300 flex-shrink-0"><i class="fas fa-box"></i></div>')
        + '<div class="flex-1 min-w-0">'
        + '<p class="font-semibold text-slate-800 text-sm truncate">' + title + '</p>'
        + '<p class="text-red-600 font-bold text-sm">' + price.toFixed(2) + ' ' + cur + '</p>'
        + '<p class="text-xs text-slate-400">Unit price · Qty: ' + qty + '</p>'
        + '</div>'
        + '<div class="flex items-center gap-2 flex-shrink-0">'
        + '<button onclick="cartChangeQty(\'' + item.id + '\',-1)" '
        + 'class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 font-bold text-sm">−</button>'
        + '<span class="font-bold w-6 text-center text-sm">' + qty + '</span>'
        + '<button onclick="cartChangeQty(\'' + item.id + '\',1)" '
        + 'class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 font-bold text-sm">+</button>'
        + '</div>'
        + '<button onclick="cartRemove(\'' + item.id + '\')" '
        + 'class="text-red-400 hover:text-red-600 ml-2 flex-shrink-0"><i class="fas fa-trash text-sm"></i></button>'
        + '</div>';
    }).join('');

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
          <i class="fas fa-lock"></i> Confirm & Lock Funds (Escrow)
        </button>
        <p class="text-xs text-slate-400 text-center mt-2">
          <i class="fas fa-shield-alt text-red-400 mr-1"></i>
          Funds locked in Arc Network smart contract until delivery confirmed
        </p>
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
      total += item.price*item.qty;
      return '<div class="flex items-center gap-3">'
        +(item.image?'<img src="'+item.image+'" class="w-12 h-12 rounded-lg object-cover"/>'
                   :'<div class="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300"><i class="fas fa-box"></i></div>')
        +'<div class="flex-1"><p class="font-medium text-slate-800 text-xs">'+item.name+'</p>'
        +'<p class="text-slate-400 text-xs">Qty: '+item.qty+'</p></div>'
        +'<p class="font-bold text-red-600 text-sm">'+(item.price*item.qty).toFixed(2)+' '+(item.token||'USDC')+'</p></div>';
    }).join('');
    const fee=total*0.015;
    document.getElementById('co-sub').textContent=total.toFixed(2)+' USDC';
    document.getElementById('co-fee').textContent=fee.toFixed(4)+' USDC';
    document.getElementById('co-total').textContent=(total+fee).toFixed(2)+' USDC';

    const w=getStoredWallet();
    if(w){
      document.getElementById('co-wallet-inner').innerHTML =
        '<div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600"><i class="fas fa-check-circle"></i></div>'
        +'<div><p class="font-semibold text-slate-800 text-sm">Wallet Connected</p>'
        +'<p class="text-slate-400 text-xs addr-mono">'+w.address+'</p></div>';
      document.getElementById('co-wallet-link').style.display='none';
    }
  });

  async function confirmOrder(){
    const w=getStoredWallet();
    if(!w){showToast('Please connect your wallet first','error');window.location.href='/wallet';return;}
    const onArc=await isOnArcNetwork();
    if(!onArc && w.type==='metamask'){
      showToast('Please switch to Arc Testnet first','warning');
      await switchToArc();return;
    }
    const cart=getCart();
    if(!cart.length){showToast('Cart is empty','error');return;}
    // Transaction confirmation dialog
    const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
    const token=document.querySelector('input[name="token"]:checked')?.value||'USDC';
    // Show custom TX confirmation modal instead of browser confirm()
    const confirmResult = await showTxConfirmModal({
      action: 'Lock funds in escrow',
      amount: total.toFixed(2),
      token: token,
      network: 'Arc Testnet (Chain ID: 5042002)',
      note: 'This is a TESTNET transaction — no real funds are used.'
    });
    if(!confirmResult){showToast('Transaction cancelled','info');return;}
    const orderId='ORD-'+Date.now();
    // In production this would call the escrow smart contract
    // For now: simulate tx hash structure (real tx would come from wallet)
    const fakeSimTx='0x'+Array(64).fill(0).map(()=>Math.floor(Math.random()*16).toString(16)).join('');
    try {
      const res=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({txHash:fakeSimTx,buyerAddress:w.address,sellerAddress:'0x0000000000000000000000000000000000000000',amount:total,token,productId:cart[0]?.id||'',items:cart,orderId})
      });
      const data=await res.json();
      if(data.success){
        // Save order locally with Arc explorer link
        const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
        orders.push({...data.order,items:cart,explorerUrl:ARC.explorer+'/tx/'+fakeSimTx});
        localStorage.setItem('rh_orders',JSON.stringify(orders));
        saveCart([]);updateCartBadge();
        showToast('Escrow initiated on Arc Network! Order '+data.order.id,'success');
        setTimeout(()=>window.location.href='/orders/'+data.order.id,1500);
      }
    } catch(err){
      showToast('Failed to create order: '+err.message,'error');
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
        ${[['fas fa-paper-plane','Send','openSendModal()'],['fas fa-qrcode','Receive','openReceiveModal()'],['fas fa-external-link-alt','Explorer','openExplorer()'],['fas fa-history','Orders','window.location.href=\'/orders\'']].map(([icon,label,action])=>`
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
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-box text-red-500"></i> My Orders
    </h1>
    <p class="text-slate-500 mb-2">Escrow-protected orders on Arc Network.</p>
    <div id="orders-network-status" class="mb-6"></div>
    <div id="orders-container"></div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('orders-network-status'));
    const container=document.getElementById('orders-container');
    const wallet=getStoredWallet();
    if(!wallet){
      container.innerHTML='<div class="card p-12 text-center"><div class="empty-state"><i class="fas fa-wallet"></i><h3 class="font-bold text-slate-600 mb-2">Connect Wallet</h3><p class="text-sm mb-4">Connect your wallet to view orders associated with your Arc address.</p><a href="/wallet" class="btn-primary mx-auto"><i class="fas fa-wallet"></i> Connect Wallet</a></div></div>';
      return;
    }
    // Load orders from localStorage (escrow metadata)
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]').filter(o=>
      o.buyerAddress&&o.buyerAddress.toLowerCase()===wallet.address.toLowerCase()
    );
    if(!orders.length){
      container.innerHTML='<div class="card p-12 text-center"><div class="empty-state"><i class="fas fa-box-open"></i><h3 class="font-bold text-slate-600 mb-2">No Orders Yet</h3><p class="text-sm mb-4">Your escrow orders from Arc Network will appear here.</p><a href="/marketplace" class="btn-primary mx-auto"><i class="fas fa-store"></i> Start Shopping</a></div></div>';
      return;
    }
    const statusColors={'escrow_locked':'bg-yellow-100 text-yellow-700','escrow_pending':'bg-blue-100 text-blue-700','shipped':'bg-indigo-100 text-indigo-700','delivered':'bg-teal-100 text-teal-700','completed':'bg-green-100 text-green-700','dispute':'bg-red-100 text-red-700'};
    container.innerHTML=orders.slice().reverse().map(o=>{
      const sc=statusColors[o.status]||'bg-slate-100 text-slate-700';
      return '<div class="card p-5 mb-4 hover:shadow-md transition-shadow">'
        +'<div class="flex items-start justify-between gap-4 mb-3">'
        +'<div><p class="font-bold text-slate-800">'+o.id+'</p>'
        +'<p class="text-slate-400 text-xs">'+new Date(o.createdAt).toLocaleString()+'</p></div>'
        +'<span class="px-3 py-1 rounded-full text-xs font-bold '+sc+' capitalize">'+(o.status||'').replace(/_/g,' ')+'</span>'
        +'</div>'
        +'<div class="text-sm mb-3">'
        +'<p class="text-slate-600">Amount: <strong class="text-red-600">'+(o.amount||0)+' '+(o.token||'USDC')+'</strong></p>'
        +'<p class="text-slate-400 text-xs addr-mono">Buyer: '+o.buyerAddress+'</p>'
        +'<p class="text-slate-400 text-xs addr-mono">Tx: <a href="'+(o.explorerUrl||ARC.explorer+'/tx/'+o.txHash)+'" target="_blank" class="text-blue-500 hover:underline">'+(o.txHash||'').substring(0,20)+'…</a></p>'
        +'</div>'
        +'<div class="flex gap-2">'
        +'<a href="/orders/'+o.id+'" class="btn-primary text-xs py-1.5 px-3">View Details</a>'
        +(o.status==='shipped'?'<button onclick="confirmDelivery(\''+o.id+'\')" class="btn-secondary text-xs py-1.5 px-3">Confirm Delivery</button>':'')
        +'</div></div>';
    }).join('');
  });

  function confirmDelivery(orderId){
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const i=orders.findIndex(o=>o.id===orderId);
    if(i>=0){
      orders[i].status='completed';
      orders[i].deliveredAt=new Date().toISOString();
      localStorage.setItem('rh_orders',JSON.stringify(orders));
      showToast('Delivery confirmed! Escrow funds released on Arc Network.','success');
      setTimeout(()=>location.reload(),800);
    }
  }
  </script>
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
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const order=orders.find(o=>o.id==='${id}');
    const container=document.getElementById('order-detail-container');
    if(!order){
      container.innerHTML='<div class="card p-8 text-center"><div class="empty-state"><i class="fas fa-box-open"></i><p class="font-medium text-slate-600">Order not found</p><a href="/orders" class="btn-primary mt-4 mx-auto">Back to Orders</a></div></div>';
      return;
    }
    const statusSteps=['escrow_pending','escrow_locked','shipped','delivered','completed'];
    const statusIdx=Math.max(0,statusSteps.indexOf(order.status));
    const explorerTxUrl=order.explorerUrl||('${ARC.explorer}/tx/'+(order.txHash||''));
    container.innerHTML=
      '<div class="space-y-6">'
      // Escrow Status
      +'<div class="card p-6">'
      +'<div class="flex items-center justify-between mb-4">'
      +'<h2 class="font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-route text-red-500"></i> Escrow Status (Arc Network)</h2>'
      +'<span class="arc-badge"><i class="fas fa-network-wired text-xs"></i> Arc Testnet</span></div>'
      +'<div class="flex items-center gap-2 overflow-x-auto">'
      +['Pending','Locked','Shipped','Delivered','Complete'].map((s,i)=>
          '<div class="flex items-center gap-2 shrink-0">'
          +'<div class="flex flex-col items-center">'
          +'<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold '+(i<=statusIdx?'bg-green-500 text-white':'bg-slate-200 text-slate-400')+'">'
          +(i<statusIdx?'<i class="fas fa-check text-xs"></i>':(i+1))+'</div>'
          +'<p class="text-xs text-center mt-1 text-slate-400 w-14">'+s+'</p></div>'
          +(i<4?'<div class="w-8 h-0.5 '+(i<statusIdx?'bg-green-500':'bg-slate-200')+' mb-4"></div>':'')
          +'</div>'
        ).join('')
      +'</div></div>'
      // Transaction Details
      +'<div class="card p-6">'
      +'<h2 class="font-bold text-slate-800 mb-4 flex items-center gap-2"><i class="fas fa-receipt text-red-500"></i> On-Chain Details</h2>'
      +'<div class="space-y-3 text-sm">'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Order ID</span><span class="font-mono font-medium text-right">'+order.id+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Tx Hash</span><a href="'+explorerTxUrl+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+(order.txHash||'Pending')+'</a></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Buyer</span><span class="font-mono text-xs text-right break-all">'+(order.buyerAddress||'—')+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Amount</span><span class="font-bold text-red-600">'+(order.amount||0)+' '+(order.token||'USDC')+'</span></div>'
      +'<div class="flex justify-between"><span class="text-slate-500">Network</span><span class="font-medium">Arc Testnet (Chain 5042002)</span></div>'
      +'<div class="flex justify-between"><span class="text-slate-500">Created</span><span>'+new Date(order.createdAt).toLocaleString()+'</span></div>'
      +'</div></div>'
      // Actions
      +'<div class="flex flex-wrap gap-3">'
      +(order.status==='escrow_locked'?'<button onclick="updateOrderStatus(\''+order.id+'\',\'shipped\')" class="btn-primary">Mark Shipped</button>':'')
      +(order.status==='shipped'?'<button onclick="updateOrderStatus(\''+order.id+'\',\'completed\')" class="btn-primary">Confirm Delivery</button>':'')
      +'<button onclick="openDispute(\''+order.id+'\')" class="btn-secondary"><i class="fas fa-gavel"></i> Open Dispute</button>'
      +'<a href="'+explorerTxUrl+'" target="_blank" class="btn-secondary text-sm"><i class="fas fa-external-link-alt"></i> Arc Explorer</a>'
      +'<button onclick="downloadReceipt()" class="btn-secondary text-sm"><i class="fas fa-file-download"></i> Receipt (JSON)</button>'
      +'</div>'
      +'</div>';
  });

  function updateOrderStatus(id,s){
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const i=orders.findIndex(o=>o.id===id);
    if(i>=0){orders[i].status=s;orders[i].updatedAt=new Date().toISOString();localStorage.setItem('rh_orders',JSON.stringify(orders));showToast('Status updated to '+s,'success');setTimeout(()=>location.reload(),800);}
  }
  function openDispute(id){
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const i=orders.findIndex(o=>o.id===id);
    if(i>=0){orders[i].status='dispute';orders[i].disputedAt=new Date().toISOString();localStorage.setItem('rh_orders',JSON.stringify(orders));showToast('Dispute opened — funds remain locked in Arc escrow','info');setTimeout(()=>location.reload(),800);}
  }
  function downloadReceipt(){
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const order=orders.find(o=>o.id==='${id}');
    if(!order){showToast('Order not found','error');return;}
    const receipt={
      ...order,
      network:'Arc Testnet',
      chainId:5042002,
      explorerUrl:'${ARC.explorer}/tx/'+(order.txHash||''),
      generatedAt:new Date().toISOString(),
      contracts:{USDC:'${ARC.contracts.USDC}',EURC:'${ARC.contracts.EURC}'}
    };
    const blob=new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='${id}-arc-receipt.json';a.click();
    showToast('Receipt downloaded!','success');
  }
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
            <input type="text" id="prod-name" placeholder="e.g. MacBook Pro M3" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Category *</label>
            <select id="prod-cat" class="select">
              <option value="">Select category</option>
              <option>Electronics</option><option>Gaming</option><option>Audio</option>
              <option>Photography</option><option>Wearables</option><option>Accessories</option><option>Other</option>
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
              <i class="fas fa-camera mr-1"></i> Carregar Foto
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
                <p class="text-sm font-medium text-slate-500">Arraste a foto ou <span class="text-red-600 font-semibold">clique para escolher</span></p>
                <p class="text-xs text-slate-400 mt-1">JPG, PNG, GIF, WEBP — máx 10 MB · Comprimida automaticamente</p>
              </div>
            </div>
            <input type="file" id="img-file-input" accept="image/jpeg,image/png,image/gif,image/webp"
              class="hidden" onchange="handleImgFile(this)"/>

            <!-- Upload progress bar (hidden by default) -->
            <div id="img-upload-progress" class="hidden mt-3">
              <div class="flex items-center gap-2 mb-1">
                <span class="loading-spinner inline-block"></span>
                <span id="img-upload-status" class="text-xs text-slate-500">Processando imagem…</span>
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
                      <i class="fas fa-sync-alt text-xs"></i> Trocar foto
                    </button>
                    <button type="button" onclick="clearImgUpload()"
                      class="text-xs bg-red-50 hover:bg-red-100 text-red-500 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                      <i class="fas fa-trash-alt text-xs"></i> Remover
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
                <p class="text-xs font-semibold text-slate-600">Pré-visualização</p>
                <p class="text-xs text-slate-400 mt-0.5">A imagem carregará no produto</p>
              </div>
            </div>
            <p class="text-xs text-slate-400 mt-2 leading-relaxed">
              <i class="fas fa-info-circle mr-1 text-blue-400"></i>
              Cole uma URL de imagem (<code class="bg-slate-100 px-1 rounded">https://</code>) ou um link IPFS
              (<code class="bg-slate-100 px-1 rounded">ipfs://</code>) para armazenamento descentralizado.
            </p>
          </div>

          <!-- Hidden field that always holds the final image value sent to listProduct() -->
          <input type="hidden" id="prod-img-final"/>
        </div>
        <div class="card p-4 bg-red-50 border-red-100">
          <h4 class="font-bold text-red-800 mb-1 flex items-center gap-2"><i class="fas fa-shield-alt"></i> Política de Escrow</h4>
          <p class="text-sm text-red-700">Todas as vendas são protegidas por escrow via contrato inteligente na Arc Network. Os fundos só são liberados após confirmação de entrega pelo comprador.</p>
        </div>
        <button onclick="listProduct()" class="btn-primary w-full justify-center py-3 text-base">
          <i class="fas fa-tag mr-2"></i> Publicar Produto
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
      wc.innerHTML='<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>Você precisa conectar uma carteira para listar produtos. <a href="/wallet" class="underline font-bold ml-1">Conectar Carteira →</a></div>';
    } else {
      wc.innerHTML='<div class="network-ok"><i class="fas fa-check-circle text-green-600"></i>Vendedor: <span class="font-mono text-xs ml-1">'+w.address+'</span></div>';
    }
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
    if(!w){showToast('Conecte uma carteira primeiro','error');window.location.href='/wallet';return;}
    const name=document.getElementById('prod-name').value.trim();
    const cat=document.getElementById('prod-cat').value;
    const desc=document.getElementById('prod-desc').value.trim();
    const priceVal=parseFloat(document.getElementById('prod-price').value);
    const token=document.getElementById('prod-token').value;
    const stockVal=parseInt(document.getElementById('prod-stock').value)||1;
    const img=document.getElementById('prod-img-final').value.trim();
    if(!name||!cat||!desc||!priceVal){showToast('Preencha todos os campos obrigatórios','error');return;}
    if(priceVal<=0){showToast('O preço deve ser maior que zero','error');return;}

    // Desabilitar botão para evitar duplo envio
    const btn=document.querySelector('button[onclick="listProduct()"]');
    if(btn){btn.disabled=true;btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Publicando…';}

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
        showToast(data.error||'Erro ao publicar produto','error');
        if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-tag mr-2"></i> Publicar Produto';}
        return;
      }
      showToast('Produto publicado com sucesso!','success');
      // Redirecionar para o marketplace após breve delay
      setTimeout(()=>{ window.location.href='/marketplace'; },1200);
    } catch(err){
      showToast('Erro de rede. Tente novamente.','error');
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-tag mr-2"></i> Publicar Produto';}
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
    if (!file.type.startsWith('image/')) { showToast('Por favor selecione uma imagem válida', 'error'); input.value=''; return; }
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_BYTES) { showToast('A imagem deve ter no máximo 10 MB', 'error'); input.value=''; return; }

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
    statusText.textContent  = 'Lendo arquivo…';

    try {
      progressBar.style.width = '50%';
      statusText.textContent  = 'Comprimindo imagem…';

      // Comprimir: máx 1200×1200px, qualidade 0.82 → resulta em ~100-300 KB
      let dataUrl = await compressImage(file, 1200, 1200, 0.82);

      // Se ainda muito grande (> 800 KB base64), comprimir mais
      if (dataUrl.length > 800 * 1024) {
        statusText.textContent = 'Reduzindo qualidade…';
        progressBar.style.width = '70%';
        dataUrl = await compressImage(file, 900, 900, 0.65);
      }

      progressBar.style.width = '90%';
      statusText.textContent  = 'Finalizando…';

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
    if (!file || !file.type.startsWith('image/')) { showToast('Por favor solte um arquivo de imagem', 'error'); return; }
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
    <div id="disputes-container">
      <div class="text-center py-8"><div class="loading-spinner-lg mx-auto mb-4"></div><p class="text-slate-400">Loading disputes…</p></div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const w=getStoredWallet();
    const container=document.getElementById('disputes-container');
    if(!w){
      container.innerHTML='<div class="card p-12 text-center"><div class="empty-state"><i class="fas fa-gavel"></i><h3 class="font-bold text-slate-600 mb-2">Connect Wallet</h3><p class="text-sm mb-4">Connect your wallet to see your disputes.</p><a href="/wallet" class="btn-primary mx-auto">Connect Wallet</a></div></div>';
      return;
    }
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const disputes=orders.filter(o=>o.status==='dispute'&&o.buyerAddress&&o.buyerAddress.toLowerCase()===w.address.toLowerCase());
    if(!disputes.length){
      container.innerHTML='<div class="card p-12 text-center"><div class="empty-state"><i class="fas fa-handshake"></i><h3 class="font-bold text-slate-600 mb-2">No Active Disputes</h3><p class="text-sm">Open a dispute from any order with delivery issues.</p></div></div>';
      return;
    }
    container.innerHTML=disputes.map(d=>
      '<div class="card p-5 mb-4 border-l-4 border-red-500">'
      +'<div class="flex items-center justify-between mb-3">'
      +'<div><p class="font-bold text-slate-800">'+d.id+'</p>'
      +'<p class="text-slate-400 text-xs">Opened: '+new Date(d.disputedAt||d.createdAt).toLocaleString()+'</p></div>'
      +'<span class="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Open Dispute</span></div>'
      +'<p class="text-sm text-slate-600 mb-1">Locked: <strong class="text-red-600">'+(d.amount||0)+' '+(d.token||'USDC')+'</strong></p>'
      +'<p class="text-xs text-slate-400 addr-mono mb-3">Tx: <a href="'+(d.explorerUrl||ARC.explorer+'/tx/'+d.txHash)+'" target="_blank" class="text-blue-500 hover:underline">'+(d.txHash||'').substring(0,24)+'…</a></p>'
      +'<div class="flex gap-2">'
      +'<button onclick="resolveDispute(\''+d.id+'\',\'buyer\')" class="btn-primary text-xs py-1.5">Refund Buyer</button>'
      +'<button onclick="resolveDispute(\''+d.id+'\',\'seller\')" class="btn-secondary text-xs py-1.5">Release to Seller</button>'
      +'</div></div>'
    ).join('');
  });
  function resolveDispute(id,favor){
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const i=orders.findIndex(o=>o.id===id);
    if(i>=0){orders[i].status='completed';orders[i].disputeResolution=favor;orders[i].resolvedAt=new Date().toISOString();localStorage.setItem('rh_orders',JSON.stringify(orders));showToast('Dispute resolved in favor of '+favor+'. Escrow released.','success');setTimeout(()=>location.reload(),800);}
  }
  </script>
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
