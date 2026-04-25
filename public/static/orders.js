/* orders.js — Shukly Store My Orders page logic v5
 * Cross-browser fix: primary data source is /api/orders/on-chain (no localStorage dependency).
 * localStorage rh_orders used only for product-name enrichment.
 * Loaded via <script src="/static/orders.js" defer> in ordersPage().
 */

/* ═══════════════════════════════════════════════════════════════════════════
   ORDERS PAGE v5 — on-chain first, zero localStorage dependency for data
   - Primary: /api/orders/on-chain?buyer= or ?seller= (Arc Network eth_getLogs)
   - Fallback: localStorage rh_orders (product name enrichment only)
   - Timeout: 10 s hard-stop so spinner never stays forever
   - Cross-browser: no sessionStorage/localStorage for primary order data
   - Compatible with Brave, Chrome, Firefox, Safari
═══════════════════════════════════════════════════════════════════════════ */

var _currentOrderTab = 'purchases';
var _ordersLoading   = false;   /* concurrency guard — reset in finally     */
var _safetyTimer     = null;    /* 10-second hard-stop handle               */
var _allOrdersCache  = null;    /* in-memory cache per page load            */

/* ── get wallet — reads localStorage directly, no dependency on globalScript */
function _getWallet() {
  if (typeof getStoredWallet === 'function') {
    try { var w = getStoredWallet(); if (w) return w; } catch(e) {}
  }
  try {
    var raw = localStorage.getItem('rh_wallet');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

/* ── DOM helpers ─────────────────────────────────────────────── */
function _setContainer(html) {
  var c = document.getElementById('orders-container');
  if (c) c.innerHTML = html;
}

function _showLoading() {
  _setContainer(
    '<div class="card p-8 text-center">'
    + '<div class="loading-spinner-lg mx-auto mb-3"></div>'
    + '<p class="text-slate-400 text-sm">Loading your orders from Arc Network…</p>'
    + '</div>'
  );
}

function _showError(msg) {
  _setContainer(
    '<div class="card p-8 text-center">'
    + '<i class="fas fa-exclamation-triangle text-3xl text-yellow-400 mb-3 block"></i>'
    + '<p class="text-slate-700 font-semibold mb-1">Unable to load orders</p>'
    + '<p class="text-slate-500 text-sm mb-4">' + (msg || 'Please try again.') + '</p>'
    + '<button onclick="_resetAndRender()" class="btn-secondary mx-auto text-sm">'
    + '<i class="fas fa-redo mr-1"></i>Retry</button>'
    + '</div>'
  );
}

/* Reset guard then re-render (used by Retry button) */
function _resetAndRender() {
  _ordersLoading   = false;
  _allOrdersCache  = null;
  if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
  renderOrders(_currentOrderTab);
}

/* ── tab switcher ─────────────────────────────────────────────── */
function switchOrderTab(tab) {
  _currentOrderTab = tab;
  var tp = document.getElementById('tab-purchases');
  var ts = document.getElementById('tab-sales');
  if (tp) tp.className = tab === 'purchases'
    ? 'px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white shadow-sm'
    : 'px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200';
  if (ts) ts.className = tab === 'sales'
    ? 'px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white shadow-sm'
    : 'px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200';
  _ordersLoading = false;
  if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
  renderOrders(tab);
}

/* ── normalise order object ───────────────────────────────────── */
function _norm(o) {
  return {
    id:            o.id || o.orderId || ('ORD-' + Date.now()),
    txHash:        o.txHash || o.tx_hash || o.fundTxHash || '',
    buyerAddress:  (o.buyerAddress  || o.buyer_address  || o.buyer  || '').toLowerCase(),
    sellerAddress: (o.sellerAddress || o.seller_address || o.seller || '').toLowerCase(),
    amount:        o.amount  || 0,
    token:         o.token   || 'USDC',
    status:        o.status  || 'escrow_locked',
    createdAt:     o.createdAt || o.created_at || new Date().toISOString(),
    explorerUrl:   o.explorerUrl || ('https://testnet.arcscan.app/tx/' + (o.txHash || o.fundTxHash || '')),
    items:         o.items        || [],
    shippingInfo:  o.shippingInfo || null,
    shippedAt:     o.shippedAt    || null,
    deliveredAt:   o.deliveredAt  || null,
    releasedAt:    o.releasedAt   || null,
    productId:     o.productId    || null,
    blockNumber:   o.blockNumber  || null
  };
}

/* ── fetch with cross-browser timeout (no AbortSignal.timeout) ── */
function _fetchWithTimeout(url, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var ctrl = new AbortController();
    var timer = setTimeout(function() {
      ctrl.abort();
      reject(new Error('Request timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);
    fetch(url, { signal: ctrl.signal })
      .then(function(r) { clearTimeout(timer); resolve(r); })
      .catch(function(e) { clearTimeout(timer); reject(e); });
  });
}

/* ── fetch orders from on-chain API (works across all browsers) ── */
async function _fetchOnChainOrders(wallet) {
  var addr = wallet.address;
  /* Fetch both buyer and seller in parallel */
  var buyerPromise  = _fetchWithTimeout('/api/orders/on-chain?buyer='  + encodeURIComponent(addr) + '&limit=50', 9000).then(function(r) { return r.ok ? r.json() : { orders: [] }; }).catch(function() { return { orders: [] }; });
  var sellerPromise = _fetchWithTimeout('/api/orders/on-chain?seller=' + encodeURIComponent(addr) + '&limit=50', 9000).then(function(r) { return r.ok ? r.json() : { orders: [] }; }).catch(function() { return { orders: [] }; });
  var results = await Promise.all([buyerPromise, sellerPromise]);
  var buyerOrders  = Array.isArray(results[0].orders) ? results[0].orders : [];
  var sellerOrders = Array.isArray(results[1].orders) ? results[1].orders : [];

  /* Merge, deduplicate by txHash */
  var seen = new Set();
  var all  = [];
  buyerOrders.concat(sellerOrders).forEach(function(o) {
    var key = (o.txHash || o.fundTxHash || o.orderId || o.id || '').toLowerCase();
    if (!seen.has(key)) { seen.add(key); all.push(o); }
  });

  /* Enrich with localStorage product names (same-browser only, not required) */
  try {
    var local = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    if (Array.isArray(local) && local.length) {
      var localMap = {};
      local.forEach(function(lo) {
        var k = (lo.txHash || lo.fundTxHash || lo.id || '').toLowerCase();
        if (k) localMap[k] = lo;
      });
      all.forEach(function(o) {
        var k = (o.txHash || o.fundTxHash || o.id || '').toLowerCase();
        var lo = localMap[k];
        if (lo) {
          if (!o.items  || !o.items.length)  o.items       = lo.items       || o.items;
          if (!o.shippingInfo)               o.shippingInfo= lo.shippingInfo || null;
          if (!o.shippedAt)                  o.shippedAt   = lo.shippedAt   || null;
          if (!o.releasedAt)                 o.releasedAt  = lo.releasedAt  || null;
          if (!o.productId)                  o.productId   = lo.productId   || null;
        }
      });
      /* Also add purely local orders not on chain (in-progress or pending) */
      local.forEach(function(lo) {
        var k = (lo.txHash || lo.fundTxHash || lo.id || '').toLowerCase();
        if (!seen.has(k) && k) {
          seen.add(k);
          all.push(lo);
        }
      });
    }
  } catch(e) {}

  return all;
}

/* ── main async render ─────────────────────────────────────────── */
async function renderOrders(tab) {
  /* Concurrency guard */
  if (_ordersLoading) return;
  _ordersLoading = true;

  _showLoading();

  /* Safety hard-stop: 10 s */
  if (_safetyTimer) clearTimeout(_safetyTimer);
  var _stopped = false;
  _safetyTimer = setTimeout(function() {
    if (!_stopped) {
      _stopped = true;
      _ordersLoading = false;
      _safetyTimer   = null;
      _showError('Unable to load data. Arc Network may be slow. Please try again.');
    }
  }, 10000);

  try {
    var wallet = _getWallet();

    if (!wallet) {
      _stopped = true;
      _setContainer(
        '<div class="card p-12 text-center"><div class="empty-state">'
        + '<i class="fas fa-wallet"></i>'
        + '<h3 class="font-bold text-slate-600 mb-2">Connect Wallet</h3>'
        + '<p class="text-sm mb-4">Connect your wallet to view orders associated with your Arc address.</p>'
        + '<a href="/wallet" class="btn-primary mx-auto"><i class="fas fa-wallet"></i> Connect Wallet</a>'
        + '</div></div>'
      );
      return;
    }

    var myAddr = wallet.address.toLowerCase();

    /* Load orders — on-chain first, localStorage enrichment */
    var allOrders = [];
    if (_allOrdersCache) {
      allOrders = _allOrdersCache;
    } else {
      allOrders = await _fetchOnChainOrders(wallet);
      _allOrdersCache = allOrders;
    }
    allOrders = allOrders.map(_norm);

    /* Update summary badge */
    try {
      var buys  = allOrders.filter(function(o) { return o.buyerAddress  === myAddr; }).length;
      var sells = allOrders.filter(function(o) { return o.sellerAddress === myAddr; }).length;
      var badge = document.getElementById('orders-summary-badge');
      if (badge) badge.textContent = buys + ' purchase' + (buys !== 1 ? 's' : '') + ' · ' + sells + ' sale' + (sells !== 1 ? 's' : '');
    } catch(e) {}

    /* Filter by tab */
    var orders = tab === 'purchases'
      ? allOrders.filter(function(o) { return o.buyerAddress  === myAddr; })
      : allOrders.filter(function(o) { return o.sellerAddress === myAddr; });

    /* Empty state */
    if (!orders.length) {
      var emptyMsg  = tab === 'purchases' ? 'No purchases yet.' : 'No sales yet.';
      var emptySub  = tab === 'purchases'
        ? 'When you buy a product, your escrow order will appear here.'
        : 'When a buyer purchases your product, the sale will appear here.';
      var emptyLink = tab === 'purchases'
        ? '<a href="/marketplace" class="btn-primary mx-auto"><i class="fas fa-store mr-1"></i>Browse Marketplace</a>'
        : '<a href="/sell" class="btn-primary mx-auto"><i class="fas fa-plus-circle mr-1"></i>List a Product</a>';
      _stopped = true;
      _setContainer(
        '<div class="card p-12 text-center"><div class="empty-state">'
        + '<i class="fas fa-box-open"></i>'
        + '<h3 class="font-bold text-slate-600 mb-2">' + emptyMsg + '</h3>'
        + '<p class="text-sm mb-1 text-slate-400">' + emptySub + '</p>'
        + '<p class="text-xs text-slate-300 mb-4 font-mono">Wallet: ' + wallet.address.substring(0,14) + '\u2026</p>'
        + emptyLink
        + '</div></div>'
      );
      return;
    }

    /* Build cards */
    var isSeller = tab === 'sales';
    var statusColors = {
      escrow_locked:'bg-yellow-100 text-yellow-700', escrow_pending:'bg-blue-100 text-blue-700',
      shipped:'bg-indigo-100 text-indigo-700', delivered:'bg-teal-100 text-teal-700',
      completed:'bg-green-100 text-green-700', funds_released:'bg-emerald-100 text-emerald-800',
      dispute:'bg-red-100 text-red-700', escrow_funded:'bg-yellow-100 text-yellow-700'
    };
    var statusLabels = {
      escrow_locked:'Escrow Locked', escrow_pending:'Pending', shipped:'Shipped',
      delivered:'Delivered', completed:'Confirmed', funds_released:'Funds Released',
      dispute:'Dispute', escrow_funded:'Escrow Funded'
    };

    var html = orders.slice().reverse().map(function(o) {
      var sc  = statusColors[o.status]  || 'bg-slate-100 text-slate-700';
      var sl  = statusLabels[o.status]  || (o.status || '').replace(/_/g,' ');
      var exu = o.explorerUrl || ('https://testnet.arcscan.app/tx/' + (o.txHash || ''));

      var productName = '';
      if (o.items && o.items.length) {
        productName = o.items[0].title || o.items[0].name || 'Product';
        if (o.items.length > 1) productName += ' +' + (o.items.length - 1) + ' more';
      } else if (o.productId) {
        productName = 'Product #' + String(o.productId).substring(0, 8);
      }

      var actionBtns = '';
      if (isSeller) {
        if (o.status === 'escrow_locked' || o.status === 'escrow_funded')
          actionBtns = '<button data-oid="' + o.id + '" class="mark-shipped-btn btn-primary text-xs py-1.5 px-3">'
            + '<i class="fas fa-shipping-fast mr-1"></i>Mark as Shipped</button>';
        if (o.status === 'completed')
          actionBtns = '<button data-oid="' + o.id + '" class="release-funds-btn btn-primary text-xs py-1.5 px-3" style="background:#16a34a;border-color:#16a34a;">'
            + '<i class="fas fa-coins mr-1"></i>Release Funds</button>';
      } else {
        if (o.status === 'shipped')
          actionBtns = '<button data-oid="' + o.id + '" class="confirm-delivery-btn btn-secondary text-xs py-1.5 px-3">'
            + '<i class="fas fa-check-circle mr-1"></i>Confirm Delivery</button>';
      }

      var shippingPanel = '';
      if (!isSeller && o.shippingInfo) {
        shippingPanel = '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:12px;margin-bottom:12px;">'
          + '<p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#0369a1;margin:0 0 8px;">'
          + '<i class="fas fa-shipping-fast" style="margin-right:5px;"></i>Shipping Update</p>'
          + '<div style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:#1e293b;">'
          + '<p style="margin:0;"><strong>Carrier:</strong> ' + o.shippingInfo.carrier + '</p>'
          + '<p style="margin:0;"><strong>Tracking #:</strong> <span style="font-family:monospace;">' + o.shippingInfo.trackingNumber + '</span></p>'
          + (o.shippingInfo.trackingLink
              ? '<p style="margin:0;"><strong>Track:</strong> <a href="' + o.shippingInfo.trackingLink + '" target="_blank" style="color:#0369a1;text-decoration:underline;">' + o.shippingInfo.trackingLink + '</a></p>'
              : '')
          + (o.shippingInfo.notes ? '<p style="margin:0;color:#475569;font-style:italic;">' + o.shippingInfo.notes + '</p>' : '')
          + '</div></div>';
      }

      return '<div class="card p-5 mb-4 hover:shadow-md transition-shadow">'
        + '<div class="flex items-start justify-between gap-4 mb-3">'
        + '<div>'
        + '<p class="font-bold text-slate-800 text-sm font-mono">' + o.id + '</p>'
        + (productName ? '<p class="text-slate-700 font-semibold text-sm mt-0.5">' + productName + '</p>' : '')
        + '<p class="text-slate-400 text-xs mt-0.5">' + new Date(o.createdAt).toLocaleString() + '</p>'
        + '</div>'
        + '<span class="px-3 py-1 rounded-full text-xs font-bold ' + sc + ' capitalize shrink-0">' + sl + '</span>'
        + '</div>'
        + '<div class="text-sm mb-3 flex flex-col gap-1">'
        + '<p class="text-slate-600">Amount: <strong class="text-red-600">' + parseFloat(o.amount||0).toFixed(2) + ' ' + (o.token || 'USDC') + '</strong></p>'
        + (isSeller
            ? '<p class="text-slate-400 text-xs addr-mono">Buyer: '  + (o.buyerAddress  || '\u2014') + '</p>'
            : '<p class="text-slate-400 text-xs addr-mono">Seller: ' + (o.sellerAddress || '\u2014') + '</p>')
        + (o.txHash ? '<p class="text-slate-400 text-xs addr-mono">Tx: <a href="' + exu + '" target="_blank" class="text-blue-500 hover:underline">' + o.txHash.substring(0,20) + '\u2026</a></p>' : '')
        + '</div>'
        + shippingPanel
        + '<div class="flex gap-2 flex-wrap">'
        + '<a href="/orders/' + o.id + '" class="btn-primary text-xs py-1.5 px-3"><i class="fas fa-eye mr-1"></i>View Details</a>'
        + '<button data-oid="' + o.id + '" class="view-receipt-btn btn-secondary text-xs py-1.5 px-3"><i class="fas fa-receipt mr-1"></i>Receipt</button>'
        + actionBtns
        + '</div>'
        + '</div>';
    }).join('');

    _stopped = true;
    _setContainer(html);

    /* Attach listeners */
    document.querySelectorAll('.confirm-delivery-btn').forEach(function(b) {
      b.addEventListener('click', function() { confirmDeliveryOrder(this.dataset.oid); });
    });
    document.querySelectorAll('.mark-shipped-btn').forEach(function(b) {
      b.addEventListener('click', function() { markOrderShipped(this.dataset.oid); });
    });
    document.querySelectorAll('.release-funds-btn').forEach(function(b) {
      b.addEventListener('click', function() { releaseFundsOrder(this.dataset.oid); });
    });
    document.querySelectorAll('.view-receipt-btn').forEach(function(b) {
      b.addEventListener('click', function() { showReceiptModal(this.dataset.oid); });
    });

  } catch(err) {
    if (!_stopped) {
      _showError('Something went wrong. Please try again.');
      console.error('[orders]', err);
    }
  } finally {
    _stopped     = true;
    _ordersLoading = false;
    if (_safetyTimer) { clearTimeout(_safetyTimer); _safetyTimer = null; }
  }
}

/* ── action: confirm delivery ─────────────────────────────────── */
function confirmDeliveryOrder(orderId) {
  try {
    var orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    var i = orders.findIndex(function(o) { return o.id === orderId; });
    if (i >= 0) {
      orders[i].status      = 'completed';
      orders[i].deliveredAt = new Date().toISOString();
      localStorage.setItem('rh_orders', JSON.stringify(orders));
    }
    showToast('Delivery confirmed! Funds released from escrow.', 'success');
    _allOrdersCache = null; // invalidate cache
    setTimeout(function() { _ordersLoading = false; renderOrders(_currentOrderTab); }, 600);
  } catch(e) { showToast('Error updating order.', 'error'); }
}

/* ── action: mark as shipped ──────────────────────────────────── */
function markOrderShipped(orderId) {
  var root = document.getElementById('receipt-modal-root');
  if (!root) return;
  root.innerHTML =
    '<div id="ship-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">'
    + '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 20px 14px;border-bottom:1px solid #f1f5f9;">'
    + '<div style="display:flex;align-items:center;gap:10px;">'
    + '<div style="width:36px;height:36px;border-radius:8px;background:#fef2f2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-shipping-fast" style="color:#ef4444;"></i></div>'
    + '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Shipping Information</p>'
    + '<p style="font-size:11px;color:#94a3b8;margin:0;">Order ' + orderId + '</p></div></div>'
    + '<button id="ship-close-btn" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>'
    + '</div>'
    + '<div style="padding:20px;display:flex;flex-direction:column;gap:14px;">'
    + '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Tracking Number *</label>'
    + '<input id="ship-tracking" type="text" placeholder="e.g. 1Z999AA10123456784" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'
    + '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Shipping Carrier *</label>'
    + '<input id="ship-carrier" type="text" placeholder="e.g. UPS, FedEx, DHL, USPS" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'
    + '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Tracking Link (optional)</label>'
    + '<input id="ship-link" type="url" placeholder="https://tracking.example.com/ABC123" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'
    + '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Additional Notes (optional)</label>'
    + '<textarea id="ship-notes" rows="3" placeholder="Any notes for the buyer\u2026" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;resize:none;box-sizing:border-box;"></textarea></div>'
    + '</div>'
    + '<div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;gap:8px;justify-content:flex-end;">'
    + '<button id="ship-cancel-btn" style="padding:8px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;font-size:13px;cursor:pointer;">Cancel</button>'
    + '<button id="ship-confirm-btn" style="padding:8px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;font-weight:600;cursor:pointer;"><i class="fas fa-paper-plane" style="margin-right:6px;"></i>Send Shipping Info to Buyer</button>'
    + '</div></div></div>';
  function closeShipModal() { root.innerHTML = ''; }
  document.getElementById('ship-close-btn').onclick  = closeShipModal;
  document.getElementById('ship-cancel-btn').onclick = closeShipModal;
  document.getElementById('ship-overlay').addEventListener('click', function(e) { if (e.target === this) closeShipModal(); });
  document.getElementById('ship-confirm-btn').onclick = function() {
    var tracking = document.getElementById('ship-tracking').value.trim();
    var carrier  = document.getElementById('ship-carrier').value.trim();
    var link     = document.getElementById('ship-link').value.trim();
    var notes    = document.getElementById('ship-notes').value.trim();
    if (!tracking) { showToast('Please enter a tracking number', 'error'); return; }
    if (!carrier)  { showToast('Please enter the shipping carrier', 'error'); return; }
    try {
      var orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
      var i = orders.findIndex(function(o) { return o.id === orderId; });
      if (i >= 0) {
        orders[i].status       = 'shipped';
        orders[i].shippedAt    = new Date().toISOString();
        orders[i].shippingInfo = { trackingNumber: tracking, carrier: carrier, trackingLink: link || null, notes: notes || null, sentAt: new Date().toISOString() };
        localStorage.setItem('rh_orders', JSON.stringify(orders));
      }
      closeShipModal();
      showToast('Shipping info sent to buyer! Order marked as shipped.', 'success');
      _allOrdersCache = null; // invalidate cache
      setTimeout(function() { _ordersLoading = false; renderOrders(_currentOrderTab); }, 600);
    } catch(e) { showToast('Error saving shipping info.', 'error'); }
  };
}

/* ── action: release funds ────────────────────────────────────── */
function releaseFundsOrder(orderId) {
  try {
    var orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    var i = orders.findIndex(function(o) { return o.id === orderId; });
    if (i >= 0) {
      orders[i].status     = 'funds_released';
      orders[i].releasedAt = new Date().toISOString();
      localStorage.setItem('rh_orders', JSON.stringify(orders));
    }
    showToast('Funds released to seller wallet!', 'success');
    _setContainer(
      '<div class="card p-10 text-center max-w-md mx-auto mt-4">'
      + '<div class="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">'
      + '<i class="fas fa-check-circle text-4xl text-emerald-500"></i></div>'
      + '<h2 class="text-2xl font-bold text-slate-800 mb-2">Funds Released!</h2>'
      + '<p class="text-slate-500 mb-1">Order <span class="font-mono font-bold text-slate-700">' + orderId + '</span></p>'
      + '<p class="text-slate-500 text-sm mb-6">Escrow funds successfully released to the seller wallet on Arc Network.</p>'
      + '<div class="flex flex-col gap-3">'
      + '<button onclick="showReceiptModal(\'' + orderId + '\')" class="btn-primary justify-center"><i class="fas fa-receipt mr-2"></i>View &amp; Download Receipt</button>'
      + '<button onclick="switchOrderTab(\'sales\')" class="btn-secondary justify-center"><i class="fas fa-list mr-2"></i>Back to My Sales</button>'
      + '</div></div>'
    );
  } catch(e) { showToast('Error releasing funds.', 'error'); }
}

/* ── receipt modal ─────────────────────────────────────────────── */
function showReceiptModal(orderId) {
  /* Try on-chain cache first, then localStorage */
  var order = null;
  if (_allOrdersCache) {
    order = _allOrdersCache.find(function(o) { return o.id === orderId || (_norm(o)).id === orderId; });
    if (order) order = _norm(order);
  }
  if (!order) {
    try {
      var localOrders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
      order = localOrders.find(function(o) { return o.id === orderId; });
    } catch(e) {}
  }
  if (!order) { showToast('Order not found', 'error'); return; }
  var root = document.getElementById('receipt-modal-root');
  if (!root) return;
  var explorerUrl = order.explorerUrl || ('https://testnet.arcscan.app/tx/' + (order.txHash || ''));
  var items       = order.items || [];
  var itemsHtml   = items.length
    ? items.map(function(it) {
        return '<div class="flex justify-between text-xs py-1.5 border-b border-slate-100 last:border-0">'
          + '<span class="text-slate-600 truncate pr-2">' + (it.title || it.name || 'Product') + '</span>'
          + '<span class="font-semibold text-slate-700 shrink-0">' + (it.quantity || 1) + '&times; ' + (parseFloat(it.price) || 0).toFixed(2) + ' ' + (it.currency || it.token || 'USDC') + '</span>'
          + '</div>';
      }).join('')
    : '<p class="text-xs text-slate-400 py-2">No item details recorded</p>';
  var statusLabel = (order.status || '').replace(/_/g, ' ');
  var releasedAt  = order.releasedAt ? new Date(order.releasedAt).toLocaleString() : '\u2014';

  root.innerHTML =
    '<div id="rh-receipt-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">'
    + '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:520px;max-height:90vh;overflow-y:auto;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 20px 16px;border-bottom:1px solid #f1f5f9;">'
    + '<div style="display:flex;align-items:center;gap:10px;">'
    + '<div style="width:36px;height:36px;border-radius:8px;background:#fee2e2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-receipt" style="color:#ef4444;font-size:14px;"></i></div>'
    + '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Order Receipt</p>'
    + '<p style="font-size:11px;color:#94a3b8;margin:0;">' + order.id + '</p></div></div>'
    + '<button id="rh-receipt-close" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>'
    + '</div>'
    + '<div style="padding:20px;display:flex;flex-direction:column;gap:16px;">'
    + '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;">'
    + '<i class="fas fa-check-circle" style="color:#22c55e;font-size:18px;"></i>'
    + '<div><p style="margin:0;font-weight:700;color:#15803d;font-size:13px;text-transform:capitalize;">' + statusLabel + '</p>'
    + '<p style="margin:0;font-size:11px;color:#4ade80;">Escrow transaction on Arc Network</p></div></div>'
    + '<div style="background:#f8fafc;border-radius:12px;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
    + '<div><p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;font-weight:600;">Order Date</p><p style="margin:0;font-size:12px;color:#334155;">' + new Date(order.createdAt).toLocaleString() + '</p></div>'
    + (order.releasedAt ? '<div><p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;font-weight:600;">Released At</p><p style="margin:0;font-size:12px;color:#334155;">' + releasedAt + '</p></div>' : '<div></div>')
    + '<div><p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;font-weight:600;">Network</p><p style="margin:0;font-size:12px;color:#334155;">Arc Testnet</p></div>'
    + '<div><p style="margin:0 0 2px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;font-weight:600;">Chain ID</p><p style="margin:0;font-size:12px;color:#334155;">5042002</p></div>'
    + '</div>'
    + '<div><p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:700;">Wallet Addresses</p>'
    + '<div style="background:#f8fafc;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;">'
    + '<div><p style="margin:0 0 2px;font-size:10px;color:#94a3b8;font-weight:600;">BUYER</p><p style="margin:0;font-size:11px;font-family:monospace;color:#1e293b;word-break:break-all;">' + (order.buyerAddress || '\u2014') + '</p></div>'
    + '<div style="border-top:1px solid #e2e8f0;padding-top:8px;"><p style="margin:0 0 2px;font-size:10px;color:#94a3b8;font-weight:600;">SELLER</p><p style="margin:0;font-size:11px;font-family:monospace;color:#1e293b;word-break:break-all;">' + (order.sellerAddress || '\u2014') + '</p></div>'
    + '</div></div>'
    + '<div><p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:700;">Products</p>'
    + '<div style="background:#f8fafc;border-radius:12px;padding:12px;">' + itemsHtml + '</div></div>'
    + '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px;display:flex;align-items:center;justify-content:space-between;">'
    + '<span style="font-size:13px;font-weight:600;color:#64748b;">Total Amount</span>'
    + '<span style="font-size:20px;font-weight:800;color:#ef4444;">' + (parseFloat(order.amount||0).toFixed(2)) + ' ' + (order.token || 'USDC') + '</span></div>'
    + '<div><p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:700;">Transaction Hash</p>'
    + '<a href="' + explorerUrl + '" target="_blank" style="font-size:11px;font-family:monospace;color:#3b82f6;word-break:break-all;text-decoration:none;">' + (order.txHash || 'Pending \u2014 Transaction not yet recorded') + '</a>'
    + '</div>'
    + '</div>'
    + '<div style="padding:16px 20px;border-top:1px solid #f1f5f9;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">'
    + '<button id="rh-dl-json" class="btn-secondary text-sm py-2 px-3"><i class="fas fa-file-code mr-1"></i>Download JSON</button>'
    + '<button id="rh-dl-pdf" class="btn-secondary text-sm py-2 px-3"><i class="fas fa-file-pdf mr-1"></i>Download PDF</button>'
    + '<a href="' + explorerUrl + '" target="_blank" class="btn-primary text-sm py-2 px-3"><i class="fas fa-external-link-alt mr-1"></i>Explorer</a>'
    + '</div>'
    + '</div></div>';

  document.getElementById('rh-receipt-close').onclick = function() { root.innerHTML = ''; };
  document.getElementById('rh-receipt-overlay').onclick = function(e) { if (e.target === this) root.innerHTML = ''; };

  document.getElementById('rh-dl-json').onclick = function() {
    var receipt = {
      receiptType:'ArcNetwork-Escrow-Receipt', orderId:order.id, status:order.status,
      orderDate:order.createdAt, releasedAt:order.releasedAt||null, network:'Arc Testnet',
      chainId:5042002, buyer:order.buyerAddress||null, seller:order.sellerAddress||null,
      amount:order.amount, token:order.token||'USDC', transactionHash:order.txHash||null,
      explorerUrl:explorerUrl,
      products:items.map(function(it){ return {title:it.title||it.name,price:it.price,currency:it.currency||it.token,quantity:it.quantity||1}; }),
      generatedAt:new Date().toISOString()
    };
    var blob = new Blob([JSON.stringify(receipt,null,2)], {type:'application/json'});
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = order.id + '-receipt.json'; a.click();
    URL.revokeObjectURL(url);
    showToast('JSON receipt downloaded!', 'success');
  };

  document.getElementById('rh-dl-pdf').onclick = function() {
    var productRows = items.length
      ? items.map(function(it) {
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">' + (it.title||it.name||'Product') + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:center;">' + (it.quantity||1) + '</td>'
            + '<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:right;">' + (parseFloat(it.price)||0).toFixed(2) + ' ' + (it.currency||it.token||'USDC') + '</td></tr>';
        }).join('')
      : '<tr><td colspan="3" style="padding:8px;text-align:center;color:#94a3b8;">No items recorded</td></tr>';
    var pdfContent = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ' + order.id + '</title>'
      + '<style>body{font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#1e293b;font-size:13px}'
      + 'h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin:16px 0 6px}'
      + '.badge{display:inline-block;padding:3px 10px;border-radius:20px;background:#dcfce7;color:#15803d;font-weight:700;font-size:12px;text-transform:capitalize}'
      + '.mono{font-family:monospace;font-size:11px;word-break:break-all}'
      + '.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9}'
      + '.total{display:flex;justify-content:space-between;padding:10px 0;font-size:18px;font-weight:800;color:#ef4444}'
      + 'table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b}'
      + '@media print{body{margin:20px}}'
      + '</style></head><body>'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #ef4444;">'
      + '<div style="width:40px;height:40px;border-radius:8px;background:#fef2f2;display:flex;align-items:center;justify-content:center;">'
      + '<span style="color:#ef4444;font-size:20px;">&#128993;</span></div>'
      + '<div><h1>Order Receipt</h1><p style="margin:0;color:#94a3b8;font-size:12px;">Shukly Store &bull; Arc Network</p></div></div>'
      + '<span class="badge">' + statusLabel + '</span>'
      + '<h2>Order Information</h2>'
      + '<div class="row"><span style="color:#64748b;">Order ID</span><span class="mono">' + order.id + '</span></div>'
      + '<div class="row"><span style="color:#64748b;">Date</span><span>' + new Date(order.createdAt).toLocaleString() + '</span></div>'
      + (order.releasedAt ? '<div class="row"><span style="color:#64748b;">Released At</span><span>' + releasedAt + '</span></div>' : '')
      + '<div class="row"><span style="color:#64748b;">Network</span><span>Arc Testnet (Chain 5042002)</span></div>'
      + '<h2>Wallets</h2>'
      + '<div class="row"><span style="color:#64748b;">Buyer</span><span class="mono">' + (order.buyerAddress||'\u2014') + '</span></div>'
      + '<div class="row"><span style="color:#64748b;">Seller</span><span class="mono">' + (order.sellerAddress||'\u2014') + '</span></div>'
      + '<h2>Products</h2>'
      + '<table><thead><tr><th>Product</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th></tr></thead>'
      + '<tbody>' + productRows + '</tbody></table>'
      + '<h2>Payment</h2>'
      + '<div class="total"><span>Total Amount</span><span>' + (parseFloat(order.amount||0).toFixed(2)) + ' ' + (order.token||'USDC') + '</span></div>'
      + '<h2>Transaction</h2>'
      + '<div class="row"><span style="color:#64748b;">Hash</span><span class="mono">' + (order.txHash||'Pending') + '</span></div>'
      + '<div class="row"><span style="color:#64748b;">Explorer</span><a href="' + explorerUrl + '" style="color:#3b82f6;font-size:11px;">' + explorerUrl + '</a></div>'
      + '<p style="margin-top:24px;font-size:10px;color:#94a3b8;text-align:center;">Generated ' + new Date().toLocaleString() + ' &bull; Shukly Store</p>'
      + '</body></html>';
    var w = window.open('', '_blank', 'width=700,height=900');
    w.document.write(pdfContent);
    w.document.close();
    setTimeout(function() { w.print(); }, 400);
    showToast('PDF ready \u2014 use browser Print > Save as PDF', 'info');
  };
}

/* ── initializer ─────────────────────────────────────────────── */
function _ordersInit() {
  try {
    if (typeof checkNetworkStatus === 'function') {
      checkNetworkStatus(document.getElementById('orders-network-status'));
    }
  } catch(e) {}

  /* Wallet bar */
  try {
    var w = _getWallet();
    if (w) {
      var bar  = document.getElementById('orders-wallet-bar');
      var addr = document.getElementById('orders-wallet-addr');
      if (bar)  bar.classList.remove('hidden');
      if (addr) addr.textContent = w.address.substring(0,10) + '\u2026' + w.address.slice(-6);
    }
  } catch(e) {}

  renderOrders('purchases');
}

/* ── Bootstrap ───────────────────────────────────────────────── */
(function() {
  function _run() {
    if (!document.getElementById('orders-container')) {
      document.addEventListener('DOMContentLoaded', _ordersInit);
      return;
    }
    _ordersInit();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _run);
  } else {
    _run();
  }
})();
