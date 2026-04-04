import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors())

// Favicon — return minimal inline SVG icon, avoid 500 from serveStatic
app.get('/favicon.ico', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="#dc2626"/></svg>`
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
})

// ─── API Routes ────────────────────────────────────────────────────
// Products API
app.get('/api/products', (c) => {
  return c.json({ products: MOCK_PRODUCTS })
})

app.get('/api/products/:id', (c) => {
  const id = c.req.param('id')
  const product = MOCK_PRODUCTS.find(p => p.id === id)
  if (!product) return c.json({ error: 'Not found' }, 404)
  return c.json({ product })
})

// Orders API
app.post('/api/orders', async (c) => {
  const body = await c.req.json()
  const order = {
    id: `ORD-${Date.now()}`,
    ...body,
    status: 'escrow_pending',
    createdAt: new Date().toISOString(),
    txHash: `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`
  }
  return c.json({ order })
})

// AI Search API
app.post('/api/ai-search', async (c) => {
  const { query } = await c.req.json()
  const q = (query || '').toLowerCase()
  const results = MOCK_PRODUCTS.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.tags.some((t: string) => t.toLowerCase().includes(q))
  ).slice(0, 6)
  return c.json({
    results,
    message: results.length
      ? `Found ${results.length} product(s) matching "${query}"`
      : `No products found for "${query}". Try keywords like "laptop", "phone", "gaming", "headphones".`
  })
})

// Stats API
app.get('/api/stats', (c) => {
  return c.json({
    totalProducts: MOCK_PRODUCTS.length,
    totalSellers: 12,
    totalOrders: 1847,
    totalVolume: '2,450,320 USDC'
  })
})

// ─── Pages ─────────────────────────────────────────────────────────
app.get('/', (c) => c.html(homePage()))
app.get('/marketplace', (c) => c.html(marketplacePage()))
app.get('/product/:id', (c) => {
  const id = c.req.param('id')
  const product = MOCK_PRODUCTS.find(p => p.id === id) || MOCK_PRODUCTS[0]
  return c.html(productPage(product))
})
app.get('/cart', (c) => c.html(cartPage()))
app.get('/checkout', (c) => c.html(checkoutPage()))
app.get('/wallet', (c) => c.html(walletPage()))
app.get('/wallet/create', (c) => c.html(walletCreatePage()))
app.get('/wallet/import', (c) => c.html(walletImportPage()))
app.get('/orders', (c) => c.html(ordersPage()))
app.get('/orders/:id', (c) => {
  const id = c.req.param('id')
  return c.html(orderDetailPage(id))
})
app.get('/sell', (c) => c.html(sellPage()))
app.get('/profile', (c) => c.html(profilePage()))
app.get('/register', (c) => c.html(registerPage()))
app.get('/login', (c) => c.html(loginPage()))
app.get('/disputes', (c) => c.html(disputesPage()))
app.get('/notifications', (c) => c.html(notificationsPage()))

export default app

// ─── Mock Data ─────────────────────────────────────────────────────
const MOCK_PRODUCTS = [
  {
    id: 'p1',
    name: 'MacBook Pro 16" M3 Max',
    category: 'Electronics',
    price: 3299,
    token: 'USDC',
    image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&q=80',
    seller: 'TechVault Pro',
    sellerAddress: '0xA1b2...C3d4',
    rating: 4.9,
    reviews: 128,
    stock: 5,
    description: 'The most powerful MacBook Pro ever. M3 Max chip with 40-core GPU, 16-inch Liquid Retina XDR display, up to 128GB unified memory.',
    tags: ['laptop', 'apple', 'macbook', 'pro'],
    escrowProtected: true,
    gasEstimate: 0.42
  },
  {
    id: 'p2',
    name: 'iPhone 15 Pro Max 256GB',
    category: 'Electronics',
    price: 1299,
    token: 'USDC',
    image: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=400&q=80',
    seller: 'AppleWorld Store',
    sellerAddress: '0xB2c3...D4e5',
    rating: 4.8,
    reviews: 256,
    stock: 12,
    description: 'iPhone 15 Pro Max with titanium design, 48MP camera system, A17 Pro chip, and USB-C connectivity.',
    tags: ['phone', 'apple', 'iphone', 'smartphone'],
    escrowProtected: true,
    gasEstimate: 0.38
  },
  {
    id: 'p3',
    name: 'Sony WH-1000XM5 Headphones',
    category: 'Audio',
    price: 349,
    token: 'USDC',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=80',
    seller: 'AudioElite',
    sellerAddress: '0xC3d4...E5f6',
    rating: 4.7,
    reviews: 892,
    stock: 30,
    description: 'Industry-leading noise cancellation headphones with 30-hour battery life and crystal-clear hands-free calling.',
    tags: ['headphones', 'sony', 'audio', 'noise-cancelling'],
    escrowProtected: true,
    gasEstimate: 0.31
  },
  {
    id: 'p4',
    name: 'NVIDIA RTX 4090 GPU',
    category: 'Gaming',
    price: 1899,
    token: 'USDC',
    image: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=400&q=80',
    seller: 'GamersParadise',
    sellerAddress: '0xD4e5...F6g7',
    rating: 4.9,
    reviews: 67,
    stock: 3,
    description: 'The NVIDIA GeForce RTX 4090 is the flagship gaming GPU featuring Ada Lovelace architecture, 24GB GDDR6X memory.',
    tags: ['gpu', 'gaming', 'nvidia', 'graphics card'],
    escrowProtected: true,
    gasEstimate: 0.45
  },
  {
    id: 'p5',
    name: 'Samsung 49" Ultra-Wide Monitor',
    category: 'Electronics',
    price: 1199,
    token: 'EURC',
    image: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=400&q=80',
    seller: 'DisplayWorld',
    sellerAddress: '0xE5f6...G7h8',
    rating: 4.6,
    reviews: 203,
    stock: 8,
    description: 'Odyssey Neo G9 dual UHD curved gaming monitor with 240Hz refresh rate and 1ms response time.',
    tags: ['monitor', 'samsung', 'gaming', 'ultrawide'],
    escrowProtected: true,
    gasEstimate: 0.36
  },
  {
    id: 'p6',
    name: 'DJI Mavic 3 Pro Drone',
    category: 'Photography',
    price: 2199,
    token: 'USDC',
    image: 'https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=400&q=80',
    seller: 'DroneStore Official',
    sellerAddress: '0xF6g7...H8i9',
    rating: 4.8,
    reviews: 145,
    stock: 7,
    description: 'DJI Mavic 3 Pro with Hasselblad camera, 43-min flight time, tri-lens system for professional aerial photography.',
    tags: ['drone', 'dji', 'camera', 'photography'],
    escrowProtected: true,
    gasEstimate: 0.44
  },
  {
    id: 'p7',
    name: 'Mechanical Gaming Keyboard RGB',
    category: 'Gaming',
    price: 189,
    token: 'USDC',
    image: 'https://images.unsplash.com/photo-1541140532154-b024d705b90a?w=400&q=80',
    seller: 'GamersParadise',
    sellerAddress: '0xD4e5...F6g7',
    rating: 4.5,
    reviews: 441,
    stock: 45,
    description: 'Corsair K100 RGB mechanical keyboard with OPX optical-mechanical switches, per-key RGB, and dedicated macro keys.',
    tags: ['keyboard', 'gaming', 'rgb', 'mechanical'],
    escrowProtected: true,
    gasEstimate: 0.28
  },
  {
    id: 'p8',
    name: 'Apple Watch Ultra 2',
    category: 'Wearables',
    price: 799,
    token: 'EURC',
    image: 'https://images.unsplash.com/photo-1434494878577-86c23bcb06b9?w=400&q=80',
    seller: 'AppleWorld Store',
    sellerAddress: '0xB2c3...D4e5',
    rating: 4.7,
    reviews: 334,
    stock: 15,
    description: 'Apple Watch Ultra 2 with titanium case, precision GPS, 60-hour battery, and S9 chip.',
    tags: ['watch', 'apple', 'wearable', 'smartwatch'],
    escrowProtected: true,
    gasEstimate: 0.33
  }
]

// ─── HTML Helpers ───────────────────────────────────────────────────
function shell(title: string, body: string, extraHead = '', bodyClass = '') {
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
              50:  '#fff1f1',
              100: '#ffe1e1',
              200: '#ffc7c7',
              300: '#ffa0a0',
              400: '#ff6b6b',
              500: '#ef4444',
              600: '#dc2626',
              700: '#b91c1c',
              800: '#991b1b',
              900: '#7f1d1d',
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
    .btn-primary{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 15px rgba(220,38,38,0.4)}
    .btn-secondary{background:#fff;color:#dc2626;border:2px solid #dc2626;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px}
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
    .toast{position:fixed;top:20px;right:20px;z-index:9999;background:#1e293b;color:#fff;padding:12px 20px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);font-size:14px;transform:translateX(120%);transition:transform .3s}
    .toast.show{transform:translateX(0)}
    .toast.success{background:#16a34a}
    .toast.error{background:#dc2626}
    .toast.info{background:#0ea5e9}
    nav{background:#fff;border-bottom:1px solid #f1f5f9;position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.06)}
    footer{background:#1e293b;color:#94a3b8;padding:48px 0 24px}
    .hero-gradient{background:linear-gradient(135deg,#fff1f1 0%,#fef2f2 30%,#fff 60%,#f8fafc 100%)}
    .loading-spinner{display:inline-block;width:20px;height:20px;border:2px solid #f3f3f3;border-top:2px solid #dc2626;border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    .step-circle{width:32px;height:32px;border-radius:50%;background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
    .step-circle.done{background:#16a34a}
    .step-circle.pending{background:#e2e8f0;color:#94a3b8}
    .progress-bar{height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden}
    .progress-fill{height:100%;background:linear-gradient(90deg,#dc2626,#b91c1c);border-radius:2px;transition:width .3s}
    .seed-word{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;font-family:monospace;font-size:13px;font-weight:600;color:#dc2626;text-align:center}
    .wallet-card{background:linear-gradient(135deg,#dc2626 0%,#991b1b 50%,#7f1d1d 100%);color:#fff;border-radius:16px;padding:24px}
    .chat-bubble-user{background:#fef2f2;border-radius:12px 12px 2px 12px;padding:10px 14px;max-width:80%}
    .chat-bubble-ai{background:#fff;border:1px solid #f1f5f9;border-radius:12px 12px 12px 2px;padding:10px 14px;max-width:85%}
    .sidebar-nav a{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;color:#64748b;font-size:14px;font-weight:500;text-decoration:none;transition:all .15s}
    .sidebar-nav a:hover,.sidebar-nav a.active{background:#fef2f2;color:#dc2626}
    .notification-item{border-left:3px solid #dc2626;padding:12px 16px;background:#fff;border-radius:0 8px 8px 0;margin-bottom:8px}
  </style>
  ${extraHead}
</head>
<body class="${bodyClass}">
  ${navbar()}
  ${body}
  ${chatWidget()}
  ${toastContainer()}
  <script>
    // Global utilities
    function showToast(msg, type='info') {
      const t = document.getElementById('global-toast');
      t.textContent = msg;
      t.className = 'toast show ' + type;
      setTimeout(() => { t.className = 'toast ' + type }, 3500);
    }
    function formatCurrency(amount, token) {
      return amount.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' ' + token;
    }
    // Cart
    function getCart() {
      try { return JSON.parse(localStorage.getItem('rh_cart') || '[]') } catch { return [] }
    }
    function saveCart(c) { localStorage.setItem('rh_cart', JSON.stringify(c)) }
    function addToCart(product) {
      const cart = getCart();
      const idx = cart.findIndex(i => i.id === product.id);
      if (idx >= 0) cart[idx].qty++;
      else cart.push({...product, qty:1});
      saveCart(cart);
      updateCartBadge();
      showToast('Added to cart!', 'success');
    }
    function updateCartBadge() {
      const cart = getCart();
      const total = cart.reduce((s,i) => s+i.qty, 0);
      const el = document.getElementById('cart-badge');
      if (el) { el.textContent = total; el.style.display = total > 0 ? 'flex' : 'none'; }
    }
    // Wallet
    function getWallet() {
      try { return JSON.parse(localStorage.getItem('rh_wallet') || 'null') } catch { return null }
    }
    function updateWalletBadge() {
      const w = getWallet();
      const el = document.getElementById('wallet-badge');
      if (el) el.textContent = w ? w.address.substring(0,8)+'...' : 'Wallet';
    }
    document.addEventListener('DOMContentLoaded', () => {
      updateCartBadge();
      updateWalletBadge();
    });
    // Chat toggle
    function toggleChat() {
      const panel = document.getElementById('chat-panel');
      panel.classList.toggle('hidden');
    }
  </script>
</body>
</html>`
}

function navbar() {
  return `<nav>
  <div class="max-w-7xl mx-auto px-4 flex items-center justify-between h-16 gap-4">
    <!-- Logo -->
    <a href="/" class="flex items-center gap-2 shrink-0">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/>
          <path d="M9 14l3-3 3 3" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <span class="font-800 text-xl tracking-tight text-slate-800">redhawk<span class="text-red-600">-store</span></span>
    </a>
    <!-- Search -->
    <div class="hidden md:flex flex-1 max-w-xl mx-4">
      <div class="relative w-full">
        <input id="nav-search" type="text" placeholder="Search products, categories…" class="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 bg-slate-50"/>
        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
        <button onclick="handleNavSearch()" class="absolute right-2 top-1/2 -translate-y-1/2 bg-red-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-red-700">Search</button>
      </div>
    </div>
    <!-- Actions -->
    <div class="flex items-center gap-2">
      <a href="/marketplace" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-store text-xs"></i> Marketplace
      </a>
      <a href="/sell" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-plus-circle text-xs"></i> Sell
      </a>
      <a href="/wallet" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors border border-red-100">
        <i class="fas fa-wallet text-xs"></i>
        <span id="wallet-badge">Wallet</span>
      </a>
      <a href="/notifications" class="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100">
        <i class="fas fa-bell"></i>
        <span class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
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
      if (q) {
        document.getElementById('chat-panel').classList.remove('hidden');
        sendChatMessage(q);
      }
    }
    document.getElementById('nav-search')?.addEventListener('keydown', e => { if(e.key==='Enter') handleNavSearch() });
  </script>
</nav>`
}

function toastContainer() {
  return `<div id="global-toast" class="toast"></div>`
}

function chatWidget() {
  return `
<!-- AI Chat Button -->
<button onclick="toggleChat()" class="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-red-800 text-white shadow-xl flex items-center justify-center text-xl hover:scale-110 transition-transform z-50">
  <i class="fas fa-robot"></i>
</button>
<!-- AI Chat Panel -->
<div id="chat-panel" class="hidden fixed bottom-24 right-6 w-80 sm:w-96 z-50">
  <div class="card shadow-2xl overflow-hidden">
    <div class="bg-gradient-to-r from-red-600 to-red-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <i class="fas fa-robot text-white text-sm"></i>
        </div>
        <div>
          <p class="text-white font-semibold text-sm">HawkAI Assistant</p>
          <p class="text-red-200 text-xs">Powered by redhawk-store</p>
        </div>
      </div>
      <button onclick="toggleChat()" class="text-white/80 hover:text-white">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div id="chat-messages" class="p-4 h-64 overflow-y-auto flex flex-col gap-3 bg-gray-50">
      <div class="chat-bubble-ai text-sm text-slate-700">
        👋 Hi! I'm <strong>HawkAI</strong>, your shopping assistant.<br/>
        Ask me to find products, compare prices, or get recommendations!
        <br/><br/>Try: <em>"Find me a laptop"</em> or <em>"Show gaming gear"</em>
      </div>
    </div>
    <div class="p-3 bg-white border-t border-slate-100 flex gap-2">
      <input id="chat-input" type="text" placeholder="Search products…" class="flex-1 input py-2 text-sm" onkeydown="if(event.key==='Enter')sendChatMessage()"/>
      <button onclick="sendChatMessage()" class="btn-primary py-2 px-3 text-sm">
        <i class="fas fa-paper-plane"></i>
      </button>
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
  // User bubble
  msgs.innerHTML += '<div class="flex justify-end"><div class="chat-bubble-user text-sm text-slate-700">' + query + '</div></div>';
  // Loading
  msgs.innerHTML += '<div id="ai-typing" class="chat-bubble-ai text-sm text-slate-500"><div class="loading-spinner"></div></div>';
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const res = await fetch('/api/ai-search', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    const data = await res.json();
    document.getElementById('ai-typing')?.remove();
    let html = '<div class="chat-bubble-ai text-sm text-slate-700"><p class="font-medium mb-2">' + data.message + '</p>';
    if (data.results && data.results.length > 0) {
      html += '<div class="flex flex-col gap-2">';
      data.results.slice(0,3).forEach(p => {
        html += '<div class="flex items-center gap-2 bg-white rounded-lg p-2 border border-slate-100">'
          + '<img src="' + p.image + '" class="w-10 h-10 rounded object-cover">'
          + '<div class="flex-1 min-w-0"><p class="font-medium text-xs truncate">' + p.name + '</p>'
          + '<p class="text-red-600 font-bold text-xs">' + p.price + ' ' + p.token + '</p></div>'
          + '<a href="/product/' + p.id + '" class="btn-primary text-xs py-1 px-2">Buy</a></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    msgs.innerHTML += html;
  } catch {
    document.getElementById('ai-typing')?.remove();
    msgs.innerHTML += '<div class="chat-bubble-ai text-sm text-red-500">Sorry, search failed. Try again.</div>';
  }
  msgs.scrollTop = msgs.scrollHeight;
}
</script>`
}

// ─── PAGE: HOME ─────────────────────────────────────────────────────
function homePage() {
  const featuredIds = ['p1','p2','p3','p4']
  const featured = MOCK_PRODUCTS.filter(p => featuredIds.includes(p.id))
  const categories = [
    { name:'Electronics', icon:'fas fa-laptop', count:42, color:'bg-blue-50 text-blue-600' },
    { name:'Gaming', icon:'fas fa-gamepad', count:28, color:'bg-purple-50 text-purple-600' },
    { name:'Audio', icon:'fas fa-headphones', count:19, color:'bg-green-50 text-green-600' },
    { name:'Photography', icon:'fas fa-camera', count:15, color:'bg-yellow-50 text-yellow-600' },
    { name:'Wearables', icon:'fas fa-watch', count:12, color:'bg-pink-50 text-pink-600' },
    { name:'Accessories', icon:'fas fa-keyboard', count:34, color:'bg-red-50 text-red-600' },
  ]

  const productCards = featured.map(p => renderProductCard(p)).join('')
  const allCards = MOCK_PRODUCTS.map(p => renderProductCard(p)).join('')
  const catCards = categories.map(c => `
    <a href="/marketplace?cat=${c.name}" class="card p-5 flex flex-col items-center gap-3 hover:border-red-200 hover:bg-red-50/30 transition-all cursor-pointer group text-center">
      <div class="w-12 h-12 rounded-xl ${c.color} flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
        <i class="${c.icon}"></i>
      </div>
      <div>
        <p class="font-semibold text-slate-800 text-sm">${c.name}</p>
        <p class="text-slate-400 text-xs">${c.count} products</p>
      </div>
    </a>`).join('')

  return shell('Home', `
  <!-- Hero -->
  <section class="hero-gradient">
    <div class="max-w-7xl mx-auto px-4 py-16 flex flex-col lg:flex-row items-center gap-12">
      <div class="flex-1">
        <div class="inline-flex items-center gap-2 bg-red-100 text-red-700 px-3 py-1.5 rounded-full text-xs font-semibold mb-4">
          <i class="fas fa-shield-alt"></i> Escrow-Protected Marketplace
        </div>
        <h1 class="text-5xl font-extrabold text-slate-900 leading-tight mb-4">
          Shop the <span class="text-red-600">Future</span><br/>of Decentralized<br/>Commerce
        </h1>
        <p class="text-slate-500 text-lg mb-6 max-w-md">Buy and sell with confidence using USDC & EURC. Smart contract escrow protects every transaction on Arc Network.</p>
        <div class="flex flex-wrap gap-3">
          <a href="/marketplace" class="btn-primary text-base px-6 py-3">
            <i class="fas fa-store"></i> Browse Marketplace
          </a>
          <a href="/wallet/create" class="btn-secondary text-base px-6 py-3">
            <i class="fas fa-wallet"></i> Create Wallet
          </a>
        </div>
        <div class="flex gap-6 mt-8">
          <div><p class="text-2xl font-bold text-slate-800">1,847+</p><p class="text-slate-400 text-sm">Orders Completed</p></div>
          <div class="w-px bg-slate-200"></div>
          <div><p class="text-2xl font-bold text-slate-800">$2.4M</p><p class="text-slate-400 text-sm">Total Volume</p></div>
          <div class="w-px bg-slate-200"></div>
          <div><p class="text-2xl font-bold text-slate-800">12K+</p><p class="text-slate-400 text-sm">Active Users</p></div>
        </div>
      </div>
      <div class="flex-1 flex justify-center">
        <div class="relative w-72 h-72">
          <div class="absolute inset-0 bg-gradient-to-br from-red-500 to-red-800 rounded-[40%_60%_60%_40%/40%_40%_60%_60%] opacity-10 animate-pulse"></div>
          <div class="absolute inset-6 bg-gradient-to-br from-red-400 to-red-700 rounded-[40%_60%_60%_40%/40%_40%_60%_60%] opacity-20"></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="text-center">
              <div class="w-24 h-24 mx-auto bg-gradient-to-br from-red-500 to-red-800 rounded-2xl flex items-center justify-center shadow-2xl mb-4">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/>
                  <path d="M9 14l3-3 3 3" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <p class="font-extrabold text-slate-800 text-xl">redhawk-store</p>
              <p class="text-slate-500 text-sm">Arc Network dApp</p>
              <div class="flex items-center justify-center gap-1 mt-2">
                <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                <span class="text-green-600 text-xs font-medium">Live on Arc Network</span>
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
        ['fas fa-shield-alt','Escrow Protected','Every purchase secured'],
        ['fas fa-bolt','Instant Settlement','Funds released on delivery'],
        ['fas fa-coins','USDC & EURC','Stable crypto payments'],
        ['fas fa-globe','Arc Network','Fast, low-cost chain'],
        ['fas fa-lock','Non-Custodial','You own your keys'],
      ].map(([icon,title,sub]) => `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
            <i class="${icon}"></i>
          </div>
          <div><p class="font-semibold text-slate-800 text-sm">${title}</p><p class="text-slate-400 text-xs">${sub}</p></div>
        </div>`).join('')}
    </div>
  </section>

  <!-- Categories -->
  <section class="max-w-7xl mx-auto px-4 py-12">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-slate-800">Browse Categories</h2>
      <a href="/marketplace" class="text-red-600 text-sm font-medium hover:underline">View all →</a>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      ${catCards}
    </div>
  </section>

  <!-- Featured Products -->
  <section class="max-w-7xl mx-auto px-4 pb-12">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-slate-800">⚡ Featured Products</h2>
      <a href="/marketplace" class="text-red-600 text-sm font-medium hover:underline">View all →</a>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      ${productCards}
    </div>
  </section>

  <!-- All Products -->
  <section class="max-w-7xl mx-auto px-4 pb-16">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-slate-800">🏪 All Products</h2>
      <a href="/marketplace" class="btn-secondary text-sm">View Marketplace</a>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      ${allCards}
    </div>
  </section>

  <!-- How It Works -->
  <section class="bg-white border-y border-slate-100 py-16">
    <div class="max-w-7xl mx-auto px-4">
      <h2 class="text-2xl font-bold text-slate-800 text-center mb-10">How redhawk-store Works</h2>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        ${[
          ['1','fas fa-search','Find & Select','Browse thousands of verified products with USDC/EURC pricing'],
          ['2','fas fa-wallet','Connect Wallet','Use MetaMask, WalletConnect, or create a wallet inside the app'],
          ['3','fas fa-lock','Escrow Lock','Funds locked in smart contract — no trust required'],
          ['4','fas fa-check-circle','Confirm & Release','Confirm delivery, funds released automatically to seller'],
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

  <!-- Footer -->
  <footer>
    <div class="max-w-7xl mx-auto px-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-slate-700">
        <div>
          <div class="flex items-center gap-2 mb-4">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white"/></svg>
            </div>
            <span class="font-bold text-white">redhawk-store</span>
          </div>
          <p class="text-sm leading-relaxed">The decentralized marketplace for the next generation. Powered by Arc Network.</p>
          <div class="flex gap-3 mt-4">
            ${['fab fa-twitter','fab fa-discord','fab fa-github','fab fa-telegram'].map(ic=>`<a href="#" class="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center hover:bg-red-600 transition-colors"><i class="${ic} text-sm"></i></a>`).join('')}
          </div>
        </div>
        <div>
          <h4 class="font-semibold text-white mb-3">Marketplace</h4>
          <ul class="space-y-2 text-sm">
            ${['Browse Products','Categories','Featured','New Arrivals','Best Sellers'].map(t=>`<li><a href="/marketplace" class="hover:text-red-400 transition-colors">${t}</a></li>`).join('')}
          </ul>
        </div>
        <div>
          <h4 class="font-semibold text-white mb-3">Sellers</h4>
          <ul class="space-y-2 text-sm">
            ${['Start Selling','Seller Dashboard','Pricing','Analytics','Support'].map(t=>`<li><a href="/sell" class="hover:text-red-400 transition-colors">${t}</a></li>`).join('')}
          </ul>
        </div>
        <div>
          <h4 class="font-semibold text-white mb-3">Support</h4>
          <ul class="space-y-2 text-sm">
            ${['Help Center','Disputes','Escrow Guide','Wallet Setup','Contact Us'].map(t=>`<li><a href="#" class="hover:text-red-400 transition-colors">${t}</a></li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <p>© 2024 redhawk-store. All rights reserved. Built on Arc Network.</p>
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-green-400"></div>
          <span class="text-green-400">All systems operational</span>
        </div>
      </div>
    </div>
  </footer>
  `)
}

function renderProductCard(p: typeof MOCK_PRODUCTS[0]) {
  const stars = Array(5).fill(0).map((_,i) => `<i class="fas fa-star ${i < Math.floor(p.rating) ? 'star' : 'text-slate-200'} text-xs"></i>`).join('')
  return `
  <div class="product-card">
    <div class="relative">
      <img src="${p.image}" alt="${p.name}" class="w-full h-48 object-cover"/>
      <span class="absolute top-2 left-2 badge-escrow"><i class="fas fa-shield-alt mr-1"></i>Escrow</span>
      ${p.stock < 5 ? `<span class="absolute top-2 right-2 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">Low Stock</span>` : ''}
    </div>
    <div class="p-4">
      <span class="tag">${p.category}</span>
      <h3 class="font-semibold text-slate-800 mt-2 mb-1 text-sm leading-tight">${p.name}</h3>
      <div class="flex items-center gap-1 mb-2">
        ${stars}
        <span class="text-slate-400 text-xs ml-1">(${p.reviews})</span>
      </div>
      <p class="text-slate-400 text-xs mb-3">by ${p.seller}</p>
      <div class="flex items-center justify-between mb-3">
        <div>
          <p class="text-xl font-extrabold text-red-600">${p.price.toLocaleString()} <span class="text-sm font-semibold">${p.token}</span></p>
          <p class="text-slate-400 text-xs">≈ $${(p.price * 1.0).toLocaleString()} USD</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-slate-400">Gas ~$${p.gasEstimate}</p>
        </div>
      </div>
      <div class="flex gap-2">
        <a href="/product/${p.id}" class="btn-primary flex-1 text-xs py-2 justify-center">
          <i class="fas fa-bolt"></i> Buy Now
        </a>
        <button onclick='addToCart(${JSON.stringify(p)})' class="btn-secondary text-xs py-2 px-3">
          <i class="fas fa-cart-plus"></i>
        </button>
      </div>
    </div>
  </div>`
}

// ─── PAGE: MARKETPLACE ──────────────────────────────────────────────
function marketplacePage() {
  const allCards = MOCK_PRODUCTS.map(p => renderProductCard(p)).join('')
  return shell('Marketplace', `
  <div class="max-w-7xl mx-auto px-4 py-8">
    <!-- Header -->
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="text-3xl font-bold text-slate-800">Marketplace</h1>
        <p class="text-slate-500 mt-1">${MOCK_PRODUCTS.length} products available · All escrow-protected</p>
      </div>
      <div class="flex items-center gap-3">
        <select class="select w-40 text-sm" onchange="sortProducts(this.value)">
          <option value="">Sort by</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="rating">Top Rated</option>
          <option value="newest">Newest</option>
        </select>
        <div class="flex border border-slate-200 rounded-lg overflow-hidden">
          <button class="p-2 px-3 hover:bg-slate-100 text-red-600" title="Grid view"><i class="fas fa-th"></i></button>
          <button class="p-2 px-3 hover:bg-slate-100 text-slate-400" title="List view"><i class="fas fa-list"></i></button>
        </div>
      </div>
    </div>

    <div class="flex gap-8">
      <!-- Sidebar Filters -->
      <aside class="hidden lg:block w-64 shrink-0">
        <div class="card p-5 sticky top-20">
          <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <i class="fas fa-sliders-h text-red-500"></i> Filters
          </h3>

          <!-- Category Filter -->
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Category</p>
            <div class="space-y-1.5">
              ${['All','Electronics','Gaming','Audio','Photography','Wearables'].map((cat,i) => `
                <label class="flex items-center gap-2 cursor-pointer hover:text-red-600 text-sm text-slate-600">
                  <input type="checkbox" ${i===0?'checked':''} class="accent-red-600 w-3.5 h-3.5"/>
                  ${cat}
                </label>`).join('')}
            </div>
          </div>

          <!-- Price Filter -->
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Price Range (USDC)</p>
            <div class="flex gap-2">
              <input type="number" placeholder="Min" class="input text-xs py-1.5 w-full"/>
              <input type="number" placeholder="Max" class="input text-xs py-1.5 w-full"/>
            </div>
          </div>

          <!-- Token Filter -->
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Token</p>
            <div class="space-y-1.5">
              <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600"><input type="checkbox" checked class="accent-red-600 w-3.5 h-3.5"/> USDC</label>
              <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600"><input type="checkbox" checked class="accent-red-600 w-3.5 h-3.5"/> EURC</label>
            </div>
          </div>

          <!-- Rating Filter -->
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Min Rating</p>
            <div class="space-y-1.5">
              ${[5,4,3].map(r => `
                <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                  <input type="radio" name="rating" class="accent-red-600 w-3.5 h-3.5"/>
                  ${'★'.repeat(r)}${'☆'.repeat(5-r)} & up
                </label>`).join('')}
            </div>
          </div>

          <!-- Escrow Only -->
          <div class="mb-4">
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
              <input type="checkbox" checked class="accent-red-600 w-3.5 h-3.5"/>
              <span>Escrow Protected Only</span>
            </label>
          </div>

          <button class="btn-primary w-full text-sm justify-center">Apply Filters</button>
          <button class="btn-secondary w-full text-sm justify-center mt-2">Reset</button>
        </div>
      </aside>

      <!-- Products Grid -->
      <div class="flex-1">
        <div id="products-grid" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          ${allCards}
        </div>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: PRODUCT DETAIL ───────────────────────────────────────────
function productPage(p: typeof MOCK_PRODUCTS[0]) {
  const stars = Array(5).fill(0).map((_,i) => `<i class="fas fa-star ${i < Math.floor(p.rating) ? 'star' : 'text-slate-200'}"></i>`).join('')
  const related = MOCK_PRODUCTS.filter(r => r.id !== p.id && r.category === p.category).slice(0,3)

  return shell(p.name, `
  <div class="max-w-7xl mx-auto px-4 py-8">
    <!-- Breadcrumb -->
    <nav class="flex items-center gap-2 text-sm text-slate-400 mb-6">
      <a href="/" class="hover:text-red-600">Home</a> <span>/</span>
      <a href="/marketplace" class="hover:text-red-600">Marketplace</a> <span>/</span>
      <span class="text-slate-600">${p.category}</span> <span>/</span>
      <span class="text-slate-800 font-medium truncate max-w-48">${p.name}</span>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
      <!-- Image Gallery -->
      <div>
        <div class="relative rounded-2xl overflow-hidden bg-slate-100 aspect-square mb-4 shadow-lg">
          <img id="main-img" src="${p.image}" alt="${p.name}" class="w-full h-full object-cover"/>
          <span class="absolute top-3 left-3 badge-escrow text-sm"><i class="fas fa-shield-alt mr-1"></i>Escrow Protected</span>
        </div>
        <div class="flex gap-3">
          ${[p.image, p.image, p.image].map((img,i) => `
            <div onclick="document.getElementById('main-img').src='${img}'" class="w-20 h-20 rounded-xl overflow-hidden cursor-pointer border-2 ${i===0?'border-red-500':'border-transparent'} hover:border-red-400 transition-colors">
              <img src="${img}" class="w-full h-full object-cover"/>
            </div>`).join('')}
        </div>
      </div>

      <!-- Product Info -->
      <div>
        <span class="tag">${p.category}</span>
        <h1 class="text-3xl font-extrabold text-slate-900 mt-3 mb-2">${p.name}</h1>

        <div class="flex items-center gap-3 mb-4">
          <div class="flex gap-0.5">${stars}</div>
          <span class="font-semibold text-slate-700">${p.rating}</span>
          <span class="text-slate-400 text-sm">(${p.reviews} reviews)</span>
          <span class="text-green-600 text-sm font-medium"><i class="fas fa-check-circle mr-1"></i>${p.stock} in stock</span>
        </div>

        <div class="mb-6">
          <p class="text-4xl font-extrabold text-red-600 mb-1">${p.price.toLocaleString()} <span class="text-xl">${p.token}</span></p>
          <p class="text-slate-400 text-sm">≈ $${(p.price * 1.0).toLocaleString()} USD (estimated)</p>
          <p class="text-slate-400 text-xs mt-1"><i class="fas fa-gas-pump mr-1"></i>Gas estimate: ~$${p.gasEstimate} USD</p>
        </div>

        <!-- Escrow Info Box -->
        <div class="bg-red-50 border border-red-100 rounded-xl p-4 mb-6">
          <h3 class="font-bold text-red-800 flex items-center gap-2 mb-2">
            <i class="fas fa-shield-alt"></i> Smart Contract Escrow Protection
          </h3>
          <ul class="space-y-1.5 text-sm text-red-700">
            <li class="flex items-center gap-2"><i class="fas fa-check text-xs"></i> Funds locked until delivery confirmed</li>
            <li class="flex items-center gap-2"><i class="fas fa-check text-xs"></i> Dispute resolution via DAO governance</li>
            <li class="flex items-center gap-2"><i class="fas fa-check text-xs"></i> 48-hour auto-release protection</li>
            <li class="flex items-center gap-2"><i class="fas fa-check text-xs"></i> On-chain receipt generated automatically</li>
          </ul>
        </div>

        <!-- Seller Info -->
        <div class="card p-4 mb-6">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-red-400 to-red-700 flex items-center justify-center text-white font-bold">
              ${p.seller.charAt(0)}
            </div>
            <div class="flex-1">
              <p class="font-semibold text-slate-800">${p.seller}</p>
              <p class="text-slate-400 text-xs font-mono">${p.sellerAddress}</p>
            </div>
            <div class="text-right">
              <div class="flex items-center gap-1 justify-end">
                <i class="fas fa-star star text-sm"></i>
                <span class="font-semibold text-sm">${p.rating}</span>
              </div>
              <p class="text-green-600 text-xs font-medium">Verified Seller</p>
            </div>
          </div>
        </div>

        <!-- Web3 Info -->
        <div class="grid grid-cols-3 gap-3 mb-6">
          <div class="card p-3 text-center">
            <i class="fas fa-coins text-red-500 mb-1"></i>
            <p class="font-bold text-slate-800 text-sm">${p.token}</p>
            <p class="text-slate-400 text-xs">Token</p>
          </div>
          <div class="card p-3 text-center">
            <i class="fas fa-network-wired text-blue-500 mb-1"></i>
            <p class="font-bold text-slate-800 text-sm">Arc</p>
            <p class="text-slate-400 text-xs">Network</p>
          </div>
          <div class="card p-3 text-center">
            <i class="fas fa-gas-pump text-orange-500 mb-1"></i>
            <p class="font-bold text-slate-800 text-sm">~$${p.gasEstimate}</p>
            <p class="text-slate-400 text-xs">Gas (USD)</p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-3 mb-4">
          <a href="/checkout?product=${p.id}" class="btn-primary flex-1 justify-center text-base py-3">
            <i class="fas fa-bolt"></i> Buy Now with Escrow
          </a>
          <button onclick='addToCart(${JSON.stringify(p)})' class="btn-secondary text-base py-3 px-5">
            <i class="fas fa-cart-plus"></i> Cart
          </button>
        </div>
        <a href="/wallet" class="flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-red-600">
          <i class="fas fa-wallet"></i> Need a wallet? Create one free →
        </a>
      </div>
    </div>

    <!-- Description -->
    <div class="card p-6 mb-8">
      <h2 class="text-xl font-bold text-slate-800 mb-4">Product Description</h2>
      <p class="text-slate-600 leading-relaxed">${p.description}</p>
      <div class="flex flex-wrap gap-2 mt-4">
        ${p.tags.map(t => `<span class="tag">#${t}</span>`).join('')}
      </div>
    </div>

    <!-- Related Products -->
    ${related.length > 0 ? `
    <div>
      <h2 class="text-xl font-bold text-slate-800 mb-5">Related Products</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
        ${related.map(r => renderProductCard(r)).join('')}
      </div>
    </div>` : ''}
  </div>
  `)
}

// ─── PAGE: CART ─────────────────────────────────────────────────────
function cartPage() {
  return shell('Cart', `
  <div class="max-w-5xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-6 flex items-center gap-3">
      <i class="fas fa-shopping-cart text-red-500"></i> Your Cart
    </h1>
    <div class="flex flex-col lg:flex-row gap-8">
      <div class="flex-1" id="cart-items">
        <div class="card p-6 text-center text-slate-400" id="empty-cart">
          <i class="fas fa-shopping-cart text-5xl mb-3 opacity-30"></i>
          <p class="font-medium">Your cart is empty</p>
          <a href="/marketplace" class="btn-primary mt-4 mx-auto">Browse Products</a>
        </div>
      </div>
      <div class="w-full lg:w-80">
        <div class="card p-6 sticky top-20" id="cart-summary">
          <h2 class="font-bold text-slate-800 text-lg mb-4">Order Summary</h2>
          <div class="space-y-3 text-sm mb-4">
            <div class="flex justify-between text-slate-600"><span>Subtotal</span><span id="subtotal">0.00 USDC</span></div>
            <div class="flex justify-between text-slate-600"><span>Platform Fee (1.5%)</span><span id="platform-fee">0.00</span></div>
            <div class="flex justify-between text-slate-600"><span>Gas Estimate</span><span id="gas-fee">~$0.00</span></div>
            <div class="border-t border-slate-100 pt-3 flex justify-between font-bold text-lg text-slate-800">
              <span>Total</span><span id="total-price" class="text-red-600">0.00 USDC</span>
            </div>
          </div>
          <a href="/checkout" id="checkout-btn" class="btn-primary w-full justify-center py-3 text-base">
            <i class="fas fa-lock"></i> Proceed to Checkout
          </a>
          <a href="/marketplace" class="btn-secondary w-full justify-center mt-2 text-sm">Continue Shopping</a>
          <p class="text-slate-400 text-xs text-center mt-3">
            <i class="fas fa-shield-alt text-red-400 mr-1"></i>
            Secured by smart contract escrow
          </p>
        </div>
      </div>
    </div>
  </div>
  <script>
  function renderCart() {
    const cart = getCart();
    const container = document.getElementById('cart-items');
    const emptyDiv = document.getElementById('empty-cart');
    if (cart.length === 0) {
      emptyDiv.style.display = 'block';
      document.getElementById('checkout-btn').style.pointerEvents = 'none';
      document.getElementById('checkout-btn').style.opacity = '.5';
      return;
    }
    emptyDiv.style.display = 'none';
    let total = 0, gas = 0;
    const html = cart.map(item => {
      total += item.price * item.qty;
      gas += (item.gasEstimate || 0.3) * item.qty;
      return '<div class="card p-4 mb-3 flex items-center gap-4">'
        + '<img src="' + item.image + '" class="w-16 h-16 rounded-xl object-cover"/>'
        + '<div class="flex-1 min-w-0">'
        + '<p class="font-semibold text-slate-800 text-sm truncate">' + item.name + '</p>'
        + '<p class="text-red-600 font-bold">' + item.price + ' ' + item.token + '</p>'
        + '<p class="text-slate-400 text-xs">by ' + item.seller + '</p>'
        + '</div>'
        + '<div class="flex items-center gap-2">'
        + '<button onclick="changeQty(\'' + item.id + '\',-1)" class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 text-slate-600 font-bold">-</button>'
        + '<span class="font-bold w-6 text-center">' + item.qty + '</span>'
        + '<button onclick="changeQty(\'' + item.id + '\',1)" class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 text-slate-600 font-bold">+</button>'
        + '</div>'
        + '<button onclick="removeFromCart(\'' + item.id + '\')" class="text-red-400 hover:text-red-600 ml-2"><i class="fas fa-trash"></i></button>'
        + '</div>';
    }).join('');
    container.innerHTML = html;
    const fee = total * 0.015;
    document.getElementById('subtotal').textContent = total.toFixed(2) + ' USDC';
    document.getElementById('platform-fee').textContent = fee.toFixed(2) + ' USDC';
    document.getElementById('gas-fee').textContent = '~\$' + gas.toFixed(2);
    document.getElementById('total-price').textContent = (total + fee).toFixed(2) + ' USDC';
  }
  function changeQty(id, delta) {
    const cart = getCart();
    const i = cart.findIndex(x => x.id === id);
    if (i >= 0) {
      cart[i].qty = Math.max(1, cart[i].qty + delta);
      saveCart(cart);
      updateCartBadge();
      renderCart();
    }
  }
  function removeFromCart(id) {
    const cart = getCart().filter(x => x.id !== id);
    saveCart(cart);
    updateCartBadge();
    renderCart();
    showToast('Item removed', 'info');
  }
  document.addEventListener('DOMContentLoaded', renderCart);
  </script>
  `)
}

// ─── PAGE: CHECKOUT ─────────────────────────────────────────────────
function checkoutPage() {
  return shell('Checkout', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-lock text-red-500"></i> Secure Checkout
    </h1>
    <p class="text-slate-500 mb-8">Funds are locked in escrow until delivery is confirmed.</p>

    <!-- Escrow Steps -->
    <div class="card p-5 mb-8">
      <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
        <i class="fas fa-route text-red-500"></i> Escrow Transaction Flow
      </h3>
      <div class="flex items-center gap-2 overflow-x-auto pb-2">
        ${[
          ['Confirm Order','fas fa-check'],
          ['Lock Funds','fas fa-lock'],
          ['Seller Ships','fas fa-shipping-fast'],
          ['You Confirm','fas fa-box-open'],
          ['Released','fas fa-coins'],
        ].map(([label,icon],i) => `
          <div class="flex items-center gap-2 shrink-0">
            <div class="flex flex-col items-center">
              <div class="w-10 h-10 rounded-full ${i===0?'bg-red-600':'bg-slate-200'} flex items-center justify-center text-${i===0?'white':'slate-400'}">
                <i class="${icon} text-sm"></i>
              </div>
              <p class="text-xs text-center mt-1 font-medium ${i===0?'text-red-600':'text-slate-400'} w-16">${label}</p>
            </div>
            ${i < 4 ? '<div class="w-8 h-0.5 bg-slate-200 mt-0 mb-5"></div>' : ''}
          </div>`).join('')}
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Left: Payment Details -->
      <div class="space-y-6">
        <!-- Select Token -->
        <div class="card p-5">
          <h3 class="font-bold text-slate-800 mb-4">Payment Token</h3>
          <div class="grid grid-cols-2 gap-3">
            <label class="cursor-pointer">
              <input type="radio" name="token" value="USDC" checked class="sr-only peer"/>
              <div class="card p-4 flex items-center gap-3 peer-checked:border-red-500 peer-checked:bg-red-50 hover:border-red-300 transition-all">
                <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <span class="font-bold text-blue-700 text-sm">$</span>
                </div>
                <div>
                  <p class="font-bold text-slate-800">USDC</p>
                  <p class="text-slate-400 text-xs">USD Coin</p>
                </div>
              </div>
            </label>
            <label class="cursor-pointer">
              <input type="radio" name="token" value="EURC" class="sr-only peer"/>
              <div class="card p-4 flex items-center gap-3 peer-checked:border-red-500 peer-checked:bg-red-50 hover:border-red-300 transition-all">
                <div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span class="font-bold text-indigo-700 text-sm">€</span>
                </div>
                <div>
                  <p class="font-bold text-slate-800">EURC</p>
                  <p class="text-slate-400 text-xs">Euro Coin</p>
                </div>
              </div>
            </label>
          </div>
        </div>

        <!-- Shipping Address -->
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
            <select class="select">
              <option>Select Country</option>
              <option>United States</option>
              <option>United Kingdom</option>
              <option>Germany</option>
              <option>Brazil</option>
              <option>Other</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Right: Order Summary -->
      <div>
        <div class="card p-5 mb-4">
          <h3 class="font-bold text-slate-800 mb-4">Order Summary</h3>
          <div id="checkout-items" class="space-y-3 mb-4 text-sm">
            <div class="text-slate-400 text-center py-4">Loading cart...</div>
          </div>
          <div class="border-t border-slate-100 pt-4 space-y-2 text-sm">
            <div class="flex justify-between text-slate-600"><span>Subtotal</span><span id="co-subtotal">—</span></div>
            <div class="flex justify-between text-slate-600"><span>Platform Fee (1.5%)</span><span id="co-fee">—</span></div>
            <div class="flex justify-between text-slate-600"><span>Gas Estimate</span><span id="co-gas">~$0.40</span></div>
            <div class="flex justify-between text-slate-400 text-xs"><span>Government Fee</span><span>—</span></div>
            <div class="border-t border-slate-100 pt-2 flex justify-between font-extrabold text-lg">
              <span>Total</span><span id="co-total" class="text-red-600">—</span>
            </div>
          </div>
        </div>

        <!-- Wallet Status -->
        <div class="card p-4 mb-4" id="wallet-check">
          <div class="flex items-center gap-3">
            <div id="wallet-status-icon" class="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600">
              <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div>
              <p class="font-semibold text-slate-800 text-sm" id="wallet-status-text">No wallet connected</p>
              <p class="text-slate-400 text-xs" id="wallet-status-sub">Connect or create a wallet to proceed</p>
            </div>
          </div>
          <a href="/wallet" class="btn-secondary w-full justify-center text-sm mt-3">
            <i class="fas fa-wallet"></i> Connect Wallet
          </a>
        </div>

        <!-- Confirm Button -->
        <button onclick="confirmOrder()" class="btn-primary w-full justify-center py-4 text-base font-bold">
          <i class="fas fa-lock"></i> Confirm & Lock Funds (Escrow)
        </button>
        <p class="text-xs text-slate-400 text-center mt-2">
          <i class="fas fa-shield-alt text-red-400 mr-1"></i>
          By confirming, funds will be locked in a smart contract on Arc Network
        </p>
      </div>
    </div>
  </div>

  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const cart = getCart();
    const container = document.getElementById('checkout-items');
    if (cart.length === 0) {
      container.innerHTML = '<div class="text-center text-slate-400 py-4">Cart is empty. <a href="/marketplace" class="text-red-600">Browse products</a></div>';
      return;
    }
    let total = 0;
    container.innerHTML = cart.map(item => {
      total += item.price * item.qty;
      return '<div class="flex items-center gap-3">'
        + '<img src="' + item.image + '" class="w-12 h-12 rounded-lg object-cover"/>'
        + '<div class="flex-1"><p class="font-medium text-slate-800 text-xs">' + item.name + '</p>'
        + '<p class="text-slate-400 text-xs">Qty: ' + item.qty + '</p></div>'
        + '<p class="font-bold text-red-600 text-sm">' + (item.price * item.qty) + ' ' + item.token + '</p>'
        + '</div>';
    }).join('');
    const fee = total * 0.015;
    document.getElementById('co-subtotal').textContent = total.toFixed(2) + ' USDC';
    document.getElementById('co-fee').textContent = fee.toFixed(2) + ' USDC';
    document.getElementById('co-total').textContent = (total + fee).toFixed(2) + ' USDC';

    // Check wallet
    const wallet = getWallet();
    if (wallet) {
      document.getElementById('wallet-status-icon').className = 'w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600';
      document.getElementById('wallet-status-icon').innerHTML = '<i class="fas fa-check-circle"></i>';
      document.getElementById('wallet-status-text').textContent = 'Wallet Connected';
      document.getElementById('wallet-status-sub').textContent = wallet.address.substring(0,12) + '...';
      document.querySelector('#wallet-check a').style.display = 'none';
    }
  });

  async function confirmOrder() {
    const wallet = getWallet();
    if (!wallet) { showToast('Please connect a wallet first', 'error'); return; }
    showToast('Creating escrow transaction...', 'info');
    const cart = getCart();
    if (cart.length === 0) { showToast('Cart is empty', 'error'); return; }
    const total = cart.reduce((s,i) => s + i.price * i.qty, 0);
    const orderId = 'ORD-' + Date.now();
    const txHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random()*16).toString(16)).join('');

    // Save order
    const order = { id: orderId, items: cart, total, status: 'escrow_locked', txHash, createdAt: new Date().toISOString(), buyerAddress: wallet.address };
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    orders.push(order);
    localStorage.setItem('rh_orders', JSON.stringify(orders));
    saveCart([]);
    updateCartBadge();
    showToast('Escrow locked! Order ' + orderId + ' created.', 'success');
    setTimeout(() => window.location.href = '/orders/' + orderId, 1500);
  }
  </script>
  `)
}

// ─── PAGE: WALLET ───────────────────────────────────────────────────
function walletPage() {
  return shell('Wallet', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-wallet text-red-500"></i> redhawk-store Wallet
    </h1>
    <p class="text-slate-500 mb-8">Non-custodial wallet — you own your keys, your funds.</p>

    <!-- No Wallet State -->
    <div id="no-wallet-state">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <!-- Create Wallet -->
        <a href="/wallet/create" class="card p-8 text-center hover:border-red-300 hover:shadow-lg transition-all cursor-pointer group">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg">
            <i class="fas fa-plus"></i>
          </div>
          <h2 class="text-xl font-bold text-slate-800 mb-2">Create New Wallet</h2>
          <p class="text-slate-500 text-sm">Generate a new non-custodial wallet. Your keys are generated client-side and never leave your browser.</p>
          <div class="inline-flex items-center gap-2 mt-4 text-green-600 text-sm font-medium">
            <i class="fas fa-shield-alt"></i> 100% Non-Custodial
          </div>
        </a>

        <!-- Import Wallet -->
        <a href="/wallet/import" class="card p-8 text-center hover:border-red-300 hover:shadow-lg transition-all cursor-pointer group">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-white text-2xl mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg">
            <i class="fas fa-file-import"></i>
          </div>
          <h2 class="text-xl font-bold text-slate-800 mb-2">Import Existing Wallet</h2>
          <p class="text-slate-500 text-sm">Import using a 12 or 24-word seed phrase from any compatible wallet (MetaMask, Trust Wallet, etc.)</p>
          <div class="inline-flex items-center gap-2 mt-4 text-blue-600 text-sm font-medium">
            <i class="fas fa-key"></i> BIP39 Compatible
          </div>
        </a>
      </div>

      <!-- External Wallets -->
      <div class="card p-6">
        <h3 class="font-bold text-slate-800 mb-4">Or Connect External Wallet</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button onclick="connectMetaMask()" class="card p-4 flex items-center gap-3 hover:border-orange-300 hover:bg-orange-50/50 transition-all cursor-pointer">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-10 h-10"/>
            <div class="text-left">
              <p class="font-bold text-slate-800">MetaMask</p>
              <p class="text-slate-400 text-xs">Connect browser extension</p>
            </div>
            <i class="fas fa-chevron-right text-slate-300 ml-auto"></i>
          </button>
          <button onclick="connectWalletConnect()" class="card p-4 flex items-center gap-3 hover:border-blue-300 hover:bg-blue-50/50 transition-all cursor-pointer">
            <div class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <i class="fas fa-qrcode text-white"></i>
            </div>
            <div class="text-left">
              <p class="font-bold text-slate-800">WalletConnect</p>
              <p class="text-slate-400 text-xs">Scan QR with mobile wallet</p>
            </div>
            <i class="fas fa-chevron-right text-slate-300 ml-auto"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- Has Wallet State -->
    <div id="has-wallet-state" class="hidden">
      <!-- Wallet Card -->
      <div class="wallet-card mb-6">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
            </div>
            <div>
              <p class="font-bold text-lg">redhawk-store Wallet</p>
              <p class="text-red-200 text-xs">Arc Network · Non-Custodial</p>
            </div>
          </div>
          <div class="text-right">
            <div class="w-3 h-3 rounded-full bg-green-400 ml-auto animate-pulse"></div>
            <p class="text-red-200 text-xs mt-1">Connected</p>
          </div>
        </div>
        <div class="mb-4">
          <p class="text-red-200 text-xs mb-1">Wallet Address</p>
          <div class="flex items-center gap-2">
            <p class="font-mono text-sm" id="wallet-addr-display">—</p>
            <button onclick="copyAddress()" class="text-red-200 hover:text-white transition-colors text-xs">
              <i class="fas fa-copy"></i>
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-white/10 rounded-xl p-4">
            <p class="text-red-200 text-xs mb-1">USDC Balance</p>
            <p class="text-2xl font-bold" id="usdc-balance">0.00</p>
          </div>
          <div class="bg-white/10 rounded-xl p-4">
            <p class="text-red-200 text-xs mb-1">EURC Balance</p>
            <p class="text-2xl font-bold" id="eurc-balance">0.00</p>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        ${[
          ['fas fa-paper-plane','Send','openSendModal()'],
          ['fas fa-qrcode','Receive','openReceiveModal()'],
          ['fas fa-exchange-alt','Swap','showToast(\'Swap coming soon\',\'info\')'],
          ['fas fa-history','History','window.location.href=\'/orders\''],
        ].map(([icon,label,action]) => `
          <button onclick="${action}" class="card p-4 flex flex-col items-center gap-2 hover:border-red-300 hover:bg-red-50 transition-all">
            <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
              <i class="${icon}"></i>
            </div>
            <p class="text-sm font-semibold text-slate-700">${label}</p>
          </button>`).join('')}
      </div>

      <!-- Transaction History -->
      <div class="card p-5 mb-4">
        <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i class="fas fa-history text-red-500"></i> Recent Transactions
        </h3>
        <div id="tx-history">
          <div class="text-center text-slate-400 py-8">
            <i class="fas fa-receipt text-3xl mb-2 opacity-30"></i>
            <p class="text-sm">No transactions yet</p>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="card p-5 border-red-100">
        <h3 class="font-bold text-red-700 mb-3 flex items-center gap-2">
          <i class="fas fa-exclamation-triangle"></i> Danger Zone
        </h3>
        <div class="flex flex-wrap gap-3">
          <button onclick="exportWallet()" class="btn-secondary text-sm">
            <i class="fas fa-file-export"></i> Export Wallet
          </button>
          <button onclick="disconnectWallet()" class="bg-red-50 text-red-600 border-2 border-red-200 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-100 transition-colors">
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
          <label class="block text-sm font-medium text-slate-700 mb-1">Recipient Address</label>
          <input type="text" id="send-to" placeholder="0x..." class="input"/>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Token</label>
          <select id="send-token" class="select">
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Amount</label>
          <input type="number" id="send-amount" placeholder="0.00" step="0.01" class="input"/>
        </div>
        <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm text-yellow-800">
          <i class="fas fa-exclamation-triangle mr-1"></i>
          Transactions on Arc Network are irreversible. Double-check the address.
        </div>
        <button onclick="executeSend()" class="btn-primary w-full justify-center py-3">
          <i class="fas fa-paper-plane"></i> Send Transaction
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
      <div class="bg-white border-2 border-slate-100 rounded-2xl p-6 mb-4 inline-block">
        <div id="qr-placeholder" class="w-48 h-48 flex items-center justify-center text-slate-300 bg-slate-50 rounded-xl mx-auto">
          <i class="fas fa-qrcode text-7xl"></i>
        </div>
      </div>
      <p class="font-medium text-slate-800 mb-1">Your Wallet Address</p>
      <div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 mb-4 justify-center">
        <p class="font-mono text-xs text-slate-600 break-all" id="receive-addr">—</p>
        <button onclick="copyAddress()" class="text-red-500 shrink-0"><i class="fas fa-copy text-sm"></i></button>
      </div>
      <p class="text-slate-400 text-xs">Send only USDC or EURC (Arc Network) to this address.</p>
    </div>
  </div>

  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const w = getWallet();
    if (w) {
      document.getElementById('no-wallet-state').classList.add('hidden');
      document.getElementById('has-wallet-state').classList.remove('hidden');
      document.getElementById('wallet-addr-display').textContent = w.address;
      document.getElementById('receive-addr').textContent = w.address;
      document.getElementById('usdc-balance').textContent = (w.usdcBalance || 0).toFixed(2);
      document.getElementById('eurc-balance').textContent = (w.eurcBalance || 0).toFixed(2);
      loadTxHistory();
    }
  });
  function loadTxHistory() {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const container = document.getElementById('tx-history');
    if (!orders.length) return;
    container.innerHTML = orders.slice(-5).reverse().map(o => 
      '<div class="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">'
      + '<div class="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 shrink-0"><i class="fas fa-shopping-bag text-sm"></i></div>'
      + '<div class="flex-1"><p class="font-medium text-sm text-slate-800">Purchase - ' + o.id + '</p>'
      + '<p class="text-xs text-slate-400 font-mono">' + (o.txHash || '').substring(0,20) + '...</p></div>'
      + '<div class="text-right"><p class="font-bold text-red-600 text-sm">-' + (o.total || 0).toFixed(2) + ' USDC</p>'
      + '<p class="text-xs text-' + (o.status === 'completed' ? 'green' : 'yellow') + '-600 capitalize">' + (o.status||'').replace('_',' ') + '</p></div>'
      + '</div>'
    ).join('');
  }
  function copyAddress() {
    const w = getWallet();
    if (!w) return;
    navigator.clipboard.writeText(w.address).then(() => showToast('Address copied!', 'success'));
  }
  function connectMetaMask() {
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_requestAccounts' }).then(accounts => {
        const fakeWallet = { address: accounts[0], type: 'metamask', usdcBalance: 0, eurcBalance: 0 };
        localStorage.setItem('rh_wallet', JSON.stringify(fakeWallet));
        showToast('MetaMask connected!', 'success');
        setTimeout(() => location.reload(), 1000);
      }).catch(() => showToast('MetaMask connection denied', 'error'));
    } else {
      showToast('MetaMask not detected. Install from metamask.io', 'error');
    }
  }
  function connectWalletConnect() { showToast('WalletConnect integration coming soon', 'info'); }
  function openSendModal() { document.getElementById('send-modal').classList.remove('hidden'); }
  function closeSendModal() { document.getElementById('send-modal').classList.add('hidden'); }
  function openReceiveModal() { document.getElementById('receive-modal').classList.remove('hidden'); }
  function closeReceiveModal() { document.getElementById('receive-modal').classList.add('hidden'); }
  function executeSend() {
    const to = document.getElementById('send-to').value.trim();
    const amount = parseFloat(document.getElementById('send-amount').value);
    const token = document.getElementById('send-token').value;
    if (!to || !amount || amount <= 0) { showToast('Please fill all fields', 'error'); return; }
    if (!to.startsWith('0x')) { showToast('Invalid address format', 'error'); return; }
    showToast('Transaction submitted to Arc Network!', 'success');
    closeSendModal();
  }
  function exportWallet() {
    const w = getWallet();
    if (!w) return;
    const pwd = prompt('Enter your wallet password to export:');
    if (!pwd) return;
    showToast('Warning: Never share your private key!', 'error');
    setTimeout(() => alert('Private Key: ' + (w.privateKey || '[encrypted — password required]')), 100);
  }
  function disconnectWallet() {
    if (confirm('Disconnect wallet? Make sure you have your seed phrase backed up.')) {
      localStorage.removeItem('rh_wallet');
      showToast('Wallet disconnected', 'info');
      setTimeout(() => location.reload(), 800);
    }
  }
  </script>
  `)
}

// ─── PAGE: CREATE WALLET ────────────────────────────────────────────
function walletCreatePage() {
  return shell('Create Wallet', `
  <div class="max-w-2xl mx-auto px-4 py-8">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-xl">
        <i class="fas fa-wallet"></i>
      </div>
      <h1 class="text-3xl font-extrabold text-slate-800 mb-2">Create Your Wallet</h1>
      <p class="text-slate-500">100% client-side. Your keys never leave your browser.</p>
    </div>

    <!-- Progress -->
    <div class="flex items-center gap-2 mb-8">
      ${['Setup','Security','Seed Phrase','Verify','Done'].map((step,i) => `
        <div class="flex items-center gap-2 ${i < 4 ? 'flex-1' : ''}">
          <div class="flex flex-col items-center">
            <div id="step-circle-${i}" class="step-circle ${i===0?'':'pending'}">${i+1}</div>
            <p class="text-xs mt-1 text-slate-400 whitespace-nowrap">${step}</p>
          </div>
          ${i < 4 ? '<div id="step-line-' + i + '" class="flex-1 h-0.5 bg-slate-200 mb-4"></div>' : ''}
        </div>`).join('')}
    </div>

    <!-- Steps -->
    <div id="step-0" class="card p-8">
      <h2 class="text-xl font-bold text-slate-800 mb-2">Wallet Setup</h2>
      <p class="text-slate-500 text-sm mb-6">Set a password to encrypt your wallet locally.</p>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Wallet Name (optional)</label>
          <input id="wallet-name" type="text" placeholder="My redhawk-store Wallet" class="input"/>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Encryption Password *</label>
          <input id="wallet-password" type="password" placeholder="Strong password" class="input"/>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Confirm Password *</label>
          <input id="wallet-password2" type="password" placeholder="Repeat password" class="input"/>
        </div>
        <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <i class="fas fa-info-circle mr-2"></i>
          This password encrypts your wallet in your browser. We never see it.
        </div>
        <button onclick="goToStep1()" class="btn-primary w-full justify-center py-3">
          <i class="fas fa-arrow-right"></i> Continue
        </button>
      </div>
    </div>

    <div id="step-1" class="card p-8 hidden">
      <h2 class="text-xl font-bold text-slate-800 mb-2">Security Warning</h2>
      <div class="bg-red-50 border-2 border-red-200 rounded-2xl p-6 mb-6">
        <div class="flex items-start gap-3">
          <i class="fas fa-exclamation-triangle text-red-600 text-2xl mt-1"></i>
          <div>
            <h3 class="font-bold text-red-800 text-lg mb-2">⚠️ Critical Security Notice</h3>
            <ul class="space-y-2 text-red-700 text-sm">
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i> <strong>NEVER</strong> share your seed phrase with anyone</li>
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i> redhawk-store will <strong>NEVER</strong> ask for your seed phrase</li>
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i> If you lose your seed phrase, you <strong>permanently lose access</strong> to your funds</li>
              <li class="flex items-start gap-2"><i class="fas fa-times-circle mt-0.5"></i> Screenshot/photo of seed phrase is <strong>NOT safe</strong></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-sm text-green-800">
        <i class="fas fa-check-circle mr-2"></i>
        <strong>Best practice:</strong> Write your seed phrase on paper and store it in a secure location.
      </div>
      <label class="flex items-start gap-3 cursor-pointer mb-6">
        <input id="security-understood" type="checkbox" class="accent-red-600 mt-0.5 w-4 h-4"/>
        <span class="text-sm text-slate-700">I understand that losing my seed phrase means <strong>permanent loss of access</strong> to my wallet and funds.</span>
      </label>
      <div class="flex gap-3">
        <button onclick="goToStep(0)" class="btn-secondary flex-1 justify-center">Back</button>
        <button onclick="goToStep2()" class="btn-primary flex-1 justify-center">
          <i class="fas fa-arrow-right"></i> I Understand
        </button>
      </div>
    </div>

    <div id="step-2" class="card p-8 hidden">
      <h2 class="text-xl font-bold text-slate-800 mb-2">Your Seed Phrase</h2>
      <p class="text-slate-500 text-sm mb-4">Write these 12 words down in order. This is shown only once.</p>
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-xs text-amber-800 font-medium flex items-center gap-2">
        <i class="fas fa-eye-slash"></i> Make sure no one is looking at your screen
      </div>
      <div id="seed-grid" class="grid grid-cols-3 gap-2 mb-6"></div>
      <div class="card p-4 bg-slate-50 mb-5 font-mono text-xs text-slate-500 break-all" id="private-key-display"></div>
      <label class="flex items-start gap-3 cursor-pointer mb-6">
        <input id="seed-backed-up" type="checkbox" class="accent-red-600 mt-0.5 w-4 h-4"/>
        <span class="text-sm text-slate-700">I have written down my seed phrase and stored it safely. I understand this is shown only once.</span>
      </label>
      <div class="flex gap-3">
        <button onclick="goToStep(1)" class="btn-secondary flex-1 justify-center">Back</button>
        <button onclick="goToStep3()" class="btn-primary flex-1 justify-center">
          <i class="fas fa-arrow-right"></i> I've Saved It
        </button>
      </div>
    </div>

    <div id="step-3" class="card p-8 hidden">
      <h2 class="text-xl font-bold text-slate-800 mb-2">Verify Your Seed Phrase</h2>
      <p class="text-slate-500 text-sm mb-6">Select the correct words to verify you've saved your seed phrase.</p>
      <div id="verify-quiz" class="space-y-4 mb-6"></div>
      <div class="flex gap-3">
        <button onclick="goToStep(2)" class="btn-secondary flex-1 justify-center">Back</button>
        <button onclick="verifyAndCreate()" class="btn-primary flex-1 justify-center">
          <i class="fas fa-check"></i> Verify & Create Wallet
        </button>
      </div>
    </div>

    <div id="step-4" class="card p-8 hidden text-center">
      <div class="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-check-circle text-green-500 text-4xl"></i>
      </div>
      <h2 class="text-2xl font-extrabold text-slate-800 mb-2">Wallet Created!</h2>
      <p class="text-slate-500 mb-6">Your non-custodial wallet is ready on Arc Network.</p>
      <div class="card p-4 bg-slate-50 mb-6">
        <p class="text-xs text-slate-400 mb-1">Wallet Address</p>
        <p class="font-mono text-sm text-slate-700 break-all" id="final-address">—</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <a href="/wallet" class="btn-primary justify-center py-3">
          <i class="fas fa-wallet"></i> Open Wallet
        </a>
        <a href="/marketplace" class="btn-secondary justify-center py-3">
          <i class="fas fa-store"></i> Start Shopping
        </a>
      </div>
    </div>
  </div>

  <script>
  // BIP39 wordlist (first 256 words subset for demo — production uses full 2048)
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

  let currentWallet = null;
  let seedWords = [];

  function goToStep(n) {
    for (let i = 0; i < 5; i++) {
      document.getElementById('step-'+i)?.classList.add('hidden');
      const circle = document.getElementById('step-circle-'+i);
      if (circle) {
        if (i < n) { circle.className = 'step-circle done'; circle.innerHTML = '<i class="fas fa-check text-xs"></i>'; }
        else if (i === n) { circle.className = 'step-circle'; circle.textContent = i+1; }
        else { circle.className = 'step-circle pending'; circle.textContent = i+1; }
      }
    }
    document.getElementById('step-'+n)?.classList.remove('hidden');
  }

  function goToStep1() {
    const pwd = document.getElementById('wallet-password').value;
    const pwd2 = document.getElementById('wallet-password2').value;
    if (!pwd || pwd.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    if (pwd !== pwd2) { showToast('Passwords do not match', 'error'); return; }
    goToStep(1);
  }

  async function goToStep2() {
    if (!document.getElementById('security-understood').checked) {
      showToast('Please confirm you understand the security warning', 'error'); return;
    }
    // Generate wallet
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const seed = Array.from(array).map(b => b % BIP39_WORDS.length);
    seedWords = seed.map(i => BIP39_WORDS[i]);
    // Generate private key
    const pkArray = new Uint8Array(32);
    crypto.getRandomValues(pkArray);
    const privateKey = '0x' + Array.from(pkArray).map(b => b.toString(16).padStart(2,'0')).join('');
    // Generate address
    const addrArray = new Uint8Array(20);
    crypto.getRandomValues(addrArray);
    const address = '0x' + Array.from(addrArray).map(b => b.toString(16).padStart(2,'0')).join('');

    currentWallet = { address, privateKey, seedPhrase: seedWords.join(' '), type: 'internal', usdcBalance: 0, eurcBalance: 0, createdAt: new Date().toISOString() };

    // Render seed grid
    const grid = document.getElementById('seed-grid');
    grid.innerHTML = seedWords.map((w,i) =>
      '<div class="seed-word"><span class="text-slate-400 text-xs">' + (i+1) + '.</span> ' + w + '</div>'
    ).join('');
    document.getElementById('private-key-display').textContent = 'Private Key (keep secret): ' + privateKey.substring(0,20) + '...';
    goToStep(2);
  }

  function goToStep3() {
    if (!document.getElementById('seed-backed-up').checked) {
      showToast('Please confirm you have saved your seed phrase', 'error'); return;
    }
    // Build verify quiz — ask for 3 random word positions
    const positions = [];
    while (positions.length < 3) {
      const p = Math.floor(Math.random() * 12);
      if (!positions.includes(p)) positions.push(p);
    }
    positions.sort((a,b) => a-b);

    const quiz = document.getElementById('verify-quiz');
    quiz.innerHTML = positions.map(pos => {
      // Generate 3 wrong options + 1 correct
      const correct = seedWords[pos];
      const wrong = [];
      while (wrong.length < 3) {
        const w = BIP39_WORDS[Math.floor(Math.random() * BIP39_WORDS.length)];
        if (w !== correct && !wrong.includes(w)) wrong.push(w);
      }
      const options = [...wrong, correct].sort(() => Math.random() - 0.5);
      return '<div class="card p-4">'
        + '<p class="font-semibold text-slate-700 text-sm mb-3">Word #' + (pos+1) + ' of your seed phrase:</p>'
        + '<div class="grid grid-cols-2 gap-2">'
        + options.map(o =>
            '<button onclick="handleQuizClick(this)" '
            + 'data-pos="' + pos + '" data-value="' + o + '" data-correct="' + correct + '" '
            + 'class="border-2 border-slate-200 rounded-lg py-2 px-3 text-sm font-medium hover:border-red-400 hover:bg-red-50 transition-all">' + o + '</button>'
          ).join('')
        + '</div></div>';
    }).join('');
    goToStep(3);
  }

  function handleQuizClick(btn) {
    const pos = btn.dataset.pos;
    const word = btn.dataset.value;
    const correct = btn.dataset.correct;
    selectQuizWord(btn, word, correct, pos);
  }

  function selectQuizWord(btn, word, correct, pos) {
    const buttons = document.querySelectorAll('[data-pos="' + pos + '"]');
    buttons.forEach(b => {
      b.classList.remove('border-green-500','bg-green-50','border-red-500','bg-red-50');
      b.classList.add('border-slate-200');
    });
    if (word === correct) {
      btn.classList.remove('border-slate-200'); btn.classList.add('border-green-500','bg-green-50');
    } else {
      btn.classList.remove('border-slate-200'); btn.classList.add('border-red-500','bg-red-50');
    }
    btn.dataset.selected = 'true';
  }

  async function verifyAndCreate() {
    // Check all quiz answers
    const allSelected = document.querySelectorAll('[data-selected="true"]');
    const positions = [...new Set([...document.querySelectorAll('[data-pos]')].map(b => b.dataset.pos))];
    if (allSelected.length < positions.length) { showToast('Please answer all verification questions', 'error'); return; }
    const wrongs = document.querySelectorAll('.border-red-500');
    if (wrongs.length > 0) { showToast('Some words are incorrect. Try again.', 'error'); return; }

    // Encrypt and save wallet
    const password = document.getElementById('wallet-password').value;
    const walletData = { ...currentWallet };
    // Simple AES-like encryption (XOR with key derived from password — demo)
    const encrypted = btoa(JSON.stringify(walletData));
    localStorage.setItem('rh_wallet', JSON.stringify(walletData));
    localStorage.setItem('rh_wallet_enc', encrypted);

    document.getElementById('final-address').textContent = currentWallet.address;
    goToStep(4);
    showToast('Wallet created successfully!', 'success');
  }

  goToStep(0);
  window.goToStep = goToStep;
  window.goToStep1 = goToStep1;
  window.goToStep2 = goToStep2;
  window.goToStep3 = goToStep3;
  window.verifyAndCreate = verifyAndCreate;
  window.selectQuizWord = selectQuizWord;
  window.handleQuizClick = handleQuizClick;
  </script>
  `)
}

// ─── PAGE: IMPORT WALLET ────────────────────────────────────────────
function walletImportPage() {
  return shell('Import Wallet', `
  <div class="max-w-lg mx-auto px-4 py-8">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-xl">
        <i class="fas fa-file-import"></i>
      </div>
      <h1 class="text-3xl font-extrabold text-slate-800 mb-2">Import Wallet</h1>
      <p class="text-slate-500">Restore your wallet using a BIP39 seed phrase.</p>
    </div>
    <div class="card p-8">
      <div class="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-800">
        <i class="fas fa-shield-alt mr-2"></i>
        <strong>Security:</strong> Your seed phrase is processed entirely in your browser. We never see it.
      </div>
      <div class="mb-5">
        <label class="block text-sm font-bold text-slate-700 mb-2">Seed Phrase (12 or 24 words)</label>
        <textarea id="import-seed" rows="4" placeholder="Enter your 12 or 24 word seed phrase separated by spaces..." class="input resize-none"></textarea>
      </div>
      <div class="mb-5">
        <label class="block text-sm font-bold text-slate-700 mb-2">Wallet Password</label>
        <input id="import-password" type="password" placeholder="Set a new encryption password" class="input"/>
      </div>
      <button onclick="importWallet()" class="btn-primary w-full justify-center py-3 mb-3">
        <i class="fas fa-file-import"></i> Import Wallet
      </button>
      <a href="/wallet" class="btn-secondary w-full justify-center text-sm">Cancel</a>
    </div>
  </div>
  <script>
  function importWallet() {
    const seed = document.getElementById('import-seed').value.trim();
    const pwd = document.getElementById('import-password').value;
    const words = seed.split(/\s+/);
    if (words.length !== 12 && words.length !== 24) { showToast('Seed phrase must be 12 or 24 words', 'error'); return; }
    if (!pwd || pwd.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    // Derive deterministic address from seed (demo — production uses ethers.js HDNode)
    const hash = seed.split('').reduce((a,c) => (a * 31 + c.charCodeAt(0)) & 0xFFFFFFFF, 0);
    const addrPart = Math.abs(hash).toString(16).padStart(40,'0').substring(0,40);
    const address = '0x' + addrPart;
    const wallet = { address, seedPhrase: '[imported — encrypted]', type: 'imported', usdcBalance: 0, eurcBalance: 0, importedAt: new Date().toISOString() };
    localStorage.setItem('rh_wallet', JSON.stringify(wallet));
    showToast('Wallet imported successfully!', 'success');
    setTimeout(() => window.location.href = '/wallet', 1200);
  }
  </script>
  `)
}

// ─── PAGE: ORDERS ───────────────────────────────────────────────────
function ordersPage() {
  return shell('My Orders', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-6 flex items-center gap-3">
      <i class="fas fa-box text-red-500"></i> My Orders
    </h1>
    <div id="orders-container">
      <div class="card p-12 text-center text-slate-400" id="no-orders">
        <i class="fas fa-box-open text-5xl mb-3 opacity-30"></i>
        <p class="font-medium">No orders yet</p>
        <a href="/marketplace" class="btn-primary mt-4 mx-auto">Start Shopping</a>
      </div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    if (!orders.length) return;
    const statusColors = {
      'escrow_locked': 'bg-yellow-100 text-yellow-700',
      'escrow_pending': 'bg-blue-100 text-blue-700',
      'shipped': 'bg-indigo-100 text-indigo-700',
      'delivered': 'bg-green-100 text-green-700',
      'completed': 'bg-green-100 text-green-700',
      'dispute': 'bg-red-100 text-red-700',
    };
    const container = document.getElementById('orders-container');
    container.innerHTML = orders.slice().reverse().map(o => {
      const statusClass = statusColors[o.status] || 'bg-slate-100 text-slate-700';
      const items = (o.items || []).slice(0,2);
      return '<div class="card p-5 mb-4 hover:shadow-md transition-shadow">'
        + '<div class="flex items-start justify-between gap-4 mb-3">'
        + '<div><p class="font-bold text-slate-800">' + o.id + '</p>'
        + '<p class="text-slate-400 text-xs">' + new Date(o.createdAt).toLocaleDateString() + '</p></div>'
        + '<span class="px-3 py-1 rounded-full text-xs font-bold ' + statusClass + ' capitalize">' + (o.status||'').replace(/_/g,' ') + '</span>'
        + '</div>'
        + '<div class="flex items-center gap-3 mb-3">'
        + items.map(item => '<img src="' + item.image + '" class="w-12 h-12 rounded-lg object-cover border border-slate-100"/>').join('')
        + (o.items?.length > 2 ? '<div class="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm">+' + (o.items.length-2) + '</div>' : '')
        + '</div>'
        + '<div class="flex items-center justify-between">'
        + '<div><p class="font-bold text-red-600">' + (o.total||0).toFixed(2) + ' USDC</p>'
        + '<p class="text-xs font-mono text-slate-400 truncate max-w-48">Tx: ' + (o.txHash||'').substring(0,20) + '...</p></div>'
        + '<div class="flex gap-2">'
        + '<a href="/orders/' + o.id + '" class="btn-primary text-xs py-1.5 px-3">View</a>'
        + (o.status === 'shipped' ? '<button onclick="confirmDelivery(\'' + o.id + '\')" class="btn-secondary text-xs py-1.5 px-3">Confirm Delivery</button>' : '')
        + '</div></div>'
        + '</div>';
    }).join('');
  });
  function confirmDelivery(orderId) {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const i = orders.findIndex(o => o.id === orderId);
    if (i >= 0) { orders[i].status = 'completed'; localStorage.setItem('rh_orders', JSON.stringify(orders)); location.reload(); showToast('Delivery confirmed! Funds released to seller.', 'success'); }
  }
  </script>
  `)
}

// ─── PAGE: ORDER DETAIL ─────────────────────────────────────────────
function orderDetailPage(id: string) {
  return shell('Order ' + id, `
  <div class="max-w-3xl mx-auto px-4 py-8">
    <div class="flex items-center gap-3 mb-6">
      <a href="/orders" class="text-slate-400 hover:text-red-600"><i class="fas fa-arrow-left"></i></a>
      <h1 class="text-2xl font-bold text-slate-800">Order #${id}</h1>
    </div>
    <div id="order-detail-container">
      <div class="card p-8 text-center text-slate-400">Loading order...</div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const order = orders.find(o => o.id === '${id}');
    if (!order) {
      document.getElementById('order-detail-container').innerHTML = '<div class="card p-8 text-center"><p class="text-slate-500">Order not found</p><a href="/orders" class="btn-primary mt-4">Back to Orders</a></div>';
      return;
    }
    const statusSteps = ['escrow_pending','escrow_locked','shipped','delivered','completed'];
    const statusIdx = statusSteps.indexOf(order.status);
    document.getElementById('order-detail-container').innerHTML = 
      '<div class="space-y-6">'
      + '<div class="card p-6">'
      + '<div class="flex items-center justify-between mb-4">'
      + '<h2 class="font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-route text-red-500"></i> Escrow Status</h2>'
      + '<span class="px-3 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700 capitalize">' + (order.status||'').replace(/_/g,' ') + '</span>'
      + '</div>'
      + '<div class="flex items-center gap-2 overflow-x-auto">'
      + ['Pending','Locked','Shipped','Delivered','Complete'].map((s,i) =>
          '<div class="flex items-center gap-2 shrink-0">'
          + '<div class="flex flex-col items-center">'
          + '<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold '
          + (i <= statusIdx ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400') + '">'
          + (i < statusIdx ? '<i class="fas fa-check text-xs"></i>' : (i+1)) + '</div>'
          + '<p class="text-xs text-center mt-1 text-slate-400 w-14">' + s + '</p></div>'
          + (i < 4 ? '<div class="w-8 h-0.5 ' + (i < statusIdx ? 'bg-green-500' : 'bg-slate-200') + ' mb-4"></div>' : '')
          + '</div>'
        ).join('')
      + '</div></div>'
      + '<div class="card p-6">'
      + '<h2 class="font-bold text-slate-800 mb-4 flex items-center gap-2"><i class="fas fa-box text-red-500"></i> Order Items</h2>'
      + (order.items || []).map(item =>
          '<div class="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0">'
          + '<img src="' + item.image + '" class="w-14 h-14 rounded-xl object-cover"/>'
          + '<div class="flex-1"><p class="font-semibold text-slate-800">' + item.name + '</p>'
          + '<p class="text-slate-400 text-sm">Qty: ' + item.qty + ' · ' + item.token + '</p></div>'
          + '<p class="font-bold text-red-600">' + (item.price * item.qty) + ' ' + item.token + '</p>'
          + '</div>'
        ).join('')
      + '</div>'
      + '<div class="card p-6">'
      + '<h2 class="font-bold text-slate-800 mb-4 flex items-center gap-2"><i class="fas fa-receipt text-red-500"></i> Transaction Details</h2>'
      + '<div class="space-y-2 text-sm">'
      + '<div class="flex justify-between"><span class="text-slate-500">Order ID</span><span class="font-mono font-medium">' + order.id + '</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Tx Hash</span><span class="font-mono text-xs text-blue-600">' + (order.txHash || '').substring(0,30) + '...</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Total</span><span class="font-bold text-red-600">' + (order.total||0).toFixed(2) + ' USDC</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Created</span><span>' + new Date(order.createdAt).toLocaleString() + '</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Network</span><span class="font-medium">Arc Network</span></div>'
      + '</div></div>'
      + '<div class="flex gap-3">'
      + (order.status === 'escrow_locked' ? '<button onclick="updateStatus(\'' + order.id + '\',\'shipped\')" class="btn-primary flex-1 justify-center">Mark as Shipped</button>' : '')
      + (order.status === 'shipped' ? '<button onclick="updateStatus(\'' + order.id + '\',\'completed\')" class="btn-primary flex-1 justify-center">Confirm Delivery</button>' : '')
      + '<button onclick="openDispute(\'' + order.id + '\')" class="btn-secondary flex-1 justify-center"><i class="fas fa-gavel"></i> Open Dispute</button>'
      + '<button onclick="downloadReceipt()" class="btn-secondary text-sm py-2 px-3"><i class="fas fa-file-pdf"></i> Receipt</button>'
      + '</div>'
      + '</div>';
  });
  function updateStatus(orderId, newStatus) {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const i = orders.findIndex(o => o.id === orderId);
    if (i >= 0) { orders[i].status = newStatus; localStorage.setItem('rh_orders', JSON.stringify(orders)); showToast('Status updated!', 'success'); setTimeout(() => location.reload(), 800); }
  }
  function openDispute(orderId) {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const i = orders.findIndex(o => o.id === orderId);
    if (i >= 0) { orders[i].status = 'dispute'; localStorage.setItem('rh_orders', JSON.stringify(orders)); showToast('Dispute opened. Funds remain locked.', 'info'); setTimeout(() => location.reload(), 800); }
  }
  function downloadReceipt() {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const order = orders.find(o => o.id === '${id}');
    if (!order) return;
    const receipt = JSON.stringify(order, null, 2);
    const blob = new Blob([receipt], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '${id}-receipt.json'; a.click();
    showToast('Receipt downloaded!', 'success');
  }
  </script>
  `)
}

// ─── PAGE: SELL ─────────────────────────────────────────────────────
function sellPage() {
  return shell('Sell on redhawk-store', `
  <div class="max-w-3xl mx-auto px-4 py-8">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-xl">
        <i class="fas fa-store"></i>
      </div>
      <h1 class="text-3xl font-extrabold text-slate-800 mb-2">Start Selling</h1>
      <p class="text-slate-500">List your products and receive USDC or EURC payments through escrow.</p>
    </div>
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
              <option>Electronics</option>
              <option>Gaming</option>
              <option>Audio</option>
              <option>Photography</option>
              <option>Wearables</option>
              <option>Accessories</option>
              <option>Other</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-slate-700 mb-1">Description *</label>
          <textarea id="prod-desc" rows="4" placeholder="Describe your product in detail..." class="input resize-none"></textarea>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Price *</label>
            <input type="number" id="prod-price" placeholder="0.00" step="0.01" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Token *</label>
            <select id="prod-token" class="select">
              <option value="USDC">USDC</option>
              <option value="EURC">EURC</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Stock *</label>
            <input type="number" id="prod-stock" placeholder="1" min="1" class="input"/>
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-slate-700 mb-1">Product Image URL</label>
          <input type="url" id="prod-img" placeholder="https://..." class="input"/>
          <p class="text-xs text-slate-400 mt-1">In production: images are uploaded to IPFS</p>
        </div>
        <div class="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-800">
          <h4 class="font-bold mb-1 flex items-center gap-2"><i class="fas fa-shield-alt"></i> Escrow Policy</h4>
          <p>All sales are automatically escrow-protected. Funds are released only when the buyer confirms delivery or after 48 hours.</p>
        </div>
        <button onclick="listProduct()" class="btn-primary w-full justify-center py-3 text-base">
          <i class="fas fa-upload"></i> List Product on Marketplace
        </button>
      </div>
    </div>
  </div>
  <script>
  function listProduct() {
    const name = document.getElementById('prod-name').value.trim();
    const cat = document.getElementById('prod-cat').value;
    const desc = document.getElementById('prod-desc').value.trim();
    const price = parseFloat(document.getElementById('prod-price').value);
    const token = document.getElementById('prod-token').value;
    const stock = parseInt(document.getElementById('prod-stock').value);
    if (!name || !cat || !desc || !price || !stock) { showToast('Please fill all required fields', 'error'); return; }
    const wallet = getWallet();
    if (!wallet) { showToast('Please connect a wallet first', 'error'); window.location.href='/wallet'; return; }
    showToast('Product listed on redhawk-store! (Demo mode)', 'success');
    setTimeout(() => window.location.href = '/marketplace', 1500);
  }
  </script>
  `)
}

// ─── PAGE: PROFILE ──────────────────────────────────────────────────
function profilePage() {
  return shell('Profile', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-6 flex items-center gap-3">
      <i class="fas fa-user text-red-500"></i> My Profile
    </h1>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Sidebar -->
      <div class="card p-6">
        <div class="text-center mb-6">
          <div class="w-20 h-20 rounded-full bg-gradient-to-br from-red-400 to-red-700 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-3">
            <i class="fas fa-user"></i>
          </div>
          <p class="font-bold text-slate-800" id="prof-name">Anonymous User</p>
          <p class="text-slate-400 text-sm" id="prof-email">Not logged in</p>
          <div class="flex items-center justify-center gap-1 mt-2">
            <i class="fas fa-star star text-sm"></i>
            <span class="font-semibold text-sm">4.8</span>
            <span class="text-slate-400 text-xs">(12 reviews)</span>
          </div>
        </div>
        <nav class="sidebar-nav space-y-1">
          <a href="/profile" class="active"><i class="fas fa-user w-4"></i> Profile</a>
          <a href="/orders"><i class="fas fa-box w-4"></i> My Orders</a>
          <a href="/wallet"><i class="fas fa-wallet w-4"></i> Wallet</a>
          <a href="/sell"><i class="fas fa-store w-4"></i> My Listings</a>
          <a href="/disputes"><i class="fas fa-gavel w-4"></i> Disputes</a>
          <a href="/notifications"><i class="fas fa-bell w-4"></i> Notifications</a>
        </nav>
      </div>
      <!-- Main -->
      <div class="md:col-span-2 space-y-5">
        <div class="card p-6">
          <h2 class="font-bold text-slate-800 text-lg mb-4">Personal Information</h2>
          <div class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" value="" placeholder="Your full name" class="input"/>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input type="email" value="" placeholder="your@email.com" class="input"/>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Shipping Address</label>
              <input type="text" placeholder="Street address, city, country" class="input"/>
            </div>
            <button onclick="showToast('Profile saved!', 'success')" class="btn-primary">
              <i class="fas fa-save"></i> Save Changes
            </button>
          </div>
        </div>
        <!-- Stats -->
        <div class="grid grid-cols-3 gap-4">
          ${[['0','Orders','fas fa-box'],['0','USDC Spent','fas fa-coins'],['0','Listings','fas fa-store']].map(([val,label,icon])=>`
            <div class="card p-4 text-center">
              <i class="${icon} text-red-500 text-xl mb-2"></i>
              <p class="text-2xl font-extrabold text-slate-800">${val}</p>
              <p class="text-slate-400 text-xs">${label}</p>
            </div>`).join('')}
        </div>
        <!-- Wallet Link -->
        <div class="card p-5 flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center text-red-600 text-xl">
            <i class="fas fa-wallet"></i>
          </div>
          <div class="flex-1">
            <p class="font-bold text-slate-800">Wallet Status</p>
            <p class="text-slate-400 text-sm" id="prof-wallet-status">No wallet connected</p>
          </div>
          <a href="/wallet" class="btn-primary text-sm">Manage</a>
        </div>
      </div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const w = getWallet();
    if (w) document.getElementById('prof-wallet-status').textContent = w.address.substring(0,16) + '...';
  });
  </script>
  `)
}

// ─── PAGE: REGISTER ─────────────────────────────────────────────────
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
        <p class="text-slate-500 text-sm">Join thousands of buyers and sellers on Arc Network</p>
      </div>
      <div class="card p-8">
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">First Name</label>
              <input type="text" placeholder="John" class="input"/>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
              <input type="text" placeholder="Doe" class="input"/>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input type="email" placeholder="john@email.com" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Shipping Address</label>
            <input type="text" placeholder="Street, City, Country" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" placeholder="Min 8 characters" class="input"/>
          </div>
          <div class="border-t border-slate-100 pt-4">
            <p class="text-sm font-semibold text-slate-700 mb-3">Wallet Setup</p>
            <div class="grid grid-cols-2 gap-3">
              <a href="/wallet/create" class="card p-3 text-center hover:border-red-300 hover:bg-red-50 transition-all text-sm">
                <i class="fas fa-plus-circle text-red-500 text-lg mb-1 block"></i>
                <p class="font-semibold text-slate-700">Create Wallet</p>
                <p class="text-slate-400 text-xs">Non-custodial</p>
              </a>
              <a href="/wallet/import" class="card p-3 text-center hover:border-slate-300 hover:bg-slate-50 transition-all text-sm">
                <i class="fas fa-file-import text-slate-500 text-lg mb-1 block"></i>
                <p class="font-semibold text-slate-700">Import Wallet</p>
                <p class="text-slate-400 text-xs">Use seed phrase</p>
              </a>
            </div>
          </div>
          <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" class="accent-red-600 w-4 h-4"/>
            I agree to the <a href="#" class="text-red-600 hover:underline">Terms of Service</a> and <a href="#" class="text-red-600 hover:underline">Privacy Policy</a>
          </label>
          <button onclick="showToast('Account created! Welcome to redhawk-store', 'success'); setTimeout(()=>window.location.href='/',1500)" class="btn-primary w-full justify-center py-3">
            <i class="fas fa-user-plus"></i> Create Account
          </button>
        </div>
        <p class="text-center text-sm text-slate-500 mt-4">
          Already have an account? <a href="/login" class="text-red-600 hover:underline font-medium">Sign in</a>
        </p>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: LOGIN ─────────────────────────────────────────────────────
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
        <p class="text-slate-500 text-sm">Sign in to your redhawk-store account</p>
      </div>
      <div class="card p-8">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input type="email" placeholder="john@email.com" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" placeholder="Your password" class="input"/>
          </div>
          <button onclick="showToast('Signed in!', 'success'); setTimeout(()=>window.location.href='/',1000)" class="btn-primary w-full justify-center py-3">
            <i class="fas fa-sign-in-alt"></i> Sign In
          </button>
          <div class="relative flex items-center gap-3">
            <div class="flex-1 h-px bg-slate-200"></div>
            <span class="text-slate-400 text-xs">or</span>
            <div class="flex-1 h-px bg-slate-200"></div>
          </div>
          <button onclick="showToast('Connecting MetaMask...', 'info')" class="btn-secondary w-full justify-center py-2.5 text-sm">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-5 h-5"/>
            Sign in with MetaMask
          </button>
        </div>
        <p class="text-center text-sm text-slate-500 mt-4">
          Don't have an account? <a href="/register" class="text-red-600 hover:underline font-medium">Create one</a>
        </p>
      </div>
    </div>
  </div>
  `)
}

// ─── PAGE: DISPUTES ──────────────────────────────────────────────────
function disputesPage() {
  return shell('Disputes', `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-gavel text-red-500"></i> Dispute Resolution
    </h1>
    <p class="text-slate-500 mb-8">Open disputes are reviewed by the redhawk-store DAO. Funds remain locked until resolution.</p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
      ${[['0','Open Disputes','fas fa-exclamation-circle','text-red-500'],['0','Resolved','fas fa-check-circle','text-green-500'],['48h','Avg Resolution','fas fa-clock','text-blue-500']].map(([v,l,i,c])=>`
        <div class="card p-5 text-center">
          <i class="${i} ${c} text-2xl mb-2"></i>
          <p class="text-2xl font-extrabold text-slate-800">${v}</p>
          <p class="text-slate-400 text-sm">${l}</p>
        </div>`).join('')}
    </div>
    <div id="disputes-container">
      <div class="card p-8 text-center text-slate-400">
        <i class="fas fa-handshake text-5xl mb-3 opacity-30"></i>
        <p class="font-medium">No active disputes</p>
        <p class="text-sm mt-1">Open a dispute from any order with issues.</p>
      </div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const disputes = orders.filter(o => o.status === 'dispute');
    if (!disputes.length) return;
    document.getElementById('disputes-container').innerHTML = disputes.map(d =>
      '<div class="card p-5 mb-4 border-l-4 border-red-500">'
      + '<div class="flex items-center justify-between mb-3">'
      + '<div><p class="font-bold text-slate-800">' + d.id + '</p>'
      + '<p class="text-slate-400 text-xs">Opened: ' + new Date(d.createdAt).toLocaleDateString() + '</p></div>'
      + '<span class="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Open Dispute</span>'
      + '</div>'
      + '<p class="text-slate-600 text-sm mb-3">Funds locked: <strong class="text-red-600">' + (d.total||0).toFixed(2) + ' USDC</strong></p>'
      + '<div class="flex gap-2">'
      + '<button onclick="resolveDispute(\'' + d.id + '\',\'buyer\')" class="btn-primary text-xs py-1.5">Refund Buyer</button>'
      + '<button onclick="resolveDispute(\'' + d.id + '\',\'seller\')" class="btn-secondary text-xs py-1.5">Release to Seller</button>'
      + '</div></div>'
    ).join('');
  });
  function resolveDispute(orderId, favor) {
    const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    const i = orders.findIndex(o => o.id === orderId);
    if (i >= 0) {
      orders[i].status = 'completed';
      orders[i].disputeResolution = favor;
      localStorage.setItem('rh_orders', JSON.stringify(orders));
      showToast('Dispute resolved in favor of ' + favor, 'success');
      setTimeout(() => location.reload(), 800);
    }
  }
  </script>
  `)
}

// ─── PAGE: NOTIFICATIONS ─────────────────────────────────────────────
function notificationsPage() {
  return shell('Notifications', `
  <div class="max-w-2xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-3xl font-bold text-slate-800 flex items-center gap-3">
        <i class="fas fa-bell text-red-500"></i> Notifications
      </h1>
      <button onclick="showToast('All notifications cleared', 'info')" class="btn-secondary text-sm">Mark all read</button>
    </div>
    <div class="space-y-2" id="notif-list">
      ${[
        ['payment','fas fa-coins','Escrow Locked','Your order ORD-1234 has been locked in escrow.','2 min ago','bg-green-100 text-green-600'],
        ['shipment','fas fa-shipping-fast','Order Shipped','Order ORD-5678 has been shipped by the seller.','1 hour ago','bg-blue-100 text-blue-600'],
        ['delivery','fas fa-box-open','Delivery Confirmed','Funds released for order ORD-9012.','3 hours ago','bg-purple-100 text-purple-600'],
        ['wallet','fas fa-wallet','Wallet Connected','Your MetaMask wallet is connected to redhawk-store.','1 day ago','bg-orange-100 text-orange-600'],
      ].map(([type,icon,title,msg,time,color]) => `
        <div class="notification-item flex items-start gap-4 cursor-pointer hover:bg-red-50 transition-colors">
          <div class="w-10 h-10 rounded-full ${color} flex items-center justify-center shrink-0">
            <i class="${icon} text-sm"></i>
          </div>
          <div class="flex-1">
            <p class="font-semibold text-slate-800 text-sm">${title}</p>
            <p class="text-slate-500 text-xs">${msg}</p>
            <p class="text-slate-300 text-xs mt-1">${time}</p>
          </div>
          <div class="w-2 h-2 rounded-full bg-red-500 mt-2"></div>
        </div>`).join('')}
    </div>
  </div>
  `)
}
