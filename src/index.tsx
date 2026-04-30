import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Platform-agnostic Bindings — works on both Cloudflare Workers and Vercel/Node.js
// On Cloudflare: DB/PRODUCTS_KV are native bindings injected by the runtime
// On Vercel: DB/PRODUCTS_KV are undefined → app falls back to in-memory store
type Bindings = {
  DB?: any              // D1Database on Cloudflare, undefined on Vercel
  PRODUCTS_KV?: any    // KVNamespace on Cloudflare, undefined on Vercel
  CIRCLE_API_KEY?: string
}
const app = new Hono<{ Bindings: Bindings }>()
app.use('*', cors())

// ─── Security Headers Middleware ─────────────────────────────────────────────
// Applied at Worker level — works correctly on Cloudflare Pages with _worker.js
app.use('*', async (c, next) => {
  await next()

  const url = new URL(c.req.url)
  const path = url.pathname

  // ── Base security headers (all routes) ──
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-XSS-Protection', '0')
  c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=()')
  c.res.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin')

  // ── Content-Security-Policy ──
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: ipfs: https://ipfs.io https://cloudflare-ipfs.com https://gateway.pinata.cloud https://www.genspark.ai",
    "connect-src 'self' https://rpc.testnet.arc.network https://rpc.blockdaemon.testnet.arc.network https://api.circle.com https://testnet.arcscan.app https://faucet.circle.com https://ipfs.io wss:",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join('; ')
  c.res.headers.set('Content-Security-Policy', csp)

  // ── Path-specific Cache-Control ──
  if (path.startsWith('/static/') || path.startsWith('/images/')) {
    const maxAge = path.startsWith('/images/') ? 604800 : 31536000
    const immutable = path.startsWith('/static/') ? ', immutable' : ''
    c.res.headers.set('Cache-Control', `public, max-age=${maxAge}${immutable}`)
  } else if (path.startsWith('/api/')) {
    c.res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  }
})

// ─── Product type ────────────────────────────────────────────────────────────
interface Product {
  id: string; title: string; description: string; price: number
  token: string; image: string; category: string; stock: number
  seller_id: string; status: string; created_at: string; updated_at: string
}

// ─── Storage Adapter — D1 when available, KV fallback, memory last resort ────
// This prevents "Cannot read properties of undefined (reading 'prepare')" when
// the D1 binding is not configured on the Cloudflare Pages project.

// In-memory fallback (per-isolate, cleared on redeploy — only used when no KV is available)
let _memProducts: Product[] = []

function nowISO() { return new Date().toISOString() }

// ─── Cloudflare KV helpers ────────────────────────────────────────────────────
async function kvGetAll(kv: any): Promise<Product[]> {
  try {
    const raw = await kv.get('products_v1')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
async function kvSaveAll(kv: any, products: Product[]): Promise<void> {
  await kv.put('products_v1', JSON.stringify(products))
}

// ─── Vercel KV (Upstash Redis) helpers — active when KV_REST_API_URL is set ──
// Uses the Redis REST API directly (no SDK needed in the bundle)
async function vercelKvGet(key: string): Promise<Product[] | null> {
  const url  = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  try {
    const res = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json: any = await res.json()
    if (json.result == null) return []
    return JSON.parse(json.result) as Product[]
  } catch { return null }
}
async function vercelKvSet(key: string, value: Product[]): Promise<void> {
  const url  = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return
  try {
    await fetch(`${url}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value))
    })
  } catch { /* silent */ }
}

// ─── Cloudflare KV REST API helpers — used by Vercel when CF creds are set ───
// This lets Vercel read/write the same KV namespace as Cloudflare Pages,
// keeping products in sync between both platforms.
const CF_KV_NS  = 'e7c8a4b7a03c4cd9b0a577817b26f868'
const CF_KV_URL = `https://api.cloudflare.com/client/v4/accounts`

async function cfKvGet(key: string): Promise<Product[] | null> {
  const token   = process.env.CF_API_TOKEN
  const account = process.env.CF_ACCOUNT_ID
  if (!token || !account) return null
  try {
    // AbortController: timeout after 8s to avoid hanging Vercel serverless fn
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`${CF_KV_URL}/${account}/storage/kv/namespaces/${CF_KV_NS}/values/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    })
    clearTimeout(timer)
    // 404 means key genuinely doesn't exist yet → return empty array
    if (res.status === 404) return []
    if (!res.ok) return null   // any other error → fall through to next backend
    const text = await res.text()
    if (!text || text === 'null') return []
    return JSON.parse(text) as Product[]
  } catch { return null }
}
async function cfKvSet(key: string, value: Product[]): Promise<void> {
  const token   = process.env.CF_API_TOKEN
  const account = process.env.CF_ACCOUNT_ID
  if (!token || !account) return
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const form = new FormData()
    form.append('value', JSON.stringify(value))
    form.append('metadata', '{}')
    await fetch(`${CF_KV_URL}/${account}/storage/kv/namespaces/${CF_KV_NS}/values/${key}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: ctrl.signal
    })
    clearTimeout(timer)
  } catch { /* silent */ }
}

// Helper: detect available storage backend
function hasVercelKV(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}
function hasCfKV(): boolean {
  return !!(process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID)
}

// Strip images from products to create a slim version for fast listing
function makeSlim(products: Product[]): Product[] {
  return products.map(({ image: _img, ...rest }) => rest as Product)
}

// Universal get/set — tries Vercel KV → CF KV REST → CF binding → memory
// storageGet: returns FULL products (with images) — used for individual lookups
async function storageGet(cfBinding?: any): Promise<{ data: Product[]; source: string }> {
  if (hasVercelKV()) {
    const d = await vercelKvGet('products_v1')
    if (d !== null) return { data: d, source: 'vercel-kv' }
  }
  if (hasCfKV()) {
    const d = await cfKvGet('products_v1')
    if (d !== null) return { data: d, source: 'cf-kv-rest' }
  }
  if (cfBinding) {
    return { data: await kvGetAll(cfBinding), source: 'KV' }
  }
  return { data: _memProducts, source: 'memory' }
}

// storageGetSlim: returns products WITHOUT images — fast, ~10KB vs ~2MB
// Used by /api/products list endpoint on Vercel to avoid downloading 2MB from CF KV
async function storageGetSlim(cfBinding?: any): Promise<{ data: Product[]; source: string }> {
  if (hasVercelKV()) {
    const d = await vercelKvGet('products_slim_v1')
    if (d !== null && d.length > 0) return { data: d, source: 'vercel-kv-slim' }
    // fallback to full and slim it
    const full = await vercelKvGet('products_v1')
    if (full !== null) return { data: makeSlim(full), source: 'vercel-kv' }
  }
  if (hasCfKV()) {
    // Try slim key first (tiny ~10KB payload)
    const slim = await cfKvGet('products_slim_v1')
    if (slim !== null && slim.length > 0) return { data: slim, source: 'cf-kv-rest-slim' }
    // Slim key not populated yet: fetch full and slim it (one-time cost until next write)
    const full = await cfKvGet('products_v1')
    if (full !== null) {
      const slimmed = makeSlim(full)
      // Write slim key in background for future requests
      cfKvSet('products_slim_v1', slimmed).catch(() => {})
      return { data: slimmed, source: 'cf-kv-rest' }
    }
  }
  if (cfBinding) {
    const all = await kvGetAll(cfBinding)
    return { data: makeSlim(all), source: 'KV' }
  }
  return { data: makeSlim(_memProducts), source: 'memory' }
}
async function storageSet(products: Product[], cfBinding?: any): Promise<void> {
  if (hasVercelKV()) {
    await vercelKvSet('products_v1', products)
    // Also write slim version (no images) for fast listing
    await vercelKvSet('products_slim_v1', makeSlim(products))
    return
  }
  if (hasCfKV()) {
    // Write full version and slim version in parallel
    await Promise.all([
      cfKvSet('products_v1', products),
      cfKvSet('products_slim_v1', makeSlim(products))
    ])
    return
  }
  if (cfBinding)          { await kvSaveAll(cfBinding, products); return }
  _memProducts = products
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
    // CF KV REST slim (no images, ~10KB) → full fallback → CF binding → memory
    const { data: all, source } = await storageGetSlim(env.PRODUCTS_KV)
    let filtered = all.filter(p => p.status === 'active')
    if (opts.category) filtered = filtered.filter(p => p.category === opts.category)
    if (opts.seller)   filtered = filtered.filter(p => p.seller_id === opts.seller)
    if (opts.q) {
      const qLow = opts.q.toLowerCase()
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(qLow) || p.description.toLowerCase().includes(qLow))
    }
    filtered.sort((a,b) => b.created_at.localeCompare(a.created_at))
    return { products: filtered, source }
  },

  // Get single product by id
  async get(env: Bindings, id: string): Promise<Product | null> {
    if (env.DB) {
      try {
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'`).bind(id).first()
        return (row as Product) || null
      } catch (e: any) { console.error('D1 get error:', e.message) }
    }
    const { data: all2 } = await storageGet(env.PRODUCTS_KV)
    return all2.find(p => p.id === id && p.status === 'active') || null
  },

  // Get product by id (any status) — for seller operations
  async getAny(env: Bindings, id: string): Promise<Product | null> {
    if (env.DB) {
      try {
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first()
        return (row as Product) || null
      } catch (e: any) { console.error('D1 getAny error:', e.message) }
    }
    const { data: allG } = await storageGet(env.PRODUCTS_KV)
    return allG.find(p => p.id === id) || null
  },

  // List products for a seller (all statuses except deleted)
  async listBySeller(env: Bindings, address: string): Promise<Product[]> {
    // Normalise address to lowercase for cross-browser consistency (Brave/Chrome
    // may preserve checksummed addresses differently)
    const normAddr = address.toLowerCase()
    if (env.DB) {
      try {
        // LOWER() handles addresses stored in either checksummed or lowercase form
        const { results } = await env.DB.prepare(
          `SELECT * FROM products WHERE LOWER(seller_id) = ? AND status != 'deleted' ORDER BY created_at DESC`
        ).bind(normAddr).all()
        return results as Product[]
      } catch (e: any) { console.error('D1 listBySeller error:', e.message) }
    }
    const { data: allS } = await storageGet(env.PRODUCTS_KV)
    return allS.filter(p => p.seller_id && p.seller_id.toLowerCase() === normAddr && p.status !== 'deleted')
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
    const { data: allC } = await storageGet(env.PRODUCTS_KV)
    allC.unshift(product)
    await storageSet(allC, env.PRODUCTS_KV)
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
    const { data: allSt } = await storageGet(env.PRODUCTS_KV)
    const idx = allSt.findIndex(p => p.id === id)
    if (idx < 0) return false
    allSt[idx].status = status
    allSt[idx].updated_at = nowISO()
    await storageSet(allSt, env.PRODUCTS_KV)
    return true
  },

  // Update product fields (seller only — name, description, price, image)
  async update(env: Bindings, id: string, fields: Partial<Pick<Product,'title'|'description'|'price'|'image'|'token'|'stock'|'category'>>): Promise<Product | null> {
    if (env.DB) {
      try {
        const sets: string[] = []
        const vals: any[]   = []
        if (fields.title       !== undefined) { sets.push('title=?');       vals.push(fields.title) }
        if (fields.description !== undefined) { sets.push('description=?'); vals.push(fields.description) }
        if (fields.price       !== undefined) { sets.push('price=?');       vals.push(fields.price) }
        if (fields.image       !== undefined) { sets.push('image=?');       vals.push(fields.image) }
        if (fields.token       !== undefined) { sets.push('token=?');       vals.push(fields.token) }
        if (fields.stock       !== undefined) { sets.push('stock=?');       vals.push(fields.stock) }
        if (fields.category    !== undefined) { sets.push('category=?');    vals.push(fields.category) }
        if (!sets.length) return null
        sets.push("updated_at=datetime('now')")
        vals.push(id)
        await env.DB.prepare(`UPDATE products SET ${sets.join(',')} WHERE id = ?`).bind(...vals).run()
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first()
        return (row as Product) || null
      } catch (e: any) { console.error('D1 update error:', e.message) }
    }
    const { data: allU } = await storageGet(env.PRODUCTS_KV)
    const idx = allU.findIndex(p => p.id === id)
    if (idx < 0) return null
    if (fields.title       !== undefined) allU[idx].title       = fields.title
    if (fields.description !== undefined) allU[idx].description = fields.description
    if (fields.price       !== undefined) allU[idx].price       = fields.price
    if (fields.image       !== undefined) allU[idx].image       = fields.image
    if (fields.token       !== undefined) allU[idx].token       = fields.token
    if (fields.stock       !== undefined) allU[idx].stock       = fields.stock
    if (fields.category    !== undefined) allU[idx].category    = fields.category
    allU[idx].updated_at = nowISO()
    await storageSet(allU, env.PRODUCTS_KV)
    return allU[idx]
  }
}

// ─── DB init (only when D1 is bound) ─────────────────────────────────────────
let _dbReady = false
async function initDB(db?: any) {
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

// ─── Circle API helper ───────────────────────────────────────────────────────
const CIRCLE_BASE_URL = 'https://api.circle.com/v1'

async function circleRequest(
  env: Bindings,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: any }> {
  const apiKey = env.CIRCLE_API_KEY
  if (!apiKey) return { ok: false, status: 500, data: { error: 'CIRCLE_API_KEY not configured' } }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }

  const opts: RequestInit = { method, headers }
  if (body && method !== 'GET') opts.body = JSON.stringify(body)

  try {
    const res = await fetch(`${CIRCLE_BASE_URL}${path}`, opts)
    const data = await res.json()
    return { ok: res.ok, status: res.status, data }
  } catch (e: any) {
    return { ok: false, status: 500, data: { error: e.message } }
  }
}

// ─── Arc Commerce — Payment info & network endpoint ──────────────────────────
// GET  /api/arc-payment/info — returns network info and token addresses
app.get('/api/arc-payment/info', (c) => {
  return c.json({
    network:   'Arc Testnet',
    chainId:   ARC.chainId,
    chainHex:  ARC.chainIdHex,
    rpc:       ARC.rpc,
    explorer:  ARC.explorer,
    faucet:    ARC.faucet,
    tokens: {
      USDC: { address: ARC.contracts.USDC, decimals: 6, symbol: 'USDC', name: 'USD Coin' },
      EURC: { address: ARC.contracts.EURC, decimals: 6, symbol: 'EURC', name: 'Euro Coin' },
    },
    escrow: {
      address:  ARC.contracts.ShuklyEscrow,
      deployed: ARC.contracts.ShuklyEscrow !== '0x0000000000000000000000000000000000000000',
      explorer: `${ARC.explorer}/address/${ARC.contracts.ShuklyEscrow}`,
    },
    integration: {
      name:        'Arc Commerce',
      version:     '1.0.0',
      description: 'Circle USDC payment layer — non-destructive extension',
      source:      'https://github.com/circlefin/arc-commerce',
      isTestnet:   true,
    }
  })
})

// POST /api/arc-payment/validate — validate payment inputs server-side
app.post('/api/arc-payment/validate', async (c) => {
  try {
    const body = await c.req.json() as any
    const { buyerAddress, sellerAddress, amount, token = 'USDC', orderId } = body

    const errors: string[] = []

    // Address validation (basic)
    const addrRe = /^0x[0-9a-fA-F]{40}$/
    if (!addrRe.test(buyerAddress))  errors.push('Invalid buyer address')
    if (!addrRe.test(sellerAddress)) errors.push('Invalid seller address')
    if (buyerAddress && sellerAddress &&
        buyerAddress.toLowerCase() === sellerAddress.toLowerCase())
      errors.push('Buyer and seller cannot be the same address')
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      errors.push('Amount must be a positive number')
    if (!['USDC', 'EURC'].includes(token))
      errors.push('Token must be USDC or EURC')
    if (!orderId || typeof orderId !== 'string' || orderId.trim() === '')
      errors.push('orderId is required')

    if (errors.length > 0) {
      return c.json({ valid: false, errors }, 400)
    }

    return c.json({
      valid: true,
      payment: {
        orderId:         orderId.trim(),
        buyerAddress:    buyerAddress.toLowerCase(),
        sellerAddress:   sellerAddress.toLowerCase(),
        amount:          Number(amount).toFixed(6),
        token,
        tokenAddress:    token === 'EURC' ? ARC.contracts.EURC : ARC.contracts.USDC,
        escrowAddress:   ARC.contracts.ShuklyEscrow,
        network:         'Arc Testnet',
        chainId:         ARC.chainId,
      }
    })
  } catch (e: any) {
    return c.json({ valid: false, errors: [e.message] }, 500)
  }
})

// ─── Circle API proxy routes ─────────────────────────────────────────────────
// All routes are server-side only — CIRCLE_API_KEY never exposed to frontend

// GET /api/circle/ping — verify API key is valid
app.get('/api/circle/ping', async (c) => {
  const r = await circleRequest(c.env, 'GET', '/ping')
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || 'Circle API error', status: r.status }, r.status as any)
  return c.json({ ok: true, message: 'Circle API reachable', data: r.data })
})

// GET /api/circle/config — return Circle network config for Arc Testnet (no key exposed)
app.get('/api/circle/config', (c) => {
  const hasKey = !!c.env.CIRCLE_API_KEY
  return c.json({
    configured: hasKey,
    blockchain: 'ARC-TESTNET',
    usdc_token_id: 'USDC-ARC-TESTNET',
    network: 'Arc Testnet',
    chain_id: ARC.chainId,
    usdc_address: ARC.contracts.USDC,
    eurc_address: ARC.contracts.EURC,
    explorer: ARC.explorer,
    faucet: ARC.faucet,
    // Key is never returned — only presence confirmed
    key_status: hasKey ? 'configured' : 'missing',
  })
})

// GET /api/circle/wallets — list Circle developer-controlled wallets
app.get('/api/circle/wallets', async (c) => {
  const r = await circleRequest(c.env, 'GET', '/developer/wallets')
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || 'Circle API error', status: r.status }, r.status as any)
  return c.json({ ok: true, wallets: r.data?.data || [], count: r.data?.data?.length || 0 })
})

// GET /api/circle/wallet/:id/balance — get balance of a specific wallet
app.get('/api/circle/wallet/:id/balance', async (c) => {
  const walletId = c.req.param('id')
  const r = await circleRequest(c.env, 'GET', `/developer/wallets/${walletId}/balances`)
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || 'Circle API error' }, r.status as any)
  return c.json({ ok: true, balances: r.data?.data?.tokenBalances || [], walletId })
})

// POST /api/circle/transfer — initiate a USDC transfer via Circle API
app.post('/api/circle/transfer', async (c) => {
  try {
    const body = await c.req.json() as any
    const { sourceWalletId, destinationAddress, amount, idempotencyKey } = body

    if (!sourceWalletId || !destinationAddress || !amount)
      return c.json({ ok: false, error: 'Missing required fields: sourceWalletId, destinationAddress, amount' }, 400)

    const addrRe = /^0x[0-9a-fA-F]{40}$/
    if (!addrRe.test(destinationAddress))
      return c.json({ ok: false, error: 'Invalid destination address' }, 400)

    if (isNaN(Number(amount)) || Number(amount) <= 0)
      return c.json({ ok: false, error: 'Amount must be a positive number' }, 400)

    const payload = {
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
      source: { type: 'wallet', id: sourceWalletId },
      destination: { type: 'blockchain', address: destinationAddress, chain: 'ARC' },
      amount: { amount: Number(amount).toFixed(6), currency: 'USD' },
    }

    const r = await circleRequest(c.env, 'POST', '/transfers', payload)
    if (!r.ok) return c.json({ ok: false, error: r.data?.message || 'Transfer failed', details: r.data }, r.status as any)
    return c.json({ ok: true, transfer: r.data?.data, message: 'Transfer initiated' })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// GET /api/circle/transfer/:id — get transfer status
app.get('/api/circle/transfer/:id', async (c) => {
  const transferId = c.req.param('id')
  const r = await circleRequest(c.env, 'GET', `/transfers/${transferId}`)
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || 'Circle API error' }, r.status as any)
  return c.json({ ok: true, transfer: r.data?.data })
})

// ─── Products CRUD (off-chain D1 database) ──────────────────────────────────

// GET /api/products — list all active products (optional ?category=&seller=&q=)
// NOTE: 'image' field is excluded from list response to keep payload small.
// Use GET /api/products/:id to fetch the full product with image.
app.get('/api/products', async (c) => {
  try {
    await initDB(c.env.DB)
    const { products, source } = await store.list(c.env, {
      category: c.req.query('category') || '',
      seller:   c.req.query('seller')   || '',
      q:        c.req.query('q')        || ''
    })
    // Strip base64 images from list response — images can be 100-300KB each
    // The full image is available via GET /api/products/:id
    const slim = products.map(({ image: _img, ...rest }) => rest)
    return c.json({ products: slim, total: slim.length, source })
  } catch (e: any) {
    return c.json({ products: [], total: 0, source: 'error', error: e.message })
  }
})

// GET /api/products/images?ids=id1,id2,id3 — batch fetch images for multiple products
// IMPORTANT: This route must be registered BEFORE /api/products/:id to avoid param conflict
// Returns { images: { [id]: imageDataUrl } } — keeps list payload small and allows parallel image loading
app.get('/api/products/images', async (c) => {
  try {
    const idsParam = c.req.query('ids') || ''
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50) // max 50
    if (ids.length === 0) return c.json({ images: {} })

    const { data: products } = await storageGet(c.env.PRODUCTS_KV)
    const images: Record<string, string> = {}
    for (const id of ids) {
      const p = products.find((x: Product) => x.id === id)
      if (p && p.image) images[id] = p.image
    }
    return c.json({ images })
  } catch (e: any) {
    return c.json({ images: {}, error: e.message })
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
    if ((row.seller_id || '').toLowerCase() !== String(seller_id || '').toLowerCase())   return c.json({ error: 'Unauthorized' }, 403)
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
    if ((row.seller_id || '').toLowerCase() !== String(seller_id || '').toLowerCase())   return c.json({ error: 'Unauthorized' }, 403)
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

// PATCH /api/products/:id — update product fields (seller only: title, description, price, image)
app.patch('/api/products/:id', async (c) => {
  try {
    await initDB(c.env.DB)
    const body = await c.req.json() as any
    const { seller_id, title, description, price, image, token, stock, category } = body
    if (!seller_id) return c.json({ error: 'Missing seller_id' }, 400)
    const row = await store.getAny(c.env, c.req.param('id'))
    if (!row) return c.json({ error: 'Product not found' }, 404)
    // Case-insensitive comparison to handle checksummed vs lowercase addresses
    if ((row.seller_id || '').toLowerCase() !== String(seller_id).toLowerCase()) return c.json({ error: 'Unauthorized' }, 403)
    if (price !== undefined && Number(price) <= 0)
      return c.json({ error: 'Price must be greater than 0' }, 400)
    if (token !== undefined && !['USDC','EURC'].includes(token))
      return c.json({ error: 'Token must be USDC or EURC' }, 400)
    const fields: any = {}
    if (title       !== undefined) fields.title       = String(title).trim()
    if (description !== undefined) fields.description = String(description).trim()
    if (price       !== undefined) fields.price       = Number(price)
    if (image       !== undefined) fields.image       = String(image)
    if (token       !== undefined) fields.token       = String(token)
    if (stock       !== undefined) fields.stock       = Number(stock)
    if (category    !== undefined) fields.category    = String(category)
    const updated = await store.update(c.env, c.req.param('id'), fields)
    return c.json({ product: updated, success: true })
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

// ─── GET /api/orders/on-chain — fetch real escrow events from Arc Network ──────
// Queries EscrowFunded events via eth_getLogs (last ~5000 blocks ≈ ~4 hours).
// Optional query params:
//   ?buyer=0x...   — filter by buyer address (topic2, case-insensitive)
//   ?limit=N       — max results (default 20, max 50)
// Returns: { orders: [...], source: 'on_chain', blockRange: [...], total: N }
app.get('/api/orders/on-chain', async (c) => {
  try {
    const buyerParam  = (c.req.query('buyer')  || '').trim().toLowerCase()
    const sellerParam = (c.req.query('seller') || '').trim().toLowerCase()
    const limitParam  = Math.min(parseInt(c.req.query('limit') || '20'), 50)

    // EscrowFunded(bytes32 indexed orderId, address indexed buyer, uint256 amount)
    // topic0 = keccak256("EscrowFunded(bytes32,address,uint256)")
    const ESCROW_FUNDED_TOPIC = '0x98566ec8f6eb0fe52b22bf89e56b38a1c78a779bed8e49e9e1e76f88c5b33975'

    const escrowAddress = ARC.contracts.ShuklyEscrow

    // Get latest block
    const latestHex: string = await arcRpc('eth_blockNumber', [])
    const latest = parseInt(latestHex, 16)
    // Look back ~5000 blocks (~4 hours on Arc testnet ≈ 3s blocks)
    // When filtering by seller, scan more blocks (seller may have older listings)
    const lookback = sellerParam && !buyerParam ? 10000 : 5000
    const fromBlock = '0x' + Math.max(0, latest - lookback).toString(16)

    // Build topics filter — buyer is indexed (topic2); seller is NOT indexed so must filter post-fetch
    let buyerTopic: string | null = null
    if (buyerParam && /^0x[0-9a-f]{40}$/i.test(buyerParam)) {
      buyerTopic = '0x000000000000000000000000' + buyerParam.replace('0x', '').toLowerCase()
    }

    const topics: (string | null)[] = [ESCROW_FUNDED_TOPIC, null, buyerTopic]

    const logs: any[] = await arcRpc('eth_getLogs', [{
      fromBlock,
      toBlock: 'latest',
      address: escrowAddress,
      topics
    }])

    if (!Array.isArray(logs) || logs.length === 0) {
      return c.json({
        orders: [],
        source: 'on_chain',
        blockRange: [parseInt(fromBlock, 16), latest],
        total: 0,
        message: 'No EscrowFunded events found in recent blocks'
      })
    }

    // Parse logs → order objects
    const orders: any[] = []
    for (const log of logs.slice(-limitParam)) {
      try {
        const orderId32  = log.topics?.[1] || ''  // bytes32 orderId
        const buyerAddr  = '0x' + (log.topics?.[2] || '').slice(-40)  // address buyer
        // data = uint256 amount (32 bytes)
        const amountRaw  = log.data && log.data !== '0x' ? BigInt(log.data) : BigInt(0)
        // Determine token from escrow state (try getEscrow view call)
        let token = 'USDC'
        let tokenRaw = ''
        let sellerAddr = ''
        let escrowState = 1  // 1 = FUNDED
        try {
          // getEscrow(bytes32 orderId) returns (buyer, seller, token, amount, state, createdAt)
          const callData = '0x' +
            'c1f8b5d1' +  // getEscrow selector — keccak256("getEscrow(bytes32)")[:4]
            orderId32.replace('0x','').padStart(64,'0')
          const result: string = await arcRpc('eth_call', [{
            to: escrowAddress,
            data: callData
          }, 'latest'])
          if (result && result !== '0x' && result.length >= 2 + 6*64) {
            const r = result.replace('0x','')
            sellerAddr = '0x' + r.slice(64, 128).slice(-40)
            tokenRaw   = '0x' + r.slice(128, 192).slice(-40)
            escrowState = parseInt(r.slice(256, 320), 16)
            // Identify token by address
            if (tokenRaw.toLowerCase() === ARC.contracts.EURC.toLowerCase()) token = 'EURC'
            else token = 'USDC'
          }
        } catch { /* fallback — leave defaults */ }

        const amountHuman = (Number(amountRaw) / 1e6).toFixed(2)
        const statusMap: Record<number,string> = {
          0:'escrow_pending', 1:'escrow_locked', 2:'delivery_confirmed',
          3:'funds_released', 4:'refunded', 5:'disputed'
        }

        orders.push({
          id:            orderId32,
          orderId32,
          txHash:        log.transactionHash || '',
          fundTxHash:    log.transactionHash || '',
          buyerAddress:  buyerAddr,
          sellerAddress: sellerAddr,
          amount:        amountHuman,
          token,
          status:        statusMap[escrowState] || 'escrow_locked',
          escrowState,
          blockNumber:   parseInt(log.blockNumber || '0x0', 16),
          explorerUrl:   ARC.explorer + '/tx/' + (log.transactionHash || ''),
          source:        'on_chain'
        })
      } catch { /* skip malformed log */ }
    }

    // Filter by seller if requested (seller is not indexed, so post-process)
    const filtered = sellerParam
      ? orders.filter(o => o.sellerAddress && o.sellerAddress.toLowerCase() === sellerParam)
      : orders

    return c.json({
      orders: filtered.reverse(),  // newest first
      source: 'on_chain',
      blockRange: [parseInt(fromBlock, 16), latest],
      total: filtered.length
    })
  } catch (err: any) {
    console.error('[orders/on-chain]', err)
    return c.json({
      orders: [],
      error: err.message || 'Failed to fetch on-chain orders',
      source: 'on_chain'
    }, 500)
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PAY-WITHOUT-WALLET  ─────────────────────────────────────────────────────
//  POST /api/payment/qr-checkout   — creates a pending payment session
//  GET  /api/payment/poll/:sid     — polls Arc RPC for on-chain ERC-20 Transfer
//                                    to escrow address matching amount+token
//
//  Security rules:
//   • Each sessionId is one-time use (stored in KV / in-memory fallback)
//   • Only confirms if EXACT amount arrives in EXACT token to escrow address
//   • Transfer(from, escrowAddress, amount) event monitored via eth_getLogs
//   • Session expires after 30 minutes
// ═══════════════════════════════════════════════════════════════════════════════

// In-memory session store (fallback when KV not available)
// Format: { [sid]: { escrowAddress, token, tokenAddress, amount, amountWei,
//                    orderId, sellerAddress, createdAt, used, confirmed, txHash } }
const _qrSessions: Map<string, any> = new Map()

// Helper: send JSON-RPC request to Arc Network
async function arcRpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(ARC.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`Arc RPC ${res.status}`)
  const j: any = await res.json()
  if (j.error) throw new Error(`Arc RPC error: ${j.error.message || JSON.stringify(j.error)}`)
  return j.result
}

// ─── POST /api/payment/qr-checkout ───────────────────────────────────────────
app.post('/api/payment/qr-checkout', async (c) => {
  try {
    const body = await c.req.json() as any
    const { cart, token = 'USDC', sellerAddress } = body

    if (!cart || !Array.isArray(cart) || cart.length === 0)
      return c.json({ error: 'cart is required and must not be empty' }, 400)
    if (!['USDC', 'EURC'].includes(token))
      return c.json({ error: 'token must be USDC or EURC' }, 400)
    if (!sellerAddress || !sellerAddress.startsWith('0x'))
      return c.json({ error: 'sellerAddress is required' }, 400)

    const total  = cart.reduce((s: number, i: any) =>
      s + (parseFloat(i.price) || 0) * ((i.quantity || i.qty) || 1), 0)
    if (total <= 0) return c.json({ error: 'total must be > 0' }, 400)

    const fee       = total * 0.015
    const grandTotal = parseFloat((total + fee).toFixed(6))
    const tokenAddress = token === 'EURC' ? ARC.contracts.EURC : ARC.contracts.USDC
    const escrowAddress = ARC.contracts.ShuklyEscrow

    // amountWei: 6 decimals (USDC/EURC both use 6)
    const amountWei = BigInt(Math.round(grandTotal * 1_000_000)).toString()

    const sid = 'QR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)

    const session = {
      sid, orderId, escrowAddress, token, tokenAddress,
      sellerAddress, cart,
      amount: grandTotal, amountWei,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,   // 30 min TTL
      used: false, confirmed: false, txHash: null
    }

    // Try KV storage first, fallback to in-memory
    try {
      const env = c.env as any
      if (env?.PRODUCTS_KV) {
        await env?.PRODUCTS_KV.put(`qr_session:${sid}`, JSON.stringify(session), { expirationTtl: 1800 })
      } else {
        _qrSessions.set(sid, session)
      }
    } catch (_) {
      _qrSessions.set(sid, session)
    }

    return c.json({
      sid, orderId, escrowAddress, token, tokenAddress,
      amount: grandTotal, amountWei,
      expiresAt: session.expiresAt,
      // EIP-681 URI for QR code
      paymentUri: `ethereum:${tokenAddress}/transfer?address=${escrowAddress}&uint256=${amountWei}`,
      instructions: `Send exactly ${grandTotal} ${token} to the escrow address`
    })
  } catch (err: any) {
    console.error('[qr-checkout]', err)
    return c.json({ error: 'Server error: ' + (err.message || String(err)) }, 500)
  }
})

// ─── GET /api/payment/poll/:sid ───────────────────────────────────────────────
//  Polls Arc Network for ERC-20 Transfer event:
//    Transfer(from, to=escrowAddress, value>=amountWei) in tokenAddress contract
//  Uses eth_getLogs with keccak256("Transfer(address,address,uint256)") topic
//  Optional query param: ?from=0x...  — filters by sender address (topic1)
app.get('/api/payment/poll/:sid', async (c) => {
  const sid        = c.req.param('sid')
  const fromParam  = (c.req.query('from') || '').trim().toLowerCase()

  // Load session
  let session: any = null
  try {
    const env = c.env as any
    if (env?.PRODUCTS_KV) {
      const raw = await env?.PRODUCTS_KV.get(`qr_session:${sid}`)
      if (raw) session = JSON.parse(raw)
    }
  } catch (_) {}
  if (!session) session = _qrSessions.get(sid)

  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  if (session.expiresAt < Date.now())
    return c.json({ status: 'expired', error: 'Payment window expired (30 min)' }, 410)

  // Already confirmed — return cached result immediately
  if (session.confirmed)
    return c.json({ status: 'confirmed', txHash: session.txHash, orderId: session.orderId })

  try {
    // ERC-20 Transfer topic0: keccak256("Transfer(address,address,uint256)")
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    // Pad escrowAddress to 32-byte topic (leading zeros, lowercase)
    const escrowTopic = '0x000000000000000000000000' +
      session.escrowAddress.toLowerCase().replace('0x', '')

    // Get current block number
    const latestHex: string = await arcRpc('eth_blockNumber', [])
    const latest = parseInt(latestHex, 16)
    // Look back at most 200 blocks (~10 min on Arc) — covers recent transfers
    const fromBlock = '0x' + Math.max(0, latest - 200).toString(16)

    // Build topics array — if caller supplied a sender address, pin topic1 for precision
    const fromTopic = (fromParam && /^0x[0-9a-f]{40}$/.test(fromParam))
      ? '0x000000000000000000000000' + fromParam.replace('0x', '')
      : null   // null = any sender

    const logs: any[] = await arcRpc('eth_getLogs', [{
      fromBlock,
      toBlock: 'latest',
      address: session.tokenAddress,           // USDC or EURC contract
      topics: [
        TRANSFER_TOPIC,
        fromTopic,                             // from: pinned address OR any
        escrowTopic                            // to: escrow address (padded)
      ]
    }])

    if (!Array.isArray(logs) || logs.length === 0)
      return c.json({ status: 'pending', message: 'No transfer detected yet' })

    // Find a log whose value matches the expected amount
    const amountWei = BigInt(session.amountWei)
    let matchedTx: string | null = null

    for (const log of logs) {
      // data field is the uint256 transfer amount (32 bytes hex)
      if (!log.data || log.data === '0x') continue
      const logValue = BigInt(log.data)
      // Accept exact match OR within 0.001 token tolerance (dust)
      const diff = logValue > amountWei ? logValue - amountWei : amountWei - logValue
      const tolerance = BigInt(1000)  // 0.001 USDC/EURC (6 decimals)
      if (diff > tolerance) continue

      // Extra validation when sender address was provided:
      // topic1 = padded 'from' address — strip leading zeros and compare
      if (fromParam && fromParam !== '') {
        const topic1 = (log.topics?.[1] || '').toLowerCase()
        const logFrom = '0x' + topic1.slice(-40)   // last 20 bytes = address
        if (logFrom !== fromParam) continue        // sender mismatch — skip
      }

      matchedTx = log.transactionHash
      break
    }

    if (!matchedTx)
      return c.json({ status: 'pending', message: 'Transfer found but amount mismatch' })

    // ── Payment confirmed! Mark session used ──────────────────────────
    session.confirmed = true
    session.txHash    = matchedTx
    session.used      = true

    try {
      const env = c.env as any
      if (env?.PRODUCTS_KV) {
        await env?.PRODUCTS_KV.put(`qr_session:${sid}`, JSON.stringify(session), { expirationTtl: 86400 })
      } else {
        _qrSessions.set(sid, session)
      }
    } catch (_) { _qrSessions.set(sid, session) }

    return c.json({
      status:   'confirmed',
      txHash:   matchedTx,
      orderId:  session.orderId,
      amount:   session.amount,
      token:    session.token,
      explorer: `${ARC.explorer}/tx/${matchedTx}`
    })
  } catch (err: any) {
    console.error('[payment/poll]', err)
    return c.json({ status: 'error', message: err.message || 'RPC error' }, 500)
  }
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
app.get('/dashboard', (c) => c.redirect('/profile?tab=products', 301))
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
app.get('/how-to-use', (c) => c.html(howToUsePage()))
app.get('/admin', (c) => c.html(adminPage()))

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
function shell(title: string, body: string, extraHead = '', catNav = '') {
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
    /* ─── Category secondary nav (home page only — injected via shell catNav) ─── */
    .home-cat-nav{width:100%;background:#fff;border-bottom:1px solid #f0f4f8;position:sticky;top:100px;z-index:90;box-shadow:0 2px 12px rgba(0,0,0,.06);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}
    body.banner-hidden .home-cat-nav{top:64px;}
    .home-cat-nav-inner{max-width:1320px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:0;position:relative;}
    .home-cat-nav-arrow{flex-shrink:0;width:32px;height:32px;border-radius:50%;background:#fff;border:1.5px solid #e2e8f0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;color:#64748b;transition:all .2s;z-index:2;box-shadow:0 2px 8px rgba(0,0,0,.08);}
    .home-cat-nav-arrow:hover{background:#f8fafc;border-color:#cbd5e1;color:#1e293b;transform:scale(1.08);}
    .home-cat-nav-arrow--left{margin-right:8px;} .home-cat-nav-arrow--right{margin-left:8px;}
    .home-cat-nav-track{display:flex;align-items:center;gap:4px;overflow-x:auto;scroll-behavior:smooth;padding:10px 0;flex:1;scrollbar-width:none;-ms-overflow-style:none;}
    .home-cat-nav-track::-webkit-scrollbar{display:none;}
    .home-cat-nav-item{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;text-decoration:none;white-space:nowrap;border:1.5px solid transparent;font-size:13px;font-weight:600;color:#475569;background:#f8fafc;transition:all .2s;flex-shrink:0;}
    .home-cat-nav-item:hover{background:color-mix(in srgb,var(--cnav-accent) 10%,white);border-color:var(--cnav-accent);color:var(--cnav-accent);transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.08);}
    .home-cat-nav-item--active{background:color-mix(in srgb,var(--cnav-accent) 12%,white);border-color:var(--cnav-accent);color:var(--cnav-accent);box-shadow:0 2px 8px rgba(0,0,0,.06);}
    .home-cat-nav-icon{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;}
    .home-cat-nav-label{line-height:1;}
    @media(max-width:960px){.home-cat-nav-inner{padding:0 12px;} .home-cat-nav-arrow{display:none;} .home-cat-nav-track{gap:6px;padding:8px 0;} .home-cat-nav-item{font-size:12px;padding:6px 11px;} .home-cat-nav-icon{width:22px;height:22px;font-size:11px;}}
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
  <!-- Arc Commerce — Circle USDC payment service layer (non-destructive extension) -->
  <script src="/static/arcPayments.js" defer></script>
  <!-- TxAlert — Rich transaction notification service (non-destructive, additive) -->
  <script src="/static/txAlerts.js" defer></script>
  <!-- SellerNotify — Seller purchase alert service (non-destructive, additive) -->
  <script src="/static/sellerNotify.js" defer></script>
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
  ${catNav}
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
//  CROSS-BROWSER POLYFILLS & COMPAT FIXES
// ══════════════════════════════════════════════════════════════

// AbortSignal.timeout polyfill (Brave < 102, Firefox < 90, Safari < 15.4)
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = function(ms) {
    var ctrl = new AbortController();
    setTimeout(function() { ctrl.abort(new DOMException('TimeoutError', 'TimeoutError')); }, ms);
    return ctrl.signal;
  };
}

// window.ethereum cross-browser compatibility
// Brave shields can hide window.ethereum — use window.ethereum || window.web3?.currentProvider
(function patchEthereum() {
  if (window.ethereum) return; // already available
  // Brave with shields up: try coinbasewallet or injected providers array
  try {
    var providers = window.ethereum?.providers || [];
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].isMetaMask || providers[i].isBraveWallet) {
        window._ethProvider = providers[i]; return;
      }
    }
  } catch(e) {}
  // EIP-6963 fallback
  try {
    window.addEventListener('eip6963:announceProvider', function(e) {
      if (!window.ethereum && e.detail && e.detail.provider) {
        window.ethereum = e.detail.provider;
      }
    }, { once: true });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch(e) {}
  // Final alias: ensure window.ethereum uses any available provider
  setTimeout(function() {
    if (!window.ethereum && window._ethProvider) window.ethereum = window._ethProvider;
  }, 100);
})();

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
  // Helper to normalise address
  function normWallet(w) {
    if (w && w.address) return Object.assign({}, w, { address: w.address.toLowerCase() });
    return w;
  }
  // 1. Check session (unlocked this tab/session)
  try {
    const sess = sessionStorage.getItem('rh_wallet_sess');
    if (sess) return normWallet(JSON.parse(sess));
  } catch { /* ignore */ }
  // 2. Legacy plain-text wallet (backwards compatibility)
  try {
    const plain = localStorage.getItem('rh_wallet');
    if (plain) {
      const w = JSON.parse(plain);
      // If it has a privateKey in plain text, put in session and continue
      if (w && w.address) {
        const nw = normWallet(w);
        sessionStorage.setItem('rh_wallet_sess', JSON.stringify(nw));
        return nw;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// storeWallet — legacy plain text (used by MetaMask connect flow)
function storeWallet(w) {
  // Always normalise address to lowercase for cross-browser consistency
  if (w && w.address) w = Object.assign({}, w, { address: w.address.toLowerCase() });
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
      // Always lowercase for cross-browser consistency (Brave vs Chrome)
      const address = accounts[0].toLowerCase();

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

// ─ Wallet event listeners (MetaMask / Brave / EIP-1193) ───────
function setupWalletListeners() {
  var eth = window.ethereum || window._ethProvider;
  if (!eth || typeof eth.on !== 'function') return;
  eth.on('accountsChanged', function(accounts) {
    if (!accounts || !accounts.length) {
      clearWallet();
      updateWalletBadge(null);
      showToast('Wallet disconnected', 'info');
      setTimeout(function() { location.reload(); }, 800);
    } else {
      var stored = getStoredWallet();
      // Normalise new address to lowercase
      var newAddr = (accounts[0] || '').toLowerCase();
      if (stored && stored.type === 'metamask') {
        stored.address = newAddr;
        storeWallet(stored);
        updateWalletBadge(newAddr);
        showToast('Account changed: ' + newAddr.substring(0,10) + '\u2026', 'info');
        setTimeout(function() { location.reload(); }, 800);
      } else {
        // Force reload to pick up new account even without stored wallet
        setTimeout(function() { location.reload(); }, 800);
      }
    }
  });
  eth.on('chainChanged', function(chainId) {
    var newChain = parseInt(chainId, 16);
    if (newChain !== ARC_CHAIN_ID) {
      showToast('Wrong network! Please switch to Arc Testnet (Chain ID: 5042002)', 'warning');
    } else {
      showToast('Connected to Arc Testnet \u2713', 'success');
    }
    setTimeout(function() { location.reload(); }, 1000);
  });
  eth.on('disconnect', function() {
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
  // If no MetaMask/browser wallet, check if user has an internal wallet stored
  const storedWallet = (typeof getStoredWallet === 'function') ? getStoredWallet() : null;
  if (!window.ethereum) {
    if (storedWallet && storedWallet.type === 'internal') {
      // Internal wallet — show Arc Network ready
      containerEl.innerHTML = '<div class="network-ok"><i class="fas fa-circle text-green-500"></i>Arc Testnet (Chain ID: 5042002) — Internal wallet active · <a href="' + ARC_EXPLORER + '" target="_blank" class="underline ml-1">Explorer</a></div>';
    } else {
      containerEl.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>No wallet detected. <a href="/wallet" class="underline font-bold ml-1">Connect wallet →</a></div>';
    }
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
document.addEventListener('DOMContentLoaded', function() {
  // 1. Migrate any items saved under old localStorage keys → canonical 'cart'
  CartStore._migrate();
  // 2. Hydrate cart badge
  updateCartBadge();
  // 3. Wallet listeners — also try _ethProvider (Brave shields workaround)
  setupWalletListeners();
  // Retry after EIP-6963 provider announcement (100ms delay)
  setTimeout(function() {
    if (window.ethereum || window._ethProvider) setupWalletListeners();
  }, 150);

  var stored = getStoredWallet();
  if (stored) {
    updateWalletBadge(stored.address);
    // Re-verify MetaMask is still connected (cross-browser: use eth || _ethProvider)
    var eth = window.ethereum || window._ethProvider;
    if (stored.type === 'metamask' && eth) {
      eth.request({ method: 'eth_accounts' }).then(function(accounts) {
        if (!accounts || !accounts.length) {
          clearWallet();
          updateWalletBadge(null);
        } else {
          // Normalise in case the stored address differs in case
          var liveAddr = (accounts[0] || '').toLowerCase();
          if (stored.address !== liveAddr) {
            stored.address = liveAddr;
            storeWallet(stored);
            updateWalletBadge(liveAddr);
          }
        }
      }).catch(function() {});
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
      <a href="/how-to-use" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-book text-xs"></i> How to Use
      </a>
      <a href="/about" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-info-circle text-xs"></i> About Us
      </a>
      <a href="/wallet" id="wallet-nav-btn" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors border border-red-100">
        <i class="fas fa-wallet text-xs"></i>
        <span id="wallet-badge">Wallet</span>
      </a>
      <a href="/notifications" id="bell-nav-btn" class="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100" onclick="if(typeof SellerNotify!=='undefined')SellerNotify.markAllRead()">
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
<button onclick="toggleChat()" class="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-red-800 text-white shadow-xl flex items-center justify-center text-xl hover:scale-110 transition-transform z-[300]" title="HawkAI Assistant">
  <i class="fas fa-robot"></i>
</button>
<div id="chat-panel" class="hidden fixed bottom-24 right-6 w-[420px] sm:w-[480px] z-[300]">
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
  return `<footer style="background:#0f172a;border-top:1px solid #1e293b;padding:48px 0 0;">
    <div class="max-w-7xl mx-auto px-4">

      <!-- Main grid: brand + 4 link columns -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-6 pb-8 border-b border-slate-800">

        <!-- Brand + testnet notice -->
        <div class="col-span-2 md:col-span-1">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white"/></svg>
            </div>
            <span class="font-bold text-white text-sm">Shukly<span class="text-amber-400"> Store</span></span>
          </div>
          <p class="text-xs text-slate-500 leading-relaxed mb-3 max-w-xs">Decentralized marketplace on Arc Network — Circle's stablecoin-native L1. For testing and demonstration only.</p>
          <!-- Testnet badge in footer -->
          <div class="flex flex-col gap-2 text-xs">
            <span class="flex items-center gap-1.5 text-yellow-400 font-semibold"><i class="fas fa-exclamation-triangle" style="font-size:10px;"></i>TESTNET — No real funds</span>
            <span class="flex items-center gap-1.5 text-green-400"><span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"></span>Arc Testnet · Chain 5042002</span>
          </div>
        </div>

        <!-- Marketplace -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Marketplace</p>
          <ul class="space-y-2">
            ${['Browse:/marketplace','Sell:/sell','My Products:/profile?tab=products','My Orders:/orders','Disputes:/disputes'].map(t=>{const[l,u]=t.split(':');return`<li><a href="${u}" class="text-xs text-slate-500 hover:text-red-400 transition-colors">${l}</a></li>`}).join('')}
          </ul>
        </div>

        <!-- Wallet + Legal -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Account</p>
          <ul class="space-y-2">
            ${['My Wallet:/wallet','Profile:/profile','How to Use:/how-to-use','About Us:/about','Terms:/terms','Privacy:/privacy','Disclaimer:/disclaimer'].map(t=>{const[l,u]=t.split(':');return`<li><a href="${u}" class="text-xs text-slate-500 hover:text-red-400 transition-colors">${l}</a></li>`}).join('')}
          </ul>
        </div>

        <!-- Arc Network -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Arc Network</p>
          <ul class="space-y-2">
            <li><a href="https://docs.arc.network" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">Docs</a></li>
            <li><a href="https://testnet.arcscan.app" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">Explorer</a></li>
            <li><a href="https://faucet.circle.com" target="_blank" class="text-xs text-slate-500 hover:text-green-400 transition-colors">Get Test USDC</a></li>
            <li><a href="https://arc.network" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">arc.network</a></li>
          </ul>
        </div>

        <!-- Contact / Community -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Community</p>
          <ul class="space-y-2">
            <li><a href="https://t.me/Julenno" target="_blank" rel="noopener" class="text-xs text-slate-500 hover:text-blue-400 transition-colors flex items-center gap-1.5"><i class="fab fa-telegram-plane" style="font-size:11px;"></i> Telegram @Julenno</a></li>
            <li><a href="https://twitter.com/juleno14" target="_blank" rel="noopener" class="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5"><i class="fab fa-x-twitter" style="font-size:11px;"></i> X @juleno14</a></li>
            <li><a href="mailto:julenosinnger@gmail.com" class="text-xs text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1.5"><i class="fas fa-envelope" style="font-size:11px;"></i> Email</a></li>
            <li><a href="https://github.com/julenosinger/redhawk-store" target="_blank" rel="noopener" class="text-xs text-slate-500 hover:text-white transition-colors flex items-center gap-1.5"><i class="fab fa-github" style="font-size:11px;"></i> GitHub Source</a></li>
          </ul>
        </div>

      </div>

      <!-- Disclaimer row — prominent testnet notice -->
      <div class="py-4 border-b border-slate-800">
        <div class="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
          <span><i class="fas fa-exclamation-triangle text-yellow-500 mr-1"></i><strong class="text-yellow-400">Testnet only:</strong> No real funds. No real assets. For testing &amp; demonstration only.</span>
          <span><i class="fas fa-info-circle text-blue-400 mr-1"></i><strong class="text-slate-400">Demo:</strong> Products may not be real. No financial risk involved.</span>
          <span><i class="fas fa-shield-alt text-green-400 mr-1"></i><strong class="text-slate-400">Non-custodial:</strong> Keys never leave your device.</span>
          <span><i class="fas fa-file-contract text-purple-400 mr-1"></i><strong class="text-slate-400">Open source:</strong> Smart contracts fully auditable on-chain.</span>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
        <span>© 2024 Shukly Store · Built on Arc Network (Circle) · Testnet Environment</span>
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

// ─── Shared category list (used by both shell catNav and homePage cards) ───────
const HOME_CATEGORIES = [
  { name:'Electronics',            icon:'fas fa-laptop',       accent:'#3b82f6', bg:'#eff6ff' },
  { name:'Gaming',                 icon:'fas fa-gamepad',       accent:'#8b5cf6', bg:'#f5f3ff' },
  { name:'Audio',                  icon:'fas fa-headphones',    accent:'#10b981', bg:'#ecfdf5' },
  { name:'Photography',            icon:'fas fa-camera',        accent:'#f59e0b', bg:'#fffbeb' },
  { name:'Pet Shop',               icon:'fas fa-paw',           accent:'#f97316', bg:'#fff7ed' },
  { name:'Baby & Kids',            icon:'fas fa-baby',          accent:'#0ea5e9', bg:'#f0f9ff' },
  { name:'Beauty & Personal Care', icon:'fas fa-spa',           accent:'#fb7185', bg:'#fff1f2' },
  { name:'Fashion & Accessories',  icon:'fas fa-tshirt',        accent:'#7c3aed', bg:'#f5f3ff' },
]

// ─── Category nav HTML (injected into shell() as secondary navbar) ────────────
function catNavHTML() {
  return `
  <!-- ══════════════════════════════════════════════════
       CATEGORY NAV — secondary bar, directly below main header
  ══════════════════════════════════════════════════ -->
  <div id="home-cat-nav" class="home-cat-nav" role="navigation" aria-label="Product categories">
    <div class="home-cat-nav-inner">
      <button class="home-cat-nav-arrow home-cat-nav-arrow--left" id="catnav-left" aria-label="Scroll left">
        <i class="fas fa-chevron-left"></i>
      </button>
      <div class="home-cat-nav-track" id="catnav-track">
        ${HOME_CATEGORIES.map((c,i) => `
          <a href="/marketplace?cat=${encodeURIComponent(c.name)}"
             class="home-cat-nav-item${i===0?' home-cat-nav-item--active':''}"
             data-cat="${encodeURIComponent(c.name)}"
             style="--cnav-accent:${c.accent};">
            <span class="home-cat-nav-icon" style="background:${c.bg};">
              <i class="${c.icon}" style="color:${c.accent};"></i>
            </span>
            <span class="home-cat-nav-label">${c.name}</span>
          </a>`).join('')}
      </div>
      <button class="home-cat-nav-arrow home-cat-nav-arrow--right" id="catnav-right" aria-label="Scroll right">
        <i class="fas fa-chevron-right"></i>
      </button>
    </div>
  </div>`
}

// ─── PAGE: HOME ────────────────────────────────────────────────────────
function homePage() {
  const categories = HOME_CATEGORIES

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

        <!-- What is Shukly Store — clear explanation ABOVE headline -->
        <div class="home-hero-explainer">
          <p class="home-hero-explainer-label">What is Shukly Store?</p>
          <p class="home-hero-explainer-text">
            Shukly Store is a <strong>decentralized marketplace</strong> built on Arc Network
            using <strong>escrow smart contracts</strong> to enable secure peer-to-peer transactions.
          </p>
        </div>

        <!-- Testnet warning — highly visible, cannot be ignored -->
        <div class="home-hero-testnet-warn" role="alert">
          <i class="fas fa-exclamation-triangle home-hero-warn-icon"></i>
          <div>
            <strong>TESTNET APPLICATION</strong> &mdash; No real funds are used.
            All transactions are for <strong>demonstration purposes only</strong>.
            No financial risk. No real assets.
          </div>
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

        <!-- CTA buttons: primary = Marketplace -->
        <div class="home-hero-ctas">
          <a href="/marketplace" class="home-btn-primary">
            <i class="fas fa-store"></i> Browse Marketplace
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

      <!-- RIGHT column — structured panel -->
      <div class="home-hero-right">
        <div class="home-glass-card">

          <!-- ── Card header ── -->
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

          <!-- ── STATS ROW — 3 equal columns, 8px gap system ── -->
          <div class="hgc-stats-row">
            <div class="hgc-stat">
              <div class="hgc-stat-icon" style="background:rgba(251,191,36,.12);">
                <i class="fas fa-coins" style="color:#fbbf24;"></i>
              </div>
              <p class="hgc-stat-label">Payment</p>
              <p class="hgc-stat-val">USDC / EURC</p>
            </div>
            <div class="hgc-stat hgc-stat--mid">
              <div class="hgc-stat-icon" style="background:rgba(96,165,250,.12);">
                <i class="fas fa-shield-alt" style="color:#60a5fa;"></i>
              </div>
              <p class="hgc-stat-label">Protection</p>
              <p class="hgc-stat-val">Escrow</p>
            </div>
            <div class="hgc-stat">
              <div class="hgc-stat-icon" style="background:rgba(74,222,128,.12);">
                <i class="fas fa-lock" style="color:#4ade80;"></i>
              </div>
              <p class="hgc-stat-label">Custody</p>
              <p class="hgc-stat-val">Non-Custodial</p>
            </div>
          </div>

          <!-- ── NETWORK ROW ── -->
          <div class="hgc-network-row">
            <div class="hgc-network-left">
              <div class="hgc-net-icon">
                <i class="fas fa-network-wired" style="color:#818cf8;font-size:13px;"></i>
              </div>
              <div>
                <p class="hgc-net-name">Arc Network L1</p>
                <p class="hgc-net-chain">Chain ID 5042002</p>
              </div>
            </div>
            <div id="hgc-net-status" class="hgc-net-pill hgc-net-pill--checking">
              <span class="hgc-net-dot"></span><span>Checking…</span>
            </div>
          </div>

          <!-- ── LIVE ACTIVITY — real orders from localStorage ── -->
          <div class="hgc-activity-section">
            <p class="hgc-activity-label">
              <span class="hgc-activity-dot"></span>Live Activity
            </p>
            <div id="hgc-activity-list" class="hgc-activity-list">
              <!-- Populated by JS -->
              <div class="hgc-activity-empty">
                <i class="fas fa-receipt" style="color:#334155;"></i>
                <span>No activity yet</span>
              </div>
            </div>
          </div>

          <!-- ── CTA ── -->
          <a href="/sell" class="home-glass-cta">
            <i class="fas fa-plus-circle"></i> Start Selling
          </a>

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

  <!-- ══════════════════════════════════════════════════
       RECENT SALES
  ══════════════════════════════════════════════════ -->
  <section class="home-section home-recent-sales-section">
    <div class="home-section-header">
      <div>
        <p class="home-section-eyebrow">ON-CHAIN</p>
        <h2 class="home-section-title">Recent Sales</h2>
      </div>
      <a href="/orders" class="home-view-all">View all <i class="fas fa-arrow-right" style="font-size:11px;"></i></a>
    </div>
    <div id="home-recent-sales-container">
      <div class="home-loading">
        <div class="loading-spinner-lg"></div>
        <p>Loading recent sales…</p>
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

  /* Network status (hero left) */
  .home-network-status{font-size:12px;color:#334155;display:flex;align-items:center;gap:8px;}
  .home-network-dot{width:8px;height:8px;border-radius:50%;background:#334155;display:inline-block;flex-shrink:0;}

  /* Glass card shared header elements */
  .home-glass-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;}
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

  /* ── Glass card restructured inner components ── */
  /* Stats row: 3 equal columns, 8px gap */
  .hgc-stats-row {
    display:grid;grid-template-columns:repeat(3,1fr);gap:8px;
    margin-bottom:8px;
  }
  .hgc-stat {
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
    border-radius:14px;padding:16px 12px;
    display:flex;flex-direction:column;align-items:flex-start;gap:8px;
  }
  .hgc-stat--mid {
    border-color:rgba(255,255,255,.1);
    background:rgba(255,255,255,.06);
  }
  .hgc-stat-icon {
    width:32px;height:32px;border-radius:9px;
    display:flex;align-items:center;justify-content:center;
    font-size:13px;flex-shrink:0;
  }
  .hgc-stat-label {
    font-size:10px;font-weight:700;color:#475569;
    text-transform:uppercase;letter-spacing:.08em;margin:0;
  }
  .hgc-stat-val {
    font-size:12px;font-weight:800;color:#f1f5f9;
    margin:0;line-height:1.2;
  }

  /* Network row */
  .hgc-network-row {
    display:flex;align-items:center;justify-content:space-between;
    background:rgba(129,140,248,.08);border:1px solid rgba(129,140,248,.15);
    border-radius:14px;padding:12px 16px;margin-bottom:8px;gap:8px;
  }
  .hgc-network-left {
    display:flex;align-items:center;gap:10px;
  }
  .hgc-net-icon {
    width:32px;height:32px;border-radius:9px;
    background:rgba(129,140,248,.15);
    display:flex;align-items:center;justify-content:center;flex-shrink:0;
  }
  .hgc-net-name {font-size:12px;font-weight:700;color:#e2e8f0;margin:0;}
  .hgc-net-chain {font-size:10px;color:#475569;margin:0;}
  .hgc-net-pill {
    display:inline-flex;align-items:center;gap:5px;
    padding:4px 10px;border-radius:999px;font-size:10px;font-weight:700;
    white-space:nowrap;flex-shrink:0;
  }
  .hgc-net-pill--checking {background:rgba(100,116,139,.15);color:#64748b;border:1px solid rgba(100,116,139,.2);}
  .hgc-net-pill--online  {background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.2);}
  .hgc-net-pill--offline {background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.2);}
  .hgc-net-dot {
    width:6px;height:6px;border-radius:50%;background:currentColor;
    display:inline-block;animation:home-pulse 2s infinite;flex-shrink:0;
  }

  /* Live activity */
  .hgc-activity-section {margin-bottom:8px;}
  .hgc-activity-label {
    display:flex;align-items:center;gap:6px;
    font-size:10px;font-weight:800;color:#475569;
    text-transform:uppercase;letter-spacing:.1em;
    margin-bottom:8px;
  }
  .hgc-activity-dot {
    width:6px;height:6px;border-radius:50%;background:#4ade80;
    display:inline-block;animation:home-pulse 1.8s infinite;flex-shrink:0;
  }
  .hgc-activity-list {
    display:flex;flex-direction:column;gap:6px;
    max-height:148px;overflow:hidden;
  }
  /* Each activity row: icon | product + addr | amount | time */
  .hgc-activity-row {
    display:grid;
    grid-template-columns:32px 1fr auto auto;
    align-items:center;gap:8px;
    background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);
    border-radius:10px;padding:8px 10px;
  }
  .hgc-activity-icon {
    width:32px;height:32px;border-radius:9px;
    background:rgba(34,197,94,.1);
    display:flex;align-items:center;justify-content:center;
    font-size:12px;color:#4ade80;flex-shrink:0;
  }
  .hgc-activity-text {min-width:0;}
  .hgc-activity-product {
    font-size:11px;font-weight:700;color:#f1f5f9;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;
  }
  .hgc-activity-addr {
    font-size:10px;color:#475569;
    font-family:'SF Mono','Fira Mono','Courier New',monospace;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;
  }
  .hgc-activity-amount {
    font-size:12px;font-weight:800;color:#4ade80;
    white-space:nowrap;text-align:right;
  }
  .hgc-activity-time {
    font-size:9px;color:#334155;
    white-space:nowrap;text-align:right;
    font-variant-numeric:tabular-nums;
  }
  .hgc-activity-empty {
    display:flex;align-items:center;gap:8px;
    padding:16px;font-size:12px;color:#334155;
    background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);
    border-radius:10px;
  }
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
  .home-glass-card {
    background:rgba(255,255,255,.04);backdrop-filter:blur(24px);
    border:1px solid rgba(255,255,255,.09);border-radius:28px;
    padding:24px;width:100%;max-width:420px;
    box-shadow:0 40px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.07);
  }

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

  /* ─── Hero explainer (What is Shukly Store?) ─── */
  .home-hero-explainer {
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.09);
    border-radius:14px;
    padding:16px 20px;
    margin-bottom:28px;
    backdrop-filter:blur(8px);
  }
  .home-hero-explainer-label {
    font-size:11px;font-weight:800;color:#f59e0b;
    text-transform:uppercase;letter-spacing:.1em;margin:0 0 6px;
  }
  .home-hero-explainer-text {
    font-size:14px;color:#94a3b8;line-height:1.65;margin:0;
  }
  .home-hero-explainer-text strong{color:#cbd5e1;font-weight:600;}

  /* ─── Testnet warning banner (hero inline) ─── */
  .home-hero-testnet-warn {
    display:flex;align-items:flex-start;gap:12px;
    background:rgba(245,158,11,.1);
    border:1.5px solid rgba(245,158,11,.35);
    border-radius:14px;padding:14px 18px;
    font-size:13px;color:#fcd34d;
    line-height:1.6;margin-bottom:32px;
    backdrop-filter:blur(4px);
  }
  .home-hero-testnet-warn strong{color:#fef08a;}
  .home-hero-warn-icon{font-size:16px;flex-shrink:0;margin-top:2px;color:#f59e0b;}

  /* ─── Secondary CTA button (less visual emphasis) ─── */
  .home-btn-secondary {
    display:inline-flex;align-items:center;gap:9px;
    background:transparent;color:#94a3b8;
    padding:15px 28px;border-radius:14px;font-weight:600;font-size:14px;
    text-decoration:none;border:1.5px solid rgba(255,255,255,.15);
    transition:all .25s;letter-spacing:.01em;
  }
  .home-btn-secondary:hover{
    background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.25);color:#e2e8f0;
  }

  /* ─── Contact section ─── */
  .home-contact-section{background:#f8fafc;border-top:1px solid #e2e8f0;padding-bottom:0;}
  .home-contact-card {
    background:#fff;border-radius:24px;border:1px solid #e2e8f0;
    box-shadow:0 4px 24px rgba(0,0,0,.05);padding:48px;
  }
  @media(max-width:640px){.home-contact-card{padding:28px 20px;}}
  .home-contact-header{
    display:flex;align-items:flex-start;gap:20px;
    margin-bottom:36px;flex-wrap:wrap;
  }
  .home-contact-icon-wrap {
    width:52px;height:52px;border-radius:16px;flex-shrink:0;
    background:linear-gradient(135deg,#dc2626,#b91c1c);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-size:20px;
    box-shadow:0 6px 16px rgba(220,38,38,.3);
  }
  .home-contact-sub{font-size:13px;color:#64748b;margin-top:4px;max-width:480px;line-height:1.6;}
  .home-contact-links {
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(200px,1fr));
    gap:14px;margin-bottom:24px;
  }
  .home-contact-link {
    display:flex;align-items:center;gap:14px;
    padding:16px 18px;border-radius:16px;
    text-decoration:none;border:1.5px solid #e2e8f0;
    background:#fafbfc;transition:all .2s;
  }
  .home-contact-link:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.09);}
  .home-contact-link-icon {
    width:40px;height:40px;border-radius:12px;
    display:flex;align-items:center;justify-content:center;
    font-size:18px;flex-shrink:0;
  }
  .home-contact-telegram .home-contact-link-icon{background:#e8f4fd;color:#0088cc;}
  .home-contact-telegram:hover{border-color:#0088cc;background:#f0f9ff;}
  .home-contact-twitter .home-contact-link-icon{background:#f0f0f0;color:#1d1d1d;}
  .home-contact-twitter:hover{border-color:#1d1d1d;background:#f9f9f9;}
  .home-contact-email .home-contact-link-icon{background:#fef2f2;color:#dc2626;}
  .home-contact-email:hover{border-color:#dc2626;background:#fff5f5;}
  .home-contact-github .home-contact-link-icon{background:#f0f0f0;color:#1e293b;}
  .home-contact-github:hover{border-color:#1e293b;background:#f9f9f9;}
  .home-contact-link-name{font-weight:700;color:#1e293b;font-size:13px;margin:0;}
  .home-contact-link-val{font-size:12px;color:#64748b;margin:2px 0 0;}
  .home-contact-ext{margin-left:auto;font-size:11px;color:#cbd5e1;flex-shrink:0;}
  .home-contact-disclaimer{
    display:flex;align-items:flex-start;gap:10px;
    background:#eff6ff;border:1px solid #bfdbfe;
    border-radius:12px;padding:14px 18px;
    font-size:13px;color:#1e40af;line-height:1.6;
  }
  .home-contact-disclaimer strong{color:#1d4ed8;}

  /* ─── Activity / social proof section ─── */
  .home-activity-section{background:#f8fafc;border-top:1px solid #e2e8f0;}
  .home-activity-card {
    background:#fff;
    border:1.5px solid #e2e8f0;
    border-radius:20px;
    padding:32px 36px;
    box-shadow:0 2px 12px rgba(0,0,0,.04);
  }
  @media(max-width:640px){.home-activity-card{padding:22px 18px;}}
  .home-activity-label {
    display:inline-flex;align-items:center;gap:8px;
    font-size:11px;font-weight:800;color:#94a3b8;
    letter-spacing:.12em;text-transform:uppercase;
    margin-bottom:24px;
  }
  .home-activity-dot {
    width:8px;height:8px;border-radius:50%;
    background:#f59e0b;animation:home-pulse 1.8s infinite;
    flex-shrink:0;
  }
  .home-activity-stats {
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(180px,1fr));
    gap:16px;margin-bottom:20px;
  }
  .home-activity-stat{
    display:flex;align-items:center;gap:12px;
    padding:14px 16px;border-radius:14px;
    border:1px solid #f0f4f8;background:#fafbfc;
  }
  .home-activity-stat-icon{
    width:36px;height:36px;border-radius:10px;
    display:flex;align-items:center;justify-content:center;
    font-size:15px;flex-shrink:0;
  }
  .home-activity-stat-title{font-weight:700;color:#1e293b;font-size:13px;margin:0;}
  .home-activity-stat-sub{font-size:11px;color:#94a3b8;margin:2px 0 0;}
  .home-activity-disclaimer {
    display:flex;align-items:center;gap:8px;
    font-size:12px;color:#92400e;
    background:#fffbeb;border:1px solid #fde68a;
    border-radius:10px;padding:10px 16px;line-height:1.5;
  }
  .home-activity-disclaimer strong{color:#92400e;}

  /* ─── Security section ─── */
  .home-security-section{background:#fff;border-top:1px solid #f1f5f9;}
  .home-security-card {
    background:#fff;border-radius:24px;border:1px solid #e2e8f0;
    box-shadow:0 4px 24px rgba(0,0,0,.05);padding:48px;
  }
  @media(max-width:640px){.home-security-card{padding:28px 20px;}}
  .home-security-header {
    display:flex;align-items:flex-start;gap:20px;
    margin-bottom:40px;flex-wrap:wrap;
  }
  .home-security-icon-wrap {
    width:52px;height:52px;border-radius:16px;flex-shrink:0;
    background:linear-gradient(135deg,#22c55e,#16a34a);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-size:20px;
    box-shadow:0 6px 16px rgba(34,197,94,.3);
  }
  .home-security-sub{font-size:13px;color:#64748b;margin-top:4px;max-width:520px;line-height:1.6;}
  .home-security-grid {
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(240px,1fr));
    gap:20px;margin-bottom:28px;
  }
  .home-security-item {
    border-radius:18px;padding:24px 22px;border:1.5px solid transparent;
  }
  .home-security-item--green{background:#f0fdf4;border-color:#bbf7d0;}
  .home-security-item--blue{background:#eff6ff;border-color:#bfdbfe;}
  .home-security-item--purple{background:#f5f3ff;border-color:#ddd6fe;}
  .home-security-item--amber{background:#fffbeb;border-color:#fde68a;}
  .home-security-item-icon {
    width:40px;height:40px;border-radius:12px;
    display:flex;align-items:center;justify-content:center;
    margin-bottom:14px;
  }
  .home-security-item-title{font-weight:800;color:#1e293b;font-size:14px;margin:0 0 8px;letter-spacing:-.01em;}
  .home-security-item-desc{font-size:13px;color:#475569;line-height:1.65;margin:0;}
  .home-security-notice {
    display:flex;align-items:flex-start;gap:10px;
    background:#fffbeb;border:1px solid #fde68a;
    border-radius:12px;padding:14px 18px;
    font-size:13px;color:#92400e;line-height:1.6;
  }
  .home-security-notice strong{color:#78350f;}

  /* ─── Recent Sales section ─── */
  .home-recent-sales-section{padding-bottom:100px;}
  .home-rs-grid {
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
    gap:20px;
  }
  @media(max-width:480px){.home-rs-grid{grid-template-columns:1fr;}}
  .home-rs-card {
    background:#fff;border-radius:20px;border:1.5px solid #f0f4f8;
    padding:20px 22px;box-shadow:0 2px 12px rgba(0,0,0,.04);
    display:flex;flex-direction:column;gap:12px;
    transition:box-shadow .2s,transform .2s;
  }
  .home-rs-card:hover{box-shadow:0 8px 28px rgba(0,0,0,.08);transform:translateY(-2px);}
  .home-rs-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
  .home-rs-product {
    font-weight:800;color:#1e293b;font-size:14px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;
  }
  .home-rs-status {
    display:inline-flex;align-items:center;gap:5px;
    background:#d1fae5;color:#065f46;
    font-size:11px;font-weight:700;
    padding:3px 10px;border-radius:999px;white-space:nowrap;
  }
  .home-rs-status-dot{width:6px;height:6px;border-radius:50%;background:#10b981;flex-shrink:0;}
  .home-rs-amount {
    font-size:1.25rem;font-weight:900;color:#1e293b;
    letter-spacing:-.025em;
  }
  .home-rs-token{font-size:13px;font-weight:600;color:#64748b;margin-left:3px;}
  .home-rs-meta {
    display:flex;flex-direction:column;gap:5px;
    border-top:1px solid #f1f5f9;padding-top:12px;
  }
  .home-rs-meta-row{display:flex;align-items:center;gap:8px;font-size:12px;color:#64748b;}
  .home-rs-meta-icon{width:22px;height:22px;border-radius:6px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:10px;color:#64748b;flex-shrink:0;}
  .home-rs-hash{
    font-family:'SF Mono','Fira Mono','Courier New',monospace;
    font-size:11px;color:#3b82f6;text-decoration:none;
  }
  .home-rs-hash:hover{text-decoration:underline;}
  .home-rs-addr{font-family:'SF Mono','Fira Mono','Courier New',monospace;font-size:11px;color:#94a3b8;}
  .home-rs-empty {
    grid-column:1/-1;
    background:#fff;border-radius:20px;border:1.5px solid #f0f4f8;
    padding:72px 24px;text-align:center;
    box-shadow:0 2px 12px rgba(0,0,0,.04);
  }
  .home-rs-empty-icon{
    width:72px;height:72px;border-radius:20px;
    background:linear-gradient(135deg,#f1f5f9,#e2e8f0);
    display:flex;align-items:center;justify-content:center;
    margin:0 auto 20px;font-size:28px;color:#94a3b8;
  }
  </style>

  <script>
  document.addEventListener('DOMContentLoaded', () => {
    /* Network status — fire-and-forget, NEVER block product loading */
    checkNetworkStatus(document.getElementById('home-network-status'));

    /* Products — 8 s timeout, always resolves (never leaves spinner forever) */
    (async () => {
      const el = document.getElementById('home-products-container');
      if (!el) return;
      let timer;
      const TIMEOUT_MS = 8000;
      const timeoutEl = () => {
        el.innerHTML =
          '<div style="text-align:center;padding:56px 24px;">'
          +'<i class="fas fa-clock" style="font-size:36px;margin-bottom:16px;display:block;color:#f59e0b;opacity:.7;"></i>'
          +'<p style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:8px;">Products are taking longer than expected</p>'
          +'<p style="font-size:13px;color:#64748b;margin-bottom:20px;">Arc Network may be slow right now. <a href="/marketplace" style="color:#dc2626;">Try the Marketplace →</a></p>'
          +'<button onclick="location.reload()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;"><i class="fas fa-redo"></i> Retry</button>'
          +'</div>';
      };
      try {
        const controller = new AbortController();
        timer = setTimeout(() => { controller.abort(); timeoutEl(); }, TIMEOUT_MS);
        const res  = await fetch('/api/products', { signal: controller.signal });
        clearTimeout(timer);
        const data = await res.json();
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
          // Lazy-load images after rendering cards
          lazyLoadHomeImages(latest);
        }
      } catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') return; // timeout already handled
        el.innerHTML =
          '<div style="text-align:center;padding:56px 24px;">'
          +'<i class="fas fa-exclamation-circle" style="font-size:36px;margin-bottom:16px;display:block;color:#ef4444;opacity:.6;"></i>'
          +'<p style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:6px;">Failed to load products</p>'
          +'<p style="font-size:13px;color:#64748b;margin-bottom:20px;">Check your connection and try again.</p>'
          +'<button onclick="location.reload()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;"><i class="fas fa-redo"></i> Retry</button>'
          +'</div>';
      }
    })();

    /* ── Recent Sales (on-chain first, localStorage fallback) ── */
    renderRecentSales();   // async — fires immediately, no await needed (self-updating)

    /* ── Glass card: live activity (on-chain first, localStorage fallback) ── */
    renderGlassActivity(); // async — fires immediately

    /* ── Glass card: network status pill ── */
    updateGlassNetStatus();

    /* ── Category nav interactions ── */
    initCatNav();
  });

  function renderHomeProductCard(p) {
    const name  = (p.title || p.name || 'Untitled').replace(/</g,'&lt;');
    const price = parseFloat(p.price || 0).toFixed(2);
    const tok   = p.token || 'USDC';
    const cat   = p.category || 'Other';
    // Image is NOT included in list response; lazy-load via /api/products/:id
    const imgEl = p.image
      ? '<img src="' + p.image + '" alt="' + name + '">'
      : '<div class="home-product-placeholder" id="img-' + p.id + '"><div class="loading-spinner" style="width:28px;height:28px;border-width:3px;"></div></div>';
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

  // Lazy-load images for home cards after initial render (single batch request)
  async function lazyLoadHomeImages(products) {
    if (!products.length) return;
    try {
      const ids = products.map(p => p.id).join(',');
      const res = await fetch('/api/products/images?ids=' + ids);
      const data = await res.json();
      const images = data.images || {};
      products.forEach(p => {
        const container = document.getElementById('img-' + p.id);
        if (!container) return;
        if (images[p.id]) {
          const img = document.createElement('img');
          img.src = images[p.id];
          img.alt = p.title || 'Product';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
          container.innerHTML = '';
          container.appendChild(img);
        } else {
          container.innerHTML = '<i class="fas fa-image"></i>';
        }
      });
    } catch {
      // silently fail — placeholders stay
    }
  }

  /* ─── Recent Sales renderer ───────────────────────────────────────────
     Priority: 1) /api/orders/on-chain  2) localStorage rh_orders (cache)
     Merges both sources, deduplicates by txHash/orderId32, shows newest 6.
     Hard 10 s master timeout so spinner never stays forever.
  ─────────────────────────────────────────────────────────────────────── */
  /* ─── renderRecentSales — on-chain first, cross-browser safe ───────────
     - Uses AbortController (not AbortSignal.timeout) for Brave/Firefox compat
     - masterDone flag prevents double DOM writes (race condition fixed)
     - Shows "No recent sales yet" empty state when no orders found
     - Hard 10s master timeout stops spinner forever
  ─────────────────────────────────────────────────────────────────────── */
  var _rrsRunning = false;
  async function renderRecentSales() {
    // Prevent concurrent calls (e.g. retry while already loading)
    if (_rrsRunning) return;
    _rrsRunning = true;

    var el = document.getElementById('home-recent-sales-container');
    if (!el) { _rrsRunning = false; return; }

    // Show loading spinner
    el.innerHTML = '<div class="home-loading"><div class="loading-spinner-lg"></div><p>Loading on-chain sales\u2026</p></div>';

    // Master timeout — set masterDone=true BEFORE writing DOM to prevent race
    var masterDone = false;
    var masterTimer = setTimeout(function() {
      if (masterDone) return;
      masterDone = true;
      _rrsRunning = false;
      el.innerHTML =
        '<div class="home-rs-grid">'
        + '<div class="home-rs-empty" style="grid-column:1/-1;text-align:center;padding:48px 24px;">'
        + '<div class="home-rs-empty-icon"><i class="fas fa-clock"></i></div>'
        + '<h3 style="font-size:1.1rem;font-weight:800;color:#1e293b;margin:0 0 8px;">Unable to load data. Please try again.</h3>'
        + '<p style="font-size:13px;color:#94a3b8;max-width:300px;margin:0 auto 20px;line-height:1.7;">'
        + 'Arc Network is responding slowly.</p>'
        + '<button onclick="renderRecentSales()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">'
        + '<i class="fas fa-redo"></i> Retry</button>'
        + '</div></div>';
    }, 10000);

    try {
      /* 1. Try on-chain first (cross-browser: AbortController not AbortSignal.timeout) */
      var orders = [];
      try {
        var _oc1 = new AbortController();
        var _t1  = setTimeout(function() { _oc1.abort(); }, 8000);
        try {
          var res = await fetch('/api/orders/on-chain?limit=20', { signal: _oc1.signal });
          clearTimeout(_t1);
          if (res.ok) {
            var data = await res.json();
            if (Array.isArray(data.orders)) orders = data.orders;
          }
        } finally { clearTimeout(_t1); }
      } catch(e) { /* network timeout — fall through to localStorage */ }

      /* 2. Merge localStorage orders (same-browser enrichment only) */
      var localOrders = [];
      try { var r = localStorage.getItem('rh_orders'); if (r) localOrders = JSON.parse(r); } catch(e) {}
      if (Array.isArray(localOrders) && localOrders.length) {
        var onChainIds = new Set(orders.map(function(o) { return (o.fundTxHash || o.txHash || '').toLowerCase(); }));
        for (var i = 0; i < localOrders.length; i++) {
          var lo = localOrders[i];
          var lid = (lo.fundTxHash || lo.txHash || '').toLowerCase();
          if (!lid || onChainIds.has(lid)) {
            var match = orders.find(function(o) { return (o.fundTxHash||o.txHash||'').toLowerCase() === lid; });
            if (match) {
              if (!match.items && lo.items) match.items = lo.items;
              if (!match.productId && lo.productId) match.productId = lo.productId;
            }
            continue;
          }
          orders.push(lo);
        }
      }

      // Sort newest first, cap at 6
      orders = orders
        .sort(function(a, b) {
          var ta = b.blockNumber ? b.blockNumber : (new Date(b.createdAt||0).getTime()/1000);
          var tb = a.blockNumber ? a.blockNumber : (new Date(a.createdAt||0).getTime()/1000);
          return ta - tb;
        })
        .slice(0, 6);

      // If master timeout already fired, stop — don't overwrite its UI
      if (masterDone) return;
      masterDone = true;
      clearTimeout(masterTimer);

      if (!orders.length) {
        el.innerHTML =
          '<div class="home-rs-grid">'
          + '<div class="home-rs-empty">'
          + '<div class="home-rs-empty-icon"><i class="fas fa-receipt"></i></div>'
          + '<h3 style="font-size:1.1rem;font-weight:800;color:#1e293b;margin:0 0 8px;">No recent sales yet</h3>'
          + '<p style="font-size:13px;color:#94a3b8;max-width:300px;margin:0 auto 24px;line-height:1.7;">'
          + 'Completed purchases will appear here once escrow transactions are confirmed on Arc Network.</p>'
          + '<a href="/marketplace" class="btn-secondary" style="font-size:13px;padding:9px 20px;display:inline-flex;">'
          + '<i class="fas fa-store"></i> Browse Marketplace'
          + '</a></div></div>';
        return;
      }

      function shortAddrRS(addr) {
        if (!addr) return '\u2014';
        var s = String(addr);
        return s.length > 10 ? s.slice(0, 6) + '\u2026' + s.slice(-4) : s;
      }
      function shortHashRS(hash) {
        if (!hash) return '\u2014';
        var s = String(hash);
        return s.length > 10 ? s.slice(0, 8) + '\u2026' + s.slice(-6) : s;
      }
      function fmtDateRS(iso) {
        if (!iso) return '';
        try {
          var d = new Date(iso);
          return d.toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        } catch(e) { return ''; }
      }

      var explorer = (window.ARC && window.ARC.explorer) || 'https://testnet.arcscan.app';
      var statusMapRS = {
        escrow_locked:'Escrow Locked', escrow_pending:'Pending',
        delivery_confirmed:'Delivery Confirmed', funds_released:'Completed',
        refunded:'Refunded', disputed:'Disputed', delivered:'Delivered', completed:'Completed'
      };

      var cards = orders.map(function(o) {
        var product   = ((o.items && o.items[0] && o.items[0].name) || o.productId || 'On-chain Escrow');
        var amount    = parseFloat(o.amount || 0).toFixed(2);
        var token     = o.token || 'USDC';
        var buyer     = shortAddrRS(o.buyerAddress);
        var seller    = shortAddrRS(o.sellerAddress);
        var txHash    = o.fundTxHash || o.txHash || '';
        var shortTx   = shortHashRS(txHash);
        var txLink    = txHash ? (explorer + '/tx/' + txHash) : '#';
        var date      = fmtDateRS(o.createdAt);
        var statusLabel = statusMapRS[o.status] || 'Escrow Locked';
        return '<div class="home-rs-card">'
          + '<div class="home-rs-card-top">'
          + '<span class="home-rs-product" title="' + product + '">' + product + '</span>'
          + '<span class="home-rs-status"><span class="home-rs-status-dot"></span>' + statusLabel + '</span>'
          + '</div>'
          + '<div><span class="home-rs-amount">' + amount + '</span><span class="home-rs-token">' + token + '</span></div>'
          + '<div class="home-rs-meta">'
          + '<div class="home-rs-meta-row"><span class="home-rs-meta-icon"><i class="fas fa-user"></i></span><span>Buyer:</span><span class="home-rs-addr">' + buyer + '</span></div>'
          + (seller ? '<div class="home-rs-meta-row"><span class="home-rs-meta-icon"><i class="fas fa-store"></i></span><span>Seller:</span><span class="home-rs-addr">' + seller + '</span></div>' : '')
          + (txHash ? '<div class="home-rs-meta-row"><span class="home-rs-meta-icon"><i class="fas fa-link"></i></span><span>Tx:</span><a href="' + txLink + '" target="_blank" rel="noopener" class="home-rs-hash">' + shortTx + '</a></div>' : '')
          + (date   ? '<div class="home-rs-meta-row"><span class="home-rs-meta-icon"><i class="fas fa-clock"></i></span><span>' + date + '</span></div>' : '')
          + '</div></div>';
      }).join('');

      el.innerHTML = '<div class="home-rs-grid">' + cards + '</div>';

    } catch(err) {
      if (masterDone) return; // timeout already handled
      masterDone = true;
      clearTimeout(masterTimer);
      console.error('[renderRecentSales]', err);
      el.innerHTML =
        '<div class="home-rs-grid">'
        + '<div class="home-rs-empty" style="grid-column:1/-1;text-align:center;padding:48px 24px;">'
        + '<div class="home-rs-empty-icon"><i class="fas fa-exclamation-triangle"></i></div>'
        + '<h3 style="font-size:1.1rem;font-weight:800;color:#1e293b;margin:0 0 8px;">Unable to load data. Please try again.</h3>'
        + '<button onclick="renderRecentSales()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">'
        + '<i class="fas fa-redo"></i> Retry</button>'
        + '</div></div>';
    } finally {
      _rrsRunning = false;
    }
  }

  /* ─── Glass card: Live Activity ───────────────────────────────────────
     Priority: 1) /api/orders/on-chain  2) localStorage rh_orders (cache)
     Renders up to 3 rows in the hero right-column card.
  ─────────────────────────────────────────────────────────────────────── */
  async function renderGlassActivity() {
    const el = document.getElementById('hgc-activity-list');
    if (!el) return;

    /* 1. Try on-chain */
    let orders = [];
    try {
      const _oc2 = new AbortController();
      const _t2  = setTimeout(() => _oc2.abort(), 8000);
      try {
        const res = await fetch('/api/orders/on-chain?limit=10', { signal: _oc2.signal });
        clearTimeout(_t2);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.orders)) orders = data.orders;
        }
      } finally { clearTimeout(_t2); }
    } catch { /* fall through */ }

    /* 2. Merge localStorage */
    let localOrders = [];
    try { const r = localStorage.getItem('rh_orders'); if (r) localOrders = JSON.parse(r); } catch {}
    if (Array.isArray(localOrders) && localOrders.length && !orders.length) {
      orders = localOrders;
    }

    orders = orders
      .sort((a,b) => {
        const ta = b.blockNumber || (new Date(b.createdAt||0).getTime()/1000);
        const tb = a.blockNumber || (new Date(a.createdAt||0).getTime()/1000);
        return ta - tb;
      })
      .slice(0,3);

    if (!orders.length) {
      el.innerHTML = '<div class="hgc-activity-empty"><i class="fas fa-receipt"></i><span>No activity yet — buy or sell to see live updates</span></div>';
      return;
    }

    function relTime(iso) {
      if (!iso) return '';
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff/60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m/60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h/24) + 'd ago';
    }
    function shortAddr(a) {
      if (!a) return '—';
      const s = String(a);
      return s.length > 10 ? s.slice(0,6)+'…'+s.slice(-4) : s;
    }

    el.innerHTML = orders.map(o => {
      const prod   = ((o.items&&o.items[0]&&o.items[0].name)||o.productId||'On-chain Escrow').replace(/</g,'&lt;');
      const amount = parseFloat(o.amount||0).toFixed(2);
      const tok    = o.token||'USDC';
      const buyer  = shortAddr(o.buyerAddress);
      const time   = relTime(o.createdAt);
      return \`
        <div class="hgc-activity-row">
          <div class="hgc-activity-icon"><i class="fas fa-check-circle"></i></div>
          <div class="hgc-activity-text">
            <p class="hgc-activity-product">\${prod}</p>
            <p class="hgc-activity-addr">\${buyer}</p>
          </div>
          <span class="hgc-activity-amount">+\${amount} <small style="font-size:9px;font-weight:600;opacity:.7;">\${tok}</small></span>
          <span class="hgc-activity-time">\${time}</span>
        </div>\`;
    }).join('');
  }

  /* ─── Glass card: Network status pill ─────────────────────────────── */
  async function updateGlassNetStatus() {
    var pill = document.getElementById('hgc-net-status');
    if (!pill) return;
    try {
      var rpc = (window.ARC && window.ARC.rpc) || 'https://rpc.arc.testnet.circle.com';
      var netCtrl = new AbortController();
      var netTimer = setTimeout(function() { netCtrl.abort(); }, 6000);
      var res = await fetch(rpc, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',method:'eth_blockNumber',params:[],id:1}),
        signal:netCtrl.signal
      });
      clearTimeout(netTimer);
      var data = await res.json();
      if (data.result) {
        pill.className = 'hgc-net-pill hgc-net-pill--online';
        pill.innerHTML = '<span class="hgc-net-dot"></span><span>Online</span>';
      } else { throw new Error('no result'); }
    } catch(e) {
      pill.className = 'hgc-net-pill hgc-net-pill--offline';
      pill.innerHTML = '<span class="hgc-net-dot"></span><span>Offline</span>';
    }
  }

  /* ─── Category Nav interactions ─────────────────────────────────────── */
  function initCatNav() {
    const track = document.getElementById('catnav-track');
    const btnL  = document.getElementById('catnav-left');
    const btnR  = document.getElementById('catnav-right');
    if (!track) return;

    /* Scroll arrows */
    const STEP = 220;
    if (btnL) btnL.addEventListener('click', () => track.scrollBy({left:-STEP, behavior:'smooth'}));
    if (btnR) btnR.addEventListener('click', () => track.scrollBy({left: STEP, behavior:'smooth'}));

    /* Active item by URL param */
    var urlCat = new URLSearchParams(location.search).get('cat');
    if (urlCat) {
      track.querySelectorAll('.home-cat-nav-item').forEach(function(a) {
        var el = a;
        el.classList.toggle('home-cat-nav-item--active',
          decodeURIComponent(el.dataset['cat']||'') === urlCat);
      });
    }

    /* Drag-to-scroll on desktop */
    var isDown = false, startX = 0, scrollL = 0;
    track.addEventListener('mousedown',  function(e) { isDown=true; startX=e.pageX-track.offsetLeft; scrollL=track.scrollLeft; track.style.cursor='grabbing'; });
    track.addEventListener('mouseleave', function() { isDown=false; track.style.cursor=''; });
    track.addEventListener('mouseup',    function() { isDown=false; track.style.cursor=''; });
    track.addEventListener('mousemove',  function(e) { if(!isDown) return; e.preventDefault(); var x=e.pageX-track.offsetLeft; track.scrollLeft=scrollL-(x-startX); });
  }
  </script>
  `, '', catNavHTML())
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

  document.addEventListener('DOMContentLoaded', async function() {
    checkNetworkStatus(document.getElementById('mp-network-status'));

    // Read ?cat= param from URL
    var urlCat = new URLSearchParams(window.location.search).get('cat') || 'All';
    activeCategory = urlCat;

    // Update sidebar checkbox
    document.querySelectorAll('.cat-filter').forEach(function(cb) {
      cb.checked = (cb.dataset.cat === activeCategory || (activeCategory === 'All' && cb.dataset.cat === 'All'));
      cb.addEventListener('change', function() {
        activeCategory = this.dataset.cat;
        document.querySelectorAll('.cat-filter').forEach(function(x) { x.checked = x.dataset.cat === activeCategory; });
        renderProducts();
      });
    });

    document.getElementById('mp-sort').addEventListener('change', function() {
      sortMode = this.value; renderProducts();
    });
    document.getElementById('mp-search-bar').addEventListener('input', function() {
      renderProducts(this.value.trim().toLowerCase());
    });

    // Re-initialize provider and listen for wallet/chain changes
    try {
      var eth = window.ethereum || window._ethProvider;
      if (eth && eth.on) {
        eth.on('accountsChanged', function() {
          console.log('[marketplace] accountsChanged → reload');
          setTimeout(function() { location.reload(); }, 400);
        });
        eth.on('chainChanged', function() {
          console.log('[marketplace] chainChanged → reload');
          setTimeout(function() { location.reload(); }, 400);
        });
      }
    } catch(e) {}

    await loadProducts();
  });

  /* ── loadProducts: robust version with timeout, spinner stop, error UI ── */
  var _mpLoading = false;
  async function loadProducts() {
    if (_mpLoading) return;
    _mpLoading = true;
    var container = document.getElementById('mp-products-container');

    // Show loading spinner
    container.innerHTML =
      '<div class="text-center py-12">'
      + '<div class="loading-spinner-lg mx-auto mb-4"></div>'
      + '<p class="text-slate-400">Fetching products from Arc Network\u2026</p>'
      + '</div>';

    // Hard 10-second timeout so spinner never hangs
    var _timedOut = false;
    var _mpTimer = setTimeout(function() {
      _timedOut = true;
      _mpLoading = false;
      container.innerHTML =
        '<div class="card p-10 text-center">'
        + '<i class="fas fa-clock text-4xl text-amber-400 mb-3 block"></i>'
        + '<p class="font-semibold text-slate-700 mb-1">Loading timed out</p>'
        + '<p class="text-slate-400 text-sm mb-4">Arc Network is responding slowly. Please try again.</p>'
        + '<button onclick="_mpLoading=false;loadProducts()" class="btn-primary mx-auto text-sm">'
        + '<i class="fas fa-redo mr-1"></i>Retry</button>'
        + '</div>';
    }, 10000);

    try {
      // Cross-browser compatible timeout (no AbortSignal.timeout dependency)
      var ctrl = new AbortController();
      var fetchTimer = setTimeout(function() { ctrl.abort(); }, 9000);
      var res;
      try {
        res = await fetch('/api/products', { signal: ctrl.signal });
      } finally {
        clearTimeout(fetchTimer);
      }
      if (_timedOut) return; // timeout already handled
      clearTimeout(_mpTimer);

      if (!res.ok) {
        throw new Error('Server error ' + res.status);
      }
      var data = await res.json();
      allProducts = Array.isArray(data.products) ? data.products : [];
      // Log for debugging (Brave vs Chrome)
      console.log('[marketplace] loaded', allProducts.length, 'products');
      renderProducts();
    } catch(err) {
      if (_timedOut) return; // already handled
      clearTimeout(_mpTimer);
      var isAbort = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
      var msg = isAbort
        ? 'Request timed out. Arc Network may be slow.'
        : (err && err.message ? err.message : 'Could not connect to marketplace.');
      console.error('[marketplace] loadProducts error:', err);
      container.innerHTML =
        '<div class="card p-10 text-center">'
        + '<i class="fas fa-exclamation-triangle text-4xl text-red-400 mb-3 block"></i>'
        + '<p class="font-semibold text-slate-700 mb-1">Failed to load products</p>'
        + '<p class="text-slate-400 text-sm mb-4">' + msg + '</p>'
        + '<button onclick="_mpLoading=false;loadProducts()" class="btn-primary mx-auto text-sm">'
        + '<i class="fas fa-redo mr-1"></i>Retry</button>'
        + '</div>';
    } finally {
      _mpLoading = false;
    }
  }

  function renderProducts(searchText) {
    var q = (searchText !== undefined ? searchText : (document.getElementById('mp-search-bar')||{}).value || '').toLowerCase();
    var list = allProducts.filter(function(p) {
      var matchCat = activeCategory === 'All' || p.category === activeCategory;
      var matchQ   = !q || (p.title||p.name||'').toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    if (sortMode === 'price_asc')  list = list.slice().sort(function(a,b) { return a.price - b.price; });
    if (sortMode === 'price_desc') list = list.slice().sort(function(a,b) { return b.price - a.price; });
    if (sortMode === 'newest')     list = list.slice().sort(function(a,b) { return new Date(b.created_at) - new Date(a.created_at); });

    var container = document.getElementById('mp-products-container');
    if (!container) return;

    if (list.length === 0) {
      var isGlobalEmpty = allProducts.length === 0;
      container.innerHTML =
        '<div class="card p-16 text-center">'
        + '<div class="empty-state">'
        + '<i class="fas fa-store"></i>'
        + '<h3 class="font-bold text-slate-700 text-xl mb-2">'
        + (isGlobalEmpty ? 'No Products Available' : 'No Products Found')
        + '</h3>'
        + '<p class="text-slate-400 text-sm mb-6 max-w-sm mx-auto">'
        + (isGlobalEmpty
            ? 'No products are currently listed. Be the first seller to earn USDC or EURC!'
            : 'Try changing the filters or search term.')
        + '</p>'
        + '<a href="/sell" class="btn-primary mx-auto text-base px-8 py-3">'
        + '<i class="fas fa-plus-circle"></i> List a Product'
        + '</a></div></div>';
    } else {
      container.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">'
        + list.map(function(p) { return renderMPCard(p); }).join('') + '</div>'
        + '<p class="text-xs text-slate-400 text-right mt-3">' + list.length + ' product' + (list.length!==1?'s':'') + ' found</p>';
      // Lazy-load images after rendering
      lazyLoadMPImages(list);
    }
  }

  function renderMPCard(p) {
    const price = parseFloat(p.price||0).toFixed(2);
    const title = (p.title || p.name || 'Untitled').replace(/</g,'&lt;');
    const desc  = (p.description||'').replace(/</g,'&lt;').slice(0,80);
    const cat   = (p.category||'Other').replace(/</g,'&lt;');
    const tok   = p.token || 'USDC';
    // Images are not included in list response; show spinner placeholder
    const imgEl = p.image
      ? '<img src="' + p.image + '" class="w-full h-48 object-cover" onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;flex&quot;">'
        + '<div class="w-full h-48 bg-slate-100 items-center justify-center text-slate-300 hidden"><i class="fas fa-image text-4xl"></i></div>'
      : '<div class="w-full h-48 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center" id="mpimg-' + p.id + '"><div class="loading-spinner" style="width:28px;height:28px;border-width:3px;"></div></div>';
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

  // Lazy-load images for marketplace cards: single batch request for all visible products
  async function lazyLoadMPImages(products) {
    if (!products.length) return;
    try {
      const ids = products.map(p => p.id).join(',');
      const res = await fetch('/api/products/images?ids=' + ids);
      const data = await res.json();
      const images = data.images || {};
      products.forEach(p => {
        const container = document.getElementById('mpimg-' + p.id);
        if (!container) return;
        if (images[p.id]) {
          container.style.padding = '0';
          container.innerHTML = '<img src="' + images[p.id] + '" class="w-full h-48 object-cover" alt="' + (p.title||'').replace(/"/g,'') + '">';
        } else {
          container.innerHTML = '<span class="text-slate-300"><i class="fas fa-image text-4xl"></i></span>';
        }
      });
    } catch {
      // silently fail — placeholders stay
    }
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
    .pd-breadcrumb{display:flex;align-items:center;gap:6px;font-size:13px;color:#94a3b8;margin-bottom:28px;flex-wrap:wrap;position:sticky;top:60px;background:#fff;z-index:95;padding:12px 0;margin-left:-1rem;margin-right:-1rem;padding-left:1rem;padding-right:1rem;transform:translateY(0);opacity:1;transition:transform .3s,opacity .3s;will-change:transform}
    .pd-breadcrumb.hidden-scroll{transform:translateY(-100%);opacity:0;pointer-events:none}
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
    
    /* Escrow state-specific button styles */
    .pd-btn-waiting{width:100%;padding:16px 24px;background:linear-gradient(135deg,#64748b,#475569);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 4px 12px rgba(100,116,139,.25);opacity:.7}
    
    .pd-btn-confirm{width:100%;padding:16px 24px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 6px 20px rgba(22,163,74,.35);transition:all .25s;position:relative;overflow:hidden}
    .pd-btn-confirm::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent);pointer-events:none}
    .pd-btn-confirm:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(22,163,74,.45)}
    .pd-btn-confirm:active{transform:translateY(0);box-shadow:0 4px 12px rgba(22,163,74,.3)}
    
    .pd-btn-completed{width:100%;padding:16px 24px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 4px 12px rgba(16,185,129,.25);opacity:.75}
    
    .pd-btn-dispute{width:100%;padding:16px 24px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 6px 20px rgba(245,158,11,.35);transition:all .25s;position:relative;overflow:hidden}
    .pd-btn-dispute::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent);pointer-events:none}
    .pd-btn-dispute:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(245,158,11,.45)}
    .pd-btn-dispute:active{transform:translateY(0);box-shadow:0 4px 12px rgba(245,158,11,.3)}
    
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

  <div class="max-w-5xl mx-auto px-4 pt-8 pb-28 lg:pb-10">

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
              </button>
              <!-- Arc Commerce badge — non-destructive, lazy-loaded -->
              <div id="arc-pd-badge" style="display:none;align-items:center;gap:6px;font-size:11px;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:6px 10px;">
                <span style="background:#1e40af;color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:700;">
                  <i class="fas fa-circle" style="font-size:6px;color:#93c5fd;margin-right:2px;"></i>Arc Commerce
                </span>
                <span>Pay with USDC · Arc Testnet</span>
                <span id="arc-pd-balance" style="margin-left:auto;font-weight:600;"></span>
              </div>`
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

  // ═══════════════════════════════════════════════════════════════════════
  //  ESCROW-AWARE BUY BUTTON — Dynamic state following escrow lifecycle
  // ═══════════════════════════════════════════════════════════════════════
  
  const ESCROW_STATES = {
    IDLE: 'idle',                      // No interaction yet
    PENDING_DEPOSIT: 'pending_deposit', // Escrow initialized, awaiting deposit
    LOCKED: 'locked',                  // Funds deposited and locked
    SHIPPED: 'shipped',                // Seller marked as shipped
    COMPLETED: 'completed',            // Delivery confirmed, funds released
    DISPUTED: 'disputed'               // Dispute opened
  };

  const BUTTON_CONFIG = {
    [ESCROW_STATES.IDLE]: {
      label: (price, token) => \`<i class="fas fa-bolt"></i> Buy Now &mdash; \${price} \${token}\`,
      action: 'initiate',
      disabled: false,
      class: 'pd-btn-buy'
    },
    [ESCROW_STATES.PENDING_DEPOSIT]: {
      label: () => '<i class="fas fa-coins"></i> Deposit to Escrow',
      action: 'deposit',
      disabled: false,
      class: 'pd-btn-buy'
    },
    [ESCROW_STATES.LOCKED]: {
      label: () => '<i class="fas fa-clock"></i> Awaiting Shipment',
      action: 'none',
      disabled: true,
      class: 'pd-btn-waiting'
    },
    [ESCROW_STATES.SHIPPED]: {
      label: () => '<i class="fas fa-check-circle"></i> Confirm Delivery',
      action: 'confirm',
      disabled: false,
      class: 'pd-btn-confirm'
    },
    [ESCROW_STATES.COMPLETED]: {
      label: () => '<i class="fas fa-check-double"></i> Completed',
      action: 'none',
      disabled: true,
      class: 'pd-btn-completed'
    },
    [ESCROW_STATES.DISPUTED]: {
      label: () => '<i class="fas fa-exclamation-triangle"></i> Resolve Dispute',
      action: 'dispute',
      disabled: false,
      class: 'pd-btn-dispute'
    }
  };

  // Get current escrow state for this product
  async function getProductEscrowState(productId) {
    try {
      // Check localStorage for existing orders first
      const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
      const wallet = getStoredWallet();
      if (!wallet) return ESCROW_STATES.IDLE;

      const myAddr = wallet.address.toLowerCase();
      const order = orders.find(o => 
        o.productId === productId && 
        o.buyerAddress && 
        o.buyerAddress.toLowerCase() === myAddr
      );

      if (!order) return ESCROW_STATES.IDLE;

      // Map order status to escrow state
      const statusMap = {
        'escrow_pending': ESCROW_STATES.PENDING_DEPOSIT,
        'escrow_locked': ESCROW_STATES.LOCKED,
        'shipped': ESCROW_STATES.SHIPPED,
        'delivery_confirmed': ESCROW_STATES.COMPLETED,
        'funds_released': ESCROW_STATES.COMPLETED,
        'completed': ESCROW_STATES.COMPLETED,
        'dispute': ESCROW_STATES.DISPUTED
      };

      return statusMap[order.status] || ESCROW_STATES.IDLE;
    } catch (e) {
      console.error('[getProductEscrowState] error:', e);
      return ESCROW_STATES.IDLE;
    }
  }

  // Update buy button based on escrow state
  async function updateBuyButton(productId, productName, price, token, image) {
    const btn = document.getElementById('btn-buy-now');
    const stickyBtn = document.querySelector('.pd-sticky-bar button');
    if (!btn) return;

    const state = await getProductEscrowState(productId);
    const config = BUTTON_CONFIG[state];
    
    if (!config) return;

    // Update button appearance
    btn.className = config.class;
    btn.innerHTML = typeof config.label === 'function' 
      ? config.label(price, token) 
      : config.label;
    btn.disabled = config.disabled;

    // Update sticky button if exists
    if (stickyBtn) {
      stickyBtn.className = config.class + ' pd-btn-buy';
      stickyBtn.innerHTML = typeof config.label === 'function'
        ? config.label(price, token)
        : config.label;
      stickyBtn.disabled = config.disabled;
    }

    // Set up action handler
    btn.onclick = null; // Clear old handler
    if (stickyBtn) stickyBtn.onclick = null;

    if (!config.disabled) {
      const handler = () => handleBuyButtonAction(config.action, productId, productName, price, token, image);
      btn.onclick = handler;
      if (stickyBtn) stickyBtn.onclick = handler;
    }

    // Auto-refresh every 10 seconds to sync with contract state
    setTimeout(() => updateBuyButton(productId, productName, price, token, image), 10000);
  }

  // Handle different button actions based on escrow state
  function handleBuyButtonAction(action, id, name, price, token, image) {
    switch (action) {
      case 'initiate':
        pdBuyNow(id, name, price, token, image);
        break;
      case 'deposit':
        // Redirect to checkout to complete deposit
        showToast('Redirecting to checkout to complete deposit…', 'info');
        window.location.href = '/checkout';
        break;
      case 'confirm':
        // Redirect to orders page to confirm delivery
        showToast('Redirecting to your orders to confirm delivery…', 'info');
        window.location.href = '/orders';
        break;
      case 'dispute':
        showToast('Redirecting to disputes…', 'info');
        window.location.href = '/disputes';
        break;
      default:
        console.log('[handleBuyButtonAction] No action for:', action);
    }
  }

  // Original buy now function (initiate purchase)
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

  // Initialize escrow-aware button on page load
  (function() {
    const productId = '${p.id}';
    const productName = '${title.replace(/'/g,"\\'")}';
    const price = ${price};
    const token = '${tok}';
    const image = '${imgUrl}';
    
    // Update button state on load
    updateBuyButton(productId, productName, price, token, image);
  })();

  // ── Arc Commerce: lazy-load USDC balance badge on product page ────────
  (function(){
    async function loadArcBadge() {
      const badge = document.getElementById('arc-pd-badge');
      if (!badge) return;

      // Wait for ArcPayments to be available (loaded via defer)
      let tries = 0;
      while (typeof window.ArcPayments === 'undefined' && tries++ < 30) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (!window.ArcPayments) return;

      const wallet = getStoredWallet();
      if (!wallet || !wallet.address) return; // no wallet — keep badge hidden

      // Show badge
      badge.style.display = 'flex';

      const balEl = document.getElementById('arc-pd-balance');
      if (balEl) balEl.textContent = '…';

      try {
        const res = await Promise.race([
          window.ArcPayments.getBalance(wallet.address, 'USDC'),
          new Promise(r => setTimeout(() => r({ ok: false }), 4000))
        ]);
        if (balEl) {
          balEl.textContent = res.ok ? parseFloat(res.balance).toFixed(2) + ' USDC' : '';
        }
      } catch (_) {
        if (balEl) balEl.textContent = '';
      }
    }
    // Run after DOM settles, non-blocking
    setTimeout(loadArcBadge, 800);
  })();

  // Breadcrumb scroll behavior — hides on scroll up, shows on scroll down
  (function(){
    const breadcrumb = document.querySelector('.pd-breadcrumb');
    if(!breadcrumb) return;

    let lastScroll = 0;
    let ticking = false;

    window.addEventListener('scroll', () => {
      if(!ticking) {
        window.requestAnimationFrame(() => {
          const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
          
          // Hide breadcrumb when scrolling up
          if(currentScroll < lastScroll && currentScroll > 100) {
            breadcrumb.classList.add('hidden-scroll');
          }
          // Show breadcrumb when scrolling down or at top
          else if(currentScroll > lastScroll || currentScroll <= 100) {
            breadcrumb.classList.remove('hidden-scroll');
          }
          
          lastScroll = currentScroll <= 0 ? 0 : currentScroll;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  })();

  // Sticky bar — appears on scroll down, hides on scroll up
  (function(){
    const bar = document.getElementById('pd-sticky-bar');
    if(!bar) return;

    let lastScroll = 0;
    let ticking = false;

    window.addEventListener('scroll', () => {
      if(!ticking) {
        window.requestAnimationFrame(() => {
          const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
          
          // Show bar when scrolling down past 200px
          if(currentScroll > 200 && currentScroll > lastScroll) {
            bar.classList.add('visible');
          }
          // Hide bar when scrolling up or at top
          else if(currentScroll < lastScroll || currentScroll < 150) {
            bar.classList.remove('visible');
          }
          
          lastScroll = currentScroll <= 0 ? 0 : currentScroll;
          ticking = false;
        });
        ticking = true;
      }
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

        <!-- ── Arc Commerce — USDC balance & payment status ── -->
        <div id="arc-payment-status" class="mt-3 p-3 rounded-lg border text-xs hidden">
          <!-- populated by initArcPaymentUI() -->
        </div>

        <!-- ── Pay without wallet ── (rendered by renderNoWalletPayOption when no wallet) -->
        <div id="co-no-wallet-section" class="hidden mt-4"></div>

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

    // ── Arc Commerce: show USDC balance panel (non-blocking) ──────────
    initArcPaymentUI(w);

    // ── Pay-without-wallet: only show section when NOT connected ─────
    if (!w) {
      renderNoWalletPayOption(total, fee, mainCur);
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
      // ── Arc Commerce: mirror step in status panel ──────────────────
      updateArcPaymentStatus('loading', text);
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
    
    // CRITICAL: Check buyer != seller BEFORE any transaction
    if (w.address.toLowerCase() === sellerAddress.toLowerCase()) {
      showToast('You cannot purchase your own product', 'error');
      console.error('[confirmOrder] Blocked: buyer === seller');
      resetBtn();
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

    // ══ PRE-VALIDATION: Check token balance ════════════════════════
    try {
      const signerAddr = await signer.getAddress();
      const balance = await erc20Contract.balanceOf(signerAddr);
      console.log('[confirmOrder] Token balance:', ethers.formatUnits(balance, 6), token);
      
      if (balance < amountWei) {
        const needed = ethers.formatUnits(amountWei, 6);
        const have = ethers.formatUnits(balance, 6);
        showToast('Insufficient balance: you have ' + have + ' ' + token + ', need ' + needed + ' ' + token + '. Get tokens at faucet.circle.com', 'error');
        console.error('[confirmOrder] Insufficient balance:', have, '<', needed);
        console.log('[confirmOrder] Get test tokens at: https://faucet.circle.com');
        resetBtn();
        return;
      }
    } catch (err) {
      console.warn('[confirmOrder] Balance check failed:', err);
      // Continue anyway - will fail at tx time if really insufficient
    }

    // ══ STEP 1/3: ERC-20 approve ════════════════════════════════════
    // TxAlert: info that approval step is starting
    if (typeof TxAlert !== 'undefined') TxAlert.info('approve-' + orderId, { title: 'Step 1/3 — Token Approval', icon: '🔓', message: 'Checking allowance…', network: window.ARC?.networkName || 'Arc Testnet', autoDismiss: false });
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
        if (typeof TxAlert !== 'undefined') TxAlert.sent('approve-' + orderId, { hash: approveTx.hash, token, amount: total, network: window.ARC?.networkName || 'Arc Testnet' });
        const approveReceipt = await approveTx.wait(1);
        if (!approveReceipt || approveReceipt.status === 0) throw new Error('Approval tx reverted on-chain');
        approveTxHash = approveTx.hash;
        showToast('Token approved! ✓ Tx: ' + approveTx.hash.slice(0, 14) + '…', 'success');
        if (typeof TxAlert !== 'undefined') TxAlert.confirmed('approve-' + orderId, { hash: approveTx.hash, token, amount: total, network: window.ARC?.networkName || 'Arc Testnet', message: 'Token spend approved ✓' });
      } else {
        showToast('Allowance sufficient ✓ — skipping approve', 'success');
      }
    } catch (err) {
      const msg = (err.code === 'ACTION_REJECTED' || err.code === 4001)
        ? 'Approval rejected by user'
        : 'Approval failed: ' + (err.shortMessage || err.reason || err.message || String(err));
      showToast(msg, 'error');
      if (typeof TxAlert !== 'undefined') TxAlert.failed('approve-' + orderId, { token, amount: total, network: window.ARC?.networkName || 'Arc Testnet', reason: msg });
      console.error('[confirmOrder] approve error:', err);
      resetBtn(); return;
    }

    // ══ STEP 2/3: createEscrow ══════════════════════════════════════
    let createTxHash = null;
    try {
      setBtn('Step 2/3 — Creating escrow slot (confirm in wallet)…');
      showToast('Step 2/3: createEscrow — confirm in wallet…', 'info');
      if (typeof TxAlert !== 'undefined') TxAlert.info('create-' + orderId, { title: 'Step 2/3 — Create Escrow Slot', icon: '🔒', message: 'Confirm in wallet…', network: window.ARC?.networkName || 'Arc Testnet', autoDismiss: false });
      console.log('[confirmOrder] createEscrow args:', orderId32, sellerAddress, tokenAddress, amountWei.toString());

      // Arc Testnet eth_estimateGas can fail silently — pass explicit gasLimit to skip estimation
      const createTx = await escrowContract.createEscrow(orderId32, sellerAddress, tokenAddress, amountWei, { gasLimit: 300000 });
      console.log('[confirmOrder] createEscrow tx:', createTx.hash);
      setBtn('Step 2/3 — Waiting for createEscrow confirmation…');
      showToast('createEscrow sent: ' + createTx.hash.slice(0, 14) + '… Waiting…', 'info');
      if (typeof TxAlert !== 'undefined') TxAlert.sent('create-' + orderId, { hash: createTx.hash, token, amount: total, network: window.ARC?.networkName || 'Arc Testnet' });

      const createReceipt = await createTx.wait(1);
      if (!createReceipt || createReceipt.status === 0) throw new Error('createEscrow tx reverted — check contract address and inputs');
      createTxHash = createTx.hash;
      showToast('Escrow slot created! ✓ Tx: ' + createTx.hash.slice(0, 14) + '…', 'success');
      if (typeof TxAlert !== 'undefined') TxAlert.confirmed('create-' + orderId, { hash: createTx.hash, token, amount: total, network: window.ARC?.networkName || 'Arc Testnet', message: 'Escrow slot created ✓' });
    } catch (err) {
      // Decode revert reason: Arc Testnet often returns no revert data
      let msg;
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
        msg = 'Transaction rejected by user';
      } else if (err.message && err.message.includes('missing revert data')) {
        // Likely: buyer == seller, escrow already exists, or invalid inputs
        const buyerAddr = (await signer.getAddress()).toLowerCase();
        if (buyerAddr === sellerAddress.toLowerCase()) {
          msg = 'Error: you cannot purchase your own product';
        } else {
          msg = 'createEscrow reverted. Possible causes: Insufficient ' + token + ' balance, Invalid addresses, Escrow already exists with this ID';
        }
      } else if (err.message && err.message.includes('execution reverted')) {
        // Generic revert - provide helpful guidance
        msg = 'Transaction reverted in contract. Check: Do you have enough ' + token + '? Is seller address correct? Not buying your own product?';
      } else {
        msg = 'createEscrow falhou: ' + (err.shortMessage || err.reason || err.message || String(err));
      }
      showToast(msg, 'error');
      if (typeof TxAlert !== 'undefined') TxAlert.failed('create-' + orderId, { token, amount: total, network: window.ARC?.networkName || 'Arc Testnet', reason: msg });
      console.error('[confirmOrder] createEscrow error:', err);
      console.error('[confirmOrder] Full error object:', JSON.stringify(err, null, 2));
      resetBtn(); return;
    }

    // ══ STEP 3/3: fundEscrow ════════════════════════════════════════
    let fundTxHash = null;
    try {
      setBtn('Step 3/3 — Locking funds in escrow (confirm in wallet)…');
      showToast('Step 3/3: fundEscrow — confirm in wallet…', 'info');
      if (typeof TxAlert !== 'undefined') TxAlert.info('fund-' + orderId, { title: 'Step 3/3 — Fund Escrow', icon: '💰', message: 'Confirm in wallet…', network: window.ARC?.networkName || 'Arc Testnet', autoDismiss: false });
      console.log('[confirmOrder] fundEscrow orderId32:', orderId32);

      // Arc Testnet eth_estimateGas can fail silently — pass explicit gasLimit
      const fundTx = await escrowContract.fundEscrow(orderId32, { gasLimit: 200000 });
      console.log('[confirmOrder] fundEscrow tx:', fundTx.hash);
      setBtn('Step 3/3 — Waiting for fundEscrow confirmation…');
      showToast('fundEscrow sent: ' + fundTx.hash.slice(0, 14) + '… Waiting…', 'info');
      if (typeof TxAlert !== 'undefined') TxAlert.pending('fund-' + orderId, { hash: fundTx.hash, token, amount: total, network: window.ARC?.networkName || 'Arc Testnet' });

      const fundReceipt = await fundTx.wait(1);
      if (!fundReceipt || fundReceipt.status === 0) throw new Error('fundEscrow tx reverted — check token allowance and escrow state');
      fundTxHash = fundTx.hash;
      showToast('Funds locked in escrow! ✓ Tx: ' + fundTx.hash.slice(0, 14) + '…', 'success');
      if (typeof TxAlert !== 'undefined') TxAlert.confirmed('fund-' + orderId, { hash: fundTx.hash, token, amount: total, network: window.ARC?.networkName || 'Arc Testnet', blockTimestamp: Date.now() / 1000, message: 'Funds locked in escrow ✓' });
    } catch (err) {
      let msg;
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
        msg = 'fundEscrow rejected by user';
      } else if (err.message && err.message.includes('missing revert data')) {
        msg = 'fundEscrow reverted by Arc network. Check if ' + token + ' approve was confirmed and sufficient balance exists.';
      } else {
        msg = 'fundEscrow falhou: ' + (err.shortMessage || err.reason || err.message || String(err));
      }
      showToast(msg, 'error');
      if (typeof TxAlert !== 'undefined') TxAlert.failed('fund-' + orderId, { token, amount: total, network: window.ARC?.networkName || 'Arc Testnet', reason: msg });
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

    // ── SellerNotify: trigger seller purchase alert (additive, non-destructive) ──
    // This notifies the SELLER that their product was purchased.
    // If the current wallet == sellerAddress → shows footer alert immediately.
    // If seller is offline → notification is stored and shown on next visit.
    if (typeof SellerNotify !== 'undefined') {
      SellerNotify.onPurchase({
        orderId:      orderId,
        productName:  cart[0]?.title || cart[0]?.name || 'Product',
        amount:       total,
        token:        token,
        txHash:       fundTxHash,
        buyerAddress: w.address,
        sellerAddress: sellerAddress,
        items:        cart,
      });
    }

    localStorage.removeItem('cart');
    try { CartStore._syncBadge([]); } catch (e) {}

    setBtn('Funds locked! Redirecting…');
    showToast('✓ Funds locked in escrow! Order ' + orderId, 'success');
    // TxAlert: final purchase confirmed summary (persists until redirect)
    if (typeof TxAlert !== 'undefined') {
      TxAlert.confirmed('purchase-' + orderId, {
        hash: fundTxHash,
        token, amount: total,
        network: window.ARC?.networkName || 'Arc Testnet',
        blockTimestamp: Date.now() / 1000,
        message: 'Purchase complete! Redirecting to order page…'
      });
    }
    setTimeout(() => { window.location.href = '/orders/' + orderId; }, 1200);
  }

  // ════════════════════════════════════════════════════════════════════
  //  ARC COMMERCE — USDC Balance Panel + Status Hook
  //  Non-destructive: only adds UI, does NOT change confirmOrder flow
  // ════════════════════════════════════════════════════════════════════

  /**
   * initArcPaymentUI — shows USDC balance and Arc Commerce badge.
   * Called once after wallet is confirmed on DOMContentLoaded.
   * Never throws — all errors are silent (panel stays hidden).
   */
  async function initArcPaymentUI(wallet) {
    const panel = document.getElementById('arc-payment-status');
    if (!panel) return;

    try {
      // Wait for arcPayments.js to load (defer may not have fired yet)
      if (typeof window.ArcPayments === 'undefined') {
        await new Promise(resolve => {
          let tries = 0;
          const id = setInterval(() => {
            tries++;
            if (window.ArcPayments || tries > 20) { clearInterval(id); resolve(); }
          }, 150);
        });
      }

      if (!window.ArcPayments) return; // script failed to load — silent

      // Show loading state
      panel.className = 'mt-3 p-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-800';
      panel.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Checking USDC balance via Arc Network…';
      panel.classList.remove('hidden');

      if (!wallet || !wallet.address) {
        panel.className = 'mt-3 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500 hidden';
        return;
      }

      // Get USDC balance (non-blocking — 5s timeout)
      const balResult = await Promise.race([
        window.ArcPayments.getBalance(wallet.address, 'USDC'),
        new Promise(r => setTimeout(() => r({ ok: false, balance: '?' }), 5000))
      ]);

      const isAvailable = window.ArcPayments.isAvailable();
      const balFormatted = balResult.ok ? parseFloat(balResult.balance).toFixed(2) : '—';

      // Get cart total for balance check
      const cart = getCart();
      const total = cart.reduce((s, i) => s + (parseFloat(i.price)||0) * ((i.quantity||i.qty)||1), 0);
      const totalWithFee = total + total * 0.015;
      const hasSufficientBalance = balResult.ok && parseFloat(balResult.balance) >= totalWithFee;

      if (isAvailable) {
        panel.className = 'mt-3 p-3 rounded-lg border border-green-200 bg-green-50 text-xs text-green-800';
        panel.innerHTML =
          '<div class="flex items-center gap-2 mb-1">'
          + '<span class="inline-flex items-center gap-1 bg-blue-700 text-white px-2 py-0.5 rounded-full text-xs font-semibold">'
          + '<i class="fas fa-circle text-blue-300" style="font-size:7px"></i> Arc Commerce</span>'
          + '<span class="font-semibold">USDC Payment Ready</span>'
          + '</div>'
          + '<div class="flex items-center justify-between">'
          + '<span>Your USDC balance: <strong>' + balFormatted + ' USDC</strong></span>'
          + (hasSufficientBalance
              ? '<span class="text-green-700 font-semibold"><i class="fas fa-check-circle mr-1"></i>Sufficient</span>'
              : '<a href="https://faucet.circle.com" target="_blank" class="text-orange-700 font-semibold underline"><i class="fas fa-exclamation-circle mr-1"></i>Get USDC</a>'
            )
          + '</div>'
          + '<p class="mt-1 text-green-700 opacity-75">Powered by Circle · Arc Testnet (Chain ID 5042002)</p>';
      } else {
        panel.className = 'mt-3 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500';
        panel.innerHTML =
          '<i class="fas fa-info-circle mr-1"></i> Arc Commerce: escrow contract not configured. '
          + 'USDC balance: <strong>' + balFormatted + ' USDC</strong>';
      }
    } catch (e) {
      // Silent fail — never disrupt checkout
      console.warn('[Arc Commerce UI]', e.message);
    }
  }

  /**
   * updateArcPaymentStatus — updates the panel during confirmOrder steps.
   * Called by the ArcPayments onStatus hook (non-destructive).
   */
  function updateArcPaymentStatus(step, message) {
    const panel = document.getElementById('arc-payment-status');
    if (!panel) return;
    panel.className = 'mt-3 p-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-800';
    panel.classList.remove('hidden');
    const icons = {
      validate:    'fas fa-check-circle',
      network:     'fas fa-wifi',
      signer:      'fas fa-key',
      approve:     'fas fa-stamp',
      createEscrow:'fas fa-lock',
      fundEscrow:  'fas fa-coins',
      complete:    'fas fa-check-double',
    };
    const icon = icons[step] || 'fas fa-circle-notch fa-spin';
    panel.innerHTML =
      '<span class="inline-flex items-center gap-1 bg-blue-700 text-white px-2 py-0.5 rounded-full text-xs font-semibold mr-2">'
      + '<i class="fas fa-circle text-blue-300" style="font-size:7px"></i> Arc Commerce</span>'
      + '<i class="' + icon + ' mr-1"></i>' + message;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PAY WITHOUT WALLET — QR Code + on-chain polling
  //  ─────────────────────────────────────────────────────────────────────
  //  • Only shown when user has NO wallet connected
  //  • Does NOT alter any existing button or flow
  //  • Generates EIP-681 URI → QR Code via qrcode.js CDN
  //  • Polls /api/payment/poll/:sid every 5s
  //  • On confirmation → saves order to localStorage → redirects
  // ══════════════════════════════════════════════════════════════════════

  let _qrSession = null;       // current active session
  let _qrPollTimer = null;     // setInterval handle
  let _qrLibReady = false;     // QRCode.js loaded flag

  // Load QRCode.js lazily (only when needed, no impact on normal flow)
  function loadQRLib(cb) {
    if (typeof QRCode !== 'undefined') { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    s.onload = () => { _qrLibReady = true; cb(); };
    s.onerror = () => cb(); // fail silently
    document.head.appendChild(s);
  }

  // Render the "Pay without wallet" section into #co-no-wallet-section
  function renderNoWalletPayOption(subtotal, fee, currency) {
    const section = document.getElementById('co-no-wallet-section');
    if (!section) return;
    section.classList.remove('hidden');
    section.innerHTML = \`
      <div style="border:2px dashed #e2e8f0;border-radius:14px;overflow:hidden;">
        <!-- Header toggle -->
        <button onclick="toggleNoWalletPanel()" id="nwp-toggle"
          style="width:100%;background:#f8fafc;border:none;cursor:pointer;padding:14px 16px;
                 display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:10px;
                        background:linear-gradient(135deg,#6366f1,#4f46e5);
                        display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-qrcode" style="color:#fff;font-size:.85rem;"></i>
            </div>
            <div style="text-align:left;">
              <p style="font-weight:700;color:#1e293b;font-size:.85rem;margin:0;">
                Pay without wallet
              </p>
              <p style="color:#64748b;font-size:.72rem;margin:0;">
                Scan QR code or copy address &amp; send manually
              </p>
            </div>
          </div>
          <i id="nwp-chevron" class="fas fa-chevron-down" style="color:#94a3b8;transition:transform .2s;"></i>
        </button>

        <!-- Collapsible body -->
        <div id="nwp-body" style="display:none;padding:16px;background:#fff;">
          <!-- Token selector (mirrors checkout radio group) -->
          <div style="margin-bottom:12px;">
            <p style="font-size:.75rem;font-weight:600;color:#64748b;margin:0 0 8px;
                      text-transform:uppercase;letter-spacing:.05em;">Payment Token</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label style="cursor:pointer;">
                <input type="radio" name="nwp-token" value="USDC" checked class="sr-only" onchange="nwpTokenChanged()"/>
                <div id="nwp-tok-usdc"
                  style="padding:10px;border:2px solid #dc2626;border-radius:10px;
                         background:#fff1f1;display:flex;align-items:center;gap:8px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#dbeafe;
                               display:flex;align-items:center;justify-content:center;">
                    <span style="font-weight:800;color:#1d4ed8;font-size:.85rem;">$</span></div>
                  <div><p style="font-weight:700;color:#1e293b;font-size:.8rem;margin:0;">USDC</p>
                       <p style="color:#94a3b8;font-size:.65rem;margin:0;">Native on Arc</p></div>
                </div>
              </label>
              <label style="cursor:pointer;">
                <input type="radio" name="nwp-token" value="EURC" class="sr-only" onchange="nwpTokenChanged()"/>
                <div id="nwp-tok-eurc"
                  style="padding:10px;border:2px solid #e2e8f0;border-radius:10px;
                         background:#fff;display:flex;align-items:center;gap:8px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#e0e7ff;
                               display:flex;align-items:center;justify-content:center;">
                    <span style="font-weight:800;color:#4338ca;font-size:.85rem;">€</span></div>
                  <div><p style="font-weight:700;color:#1e293b;font-size:.8rem;margin:0;">EURC</p>
                       <p style="color:#94a3b8;font-size:.65rem;margin:0;">Euro stablecoin</p></div>
                </div>
              </label>
            </div>
          </div>

          <!-- Sender wallet address (optional) -->
          <div style="margin-bottom:12px;">
            <label for="nwp-sender-addr"
              style="display:block;font-size:.75rem;font-weight:600;color:#64748b;
                     margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em;">
              <i class="fas fa-paper-plane" style="color:#6366f1;"></i>
              Sender Wallet Address
              <span style="font-weight:400;color:#94a3b8;text-transform:none;letter-spacing:0;
                           font-size:.7rem;"> (Optional)</span>
            </label>
            <input
              type="text"
              id="nwp-sender-addr"
              placeholder="0x..."
              oninput="nwpValidateSender(this)"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
              style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;
                     padding:9px 12px;font-size:.8rem;font-family:monospace;
                     outline:none;transition:border-color .2s;background:#fafafa;
                     color:#1e293b;"
            />
            <p id="nwp-sender-err"
              style="display:none;color:#dc2626;font-size:.7rem;margin:3px 0 0;
                     font-weight:600;">
              <i class="fas fa-times-circle"></i> Invalid wallet address
            </p>
            <p style="color:#94a3b8;font-size:.68rem;margin:4px 0 0;line-height:1.4;">
              Optional: enter the wallet that will send the payment so the system can
              identify your transaction faster.
            </p>
          </div>

          <!-- Generate button -->
          <button onclick="generateQRPayment()"
            id="nwp-gen-btn"
            style="width:100%;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;
                   border:none;padding:11px 16px;border-radius:9px;font-weight:700;
                   font-size:.85rem;cursor:pointer;display:flex;align-items:center;
                   justify-content:center;gap:8px;transition:opacity .2s;">
            <i class="fas fa-qrcode"></i> Generate Payment QR Code
          </button>

          <!-- QR + payment info area (hidden until generated) -->
          <div id="nwp-payment-area" style="display:none;margin-top:14px;">

            <!-- Amount badge -->
            <div id="nwp-amount-badge"
              style="text-align:center;background:#f0fdf4;border:1px solid #86efac;
                     border-radius:10px;padding:10px 14px;margin-bottom:12px;">
              <p style="font-size:.7rem;color:#16a34a;font-weight:600;margin:0 0 2px;
                        text-transform:uppercase;letter-spacing:.06em;">Exact amount to send</p>
              <p id="nwp-amount-text"
                style="font-size:1.5rem;font-weight:900;color:#15803d;margin:0;"></p>
            </div>

            <!-- QR Code canvas -->
            <div style="display:flex;justify-content:center;margin-bottom:12px;">
              <div id="nwp-qr-wrap"
                style="padding:12px;background:#fff;border:1px solid #e2e8f0;
                       border-radius:12px;display:inline-block;">
                <canvas id="nwp-qr-canvas"></canvas>
              </div>
            </div>

            <!-- Escrow address + copy -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                        padding:10px 12px;margin-bottom:8px;">
              <p style="font-size:.7rem;font-weight:600;color:#94a3b8;margin:0 0 4px;
                        text-transform:uppercase;letter-spacing:.05em;">
                <i class="fas fa-file-contract"></i> Escrow Contract (send here)
              </p>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <code id="nwp-escrow-addr"
                  style="font-size:.72rem;color:#1e293b;font-family:monospace;
                         flex:1;word-break:break-all;"></code>
                <button onclick="nwpCopyAddress()"
                  id="nwp-copy-btn"
                  style="background:#1e293b;color:#fff;border:none;padding:5px 12px;
                         border-radius:7px;font-size:.72rem;font-weight:600;cursor:pointer;
                         white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:5px;">
                  <i class="fas fa-copy"></i> Copy Address
                </button>
              </div>
            </div>

            <!-- Token contract address -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                        padding:8px 12px;margin-bottom:12px;">
              <p style="font-size:.7rem;font-weight:600;color:#94a3b8;margin:0 0 3px;
                        text-transform:uppercase;letter-spacing:.05em;">
                <i class="fas fa-coins"></i> Token Contract
              </p>
              <code id="nwp-token-addr"
                style="font-size:.68rem;color:#475569;font-family:monospace;word-break:break-all;"></code>
            </div>

            <!-- Instructions -->
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;
                        padding:10px 12px;margin-bottom:12px;">
              <p style="font-size:.78rem;font-weight:700;color:#92400e;margin:0 0 4px;">
                <i class="fas fa-exclamation-triangle"></i> Instructions
              </p>
              <ol style="margin:0;padding-left:16px;color:#78350f;font-size:.72rem;line-height:1.7;">
                <li>Open your wallet app (MetaMask, Trust Wallet, etc.)</li>
                <li>Switch to <strong>Arc Testnet</strong> (Chain ID: 5042002)</li>
                <li>Send <strong id="nwp-instr-amount"></strong> to the escrow address above</li>
                <li>This page will detect the payment automatically</li>
              </ol>
            </div>

            <!-- Polling status -->
            <div id="nwp-poll-status"
              style="border-radius:10px;padding:12px 14px;
                     background:#eff6ff;border:1px solid #bfdbfe;
                     display:flex;align-items:center;gap:10px;">
              <div class="loading-spinner" style="flex-shrink:0;"></div>
              <div>
                <p style="font-weight:700;color:#1e40af;font-size:.8rem;margin:0;">
                  Waiting for payment confirmation…
                </p>
                <p id="nwp-poll-sub"
                  style="color:#3b82f6;font-size:.7rem;margin:2px 0 0;">
                  Checking Arc Network every 5 seconds
                </p>
              </div>
            </div>

            <!-- Expiry timer -->
            <p id="nwp-expiry-text"
              style="text-align:center;font-size:.68rem;color:#94a3b8;margin:8px 0 0;"></p>

          </div><!-- /nwp-payment-area -->
        </div><!-- /nwp-body -->
      </div>
    \`;
    // store values for use in handlers
    window._nwpSubtotal = subtotal;
    window._nwpFee      = fee;
    window._nwpCurrency = currency;
  }

  function toggleNoWalletPanel() {
    const body    = document.getElementById('nwp-body');
    const chevron = document.getElementById('nwp-chevron');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display    = open ? 'none' : 'block';
    if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  }

  function nwpTokenChanged() {
    const usdc = document.querySelector('input[name="nwp-token"][value="USDC"]');
    const eurc = document.querySelector('input[name="nwp-token"][value="EURC"]');
    const boxU = document.getElementById('nwp-tok-usdc');
    const boxE = document.getElementById('nwp-tok-eurc');
    if (!usdc || !eurc || !boxU || !boxE) return;
    boxU.style.border    = usdc.checked ? '2px solid #dc2626' : '2px solid #e2e8f0';
    boxU.style.background= usdc.checked ? '#fff1f1' : '#fff';
    boxE.style.border    = eurc.checked ? '2px solid #dc2626' : '2px solid #e2e8f0';
    boxE.style.background= eurc.checked ? '#fff1f1' : '#fff';
    // Reset payment area so user must re-generate
    const area = document.getElementById('nwp-payment-area');
    if (area) area.style.display = 'none';
    nwpStopPolling();
    _qrSession = null;
  }

  async function generateQRPayment() {
    const btn = document.getElementById('nwp-gen-btn');
    if (btn) { btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2" style="width:14px;height:14px;border-width:2px;"></span>Generating…'; }

    nwpStopPolling();
    _qrSession = null;

    const cart = getCart();
    if (!cart.length) {
      showToast('Cart is empty', 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-qrcode"></i> Generate Payment QR Code'; }
      return;
    }

    const tokenEl = document.querySelector('input[name="nwp-token"]:checked');
    const token   = tokenEl ? tokenEl.value : 'USDC';

    // Resolve seller from first cart item
    let sellerAddress = null;
    try {
      const pid = cart[0]?.id;
      if (pid) {
        const r = await fetch('/api/products/' + pid);
        const d = await r.json();
        if (d.product?.seller_id && d.product.seller_id.startsWith('0x'))
          sellerAddress = d.product.seller_id;
      }
    } catch(e) { console.warn('[nwp] seller fetch:', e); }

    if (!sellerAddress) {
      showToast('Could not resolve seller address', 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-qrcode"></i> Generate Payment QR Code'; }
      return;
    }

    try {
      const res  = await fetch('/api/payment/qr-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart, token, sellerAddress })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'API error');
      _qrSession = data;
    } catch(err) {
      showToast('Failed to create payment session: ' + err.message, 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-qrcode"></i> Generate Payment QR Code'; }
      return;
    }

    // Populate UI
    const amountText = _qrSession.amount.toFixed(2) + ' ' + token;
    document.getElementById('nwp-amount-text').textContent  = amountText;
    document.getElementById('nwp-instr-amount').textContent = amountText;
    document.getElementById('nwp-escrow-addr').textContent  = _qrSession.escrowAddress;
    document.getElementById('nwp-token-addr').textContent   = _qrSession.tokenAddress;

    // Expiry countdown
    nwpUpdateExpiry();

    // Show payment area
    document.getElementById('nwp-payment-area').style.display = 'block';

    // Render QR
    loadQRLib(() => {
      const canvas = document.getElementById('nwp-qr-canvas');
      if (!canvas || typeof QRCode === 'undefined') return;
      try {
        QRCode.toCanvas(canvas, _qrSession.paymentUri, {
          width: 200, margin: 1,
          color: { dark: '#1e293b', light: '#ffffff' }
        }, err => { if (err) console.warn('[nwp] QR error:', err); });
      } catch(e) { console.warn('[nwp] QR generate:', e); }
    });

    if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-sync-alt"></i> Regenerate'; }

    // Start polling
    nwpStartPolling();
  }

  function nwpCopyAddress() {
    if (!_qrSession) return;
    const addr = _qrSession.escrowAddress;
    try {
      navigator.clipboard.writeText(addr).then(() => {
        const btn = document.getElementById('nwp-copy-btn');
        if (btn) { btn.innerHTML='<i class="fas fa-check"></i> Copied!'; btn.style.background='#16a34a'; }
        showToast('Escrow address copied!', 'success');
        setTimeout(() => {
          const b = document.getElementById('nwp-copy-btn');
          if (b) { b.innerHTML='<i class="fas fa-copy"></i> Copy Address'; b.style.background='#1e293b'; }
        }, 2500);
      });
    } catch(e) {
      // Fallback for non-HTTPS or browser restrictions
      const ta = document.createElement('textarea');
      ta.value = addr; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Address copied!', 'success');
    }
  }

  function nwpValidateSender(input) {
    const errEl = document.getElementById('nwp-sender-err');
    const val   = (input.value || '').trim();
    if (val === '') {
      // Empty is valid (optional field)
      input.style.borderColor = '#e2e8f0';
      if (errEl) errEl.style.display = 'none';
      return true;
    }
    const isValid = /^0x[0-9a-fA-F]{40}$/.test(val);
    input.style.borderColor = isValid ? '#16a34a' : '#dc2626';
    if (errEl) errEl.style.display = isValid ? 'none' : 'block';
    return isValid;
  }

  function nwpUpdateExpiry() {
    if (!_qrSession) return;
    const el = document.getElementById('nwp-expiry-text');
    if (!el) return;
    const left = Math.max(0, Math.floor((_qrSession.expiresAt - Date.now()) / 1000));
    const min  = Math.floor(left / 60);
    const sec  = left % 60;
    el.textContent = left > 0
      ? '⏱ Payment window: ' + min + 'm ' + (sec < 10 ? '0' : '') + sec + 's'
      : '⚠ Session expired — please regenerate';
    if (left <= 0) { nwpStopPolling(); }
  }

  function nwpStartPolling() {
    nwpStopPolling();
    let pollCount = 0;
    _qrPollTimer = setInterval(async () => {
      if (!_qrSession) { nwpStopPolling(); return; }
      if (_qrSession.expiresAt < Date.now()) {
        nwpStopPolling();
        nwpSetPollStatus('expired', 'Session expired. Please generate a new QR code.', '#fee2e2', '#fca5a5', '#dc2626');
        return;
      }
      pollCount++;
      nwpUpdateExpiry();
      try {
        // Append sender address as ?from= if user provided a valid one
        const senderInput = document.getElementById('nwp-sender-addr');
        const senderVal   = (senderInput ? senderInput.value.trim() : '');
        const senderValid = senderVal !== '' && /^0x[0-9a-fA-F]{40}$/.test(senderVal);
        const pollUrl     = '/api/payment/poll/' + _qrSession.sid
          + (senderValid ? '?from=' + senderVal.toLowerCase() : '');
        const res  = await fetch(pollUrl);
        const data = await res.json();

        if (data.status === 'confirmed') {
          nwpStopPolling();
          nwpOnPaymentConfirmed(data);
          return;
        }
        if (data.status === 'expired') {
          nwpStopPolling();
          nwpSetPollStatus('expired', 'Session expired. Please generate a new QR code.', '#fee2e2', '#fca5a5', '#dc2626');
          return;
        }
        // pending — update subtitle
        const sub = document.getElementById('nwp-poll-sub');
        if (sub) sub.textContent = 'Check #' + pollCount + ' — no payment yet. Retrying in 5s…';
      } catch(e) {
        console.warn('[nwp] poll error:', e);
      }
    }, 5000);
  }

  function nwpStopPolling() {
    if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
  }

  function nwpSetPollStatus(state, msg, bg, border, color) {
    const el = document.getElementById('nwp-poll-status');
    if (!el) return;
    const icons = { confirmed:'fas fa-check-circle', expired:'fas fa-times-circle', error:'fas fa-exclamation-circle' };
    const icon  = icons[state] || 'fas fa-circle-notch fa-spin';
    el.style.background = bg; el.style.borderColor = border;
    el.innerHTML = '<i class="' + icon + '" style="font-size:1.3rem;color:' + color + ';flex-shrink:0;"></i>'
      + '<div><p style="font-weight:700;color:' + color + ';font-size:.8rem;margin:0;">' + msg + '</p></div>';
  }

  function nwpOnPaymentConfirmed(data) {
    // Update UI to "confirmed" state
    nwpSetPollStatus('confirmed',
      'Payment detected on Arc Network!',
      '#f0fdf4', '#86efac', '#16a34a'
    );

    // Save order to localStorage (same structure as normal checkout)
    const cart = getCart();
    const tokenEl = document.querySelector('input[name="nwp-token"]:checked');
    const token   = _qrSession?.token || (tokenEl ? tokenEl.value : 'USDC');
    const orderId = _qrSession?.orderId || ('ORD-' + Date.now());

    const order = {
      id:             orderId,
      txHash:         data.txHash,
      fundTxHash:     data.txHash,
      buyerAddress:   'MANUAL_TRANSFER',
      sellerAddress:  _qrSession?.sellerAddress || '',
      escrowContract: _qrSession?.escrowAddress || '',
      amount:         _qrSession?.amount || 0,
      token:          token,
      productId:      cart[0]?.id || '',
      items:          cart,
      status:         'FUNDED',
      paymentMethod:  'qr_no_wallet',
      createdAt:      new Date().toISOString(),
      explorerUrl:    (window.ARC?.explorer || 'https://testnet.arcscan.app') + '/tx/' + data.txHash
    };

    const saved = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    saved.unshift(order);
    localStorage.setItem('rh_orders', JSON.stringify(saved));

    // Best-effort backend save
    try {
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...order,
          orderId32: null,
          buyerAddress: order.buyerAddress
        })
      }).catch(() => {});
    } catch(_) {}

    localStorage.removeItem('cart');
    try { CartStore._syncBadge([]); } catch(_) {}

    showToast('✓ Payment confirmed! Redirecting…', 'success');
    setTimeout(() => { window.location.href = '/orders/' + orderId; }, 1500);
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
  <!-- Top info banner -->
  <div id="order-info-banner" style="background:linear-gradient(90deg,#eff6ff 0%,#dbeafe 100%);border-bottom:1px solid #bfdbfe;padding:10px 0;">
    <div class="max-w-5xl mx-auto px-4 flex items-center gap-3">
      <div class="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
        <i class="fas fa-info-circle text-blue-600 text-xs"></i>
      </div>
      <p class="text-sm text-blue-800">
        <strong>Buyer protection active.</strong> Your funds are locked in the Arc Network escrow contract until delivery is confirmed. If there's an issue, open a dispute to freeze funds permanently.
      </p>
    </div>
  </div>

  <div class="max-w-5xl mx-auto px-4 py-6">
    <!-- Back + Title -->
    <div class="flex items-center gap-3 mb-5">
      <a href="/orders" class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-red-50 hover:text-red-600 flex items-center justify-center text-slate-500 transition-colors">
        <i class="fas fa-arrow-left text-sm"></i>
      </a>
      <div>
        <h1 class="text-xl font-bold text-slate-800">Order Details</h1>
        <p class="text-xs text-slate-400 font-mono">${id}</p>
      </div>
      <div id="order-role-badge" class="ml-auto"></div>
    </div>

    <!-- Horizontal stepper -->
    <div class="card p-5 mb-5">
      <div id="order-stepper" class="flex items-start justify-between gap-1 overflow-x-auto pb-1">
        <!-- Rendered by JS -->
        <div class="flex items-center gap-2 text-slate-400 text-sm"><div class="loading-spinner"></div> Loading…</div>
      </div>
    </div>

    <!-- Special banners: rendered by JS -->
    <div id="order-alert-banner" class="mb-5"></div>

    <!-- Two-column layout -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- LEFT: on-chain details -->
      <div class="lg:col-span-2 space-y-4">
        <!-- Escrow amount highlight -->
        <div id="order-escrow-highlight" class="card p-5" style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1.5px solid #86efac;"></div>

        <!-- On-chain details card -->
        <div class="card p-5">
          <h2 class="font-bold text-slate-800 mb-4 flex items-center gap-2 text-sm">
            <span class="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><i class="fas fa-link text-red-500 text-xs"></i></span>
            On-Chain Details
          </h2>
          <div id="order-onchain-details" class="space-y-2.5 text-sm"></div>
        </div>

        <!-- Shipping info card -->
        <div id="order-shipping-card" class="hidden card p-5"></div>

        <!-- Action buttons row -->
        <div id="order-actions-row" class="flex flex-wrap gap-3"></div>
      </div>

      <!-- RIGHT: sidebar cards -->
      <div class="space-y-4">
        <!-- Order Summary -->
        <div class="card p-4">
          <h3 class="font-bold text-slate-700 text-sm mb-3 flex items-center gap-2">
            <i class="fas fa-receipt text-red-500 text-xs"></i> Order Summary
          </h3>
          <div id="order-summary-sidebar" class="space-y-2 text-sm"></div>
        </div>

        <!-- Escrow Protection -->
        <div class="card p-4" style="background:#f8faff;border:1px solid #c7d2fe;">
          <h3 class="font-bold text-indigo-700 text-sm mb-3 flex items-center gap-2">
            <i class="fas fa-shield-alt text-indigo-500 text-xs"></i> Escrow Protection
          </h3>
          <ul class="text-xs text-indigo-800 space-y-2">
            <li class="flex items-start gap-2"><i class="fas fa-check-circle text-indigo-400 mt-0.5"></i><span>Funds locked on Arc Network — no one can access them prematurely</span></li>
            <li class="flex items-start gap-2"><i class="fas fa-check-circle text-indigo-400 mt-0.5"></i><span>Auto-refund if seller doesn't respond to a dispute</span></li>
            <li class="flex items-start gap-2"><i class="fas fa-check-circle text-indigo-400 mt-0.5"></i><span>Immutable transaction history on-chain</span></li>
          </ul>
        </div>

        <!-- Help & Support -->
        <div class="card p-4" style="background:#fffbeb;border:1px solid #fde68a;">
          <h3 class="font-bold text-amber-700 text-sm mb-3 flex items-center gap-2">
            <i class="fas fa-question-circle text-amber-500 text-xs"></i> Help & Support
          </h3>
          <p class="text-xs text-amber-800 mb-3">Questions about escrow or disputes? Our guide covers all scenarios.</p>
          <a href="/how-to-use" class="block text-center text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg px-3 py-2 transition-colors mb-2">
            <i class="fas fa-book mr-1"></i> How Disputes Work
          </a>
          <a href="/disputes" class="block text-center text-xs font-semibold bg-white hover:bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2 transition-colors">
            <i class="fas fa-gavel mr-1"></i> My Disputes
          </a>
        </div>

        <!-- Tips -->
        <div class="card p-4" style="background:#f0fdf4;border:1px solid #bbf7d0;">
          <h3 class="font-bold text-emerald-700 text-sm mb-2 flex items-center gap-2">
            <i class="fas fa-lightbulb text-emerald-500 text-xs"></i> Tips
          </h3>
          <ul class="text-xs text-emerald-800 space-y-1.5">
            <li><i class="fas fa-dot-circle text-emerald-400 mr-1"></i> Always verify tracking before confirming delivery</li>
            <li><i class="fas fa-dot-circle text-emerald-400 mr-1"></i> Keep evidence (photos/messages) ready in case of dispute</li>
            <li><i class="fas fa-dot-circle text-emerald-400 mr-1"></i> Disputes auto-resolve after 7 days of inactivity</li>
          </ul>
        </div>
      </div>
    </div>
  </div>

  <!-- Receipt Modal root -->
  <div id="receipt-modal-root"></div>

  <script>
  // ── Stepper data ─────────────────────────────────────────────────────
  var STEPS = [
    { key:'escrow_pending',      label:'Pending',   icon:'fa-clock',         color:'amber'  },
    { key:'escrow_locked',       label:'Locked',    icon:'fa-lock',          color:'blue'   },
    { key:'shipped',             label:'Shipped',   icon:'fa-shipping-fast', color:'violet' },
    { key:'delivery_confirmed',  label:'Confirmed', icon:'fa-check-circle',  color:'teal'   },
    { key:'funds_released',      label:'Released',  icon:'fa-coins',         color:'green'  }
  ];
  var DISPUTE_STEP = { key:'dispute', label:'Disputed', icon:'fa-gavel', color:'red' };

  var STEP_COLORS = {
    amber:  { bg:'bg-amber-500',  ring:'ring-amber-300',  text:'text-amber-600',  light:'bg-amber-50'  },
    blue:   { bg:'bg-blue-500',   ring:'ring-blue-300',   text:'text-blue-600',   light:'bg-blue-50'   },
    violet: { bg:'bg-violet-500', ring:'ring-violet-300', text:'text-violet-600', light:'bg-violet-50' },
    teal:   { bg:'bg-teal-500',   ring:'ring-teal-300',   text:'text-teal-600',   light:'bg-teal-50'   },
    green:  { bg:'bg-green-500',  ring:'ring-green-300',  text:'text-green-600',  light:'bg-green-50'  },
    red:    { bg:'bg-red-500',    ring:'ring-red-300',    text:'text-red-600',    light:'bg-red-50'    },
    slate:  { bg:'bg-slate-200',  ring:'',               text:'text-slate-400',  light:'bg-slate-50'  }
  };

  /* ── Cross-browser sync: localStorage first, on-chain fallback ──────
     Orders created in a different browser / after clearing data are
     fetched from the Arc Network indexer so the page always works.
  ─────────────────────────────────────────────────────────────────── */
  async function _orderDetailInit(){
    var orders = JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var order  = orders.find(function(o){ return o.id==='${id}'; });

    if(!order){
      // Show a subtle loading indicator while we check on-chain
      var stepper = document.getElementById('order-stepper');
      if(stepper) stepper.innerHTML = '<div class="flex items-center gap-2 text-slate-400 text-sm"><div class="loading-spinner"></div> Syncing from Arc Network…</div>';
      try {
        var _w = typeof getStoredWallet==='function' ? getStoredWallet() : null;
        if(_w){
          var _addr = encodeURIComponent(_w.address);
          var _res = await fetch('/api/orders/on-chain?buyer='+_addr+'&seller='+_addr+'&limit=100');
          if(_res.ok){
            var _data = await _res.json();
            var _chain = Array.isArray(_data.orders) ? _data.orders : [];
            order = _chain.find(function(o){
              return o.id==='${id}' || o.orderId==='${id}' ||
                (o.txHash && o.txHash.toLowerCase()==='${id}'.toLowerCase()) ||
                (o.fundTxHash && o.fundTxHash.toLowerCase()==='${id}'.toLowerCase());
            });
            if(order){
              // Persist into localStorage so subsequent loads are instant
              var _merged = orders.filter(function(x){ return x.id !== (order.id||order.orderId||''); });
              _merged.push(order);
              try { localStorage.setItem('rh_orders', JSON.stringify(_merged)); } catch(e){}
            }
          }
        }
      } catch(e){ console.warn('[orderDetail] on-chain sync failed:', e.message||e); }
    }

    if(!order){
      _renderOrderNotFound();
      return;
    }

    var wallet  = typeof getStoredWallet==='function' ? getStoredWallet() : null;
    var myAddr  = wallet ? wallet.address.toLowerCase() : '';
    var isSeller = order.sellerAddress && order.sellerAddress.toLowerCase()===myAddr;
    var isBuyer  = order.buyerAddress  && order.buyerAddress.toLowerCase()===myAddr;
    var isDisputed = order.status==='dispute';
    var explorerTxUrl = order.explorerUrl || ((window.ARC&&window.ARC.explorer||'https://testnet.arcscan.app')+'/tx/'+(order.txHash||''));
    var explorerBase  = (window.ARC&&window.ARC.explorer)||'https://testnet.arcscan.app';

    // ── Role badge ──────────────────────────────────────────────────
    var roleBadge = document.getElementById('order-role-badge');
    if(roleBadge){
      if(isSeller)      roleBadge.innerHTML='<span class="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200"><i class="fas fa-store mr-1"></i>Seller</span>';
      else if(isBuyer)  roleBadge.innerHTML='<span class="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200"><i class="fas fa-shopping-bag mr-1"></i>Buyer</span>';
    }

    // ── Stepper ─────────────────────────────────────────────────────
    _renderStepper(order.status);

    // ── Alert banner ────────────────────────────────────────────────
    _renderAlertBanner(order);

    // ── Escrow amount highlight ─────────────────────────────────────
    _renderEscrowHighlight(order);

    // ── On-chain details ────────────────────────────────────────────
    _renderOnChainDetails(order, explorerBase);

    // ── Shipping info ───────────────────────────────────────────────
    _renderShippingCard(order, isBuyer, isSeller);

    // ── Order summary sidebar ───────────────────────────────────────
    _renderOrderSummary(order);

    // ── Action buttons ──────────────────────────────────────────────
    _renderActions(order, isBuyer, isSeller, isDisputed, explorerTxUrl);
  }

  function _renderOrderNotFound(){
    var el = document.querySelector('.max-w-5xl');
    if(!el) return;
    el.innerHTML += '<div class="card p-10 text-center mt-6"><div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4"><i class="fas fa-box-open text-2xl text-slate-400"></i></div><p class="font-semibold text-slate-600 mb-4">Order not found in this browser.<br/><span class="text-xs text-slate-400 font-normal">Orders are stored in your browser. If you switched browsers or cleared data, orders won\'t appear here. Use Arc Explorer to verify on-chain.</span></p><div class="flex gap-3 justify-center"><a href="/orders" class="btn-secondary text-sm">← Back to Orders</a><a href="https://testnet.arcscan.app" target="_blank" class="btn-primary text-sm"><i class="fas fa-external-link-alt mr-1"></i> Arc Explorer</a></div></div>';
  }

  function _renderStepper(status){
    var el = document.getElementById('order-stepper');
    if(!el) return;

    var isDisputed = status==='dispute';
    var steps = isDisputed
      ? [STEPS[0],STEPS[1],STEPS[2],DISPUTE_STEP]
      : STEPS;

    var currentIdx = isDisputed
      ? steps.length-1
      : Math.max(0, STEPS.findIndex(function(s){return s.key===status;}));

    var html = '<div class="flex items-center w-full min-w-max gap-0">';
    steps.forEach(function(step, i){
      var done    = i < currentIdx;
      var active  = i === currentIdx;
      var c       = STEP_COLORS[done||active ? step.color : 'slate'];
      var cirCls  = done||active ? c.bg+' text-white ring-2 '+c.ring : 'bg-slate-100 text-slate-400';

      html += '<div class="flex flex-col items-center" style="min-width:72px;">';
      html += '<div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm '+cirCls+' transition-all">';
      html += done ? '<i class="fas fa-check text-xs"></i>' : '<i class="fas '+step.icon+' text-xs"></i>';
      html += '</div>';
      html += '<p class="text-xs font-semibold mt-1.5 text-center '+(active?c.text:'text-slate-400')+'">'+step.label+'</p>';
      if(active) html += '<div class="w-1.5 h-1.5 rounded-full '+c.bg+' mt-1"></div>';
      html += '</div>';

      if(i < steps.length-1){
        html += '<div class="flex-1 h-0.5 mb-5 '+(i<currentIdx?'bg-green-400':'bg-slate-200')+' min-w-[20px]"></div>';
      }
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function _renderAlertBanner(order){
    var el = document.getElementById('order-alert-banner');
    if(!el) return;
    var html = '';
    if(order.status==='escrow_pending'){
      html = '<div class="card p-4 flex items-start gap-3" style="background:#fffbeb;border:1.5px solid #fcd34d;">'+
        '<i class="fas fa-exclamation-triangle text-amber-500 text-lg mt-0.5 shrink-0"></i>'+
        '<div><h3 class="font-bold text-amber-800 mb-0.5">Escrow Pending</h3>'+
        '<p class="text-amber-700 text-sm">Funds have not been deposited yet. Complete checkout or deploy the escrow contract first.</p>'+
        '<a href="/deploy-escrow" class="text-xs text-amber-600 underline font-medium mt-1 inline-block">→ Deploy Escrow</a></div></div>';
    } else if(order.status==='funds_released'){
      html = '<div class="card p-5 text-center" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #6ee7b7;">'+
        '<div class="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">'+
        '<i class="fas fa-check-circle text-3xl text-emerald-500"></i></div>'+
        '<h3 class="text-lg font-bold text-emerald-800 mb-1">Order Complete!</h3>'+
        '<p class="text-emerald-700 text-sm mb-3">Funds successfully released to the seller on Arc Network.</p>'+
        (order.releaseTxHash?'<a href="'+(order.releaseTxUrl||'https://testnet.arcscan.app/tx/'+order.releaseTxHash)+'" target="_blank" class="text-xs font-mono text-emerald-600 underline block mb-3">'+order.releaseTxHash+'</a>':'')+
        '<button onclick="showReceiptModalDetail()" class="btn-primary mx-auto text-sm"><i class="fas fa-receipt mr-1"></i>View & Download Receipt</button>'+
        '</div>';
    } else if(order.status==='dispute'){
      html = '<div class="card p-4 flex items-start gap-3" style="background:#fef2f2;border:1.5px solid #fca5a5;">'+
        '<i class="fas fa-lock text-red-500 text-lg mt-0.5 shrink-0"></i>'+
        '<div><h3 class="font-bold text-red-800 mb-0.5">Dispute Open — Funds Locked</h3>'+
        '<p class="text-red-700 text-sm">Escrow funds are frozen pending dispute resolution. View the dispute for updates.</p>'+
        '<a href="/disputes" class="inline-flex items-center gap-1 mt-2 text-xs font-semibold bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors"><i class="fas fa-gavel"></i> View Dispute</a></div></div>';
    }
    el.innerHTML = html;
  }

  function _renderEscrowHighlight(order){
    var el = document.getElementById('order-escrow-highlight');
    if(!el) return;
    var isLocked = order.status!=='escrow_pending' && order.status!=='funds_released';
    var statusLabel = isLocked ? 'Funds locked in escrow' : (order.status==='funds_released'?'Released to seller':'Pending lock');
    var statusColor = isLocked ? 'text-green-700' : (order.status==='funds_released'?'text-emerald-600':'text-amber-600');
    var dotColor    = isLocked ? 'bg-green-500' : (order.status==='funds_released'?'bg-emerald-400':'bg-amber-400');
    el.innerHTML =
      '<div class="flex items-center justify-between gap-4 flex-wrap">'+
      '<div>'+
      '<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Escrow Amount</p>'+
      '<p class="text-3xl font-extrabold text-slate-800">'+(order.amount||0)+' <span class="text-lg font-bold text-slate-500">'+(order.token||'USDC')+'</span></p>'+
      '</div>'+
      '<div class="flex items-center gap-2 px-4 py-2.5 rounded-xl '+statusColor+'" style="background:rgba(255,255,255,0.7);border:1px solid rgba(0,0,0,0.06);">'+
      '<span class="w-2.5 h-2.5 rounded-full '+dotColor+' animate-pulse"></span>'+
      '<span class="text-sm font-bold">'+statusLabel+'</span>'+
      '</div></div>';
  }

  function _copyToClipboard(text, label){
    navigator.clipboard.writeText(text).then(function(){
      showToast((label||'Value')+' copied','success');
    }).catch(function(){
      var el=document.createElement('textarea');
      el.value=text; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
      showToast((label||'Value')+' copied','success');
    });
  }

  function _hashRow(label, hash, url, colorClass){
    colorClass = colorClass||'text-blue-600';
    var short = hash ? (hash.slice(0,10)+'…'+hash.slice(-6)) : '—';
    return '<div class="flex justify-between items-center gap-3 py-1.5 border-b border-slate-50">'+
      '<span class="text-slate-500 text-xs font-medium shrink-0">'+label+'</span>'+
      '<div class="flex items-center gap-1.5 min-w-0">'+
      (url&&hash?'<a href="'+url+'" target="_blank" class="font-mono text-xs '+colorClass+' hover:underline truncate max-w-[160px]" title="'+hash+'">'+short+'</a>':
       (hash?'<span class="font-mono text-xs text-slate-600 truncate max-w-[160px]" title="'+hash+'">'+short+'</span>':'<span class="text-xs text-slate-400">—</span>'))+
      (hash?'<button onclick="_copyToClipboard(\''+hash.replace(/'/g,"\\'")+"','"+label+"')" class="text-slate-300 hover:text-slate-600 text-xs p-0.5 rounded" title="Copy"><i class=\"fas fa-copy\"></i></button>':'')+
      '</div></div>';
  }

  function _renderOnChainDetails(order, explorerBase){
    var el = document.getElementById('order-onchain-details');
    if(!el) return;
    var html = '';
    html += _hashRow('Order ID', order.id, null, 'text-slate-700');
    html += _hashRow('Escrow Contract', order.escrowContract, order.escrowContract?explorerBase+'/address/'+order.escrowContract:null);
    if(order.orderId32) html += _hashRow('Order ID (bytes32)', order.orderId32, null, 'text-slate-600');
    html += _hashRow('Create Tx', order.txHash&&!order.txHash.startsWith('PENDING_')?order.txHash:null, order.txHash&&!order.txHash.startsWith('PENDING_')?explorerBase+'/tx/'+order.txHash:null);
    if(order.fundTxHash)           html += _hashRow('Fund Tx',            order.fundTxHash,           explorerBase+'/tx/'+order.fundTxHash,           'text-indigo-600');
    if(order.confirmDeliveryTx)    html += _hashRow('Confirm Delivery Tx',order.confirmDeliveryTx,    order.confirmDeliveryUrl||explorerBase+'/tx/'+order.confirmDeliveryTx,'text-teal-600');
    if(order.releaseTxHash)        html += _hashRow('Release Tx',         order.releaseTxHash,        order.releaseTxUrl||explorerBase+'/tx/'+order.releaseTxHash,         'text-emerald-600');
    html += '<div class="flex justify-between items-center gap-3 py-1.5 border-b border-slate-50"><span class="text-slate-500 text-xs font-medium">Buyer</span><div class="flex items-center gap-1.5"><span class="font-mono text-xs text-slate-600" title="'+(order.buyerAddress||'')+'">'+((order.buyerAddress||'—').slice(0,10)+'…'+(order.buyerAddress||'—').slice(-6))+'</span>'+(order.buyerAddress?'<button onclick="_copyToClipboard(\''+order.buyerAddress+'\',\'Buyer address\')" class="text-slate-300 hover:text-slate-600 text-xs p-0.5 rounded"><i class="fas fa-copy"></i></button>':'')+'</div></div>';
    html += '<div class="flex justify-between items-center gap-3 py-1.5 border-b border-slate-50"><span class="text-slate-500 text-xs font-medium">Seller</span><div class="flex items-center gap-1.5"><span class="font-mono text-xs text-slate-600" title="'+(order.sellerAddress||'')+'">'+((order.sellerAddress||'—').slice(0,10)+'…'+(order.sellerAddress||'—').slice(-6))+'</span>'+(order.sellerAddress?'<button onclick="_copyToClipboard(\''+order.sellerAddress+'\',\'Seller address\')" class="text-slate-300 hover:text-slate-600 text-xs p-0.5 rounded"><i class="fas fa-copy"></i></button>':'')+'</div></div>';
    html += '<div class="flex justify-between py-1.5 border-b border-slate-50"><span class="text-slate-500 text-xs font-medium">Network</span><span class="text-xs font-semibold text-slate-700">Arc Testnet (Chain 5042002)</span></div>';
    html += '<div class="flex justify-between py-1.5"><span class="text-slate-500 text-xs font-medium">Created</span><span class="text-xs text-slate-600">'+new Date(order.createdAt).toLocaleString()+'</span></div>';
    el.innerHTML = html;
  }

  function _renderShippingCard(order, isBuyer, isSeller){
    var card = document.getElementById('order-shipping-card');
    if(!card) return;
    if(!order.shippingInfo){ card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    var si = order.shippingInfo;
    if(isBuyer){
      card.style.background='#f0f9ff'; card.style.border='1px solid #bae6fd';
      card.innerHTML='<h2 class="font-bold text-blue-800 mb-3 flex items-center gap-2 text-sm"><i class="fas fa-shipping-fast text-blue-500"></i> Shipping Information</h2>'+
        '<div class="space-y-2 text-sm">'+
        '<div class="flex justify-between"><span class="text-blue-700 font-medium text-xs">Carrier</span><span class="font-semibold text-slate-800 text-xs">'+si.carrier+'</span></div>'+
        '<div class="flex justify-between"><span class="text-blue-700 font-medium text-xs">Tracking #</span><span class="font-mono text-xs text-slate-800">'+si.trackingNumber+'</span></div>'+
        (si.trackingLink?'<div class="flex justify-between"><span class="text-blue-700 font-medium text-xs">Track Link</span><a href="'+si.trackingLink+'" target="_blank" class="text-blue-600 hover:underline text-xs break-all">'+si.trackingLink+'</a></div>':'')+
        (si.notes?'<div class="flex justify-between"><span class="text-blue-700 font-medium text-xs">Notes</span><span class="text-slate-600 italic text-xs">'+si.notes+'</span></div>':'')+
        '<div class="flex justify-between"><span class="text-blue-700 font-medium text-xs">Sent at</span><span class="text-xs text-slate-500">'+new Date(si.sentAt).toLocaleString()+'</span></div>'+
        '</div>';
    } else if(isSeller){
      card.style.background='#fffbeb'; card.style.border='1px solid #fde68a';
      card.innerHTML='<h2 class="font-bold text-amber-800 mb-3 flex items-center gap-2 text-sm"><i class="fas fa-shipping-fast text-amber-500"></i> Shipping Info Sent to Buyer</h2>'+
        '<div class="space-y-2 text-sm">'+
        '<div class="flex justify-between"><span class="text-amber-700 font-medium text-xs">Carrier</span><span class="font-semibold text-slate-800 text-xs">'+si.carrier+'</span></div>'+
        '<div class="flex justify-between"><span class="text-amber-700 font-medium text-xs">Tracking #</span><span class="font-mono text-xs text-slate-800">'+si.trackingNumber+'</span></div>'+
        (si.trackingLink?'<div><a href="'+si.trackingLink+'" target="_blank" class="text-blue-600 hover:underline text-xs">'+si.trackingLink+'</a></div>':'')+
        '</div>';
    }
  }

  function _renderOrderSummary(order){
    var el = document.getElementById('order-summary-sidebar');
    if(!el) return;
    var statusLabels={
      'escrow_pending':'Pending', 'escrow_locked':'Locked',
      'shipped':'Shipped', 'delivery_confirmed':'Confirmed',
      'funds_released':'Released', 'dispute':'Disputed'
    };
    var statusColors={
      'escrow_pending':'text-amber-600 bg-amber-50','escrow_locked':'text-blue-600 bg-blue-50',
      'shipped':'text-violet-600 bg-violet-50','delivery_confirmed':'text-teal-600 bg-teal-50',
      'funds_released':'text-green-600 bg-green-50','dispute':'text-red-600 bg-red-50'
    };
    var sc = statusColors[order.status]||'text-slate-600 bg-slate-50';
    el.innerHTML =
      '<div class="flex justify-between items-center"><span class="text-slate-500 text-xs">Status</span><span class="text-xs font-bold px-2 py-0.5 rounded-full '+sc+'">'+(statusLabels[order.status]||order.status)+'</span></div>'+
      '<div class="flex justify-between"><span class="text-slate-500 text-xs">Amount</span><span class="text-sm font-extrabold text-slate-800">'+(order.amount||0)+' '+(order.token||'USDC')+'</span></div>'+
      '<div class="flex justify-between"><span class="text-slate-500 text-xs">Order ID</span><span class="font-mono text-xs text-slate-600 truncate max-w-[120px]">'+(order.id)+'</span></div>'+
      '<div class="flex justify-between"><span class="text-slate-500 text-xs">Created</span><span class="text-xs text-slate-600">'+new Date(order.createdAt).toLocaleDateString()+'</span></div>'+
      (order.productName?'<div class="flex justify-between"><span class="text-slate-500 text-xs">Product</span><span class="text-xs text-slate-700 truncate max-w-[130px]">'+order.productName+'</span></div>':'');
  }

  function _renderActions(order, isBuyer, isSeller, isDisputed, explorerTxUrl){
    var el = document.getElementById('order-actions-row');
    if(!el) return;
    var html = '';

    if(isSeller){
      if(order.status==='escrow_pending')
        html+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-clock"></i> Awaiting buyer to lock funds</span>';
      if(order.status==='escrow_locked')
        html+='<button data-oid="'+order.id+'" data-status="shipped" class="update-status-btn btn-primary text-sm"><i class="fas fa-shipping-fast mr-1"></i> Mark as Shipped</button>';
      if(order.status==='shipped')
        html+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm font-semibold"><i class="fas fa-clock"></i> Waiting for buyer confirmation</span>';
      if(order.status==='delivery_confirmed'){
        if(order.orderId32)
          html+='<button data-oid="'+order.id+'" data-status="funds_released" class="update-status-btn text-sm font-semibold px-5 py-2.5 rounded-lg text-white shadow-sm" style="background:linear-gradient(135deg,#16a34a,#15803d)"><i class="fas fa-coins mr-1"></i> Release Funds</button>';
        else
          html+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-exclamation-triangle"></i> No on-chain escrow ID</span>';
      }
      if(order.status==='funds_released')
        html+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Funds released to you</span>';
    }

    if(isBuyer){
      if(order.status==='escrow_locked')
        html+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-semibold"><i class="fas fa-lock"></i> Funds locked — awaiting shipment</span>';
      if(order.status==='shipped')
        html+='<button data-oid="'+order.id+'" data-status="delivery_confirmed" class="update-status-btn btn-primary text-sm"><i class="fas fa-check-circle mr-1"></i> Confirm Delivery</button>';
      if(order.status==='delivery_confirmed')
        html+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Delivery confirmed — waiting for seller to release</span>';
      if(order.status==='funds_released')
        html+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Order complete</span>';
    }

    // Dispute button (primary red)
    if(!isDisputed && (isBuyer||isSeller))
      html+='<button data-oid="'+order.id+'" class="open-dispute-btn btn-secondary text-sm"><i class="fas fa-gavel mr-1"></i> Open Dispute</button>';

    // Receipt + Explorer (secondary)
    html+='<button onclick="showReceiptModalDetail()" class="btn-secondary text-sm"><i class="fas fa-receipt mr-1"></i> View Receipt</button>';
    html+='<a href="'+explorerTxUrl+'" target="_blank" class="btn-secondary text-sm"><i class="fas fa-external-link-alt mr-1"></i> Arc Explorer</a>';

    el.innerHTML = html;

    // Attach listeners
    el.querySelectorAll('.update-status-btn').forEach(function(b){
      b.addEventListener('click',function(){ updateOrderStatus(this.dataset.oid, this.dataset.status); });
    });
    el.querySelectorAll('.open-dispute-btn').forEach(function(b){
      b.addEventListener('click',function(){ openDisputeForm(this.dataset.oid); });
    });
  }

  async function updateOrderStatus(id,s){
    if(s==='shipped'){
      showShippingFormDetail(id);
      return;
    }

    if(s==='delivery_confirmed'){
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      const idx=orders.findIndex(o=>o.id===id);
      if(idx<0) return;
      const order=orders[idx];
      const btn=event && event.target;
      const origLabel='<i class="fas fa-check-circle mr-1"></i> Confirm Delivery';
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Initialising…'; }
      const _w0 = getStoredWallet();
      if(!_w0){ showToast('Connect wallet to confirm delivery','error'); if(btn){ btn.disabled=false; btn.innerHTML=origLabel; } return; }
      const _isBuyer0 = order.buyerAddress && order.buyerAddress.toLowerCase() === _w0.address.toLowerCase();
      if(!_isBuyer0){ showToast('Only the buyer can confirm delivery','error'); if(btn){ btn.disabled=false; btn.innerHTML=origLabel; } return; }
      if(!order.orderId32){ showToast('No on-chain order ID found.','error'); if(btn){ btn.disabled=false; btn.innerHTML=origLabel; } return; }
      try {
        const w=_w0;
        let provider, signer;
        if(w.type==='metamask' && window.ethereum){
          provider = new ethers.BrowserProvider(window.ethereum);
          const net = await provider.getNetwork();
          if(net.chainId !== BigInt(window.ARC.chainId)){ showToast('Please switch MetaMask to Arc Testnet','warning'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }
          signer = await provider.getSigner();
        } else if((w.type==='internal'||w.type==='imported') && w.privateKey && !w.privateKey.startsWith('[')){
          provider = new ethers.JsonRpcProvider(window.ARC.rpc);
          signer   = new ethers.Wallet(w.privateKey, provider);
        } else { showToast('Private key unavailable. Re-import wallet.','error'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }
        const escrowAddress = getEscrowAddress();
        if(!escrowAddress || escrowAddress==='0x0000000000000000000000000000000000000000'){ showToast('Escrow contract not configured','error'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }
        const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Confirming delivery…';
        showToast('Sending confirmDelivery on-chain…','info');
        const tx = await escrowContract.confirmDelivery(order.orderId32, { gasLimit: 150000 });
        showToast('Tx sent: '+tx.hash.slice(0,14)+'… Waiting…','info');
        const receipt = await tx.wait(1);
        if(!receipt || receipt.status===0) throw new Error('confirmDelivery reverted');
        showToast('Delivery confirmed on-chain!','success');
        orders[idx].status            = 'delivery_confirmed';
        orders[idx].confirmDeliveryTx = tx.hash;
        orders[idx].confirmDeliveryUrl= window.ARC.explorer+'/tx/'+tx.hash;
        orders[idx].updatedAt         = new Date().toISOString();
        localStorage.setItem('rh_orders', JSON.stringify(orders));
        setTimeout(()=>location.reload(), 800);
      } catch(err){
        const msg = err.code==='ACTION_REJECTED'||err.code===4001?'Confirm delivery rejected':'confirmDelivery error: '+(err.shortMessage||err.message||'');
        showToast(msg,'error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
      }
      return;
    }

    if(s==='funds_released'){
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      const idx=orders.findIndex(o=>o.id===id);
      if(idx<0) return;
      const order=orders[idx];
      const btn=event && event.target;
      const origLabel='<i class="fas fa-coins mr-1"></i> Release Funds';
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Initialising…'; }
      const _w = getStoredWallet();
      if(!_w){ showToast('Connect wallet to release funds','error'); if(btn){ btn.disabled=false; btn.innerHTML=origLabel; } return; }
      const _isSeller = order.sellerAddress && order.sellerAddress.toLowerCase() === _w.address.toLowerCase();
      if(!_isSeller){ showToast('Only the seller can release funds','error'); if(btn){ btn.disabled=false; btn.innerHTML=origLabel; } return; }
      if(order.status !== 'delivery_confirmed'){ showToast('Buyer has not confirmed delivery yet','error'); if(btn){ btn.disabled=false; btn.innerHTML=origLabel; } return; }
      if(!order.orderId32){ showToast('No on-chain escrow ID — nothing to release.','error'); if(btn){ btn.disabled=false; btn.innerHTML=origLabel; } return; }
      try {
        const w=getStoredWallet();
        let provider, signer;
        if(w.type==='metamask' && window.ethereum){
          provider = new ethers.BrowserProvider(window.ethereum);
          const net = await provider.getNetwork();
          if(net.chainId !== BigInt(window.ARC.chainId)){ showToast('Please switch MetaMask to Arc Testnet','warning'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }
          signer = await provider.getSigner();
        } else if((w.type==='internal'||w.type==='imported') && w.privateKey && !w.privateKey.startsWith('[')){
          provider = new ethers.JsonRpcProvider(window.ARC.rpc);
          signer   = new ethers.Wallet(w.privateKey, provider);
        } else { showToast('Private key unavailable.','error'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }
        const escrowAddress = getEscrowAddress();
        if(!escrowAddress || escrowAddress==='0x0000000000000000000000000000000000000000'){ showToast('Escrow contract not configured.','error'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }
        const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Sending to escrow…';
        showToast('Broadcasting releaseFunds to ShuklyEscrow…','info');
        const txResponse = await escrowContract.releaseFunds(order.orderId32, { gasLimit: 200000 });
        showToast('Tx sent! Waiting for confirmation… '+txResponse.hash.slice(0,14)+'…','info');
        const receipt = await txResponse.wait(1);
        if(!receipt || receipt.status === 0) throw new Error('releaseFunds reverted on-chain.');
        const releaseTxHash = txResponse.hash;
        showToast('Funds released! Tx: '+releaseTxHash.slice(0,14)+'…','success');
        orders[idx].status        = 'funds_released';
        orders[idx].releaseTxHash = releaseTxHash;
        orders[idx].releaseTxUrl  = window.ARC.explorer+'/tx/'+releaseTxHash;
        orders[idx].updatedAt     = new Date().toISOString();
        localStorage.setItem('rh_orders', JSON.stringify(orders));
        setTimeout(()=>location.reload(), 800);
      } catch(err){
        const msg = err.code==='ACTION_REJECTED'||err.code===4001?'Release rejected':'Release error: '+(err.shortMessage||err.message||'');
        showToast(msg,'error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
      }
      return;
    }

    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const i=orders.findIndex(o=>o.id===id);
    if(i>=0){
      orders[i].status=s; orders[i].updatedAt=new Date().toISOString();
      localStorage.setItem('rh_orders',JSON.stringify(orders));
      showToast('Status updated','success');
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
      '<div style="display:flex;align-items:center;gap:10px;"><div style="width:36px;height:36px;border-radius:8px;background:#fef2f2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-shipping-fast" style="color:#ef4444;"></i></div>'+
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
      '<button id="ship-confirm-d" style="padding:8px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;font-weight:600;cursor:pointer;"><i class="fas fa-paper-plane" style="margin-right:6px;"></i>Send Shipping Info</button>'+
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
        orders[i].status='shipped'; orders[i].shippedAt=new Date().toISOString();
        orders[i].updatedAt=new Date().toISOString();
        orders[i].shippingInfo={trackingNumber:tracking,carrier:carrier,trackingLink:link||null,notes:notes||null,sentAt:new Date().toISOString()};
        localStorage.setItem('rh_orders',JSON.stringify(orders));
        closeD(); showToast('Shipping info sent!','success');
        setTimeout(function(){location.reload();},800);
      }
    };
  }

  function openDisputeForm(id){
    var ordersRaw=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var order=ordersRaw.find(function(o){return o.id===id;});
    if(!order){showToast('Order not found','error');return;}
    var wallet=typeof getStoredWallet==='function'?getStoredWallet():null;
    var myAddr=wallet?wallet.address.toLowerCase():'';
    var isBuyerOrSeller=(order.buyerAddress&&order.buyerAddress.toLowerCase()===myAddr)||(order.sellerAddress&&order.sellerAddress.toLowerCase()===myAddr);
    if(!isBuyerOrSeller){showToast('Only the buyer or seller can open a dispute','error');return;}
    var root=document.getElementById('receipt-modal-root');
    if(!root)return;
    root.innerHTML=
      '<div id="dispute-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">'+
      '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:560px;max-height:92vh;overflow-y:auto;">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 20px 14px;border-bottom:1px solid #f1f5f9;">'+
      '<div style="display:flex;align-items:center;gap:10px;">'+
      '<div style="width:38px;height:38px;border-radius:10px;background:#fee2e2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-gavel" style="color:#dc2626;font-size:16px;"></i></div>'+
      '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Open Dispute</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:0;">Order '+id+' &bull; Funds will remain locked</p></div></div>'+
      '<button id="disp-close" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>'+
      '</div>'+
      '<div style="margin:16px 20px 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;display:flex;gap:10px;align-items:flex-start;">'+
      '<i class="fas fa-lock" style="color:#dc2626;margin-top:2px;flex-shrink:0;"></i>'+
      '<div style="font-size:13px;color:#7f1d1d;"><strong>Funds will remain locked.</strong> While a dispute is open, USDC/EURC stays in the Arc Network escrow contract.</div>'+
      '</div>'+
      '<div style="padding:20px;display:flex;flex-direction:column;gap:16px;">'+
      '<div><label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;">Description <span style="color:#dc2626;">*</span></label>'+
      '<textarea id="disp-desc" rows="4" placeholder="Describe your issue in detail. Include dates, what was expected, and what actually happened..." style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea></div>'+
      '<div><label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;">Evidence Files <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>'+
      '<div id="disp-dropzone" style="border:2px dashed #e2e8f0;border-radius:10px;padding:24px;text-align:center;cursor:pointer;">'+
      '<i class="fas fa-cloud-upload-alt" style="font-size:28px;color:#94a3b8;display:block;margin-bottom:8px;"></i>'+
      '<p style="font-size:13px;color:#64748b;margin:0;">Click to choose files or drag &amp; drop</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:4px 0 0;">PNG, JPG, PDF &bull; Up to 5 files &bull; 10 MB each</p></div>'+
      '<input id="disp-file-input" type="file" multiple accept="image/png,image/jpeg,application/pdf" style="display:none;">'+
      '<ul id="disp-file-list" style="margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;"></ul></div>'+
      '</div>'+
      '<div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;gap:8px;justify-content:flex-end;">'+
      '<button id="disp-cancel" style="padding:9px 18px;border:1.5px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'+
      '<button id="disp-submit" style="padding:9px 22px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px;"><i class="fas fa-gavel"></i> Submit Dispute</button>'+
      '</div></div></div>';
    var selectedFiles=[];
    var dz=document.getElementById('disp-dropzone');
    dz.addEventListener('click',function(){ document.getElementById('disp-file-input').click(); });
    dz.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='#dc2626';this.style.background='#fff5f5';});
    dz.addEventListener('dragleave',function(){this.style.borderColor='#e2e8f0';this.style.background='';});
    dz.addEventListener('drop',function(e){ e.preventDefault();this.style.borderColor='#e2e8f0';this.style.background=''; addFiles(Array.from(e.dataTransfer.files)); });
    document.getElementById('disp-file-input').addEventListener('change',function(){ addFiles(Array.from(this.files)); this.value=''; });
    function addFiles(files){
      var allowed=['image/png','image/jpeg','application/pdf'];
      files.forEach(function(f){
        if(!allowed.includes(f.type)){showToast('Only PNG, JPG, PDF accepted','error');return;}
        if(f.size>10*1024*1024){showToast(f.name+' exceeds 10 MB','error');return;}
        if(selectedFiles.length>=5){showToast('Max 5 files','error');return;}
        if(selectedFiles.some(function(x){return x.name===f.name&&x.size===f.size;})){showToast(f.name+' already added','info');return;}
        selectedFiles.push(f);
      }); renderFileList();
    }
    function renderFileList(){
      var ul=document.getElementById('disp-file-list');
      if(!ul)return;
      ul.innerHTML=selectedFiles.map(function(f,i){
        var icon=f.type==='application/pdf'?'fa-file-pdf':'fa-file-image';
        var size=(f.size/1024)<1024?(Math.round(f.size/1024)+'KB'):(Math.round(f.size/1024/10.24)/100+' MB');
        return '<li style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;">'+
          '<i class="fas '+icon+'" style="color:#64748b;font-size:14px;flex-shrink:0;"></i>'+
          '<span style="flex:1;font-size:12px;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+f.name+'</span>'+
          '<span style="font-size:11px;color:#94a3b8;flex-shrink:0;">'+size+'</span>'+
          '<button data-idx="'+i+'" class="disp-remove-file" style="width:22px;height:22px;border:none;background:transparent;cursor:pointer;color:#94a3b8;font-size:14px;flex-shrink:0;padding:0;">&times;</button>'+
          '</li>';
      }).join('');
      ul.querySelectorAll('.disp-remove-file').forEach(function(btn){
        btn.addEventListener('click',function(){ selectedFiles.splice(parseInt(this.dataset.idx),1); renderFileList(); });
      });
    }
    function readFileAsDataURL(file){ return new Promise(function(resolve){ var r=new FileReader(); r.onload=function(e){resolve({name:file.name,type:file.type,size:file.size,dataUrl:e.target.result});}; r.readAsDataURL(file); }); }
    function closeDisputeModal(){root.innerHTML='';}
    document.getElementById('disp-close').onclick=closeDisputeModal;
    document.getElementById('disp-cancel').onclick=closeDisputeModal;
    document.getElementById('dispute-overlay').addEventListener('click',function(e){if(e.target===this)closeDisputeModal();});
    document.getElementById('disp-submit').onclick=async function(){
      var desc=document.getElementById('disp-desc').value.trim();
      if(!desc){showToast('Please describe your issue','error');return;}
      var btn=this; btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Saving…';
      try{
        var fileRecords=await Promise.all(selectedFiles.map(readFileAsDataURL));
        var evidence={orderId:id,submittedBy:myAddr,submittedAt:new Date().toISOString(),description:desc,files:fileRecords.map(function(f){return{name:f.name,type:f.type,size:f.size,dataUrl:f.dataUrl};})};
        var allEvidence=JSON.parse(localStorage.getItem('rh_dispute_evidence')||'{}');
        if(!allEvidence[id])allEvidence[id]=[];
        allEvidence[id].push(evidence);
        localStorage.setItem('rh_dispute_evidence',JSON.stringify(allEvidence));
        var orders2=JSON.parse(localStorage.getItem('rh_orders')||'[]');
        var idx=orders2.findIndex(function(o){return o.id===id;});
        if(idx>=0){ orders2[idx].status='dispute'; orders2[idx].disputedAt=new Date().toISOString(); orders2[idx].disputeLockedFunds=true; orders2[idx].disputeEvidenceCount=(orders2[idx].disputeEvidenceCount||0)+1; localStorage.setItem('rh_orders',JSON.stringify(orders2)); }
        closeDisputeModal();
        showToast('Dispute opened — funds remain locked in Arc escrow.','success');
        setTimeout(function(){location.reload();},900);
      }catch(e){ console.error('[dispute]',e); showToast('Error saving dispute.','error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-gavel"></i> Submit Dispute'; }
    };
  }

  function showReceiptModalDetail(){ showReceiptModal('${id}'); }

  (function(){
    function _run(){
      if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',_orderDetailInit); return; }
      _orderDetailInit();
    }
    if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',_run); } else { _run(); }
  })();
  </script>
  `)
}

// ─── PAGE: SELL ─────────────────────────────────────────────────────────
function sellPage() {
  return shell('Sell on Shukly Store', `
  <style>
    /* ── Multi-image upload system ───────────────────────────── */
    .mi-drop-zone {
      border: 2px dashed #cbd5e1;
      border-radius: 16px;
      padding: 32px 20px;
      text-align: center;
      cursor: pointer;
      transition: border-color .2s, background .2s;
      position: relative;
    }
    .mi-drop-zone.drag-over {
      border-color: #dc2626;
      background: rgba(220,38,38,.04);
    }
    .mi-drop-zone.has-images {
      padding: 16px 20px;
      border-color: #e2e8f0;
    }
    .mi-drop-zone:hover { border-color: #dc2626; background: rgba(220,38,38,.02); }

    /* Grid of previews */
    .mi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    @media (max-width: 480px) {
      .mi-grid { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; }
    }

    .mi-thumb {
      position: relative;
      aspect-ratio: 1;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #e2e8f0;
      background: #f8fafc;
      cursor: grab;
      transition: transform .2s, box-shadow .2s, border-color .2s;
      animation: miThumbIn .25s cubic-bezier(.34,1.56,.64,1) both;
    }
    @keyframes miThumbIn {
      from { opacity:0; transform:scale(.7); }
      to   { opacity:1; transform:scale(1); }
    }
    .mi-thumb.is-cover {
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220,38,38,.18);
    }
    .mi-thumb:active { cursor: grabbing; }
    .mi-thumb.dragging { opacity: .4; transform: scale(.95); }
    .mi-thumb.drag-target { border-color: #dc2626; box-shadow: 0 0 0 2px #dc2626; }

    .mi-thumb img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    /* Cover badge */
    .mi-cover-badge {
      position: absolute; bottom: 0; left: 0; right: 0;
      background: linear-gradient(0deg, rgba(220,38,38,.85) 0%, transparent 100%);
      color: #fff;
      font-size: 9px; font-weight: 700; letter-spacing: .4px;
      padding: 10px 4px 4px;
      text-align: center;
      text-transform: uppercase;
    }

    /* Remove button */
    .mi-remove {
      position: absolute; top: 4px; right: 4px;
      width: 22px; height: 22px;
      background: rgba(15,23,42,.7);
      border: none; border-radius: 50%;
      color: #fff; font-size: 10px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      opacity: 0;
      transition: opacity .15s, background .15s;
    }
    .mi-thumb:hover .mi-remove { opacity: 1; }
    .mi-remove:hover { background: #dc2626; }

    /* Drag handle */
    .mi-drag-handle {
      position: absolute; top: 4px; left: 4px;
      width: 20px; height: 20px;
      background: rgba(15,23,42,.55);
      border-radius: 5px;
      color: rgba(255,255,255,.8); font-size: 9px;
      display: flex; align-items: center; justify-content: center;
      opacity: 0;
      transition: opacity .15s;
      cursor: grab;
    }
    .mi-thumb:hover .mi-drag-handle { opacity: 1; }

    /* Add-more slot */
    .mi-add-slot {
      aspect-ratio: 1;
      border-radius: 12px;
      border: 2px dashed #cbd5e1;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      cursor: pointer;
      transition: border-color .2s, background .2s;
      color: #94a3b8;
      font-size: 11px; font-weight: 600;
      gap: 4px;
      background: #f8fafc;
    }
    .mi-add-slot:hover { border-color: #dc2626; color: #dc2626; background: #fef2f2; }
    .mi-add-slot i { font-size: 20px; }

    /* Counter + hint bar */
    .mi-bar {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 12px; color: #64748b;
      margin-bottom: 8px;
    }
    .mi-bar .mi-count { font-weight: 700; color: #1e293b; }
    .mi-bar .mi-hint  { color: #94a3b8; font-size: 11px; }

    /* Error message */
    .mi-error {
      background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 8px; padding: 8px 12px;
      font-size: 12px; color: #dc2626;
      display: flex; align-items: center; gap-6px;
      margin-top: 8px; animation: miThumbIn .2s ease both;
    }

    /* Processing overlay */
    .mi-processing {
      position: absolute; inset: 0;
      background: rgba(248,250,252,.85);
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px;
    }

    /* URL tab */
    #img-panel-url input { transition: border-color .2s; }
  </style>

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

        <!-- ═══════════════════════════════════════════════════════
             MULTI-IMAGE UPLOAD (max 5)
             ═══════════════════════════════════════════════════ -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-semibold text-slate-700">
              Product Images <span class="font-normal text-slate-400">(1–5 images)</span>
            </label>
            <!-- Source tab switcher -->
            <div class="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button type="button" id="tab-upload" onclick="miSwitchTab('upload')"
                class="px-3 py-1 rounded-md text-xs font-semibold transition-all bg-white text-slate-800 shadow-sm">
                <i class="fas fa-camera mr-1"></i>Upload
              </button>
              <button type="button" id="tab-url" onclick="miSwitchTab('url')"
                class="px-3 py-1 rounded-md text-xs font-semibold transition-all text-slate-500 hover:text-slate-700">
                <i class="fas fa-link mr-1"></i>URL
              </button>
            </div>
          </div>

          <!-- ── UPLOAD tab ──────────────────────────── -->
          <div id="img-panel-upload">

            <!-- Drop zone (doubles as grid container when images exist) -->
            <div id="mi-drop-zone" class="mi-drop-zone"
              ondragover="miDragOver(event)"
              ondragleave="miDragLeave(event)"
              ondrop="miDrop(event)"
              onclick="miZoneClick(event)">

              <!-- counter bar (visible when images > 0) -->
              <div id="mi-bar" class="mi-bar hidden">
                <span><span id="mi-count" class="mi-count">0</span>/5 images
                  <span class="text-xs text-red-600 font-semibold ml-2" id="mi-cover-hint">First image = cover</span>
                </span>
                <span class="mi-hint"><i class="fas fa-grip-vertical mr-1"></i>Drag to reorder</span>
              </div>

              <!-- thumbnails grid -->
              <div id="mi-grid" class="mi-grid hidden"></div>

              <!-- empty state (shown when no images) -->
              <div id="mi-empty-state">
                <i class="fas fa-images text-4xl text-slate-200 mb-3 block"></i>
                <p class="text-sm font-semibold text-slate-500 mb-1">
                  Drag &amp; drop images here or <span class="text-red-600">click to choose</span>
                </p>
                <p class="text-xs text-slate-400">JPG, PNG, WEBP · Max 5 MB per image · Up to 5 images · Auto-compressed</p>
              </div>

              <!-- global processing overlay (shown while any image is compressing) -->
              <div id="mi-processing-overlay" class="hidden" style="pointer-events:none;position:absolute;inset:0;background:rgba(255,255,255,.7);border-radius:14px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:#64748b;">
                <span class="loading-spinner inline-block"></span>
                <span id="mi-processing-text">Processing…</span>
              </div>
            </div>

            <!-- Hidden file input (multiple) -->
            <input type="file" id="mi-file-input" accept="image/jpeg,image/png,image/webp"
              multiple class="hidden" onchange="miHandleFiles(this.files)"/>

            <!-- Error message container -->
            <div id="mi-error" class="hidden mi-error">
              <i class="fas fa-exclamation-circle mr-1.5"></i>
              <span id="mi-error-text"></span>
            </div>

            <!-- Info strip -->
            <div class="flex items-center gap-2 mt-2 text-xs text-slate-400">
              <i class="fas fa-info-circle text-blue-400"></i>
              <span>First image is the cover. Drag thumbnails to reorder. Max 5 images, 5 MB each.</span>
            </div>
          </div>

          <!-- ── URL / IPFS tab ──────────────────────── -->
          <div id="img-panel-url" class="hidden">
            <input type="url" id="prod-img" placeholder="https://... or ipfs://..." class="input mb-2"/>
            <div id="img-url-preview-wrap" class="hidden mt-2 flex items-center gap-3">
              <img id="img-url-preview" src="" alt="Preview"
                class="w-20 h-20 rounded-xl object-cover border border-slate-200 shadow-sm"
                onerror="this.parentElement.classList.add('hidden')"/>
              <div>
                <p class="text-xs font-semibold text-slate-600">Preview</p>
                <p class="text-xs text-slate-400 mt-0.5">Image will be loaded on the product page</p>
              </div>
            </div>
            <p class="text-xs text-slate-400 mt-2 leading-relaxed">
              <i class="fas fa-info-circle mr-1 text-blue-400"></i>
              Paste an image URL (<code class="bg-slate-100 px-1 rounded">https://</code>) or an IPFS link
              (<code class="bg-slate-100 px-1 rounded">ipfs://</code>) for decentralized storage.
            </p>
          </div>

          <!-- Hidden field — always holds the primary/cover image for listProduct() -->
          <input type="hidden" id="prod-img-final"/>
        </div>

        <!-- Fee Breakdown Card -->
        <div class="card p-5 bg-slate-50 border-slate-200" id="fee-breakdown-card">
          <h4 class="font-bold text-slate-700 mb-3 flex items-center gap-2">
            <i class="fas fa-calculator text-red-500"></i> Listing Fee Breakdown
          </h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-slate-600">
              <span>Product Price</span><span id="fee-product-price">—</span>
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

        <button onclick="listProduct()" id="sell-submit-btn" class="btn-primary w-full justify-center py-3 text-base">
          <i class="fas fa-tag mr-2"></i> List Product
        </button>
      </div>
    </div>
  </div>

  <script>
  // ════════════════════════════════════════════════════════════════════════
  //  MULTI-IMAGE UPLOAD SYSTEM — max 5 images
  //  State: _miImages = [{ dataUrl, name, originalSize, compressedSize }]
  //  Cover = _miImages[0]
  // ════════════════════════════════════════════════════════════════════════
  const MI_MAX         = 5;
  const MI_MAX_BYTES   = 5 * 1024 * 1024; // 5 MB per image
  const MI_VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  let _miImages       = [];  // array of { dataUrl, name, origSize, compSize }
  let _miDragIdx      = -1;  // index of thumb being dragged
  let _miProcessing   = false;

  // ── compress one File → dataURL ──────────────────────────────────────
  function miCompress(file, maxW, maxH, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = ev => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── process a batch of dropped / selected Files ──────────────────────
  async function miHandleFiles(fileList) {
    if (_miProcessing) return;
    const files = Array.from(fileList);

    // Validate types first (show inline error)
    const invalidType = files.find(f => !MI_VALID_TYPES.includes(f.type));
    if (invalidType) {
      miShowError('Invalid file type "' + invalidType.name + '". Only JPG, PNG and WEBP are accepted.');
      return;
    }

    // Size check
    const tooBig = files.find(f => f.size > MI_MAX_BYTES);
    if (tooBig) {
      miShowError('"' + tooBig.name + '" exceeds the 5 MB limit (' + (tooBig.size / 1024 / 1024).toFixed(1) + ' MB).');
      return;
    }

    // Limit check
    const available = MI_MAX - _miImages.length;
    if (available <= 0) {
      miShowError('Maximum of ' + MI_MAX + ' images reached. Remove one before adding more.');
      return;
    }
    const batch = files.slice(0, available);
    if (files.length > available) {
      miShowError('Only ' + available + ' slot(s) remaining. ' + (files.length - available) + ' file(s) were ignored.');
    } else {
      miHideError();
    }

    // Duplicate check (by name + size)
    const existing = new Set(_miImages.map(i => i.name + ':' + i.origSize));
    const dupes = batch.filter(f => existing.has(f.name + ':' + f.size));
    if (dupes.length) {
      miShowError('Duplicate image(s) skipped: ' + dupes.map(d => d.name).join(', '));
    }
    const unique = batch.filter(f => !existing.has(f.name + ':' + f.size));
    if (!unique.length) return;

    // Show processing overlay
    _miProcessing = true;
    const overlay = document.getElementById('mi-processing-overlay');
    const procText = document.getElementById('mi-processing-text');
    if (overlay) { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }

    for (let i = 0; i < unique.length; i++) {
      const file = unique[i];
      if (procText) procText.textContent = 'Compressing ' + (i + 1) + '/' + unique.length + '…';

      try {
        // First pass: 1200×1200 at 0.82
        let dataUrl = await miCompress(file, 1200, 1200, 0.82);
        // If still large, second pass
        if (dataUrl.length > 800 * 1024) {
          dataUrl = await miCompress(file, 900, 900, 0.65);
        }

        const origSize = file.size;
        const compSize = Math.round(dataUrl.length * 0.75);

        _miImages.push({ dataUrl, name: file.name, origSize, compSize });
      } catch (err) {
        console.error('[miHandleFiles] compress error:', err);
      }
    }

    _miProcessing = false;
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = 'none'; }

    miRender();
    miSyncFinal();
  }

  // ── render the grid ───────────────────────────────────────────────────
  function miRender() {
    const grid      = document.getElementById('mi-grid');
    const bar       = document.getElementById('mi-bar');
    const countEl   = document.getElementById('mi-count');
    const empty     = document.getElementById('mi-empty-state');
    const zone      = document.getElementById('mi-drop-zone');
    const n         = _miImages.length;

    if (!grid) return;

    // Toggle empty state vs grid
    if (n === 0) {
      grid.classList.add('hidden');
      bar.classList.add('hidden');
      empty.classList.remove('hidden');
      zone.classList.remove('has-images');
    } else {
      grid.classList.remove('hidden');
      bar.classList.remove('hidden');
      empty.classList.add('hidden');
      zone.classList.add('has-images');
    }

    if (countEl) countEl.textContent = n;

    // Build thumb nodes
    grid.innerHTML = '';

    _miImages.forEach((img, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'mi-thumb' + (idx === 0 ? ' is-cover' : '');
      thumb.dataset.idx = idx;
      thumb.draggable = true;

      // Drag events
      thumb.addEventListener('dragstart', e => {
        _miDragIdx = idx;
        setTimeout(() => thumb.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      thumb.addEventListener('dragend', () => {
        thumb.classList.remove('dragging');
        document.querySelectorAll('.mi-thumb').forEach(t => t.classList.remove('drag-target'));
        _miDragIdx = -1;
      });
      thumb.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.mi-thumb').forEach(t => t.classList.remove('drag-target'));
        if (_miDragIdx !== -1 && _miDragIdx !== idx) thumb.classList.add('drag-target');
      });
      thumb.addEventListener('dragleave', () => thumb.classList.remove('drag-target'));
      thumb.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        thumb.classList.remove('drag-target');
        if (_miDragIdx === -1 || _miDragIdx === idx) return;
        // Reorder
        const moved = _miImages.splice(_miDragIdx, 1)[0];
        _miImages.splice(idx, 0, moved);
        miRender();
        miSyncFinal();
      });

      // Image element
      const image = document.createElement('img');
      image.src = img.dataUrl;
      image.alt = img.name;

      // Drag handle
      const handle = document.createElement('div');
      handle.className = 'mi-drag-handle';
      handle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
      handle.title = 'Drag to reorder';

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'mi-remove';
      removeBtn.innerHTML = '<i class="fas fa-times"></i>';
      removeBtn.title = 'Remove image';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        miRemove(idx);
      });

      // Cover badge (only index 0)
      if (idx === 0) {
        const badge = document.createElement('div');
        badge.className = 'mi-cover-badge';
        badge.textContent = 'Cover';
        thumb.appendChild(badge);
      }

      thumb.appendChild(image);
      thumb.appendChild(handle);
      thumb.appendChild(removeBtn);
      grid.appendChild(thumb);
    });

    // Add "+" slot if below max
    if (n < MI_MAX) {
      const addSlot = document.createElement('div');
      addSlot.className = 'mi-add-slot';
      addSlot.innerHTML = '<i class="fas fa-plus"></i><span>' + (n === 0 ? 'Add image' : 'Add more') + '</span>';
      addSlot.title = 'Add image (' + n + '/' + MI_MAX + ')';
      addSlot.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('mi-file-input').click();
      });
      grid.appendChild(addSlot);
    }
  }

  // ── remove by index ───────────────────────────────────────────────────
  function miRemove(idx) {
    _miImages.splice(idx, 1);
    miRender();
    miSyncFinal();
    miHideError();
  }

  // ── sync cover image → hidden field used by listProduct() ────────────
  function miSyncFinal() {
    const field = document.getElementById('prod-img-final');
    if (field) field.value = _miImages.length > 0 ? _miImages[0].dataUrl : '';
  }

  // ── zone click (only when clicking empty area, not on thumbs) ────────
  function miZoneClick(e) {
    // Don't open picker if clicking a thumb or the add-slot (handled separately)
    if (e.target.closest('.mi-thumb') || e.target.closest('.mi-add-slot')) return;
    if (_miImages.length >= MI_MAX) return;
    document.getElementById('mi-file-input').click();
  }

  // ── drag & drop on zone ───────────────────────────────────────────────
  function miDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // Only add visual if it's an external file drag (not a thumb reorder)
    if (_miDragIdx === -1) {
      document.getElementById('mi-drop-zone').classList.add('drag-over');
    }
  }
  function miDragLeave(e) {
    // Only remove if leaving the zone entirely
    if (!document.getElementById('mi-drop-zone').contains(e.relatedTarget)) {
      document.getElementById('mi-drop-zone').classList.remove('drag-over');
    }
  }
  function miDrop(e) {
    e.preventDefault();
    document.getElementById('mi-drop-zone').classList.remove('drag-over');
    if (_miDragIdx !== -1) return; // thumb reorder handled on thumb's own drop
    const files = e.dataTransfer.files;
    if (files && files.length) miHandleFiles(files);
  }

  // ── error helpers ─────────────────────────────────────────────────────
  function miShowError(msg) {
    const el = document.getElementById('mi-error');
    const tx = document.getElementById('mi-error-text');
    if (tx) tx.textContent = msg;
    if (el) { el.classList.remove('hidden'); el.style.display = 'flex'; }
  }
  function miHideError() {
    const el = document.getElementById('mi-error');
    if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
  }

  // ── tab switcher ──────────────────────────────────────────────────────
  function miSwitchTab(tab) {
    const isUpload = tab === 'upload';
    document.getElementById('img-panel-upload').classList.toggle('hidden', !isUpload);
    document.getElementById('img-panel-url').classList.toggle('hidden', isUpload);
    const tu = document.getElementById('tab-upload');
    const tl = document.getElementById('tab-url');
    const active   = 'px-3 py-1 rounded-md text-xs font-semibold transition-all bg-white text-slate-800 shadow-sm';
    const inactive = 'px-3 py-1 rounded-md text-xs font-semibold transition-all text-slate-500 hover:text-slate-700';
    if (tu) tu.className = isUpload ? active : inactive;
    if (tl) tl.className = isUpload ? inactive : active;
    if (!isUpload) {
      // Clear upload images from final when switching to URL tab
      document.getElementById('prod-img-final').value = '';
    } else {
      miSyncFinal();
    }
  }
  // Keep old name as alias (called from URL tab)
  function switchImgTab(tab) { miSwitchTab(tab); }

  // ════════════════════════════════════════════════════════════════════════
  //  listProduct — unchanged except reads prod-img-final (set by miSyncFinal)
  // ════════════════════════════════════════════════════════════════════════
  async function listProduct() {
    const w = getStoredWallet();
    if (!w) { showToast('Connect a wallet first', 'error'); window.location.href = '/wallet'; return; }
    const name     = document.getElementById('prod-name').value.trim();
    const cat      = document.getElementById('prod-cat').value;
    const desc     = document.getElementById('prod-desc').value.trim();
    const priceVal = parseFloat(document.getElementById('prod-price').value);
    const token    = document.getElementById('prod-token').value;
    const stockVal = parseInt(document.getElementById('prod-stock').value) || 1;
    const img      = document.getElementById('prod-img-final').value.trim();

    if (!name || !cat || !desc || !priceVal) { showToast('Please fill in all required fields', 'error'); return; }
    if (priceVal <= 0) { showToast('Price must be greater than zero', 'error'); return; }

    const btn = document.getElementById('sell-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Publishing…'; }

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: name, description: desc, price: priceVal,
          token, image: img, category: cat, stock: stockVal,
          seller_id: w.address
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || 'Error publishing product', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-tag mr-2"></i> List Product'; }
        return;
      }
      showToast('Product listed successfully!', 'success');
      setTimeout(() => { window.location.href = '/marketplace'; }, 1200);
    } catch (err) {
      showToast('Network error. Please try again.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-tag mr-2"></i> List Product'; }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  DOMContentLoaded — wallet check, fee breakdown, URL tab preview
  // ════════════════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('sell-network-status'));
    const w  = getStoredWallet();
    const wc = document.getElementById('sell-wallet-check');
    if (!w) {
      wc.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>You need to connect a wallet to list products. <a href="/wallet" class="underline font-bold ml-1">Connect Wallet →</a></div>';
    } else {
      wc.innerHTML = '<div class="network-ok"><i class="fas fa-check-circle text-green-600"></i>Seller: <span class="font-mono text-xs ml-1">' + w.address + '</span></div>';
    }

    // Fee breakdown live update
    function updateFeeBreakdown() {
      const priceEl = document.getElementById('prod-price');
      const tokenEl = document.getElementById('prod-token');
      if (!priceEl || !tokenEl) return;
      const p          = parseFloat(priceEl.value) || 0;
      const tok        = tokenEl.value || 'USDC';
      const platformFee= p * 0.02;
      const arcFee     = 0.001;
      const youReceive = Math.max(0, p - platformFee - arcFee);
      const fpEl   = document.getElementById('fee-product-price');
      const fplatEl= document.getElementById('fee-platform');
      const farcEl = document.getElementById('fee-arc');
      const fyoEl  = document.getElementById('fee-you-receive');
      if (fpEl)    fpEl.textContent   = p > 0 ? p.toFixed(6) + ' ' + tok : '—';
      if (fplatEl) fplatEl.textContent= p > 0 ? platformFee.toFixed(6) + ' ' + tok : '—';
      if (farcEl)  farcEl.textContent = '~0.001 ' + tok;
      if (fyoEl)   fyoEl.textContent  = p > 0 ? youReceive.toFixed(6) + ' ' + tok : '—';
    }
    const priceInput  = document.getElementById('prod-price');
    const tokenSelect = document.getElementById('prod-token');
    if (priceInput)  priceInput.addEventListener('input', updateFeeBreakdown);
    if (tokenSelect) tokenSelect.addEventListener('change', updateFeeBreakdown);
    updateFeeBreakdown();

    // URL field live preview
    const urlInput = document.getElementById('prod-img');
    if (urlInput) {
      urlInput.addEventListener('input', function () {
        const val = this.value.trim();
        document.getElementById('prod-img-final').value = val;
        const wrap     = document.getElementById('img-url-preview-wrap');
        const previewEl= document.getElementById('img-url-preview');
        if (val && (val.startsWith('http') || val.startsWith('ipfs'))) {
          const src = val.startsWith('ipfs://') ? val.replace('ipfs://', 'https://ipfs.io/ipfs/') : val;
          previewEl.src = src;
          wrap.classList.remove('hidden');
        } else {
          wrap.classList.add('hidden');
        }
      });
    }

    // Init grid render (empty state)
    miRender();
  });
  </script>
  `)
}

// ─── PAGE: PROFILE ──────────────────────────────────────────────────────
function profilePage() {
  return shell('Profile', `
  <div class="max-w-6xl mx-auto px-4 py-8">

    <!-- ═══ HEADER ═════════════════════════════════════════════════════ -->
    <div class="dash-header-card mb-6" id="dash-header">
      <div class="dash-avatar" id="dash-avatar-initials"><i class="fas fa-user"></i></div>
      <div class="dash-header-info">
        <h1 class="dash-username" id="dash-username">Not Connected</h1>
        <div class="dash-wallet-row">
          <code class="dash-wallet-addr" id="dash-wallet-addr">—</code>
          <button class="dash-copy-btn" id="dash-copy-btn" title="Copy address" onclick="dashCopyAddr()"><i class="fas fa-copy"></i></button>
          <a id="dash-explorer-link" href="#" target="_blank" class="dash-explorer-link"><i class="fas fa-external-link-alt mr-1"></i>Explorer</a>
        </div>
        <div class="dash-badges-row">
          <span class="dash-badge network-badge"><i class="fas fa-network-wired mr-1"></i>Arc Testnet</span>
          <span class="dash-badge rep-badge"><i class="fas fa-star mr-1 text-yellow-400"></i><span id="dash-rep">—</span> Rep</span>
          <span class="dash-badge verified-badge" id="dash-verified-badge" style="display:none;"><i class="fas fa-check-circle mr-1 text-green-400"></i>Verified</span>
        </div>
      </div>
      <div class="dash-quick-actions">
        <a href="/sell" class="dash-qa-btn"><i class="fas fa-plus-circle mr-1"></i>Sell</a>
        <a href="/orders" class="dash-qa-btn"><i class="fas fa-box mr-1"></i>Orders</a>
        <a href="/disputes" class="dash-qa-btn dispute-btn"><i class="fas fa-gavel mr-1"></i>Disputes</a>
      </div>
    </div>

    <!-- ═══ WALLET OVERVIEW + STATS ═══════════════════════════════════ -->
    <div class="dash-stats-grid mb-6">
      <div class="dash-stat-card" id="dsc-balance">
        <div class="dsc-icon" style="background:#dcfce7;"><i class="fas fa-coins text-green-600"></i></div>
        <div><p class="dsc-label">Available Balance</p><p class="dsc-value" id="ds-balance">—</p></div>
      </div>
      <div class="dash-stat-card" id="dsc-locked">
        <div class="dsc-icon" style="background:#fee2e2;"><i class="fas fa-lock text-red-600"></i></div>
        <div><p class="dsc-label">Escrow Locked</p><p class="dsc-value" id="ds-locked">—</p></div>
      </div>
      <div class="dash-stat-card" id="dsc-earned">
        <div class="dsc-icon" style="background:#eff6ff;"><i class="fas fa-chart-line text-blue-600"></i></div>
        <div><p class="dsc-label">Total Earned</p><p class="dsc-value" id="ds-earned">—</p></div>
      </div>
      <div class="dash-stat-card" id="dsc-orders">
        <div class="dsc-icon" style="background:#f0fdf4;"><i class="fas fa-shopping-bag text-green-600"></i></div>
        <div><p class="dsc-label">Total Orders</p><p class="dsc-value" id="ds-orders">—</p></div>
      </div>
      <div class="dash-stat-card" id="dsc-listings">
        <div class="dsc-icon" style="background:#fef3c7;"><i class="fas fa-store text-amber-600"></i></div>
        <div><p class="dsc-label">Active Listings</p><p class="dsc-value" id="ds-listings">—</p></div>
      </div>
      <div class="dash-stat-card" id="dsc-disputes">
        <div class="dsc-icon" style="background:#fce7f3;"><i class="fas fa-gavel text-pink-600"></i></div>
        <div><p class="dsc-label">Open Disputes</p><p class="dsc-value" id="ds-disputes">—</p></div>
      </div>
    </div>

    <!-- ═══ MAIN GRID ══════════════════════════════════════════════════ -->
    <div class="dash-main-grid">

      <!-- LEFT: Sidebar nav -->
      <aside class="dash-sidebar">
        <nav class="sidebar-nav space-y-1" id="prof-sidebar-nav">
          <a href="#" onclick="profShowTab('overview');return false;" class="active" id="pnav-overview"><i class="fas fa-user w-4"></i> Overview</a>
          <a href="#" onclick="profShowTab('products');return false;" id="pnav-products"><i class="fas fa-boxes w-4"></i> My Products</a>
          <a href="#" onclick="profShowTab('wallet');return false;" id="pnav-wallet"><i class="fas fa-wallet w-4"></i> Wallet</a>
          <a href="#" onclick="profShowTab('activity');return false;" id="pnav-activity"><i class="fas fa-history w-4"></i> Activity</a>
          <a href="#" onclick="profShowTab('security');return false;" id="pnav-security"><i class="fas fa-shield-alt w-4"></i> Security</a>
          <a href="/orders"><i class="fas fa-box w-4"></i> My Orders</a>
          <a href="/disputes"><i class="fas fa-gavel w-4"></i> Disputes</a>
          <a href="/notifications"><i class="fas fa-bell w-4"></i> Notifications</a>
        </nav>
      </aside>

      <!-- RIGHT: Tab content -->
      <div class="dash-content">

        <!-- ══ TAB: OVERVIEW ══════════════════════════════════════════ -->
        <div id="prof-tab-overview">

          <!-- Active dispute widget -->
          <div id="dash-dispute-widget" style="display:none;" class="card p-5 mb-5 border-l-4 border-red-500">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-gavel text-red-500"></i> Active Dispute</h3>
              <a href="/disputes" class="btn-secondary text-xs py-1">View Details</a>
            </div>
            <div id="dash-dispute-widget-content"></div>
          </div>

          <!-- Personal Information -->
          <div class="card p-6 mb-5">
            <h2 class="font-bold text-slate-800 text-lg mb-4">Personal Information</h2>
            <div class="space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label class="block text-sm font-medium text-slate-700 mb-1">Display Name</label><input type="text" id="prof-display-name" placeholder="Your name" class="input"/></div>
                <div><label class="block text-sm font-medium text-slate-700 mb-1">Email (optional)</label><input type="email" id="prof-email" placeholder="your@email.com" class="input"/></div>
              </div>
              <div><label class="block text-sm font-medium text-slate-700 mb-1">Shipping Address</label><input type="text" id="prof-shipping" placeholder="Street, City, Country" class="input"/></div>
              <button onclick="dashSaveProfile()" class="btn-primary"><i class="fas fa-save mr-1"></i> Save Changes</button>
            </div>
          </div>

          <!-- Recent activity feed -->
          <div class="card p-5 mb-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-history text-red-500"></i> Recent Activity</h3>
            </div>
            <div id="dash-activity-feed">
              <div class="text-center py-6 text-slate-400 text-sm"><div class="loading-spinner mx-auto mb-2"></div>Loading activity…</div>
            </div>
          </div>

        </div><!-- /overview -->

        <!-- ══ TAB: MY PRODUCTS ═══════════════════════════════════════ -->
        <div id="prof-tab-products" style="display:none;">
          <div class="card p-6">
            <div class="flex items-center justify-between mb-5">
              <h2 class="font-bold text-slate-800 text-lg flex items-center gap-2">
                <i class="fas fa-boxes text-red-500"></i> My Products
              </h2>
              <div class="flex gap-2 flex-wrap">
                <button onclick="profFilterProducts('all')" id="ppf-all" class="ppf-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white">All</button>
                <button onclick="profFilterProducts('active')" id="ppf-active" class="ppf-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">Active</button>
                <button onclick="profFilterProducts('paused')" id="ppf-paused" class="ppf-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">Paused</button>
                <a href="/sell" class="btn-primary text-xs py-1.5 px-3"><i class="fas fa-plus mr-1"></i>New</a>
              </div>
            </div>
            <div id="prof-products-container"></div>
          </div>
        </div>

        <!-- ══ TAB: WALLET ════════════════════════════════════════════ -->
        <div id="prof-tab-wallet" style="display:none;">
          <div class="card p-6 mb-5">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fas fa-wallet text-red-500"></i> Wallet Overview</h2>
              <a href="/wallet" class="btn-secondary text-xs py-1.5">Manage Wallet</a>
            </div>
            <div id="prof-wallet-info" class="text-slate-400 text-sm">Loading…</div>
          </div>
          <div class="card p-5">
            <h3 class="font-bold text-slate-800 mb-3 flex items-center gap-2"><i class="fas fa-chart-bar text-red-500"></i> On-Chain Stats</h3>
            <div class="grid grid-cols-3 gap-4" id="prof-stats">
              <div class="card p-4 text-center"><i class="fas fa-box text-red-500 text-xl mb-2 block"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-orders">—</p><p class="text-slate-400 text-xs">Orders</p></div>
              <div class="card p-4 text-center"><i class="fas fa-coins text-red-500 text-xl mb-2 block"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-spent">—</p><p class="text-slate-400 text-xs">USDC Spent</p></div>
              <div class="card p-4 text-center"><i class="fas fa-store text-green-500 text-xl mb-2 block"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-listings">—</p><p class="text-slate-400 text-xs">Listings</p></div>
            </div>
          </div>
        </div>

        <!-- ══ TAB: ACTIVITY ══════════════════════════════════════════ -->
        <div id="prof-tab-activity" style="display:none;">
          <div class="card p-6">
            <h2 class="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2"><i class="fas fa-history text-red-500"></i> Full Activity Feed</h2>
            <div id="dash-activity-full">
              <div class="text-center py-6 text-slate-400 text-sm"><div class="loading-spinner mx-auto mb-2"></div>Loading…</div>
            </div>
          </div>
        </div>

        <!-- ══ TAB: SECURITY ══════════════════════════════════════════ -->
        <div id="prof-tab-security" style="display:none;">
          <div class="card p-6">
            <h2 class="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2"><i class="fas fa-shield-alt text-red-500"></i> Security</h2>
            <div class="space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p class="text-xs font-bold text-slate-500 uppercase mb-1">Last Login</p>
                  <p class="text-sm text-slate-700 font-medium" id="sec-last-login">—</p>
                </div>
                <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p class="text-xs font-bold text-slate-500 uppercase mb-1">Auth Method</p>
                  <p class="text-sm text-slate-700 font-medium" id="sec-auth-method">—</p>
                </div>
                <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p class="text-xs font-bold text-slate-500 uppercase mb-1">Wallet Type</p>
                  <p class="text-sm text-slate-700 font-medium" id="sec-wallet-type">—</p>
                </div>
                <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p class="text-xs font-bold text-slate-500 uppercase mb-1">Sessions</p>
                  <p class="text-sm text-slate-700 font-medium">1 active session</p>
                </div>
              </div>
              <div class="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p class="text-amber-800 text-sm font-semibold"><i class="fas fa-exclamation-triangle mr-2"></i>Always verify you're on the correct URL before connecting your wallet.</p>
              </div>
            </div>
          </div>
        </div>

      </div><!-- /dash-content -->
    </div><!-- /dash-main-grid -->
  </div><!-- /max-w -->

  <!-- ══ EDIT PRODUCT MODAL ══ -->
  <div id="prof-edit-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;align-items:center;justify-content:center;padding:16px;">
    <div class="card p-6 w-full max-w-lg max-h-screen overflow-y-auto">
      <div class="flex items-center justify-between mb-5">
        <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fas fa-edit text-red-500"></i> Edit Product</h3>
        <button onclick="profCloseEdit()" class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600"><i class="fas fa-times"></i></button>
      </div>
      <form id="prof-edit-form" onsubmit="profSaveProduct(event)" class="space-y-4">
        <input type="hidden" id="pedit-id"/>
        <div><label class="block text-sm font-medium text-slate-700 mb-1">Product Name *</label><input type="text" id="pedit-title" class="input" placeholder="Product name" required/></div>
        <div><label class="block text-sm font-medium text-slate-700 mb-1">Description *</label><textarea id="pedit-description" class="input" rows="3" placeholder="Product description" required style="height:auto;resize:vertical;"></textarea></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Price *</label><input type="number" id="pedit-price" class="input" placeholder="0.00" step="0.01" min="0.01" required/></div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Token</label><select id="pedit-token" class="select"><option value="USDC">USDC</option><option value="EURC">EURC</option></select></div>
        </div>
        <!-- Image section with upload + URL -->
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Product Image</label>
          <!-- Preview -->
          <div id="pedit-img-preview-wrap" class="mb-2 hidden">
            <div class="relative inline-block">
              <img id="pedit-img-preview" src="" alt="Preview" class="w-full max-h-48 object-cover rounded-lg border border-slate-200"/>
              <button type="button" onclick="peditClearImage()" class="absolute top-1 right-1 w-6 h-6 bg-slate-800/70 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 transition-colors" title="Remove image">&times;</button>
            </div>
          </div>
          <!-- Drop zone -->
          <div id="pedit-drop-zone" onclick="document.getElementById('pedit-file-input').click()"
               class="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center cursor-pointer hover:border-red-400 hover:bg-red-50/30 transition-colors mb-2">
            <i class="fas fa-cloud-upload-alt text-2xl text-slate-300 mb-2 block"></i>
            <p class="text-sm text-slate-500">Click to upload image <span class="text-xs text-slate-400">(JPEG, PNG — max 5 MB)</span></p>
          </div>
          <input type="file" id="pedit-file-input" accept="image/jpeg,image/png" class="hidden"/>
          <div class="flex items-center gap-2 my-1">
            <div class="flex-1 h-px bg-slate-100"></div>
            <span class="text-xs text-slate-400">or paste URL</span>
            <div class="flex-1 h-px bg-slate-100"></div>
          </div>
          <input type="url" id="pedit-image" class="input" placeholder="https://example.com/image.jpg" oninput="peditSyncUrlPreview(this.value)"/>
        </div>
        <div class="flex gap-3 pt-2">
          <button type="submit" id="pedit-save-btn" class="btn-primary flex-1"><i class="fas fa-save mr-1"></i> Save Changes</button>
          <button type="button" onclick="profCloseEdit()" class="btn-secondary flex-1">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <style>
  /* ── Dashboard Layout ── */
  .dash-header-card{display:flex;align-items:flex-start;gap:16px;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:20px;padding:24px 28px;flex-wrap:wrap;}
  .dash-avatar{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:900;flex-shrink:0;border:3px solid rgba(255,255,255,.15);}
  .dash-header-info{flex:1;min-width:180px;}
  .dash-username{font-size:18px;font-weight:800;color:#fff;margin:0 0 4px;}
  .dash-wallet-row{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;}
  .dash-wallet-addr{font-size:11px;font-family:monospace;color:#94a3b8;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:6px;}
  .dash-copy-btn{background:none;border:none;color:#64748b;cursor:pointer;padding:2px 5px;border-radius:4px;font-size:12px;}
  .dash-copy-btn:hover{color:#94a3b8;background:rgba(255,255,255,.08);}
  .dash-explorer-link{font-size:11px;color:#60a5fa;text-decoration:none;}
  .dash-explorer-link:hover{text-decoration:underline;}
  .dash-badges-row{display:flex;gap:6px;flex-wrap:wrap;}
  .dash-badge{font-size:10px;padding:3px 10px;border-radius:99px;font-weight:600;display:inline-flex;align-items:center;}
  .network-badge{background:rgba(59,130,246,.18);color:#60a5fa;border:1px solid rgba(59,130,246,.25);}
  .rep-badge{background:rgba(245,158,11,.18);color:#fbbf24;border:1px solid rgba(245,158,11,.25);}
  .verified-badge{background:rgba(34,197,94,.18);color:#4ade80;border:1px solid rgba(34,197,94,.25);}
  .dash-quick-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0;}
  .dash-qa-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#e2e8f0;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;text-decoration:none;display:flex;align-items:center;white-space:nowrap;}
  .dash-qa-btn:hover{background:rgba(255,255,255,.15);}
  .dash-qa-btn.dispute-btn{background:rgba(220,38,38,.2);border-color:rgba(220,38,38,.3);color:#fca5a5;}
  /* Stats grid */
  .dash-stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;}
  .dash-stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 1px 4px rgba(0,0,0,.04);}
  .dsc-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .dsc-label{font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin:0 0 2px;}
  .dsc-value{font-size:18px;font-weight:800;color:#1e293b;margin:0;}
  /* Main grid */
  .dash-main-grid{display:grid;grid-template-columns:200px 1fr;gap:20px;align-items:start;}
  @media(max-width:768px){.dash-main-grid{grid-template-columns:1fr;}.dash-sidebar{display:none;}}
  .dash-sidebar{position:sticky;top:80px;}
  .dash-content{min-width:0;}
  /* Activity feed */
  .dash-feed-item{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9;}
  .dash-feed-icon{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
  .dash-feed-body{flex:1;}
  .dash-feed-title{font-size:13px;font-weight:600;color:#334155;margin:0 0 2px;}
  .dash-feed-sub{font-size:11px;color:#94a3b8;margin:0;}
  .dash-feed-time{font-size:10px;color:#94a3b8;flex-shrink:0;white-space:nowrap;}
  </style>

  <script>
  // ── State ────────────────────────────────────────────────────────────
  var _profProducts  = [];
  var _profFilter    = 'all';
  var _profAddress   = null;
  var _profLoading   = false;
  var _profActiveTab = 'overview';

  // ── Tab switching ──────────────────────────────────────────────────
  function profShowTab(tab) {
    _profActiveTab = tab;
    var tabs = ['overview','products','wallet','activity','security'];
    tabs.forEach(function(t) {
      var el = document.getElementById('prof-tab-'+t);
      if(el) el.style.display = (t===tab) ? '' : 'none';
      var nav = document.getElementById('pnav-'+t);
      if(nav) nav.classList.toggle('active', t===tab);
    });
    try { history.replaceState(null,'','/profile?tab='+tab); } catch(e){}
    if(tab==='products' && _profAddress) loadProfProducts(_profAddress);
    if(tab==='activity') dashRenderFullActivity();
    if(tab==='wallet' && _profAddress) { loadProfStats(_profAddress); dashRenderWalletInfo(); }
    if(tab==='security') dashRenderSecurity();
  }

  // ── Dashboard helpers ─────────────────────────────────────────────
  function dashCopyAddr() {
    if(!_profAddress) return;
    navigator.clipboard.writeText(_profAddress).then(function() { showToast('Address copied', 'success'); }).catch(function() {
      var el = document.createElement('textarea');
      el.value = _profAddress;
      document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
      showToast('Address copied','success');
    });
  }

  function dashSaveProfile() {
    var name = document.getElementById('prof-display-name').value.trim();
    var email = document.getElementById('prof-email').value.trim();
    var shipping = document.getElementById('prof-shipping').value.trim();
    try { localStorage.setItem('rh_profile', JSON.stringify({name:name,email:email,shipping:shipping,savedAt:new Date().toISOString()})); } catch(e){}
    showToast('Profile saved locally','success');
  }

  function dashLoadProfileFields() {
    try {
      var p = JSON.parse(localStorage.getItem('rh_profile')||'{}');
      if(p.name) { var el = document.getElementById('prof-display-name'); if(el) el.value = p.name; }
      if(p.email) { var el2 = document.getElementById('prof-email'); if(el2) el2.value = p.email; }
      if(p.shipping) { var el3 = document.getElementById('prof-shipping'); if(el3) el3.value = p.shipping; }
    } catch(e){}
  }

  function dashRenderWalletInfo() {
    var el = document.getElementById('prof-wallet-info');
    if(!el || !_profAddress) return;
    var explorerBase = (window.ARC && window.ARC.explorer) || 'https://testnet.arcscan.app';
    el.innerHTML =
      '<div class="space-y-3">'
      +'<div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">'
      +'<div><p class="text-xs text-slate-500 mb-0.5">Wallet Address</p>'
      +'<p class="font-mono text-xs text-slate-700 break-all">'+_profAddress+'</p></div>'
      +'</div>'
      +'<a href="'+explorerBase+'/address/'+_profAddress+'" target="_blank" class="flex items-center gap-2 text-blue-600 text-sm hover:underline">'
      +'<i class="fas fa-external-link-alt text-xs"></i> View on Arc Explorer</a>'
      +'<p class="text-xs text-slate-400 mt-2"><i class="fas fa-info-circle mr-1"></i>Non-custodial marketplace. Only you control your wallet.</p>'
      +'</div>';
  }

  function dashRenderSecurity() {
    var w = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    var lastLogin = w && w.timestamp ? new Date(w.timestamp).toLocaleString() : 'Unknown';
    var method = w && w.type ? w.type : 'MetaMask';
    document.getElementById('sec-last-login').textContent = lastLogin;
    document.getElementById('sec-auth-method').textContent = method;
    document.getElementById('sec-wallet-type').textContent = method;
  }

  function dashRenderActivityFeed(containerId, limit) {
    var el = document.getElementById(containerId);
    if(!el || !_profAddress) return;
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem('rh_orders')||'[]'); } catch(e){}
    var myAddr = _profAddress;
    var feedItems = [];

    orders.forEach(function(o) {
      var isBuyer  = o.buyerAddress  && o.buyerAddress.toLowerCase()  === myAddr;
      var isSeller = o.sellerAddress && o.sellerAddress.toLowerCase() === myAddr;
      if(isBuyer) {
        feedItems.push({ icon:'fas fa-shopping-bag', bg:'#dcfce7', color:'#15803d', title:'Purchase — '+escHtml(o.id||''), sub: parseFloat(o.amount||0).toFixed(2)+' '+(o.token||'USDC')+' · Buyer', ts: o.createdAt, url:'/orders/'+(o.id||'') });
        if(o.status==='dispute') feedItems.push({ icon:'fas fa-gavel', bg:'#fee2e2', color:'#dc2626', title:'Dispute Opened', sub:'Order '+(o.id||''), ts: o.disputedAt||o.createdAt, url:'/disputes' });
        if(o.status==='completed') feedItems.push({ icon:'fas fa-check-circle', bg:'#dcfce7', color:'#15803d', title:'Order Completed', sub:'Escrow released · '+(o.id||''), ts: o.resolvedAt||o.updatedAt||o.createdAt, url:'/orders/'+(o.id||'') });
      }
      if(isSeller) {
        feedItems.push({ icon:'fas fa-store', bg:'#eff6ff', color:'#1d4ed8', title:'Sale — '+escHtml(o.id||''), sub: parseFloat(o.amount||0).toFixed(2)+' '+(o.token||'USDC')+' · Seller', ts: o.createdAt, url:'/orders/'+(o.id||'') });
      }
    });

    feedItems.sort(function(a,b){ return new Date(b.ts).getTime() - new Date(a.ts).getTime(); });
    if(limit) feedItems = feedItems.slice(0, limit);

    if(!feedItems.length) {
      el.innerHTML = '<p class="text-slate-400 text-sm text-center py-6"><i class="fas fa-history mr-1"></i>No activity yet.</p>';
      return;
    }

    el.innerHTML = feedItems.map(function(item) {
      var timeStr = item.ts ? timeAgoStr(new Date(item.ts).getTime()) : '';
      return '<a href="'+escHtml(item.url)+'" class="dash-feed-item" style="text-decoration:none;">'
        +'<div class="dash-feed-icon" style="background:'+item.bg+';color:'+item.color+'"><i class="'+item.icon+'"></i></div>'
        +'<div class="dash-feed-body">'
        +'<p class="dash-feed-title">'+escHtml(item.title)+'</p>'
        +'<p class="dash-feed-sub">'+escHtml(item.sub)+'</p>'
        +'</div>'
        +'<span class="dash-feed-time">'+timeStr+'</span>'
        +'</a>';
    }).join('');
  }

  function dashRenderFullActivity() {
    dashRenderActivityFeed('dash-activity-full', 50);
  }

  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function timeAgoStr(ts) {
    var diff = Date.now() - ts;
    var s = Math.floor(diff / 1000);
    if(s < 60) return 'just now';
    var m = Math.floor(s/60); if(m<60) return m+'m ago';
    var h = Math.floor(m/60); if(h<24) return h+'h ago';
    return Math.floor(h/24)+'d ago';
  }

  function dashRenderDisputeWidget(address) {
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem('rh_orders')||'[]'); } catch(e){}
    var activeDisputes = orders.filter(function(o) {
      return o.status === 'dispute' &&
        ((o.buyerAddress && o.buyerAddress.toLowerCase() === address) ||
         (o.sellerAddress && o.sellerAddress.toLowerCase() === address));
    });
    var widget = document.getElementById('dash-dispute-widget');
    var content = document.getElementById('dash-dispute-widget-content');
    if(!widget || !content) return;
    if(!activeDisputes.length) { widget.style.display = 'none'; return; }
    widget.style.display = '';
    var d = activeDisputes[0];
    var meta = {};
    try { meta = JSON.parse(localStorage.getItem('rh_disputes_v2')||'{}')[d.id]||{}; } catch(e){}
    var deadline = meta.sellerDeadline || meta.buyerDeadline || null;
    var deadlineStr = deadline ? 'Deadline: '+new Date(deadline).toLocaleString() : '';
    content.innerHTML =
      '<div class="flex items-center justify-between gap-4 flex-wrap">'
      +'<div>'
      +'<p class="text-sm font-semibold text-slate-800">Order: <code>'+escHtml(d.id||'')+'</code></p>'
      +'<p class="text-xs text-slate-500">'+escHtml(String(d.amount||0))+' '+(d.token||'USDC')+' locked in escrow</p>'
      +(deadlineStr ? '<p class="text-xs text-red-600 font-semibold mt-1"><i class="fas fa-clock mr-1"></i>'+escHtml(deadlineStr)+'</p>' : '')
      +'</div>'
      +(activeDisputes.length > 1 ? '<span class="text-xs text-red-500 font-bold">+' + (activeDisputes.length-1)+' more disputes</span>' : '')
      +'</div>';
    // Update stat
    document.getElementById('ds-disputes').textContent = activeDisputes.length;
  }

  function dashLoadStats(address) {
    // Orders and disputes from localStorage
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem('rh_orders')||'[]'); } catch(e){}
    var bought = orders.filter(function(o){ return o.buyerAddress && o.buyerAddress.toLowerCase()===address; });
    var disputes = orders.filter(function(o){ return o.status==='dispute' && ((o.buyerAddress&&o.buyerAddress.toLowerCase()===address)||(o.sellerAddress&&o.sellerAddress.toLowerCase()===address)); });
    var lockedAmt = disputes.reduce(function(s,o){ return s+parseFloat(o.amount||0); }, 0);
    var totalSpent = bought.reduce(function(s,o){ return s+parseFloat(o.amount||0); }, 0);

    document.getElementById('ds-orders').textContent   = bought.length || '0';
    document.getElementById('ds-locked').textContent   = lockedAmt.toFixed(2)+' USDC';
    document.getElementById('ds-disputes').textContent = disputes.length || '0';
    document.getElementById('ds-balance').textContent  = '—'; // requires on-chain fetch
    document.getElementById('ds-earned').textContent   = '—'; // requires on-chain fetch

    // Calculate reputation score (simple heuristic)
    var completedOrders = orders.filter(function(o){ return o.status==='completed' && ((o.buyerAddress&&o.buyerAddress.toLowerCase()===address)||(o.sellerAddress&&o.sellerAddress.toLowerCase()===address)); });
    var repScore = Math.min(100, completedOrders.length * 10 + 50);
    document.getElementById('dash-rep').textContent = repScore;
    if(completedOrders.length >= 3) {
      var vb = document.getElementById('dash-verified-badge');
      if(vb) vb.style.display = '';
    }

    // Listings from API
    fetch('/api/seller/'+encodeURIComponent(address)+'/products', {
      signal: (function(){ var c=new AbortController(); setTimeout(function(){c.abort();},8000); return c.signal; })()
    }).then(function(r){ return r.json(); }).then(function(d){
      document.getElementById('ds-listings').textContent = d.total || 0;
      document.getElementById('stat-listings').textContent = d.total || 0;
    }).catch(function(){});

    // On-chain orders
    fetch('/api/orders/on-chain?buyer='+encodeURIComponent(address)+'&limit=50', {
      signal: (function(){ var c=new AbortController(); setTimeout(function(){c.abort();},10000); return c.signal; })()
    }).then(function(r){ return r.json(); }).then(function(d){
      var onChainOrders = Array.isArray(d.orders) ? d.orders : [];
      var onChainTotal  = onChainOrders.length;
      var onChainSpent  = onChainOrders.reduce(function(s,o){ return s+parseFloat(o.amount||0); }, 0);
      document.getElementById('stat-orders').textContent = onChainTotal;
      document.getElementById('stat-spent').textContent  = onChainSpent.toFixed(2);
      document.getElementById('ds-orders').textContent   = Math.max(bought.length, onChainTotal);
    }).catch(function(){
      document.getElementById('stat-orders').textContent = bought.length || '?';
      document.getElementById('stat-spent').textContent  = totalSpent.toFixed(2);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async function() {
    var w = (typeof getStoredWallet==='function') ? getStoredWallet() : null;

    if(w && w.address) {
      _profAddress = w.address.toLowerCase();
      var explorerBase = (window.ARC && window.ARC.explorer) || 'https://testnet.arcscan.app';

      // Header
      document.getElementById('dash-username').textContent = _profAddress.slice(0,10)+'…'+_profAddress.slice(-6);
      document.getElementById('dash-wallet-addr').textContent = _profAddress.slice(0,10)+'…'+_profAddress.slice(-6);
      var expLink = document.getElementById('dash-explorer-link');
      if(expLink) expLink.href = explorerBase+'/address/'+_profAddress;

      // Initials avatar from address
      var av = document.getElementById('dash-avatar-initials');
      if(av) av.textContent = _profAddress.slice(2,4).toUpperCase();

      // Load profile fields
      dashLoadProfileFields();

      // Load all stats
      dashLoadStats(_profAddress);

      // Dispute widget
      dashRenderDisputeWidget(_profAddress);

      // Activity feed (overview tab — show last 5)
      dashRenderActivityFeed('dash-activity-feed', 5);

      // Wallet info tab
      dashRenderWalletInfo();
    } else {
      document.getElementById('dash-username').textContent = 'Not Connected';
      document.getElementById('dash-wallet-addr').textContent = '—';
      ['ds-balance','ds-locked','ds-earned','ds-orders','ds-listings','ds-disputes','stat-orders','stat-spent','stat-listings','dash-rep'].forEach(function(id){
        var el=document.getElementById(id); if(el) el.textContent='—';
      });
      document.getElementById('dash-activity-feed').innerHTML = '<p class="text-slate-400 text-sm text-center py-6"><a href="/wallet" class="text-red-600 hover:underline">Connect wallet</a> to see activity.</p>';
    }

    // Wallet event listeners
    try {
      var eth = window.ethereum || window._ethProvider;
      if(eth && eth.on) {
        eth.on('accountsChanged', function(accs) { setTimeout(function(){ location.reload(); }, 400); });
        eth.on('chainChanged', function() { setTimeout(function(){ location.reload(); }, 400); });
      }
    } catch(e){}

    // Auto-switch tab from URL
    var tabParam = new URLSearchParams(location.search).get('tab');
    if(tabParam && ['overview','products','wallet','activity','security'].includes(tabParam)) {
      profShowTab(tabParam);
    }
  });

  // ── Stats loader ─────────────────────────────────────────────────
  async function loadProfStats(address) {
    try {
      var sc1 = new AbortController();
      var st1 = setTimeout(function(){ sc1.abort(); }, 10000);
      var res = await fetch('/api/orders/on-chain?buyer='+encodeURIComponent(address)+'&limit=50', { signal: sc1.signal });
      clearTimeout(st1);
      var total=0, spent=0;
      if(res.ok) { var data=await res.json(); var ords=Array.isArray(data.orders)?data.orders:[]; total=ords.length; spent=ords.reduce(function(s,o){ return s+parseFloat(o.amount||0); },0); }
      document.getElementById('stat-orders').textContent = total;
      document.getElementById('stat-spent').textContent  = spent.toFixed(2);
    } catch(e) { document.getElementById('stat-orders').textContent='?'; document.getElementById('stat-spent').textContent='?'; }
    if(address) {
      try {
        var sc2=new AbortController(); var st2=setTimeout(function(){sc2.abort();},8000);
        var r2=await fetch('/api/seller/'+encodeURIComponent(address)+'/products',{signal:sc2.signal}); clearTimeout(st2);
        if(r2.ok){ var d2=await r2.json(); document.getElementById('stat-listings').textContent=d2.total||0; }
      } catch(e){ document.getElementById('stat-listings').textContent='?'; }
    }
  }

  // ── Load seller products ──────────────────────────────────────────
  async function loadProfProducts(address) {
    if(!address) { profShowNoWallet(); return; }
    if(_profLoading) return;
    _profLoading = true;
    var normAddr = address.toLowerCase();
    _profAddress = normAddr;
    console.log('[myproducts] loadProfProducts for', normAddr);
    profShowProductsLoading();
    try {
      var controller = new AbortController();
      var timeout = setTimeout(function(){ controller.abort(); }, 10000);
      var res = await fetch('/api/seller/'+encodeURIComponent(normAddr)+'/products', { signal: controller.signal });
      clearTimeout(timeout);
      if(!res.ok) { profShowProductsError('Server error '+res.status+'. Please try again.'); return; }
      var data = await res.json();
      var products = Array.isArray(data.products) ? data.products : [];
      _profProducts = products.filter(function(p) { return p.seller_id && p.seller_id.toLowerCase() === normAddr; });
      console.log('[myproducts] loaded', _profProducts.length, 'products');
      renderProfProducts();
    } catch(e) {
      if(e && e.name==='AbortError') { profShowProductsError('Request timed out. Arc Network may be slow. Please try again.'); }
      else { console.error('[myproducts] error:', e); profShowProductsError(e&&e.message?e.message:'Unable to load data. Please try again.'); }
    } finally { _profLoading = false; }
  }

  // ── Render helpers ────────────────────────────────────────────────
  function profShowNoWallet() {
    var c=document.getElementById('prof-products-container'); if(!c) return;
    c.innerHTML='<div class="p-8 text-center"><div class="empty-state"><i class="fas fa-wallet"></i><h3 class="font-bold text-slate-600 mb-2">Wallet Required</h3><p class="text-sm text-slate-400 mb-4">Connect your wallet to manage your product listings.</p><a href="/wallet" class="btn-primary mx-auto"><i class="fas fa-wallet mr-1"></i> Connect Wallet</a></div></div>';
  }
  function profShowProductsLoading() {
    var c=document.getElementById('prof-products-container'); if(!c) return;
    c.innerHTML='<div class="text-center py-12"><div class="loading-spinner-lg mx-auto mb-4"></div><p class="text-slate-400 text-sm">Loading your products\u2026</p></div>';
  }
  function profShowProductsError(msg) {
    var c=document.getElementById('prof-products-container'); if(!c) return;
    c.innerHTML='<div class="p-8 text-center"><i class="fas fa-exclamation-circle text-red-400 text-3xl mb-3 block"></i><p class="text-red-500 font-medium mb-1">Failed to load products</p><p class="text-slate-400 text-sm mb-4">'+(msg||'Unable to load data. Please try again.')+'</p><button onclick="loadProfProducts(_profAddress)" class="btn-primary text-sm mx-auto"><i class="fas fa-redo mr-1"></i> Retry</button></div>';
  }

  function profFilterProducts(f) {
    _profFilter=f;
    document.querySelectorAll('.ppf-btn').forEach(function(b){
      b.className='ppf-btn px-3 py-1.5 rounded-lg text-xs font-semibold '+(b.id==='ppf-'+f?'bg-red-600 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200');
    });
    renderProfProducts();
  }

  function renderProfProducts() {
    var container=document.getElementById('prof-products-container'); if(!container) return;
    if(_profProducts.length===0) {
      container.innerHTML='<div class="text-center py-12"><div class="empty-state"><i class="fas fa-store"></i><h3 class="font-bold text-slate-600 mb-2">You have no products yet</h3><p class="text-sm text-slate-400 mb-4">Start selling by listing your first product.</p><a href="/sell" class="btn-primary mx-auto"><i class="fas fa-plus-circle mr-1"></i> List a Product</a></div></div>';
      return;
    }
    var list=_profFilter==='all'?_profProducts:_profProducts.filter(function(p){return p.status===_profFilter;});
    if(!list.length){ container.innerHTML='<div class="text-center py-10 text-slate-400 text-sm"><i class="fas fa-filter mr-2"></i>No <strong>'+_profFilter+'</strong> products found.</div>'; return; }
    container.innerHTML='<div class="overflow-x-auto"><table class="w-full text-sm border-collapse"><thead><tr class="border-b border-slate-100"><th class="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Product</th><th class="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Price</th><th class="text-center py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th><th class="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th></tr></thead><tbody>'
    +list.map(function(p){
      var badge=p.status==='active'?'<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>':'<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Paused</span>';
      var imgEl=p.image?'<img src="'+p.image+'" class="w-9 h-9 rounded-lg object-cover mr-2 shrink-0" onerror="this.style.display=&quot;none&quot;">':'<div class="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center mr-2 shrink-0"><i class="fas fa-image text-slate-300 text-xs"></i></div>';
      var actionBtns='<button data-action="edit" data-pid="'+p.id+'" class="text-blue-600 hover:text-blue-800 text-xs font-semibold px-2 py-1 rounded hover:bg-blue-50"><i class="fas fa-edit mr-1"></i>Edit</button>';
      if(p.status==='active') actionBtns+='<button data-action="pause" data-pid="'+p.id+'" class="text-amber-600 hover:text-amber-800 text-xs font-semibold px-2 py-1 rounded hover:bg-amber-50"><i class="fas fa-pause mr-1"></i>Pause</button>';
      if(p.status==='paused') actionBtns+='<button data-action="resume" data-pid="'+p.id+'" class="text-green-600 hover:text-green-800 text-xs font-semibold px-2 py-1 rounded hover:bg-green-50"><i class="fas fa-play mr-1"></i>Resume</button>';
      actionBtns+='<a href="/product/'+p.id+'" class="text-slate-500 hover:text-slate-700 text-xs font-semibold px-2 py-1 rounded hover:bg-slate-50"><i class="fas fa-eye mr-1"></i>View</a>';
      actionBtns+='<button data-action="delete" data-pid="'+p.id+'" class="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1 rounded hover:bg-red-50"><i class="fas fa-trash mr-1"></i>Delete</button>';
      return '<tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors"><td class="py-3 px-2"><div class="flex items-center">'+imgEl+'<div><p class="font-semibold text-slate-800 text-xs leading-tight max-w-xs line-clamp-2">'+((p.title||'Untitled').replace(/</g,'&lt;'))+'</p><p class="text-slate-400 text-xs font-mono">'+p.id+'</p></div></div></td><td class="py-3 px-2 text-right font-bold text-red-600 whitespace-nowrap">'+parseFloat(p.price||0).toFixed(2)+' <span class="text-xs font-normal text-slate-500">'+(p.token||'USDC')+'</span></td><td class="py-3 px-2 text-center">'+badge+'</td><td class="py-3 px-2 text-right"><div class="flex items-center justify-end gap-1 flex-wrap">'+actionBtns+'</div></td></tr>';
    }).join('')+'</tbody></table></div>';
    container.querySelectorAll('[data-action]').forEach(function(btn){
      btn.addEventListener('click',function(){
        var action=this.getAttribute('data-action'); var pid=this.getAttribute('data-pid');
        if(action==='edit')   profOpenEdit(pid);
        if(action==='pause')  profPauseProduct(pid);
        if(action==='resume') profResumeProduct(pid);
        if(action==='delete') profDeleteProduct(pid);
      });
    });
  }

  // ── Edit modal ────────────────────────────────────────────────────
  // ── Image upload helpers for edit modal ─────────────────────────────
  var _peditImageDataUrl = null; // holds base64 data URL if file was uploaded

  function peditShowPreview(src){
    var wrap = document.getElementById('pedit-img-preview-wrap');
    var img  = document.getElementById('pedit-img-preview');
    var zone = document.getElementById('pedit-drop-zone');
    if(!src){ peditClearImage(); return; }
    if(wrap) wrap.classList.remove('hidden');
    if(img)  img.src = src;
    if(zone) zone.classList.add('hidden');
  }
  function peditClearImage(){
    _peditImageDataUrl = null;
    var wrap = document.getElementById('pedit-img-preview-wrap');
    var img  = document.getElementById('pedit-img-preview');
    var zone = document.getElementById('pedit-drop-zone');
    var urlInput = document.getElementById('pedit-image');
    if(wrap) wrap.classList.add('hidden');
    if(img)  img.src = '';
    if(zone) zone.classList.remove('hidden');
    if(urlInput) urlInput.value = '';
  }
  function peditSyncUrlPreview(url){
    _peditImageDataUrl = null; // URL takes precedence over file
    if(url && url.startsWith('http')){ peditShowPreview(url); }
    else if(!url){ var wrap=document.getElementById('pedit-img-preview-wrap'); if(wrap) wrap.classList.add('hidden'); document.getElementById('pedit-drop-zone').classList.remove('hidden'); }
  }
  function peditInitFileInput(){
    var inp = document.getElementById('pedit-file-input');
    if(!inp || inp._peditBound) return;
    inp._peditBound = true;
    inp.addEventListener('change', function(){
      var file = this.files[0];
      if(!file) return;
      if(!['image/jpeg','image/png'].includes(file.type)){ showToast('Only JPEG and PNG images accepted','error'); return; }
      if(file.size > 5*1024*1024){ showToast('Image must be under 5 MB','error'); return; }
      var reader = new FileReader();
      reader.onload = function(e){
        _peditImageDataUrl = e.target.result;
        document.getElementById('pedit-image').value = '';
        peditShowPreview(_peditImageDataUrl);
      };
      reader.readAsDataURL(file);
    });
    // Drag and drop on drop zone
    var zone = document.getElementById('pedit-drop-zone');
    if(zone){
      zone.addEventListener('dragover', function(e){ e.preventDefault(); this.style.borderColor='#dc2626'; this.style.background='rgba(220,38,38,.03)'; });
      zone.addEventListener('dragleave', function(){ this.style.borderColor=''; this.style.background=''; });
      zone.addEventListener('drop', function(e){
        e.preventDefault(); this.style.borderColor=''; this.style.background='';
        var file = e.dataTransfer.files[0];
        if(!file) return;
        if(!['image/jpeg','image/png'].includes(file.type)){ showToast('Only JPEG and PNG images accepted','error'); return; }
        if(file.size > 5*1024*1024){ showToast('Image must be under 5 MB','error'); return; }
        var reader = new FileReader();
        reader.onload = function(ev){ _peditImageDataUrl = ev.target.result; document.getElementById('pedit-image').value=''; peditShowPreview(_peditImageDataUrl); };
        reader.readAsDataURL(file);
      });
    }
  }

  function profOpenEdit(productId) {
    var wallet=(typeof getStoredWallet==='function')?getStoredWallet():null;
    if(!wallet){showToast('Connect wallet first','error');return;}
    var p=_profProducts.find(function(x){return x.id===productId;});
    if(!p){showToast('Product not found','error');return;}
    if(p.seller_id.toLowerCase()!==wallet.address.toLowerCase()){showToast('Unauthorized','error');return;}
    _peditImageDataUrl = null;
    document.getElementById('pedit-id').value=p.id;
    document.getElementById('pedit-title').value=p.title||'';
    document.getElementById('pedit-description').value=p.description||'';
    document.getElementById('pedit-price').value=p.price||'';
    document.getElementById('pedit-token').value=p.token||'USDC';
    document.getElementById('pedit-image').value=p.image||'';
    // Show current image preview if available
    if(p.image){ peditShowPreview(p.image); } else { peditClearImage(); }
    document.getElementById('prof-edit-modal').style.display='flex';
    peditInitFileInput();
  }
  function profCloseEdit() { document.getElementById('prof-edit-modal').style.display='none'; peditClearImage(); }

  async function profSaveProduct(e) {
    e.preventDefault();
    var wallet=(typeof getStoredWallet==='function')?getStoredWallet():null;
    if(!wallet){showToast('Connect wallet first','error');return;}
    var id=document.getElementById('pedit-id').value;
    var title=document.getElementById('pedit-title').value.trim();
    var desc=document.getElementById('pedit-description').value.trim();
    var price=parseFloat(document.getElementById('pedit-price').value);
    var token=document.getElementById('pedit-token').value;
    var urlInput=document.getElementById('pedit-image').value.trim();
    var image=(_peditImageDataUrl || urlInput || '');
    if(!title||!desc||isNaN(price)||price<=0){showToast('Please fill in all required fields correctly','error');return;}
    var btn=document.getElementById('pedit-save-btn');
    btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i> Saving\u2026';
    try {
      var ctrl2=new AbortController(); var t2=setTimeout(function(){ctrl2.abort();},10000);
      var res=await fetch('/api/products/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({seller_id:wallet.address,title:title,description:desc,price:price,token:token,image:image}),signal:ctrl2.signal});
      clearTimeout(t2);
      var data=await res.json();
      if(!res.ok){showToast(data.error||'Failed to update product','error');return;}
      showToast('Product updated successfully','success');
      profCloseEdit();
      await loadProfProducts(wallet.address);
    } catch(err){ showToast(err&&err.message?err.message:'Network error. Please try again.','error'); }
    finally{ btn.disabled=false; btn.innerHTML='<i class="fas fa-save mr-1"></i> Save Changes'; }
  }

  // ── Product actions ───────────────────────────────────────────────
  async function profPauseProduct(productId) {
    if(!confirm('Pause this listing? It will be hidden from the marketplace.')) return;
    var wallet=(typeof getStoredWallet==='function')?getStoredWallet():null;
    if(!wallet){showToast('Connect wallet first','error');return;}
    try {
      var ctrl3=new AbortController(); var t3=setTimeout(function(){ctrl3.abort();},10000);
      var res=await fetch('/api/products/'+productId+'/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({seller_id:wallet.address,status:'paused'}),signal:ctrl3.signal});
      clearTimeout(t3); var data=await res.json();
      if(!res.ok){showToast(data.error||'Failed','error');return;}
      showToast('Listing paused','info'); await loadProfProducts(wallet.address);
    } catch(e){showToast('Network error. Please try again.','error');}
  }

  async function profResumeProduct(productId) {
    if(!confirm('Resume this listing? It will be visible in the marketplace again.')) return;
    var wallet=(typeof getStoredWallet==='function')?getStoredWallet():null;
    if(!wallet){showToast('Connect wallet first','error');return;}
    try {
      var ctrl4=new AbortController(); var t4=setTimeout(function(){ctrl4.abort();},10000);
      var res=await fetch('/api/products/'+productId+'/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({seller_id:wallet.address,status:'active'}),signal:ctrl4.signal});
      clearTimeout(t4); var data=await res.json();
      if(!res.ok){showToast(data.error||'Failed','error');return;}
      showToast('Listing is now active','success'); await loadProfProducts(wallet.address);
    } catch(e){showToast('Network error. Please try again.','error');}
  }

  async function profDeleteProduct(productId) {
    if(!confirm('Delete this product permanently? This cannot be undone.')) return;
    var wallet=(typeof getStoredWallet==='function')?getStoredWallet():null;
    if(!wallet){showToast('Connect wallet first','error');return;}
    try {
      var ctrl5=new AbortController(); var t5=setTimeout(function(){ctrl5.abort();},10000);
      var res=await fetch('/api/products/'+productId,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({seller_id:wallet.address}),signal:ctrl5.signal});
      clearTimeout(t5); var data=await res.json();
      if(!res.ok){showToast(data.error||'Failed','error');return;}
      showToast('Product deleted','success'); await loadProfProducts(wallet.address);
    } catch(e){showToast('Network error. Please try again.','error');}
  }

  // Close modal on backdrop click
  document.getElementById('prof-edit-modal').addEventListener('click', function(e) { if(e.target===this) profCloseEdit(); });
  </script>
  `)
}

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

    <!-- Seller purchase notifications (injected by SellerNotify.renderList) -->
    <div id="seller-notif-section"></div>

    <!-- Buyer / order-status notifications -->
    <div id="notif-list">
      <div class="text-center py-8"><div class="loading-spinner-lg mx-auto mb-4"></div><p class="text-slate-400">Loading…</p></div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const w=getStoredWallet();
    const container=document.getElementById('notif-list');
    const sellerSection=document.getElementById('seller-notif-section');
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const notifs=[];

    // ── Seller purchase notifications (via SellerNotify module) ──────────────
    if(typeof SellerNotify !== 'undefined') {
      SellerNotify.markAllRead();   // opening the page marks all as read
      SellerNotify.renderList(sellerSection, w ? w.address : null);
    }

    // ── Buyer order-status notifications (existing logic, unchanged) ──────────
    if(w){
      const myOrders=orders.filter(o=>o.buyerAddress&&o.buyerAddress.toLowerCase()===w.address.toLowerCase());
      myOrders.slice(-5).reverse().forEach(o=>{
        notifs.push({icon:'fas fa-lock',color:'bg-yellow-100 text-yellow-600',title:'Escrow Created',msg:'Order '+o.id+' locked on Arc Network',time:new Date(o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='shipped') notifs.push({icon:'fas fa-shipping-fast',color:'bg-blue-100 text-blue-600',title:'Order Shipped',msg:'Order '+o.id+' has been shipped',time:new Date(o.updatedAt||o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='completed') notifs.push({icon:'fas fa-check-circle',color:'bg-green-100 text-green-600',title:'Escrow Released',msg:'Funds released for order '+o.id,time:new Date(o.updatedAt||o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='dispute') notifs.push({icon:'fas fa-gavel',color:'bg-red-100 text-red-600',title:'Dispute Opened',msg:'Dispute opened for order '+o.id+'. Funds locked.',time:new Date(o.disputedAt||o.createdAt).toLocaleString(),url:'/disputes'});
      });
    }

    // Check if we have seller notifs to decide on empty state
    const hasSellerNotifs = sellerSection && sellerSection.children.length > 0;

    if(!notifs.length && !hasSellerNotifs){
      container.innerHTML='<div class="card p-12 text-center"><div class="empty-state"><i class="fas fa-bell-slash"></i><h3 class="font-bold text-slate-600 mb-2">No Notifications</h3><p class="text-sm">Notifications are triggered by real Arc Network events — escrow creation, shipments, and releases.</p></div></div>';
      return;
    }
    if(!notifs.length){ container.innerHTML=''; return; }

    container.innerHTML=notifs.map(n=>
      '<a href="'+(n.url||'#')+'" class="notification-item flex items-start gap-4 cursor-pointer hover:bg-red-50 transition-colors block">'
      +'<div class="w-10 h-10 rounded-full '+n.color+' flex items-center justify-center shrink-0"><i class="'+n.icon+' text-sm"></i></div>'
      +'<div class="flex-1"><p class="font-semibold text-slate-800 text-sm">'+n.title+'</p>'
      +'<p class="text-slate-500 text-xs">'+n.msg+'</p>'
      +'<p class="text-slate-300 text-xs mt-1">'+n.time+'</p></div>'
      +'<div class="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div></a>'
    ).join('');
  });
  function clearNotifs(){
    showToast('All notifications marked as read','info');
    document.querySelectorAll('.notification-item .rounded-full.bg-red-500').forEach(el=>el.remove());
    document.querySelectorAll('.sn-ni-unread').forEach(el=>el.remove());
    if(typeof SellerNotify!=='undefined') SellerNotify.markAllRead();
  }
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
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Shukly Store",
    "description": "Testnet-only application built on Arc Network for experimental and development purposes. No real financial transactions or assets involved.",
    "applicationCategory": "FinanceApplication",
    "operatingSystem": "Web",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    }
  })

  return shell('About Us', `
  <!-- ── About Us Page ─────────────────────────────────────────────── -->
  <div class="max-w-4xl mx-auto px-4 py-10">

    <!-- ── Hero banner ─────────────────────────────────────────────── -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:24px;padding:48px 40px;margin-bottom:32px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:-40px;right:-40px;width:220px;height:220px;background:radial-gradient(circle,rgba(220,38,38,.18) 0%,transparent 70%);pointer-events:none;"></div>
      <div style="position:absolute;bottom:-30px;left:-30px;width:160px;height:160px;background:radial-gradient(circle,rgba(245,158,11,.1) 0%,transparent 70%);pointer-events:none;"></div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;position:relative;">
        <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#dc2626,#991b1b);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(220,38,38,.35);flex-shrink:0;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
        </div>
        <div>
          <h1 style="font-size:2rem;font-weight:900;color:#fff;margin:0;line-height:1.1;">About Us</h1>
          <p style="color:#94a3b8;font-size:.9rem;margin:4px 0 0;">Shukly Store · Testnet Application on Arc Network</p>
        </div>
      </div>
      <!-- Trust badge strip -->
      <div style="display:flex;flex-wrap:wrap;gap:10px;position:relative;">
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);color:#4ade80;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-flask"></i> Testnet Environment Only
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:#60a5fa;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-shield-alt"></i> Security-Focused Development
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.25);color:#c084fc;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-wallet"></i> Non-Custodial
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.25);color:#fbbf24;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-ban"></i> No Real Assets
        </span>
      </div>
    </div>

    <!-- ── Important notice ─────────────────────────────────────────── -->
    <div class="card p-5 mb-6" style="background:#fffbeb;border:1.5px solid #fde68a;">
      <div class="flex items-start gap-3">
        <i class="fas fa-exclamation-triangle text-amber-500 text-xl mt-0.5 shrink-0"></i>
        <div>
          <p class="font-bold text-amber-800 text-sm mb-1">Important Notice — Testnet Environment</p>
          <p class="text-amber-700 text-sm leading-relaxed">
            This platform operates exclusively within a <strong>testnet environment</strong> using Arc Network's test infrastructure.
            <strong>No real funds</strong> are involved at any point. All balances, assets, and transactions are simulated or
            testnet-based only. This is strictly an experimental and development platform.
          </p>
        </div>
      </div>
    </div>

    <!-- ── Main grid ────────────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:1fr;gap:24px;">

      <!-- About the Platform -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-info-circle text-blue-600"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">About This Platform</h2>
        </div>
        <div style="space-y:12px">
          <p class="text-slate-600 text-sm leading-relaxed mb-3">
            Shukly Store was built by an <strong>independent developer</strong> using the <strong>Arc Network</strong> — Circle's
            stablecoin-native Layer 1 blockchain. The purpose of this website is strictly for
            <strong>testing and experimental use only</strong>.
          </p>
          <p class="text-slate-600 text-sm leading-relaxed mb-3">
            The platform operates exclusively on the <strong>Arc Network testnet</strong> (Chain ID: 5042002).
            No real funds are involved. No real financial transactions occur.
            All balances, assets, and interactions are <strong>simulated or testnet-based only</strong>.
          </p>
          <p class="text-slate-600 text-sm leading-relaxed">
            This website was developed using <strong>Genspark</strong>, with a strong focus on
            <strong>performance and security</strong>. The platform includes protection against attacks,
            exploits, and malicious activity.
          </p>
        </div>
        <!-- Info chips -->
        <div class="flex flex-wrap gap-2 mt-4">
          <span class="tag"><i class="fas fa-network-wired mr-1"></i>Arc Testnet · Chain 5042002</span>
          <span class="tag"><i class="fas fa-code mr-1"></i>Built with Genspark</span>
          <span class="tag"><i class="fas fa-lock mr-1"></i>Non-custodial wallet</span>
        </div>
      </section>

      <!-- Two-column grid for medium+ screens -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;">

        <!-- Security & Transparency -->
        <section class="card p-6">
          <div class="flex items-center gap-3 mb-4">
            <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#dcfce7,#bbf7d0);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-shield-alt text-green-600"></i>
            </div>
            <h2 class="text-lg font-bold text-slate-800 m-0">Security &amp; Transparency</h2>
          </div>
          <ul class="space-y-3 text-sm text-slate-600" style="list-style:none;padding:0;margin:0;">
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">No storage of sensitive user data</strong> — we do not collect, store, or transmit private keys or personal information.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">No automatic wallet transactions</strong> — every on-chain action requires explicit user confirmation.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Users have full control of their wallets</strong> — private keys are generated client-side and never leave your device.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Platform is for testing and demo purposes only</strong> — not a commercial service.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Security-focused development</strong> — HTTP security headers, CSP, HSTS, and anti-abuse measures active.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Protection against attacks &amp; exploits</strong> — malicious activity is monitored and blocked.</span>
            </li>
          </ul>
        </section>

        <!-- Compliance & Trust -->
        <section class="card p-6">
          <div class="flex items-center gap-3 mb-4">
            <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#fce7f3,#fbcfe8);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-certificate text-pink-600"></i>
            </div>
            <h2 class="text-lg font-bold text-slate-800 m-0">Compliance &amp; Trust</h2>
          </div>
          <div class="space-y-3 text-sm text-slate-600">
            <div class="flex items-start gap-2.5">
              <i class="fas fa-flask text-purple-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">Testnet environment</strong><br/>Operates exclusively on Arc Network testnet. No mainnet activity occurs.</div>
            </div>
            <div class="flex items-start gap-2.5">
              <i class="fas fa-ban text-red-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">No real assets</strong><br/>All USDC/EURC balances are testnet tokens with no monetary value.</div>
            </div>
            <div class="flex items-start gap-2.5">
              <i class="fas fa-user-shield text-blue-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">Non-custodial architecture</strong><br/>We have zero access to user funds or private keys at any time.</div>
            </div>
            <div class="flex items-start gap-2.5">
              <i class="fas fa-code-branch text-green-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">Open source</strong><br/>Source code is publicly available for independent review and audit.</div>
            </div>
          </div>
        </section>
      </div>

      <!-- Technology Stack -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-5">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#e0e7ff,#c7d2fe);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-layer-group text-indigo-600"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">Technology Stack</h2>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
          ${[
            { icon:'fas fa-network-wired', color:'#3b82f6', label:'Blockchain', value:'Arc Network Testnet (EVM)' },
            { icon:'fas fa-coins',          color:'#f59e0b', label:'Payments',   value:'USDC & EURC (testnet)' },
            { icon:'fas fa-file-contract',  color:'#8b5cf6', label:'Escrow',     value:'ShuklyEscrow Smart Contract' },
            { icon:'fas fa-wallet',         color:'#10b981', label:'Wallet',     value:'Non-custodial · BIP39 · ethers.js' },
            { icon:'fas fa-server',         color:'#ef4444', label:'Backend',    value:'Hono.js · Cloudflare Workers' },
            { icon:'fas fa-shield-alt',     color:'#ec4899', label:'Security',   value:'CSP · HSTS · Permissions-Policy' },
          ].map(t => `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:#f8fafc;border-radius:12px;border:1px solid #f1f5f9;">
              <div style="width:32px;height:32px;border-radius:8px;background:${t.color}1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="${t.icon}" style="color:${t.color};font-size:.8rem;"></i>
              </div>
              <div>
                <p style="font-size:.7rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:0 0 2px;">${t.label}</p>
                <p style="font-size:.8rem;color:#334155;font-weight:500;margin:0;">${t.value}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- Smart Contracts -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-file-code text-emerald-600"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">Smart Contracts — Arc Testnet</h2>
        </div>
        <div class="space-y-2">
          ${[
            { label: 'USDC (native)',    addr: '${ARC.contracts.USDC}' },
            { label: 'EURC (ERC-20)',    addr: '${ARC.contracts.EURC}' },
            { label: 'ShuklyEscrow',     addr: '0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511' },
          ].map(c => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#f8fafc;border-radius:10px;border:1px solid #f1f5f9;flex-wrap:wrap;">
              <span style="font-size:.8rem;font-weight:600;color:#475569;min-width:100px;">${c.label}</span>
              <code style="font-size:.7rem;color:#64748b;font-family:monospace;word-break:break-all;">${c.addr}</code>
              <a href="https://testnet.arcscan.app/address/${c.addr}" target="_blank"
                 style="font-size:.7rem;color:#dc2626;text-decoration:none;white-space:nowrap;flex-shrink:0;">
                <i class="fas fa-external-link-alt"></i> ArcScan
              </a>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- Open Source & Links -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f1f5f9,#e2e8f0);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fab fa-github text-slate-700"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">Open Source</h2>
        </div>
        <p class="text-slate-600 text-sm leading-relaxed mb-4">
          The complete source code of Shukly Store is publicly available for inspection, audit, and contribution.
          Transparency is a core principle of this project.
        </p>
        <div class="flex flex-wrap gap-3">
          <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="btn-primary text-sm">
            <i class="fab fa-github"></i> View on GitHub
          </a>
          <a href="https://testnet.arcscan.app" target="_blank" class="btn-secondary text-sm">
            <i class="fas fa-search"></i> Arc Explorer
          </a>
          <a href="https://faucet.circle.com" target="_blank" class="btn-secondary text-sm">
            <i class="fas fa-faucet"></i> Get Test USDC
          </a>
          <a href="/terms" class="btn-secondary text-sm">
            <i class="fas fa-file-alt"></i> Terms
          </a>
          <a href="/privacy" class="btn-secondary text-sm">
            <i class="fas fa-lock"></i> Privacy
          </a>
          <a href="/disclaimer" class="btn-secondary text-sm">
            <i class="fas fa-exclamation-triangle"></i> Disclaimer
          </a>
        </div>
      </section>

    </div><!-- /main grid -->
  </div>
  `,
  /* extraHead — JSON-LD + page-specific meta */
  `<!-- About page: override meta description and inject JSON-LD -->
  <meta name="description" content="Testnet-only platform built on Arc Network. No real funds, no financial risk. Designed for development and testing."/>
  <meta name="robots" content="index,follow"/>
  <meta name="keywords" content="testnet environment, no real assets, non-custodial, security-focused development, Arc Network, experimental platform, blockchain testing"/>
  <meta property="og:title" content="About Us | Shukly Store"/>
  <meta property="og:description" content="Testnet-only platform built on Arc Network. No real funds, no financial risk. Designed for development and testing."/>
  <meta property="og:url" content="https://shukly-store.pages.dev/about"/>
  <script type="application/ld+json">${jsonLd}</script>`)
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

// ─── PAGE: HOW TO USE ─────────────────────────────────────────────────────
function howToUsePage() {
  return shell('How to Use', `
  <div class="max-w-4xl mx-auto px-4 py-10">

    <!-- Hero -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:24px;padding:48px 40px;margin-bottom:32px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:-40px;right:-40px;width:220px;height:220px;background:radial-gradient(circle,rgba(220,38,38,.18) 0%,transparent 70%);pointer-events:none;"></div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;position:relative;">
        <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#dc2626,#991b1b);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(220,38,38,.35);">
          <i class="fas fa-book-open" style="color:#fff;font-size:22px;"></i>
        </div>
        <div>
          <h1 style="font-size:2rem;font-weight:900;color:#fff;margin:0;line-height:1.1;">How to Use Shukly Store</h1>
          <p style="color:#94a3b8;font-size:.9rem;margin:4px 0 0;">Complete guide — from wallet setup to dispute resolution</p>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;position:relative;">
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);color:#4ade80;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-flask"></i> Testnet Only
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:#60a5fa;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-shield-alt"></i> Non-Custodial
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.25);color:#fbbf24;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-wallet"></i> MetaMask Required
        </span>
      </div>
    </div>

    <!-- Video -->
    <div class="card p-6 mb-8">
      <h2 class="text-xl font-bold text-slate-800 mb-3 flex items-center gap-2">
        <i class="fas fa-play-circle text-red-500"></i> Video Walkthrough
      </h2>
      <p class="text-slate-500 text-sm mb-4">Watch the full step-by-step demo below:</p>
      <div style="position:relative;padding-bottom:56.25%;height:0;border-radius:14px;overflow:hidden;background:#000;">
        <iframe
          src="https://www.youtube-nocookie.com/embed/Fgm7-F2JvNo"
          title="Shukly Store Walkthrough"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:14px;">
        </iframe>
      </div>
    </div>

    <!-- Requirements -->
    <div class="card p-6 mb-8" style="background:#fffbeb;border:1.5px solid #fde68a;">
      <h2 class="text-xl font-bold text-amber-800 mb-4 flex items-center gap-2">
        <i class="fas fa-list-check text-amber-500"></i> Requirements
      </h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
        <div style="background:#fff;border-radius:10px;padding:14px;border:1px solid #fde68a;">
          <div style="width:36px;height:36px;background:#fef3c7;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
            <i class="fas fa-wallet text-amber-600"></i>
          </div>
          <p class="font-bold text-slate-800 text-sm mb-1">MetaMask Wallet</p>
          <p class="text-slate-500 text-xs">Install MetaMask browser extension or use Brave's built-in wallet.</p>
        </div>
        <div style="background:#fff;border-radius:10px;padding:14px;border:1px solid #fde68a;">
          <div style="width:36px;height:36px;background:#fef3c7;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
            <i class="fas fa-coins text-amber-600"></i>
          </div>
          <p class="font-bold text-slate-800 text-sm mb-1">Testnet USDC/EURC</p>
          <p class="text-slate-500 text-xs">Get free testnet tokens from <a href="https://faucet.circle.com" target="_blank" class="text-blue-600 hover:underline">Circle Faucet</a>.</p>
        </div>
        <div style="background:#fff;border-radius:10px;padding:14px;border:1px solid #fde68a;">
          <div style="width:36px;height:36px;background:#fef3c7;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
            <i class="fas fa-network-wired text-amber-600"></i>
          </div>
          <p class="font-bold text-slate-800 text-sm mb-1">Arc Testnet</p>
          <p class="text-slate-500 text-xs">Network auto-added when you connect. Chain ID: 5042002.</p>
        </div>
        <div style="background:#fff;border-radius:10px;padding:14px;border:1px solid #fde68a;">
          <div style="width:36px;height:36px;background:#fef3c7;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
            <i class="fas fa-desktop text-amber-600"></i>
          </div>
          <p class="font-bold text-slate-800 text-sm mb-1">Modern Browser</p>
          <p class="text-slate-500 text-xs">Chrome, Brave, Firefox or Edge (latest version recommended).</p>
        </div>
      </div>
    </div>

    <!-- Step by step -->
    <div class="card p-6 mb-8">
      <h2 class="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
        <i class="fas fa-route text-red-500"></i> Step-by-Step Guide
      </h2>

      <div style="display:flex;flex-direction:column;gap:0;">

        <!-- Step 1 -->
        <div style="display:flex;gap:16px;margin-bottom:28px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0;">1</div>
            <div style="width:2px;flex:1;background:#fee2e2;margin-top:6px;"></div>
          </div>
          <div style="padding-bottom:20px;flex:1;">
            <h3 class="font-bold text-slate-800 text-base mb-2">Connect Your Wallet</h3>
            <p class="text-slate-600 text-sm mb-3">Click <strong>Connect Wallet</strong> in the top-right of the page. MetaMask will prompt you to add the Arc Testnet automatically. Approve the network switch.</p>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;padding:10px 12px;">
              <p class="text-green-800 text-xs font-semibold"><i class="fas fa-lightbulb mr-1"></i> Tip: Brave users — use Brave Wallet or enable MetaMask. Both are supported.</p>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div style="display:flex;gap:16px;margin-bottom:28px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0;">2</div>
            <div style="width:2px;flex:1;background:#fee2e2;margin-top:6px;"></div>
          </div>
          <div style="padding-bottom:20px;flex:1;">
            <h3 class="font-bold text-slate-800 text-base mb-2">Get Testnet Tokens</h3>
            <p class="text-slate-600 text-sm mb-3">Visit the <a href="https://faucet.circle.com" target="_blank" class="text-red-600 hover:underline font-semibold">Circle Faucet</a> and request free testnet USDC on the Arc Testnet chain. Tokens arrive in seconds.</p>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:9px;padding:10px 12px;">
              <p class="text-blue-800 text-xs font-semibold"><i class="fas fa-info-circle mr-1"></i> These are testnet tokens — no real value. Safe to use for testing.</p>
            </div>
          </div>
        </div>

        <!-- Step 3 -->
        <div style="display:flex;gap:16px;margin-bottom:28px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0;">3</div>
            <div style="width:2px;flex:1;background:#fee2e2;margin-top:6px;"></div>
          </div>
          <div style="padding-bottom:20px;flex:1;">
            <h3 class="font-bold text-slate-800 text-base mb-2">Browse &amp; Buy</h3>
            <p class="text-slate-600 text-sm mb-3">Go to the <a href="/marketplace" class="text-red-600 hover:underline font-semibold">Marketplace</a>, browse products, add to cart, and proceed to checkout. The escrow contract will lock your payment until delivery is confirmed.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div style="background:#f8fafc;border-radius:8px;padding:10px;border:1px solid #e2e8f0;">
                <p class="text-xs font-bold text-slate-700 mb-1"><i class="fas fa-lock mr-1 text-red-500"></i> Escrow Protection</p>
                <p class="text-xs text-slate-500">Funds locked until you confirm receipt.</p>
              </div>
              <div style="background:#f8fafc;border-radius:8px;padding:10px;border:1px solid #e2e8f0;">
                <p class="text-xs font-bold text-slate-700 mb-1"><i class="fas fa-shield-alt mr-1 text-green-500"></i> Non-Custodial</p>
                <p class="text-xs text-slate-500">Only you and the smart contract hold funds.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 4 -->
        <div style="display:flex;gap:16px;margin-bottom:28px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0;">4</div>
            <div style="width:2px;flex:1;background:#fee2e2;margin-top:6px;"></div>
          </div>
          <div style="padding-bottom:20px;flex:1;">
            <h3 class="font-bold text-slate-800 text-base mb-2">Sell Products</h3>
            <p class="text-slate-600 text-sm mb-3">Go to <a href="/sell" class="text-red-600 hover:underline font-semibold">Sell</a>, fill in product details, price in USDC/EURC, and publish. Manage your listings in <a href="/profile?tab=products" class="text-red-600 hover:underline font-semibold">My Profile → My Products</a>.</p>
          </div>
        </div>

        <!-- Step 5 -->
        <div style="display:flex;gap:16px;margin-bottom:28px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0;">5</div>
            <div style="width:2px;flex:1;background:#fee2e2;margin-top:6px;"></div>
          </div>
          <div style="padding-bottom:20px;flex:1;">
            <h3 class="font-bold text-slate-800 text-base mb-2">Track Orders</h3>
            <p class="text-slate-600 text-sm mb-3">Visit <a href="/orders" class="text-red-600 hover:underline font-semibold">My Orders</a> to track the status of your purchases. Confirm delivery to release funds to the seller.</p>
          </div>
        </div>

        <!-- Step 6 -->
        <div style="display:flex;gap:16px;margin-bottom:8px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0;">6</div>
          </div>
          <div style="flex:1;">
            <h3 class="font-bold text-slate-800 text-base mb-2">Open a Dispute</h3>
            <p class="text-slate-600 text-sm mb-3">If there's an issue with an order, open a dispute from the Order Detail page. Submit evidence (text, images, links), chat with the other party, and await resolution. Auto-resolution rules apply after deadlines expire.</p>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:10px 12px;">
              <p class="text-red-800 text-xs font-semibold"><i class="fas fa-clock mr-1"></i> Seller has 48h to respond. Buyer has 72h to submit evidence. Inactivity auto-resolves after 120h.</p>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- FAQ -->
    <div class="card p-6 mb-8">
      <h2 class="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
        <i class="fas fa-question-circle text-red-500"></i> FAQ
      </h2>
      <div style="display:flex;flex-direction:column;gap:12px;" id="faq-list">
        <details style="border:1px solid #e2e8f0;border-radius:10px;padding:0;overflow:hidden;">
          <summary style="padding:12px 16px;cursor:pointer;font-weight:600;color:#1e293b;font-size:14px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
            Is my money safe? <i class="fas fa-chevron-down text-slate-400"></i>
          </summary>
          <div style="padding:10px 16px 14px;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b;line-height:1.6;">
            Yes. This is a testnet environment — no real money is involved. All funds are simulated testnet tokens locked in a smart contract escrow on Arc Testnet.
          </div>
        </details>
        <details style="border:1px solid #e2e8f0;border-radius:10px;padding:0;overflow:hidden;">
          <summary style="padding:12px 16px;cursor:pointer;font-weight:600;color:#1e293b;font-size:14px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
            Why does MetaMask show Arc Testnet? <i class="fas fa-chevron-down text-slate-400"></i>
          </summary>
          <div style="padding:10px 16px 14px;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b;line-height:1.6;">
            Shukly Store runs on Arc Testnet (Chain ID 5042002). When you connect, the network is added automatically via MetaMask's <code>wallet_addEthereumChain</code> API.
          </div>
        </details>
        <details style="border:1px solid #e2e8f0;border-radius:10px;padding:0;overflow:hidden;">
          <summary style="padding:12px 16px;cursor:pointer;font-weight:600;color:#1e293b;font-size:14px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
            What happens if a seller doesn't respond to a dispute? <i class="fas fa-chevron-down text-slate-400"></i>
          </summary>
          <div style="padding:10px 16px 14px;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b;line-height:1.6;">
            The auto-resolution system detects inactivity. If the seller doesn't respond within 48 hours, the system marks the dispute as auto-refundable to the buyer.
          </div>
        </details>
        <details style="border:1px solid #e2e8f0;border-radius:10px;padding:0;overflow:hidden;">
          <summary style="padding:12px 16px;cursor:pointer;font-weight:600;color:#1e293b;font-size:14px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
            Can I use Brave browser? <i class="fas fa-chevron-down text-slate-400"></i>
          </summary>
          <div style="padding:10px 16px 14px;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b;line-height:1.6;">
            Yes! Brave's built-in wallet and MetaMask extension both work. If you experience issues, try disabling Brave Shields for this site.
          </div>
        </details>
      </div>
    </div>

    <!-- CTA -->
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;padding:8px 0 24px;">
      <a href="/marketplace" class="btn-primary"><i class="fas fa-shopping-bag mr-2"></i>Start Shopping</a>
      <a href="/sell" class="btn-secondary"><i class="fas fa-store mr-2"></i>Start Selling</a>
      <a href="/wallet" class="btn-secondary"><i class="fas fa-wallet mr-2"></i>Connect Wallet</a>
    </div>

  </div>
  `)
}

// ─── PAGE: ADMIN ──────────────────────────────────────────────────────────
function adminPage() {
  return shell('Admin Panel', `
  <div class="max-w-6xl mx-auto px-4 py-8" id="admin-root">

    <!-- Access Blocked state (shown by default, JS removes if authorized) -->
    <div id="admin-blocked" style="display:none;text-align:center;padding:80px 20px;">
      <div style="width:64px;height:64px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
        <i class="fas fa-ban" style="color:#dc2626;font-size:26px;"></i>
      </div>
      <h2 style="font-size:22px;font-weight:800;color:#1e293b;margin:0 0 8px;">Access Denied</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 20px;">Your wallet is not authorized to access the admin panel.</p>
      <a href="/" class="btn-secondary">← Return Home</a>
    </div>

    <!-- Loading state -->
    <div id="admin-loading" style="text-align:center;padding:80px 20px;">
      <div class="loading-spinner-lg mx-auto mb-4"></div>
      <p class="text-slate-400">Checking authorization…</p>
    </div>

    <!-- Admin Panel (hidden until authorized) -->
    <div id="admin-panel" style="display:none;">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#dc2626,#991b1b);border-radius:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(220,38,38,.3);">
            <i class="fas fa-shield-alt" style="color:#fff;font-size:20px;"></i>
          </div>
          <div>
            <h1 style="margin:0;font-size:22px;font-weight:900;color:#1e293b;">Admin Panel</h1>
            <p style="margin:0;font-size:12px;color:#94a3b8;">Shukly Store · Restricted Access</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span id="admin-wallet-badge" style="font-size:11px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:5px 12px;font-family:monospace;color:#334155;"></span>
          <span style="font-size:11px;background:#dcfce7;color:#15803d;border-radius:8px;padding:5px 12px;font-weight:700;">✓ Authorized</span>
        </div>
      </div>

      <!-- Tab nav -->
      <div style="display:flex;gap:4px;background:#f1f5f9;border-radius:12px;padding:4px;margin-bottom:24px;flex-wrap:wrap;">
        <button onclick="adminTab('disputes')" id="atab-disputes" class="admin-tab active-tab"><i class="fas fa-gavel mr-1"></i>Disputes</button>
        <button onclick="adminTab('products')" id="atab-products" class="admin-tab"><i class="fas fa-boxes mr-1"></i>Products</button>
        <button onclick="adminTab('reports')" id="atab-reports" class="admin-tab"><i class="fas fa-flag mr-1"></i>Reports</button>
        <button onclick="adminTab('security')" id="atab-security" class="admin-tab"><i class="fas fa-lock mr-1"></i>Security Log</button>
        <button onclick="adminTab('whitelist')" id="atab-whitelist" class="admin-tab"><i class="fas fa-users mr-1"></i>Whitelist</button>
      </div>

      <!-- Tab: Disputes -->
      <div id="atab-content-disputes">
        <div class="card p-5">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;"><i class="fas fa-gavel text-red-500 mr-2"></i>All Disputes</h2>
            <button onclick="adminLoadDisputes()" class="btn-secondary text-xs py-1.5"><i class="fas fa-sync mr-1"></i>Refresh</button>
          </div>
          <div id="admin-disputes-table">
            <div style="text-align:center;padding:40px;color:#94a3b8;"><div class="loading-spinner-lg mx-auto mb-3"></div>Loading…</div>
          </div>
        </div>
      </div>

      <!-- Tab: Products -->
      <div id="atab-content-products" style="display:none;">
        <div class="card p-5">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;"><i class="fas fa-boxes text-red-500 mr-2"></i>Product Management</h2>
            <button onclick="adminLoadProducts()" class="btn-secondary text-xs py-1.5"><i class="fas fa-sync mr-1"></i>Refresh</button>
          </div>
          <div id="admin-products-table">
            <div style="text-align:center;padding:40px;color:#94a3b8;"><div class="loading-spinner-lg mx-auto mb-3"></div>Loading…</div>
          </div>
        </div>
      </div>

      <!-- Tab: Reports -->
      <div id="atab-content-reports" style="display:none;">
        <div class="card p-5">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;"><i class="fas fa-flag text-red-500 mr-2"></i>User Reports</h2>
            <button onclick="adminLoadReports()" class="btn-secondary text-xs py-1.5"><i class="fas fa-sync mr-1"></i>Refresh</button>
          </div>
          <div id="admin-reports-table">
            <div style="text-align:center;padding:40px;color:#94a3b8;"><div class="loading-spinner-lg mx-auto mb-3"></div>Loading…</div>
          </div>
        </div>
      </div>

      <!-- Tab: Security Log -->
      <div id="atab-content-security" style="display:none;">
        <div class="card p-5">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;"><i class="fas fa-shield-alt text-red-500 mr-2"></i>Security Log</h2>
            <button onclick="adminClearSecLog()" class="btn-secondary text-xs py-1.5 text-red-600"><i class="fas fa-trash mr-1"></i>Clear</button>
          </div>
          <div id="admin-security-log"></div>
        </div>
      </div>

      <!-- Tab: Whitelist -->
      <div id="atab-content-whitelist" style="display:none;">
        <div class="card p-5">
          <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 16px;"><i class="fas fa-users text-red-500 mr-2"></i>Admin Wallet Whitelist</h2>
          <div id="admin-whitelist-list" style="margin-bottom:16px;"></div>
          <div style="display:flex;gap:8px;">
            <input id="admin-wl-input" class="input flex-1" placeholder="0x… wallet address" />
            <button onclick="adminAddWhitelist()" class="btn-primary px-4"><i class="fas fa-plus mr-1"></i>Add</button>
          </div>
        </div>
      </div>

    </div><!-- /admin-panel -->
  </div>

  <style>
  .admin-tab{padding:7px 16px;border:none;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:#64748b;transition:all .2s}
  .admin-tab:hover{background:#fff;color:#334155}
  .admin-tab.active-tab{background:#fff;color:#dc2626;box-shadow:0 2px 6px rgba(0,0,0,.08)}
  .admin-tbl{width:100%;border-collapse:collapse;font-size:12px}
  .admin-tbl th{background:#f8fafc;color:#64748b;font-weight:700;padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;text-transform:uppercase;font-size:11px}
  .admin-tbl td{padding:10px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}
  .admin-tbl tr:hover td{background:#fafafa}
  .admin-action-btn{padding:4px 10px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer}
  .admin-refund-btn{background:#dbeafe;color:#1d4ed8}
  .admin-release-btn{background:#dcfce7;color:#15803d}
  .admin-remove-btn{background:#fee2e2;color:#dc2626}
  .admin-flag-btn{background:#fef3c7;color:#92400e}
  .admin-ban-btn{background:#fce7f3;color:#9d174d}
  .admin-ignore-btn{background:#f1f5f9;color:#64748b}
  .admin-sec-entry{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:12px}
  .admin-sec-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px}
  </style>

  <script>
  var ADMIN_WHITELIST_KEY = 'rh_admin_whitelist';
  var ADMIN_SECLOG_KEY    = 'rh_admin_seclog';
  var ADMIN_REPORTS_KEY   = 'rh_admin_reports';
  var _adminAuthorized    = false;

  function getAdminWhitelist() {
    try { return JSON.parse(localStorage.getItem(ADMIN_WHITELIST_KEY) || '[]'); } catch(e) { return []; }
  }
  function saveAdminWhitelist(list) { localStorage.setItem(ADMIN_WHITELIST_KEY, JSON.stringify(list)); }
  function getSecLog() {
    try { return JSON.parse(localStorage.getItem(ADMIN_SECLOG_KEY) || '[]'); } catch(e) { return []; }
  }
  function addSecLog(event, addr, detail) {
    var log = getSecLog();
    log.unshift({ ts: new Date().toISOString(), event: event, addr: addr || '—', detail: detail || '' });
    if (log.length > 200) log = log.slice(0, 200);
    localStorage.setItem(ADMIN_SECLOG_KEY, JSON.stringify(log));
  }
  function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function shortA(a) { if(!a||a.length<10) return a||'—'; return a.slice(0,8)+'…'+a.slice(-6); }

  function adminTab(tab) {
    ['disputes','products','reports','security','whitelist'].forEach(function(t) {
      var btn = document.getElementById('atab-'+t);
      var con = document.getElementById('atab-content-'+t);
      if(btn) btn.classList.toggle('active-tab', t===tab);
      if(con) con.style.display = t===tab ? '' : 'none';
    });
    if(tab==='disputes') adminLoadDisputes();
    if(tab==='products') adminLoadProducts();
    if(tab==='reports')  adminLoadReports();
    if(tab==='security') adminRenderSecLog();
    if(tab==='whitelist') adminRenderWhitelist();
  }

  /* ── Disputes ── */
  function adminLoadDisputes() {
    var el = document.getElementById('admin-disputes-table');
    if(!el) return;
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem('rh_orders')||'[]'); } catch(e){}
    var disputes = orders.filter(function(o){ return o.status==='dispute' || o.disputeResolution; });
    var meta = {};
    try { meta = JSON.parse(localStorage.getItem('rh_disputes_v2')||'{}'); } catch(e){}

    if(!disputes.length) {
      el.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:30px;">No disputes found.</p>';
      return;
    }
    var rows = disputes.map(function(d) {
      var dm = meta[d.id] || {};
      var status = dm.status || d.status || 'dispute';
      var ev = {}; try { ev = JSON.parse(localStorage.getItem('rh_dispute_evidence')||'{}')[d.id]||{buyer:[],seller:[]}; } catch(e){ ev={buyer:[],seller:[]}; }
      var bEv = (ev.buyer||[]).length, sEv = (ev.seller||[]).length;
      return '<tr>' +
        '<td style="font-family:monospace;">'+escH(d.id.slice(0,10))+'…</td>' +
        '<td style="font-family:monospace;">'+escH(shortA(d.buyerAddress))+'</td>' +
        '<td style="font-family:monospace;">'+escH(shortA(d.sellerAddress))+'</td>' +
        '<td><span style="background:#fee2e2;color:#dc2626;font-size:10px;padding:3px 7px;border-radius:6px;font-weight:700;">'+escH(status)+'</span></td>' +
        '<td>'+new Date(d.disputedAt||d.createdAt).toLocaleDateString()+'</td>' +
        '<td>'+escH(String(bEv))+'/'+escH(String(sEv))+'</td>' +
        '<td style="display:flex;gap:5px;flex-wrap:wrap;">' +
        '<button class="admin-action-btn admin-refund-btn" onclick="adminResolveDispute(\''+escH(d.id)+'\',\'refund\')">Refund</button>' +
        '<button class="admin-action-btn admin-release-btn" onclick="adminResolveDispute(\''+escH(d.id)+'\',\'release\')">Release</button>' +
        '<button class="admin-action-btn admin-flag-btn" onclick="adminForceResolve(\''+escH(d.id)+'\')">Force</button>' +
        '</td></tr>';
    }).join('');
    el.innerHTML = '<div style="overflow-x:auto;"><table class="admin-tbl"><thead><tr><th>Order</th><th>Buyer</th><th>Seller</th><th>Status</th><th>Date</th><th>Ev B/S</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  function adminResolveDispute(orderId, action) {
    if(!confirm('Resolve dispute #'+orderId+' — action: '+action+'?')) return;
    var orders = []; try { orders = JSON.parse(localStorage.getItem('rh_orders')||'[]'); } catch(e){}
    var idx = orders.findIndex(function(o){ return o.id===orderId; });
    if(idx<0) { alert('Order not found'); return; }
    orders[idx].status='completed'; orders[idx].disputeResolution=action; orders[idx].resolvedAt=new Date().toISOString();
    localStorage.setItem('rh_orders', JSON.stringify(orders));
    var meta = {}; try { meta = JSON.parse(localStorage.getItem('rh_disputes_v2')||'{}'); } catch(e){}
    if(meta[orderId]) { meta[orderId].status='resolved'; meta[orderId].resolution=action; meta[orderId].resolvedAt=new Date().toISOString(); localStorage.setItem('rh_disputes_v2', JSON.stringify(meta)); }
    addSecLog('admin_resolve', _adminAddr, 'Resolved dispute '+orderId+' → '+action);
    showToast('Dispute resolved: '+action, 'success');
    adminLoadDisputes();
  }

  function adminForceResolve(orderId) {
    var action = prompt('Force resolve — type "refund" or "release":');
    if(action==='refund'||action==='release') adminResolveDispute(orderId, action);
  }

  /* ── Products ── */
  function adminLoadProducts() {
    var el = document.getElementById('admin-products-table');
    if(!el) return;
    el.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">Loading products…</div>';
    fetch('/api/products?limit=100').then(function(r){ return r.json(); }).then(function(data){
      var products = Array.isArray(data.products) ? data.products : [];
      if(!products.length) { el.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:30px;">No products found.</p>'; return; }
      var rows = products.map(function(p) {
        return '<tr>' +
          '<td>' + escH(p.id||'') + '</td>' +
          '<td>' + escH((p.title||'').slice(0,30)) + '</td>' +
          '<td style="font-family:monospace;">' + escH(shortA(p.seller_id)) + '</td>' +
          '<td>' + escH(String(p.price||0)) + ' ' + escH(p.token||'USDC') + '</td>' +
          '<td><span style="background:#' + (p.status==='active'?'dcfce7;color:#15803d':'fee2e2;color:#dc2626') + ';font-size:10px;padding:3px 7px;border-radius:6px;font-weight:700;">' + escH(p.status||'') + '</span></td>' +
          '<td style="display:flex;gap:5px;flex-wrap:wrap;">' +
          '<button class="admin-action-btn admin-remove-btn" onclick="adminRemoveProduct(\''+escH(p.id)+'\',\''+escH(p.seller_id)+'\')">Remove</button>' +
          '<button class="admin-action-btn admin-flag-btn" onclick="adminFlagProduct(\''+escH(p.id)+'\')">Flag</button>' +
          '<button class="admin-action-btn admin-ban-btn" onclick="adminBanSeller(\''+escH(p.seller_id)+'\')">Ban Seller</button>' +
          '</td></tr>';
      }).join('');
      el.innerHTML = '<div style="overflow-x:auto;"><table class="admin-tbl"><thead><tr><th>ID</th><th>Title</th><th>Seller</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    }).catch(function(e){ el.innerHTML = '<p style="color:#dc2626;padding:20px;">Error loading products: '+escH(e.message)+'</p>'; });
  }

  function adminRemoveProduct(id, seller) {
    if(!confirm('Remove product '+id+'?')) return;
    var w = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    if(!w) { alert('Connect wallet'); return; }
    fetch('/api/products/'+encodeURIComponent(id), { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({seller_id:w.address.toLowerCase()}) })
      .then(function(r){ return r.json(); })
      .then(function(d){ addSecLog('admin_remove_product', _adminAddr, 'Removed product '+id); showToast('Product removed', 'success'); adminLoadProducts(); })
      .catch(function(e){ showToast('Error: '+e.message, 'error'); });
  }

  function adminFlagProduct(id) { addSecLog('admin_flag_product', _adminAddr, 'Flagged product '+id); showToast('Product flagged in security log', 'info'); }
  function adminBanSeller(addr) { addSecLog('admin_ban_seller', _adminAddr, 'Banned seller '+addr); showToast('Seller ban logged: '+addr.slice(0,10)+'…', 'warning'); }

  /* ── Reports ── */
  function adminLoadReports() {
    var el = document.getElementById('admin-reports-table');
    if(!el) return;
    var reports = []; try { reports = JSON.parse(localStorage.getItem(ADMIN_REPORTS_KEY)||'[]'); } catch(e){}
    if(!reports.length) { el.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:30px;">No reports found.</p>'; return; }
    var rows = reports.map(function(r, i) {
      return '<tr>' +
        '<td>'+escH(r.type||'report')+'</td>' +
        '<td>'+escH(r.target||'—')+'</td>' +
        '<td style="font-family:monospace;">'+escH(shortA(r.reporter||''))+'</td>' +
        '<td>'+escH((r.reason||'').slice(0,60))+'</td>' +
        '<td>'+new Date(r.ts||0).toLocaleDateString()+'</td>' +
        '<td style="display:flex;gap:5px;">' +
        '<button class="admin-action-btn admin-ignore-btn" onclick="adminIgnoreReport('+i+')">Ignore</button>' +
        '<button class="admin-action-btn admin-remove-btn" onclick="adminRemoveReport('+i+')">Remove</button>' +
        '<button class="admin-action-btn admin-flag-btn" onclick="adminFlagReport('+i+')">Flag</button>' +
        '</td></tr>';
    }).join('');
    el.innerHTML = '<div style="overflow-x:auto;"><table class="admin-tbl"><thead><tr><th>Type</th><th>Target</th><th>Reporter</th><th>Reason</th><th>Date</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  function adminIgnoreReport(i) {
    var r = []; try { r = JSON.parse(localStorage.getItem(ADMIN_REPORTS_KEY)||'[]'); } catch(e){}
    if(r[i]) { addSecLog('admin_ignore_report', _adminAddr, 'Ignored report '+i); r[i].status='ignored'; localStorage.setItem(ADMIN_REPORTS_KEY,JSON.stringify(r)); adminLoadReports(); showToast('Report ignored','info'); }
  }
  function adminRemoveReport(i) {
    var r = []; try { r = JSON.parse(localStorage.getItem(ADMIN_REPORTS_KEY)||'[]'); } catch(e){}
    r.splice(i,1); localStorage.setItem(ADMIN_REPORTS_KEY,JSON.stringify(r)); addSecLog('admin_remove_report',_adminAddr,'Removed report '+i); adminLoadReports(); showToast('Report removed','success');
  }
  function adminFlagReport(i) { addSecLog('admin_flag_report',_adminAddr,'Flagged report '+i); showToast('Report flagged','info'); }

  /* ── Security Log ── */
  function adminRenderSecLog() {
    var el = document.getElementById('admin-security-log');
    if(!el) return;
    var log = getSecLog();
    if(!log.length) { el.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:30px;">No security events logged.</p>'; return; }
    var typeColors = { admin_resolve:'#dcfce7/#15803d', admin_remove_product:'#fee2e2/#dc2626', admin_ban_seller:'#fce7f3/#9d174d', admin_flag_product:'#fef3c7/#92400e', unauthorized_access:'#fee2e2/#dc2626' };
    el.innerHTML = log.map(function(entry) {
      var colors = (typeColors[entry.event]||'#f1f5f9/#64748b').split('/');
      return '<div class="admin-sec-entry">' +
        '<div class="admin-sec-icon" style="background:'+colors[0]+';color:'+colors[1]+'"><i class="fas fa-shield-alt"></i></div>' +
        '<div style="flex:1;">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;">' +
        '<span style="font-weight:700;color:#1e293b;font-size:12px;">'+escH(entry.event)+'</span>' +
        '<span style="font-size:10px;color:#94a3b8;">'+new Date(entry.ts).toLocaleString()+'</span></div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px;">'+escH(entry.addr)+' — '+escH(entry.detail)+'</div>' +
        '</div></div>';
    }).join('');
  }
  function adminClearSecLog() { if(confirm('Clear security log?')) { localStorage.removeItem(ADMIN_SECLOG_KEY); adminRenderSecLog(); showToast('Security log cleared','info'); } }

  /* ── Whitelist ── */
  function adminRenderWhitelist() {
    var el = document.getElementById('admin-whitelist-list');
    if(!el) return;
    var list = getAdminWhitelist();
    if(!list.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:13px;">No addresses in whitelist yet.</p>'; return; }
    el.innerHTML = list.map(function(addr, i) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;margin-bottom:6px;">' +
        '<code style="font-size:12px;color:#334155;">'+escH(addr)+'</code>' +
        '<button onclick="adminRemoveWl('+i+')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-weight:700;">Remove</button>' +
        '</div>';
    }).join('');
  }
  function adminAddWhitelist() {
    var inp = document.getElementById('admin-wl-input');
    var addr = inp ? inp.value.trim().toLowerCase() : '';
    if(!addr || !addr.startsWith('0x') || addr.length < 40) { showToast('Invalid address','error'); return; }
    var list = getAdminWhitelist();
    if(list.includes(addr)) { showToast('Already in whitelist','info'); return; }
    list.push(addr); saveAdminWhitelist(list); if(inp) inp.value='';
    addSecLog('admin_add_whitelist', _adminAddr, 'Added '+addr);
    adminRenderWhitelist(); showToast('Address added to whitelist','success');
  }
  function adminRemoveWl(i) {
    var list = getAdminWhitelist(); list.splice(i,1); saveAdminWhitelist(list);
    addSecLog('admin_remove_whitelist', _adminAddr, 'Removed index '+i);
    adminRenderWhitelist(); showToast('Address removed','info');
  }

  /* ── Init & Auth ── */
  var _adminAddr = null;

  document.addEventListener('DOMContentLoaded', function() {
    var w = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    var addr = w && w.address ? w.address.toLowerCase() : null;
    _adminAddr = addr;

    // Ensure at least one default admin if whitelist is empty
    var list = getAdminWhitelist();
    // Check authorization
    var authorized = addr && list.length > 0 && list.includes(addr);

    document.getElementById('admin-loading').style.display = 'none';

    if(!authorized) {
      // Log unauthorized attempt
      if(addr) addSecLog('unauthorized_access', addr, 'Attempted to access /admin');
      document.getElementById('admin-blocked').style.display = '';
      return;
    }

    _adminAuthorized = true;
    document.getElementById('admin-panel').style.display = '';
    var badge = document.getElementById('admin-wallet-badge');
    if(badge) badge.textContent = addr.slice(0,10)+'…'+addr.slice(-6);
    addSecLog('admin_login', addr, 'Admin panel accessed');
    adminLoadDisputes();
  });
  </script>
  `)
}
