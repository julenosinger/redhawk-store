import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = { DB?: D1Database; PRODUCTS_KV?: KVNamespace }
const app = new Hono<{ Bindings: Bindings }>()
app.use('*', cors())

// ─── Product type ────────────────────────────────────────────────────────────
interface Product {
  id: string; title: string; description: string; price: number
  token: string; image: string; category: string; stock: number
  seller_id: string; status: string; created_at: string; updated_at: string
}

// ─── Storage Adapter — D1 when available, KV fallback, memory last resort ────
// This prevents "Cannot read properties of undefined (reading 'prepare')" when
// the D1 binding is not configured on the Cloudflare Pages project.

// In-memory fallback (per-isolate, cleared on redeploy — only used when neither D1 nor KV is bound)
let _memProducts: Product[] = []

function nowISO() { return new Date().toISOString() }

// KV helpers — products stored as JSON array under key 'products_v1'
async function kvGetAll(kv: KVNamespace): Promise<Product[]> {
  try {
    const raw = await kv.get('products_v1')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
async function kvSaveAll(kv: KVNamespace, products: Product[]): Promise<void> {
  await kv.put('products_v1', JSON.stringify(products))
}

// ─── Unified product store ────────────────────────────────────────────────────
const store = {
  // List products with optional filters
  async list(env: Bindings, opts: { category?: string; seller?: string; q?: string }): Promise<{ products: Product[]; source: string }> {
    if (env.DB) {
      try {
        let sql  = `SELECT * FROM products WHERE status = 'active'`
        const params: string[] = []
        if (opts.category) { sql += ` AND category = ?`; params.push(opts.category) }
        if (opts.seller)   { sql += ` AND seller_id = ?`; params.push(opts.seller) }
        if (opts.q)        { sql += ` AND (title LIKE ? OR description LIKE ?)`; params.push(`%${opts.q}%`, `%${opts.q}%`) }
        sql += ` ORDER BY created_at DESC`
        const stmt = env.DB.prepare(sql)
        const { results } = await (params.length ? stmt.bind(...params) : stmt).all()
        return { products: results as Product[], source: 'D1' }
      } catch (e: any) {
        console.error('D1 list error:', e.message)
      }
    }
    // KV fallback
    let all: Product[] = env.PRODUCTS_KV ? await kvGetAll(env.PRODUCTS_KV) : _memProducts
    let filtered = all.filter(p => p.status === 'active')
    if (opts.category) filtered = filtered.filter(p => p.category === opts.category)
    if (opts.seller)   filtered = filtered.filter(p => p.seller_id === opts.seller)
    if (opts.q) {
      const qLow = opts.q.toLowerCase()
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(qLow) || p.description.toLowerCase().includes(qLow))
    }
    filtered.sort((a,b) => b.created_at.localeCompare(a.created_at))
    return { products: filtered, source: env.PRODUCTS_KV ? 'KV' : 'memory' }
  },

  // Get single product by id
  async get(env: Bindings, id: string): Promise<Product | null> {
    if (env.DB) {
      try {
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'`).bind(id).first()
        return (row as Product) || null
      } catch (e: any) { console.error('D1 get error:', e.message) }
    }
    const all: Product[] = env.PRODUCTS_KV ? await kvGetAll(env.PRODUCTS_KV) : _memProducts
    return all.find(p => p.id === id && p.status === 'active') || null
  },

  // Get product by id (any status) — for seller operations
  async getAny(env: Bindings, id: string): Promise<Product | null> {
    if (env.DB) {
      try {
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first()
        return (row as Product) || null
      } catch (e: any) { console.error('D1 getAny error:', e.message) }
    }
    const all: Product[] = env.PRODUCTS_KV ? await kvGetAll(env.PRODUCTS_KV) : _memProducts
    return all.find(p => p.id === id) || null
  },

  // List products for a seller (all statuses except deleted)
  async listBySeller(env: Bindings, address: string): Promise<Product[]> {
    if (env.DB) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT * FROM products WHERE seller_id = ? AND status != 'deleted' ORDER BY created_at DESC`
        ).bind(address).all()
        return results as Product[]
      } catch (e: any) { console.error('D1 listBySeller error:', e.message) }
    }
    const all: Product[] = env.PRODUCTS_KV ? await kvGetAll(env.PRODUCTS_KV) : _memProducts
    return all.filter(p => p.seller_id === address && p.status !== 'deleted')
              .sort((a,b) => b.created_at.localeCompare(a.created_at))
  },

  // Create a product
  async create(env: Bindings, data: Omit<Product,'id'|'status'|'created_at'|'updated_at'>): Promise<Product> {
    const id = nanoid()
    const now = nowISO()
    const product: Product = { ...data, id, status: 'active', created_at: now, updated_at: now }

    if (env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO products (id,title,description,price,token,image,category,stock,seller_id)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(id, data.title, data.description, data.price, data.token, data.image, data.category, data.stock, data.seller_id).run()
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first()
        return (row as Product) || product
      } catch (e: any) { console.error('D1 create error:', e.message) }
    }
    // KV / memory
    const all: Product[] = env.PRODUCTS_KV ? await kvGetAll(env.PRODUCTS_KV) : _memProducts
    all.unshift(product)
    if (env.PRODUCTS_KV) await kvSaveAll(env.PRODUCTS_KV, all)
    else _memProducts = all
    return product
  },

  // Update product status
  async setStatus(env: Bindings, id: string, status: string): Promise<boolean> {
    if (env.DB) {
      try {
        await env.DB.prepare(`UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run()
        return true
      } catch (e: any) { console.error('D1 setStatus error:', e.message) }
    }
    const all: Product[] = env.PRODUCTS_KV ? await kvGetAll(env.PRODUCTS_KV) : _memProducts
    const idx = all.findIndex(p => p.id === id)
    if (idx < 0) return false
    all[idx].status = status
    all[idx].updated_at = nowISO()
    if (env.PRODUCTS_KV) await kvSaveAll(env.PRODUCTS_KV, all)
    else _memProducts = all
    return true
  }
}

// ─── DB init (only when D1 is bound) ─────────────────────────────────────────
let _dbReady = false
async function initDB(db?: D1Database) {
  if (!db || _dbReady) return
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      price REAL NOT NULL, token TEXT NOT NULL DEFAULT 'USDC', image TEXT,
      category TEXT NOT NULL DEFAULT 'Other', stock INTEGER NOT NULL DEFAULT 1,
      seller_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id)`).run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)`).run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category)`).run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC)`).run()
    _dbReady = true
  } catch (e: any) {
    console.error('initDB error (non-fatal):', e.message)
  }
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
    // ShuklyEscrow: verified on ArcScan (testnet.arcscan.app)
    // Contract: ShuklyEscrow | solc 0.8.34 | optimizer: true, runs: 200 | MIT
    // Verified: https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511
    ShuklyEscrow: '0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511',
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
    await initDB(c.env.DB)
    const { products, source } = await store.list(c.env, {
      category: c.req.query('category') || '',
      seller:   c.req.query('seller')   || '',
      q:        c.req.query('q')        || ''
    })
    return c.json({ products, total: products.length, source })
  } catch (e: any) {
    return c.json({ products: [], total: 0, source: 'error', error: e.message })
  }
})

// GET /api/products/:id — single product
app.get('/api/products/:id', async (c) => {
  try {
    await initDB(c.env.DB)
    const product = await store.get(c.env, c.req.param('id'))
    if (!product) return c.json({ error: 'Product not found', product: null }, 404)
    return c.json({ product })
  } catch (e: any) {
    return c.json({ error: e.message, product: null }, 500)
  }
})

// POST /api/products — create a product
app.post('/api/products', async (c) => {
  try {
    await initDB(c.env.DB)
    const body = await c.req.json() as any
    const { title, description, price, token = 'USDC', image = '', category = 'Other', stock = 1, seller_id } = body
    // Validate required fields
    if (!title || !description || !price || !seller_id)
      return c.json({ error: 'Missing required fields: title, description, price, seller_id' }, 400)
    if (Number(price) <= 0)
      return c.json({ error: 'Price must be greater than 0' }, 400)
    if (!['USDC','EURC'].includes(token))
      return c.json({ error: 'Token must be USDC or EURC' }, 400)
    const product = await store.create(c.env, {
      title: String(title).trim(),
      description: String(description).trim(),
      price: Number(price),
      token: String(token),
      image: String(image || ''),
      category: String(category),
      stock: Number(stock) || 1,
      seller_id: String(seller_id)
    })
    return c.json({ product, success: true }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /api/products/:id — soft-delete (seller only)
app.delete('/api/products/:id', async (c) => {
  try {
    await initDB(c.env.DB)
    const { seller_id } = await c.req.json() as any
    const row = await store.getAny(c.env, c.req.param('id'))
    if (!row)                          return c.json({ error: 'Product not found' }, 404)
    if (row.seller_id !== seller_id)   return c.json({ error: 'Unauthorized' }, 403)
    await store.setStatus(c.env, c.req.param('id'), 'deleted')
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PATCH /api/products/:id/status — pause, resume, delete (seller only)
app.patch('/api/products/:id/status', async (c) => {
  try {
    await initDB(c.env.DB)
    const { seller_id, status } = await c.req.json() as any
    if (!['active','paused','deleted'].includes(status))
      return c.json({ error: 'Invalid status. Use active, paused, or deleted' }, 400)
    const row = await store.getAny(c.env, c.req.param('id'))
    if (!row)                          return c.json({ error: 'Product not found' }, 404)
    if (row.seller_id !== seller_id)   return c.json({ error: 'Unauthorized' }, 403)
    await store.setStatus(c.env, c.req.param('id'), status)
    return c.json({ success: true, status })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/seller/:address/products — all products (active + paused) for seller dashboard
app.get('/api/seller/:address/products', async (c) => {
  try {
    await initDB(c.env.DB)
    const products = await store.listBySeller(c.env, c.req.param('address'))
    return c.json({ products, total: products.length })
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

// ─── POST /api/orders — save order metadata after on-chain escrow tx ────────
// Called by frontend AFTER createEscrow + fundEscrow are confirmed on-chain.
// txHash must be a real 0x... hash — never a placeholder.
app.post('/api/orders', async (c) => {
  const body = await c.req.json() as any
  if (!body.txHash || !body.buyerAddress || !body.sellerAddress) {
    return c.json({ error: 'Missing required fields: txHash, buyerAddress, sellerAddress' }, 400)
  }
  // Reject fake placeholder hashes
  if (body.txHash.startsWith('PENDING_') || body.txHash === '0x') {
    return c.json({ error: 'Invalid txHash — must be a real on-chain transaction hash' }, 400)
  }
  const escrowAddr = (c.env as any).SHUKLY_ESCROW_ADDRESS || ARC.contracts.ShuklyEscrow
  const order = {
    id:              body.orderId || `ORD-${Date.now()}`,
    txHash:          body.txHash,
    fundTxHash:      body.fundTxHash   || null,    // fundEscrow tx hash
    buyerAddress:    body.buyerAddress,
    sellerAddress:   body.sellerAddress,
    escrowContract:  escrowAddr,                   // always ShuklyEscrow address
    orderId32:       body.orderId32    || null,     // bytes32 used on-chain
    amount:          body.amount,
    token:           body.token,
    productId:       body.productId,
    items:           body.items        || [],
    status:          'escrow_locked',
    createdAt:       new Date().toISOString(),
    explorerUrl:     `${ARC.explorer}/tx/${body.fundTxHash || body.txHash}`
  }
  return c.json({ order, success: true })
})

// ─── GET /api/escrow/address — returns the deployed ShuklyEscrow address ─────
app.get('/api/escrow/address', (c) => {
  const addr = (c.env as any).SHUKLY_ESCROW_ADDRESS || ARC.contracts.ShuklyEscrow
  return c.json({
    address: addr,
    deployed: addr !== '0x0000000000000000000000000000000000000000',
    verified: addr === '0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511',
    explorer: `${ARC.explorer}/address/${addr}`,
    verified_url: `https://testnet.arcscan.app/address/${addr}`
  })
})

// ─── GET /api/escrow/abi — returns the verified ABI from ArcScan ─────────────
app.get('/api/escrow/abi', async (c) => {
  try {
    const addr = (c.env as any).SHUKLY_ESCROW_ADDRESS || ARC.contracts.ShuklyEscrow
    const resp = await fetch(`https://testnet.arcscan.app/api/v2/smart-contracts/${addr}`)
    if (!resp.ok) throw new Error(`ArcScan API error: ${resp.status}`)
    const data: any = await resp.json()
    return c.json({
      address: addr,
      abi: data.abi,
      name: data.name,
      compiler_version: data.compiler_version,
      optimization_enabled: data.optimization_enabled,
      optimization_runs: data.optimization_runs,
      license_type: data.license_type,
      is_verified: data.is_verified,
      is_fully_verified: data.is_fully_verified,
      verified_at: data.verified_at,
      explorer_url: `https://testnet.arcscan.app/address/${addr}`
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ─── POST /api/escrow/save-address — saves deployed contract address ─────────
// Called from /deploy-escrow page after owner deploys the contract via MetaMask.
app.post('/api/escrow/save-address', async (c) => {
  const body = await c.req.json() as any
  if (!body.address || !body.address.startsWith('0x') || body.address.length !== 42) {
    return c.json({ error: 'Invalid address' }, 400)
  }
  // In production, this should persist to KV or D1.
  // For now we return the address so the frontend can store it in localStorage.
  return c.json({ success: true, address: body.address, message: 'Store SHUKLY_ESCROW_ADDRESS as a Cloudflare secret to persist across deployments.' })
})

// AI search: returns empty state since no real products exist yet
app.post('/api/ai-search', async (c) => {
  try {
    const { query, context } = await c.req.json()
    await initDB(c.env.DB)
    
    // Get all products from database
    const allProducts = await store.list(c.env)
    
    // Build context-aware response
    let message = ''
    let results = []
    
    if (!query || query.trim() === '') {
      message = context?.page === 'product' && context?.productName
        ? `I can help you with "${context.productName}" or find similar items. What would you like to know?`
        : 'Ask me about products, prices, or how to buy on Arc Network!'
      results = allProducts.slice(0, 3)
    } else {
      // Search products
      const searchTerm = query.toLowerCase()
      results = allProducts.filter(p => 
        p.title.toLowerCase().includes(searchTerm) ||
        p.description.toLowerCase().includes(searchTerm) ||
        p.category.toLowerCase().includes(searchTerm)
      )
      
      // Context-aware message
      if (results.length > 0) {
        message = context?.page === 'product' && context?.productName
          ? `Found ${results.length} product${results.length > 1 ? 's' : ''} matching "${query}". Here are some options similar to "${context.productName}":`
          : `Found ${results.length} product${results.length > 1 ? 's' : ''} for "${query}" on Arc Network:`
      } else {
        message = context?.page === 'product'
          ? `No exact matches for "${query}". Here are other products you might like:`
          : `No products found for "${query}". Try searching by category (Electronics, Fashion, etc.) or browse all items!`
        results = allProducts.slice(0, 3) // Show some suggestions
      }
    }
    
    // Format results
    const formattedResults = results.slice(0, 5).map(p => ({
      id: p.id,
      name: p.title,
      price: p.price,
      token: p.token,
      category: p.category
    }))
    
    return c.json({ message, results: formattedResults })
  } catch (error) {
    return c.json({
      message: 'Error searching products. Please try again.',
      results: []
    })
  }
})

// ─── Pages ───────────────────────────────────────────────────────────
app.get('/', (c) => c.html(homePage()))
app.get('/marketplace', (c) => c.html(marketplacePage()))
// ─── API routes for product page ────────────────────────────────────────────
app.get('/product/:id', async (c) => {
  try {
    await initDB(c.env.DB)
    const product = await store.get(c.env, c.req.param('id'))
    if (product) return c.html(productPage(product))
  } catch {}
  return c.html(productNotFoundPage(c.req.param('id')))
})
app.get('/cart', (c) => c.html(cartPage()))
app.get('/checkout', (c) => c.html(checkoutPage()))
app.get('/wallet', (c) => c.html(walletPage()))
app.get('/wallet/create', (c) => c.redirect('/wallet'))
app.get('/wallet/import', (c) => c.redirect('/wallet'))
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
app.get('/deploy-escrow', (c) => c.html(deployEscrowPage()))

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
  <title>${title} | Shukly Store</title>
  
  <!-- Open Graph Meta Tags -->
  <meta property="og:title" content="Shukly Store – Web3 Marketplace"/>
  <meta property="og:description" content="Decentralized marketplace powered by smart contracts on Arc Testnet. Explore, test, and experience Web3 commerce in a secure environment."/>
  <meta property="og:image" content="https://www.genspark.ai/api/files/s/eSPDBk0I"/>
  <meta property="og:url" content="https://shukly-store.pages.dev/"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="Shukly Store"/>
  
  <!-- Twitter Card Meta Tags -->
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="Shukly Store – Web3 Marketplace"/>
  <meta name="twitter:description" content="Decentralized marketplace powered by smart contracts on Arc Testnet. Explore, test, and experience Web3 commerce in a secure environment."/>
  <meta name="twitter:image" content="https://www.genspark.ai/api/files/s/eSPDBk0I"/>
  
  <!-- Additional Meta Tags -->
  <meta name="description" content="Decentralized marketplace powered by smart contracts on Arc Testnet. Explore, test, and experience Web3 commerce in a secure environment."/>
  <meta name="keywords" content="Web3, marketplace, decentralized, Arc Network, smart contracts, blockchain, DeFi, crypto commerce"/>
  <meta name="theme-color" content="#dc2626"/>
  
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

// ShuklyEscrow address — loaded from localStorage (set after deploy) or ARC config
// Priority: localStorage override → ARC config (hardcoded) → zero address (not deployed)
function getEscrowAddress() {
  const local = localStorage.getItem('shukly_escrow_address');
  if (local && local !== '0x0000000000000000000000000000000000000000') return local;
  const fromConfig = window.ARC && window.ARC.contracts && window.ARC.contracts.ShuklyEscrow;
  if (fromConfig && fromConfig !== '0x0000000000000000000000000000000000000000') return fromConfig;
  return '0x0000000000000000000000000000000000000000';
}

// Check if escrow address is valid (non-zero)
function isEscrowDeployed() {
  const addr = getEscrowAddress();
  return addr && addr !== '0x0000000000000000000000000000000000000000';
}

// Minimal ERC-20 ABI for balanceOf + approve + allowance
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

// ─── ShuklyEscrow ABI — direct wallet calls (no relayer) ────────────────
// States: 0=EMPTY, 1=FUNDED, 2=CONFIRMED, 3=RELEASED, 4=REFUNDED, 5=DISPUTED
const ESCROW_ABI = [
  'function createEscrow(bytes32 orderId, address seller, address token, uint256 amount) external',
  'function fundEscrow(bytes32 orderId) external',
  'function confirmDelivery(bytes32 orderId) external',
  'function releaseFunds(bytes32 orderId) external',
  'function refund(bytes32 orderId) external',
  'function openDispute(bytes32 orderId) external',
  'function getEscrow(bytes32 orderId) external view returns (address buyer, address seller, address token, uint256 amount, uint8 state, uint256 createdAt)',
  'function escrows(bytes32) external view returns (address buyer, address seller, address token, uint256 amount, uint8 state, uint256 createdAt)',
  'function owner() external view returns (address)',
  'function feeBps() external view returns (uint256)',
  'event EscrowCreated(bytes32 indexed orderId, address indexed buyer, address indexed seller, address token, uint256 amount)',
  'event EscrowFunded(bytes32 indexed orderId, address indexed buyer, uint256 amount)',
  'event DeliveryConfirmed(bytes32 indexed orderId, address indexed buyer)',
  'event FundsReleased(bytes32 indexed orderId, address indexed seller, uint256 amount)',
  'event EscrowRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amount)',
  'event DisputeOpened(bytes32 indexed orderId, address indexed opener)'
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

// ══════════════════════════════════════════════════════════════
//  AES-256-GCM Wallet Encryption — Web Crypto API (client-side only)
//  Keys derived via PBKDF2 (SHA-256, 200_000 iterations, 256-bit)
//  Storage key: rh_wallet_enc  (encrypted)  → persistent
//  Session key: rh_wallet_sess (plain JSON) → sessionStorage only
// ══════════════════════════════════════════════════════════════

async function _walletDeriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function walletEncrypt(walletObj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await _walletDeriveKey(password, salt);
  const enc  = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(walletObj))
  );
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return {
    encryptedWallet: toB64(ciphertext),
    iv:   toB64(iv),
    salt: toB64(salt),
    v: 1
  };
}

async function walletDecrypt(encData, password) {
  try {
    const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const salt = fromB64(encData.salt);
    const iv   = fromB64(encData.iv);
    const ct   = fromB64(encData.encryptedWallet);
    const key  = await _walletDeriveKey(password, salt);
    const dec  = new TextDecoder();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(dec.decode(plain));
  } catch {
    return null; // wrong password or corrupted
  }
}

// Save encrypted wallet to localStorage (persists across sessions)
async function storeWalletEncrypted(walletObj, password) {
  const enc = await walletEncrypt(walletObj, password);
  localStorage.setItem('rh_wallet_enc', JSON.stringify(enc));
  // Also activate session immediately
  sessionStorage.setItem('rh_wallet_sess', JSON.stringify(walletObj));
}

// Checks if there is an encrypted wallet stored (not yet unlocked)
function hasEncryptedWallet() {
  try {
    const enc = localStorage.getItem('rh_wallet_enc');
    if (!enc) return false;
    const parsed = JSON.parse(enc);
    return !!(parsed && parsed.encryptedWallet && parsed.iv && parsed.salt);
  } catch { return false; }
}

// Unlock: decrypt stored wallet with password, activate session
async function unlockWallet(password) {
  try {
    const enc = JSON.parse(localStorage.getItem('rh_wallet_enc') || 'null');
    if (!enc) return null;
    const w = await walletDecrypt(enc, password);
    if (!w) return null;
    sessionStorage.setItem('rh_wallet_sess', JSON.stringify(w));
    return w;
  } catch { return null; }
}

// getStoredWallet — returns active wallet from session OR legacy plain rh_wallet
function getStoredWallet() {
  // 1. Check session (unlocked this tab/session)
  try {
    const sess = sessionStorage.getItem('rh_wallet_sess');
    if (sess) return JSON.parse(sess);
  } catch { /* ignore */ }
  // 2. Legacy plain-text wallet (backwards compatibility)
  try {
    const plain = localStorage.getItem('rh_wallet');
    if (plain) {
      const w = JSON.parse(plain);
      // If it has a privateKey in plain text, put in session and continue
      if (w && w.address) {
        sessionStorage.setItem('rh_wallet_sess', plain);
        return w;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// storeWallet — legacy plain text (used by MetaMask connect flow)
function storeWallet(w) {
  localStorage.setItem('rh_wallet', JSON.stringify(w));
  sessionStorage.setItem('rh_wallet_sess', JSON.stringify(w));
}

function clearWallet() {
  localStorage.removeItem('rh_wallet');
  localStorage.removeItem('rh_wallet_enc');
  sessionStorage.removeItem('rh_wallet_sess');
}

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
    window.location.href = '/wallet';
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
      <span class="font-extrabold text-xl tracking-tight text-slate-800">Shukly<span class="text-amber-500"> Store</span></span>
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
<div id="chat-panel" class="hidden fixed bottom-24 right-6 w-[420px] sm:w-[480px] z-50">
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
    <div id="chat-messages" class="p-4 h-[420px] overflow-y-auto flex flex-col gap-3 bg-gray-50">
      <div class="chat-bubble-ai text-sm text-slate-700">
        👋 Hi! I'm <strong>HawkAI</strong>, your Web3 shopping assistant.<br/><br/>
        The marketplace is live on <strong>Arc Network</strong> (Chain ID: 5042002).<br/>
        Ask me about products, escrow protection, or how to buy!
      </div>
    </div>
    <div class="p-3 bg-white border-t border-slate-100 flex gap-2">
      <input id="chat-input" type="text" placeholder="Ask about products, prices, or how to buy…" class="flex-1 input py-2 text-sm" onkeydown="if(event.key==='Enter')sendChatMessage()"/>
      <button onclick="sendChatMessage()" class="btn-primary py-2 px-3 text-sm"><i class="fas fa-paper-plane"></i></button>
    </div>
  </div>
</div>
<script>
// Get current page context for chat
function getChatContext() {
  const path = window.location.pathname;
  const ctx = { page: 'home', productId: null, productName: null };
  
  // Product page context
  if (path.startsWith('/product/')) {
    ctx.page = 'product';
    ctx.productId = path.split('/product/')[1];
    const titleEl = document.querySelector('h1.text-3xl');
    if (titleEl) ctx.productName = titleEl.textContent.trim();
  }
  // Marketplace page
  else if (path === '/marketplace') ctx.page = 'marketplace';
  // Cart page
  else if (path === '/cart') ctx.page = 'cart';
  // Checkout page
  else if (path === '/checkout') ctx.page = 'checkout';
  
  return ctx;
}

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
    const context = getChatContext();
    const res = await fetch('/api/ai-search', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ query, context })
    });
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
            <span class="font-bold text-white text-sm">Shukly<span class="text-amber-400"> Store</span></span>
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
            ${['My Wallet:/wallet','Profile:/profile'].map(t=>{const[l,u]=t.split(':');return`<li><a href="${u}" class="text-xs text-slate-500 hover:text-red-400 transition-colors">${l}</a></li>`}).join('')}
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
        <span>© 2024 Shukly Store · Built on Arc Network (Circle)</span>
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
              <p class="home-glass-name">Shukly Store</p>
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
        <h2 class="home-section-title" style="color:#fff;">How Shukly Store Works</h2>
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
          <h2 class="home-about-title">About Shukly Store</h2>
        </div>
        <p class="home-about-body">
          <strong>Shukly Store</strong> is a decentralized marketplace powered by
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
  const delivType = p.delivery_type || 'manual'
  const isDigital = delivType === 'instant' || delivType === 'digital'

  return shell(title, `
  <style>
    /* ── Product Page Premium Styles ── */
    .pd-breadcrumb{display:flex;align-items:center;gap:6px;font-size:13px;color:#94a3b8;margin-bottom:28px;flex-wrap:wrap}
    .pd-breadcrumb a{color:#64748b;text-decoration:none;font-weight:500;transition:color .15s}
    .pd-breadcrumb a:hover{color:#dc2626}
    .pd-breadcrumb .sep{color:#cbd5e1;font-size:10px}
    .pd-breadcrumb .current{color:#1e293b;font-weight:600}

    .pd-image-wrap{position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;border:1px solid #f1f5f9;box-shadow:0 4px 24px rgba(0,0,0,.07)}
    .pd-image-wrap img{width:100%;max-height:500px;object-fit:cover;display:block;transition:transform .45s cubic-bezier(.25,.46,.45,.94)}
    .pd-image-wrap:hover img{transform:scale(1.04)}
    .pd-image-fallback{width:100%;min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#cbd5e1;background:linear-gradient(135deg,#f8fafc,#f1f5f9)}
    .pd-image-fallback i{font-size:72px;opacity:.35}
    .pd-image-fallback span{font-size:13px;color:#94a3b8;font-weight:500}

    .pd-cat-badge{display:inline-flex;align-items:center;gap:5px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
    .pd-delivery-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.3px}
    .pd-delivery-badge.instant{background:#ecfdf5;color:#059669;border:1px solid #6ee7b7}
    .pd-delivery-badge.manual{background:#fffbeb;color:#d97706;border:1px solid #fcd34d}

    .pd-price-block{display:flex;align-items:baseline;gap:8px;margin:10px 0 4px}
    .pd-price-main{font-size:2.6rem;font-weight:900;color:#dc2626;line-height:1;letter-spacing:-1px}
    .pd-price-tok{font-size:1.1rem;font-weight:700;color:#ef4444;opacity:.85}
    .pd-price-usd{font-size:13px;color:#94a3b8;font-weight:500;margin-left:4px}

    .pd-stock-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:5px 12px;border-radius:20px}
    .pd-stock-badge.instock{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
    .pd-stock-badge.instock .dot{width:7px;height:7px;border-radius:50%;background:#16a34a;animation:pdpulse 1.8s ease-in-out infinite}
    .pd-stock-badge.outstock{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
    @keyframes pdpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}

    .pd-escrow-box{background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1.5px solid #86efac;border-radius:16px;padding:18px 20px;position:relative;overflow:hidden}
    .pd-escrow-box::before{content:'';position:absolute;top:-20px;right:-20px;width:80px;height:80px;background:rgba(22,163,74,.08);border-radius:50%}
    .pd-escrow-title{font-size:13px;font-weight:800;color:#15803d;display:flex;align-items:center;gap:7px;margin-bottom:10px;letter-spacing:.2px}
    .pd-escrow-item{display:flex;align-items:center;gap:8px;font-size:12px;color:#166534;font-weight:500;margin-bottom:6px}
    .pd-escrow-item:last-child{margin-bottom:0}
    .pd-escrow-check{width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px}

    .pd-keys-box{display:flex;align-items:center;gap:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 16px;font-size:12px;color:#1d4ed8;font-weight:500;position:relative}
    .pd-keys-box .pd-tooltip-wrap{position:relative;display:inline-flex;cursor:help;margin-left:auto}
    .pd-keys-box .pd-tooltip-wrap i{color:#93c5fd;font-size:13px}
    .pd-keys-box .pd-tooltip{display:none;position:absolute;right:0;bottom:calc(100% + 8px);background:#1e293b;color:#fff;font-size:11px;font-weight:400;padding:7px 10px;border-radius:8px;white-space:nowrap;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,.2)}
    .pd-keys-box .pd-tooltip-wrap:hover .pd-tooltip{display:block}

    .pd-section-label{font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px}
    .pd-section-label::after{content:'';flex:1;height:1px;background:#f1f5f9}

    .pd-desc-text{font-size:14px;color:#475569;line-height:1.75;white-space:pre-line}

    .pd-details-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .pd-detail-item{background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:12px 14px}
    .pd-detail-item .label{font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px}
    .pd-detail-item .value{font-size:13px;font-weight:600;color:#334155;display:flex;align-items:center;gap:5px}

    .pd-seller-box{background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px}
    .pd-seller-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0}
    .pd-seller-info{flex:1;min-width:0}
    .pd-seller-info .name{font-size:12px;font-weight:700;color:#1e293b;margin-bottom:2px}
    .pd-seller-info .addr{font-size:11px;font-family:monospace;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pd-copy-btn{flex-shrink:0;width:30px;height:30px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all .15s}
    .pd-copy-btn:hover{background:#fef2f2;border-color:#fecaca;color:#dc2626}
    .pd-copy-btn.copied{background:#f0fdf4;border-color:#86efac;color:#16a34a}

    .pd-btn-buy{width:100%;padding:16px 24px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 6px 20px rgba(220,38,38,.35);transition:all .25s;position:relative;overflow:hidden}
    .pd-btn-buy::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent);pointer-events:none}
    .pd-btn-buy:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(220,38,38,.45)}
    .pd-btn-buy:active{transform:translateY(0);box-shadow:0 4px 12px rgba(220,38,38,.3)}
    .pd-btn-buy:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none}
    .pd-btn-cart{width:100%;padding:13px 24px;background:#fff;color:#dc2626;border:2px solid #dc2626;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s}
    .pd-btn-cart:hover{background:#fef2f2;box-shadow:0 4px 12px rgba(220,38,38,.12)}
    .pd-btn-cart:active{transform:scale(.99)}

    .pd-outofstock{background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:2px dashed #e2e8f0;border-radius:14px;padding:24px;text-align:center;color:#94a3b8}

    .pd-seller-panel{background:linear-gradient(135deg,#fffbeb,#fef9c3);border:1.5px solid #fcd34d;border-radius:14px;padding:16px 20px}
    .pd-seller-panel .title{font-size:13px;font-weight:800;color:#92400e;display:flex;align-items:center;gap:7px;margin-bottom:6px}
    .pd-seller-panel p{font-size:12px;color:#78350f;line-height:1.5}

    /* Sticky buy bar — all screen sizes, scroll-triggered */
    .pd-sticky-bar{display:flex;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #f1f5f9;box-shadow:0 -4px 24px rgba(0,0,0,.12);padding:12px 16px 16px;z-index:90;gap:10px;align-items:center;transform:translateY(110%);opacity:0;transition:transform .3s cubic-bezier(.4,0,.2,1),opacity .3s ease,box-shadow .3s ease}
    .pd-sticky-bar.visible{transform:translateY(0);opacity:1;box-shadow:0 -6px 32px rgba(220,38,38,.13)}
    @media(min-width:640px){.pd-sticky-bar{padding:14px 24px 18px}}

    .pd-arc-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.3px}
  </style>

  <div class="max-w-5xl mx-auto px-4 py-6 pb-28 lg:pb-10">

    <!-- Breadcrumb -->
    <nav class="pd-breadcrumb">
      <a href="/"><i class="fas fa-home"></i></a>
      <span class="sep"><i class="fas fa-chevron-right"></i></span>
      <a href="/marketplace">Marketplace</a>
      <span class="sep"><i class="fas fa-chevron-right"></i></span>
      <span class="pd-breadcrumb-cat">${cat}</span>
      <span class="sep"><i class="fas fa-chevron-right"></i></span>
      <span class="current">${title.length > 32 ? title.slice(0,32)+'…' : title}</span>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">

      <!-- ── LEFT: Image + Description ── -->
      <div>
        <div class="pd-image-wrap">
          ${imgUrl
            ? `<img src="${imgUrl}" alt="${title}"
                 onerror="this.style.display='none';document.getElementById('img-fallback').style.display='flex'">`
            : ''}
          <div id="img-fallback" style="${imgUrl ? 'display:none' : 'display:flex'}" class="pd-image-fallback">
            <i class="fas fa-image"></i>
            <span>No image available</span>
          </div>
        </div>

        <!-- Arc Network badge under image -->
        <div class="flex items-center gap-3 mt-4 px-1">
          <span class="pd-arc-badge"><i class="fas fa-network-wired"></i> Arc Network</span>
          <span class="text-xs text-slate-400">Chain ID 5042002 · Testnet</span>
          <a href="https://testnet.arcscan.app" target="_blank" class="ml-auto text-xs text-slate-400 hover:text-red-500 transition-colors">
            <i class="fas fa-external-link-alt"></i> Explorer
          </a>
        </div>

        <!-- Description (below image) -->
        <div style="margin-top:24px">
          <div class="pd-section-label"><i class="fas fa-align-left" style="color:#cbd5e1"></i> Description</div>
          <p class="pd-desc-text">${desc || '<span style="color:#94a3b8;font-style:italic">No description provided.</span>'}</p>
        </div>
      </div>

      <!-- ── RIGHT: Details ── -->
      <div class="flex flex-col gap-5">

        <!-- Header: category + badges -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="pd-cat-badge"><i class="fas fa-tag"></i> ${cat}</span>
          ${isDigital
            ? `<span class="pd-delivery-badge instant"><i class="fas fa-bolt"></i> Instant Delivery</span>`
            : `<span class="pd-delivery-badge manual"><i class="fas fa-clock"></i> Manual Delivery</span>`}
          ${stockN > 0
            ? `<span class="pd-stock-badge instock"><span class="dot"></span> In stock (${stockN})</span>`
            : `<span class="pd-stock-badge outstock"><i class="fas fa-times-circle" style="font-size:9px"></i> Out of stock</span>`}
        </div>

        <!-- Title -->
        <div>
          <h1 style="font-size:clamp(1.5rem,3vw,2rem);font-weight:900;color:#0f172a;line-height:1.2;letter-spacing:-.5px;margin-bottom:12px">${title}</h1>

          <!-- Price -->
          <div class="pd-price-block">
            <span class="pd-price-main">${price}</span>
            <span class="pd-price-tok">${tok}</span>
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:2px">
            <i class="fas fa-info-circle" style="margin-right:3px"></i>Paid via ${tok} on Arc Testnet
          </p>
        </div>

        <!-- Escrow Protection Box -->
        <div class="pd-escrow-box">
          <div class="pd-escrow-title">
            <div style="width:28px;height:28px;border-radius:8px;background:#16a34a;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="fas fa-shield-alt" style="color:#fff;font-size:12px"></i>
            </div>
            Escrow Smart Contract Protection
          </div>
          <div class="pd-escrow-item">
            <span class="pd-escrow-check"><i class="fas fa-check"></i></span>
            Funds locked in Arc Network smart contract
          </div>
          <div class="pd-escrow-item">
            <span class="pd-escrow-check"><i class="fas fa-check"></i></span>
            Released only after you confirm delivery
          </div>
          <div class="pd-escrow-item">
            <span class="pd-escrow-check"><i class="fas fa-check"></i></span>
            Dispute resolution available if needed
          </div>
        </div>

        <!-- Private Keys notice -->
        <div class="pd-keys-box">
          <i class="fas fa-lock" style="color:#3b82f6;font-size:15px;flex-shrink:0"></i>
          <span>We <strong>never</strong> access your private keys — all transactions signed locally in your wallet.</span>
          <div class="pd-tooltip-wrap">
            <i class="fas fa-question-circle"></i>
            <div class="pd-tooltip">Non-custodial: only you control your funds.</div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div id="product-action-btns" class="flex flex-col gap-3 mt-1">
          ${stockN > 0
            ? `<button id="btn-buy-now"
                onclick="pdBuyNow('${p.id}','${title.replace(/'/g,"\\'")}',${price},'${tok}','${imgUrl}')"
                class="pd-btn-buy">
                <i class="fas fa-bolt"></i>
                Buy Now &mdash; ${price} ${tok}
              </button>
              <button id="btn-add-cart"
                onclick="pdAddCart('${p.id}','${title.replace(/'/g,"\\'")}',${price},'${tok}','${imgUrl}')"
                class="pd-btn-cart">
                <i class="fas fa-cart-plus"></i> Add to Cart
              </button>`
            : `<div class="pd-outofstock">
                <i class="fas fa-box-open" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>
                <p style="font-weight:700;font-size:15px;color:#64748b;margin-bottom:4px">Out of Stock</p>
                <p style="font-size:12px;color:#94a3b8">This product is currently unavailable</p>
              </div>`}
        </div>

        <!-- Seller Management Panel (shown only if viewer is the seller) -->
        <div id="seller-actions" class="hidden pd-seller-panel">
          <div class="title"><i class="fas fa-store"></i> Your Listing</div>
          <p>You are the seller of this product. You cannot purchase your own listing.</p>
        </div>

      </div>
    </div>

    <!-- Back link -->
    <div class="mt-10 pt-6 border-t border-slate-100">
      <a href="/marketplace" class="btn-secondary text-sm py-2 px-4">
        <i class="fas fa-arrow-left"></i> Back to Marketplace
      </a>
    </div>
  </div>

  <!-- Mobile sticky buy bar -->
  ${stockN > 0 ? `
  <div class="pd-sticky-bar" id="pd-sticky-bar">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;color:#64748b;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
      <div style="font-size:18px;font-weight:900;color:#dc2626;line-height:1.2">${price} <span style="font-size:13px;font-weight:700">${tok}</span></div>
    </div>
    <button onclick="pdBuyNow('${p.id}','${title.replace(/'/g,"\\'")}',${price},'${tok}','${imgUrl}')"
      class="pd-btn-buy" style="width:auto;padding:13px 22px;font-size:14px;flex-shrink:0">
      <i class="fas fa-bolt"></i> Buy Now
    </button>
  </div>` : ''}

  <script>
  (function(){
    // Self-purchase check: hide buy buttons if viewer is the seller
    const sellerAddr = '${seller}'.toLowerCase();
    const w = getStoredWallet();
    if(w && sellerAddr && w.address.toLowerCase() === sellerAddr){
      const btns = document.getElementById('product-action-btns');
      const panel = document.getElementById('seller-actions');
      const bar = document.getElementById('pd-sticky-bar');
      if(btns) btns.classList.add('hidden');
      if(panel) panel.classList.remove('hidden');
      if(bar) bar.style.display = 'none';
    }
  })();

  function pdBuyNow(id, name, price, token, image) {
    const btn = document.getElementById('btn-buy-now');
    if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…'; }
    CartStore.addToCart({ id, title: name, price: parseFloat(price), currency: token, image });
    setTimeout(() => window.location.href = '/cart', 400);
  }
  function pdAddCart(id, name, price, token, image) {
    const btn = document.getElementById('btn-add-cart');
    if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fas fa-check"></i> Added!'; }
    CartStore.addToCart({ id, title: name, price: parseFloat(price), currency: token, image });
    showToast('Added to cart!', 'success');
    setTimeout(() => { if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fas fa-cart-plus"></i> Add to Cart'; } }, 1800);
  }
  // Keep legacy names working (called by other scripts)
  function addToCartOnly(id, name, price, token, image) { pdAddCart(id, name, price, token, image); }
  function addToCartAndBuy(id, name, price, token, image) { pdBuyNow(id, name, price, token, image); }

  function pdCopySeller() {
    const addr = '${seller}';
    if(!addr) return;
    navigator.clipboard.writeText(addr).then(() => {
      const btn = document.getElementById('pd-copy-seller');
      if(btn){ btn.classList.add('copied'); btn.innerHTML = '<i class="fas fa-check"></i>'; }
      showToast('Seller address copied!', 'success');
      setTimeout(() => { if(btn){ btn.classList.remove('copied'); btn.innerHTML = '<i class="fas fa-copy"></i>'; } }, 2000);
    }).catch(() => showToast('Copy not available', 'error'));
  }

  // Smart sticky bar — activates only when page is scrollable and Buy Now is out of view
  (function(){
    const bar = document.getElementById('pd-sticky-bar');
    if(!bar) return;
    const mainBtn = document.getElementById('btn-buy-now');
    if(!mainBtn) return;

    // Only activate if page is tall enough to require scrolling (content > viewport)
    const pageNeedsScroll = () => document.documentElement.scrollHeight > window.innerHeight + 80;

    let active = false;
    const obs = new IntersectionObserver(([e]) => {
      // btn-buy-now is visible → hide bar; out of view → show bar (only if page scrolls)
      if(!pageNeedsScroll()) { bar.classList.remove('visible'); return; }
      if(e.isIntersecting) {
        bar.classList.remove('visible');
      } else {
        bar.classList.add('visible');
      }
    }, { threshold: 0.3 });

    obs.observe(mainBtn);

    // Also re-check on resize in case layout changes
    window.addEventListener('resize', () => {
      if(!pageNeedsScroll()) bar.classList.remove('visible');
    }, { passive: true });
  })();
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
          <p class="font-semibold flex items-center gap-1"><i class="fas fa-info-circle"></i> 3-step on-chain escrow</p>
          <p><span class="font-medium">Step 1:</span> Approve ShuklyEscrow to spend your tokens (one-time)</p>
          <p><span class="font-medium">Step 2:</span> Create escrow slot on-chain (<code>createEscrow</code>)</p>
          <p><span class="font-medium">Step 3:</span> Lock funds in escrow (<code>fundEscrow</code>) — "to" = escrow contract, never seller</p>
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
  //  confirmOrder — Direct ShuklyEscrow contract calls (no relayer)
  //
  //  Flow (all on-chain, user signs each tx with their own wallet):
  //   1. approve(escrowAddress, MaxUint256)  — ERC-20 approval
  //   2. createEscrow(orderId32, seller, token, amount)
  //   3. fundEscrow(orderId32)              — pulls tokens into escrow
  //
  //  Funds go to ShuklyEscrow contract ONLY — never directly to seller.
  // ════════════════════════════════════════════════════════════════════
  async function confirmOrder() {
    const btn = document.getElementById('co-confirm-btn');
    function resetBtn() {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds'; }
    }
    function setBtn(text) {
      if (btn) btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>' + text;
    }

    // ── 1. Wallet check ──────────────────────────────────────────────
    const w = getStoredWallet();
    if (!w) {
      showToast('Connect a wallet first — redirecting…', 'error');
      setTimeout(() => { window.location.href = '/wallet'; }, 1200);
      return;
    }

    // ── 2. Network check ─────────────────────────────────────────────
    if (w.type === 'metamask' && window.ethereum) {
      const onArc = await isOnArcNetwork();
      if (!onArc) {
        showToast('Switching to Arc Testnet…', 'info');
        const switched = await switchToArc();
        if (!switched) {
          showToast('Please switch to Arc Testnet in MetaMask manually', 'warning');
          return;
        }
      }
    }

    // ── 3. Cart check ────────────────────────────────────────────────
    const cart = getCart();
    if (!cart.length) { showToast('Cart is empty', 'error'); return; }

    // ── 4. Escrow contract check ─────────────────────────────────────
    const escrowAddress = getEscrowAddress();
    console.log('[confirmOrder] escrowAddress:', escrowAddress);
    if (!isEscrowDeployed()) {
      showToast('Escrow contract not configured. Contact support or deploy at /deploy-escrow.', 'error');
      console.error('[confirmOrder] ShuklyEscrow address is zero/unset. Set window.ARC.contracts.ShuklyEscrow or deploy.');
      return;
    }

    // ── 5. Calculate amount & token ──────────────────────────────────
    const total = cart.reduce((s, i) => s + (parseFloat(i.price) || 0) * ((i.quantity || i.qty) || 1), 0);
    const tokenSel = document.querySelector('input[name="token"]:checked');
    const token = tokenSel ? tokenSel.value : 'USDC';
    const tokenAddress = token === 'USDC' ? window.ARC.contracts.USDC : window.ARC.contracts.EURC;
    console.log('[confirmOrder] token:', token, tokenAddress, 'amount:', total);

    // ── 6. Resolve seller ────────────────────────────────────────────
    let sellerAddress = null;
    try {
      const pid = cart[0]?.id;
      if (pid) {
        const resp = await fetch('/api/products/' + pid);
        const data = await resp.json();
        if (data.product?.seller_id && data.product.seller_id.startsWith('0x')) {
          sellerAddress = data.product.seller_id;
        }
      }
    } catch (e) { console.warn('[confirmOrder] seller fetch error:', e); }

    if (!sellerAddress) {
      showToast('Could not resolve seller address from product API', 'error');
      console.error('[confirmOrder] sellerAddress missing');
      return;
    }
    if (w.address.toLowerCase() === sellerAddress.toLowerCase()) {
      showToast('You cannot purchase your own product', 'error');
      return;
    }
    console.log('[confirmOrder] sellerAddress:', sellerAddress);

    // ── 7. Confirmation modal ────────────────────────────────────────
    const confirmed = await showTxConfirmModal({
      action:  'Lock Funds in Escrow',
      amount:  total.toFixed(2),
      token:   token,
      network: 'Arc Testnet (Chain ID: 5042002)',
      note:    "Funds go to ShuklyEscrow - released only after delivery confirmation. to=escrow contract, NOT the seller."
    });
    if (!confirmed) { showToast('Transaction cancelled', 'info'); return; }

    if (btn) btn.disabled = true;
    setBtn('Connecting to wallet…');

    // ── 8. Get signer ────────────────────────────────────────────────
    let provider, signer;
    try {
      if (w.type === 'metamask' && window.ethereum) {
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);  // ensure MetaMask is unlocked
        signer = await provider.getSigner();
        console.log('[confirmOrder] MetaMask signer:', await signer.getAddress());
      } else if ((w.type === 'internal' || w.type === 'imported') && w.privateKey && !w.privateKey.startsWith('[')) {
        provider = new ethers.JsonRpcProvider(window.ARC.rpc);
        signer = new ethers.Wallet(w.privateKey, provider);
        console.log('[confirmOrder] Internal signer:', signer.address);
      } else {
        showToast('Private key unavailable. Re-import wallet with seed phrase.', 'error');
        resetBtn(); return;
      }
    } catch (err) {
      const msg = err.code === 4001 || err.code === 'ACTION_REJECTED'
        ? 'Wallet connection rejected by user'
        : 'Wallet error: ' + (err.message || String(err));
      showToast(msg, 'error');
      console.error('[confirmOrder] signer error:', err);
      resetBtn(); return;
    }

    // ── 9. Build amount & orderId ────────────────────────────────────
    const amountWei = ethers.parseUnits((Math.round(total * 1_000_000) / 1_000_000).toFixed(6), 6);
    const orderId   = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const orderId32 = ethers.id(orderId);
    console.log('[confirmOrder] orderId:', orderId, '→ bytes32:', orderId32);
    console.log('[confirmOrder] amountWei:', amountWei.toString());

    const erc20Contract  = new ethers.Contract(tokenAddress,  ERC20_ABI,  signer);
    const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

    // ══ STEP 1/3: ERC-20 approve ════════════════════════════════════
    let approveTxHash = null;
    try {
      setBtn('Step 1/3 — Checking allowance…');
      const signerAddr = await signer.getAddress();
      const allowance = await erc20Contract.allowance(signerAddr, escrowAddress);
      console.log('[confirmOrder] allowance:', allowance.toString(), 'need:', amountWei.toString());

      if (allowance < amountWei) {
        setBtn('Step 1/3 — Approve token spend (confirm in wallet)…');
        showToast('Step 1/3: Approve ' + token + ' for escrow — confirm in wallet…', 'info');
        const approveTx = await erc20Contract.approve(escrowAddress, ethers.MaxUint256);
        console.log('[confirmOrder] approve tx:', approveTx.hash);
        setBtn('Step 1/3 — Waiting for approval confirmation…');
        showToast('Approval tx sent: ' + approveTx.hash.slice(0, 14) + '… Waiting…', 'info');
        const approveReceipt = await approveTx.wait(1);
        if (!approveReceipt || approveReceipt.status === 0) throw new Error('Approval tx reverted on-chain');
        approveTxHash = approveTx.hash;
        showToast('Token approved! ✓ Tx: ' + approveTx.hash.slice(0, 14) + '…', 'success');
      } else {
        showToast('Allowance sufficient ✓ — skipping approve', 'success');
      }
    } catch (err) {
      const msg = (err.code === 'ACTION_REJECTED' || err.code === 4001)
        ? 'Approval rejected by user'
        : 'Approval failed: ' + (err.shortMessage || err.reason || err.message || String(err));
      showToast(msg, 'error');
      console.error('[confirmOrder] approve error:', err);
      resetBtn(); return;
    }

    // ══ STEP 2/3: createEscrow ══════════════════════════════════════
    let createTxHash = null;
    try {
      setBtn('Step 2/3 — Creating escrow slot (confirm in wallet)…');
      showToast('Step 2/3: createEscrow — confirm in wallet…', 'info');
      console.log('[confirmOrder] createEscrow args:', orderId32, sellerAddress, tokenAddress, amountWei.toString());

      // Arc Testnet eth_estimateGas can fail silently — pass explicit gasLimit to skip estimation
      const createTx = await escrowContract.createEscrow(orderId32, sellerAddress, tokenAddress, amountWei, { gasLimit: 300000 });
      console.log('[confirmOrder] createEscrow tx:', createTx.hash);
      setBtn('Step 2/3 — Waiting for createEscrow confirmation…');
      showToast('createEscrow sent: ' + createTx.hash.slice(0, 14) + '… Waiting…', 'info');

      const createReceipt = await createTx.wait(1);
      if (!createReceipt || createReceipt.status === 0) throw new Error('createEscrow tx reverted — check contract address and inputs');
      createTxHash = createTx.hash;
      showToast('Escrow slot created! ✓ Tx: ' + createTx.hash.slice(0, 14) + '…', 'success');
    } catch (err) {
      // Decode revert reason: Arc Testnet often returns no revert data
      let msg;
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
        msg = 'createEscrow rejected by user';
      } else if (err.message && err.message.includes('missing revert data')) {
        // Likely: buyer == seller, escrow already exists, or invalid inputs
        const buyerAddr = (await signer.getAddress()).toLowerCase();
        if (buyerAddr === sellerAddress.toLowerCase()) {
          msg = 'Erro: você não pode comprar seu próprio produto (buyer = seller)';
        } else {
          msg = 'createEscrow revertido pela rede Arc (sem dados de revert). Verifique saldo USDC e endereços.';
        }
      } else {
        msg = 'createEscrow falhou: ' + (err.shortMessage || err.reason || err.message || String(err));
      }
      showToast(msg, 'error');
      console.error('[confirmOrder] createEscrow error:', err);
      resetBtn(); return;
    }

    // ══ STEP 3/3: fundEscrow ════════════════════════════════════════
    let fundTxHash = null;
    try {
      setBtn('Step 3/3 — Locking funds in escrow (confirm in wallet)…');
      showToast('Step 3/3: fundEscrow — confirm in wallet…', 'info');
      console.log('[confirmOrder] fundEscrow orderId32:', orderId32);

      // Arc Testnet eth_estimateGas can fail silently — pass explicit gasLimit
      const fundTx = await escrowContract.fundEscrow(orderId32, { gasLimit: 200000 });
      console.log('[confirmOrder] fundEscrow tx:', fundTx.hash);
      setBtn('Step 3/3 — Waiting for fundEscrow confirmation…');
      showToast('fundEscrow sent: ' + fundTx.hash.slice(0, 14) + '… Waiting…', 'info');

      const fundReceipt = await fundTx.wait(1);
      if (!fundReceipt || fundReceipt.status === 0) throw new Error('fundEscrow tx reverted — check token allowance and escrow state');
      fundTxHash = fundTx.hash;
      showToast('Funds locked in escrow! ✓ Tx: ' + fundTx.hash.slice(0, 14) + '…', 'success');
    } catch (err) {
      let msg;
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
        msg = 'fundEscrow rejected by user';
      } else if (err.message && err.message.includes('missing revert data')) {
        msg = 'fundEscrow revertido pela rede Arc. Verifique se o approve de ' + token + ' foi confirmado e se há saldo suficiente.';
      } else {
        msg = 'fundEscrow falhou: ' + (err.shortMessage || err.reason || err.message || String(err));
      }
      showToast(msg, 'error');
      console.error('[confirmOrder] fundEscrow error:', err);
      resetBtn(); return;
    }

    // ══ Save order ══════════════════════════════════════════════════
    const orderData = {
      orderId, orderId32,
      txHash:       createTxHash,
      fundTxHash,
      buyerAddress: w.address,
      sellerAddress,
      amount:       total,
      token,
      productId:    cart[0]?.id || '',
      items:        cart
    };

    // Backend save (optional — best effort)
    try {
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
    } catch (e) { console.warn('[confirmOrder] backend save error:', e); }

    // LocalStorage save
    const savedOrders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    savedOrders.unshift({
      id:             orderId,
      orderId32,
      txHash:         createTxHash,
      fundTxHash,
      buyerAddress:   w.address,
      sellerAddress,
      escrowContract: escrowAddress,
      amount:         total,
      token,
      productId:      cart[0]?.id || '',
      items:          cart,
      status:         'escrow_locked',
      createdAt:      new Date().toISOString(),
      explorerUrl:    window.ARC.explorer + '/tx/' + fundTxHash
    });
    localStorage.setItem('rh_orders', JSON.stringify(savedOrders));

    localStorage.removeItem('cart');
    try { CartStore._syncBadge([]); } catch (e) {}

    setBtn('Funds locked! Redirecting…');
    showToast('✓ Funds locked in escrow! Order ' + orderId, 'success');
    setTimeout(() => { window.location.href = '/orders/' + orderId; }, 1200);
  }
  </script>
  `)
}

// ─── PAGE: WALLET ──────────────────────────────────────────────────────
function walletPage() {
  return shell('Wallet', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-wallet text-red-500"></i> Shukly Store Wallet
    </h1>
    <p class="text-slate-500 mb-2">Non-custodial wallet — your keys, your funds, on Arc Network.</p>
    <div id="wallet-network-status" class="mb-6"></div>

    <!-- Unlock Wallet (shown when encrypted wallet exists but session not active) -->
    <div id="unlock-wallet-state" class="hidden">
      <div class="max-w-md mx-auto">
        <div class="card p-8 text-center mb-4">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-lg">
            <i class="fas fa-lock"></i>
          </div>
          <h2 class="text-2xl font-bold text-slate-800 mb-2">Unlock Your Wallet</h2>
          <p class="text-slate-500 text-sm mb-6">Your encrypted wallet is stored locally. Enter your password to access it.</p>
          <div class="space-y-4 text-left">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Wallet Password</label>
              <input id="unlock-password" type="password" placeholder="Enter your wallet password" class="input"
                onkeydown="if(event.key==='Enter')unlockWalletUI()"/>
            </div>
            <div id="unlock-error" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <i class="fas fa-exclamation-circle mr-1"></i> Senha incorreta. Tente novamente.
            </div>
            <button onclick="unlockWalletUI()" id="unlock-btn" class="btn-primary w-full justify-center py-3">
              <i class="fas fa-unlock"></i> Unlock Wallet
            </button>
          </div>
        </div>
        <div class="text-center">
          <p class="text-slate-400 text-xs mb-2">Forgot your password?</p>
          <button onclick="showForgotPasswordUI()" class="text-red-500 text-sm hover:underline font-medium">
            <i class="fas fa-key mr-1"></i> Reset with Seed Phrase
          </button>
        </div>
        <!-- Forgot password panel (hidden by default) -->
        <div id="forgot-password-panel" class="hidden card p-6 mt-4">
          <h3 class="font-bold text-slate-800 mb-3 flex items-center gap-2">
            <i class="fas fa-key text-amber-500"></i> Reset Wallet Password
          </h3>
          <p class="text-slate-500 text-sm mb-4">Import your wallet again using your seed phrase to set a new password.</p>
          <button onclick="showToast('Use MetaMask or WalletConnect to connect your wallet.','info')" class="btn-primary w-full justify-center mb-3">
            <i class="fas fa-wallet"></i> Connect External Wallet
          </button>
          <button onclick="confirmResetWallet()" class="w-full text-center text-red-500 text-sm hover:underline py-2">
            <i class="fas fa-trash-alt mr-1"></i> Delete stored wallet data
          </button>
        </div>
      </div>
    </div>

    <!-- No Wallet -->
    <div id="no-wallet-state">

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
          <span><strong>Your keys, your funds.</strong> Shukly Store never accesses your private keys. All transactions are signed locally in your wallet and broadcast directly to Arc Network. We have zero custody over your assets.</span>
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
              <p class="font-bold text-lg">Shukly Store Wallet</p>
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
        <span><strong>Your keys, your funds.</strong> Shukly Store never accesses your private keys. All transactions are signed locally in your wallet and broadcast directly to Arc Network. We have zero custody over your assets. <a href="/privacy" class="underline text-green-800 font-medium">Privacy Policy</a></span>
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

      <div class="card p-5 border-red-100">
        <div class="flex flex-wrap gap-3">
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

  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('wallet-network-status'));
    const w = getStoredWallet();
    if (w) {
      // ── Active session: show wallet dashboard ──────────────────
      document.getElementById('no-wallet-state').classList.add('hidden');
      document.getElementById('unlock-wallet-state').classList.add('hidden');
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
    } else if (hasEncryptedWallet()) {
      // ── Encrypted wallet exists but no active session: show unlock ──
      document.getElementById('no-wallet-state').classList.add('hidden');
      document.getElementById('unlock-wallet-state').classList.remove('hidden');
      setTimeout(() => { const el = document.getElementById('unlock-password'); if (el) el.focus(); }, 100);
    }
    // else: show no-wallet-state (already visible by default)
  });

  async function unlockWalletUI() {
    const pwd = document.getElementById('unlock-password').value;
    const errEl = document.getElementById('unlock-error');
    const btn = document.getElementById('unlock-btn');
    errEl.classList.add('hidden');
    if (!pwd) { errEl.classList.remove('hidden'); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class=\\"loading-spinner inline-block mr-2\\"></span>Unlocking…';
    const w = await unlockWallet(pwd);
    if (!w) {
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class=\\"fas fa-unlock\\"></i> Unlock Wallet';
      document.getElementById('unlock-password').value = '';
      document.getElementById('unlock-password').focus();
      return;
    }
    // Success: update badge and reload
    updateWalletBadge(w.address);
    showToast('Wallet unlocked!', 'success');
    setTimeout(() => location.reload(), 400);
  }

  function showForgotPasswordUI() {
    const panel = document.getElementById('forgot-password-panel');
    if (panel) panel.classList.toggle('hidden');
  }

  function confirmResetWallet() {
    if (!confirm('⚠️ This will delete your encrypted wallet data from this browser.\\nYou will need your seed phrase to restore access.\\n\\nContinue?')) return;
    clearWallet();
    showToast('Wallet data removed. Import again with seed phrase.', 'info');
    setTimeout(() => location.reload(), 1000);
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
    var statusSteps=['escrow_pending','escrow_locked','shipped','delivery_confirmed','funds_released'];
    var statusIdx=Math.max(0,statusSteps.indexOf(order.status));
    var explorerTxUrl=order.explorerUrl||('${ARC.explorer}/tx/'+(order.txHash||''));

    // Build role-based action buttons
    let actionBtns='';
    var isDisputed=order.status==='dispute';
    var isPending=order.status==='escrow_pending';
    // ── SELLER ACTIONS ──────────────────────────────────────────────────
    // Only the seller sees seller-specific actions; buyer NEVER sees Release Funds
    if(isSeller){
      if(order.status==='escrow_pending')
        // Funds not locked yet — warn seller
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-clock"></i> Awaiting escrow lock by buyer</span>';

      if(order.status==='escrow_locked')
        // Funds locked — seller can now ship
        actionBtns+='<button data-oid="'+order.id+'" data-status="shipped" class="update-status-btn btn-primary"><i class="fas fa-shipping-fast mr-1"></i> Mark as Shipped</button>';

      if(order.status==='shipped')
        // Shipped — waiting for buyer to confirm delivery
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm font-semibold"><i class="fas fa-clock"></i> Waiting for buyer confirmation</span>';

      if(order.status==='delivery_confirmed'){
        // Buyer confirmed delivery — seller CAN now release funds
        if(order.orderId32)
          actionBtns+='<button data-oid="'+order.id+'" data-status="funds_released" class="update-status-btn btn-primary" style="background:linear-gradient(135deg,#16a34a,#15803d);"><i class="fas fa-coins mr-1"></i> Release Funds</button>';
        else
          actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-exclamation-triangle"></i> No on-chain escrow ID — cannot release</span>';
      }

      if(order.status==='funds_released')
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Funds released to you</span>';

      if(isDisputed)
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-semibold"><i class="fas fa-lock"></i> Funds Locked — Dispute Active</span>';
    }

    // ── BUYER ACTIONS ───────────────────────────────────────────────────
    // Buyer sees ONLY: Confirm Delivery (when shipped)
    // Buyer NEVER sees Release Funds — that is a seller-only action
    if(isBuyer){
      if(order.status==='escrow_locked')
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-semibold"><i class="fas fa-lock"></i> Funds locked in escrow — waiting for shipping</span>';

      if(order.status==='shipped')
        // Buyer confirms receipt of goods → calls confirmDelivery on-chain
        actionBtns+='<button data-oid="'+order.id+'" data-status="delivery_confirmed" class="update-status-btn btn-secondary"><i class="fas fa-check-circle mr-1"></i> Confirm Delivery</button>';

      if(order.status==='delivery_confirmed')
        // Delivery confirmed — waiting for seller to release funds
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Delivery confirmed — waiting for seller to release funds</span>';

      if(order.status==='funds_released')
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Order complete — funds released to seller</span>';

      if(isDisputed)
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-semibold"><i class="fas fa-gavel"></i> Dispute Active — awaiting resolution</span>';
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
          +'<h3 class="font-bold text-amber-800 mb-1">Escrow Pending</h3>'
          +'<p class="text-amber-700 text-sm">Funds have NOT been deposited into the escrow contract yet. '
          +'The ShuklyEscrow contract may not be deployed or the checkout did not complete all steps.</p>'
          +'<p class="text-amber-600 text-xs mt-2 font-medium">Go to <a href="/deploy-escrow" class="underline">Deploy Escrow</a> to set up the contract, then retry checkout.</p>'
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
      +['Pending','Locked','Shipped','Confirmed','Released'].map((s,i)=>
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
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Escrow Contract</span><a href="'+('${ARC.explorer}'+'/address/'+(order.escrowContract||''))+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+(order.escrowContract||'—')+'</a></div>'
      +(order.orderId32 ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Order ID (bytes32)</span><span class="font-mono text-xs text-right break-all">'+order.orderId32+'</span></div>' : '')
      // createEscrow tx hash
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Create Tx</span>'
      +(order.txHash && !order.txHash.startsWith('PENDING_')
        ? '<a href="'+('${ARC.explorer}/tx/'+order.txHash)+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+order.txHash+'</a>'
        : '<span class="text-xs text-amber-600 font-medium flex items-center gap-1"><i class="fas fa-clock"></i> Not yet on-chain</span>')
      +'</div>'
      // fundEscrow tx hash
      +(order.fundTxHash
        ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Fund Tx</span>'
          +'<a href="'+'${ARC.explorer}/tx/'+order.fundTxHash+'" target="_blank" class="font-mono text-xs text-indigo-600 hover:underline text-right break-all">'+order.fundTxHash+'</a></div>'
        : '')
      // confirmDelivery tx hash
      +(order.confirmDeliveryTx
        ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Confirm Delivery Tx</span>'
          +'<a href="'+(order.confirmDeliveryUrl||'${ARC.explorer}/tx/'+order.confirmDeliveryTx)+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+order.confirmDeliveryTx+'</a></div>'
        : '')
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
    //  CONFIRM DELIVERY — BUYER calls confirmDelivery(orderId32)
    //  Security: Only the buyer can confirm delivery.
    //  This signals goods received; seller can now call releaseFunds.
    // ══════════════════════════════════════════════════════════════════
    if(s==='delivery_confirmed'){
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      const idx=orders.findIndex(o=>o.id===id);
      if(idx<0) return;
      const order=orders[idx];

      const btn=event && event.target;
      const origLabel='<i class="fas fa-check-circle mr-1"></i> Confirm Delivery';
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Initialising…'; }

      // ── ROLE CHECK: only the buyer can confirm delivery ────────────
      const _w0 = getStoredWallet();
      if(!_w0){
        showToast('Connect wallet to confirm delivery','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }
      const _isBuyer0 = order.buyerAddress && order.buyerAddress.toLowerCase() === _w0.address.toLowerCase();
      if(!_isBuyer0){
        showToast('Only the buyer can confirm delivery','error');
        console.error('[confirmDelivery] Role check failed — caller is not the buyer');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      if(!order.orderId32){
        showToast('No on-chain order ID found. Cannot confirm delivery.','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      try {
        const w=_w0;  // reuse already-loaded wallet

        let provider, signer;
        if(w.type==='metamask' && window.ethereum){
          provider = new ethers.BrowserProvider(window.ethereum);
          const net = await provider.getNetwork();
          if(net.chainId !== BigInt(window.ARC.chainId)){
            showToast('Please switch MetaMask to Arc Testnet','warning');
            if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
          }
          signer = await provider.getSigner();
        } else if((w.type==='internal'||w.type==='imported') && w.privateKey && !w.privateKey.startsWith('[')){
          provider = new ethers.JsonRpcProvider(window.ARC.rpc);
          signer   = new ethers.Wallet(w.privateKey, provider);
        } else {
          showToast('Private key unavailable. Re-import wallet.','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        const escrowAddress = getEscrowAddress();
        if(!escrowAddress || escrowAddress==='0x0000000000000000000000000000000000000000'){
          showToast('Escrow contract not configured','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Confirming delivery…';
        showToast('Sending confirmDelivery on-chain…','info');

        const tx = await escrowContract.confirmDelivery(order.orderId32, { gasLimit: 150000 });
        showToast('Tx sent: '+tx.hash.slice(0,14)+'… Waiting…','info');
        const receipt = await tx.wait(1);
        if(!receipt || receipt.status===0) throw new Error('confirmDelivery reverted');

        showToast('Delivery confirmed on-chain! Tx: '+tx.hash.slice(0,14)+'…','success');
        orders[idx].status             = 'delivery_confirmed';
        orders[idx].confirmDeliveryTx  = tx.hash;
        orders[idx].confirmDeliveryUrl = window.ARC.explorer+'/tx/'+tx.hash;
        orders[idx].updatedAt          = new Date().toISOString();
        localStorage.setItem('rh_orders', JSON.stringify(orders));
        setTimeout(()=>location.reload(), 800);
      } catch(err){
        const msg = err.code==='ACTION_REJECTED'||err.code===4001
          ? 'Confirm delivery rejected by user'
          : 'confirmDelivery error: '+(err.shortMessage||err.message||'');
        showToast(msg,'error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════════
    //  RELEASE FUNDS — SELLER calls releaseFunds(orderId32) on ShuklyEscrow
    //  Security: Only the seller can call this function.
    //  Direct on-chain call — no Permit2, no relayer, no signature
    //
    //  Flow:
    //   1. Seller calls releaseFunds(orderId32) on ShuklyEscrow
    //   2. Contract releases locked tokens to seller
    //   3. UI updates ONLY after tx is confirmed (receipt.status === 1)
    //
    //  "to" address = ShuklyEscrow contract — never directly to seller
    // ══════════════════════════════════════════════════════════════════
    if(s==='funds_released'){
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      const idx=orders.findIndex(o=>o.id===id);
      if(idx<0) return;
      const order=orders[idx];

      const btn=event && event.target;
      const origLabel='<i class="fas fa-coins mr-1"></i> Release Funds';
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Initialising…'; }

      // ── ROLE CHECK: only the seller can release funds ──────────────
      const _w = getStoredWallet();
      if(!_w){
        showToast('Connect wallet to release funds','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }
      const _isSeller = order.sellerAddress && order.sellerAddress.toLowerCase() === _w.address.toLowerCase();
      if(!_isSeller){
        showToast('Only the seller can release funds from escrow','error');
        console.error('[releaseFunds] Role check failed — caller is not the seller');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      // ── STATUS CHECK: must be delivery_confirmed ───────────────────
      if(order.status !== 'delivery_confirmed'){
        showToast('Cannot release funds — buyer has not confirmed delivery yet','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      if(!order.orderId32){
        showToast(
          'This order was not locked on-chain (no orderId32). ' +
          'Funds were never deposited into the escrow contract — nothing to release.',
          'error'
        );
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      try {
        // ── Connect wallet ─────────────────────────────────────────
        const w=getStoredWallet();
        if(!w){ showToast('Connect wallet to release funds','error'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }

        let provider, signer;
        if(w.type==='metamask' && window.ethereum){
          provider = new ethers.BrowserProvider(window.ethereum);
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

        // ── Get escrow contract ────────────────────────────────────
        const escrowAddress = getEscrowAddress();
        if(!escrowAddress || escrowAddress==='0x0000000000000000000000000000000000000000'){
          showToast('Escrow contract not configured. Visit /deploy-escrow.','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

        // ── Call releaseFunds(orderId32) — no permit, no signature ──
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Sending to escrow…';
        showToast('Broadcasting releaseFunds to ShuklyEscrow…','info');

        const txResponse = await escrowContract.releaseFunds(order.orderId32, { gasLimit: 200000 });
        showToast('Tx sent! Waiting for confirmation… '+txResponse.hash.slice(0,14)+'…','info');

        // Wait for on-chain confirmation before updating UI
        const receipt = await txResponse.wait(1);
        if(!receipt || receipt.status === 0){
          throw new Error('releaseFunds reverted on-chain. Check escrow state (must be CONFIRMED).');
        }

        const releaseTxHash = txResponse.hash;
        showToast('Funds released! Tx: '+releaseTxHash.slice(0,14)+'…','success');

        // ── Update order status ONLY after confirmed receipt ───────
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
  return shell('Sell on Shukly Store', `
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
          <span class="font-extrabold text-xl text-slate-800">Shukly<span class="text-amber-500"> Store</span></span>
        </a>
        <h1 class="text-2xl font-extrabold text-slate-800 mb-1">Create Account</h1>
        <p class="text-slate-500 text-sm">Join Shukly Store on Arc Network</p>
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
            <div class="grid grid-cols-1 gap-3 max-w-xs mx-auto">
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
          <span class="font-extrabold text-xl text-slate-800">Shukly<span class="text-amber-500"> Store</span></span>
        </a>
        <h1 class="text-2xl font-extrabold text-slate-800 mb-1">Welcome Back</h1>
        <p class="text-slate-500 text-sm">Sign in to Shukly Store on Arc Network</p>
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
    <p class="text-slate-500 mb-6">Open disputes are reviewed by Shukly Store governance. Escrow funds remain locked on Arc Network until resolved.</p>

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
          <p class="text-slate-400 text-sm">Last updated: January 2024 · Shukly Store</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-exclamation-circle" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Important:</strong> Shukly Store is a testnet demonstration project. No real funds, products, or legal obligations are involved.</span>
      </div>

      <h2>1. Acceptance of Terms</h2>
      <p>By accessing or using Shukly Store ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Platform.</p>

      <h2>2. Nature of the Platform</h2>
      <p>Shukly Store is an open-source, decentralized marketplace demonstration running on the Arc Network testnet. It is provided for educational and testing purposes only. No real monetary transactions occur. All products listed are illustrative and not real.</p>

      <h2>3. Testnet Environment</h2>
      <p>All transactions on Shukly Store are executed on Arc Testnet (Chain ID: 5042002). Testnet tokens (USDC, EURC) have no real monetary value. We are not responsible for any loss of testnet assets.</p>

      <h2>4. Wallet & Private Keys</h2>
      <p>Shukly Store operates as a non-custodial platform. We do not store, collect, or have access to your private keys, seed phrases, or wallet credentials. You are solely responsible for the security of your wallet. Private keys are generated and stored exclusively in your browser.</p>

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
      <p>To the maximum extent permitted by law, Shukly Store and its contributors shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Platform.</p>

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
          <p class="text-slate-400 text-sm">Last updated: January 2024 · Shukly Store</p>
        </div>
      </div>

      <div class="trust-box mb-6">
        <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0"></i>
        <span><strong>Privacy first:</strong> Shukly Store does not collect personal data. Your wallet keys never leave your browser. We have no backend user database.</span>
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
      <p>Shukly Store may interact with the following third-party services:</p>
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
      <p>Shukly Store is not directed at children under 13. We do not knowingly collect information from children.</p>

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
          <p class="text-slate-400 text-sm">Last updated: January 2024 · Shukly Store</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Testnet only:</strong> This application runs exclusively on Arc Testnet. No real money, products, or services are involved.</span>
      </div>

      <h2>General Disclaimer</h2>
      <p>Shukly Store is an open-source, experimental decentralized application (dApp) built for demonstration and educational purposes. It is not a licensed financial service, marketplace, exchange, or business entity.</p>

      <h2>No Real Products</h2>
      <p>All products displayed on Shukly Store are entirely illustrative. They do not represent real items available for purchase. No physical or digital goods are sold through this platform.</p>

      <h2>No Real Funds</h2>
      <p>All tokens used on Shukly Store (USDC, EURC) are testnet tokens with zero monetary value. They cannot be exchanged for real currency. Arc Testnet tokens are only for testing purposes.</p>

      <h2>Smart Contract Risk</h2>
      <p>Smart contracts used in Shukly Store are deployed on testnet and have not undergone formal security audits. Do not interact with them using mainnet wallets or real funds.</p>

      <h2>No Financial Advice</h2>
      <p>Nothing on this platform constitutes financial, investment, legal, or tax advice. The platform does not recommend any investment strategy or financial product.</p>

      <h2>Wallet Security</h2>
      <p>You are solely responsible for the security of your wallet and any credentials you use. Shukly Store does not have access to your private keys, but your browser-stored wallet is only as secure as your device and password.</p>

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
          <h1>About Shukly Store</h1>
          <p class="text-slate-400 text-sm">Decentralized marketplace on Arc Network</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Demo project:</strong> Shukly Store is an open-source testnet demonstration. Not a real commercial marketplace.</span>
      </div>

      <h2>What is Shukly Store?</h2>
      <p>Shukly Store is a decentralized marketplace powered by <strong>Arc Network</strong> — Circle's stablecoin-native Layer 1 blockchain. It uses escrow smart contracts to protect every transaction: buyer funds are locked on-chain until delivery is confirmed, then automatically released to the seller.</p>

      <h2>Technology Stack</h2>
      <ul>
        <li><strong>Blockchain:</strong> Arc Network Testnet (Chain ID: 5042002, EVM-compatible)</li>
        <li><strong>Payments:</strong> USDC (native on Arc) and EURC (ERC-20)</li>
        <li><strong>Escrow:</strong> ShuklyEscrow smart contract — deployed via /deploy-escrow page</li>
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
      <p>Shukly Store is open source. You can inspect, fork, and contribute to the codebase on GitHub:</p>
      <p>
        <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="inline-flex items-center gap-2 text-red-600 hover:underline font-medium">
          <i class="fab fa-github"></i> github.com/julenosinger/redhawk-store
        </a>
      </p>

      <h2>Smart Contracts (Arc Testnet)</h2>
      <ul>
        <li><strong>USDC:</strong> <code class="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">${ARC.contracts.USDC}</code></li>
        <li><strong>EURC:</strong> <code class="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">${ARC.contracts.EURC}</code></li>
        <li><strong>ShuklyEscrow:</strong> <code class="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono" id="escrow-addr-docs">Deploy at /deploy-escrow</code></li>
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

// ─── PAGE: DEPLOY ESCROW ──────────────────────────────────────────────────
function deployEscrowPage() {
  return shell('Deploy ShuklyEscrow', `
  <div class="max-w-2xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-code text-red-500"></i> ShuklyEscrow Contract
    </h1>
    <p class="text-slate-500 mb-6">The ShuklyEscrow contract is deployed and <strong>fully verified</strong> on Arc Testnet.</p>

    <!-- Verified Contract Banner -->
    <div class="card p-4 mb-6 bg-green-50 border border-green-200">
      <div class="flex items-start gap-3">
        <i class="fas fa-check-circle text-green-600 text-xl mt-0.5 shrink-0"></i>
        <div class="flex-1">
          <p class="font-semibold text-green-800 text-sm">Contract Source Code Verified ✅</p>
          <p class="text-green-700 text-xs mt-1 font-mono break-all">0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511</p>
          <div class="flex flex-wrap gap-2 mt-2">
            <a href="https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511" target="_blank"
               class="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors">
              <i class="fas fa-external-link-alt mr-1"></i> View on ArcScan
            </a>
            <a href="https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511?tab=read_contract" target="_blank"
               class="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors">
              <i class="fas fa-book-open mr-1"></i> Read Contract
            </a>
            <a href="https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511?tab=write_contract" target="_blank"
               class="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 transition-colors">
              <i class="fas fa-pen mr-1"></i> Write Contract
            </a>
            <a href="/api/escrow/abi" target="_blank"
               class="text-xs bg-slate-600 text-white px-3 py-1 rounded hover:bg-slate-700 transition-colors">
              <i class="fas fa-code mr-1"></i> ABI (JSON)
            </a>
          </div>
          <div class="mt-3 text-xs text-green-700 space-y-0.5">
            <p><strong>Compiler:</strong> solc v0.8.34+commit.80d5c536</p>
            <p><strong>Optimization:</strong> Enabled — 200 runs</p>
            <p><strong>License:</strong> MIT</p>
            <p><strong>Not a proxy</strong> — direct implementation contract</p>
            <p><strong>No constructor arguments</strong></p>
          </div>
        </div>
      </div>
    </div>

    <div class="card p-6 mb-6">
      <h2 class="font-bold text-slate-800 mb-3 flex items-center gap-2"><i class="fas fa-info-circle text-blue-500"></i> Pre-requisites</h2>
      <ul class="space-y-2 text-sm text-slate-600">
        <li class="flex items-start gap-2"><i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i> MetaMask installed and connected to Arc Testnet (Chain ID: 5042002)</li>
        <li class="flex items-start gap-2"><i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i> Small amount of USDC for gas fees</li>
        <li class="flex items-start gap-2"><i class="fas fa-info-circle text-blue-500 mt-0.5 shrink-0"></i> <span>Get free testnet tokens at <a href="https://faucet.circle.com" target="_blank" class="text-red-600 underline">faucet.circle.com</a></span></li>
      </ul>
    </div>

    <div id="deploy-status" class="mb-4"></div>

    <div class="card p-6 mb-4">
      <h2 class="font-bold text-slate-800 mb-4"><i class="fas fa-rocket mr-2 text-red-500"></i> Deploy Contract</h2>
      <div id="current-escrow" class="mb-4 p-3 rounded-lg bg-slate-50 border text-sm text-slate-600">
        <strong>Current escrow address:</strong> <span id="current-escrow-addr" class="font-mono">loading…</span>
      </div>
      <button id="deploy-btn" onclick="deployContract()" class="btn-primary w-full justify-center py-3 text-base font-bold">
        <i class="fas fa-rocket mr-2"></i> Deploy ShuklyEscrow via MetaMask
      </button>
      <div class="mt-4 border-t pt-4">
        <p class="text-xs text-slate-500 mb-2">Already have a deployed contract? Set the address manually:</p>
        <div class="flex gap-2">
          <input id="manual-addr-input" type="text" class="input text-xs flex-1" placeholder="0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511" value="0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511"/>
          <button onclick="setManualAddr()" class="btn-secondary text-xs px-3 py-2 whitespace-nowrap">Set Address</button>
        </div>
      </div>
      <p class="text-xs text-slate-400 mt-3 text-center">Deployer wallet becomes the contract owner. Gas paid in USDC on Arc Network.</p>
    </div>

    <div id="deployed-result" class="hidden card p-6 bg-emerald-50 border-emerald-200 mb-4">
      <h3 class="font-bold text-emerald-800 mb-2 flex items-center gap-2"><i class="fas fa-check-circle text-emerald-500"></i> Contract Deployed!</h3>
      <p class="text-sm text-emerald-700 mb-3">Address saved to browser. All checkouts will now use this contract.</p>
      <div class="bg-white border rounded-lg p-3 font-mono text-xs break-all" id="deployed-addr-display"></div>
      <a id="deployed-explorer-link" href="#" target="_blank" class="mt-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
        <i class="fas fa-external-link-alt"></i> View on Explorer
      </a>
    </div>

    <div class="card p-6 text-sm text-slate-500">
      <h3 class="font-semibold text-slate-700 mb-2">ShuklyEscrow Functions</h3>
      <ul class="space-y-1 font-mono text-xs">
        <li><span class="text-purple-600">createEscrow</span>(bytes32 orderId, address seller, address token, uint256 amount)</li>
        <li><span class="text-purple-600">fundEscrow</span>(bytes32 orderId) — pulls tokens from buyer</li>
        <li><span class="text-purple-600">confirmDelivery</span>(bytes32 orderId) — buyer confirms receipt</li>
        <li><span class="text-purple-600">releaseFunds</span>(bytes32 orderId) — releases to seller</li>
        <li><span class="text-purple-600">refund</span>(bytes32 orderId) — returns to buyer</li>
        <li><span class="text-purple-600">openDispute</span>(bytes32 orderId)</li>
        <li><span class="text-purple-600">getEscrow</span>(bytes32 orderId) view</li>
      </ul>
    </div>
  </div>

  <script>
  const ESCROW_BYTECODE = '0x60806040525f6002553480156012575f5ffd5b50600180546001600160a01b031916331790556111ad806100325f395ff3fe608060405234801561000f575f5ffd5b50600436106100a6575f3560e01c806374950ffd1161006e57806374950ffd146101695780638da5cb5b1461017c578063c92ee043146101a7578063f023b811146101ba578063f08ef6cb14610211578063f8e65d6114610224575f5ffd5b806324a9d853146100aa5780632d83549c146100c657806343a0e3e61461012e5780636e629653146101435780637249fbb614610156575b5f5ffd5b6100b360025481565b6040519081526020015b60405180910390f35b61011c6100d4366004610fb2565b5f602081905290815260409020805460018201546002830154600384015460048501546005909501546001600160a01b03948516959385169490921692909160ff9091169086565b6040516100bd96959493929190610fdd565b61014161013c366004611044565b610237565b005b61014161015136600461108d565b61049f565b610141610164366004610fb2565b61073f565b610141610177366004610fb2565b61090f565b60015461018f906001600160a01b031681565b6040516001600160a01b0390911681526020016100bd565b6101416101b5366004610fb2565b6109ef565b61011c6101c8366004610fb2565b5f908152602081905260409020805460018201546002830154600384015460048501546005909501546001600160a01b0394851696938516959490921693909260ff9091169190565b61014161021f366004610fb2565b610ca3565b610141610232366004610fb2565b610de1565b6001546001600160a01b031633146102835760405162461bcd60e51b815260206004820152600a60248201526927b7363c9037bbb732b960b11b60448201526064015b60405180910390fd5b5f8281526020819052604090206005600482015460ff1660058111156102ab576102ab610fc9565b146102e75760405162461bcd60e51b815260206004820152600c60248201526b139bdd08191a5cdc1d5d195960a21b604482015260640161027a565b81156103cf576004818101805460ff19166003908117909155600283015460018401549184015460405163a9059cbb60e01b81526001600160a01b03938416948101949094526024840152169063a9059cbb906044016020604051808303815f875af1158015610359573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061037d91906110ce565b50600181015460038201546040519081526001600160a01b039091169084907f75d86e5bfa1175e2dc677f3abe3aebba3069f2db6ae492f1734d4b4bc65f61c1906020015b60405180910390a3505050565b6004818101805460ff19168217905560028201548254600384015460405163a9059cbb60e01b81526001600160a01b03928316948101949094526024840152169063a9059cbb906044016020604051808303815f875af1158015610435573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061045991906110ce565b50805460038201546040519081526001600160a01b039091169084907ffc31a7ddbe933aa6e67f3c98c183fbc87addd2b602fcfb10238d2f85cf026617906020016103c2565b5f848152602081905260409020546001600160a01b0316156104fb5760405162461bcd60e51b8152602060048201526015602482015274457363726f7720616c72656164792065786973747360581b604482015260640161027a565b6001600160a01b0383166105425760405162461bcd60e51b815260206004820152600e60248201526d24b73b30b634b21039b2b63632b960911b604482015260640161027a565b336001600160a01b038416036105935760405162461bcd60e51b8152602060048201526016602482015275213abcb2b91031b0b73737ba1031329039b2b63632b960511b604482015260640161027a565b6001600160a01b0382166105d95760405162461bcd60e51b815260206004820152600d60248201526c24b73b30b634b2103a37b5b2b760991b604482015260640161027a565b5f811161061d5760405162461bcd60e51b81526020600482015260126024820152710416d6f756e74206d757374206265203e20360741b604482015260640161027a565b6040805160c0810182523381526001600160a01b03858116602083015284169181019190915260608101829052608081015f8152426020918201525f868152808252604090819020835181546001600160a01b03199081166001600160a01b039283161783559385015160018084018054871692841692909217909155928501516002830180549095169116179092556060830151600383015560808301516004830180549192909160ff1916908360058111156106dd576106dd610fc9565b021790555060a09190910151600590910155604080516001600160a01b03848116825260208201849052851691339187917fa659390cb932e6b1ea09aba8819db2052575206b54a121463b49371aa8dae6a7910160405180910390a450505050565b5f8181526020819052604090205481906001600160a01b031633146107765760405162461bcd60e51b815260040161027a906110f0565b5f8281526020819052604090206001600482015460ff16600581111561079e5761079e610fc9565b146107eb5760405162461bcd60e51b815260206004820152601e60248201527f43616e6e6f7420726566756e6420696e2063757272656e742073746174650000604482015260640161027a565b6004818101805460ff19168217905560028201548254600384015460405163a9059cbb60e01b81526001600160a01b039283169481019490945260248401525f9291169063a9059cbb906044016020604051808303815f875af1158015610854573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061087891906110ce565b9050806108c05760405162461bcd60e51b81526020600482015260166024820152751499599d5b99081d1c985b9cd9995c8819985a5b195960521b604482015260640161027a565b815460038301546040519081526001600160a01b039091169085907ffc31a7ddbe933aa6e67f3c98c183fbc87addd2b602fcfb10238d2f85cf026617906020015b60405180910390a350505050565b5f8181526020819052604090205481906001600160a01b031633146109465760405162461bcd60e51b815260040161027a906110f0565b5f8281526020819052604090206001600482015460ff16600581111561096e5761096e610fc9565b146109af5760405162461bcd60e51b8152602060048201526011602482015270115cd8dc9bddc81b9bdd08119553911151607a1b604482015260640161027a565b60048101805460ff19166002179055604051339084907ff46bccfdb06ecc81738bcfc5ee961cc50fe62e4a5060c050d8bf69bcd1d47731905f90a3505050565b5f81815260208190526040902080546001600160a01b0316331480610a20575060018101546001600160a01b031633145b610a635760405162461bcd60e51b815260206004820152601460248201527327b7363c90313abcb2b91037b91039b2b63632b960611b604482015260640161027a565b6002600482015460ff166005811115610a7e57610a7e610fc9565b14610ac25760405162461bcd60e51b8152602060048201526014602482015273115cd8dc9bddc81b9bdd0810d3d391925493515160621b604482015260640161027a565b60048101805460ff19166003908117909155600254908201545f9161271091610aeb9190611128565b610af59190611145565b90505f818360030154610b089190611164565b6002840154600185015460405163a9059cbb60e01b81526001600160a01b039182166004820152602481018490529293505f9291169063a9059cbb906044016020604051808303815f875af1158015610b63573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610b8791906110ce565b905080610bd65760405162461bcd60e51b815260206004820152601960248201527f5472616e7366657220746f2073656c6c6572206661696c656400000000000000604482015260640161027a565b8215610c5657600284015460015460405163a9059cbb60e01b81526001600160a01b0391821660048201526024810186905291169063a9059cbb906044016020604051808303815f875af1158015610c30573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610c5491906110ce565b505b60018401546040518381526001600160a01b039091169086907f75d86e5bfa1175e2dc677f3abe3aebba3069f2db6ae492f1734d4b4bc65f61c19060200160405180910390a35050505050565b5f81815260208190526040902080546001600160a01b0316331480610cd4575060018101546001600160a01b031633145b610d175760405162461bcd60e51b815260206004820152601460248201527327b7363c90313abcb2b91037b91039b2b63632b960611b604482015260640161027a565b6001600482015460ff166005811115610d3257610d32610fc9565b1480610d5657506002600482015460ff166005811115610d5457610d54610fc9565b145b610da25760405162461bcd60e51b815260206004820152601f60248201527f43616e6e6f74206469737075746520696e2063757272656e7420737461746500604482015260640161027a565b60048101805460ff19166005179055604051339083907fe7b614d99462ab012c8191c9348164cd62a4aec6d211f42371fd1f0759e5c220905f90a35050565b5f8181526020819052604090205481906001600160a01b03163314610e185760405162461bcd60e51b815260040161027a906110f0565b5f82815260208190526040812090600482015460ff166005811115610e3f57610e3f610fc9565b14610e8c5760405162461bcd60e51b815260206004820152601960248201527f457363726f77206e6f7420696e20454d50545920737461746500000000000000604482015260640161027a565b600281015460038201546040516323b872dd60e01b815233600482015230602482015260448101919091525f916001600160a01b0316906323b872dd906064016020604051808303815f875af1158015610ee8573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610f0c91906110ce565b905080610f6a5760405162461bcd60e51b815260206004820152602660248201527f546f6b656e207472616e73666572206661696c65643a20636865636b20616c6c6044820152656f77616e636560d01b606482015260840161027a565b60048201805460ff191660011790556003820154604051908152339085907fb0f7b6ab70e0186c433938ee752b2498a7cab42018e6bf7596cd704c81c470bc90602001610901565b5f60208284031215610fc2575f5ffd5b5035919050565b634e487b7160e01b5f52602160045260245ffd5b6001600160a01b0387811682528681166020830152851660408201526060810184905260c081016006841061102057634e487b7160e01b5f52602160045260245ffd5b608082019390935260a00152949350505050565b8015158114611041575f5ffd5b50565b5f5f60408385031215611055575f5ffd5b82359150602083013561106781611034565b809150509250929050565b80356001600160a01b0381168114611088575f5ffd5b919050565b5f5f5f5f608085870312156110a0575f5ffd5b843593506110b060208601611072565b92506110be60408601611072565b9396929550929360600135925050565b5f602082840312156110de575f5ffd5b81516110e981611034565b9392505050565b6020808252600a908201526927b7363c90313abcb2b960b11b604082015260600190565b634e487b7160e01b5f52601160045260245ffd5b808202811582820484141761113f5761113f611114565b92915050565b5f8261115f57634e487b7160e01b5f52601260045260245ffd5b500490565b8181038181111561113f5761113f61111456fea2646970667358221220005a0901a06072c1c8d0bb8592692ff2bdda55f3fd069fcfda67dd532120acd064736f6c63430008220033';

  document.addEventListener('DOMContentLoaded', () => {
    const addr = localStorage.getItem('shukly_escrow_address') || window.ARC.contracts.ShuklyEscrow || 'Not set';
    document.getElementById('current-escrow-addr').textContent = addr;
    if(addr && addr.startsWith('0x') && addr !== '0x0000000000000000000000000000000000000000') {
      document.getElementById('deployed-addr-display').textContent = addr;
      document.getElementById('deployed-explorer-link').href = window.ARC.explorer + '/address/' + addr;
      document.getElementById('deployed-result').classList.remove('hidden');
    }
  });

  function setManualAddr() {
    const input = document.getElementById('manual-addr-input');
    const addr = (input.value || '').trim();
    if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
      alert('Invalid address — must be a 42-char hex address starting with 0x');
      return;
    }
    localStorage.setItem('shukly_escrow_address', addr);
    document.getElementById('current-escrow-addr').textContent = addr;
    document.getElementById('deployed-addr-display').textContent = addr;
    document.getElementById('deployed-explorer-link').href = window.ARC.explorer + '/address/' + addr;
    document.getElementById('deployed-result').classList.remove('hidden');
    document.getElementById('deploy-status').innerHTML = '<div class="p-4 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 text-sm"><i class="fas fa-check-circle mr-2"></i>Escrow address set to ' + addr + '. All checkouts will now use this contract.</div>';
  }

  async function deployContract() {
    const statusEl = document.getElementById('deploy-status');
    const btn = document.getElementById('deploy-btn');
    const resultEl = document.getElementById('deployed-result');

    const setStatus = (msg, type='info') => {
      const colors = { info:'bg-blue-50 border-blue-200 text-blue-800', success:'bg-emerald-50 border-emerald-200 text-emerald-800', error:'bg-red-50 border-red-200 text-red-800', warning:'bg-amber-50 border-amber-200 text-amber-800' };
      statusEl.innerHTML = '<div class="p-4 rounded-lg border '+colors[type]+' text-sm">'+msg+'</div>';
    };

    try {
      if(!window.ethereum) { setStatus('<i class="fas fa-exclamation-circle mr-2"></i>MetaMask not detected. Please install MetaMask.', 'error'); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Connecting MetaMask…';

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);

      // Ensure Arc Testnet
      const net = await provider.getNetwork();
      if(net.chainId !== BigInt(window.ARC.chainId)) {
        setStatus('<i class="fas fa-exclamation-triangle mr-2"></i>Please switch MetaMask to Arc Testnet (Chain ID: 5042002) and try again.', 'warning');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket mr-2"></i> Deploy ShuklyEscrow via MetaMask';
        return;
      }

      const signer = await provider.getSigner();
      const deployerAddr = await signer.getAddress();
      setStatus('<i class="fas fa-spinner fa-spin mr-2"></i>Deploying from <code class="font-mono text-xs">'+deployerAddr.slice(0,14)+'…</code> — confirm in MetaMask…', 'info');
      btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Confirm in MetaMask…';

      // Deploy using ContractFactory with full ABI
      const factory = new ethers.ContractFactory(ESCROW_ABI, ESCROW_BYTECODE, signer);
      const contract = await factory.deploy();

      setStatus('<i class="fas fa-spinner fa-spin mr-2"></i>Waiting for on-chain confirmation… <code class="font-mono text-xs">'+contract.deploymentTransaction().hash.slice(0,14)+'…</code>', 'info');
      btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Waiting for confirmation…';

      await contract.waitForDeployment();
      const deployedAddress = await contract.getAddress();
      const txHash = contract.deploymentTransaction().hash;

      // Save to localStorage
      localStorage.setItem('shukly_escrow_address', deployedAddress);
      document.getElementById('current-escrow-addr').textContent = deployedAddress;

      // Show result
      document.getElementById('deployed-addr-display').textContent = deployedAddress;
      const explorerUrl = window.ARC.explorer + '/address/' + deployedAddress;
      document.getElementById('deployed-explorer-link').href = explorerUrl;
      resultEl.classList.remove('hidden');

      setStatus('<i class="fas fa-check-circle mr-2"></i>Deployed at <code class="font-mono text-xs">'+deployedAddress+'</code>. Tx: <a href="'+window.ARC.explorer+'/tx/'+txHash+'" target="_blank" class="underline font-mono text-xs">'+txHash.slice(0,18)+'…</a>', 'success');
      btn.innerHTML = '<i class="fas fa-check mr-2"></i> Deployed Successfully';

    } catch(err) {
      const msg = err.code==='ACTION_REJECTED'||err.code===4001
        ? 'Deployment rejected by user.'
        : 'Deploy error: '+(err.shortMessage||err.message||'Unknown error');
      setStatus('<i class="fas fa-times-circle mr-2"></i>'+msg, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-rocket mr-2"></i> Retry Deployment';
    }
  }
  </script>
  `)
}
