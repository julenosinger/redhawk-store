// ══════════════════════════════════════════════════════════════════════════════
//  SellerNotify — Seller Purchase Alert Service
//  Shukly Store · Arc Network
//
//  NON-DESTRUCTIVE: Only adds seller notification UI.
//  Does NOT modify showToast(), TxAlert, confirmOrder(), layouts, contracts,
//  smart contract logic, pages, buttons, or any existing component.
//
//  ── Architecture ──────────────────────────────────────────────────────────
//  • Storage key : 'rh_seller_notifs'  (localStorage, persists across reloads)
//  • Unread key  : 'rh_seller_notifs_unread' (localStorage count)
//  • Bell badge  : injects a counter badge over the existing #bell-btn or
//                  the <a href="/notifications"> anchor in the navbar
//  • Footer alert: dedicated fixed container #sn-footer-alert (z-9999)
//                  separate from TxAlert container and global-toast
//
//  ── Public API ────────────────────────────────────────────────────────────
//    SellerNotify.onPurchase({ orderId, productName, amount, token,
//                               txHash, buyerAddress, sellerAddress })
//      → call this right after the buyer's fundEscrow is confirmed.
//        SellerNotify checks if the CURRENT wallet == sellerAddress before
//        showing any UI (buyer and seller may share the same browser in demo).
//
//    SellerNotify.getAll()      → array of stored notifications (newest first)
//    SellerNotify.getUnread()   → count of unread notifications
//    SellerNotify.markAllRead() → mark all read, hide badge
//    SellerNotify.clearAll()    → wipe all notifications
//
//  ── Called automatically on DOMContentLoaded ──────────────────────────────
//    • _sn_initBadge()    — renders badge from stored unread count
//    • _sn_checkPending() — shows footer alert once for offline-then-online
//                           seller (notifications stored while they were away)
// ══════════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const STORE_KEY   = 'rh_seller_notifs';
  const UNREAD_KEY  = 'rh_seller_notifs_unread';
  const SHOWN_KEY   = 'rh_seller_notifs_shown';   // set of notif IDs already footer-shown
  const FOOTER_ID   = 'sn-footer-alert';
  const BADGE_ID    = 'sn-bell-badge';
  const FOOTER_VISIBLE_MS = 60000;                 // 60 s auto-dismiss

  // ── Storage helpers ────────────────────────────────────────────────────────
  function _load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch { return []; }
  }
  function _save(arr) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); }
    catch { /* quota */ }
  }
  function _loadShown() {
    try { return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function _saveShown(set) {
    try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...set])); }
    catch {}
  }
  function _getUnread() {
    try { return parseInt(localStorage.getItem(UNREAD_KEY) || '0', 10); }
    catch { return 0; }
  }
  function _setUnread(n) {
    try { localStorage.setItem(UNREAD_KEY, String(Math.max(0, n))); }
    catch {}
  }

  // ── Get current seller wallet address (best-effort) ────────────────────────
  function _currentAddress() {
    try {
      // 1. sessionStorage (unlocked internal wallet)
      const sess = sessionStorage.getItem('rh_wallet_sess');
      if (sess) { const w = JSON.parse(sess); if (w && w.address) return w.address.toLowerCase(); }
    } catch {}
    try {
      // 2. localStorage legacy plain wallet
      const plain = localStorage.getItem('rh_wallet');
      if (plain) { const w = JSON.parse(plain); if (w && w.address) return w.address.toLowerCase(); }
    } catch {}
    try {
      // 3. MetaMask / window.ethereum connected account
      if (window._walletAddress) return window._walletAddress.toLowerCase();
    } catch {}
    return null;
  }

  // ── CSS injection (scoped) ─────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('sn-styles')) return;
    const s = document.createElement('style');
    s.id = 'sn-styles';
    s.textContent = `
      /* ── Bell badge ───────────────────────────────────────────────── */
      #${BADGE_ID} {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        background: #dc2626;
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        line-height: 1;
        pointer-events: none;
        box-shadow: 0 0 0 2px #fff;
        animation: sn-badge-pop .25s cubic-bezier(.22,1,.36,1);
        z-index: 10001;
      }
      @keyframes sn-badge-pop {
        from { transform: scale(0); opacity: 0; }
        to   { transform: scale(1); opacity: 1; }
      }

      /* ── Footer alert container ───────────────────────────────────── */
      #${FOOTER_ID} {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(120%);
        z-index: 9999;
        width: min(480px, calc(100vw - 32px));
        pointer-events: none;
        transition: transform .4s cubic-bezier(.22,1,.36,1), opacity .3s ease;
        opacity: 0;
      }
      #${FOOTER_ID}.sn-visible {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
        pointer-events: all;
      }
      #${FOOTER_ID}.sn-hide {
        transform: translateX(-50%) translateY(130%);
        opacity: 0;
        pointer-events: none;
        transition: transform .3s ease-in, opacity .25s ease;
      }

      .sn-card {
        background: #0f172a;
        border-radius: 16px;
        padding: 16px 20px;
        box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.07);
        display: flex;
        align-items: flex-start;
        gap: 14px;
        font-family: 'Inter', system-ui, sans-serif;
        color: #e2e8f0;
      }

      .sn-icon-wrap {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: linear-gradient(135deg, #dc2626, #b91c1c);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
        box-shadow: 0 4px 12px rgba(220,38,38,.4);
      }

      .sn-body { flex: 1; min-width: 0; }

      .sn-title {
        font-size: 14px;
        font-weight: 700;
        color: #f1f5f9;
        margin-bottom: 3px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sn-live-dot {
        width: 7px; height: 7px;
        border-radius: 50%;
        background: #22c55e;
        animation: sn-pulse 1.2s infinite alternate;
        flex-shrink: 0;
      }
      @keyframes sn-pulse { from { opacity: 1; } to { opacity: .35; } }

      .sn-detail {
        font-size: 13px;
        color: #94a3b8;
        line-height: 1.5;
        word-break: break-word;
      }
      .sn-amount { color: #4ade80; font-weight: 700; }
      .sn-hash   { font-family: monospace; font-size: 11px; color: #7dd3fc; }

      .sn-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .sn-btn {
        background: rgba(255,255,255,.08);
        border: 1px solid rgba(255,255,255,.13);
        color: #94a3b8;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        text-decoration: none;
        font-family: inherit;
        transition: background .15s, color .15s;
        white-space: nowrap;
      }
      .sn-btn:hover { background: rgba(255,255,255,.14); color: #e2e8f0; }
      .sn-btn-explorer { color: #60a5fa; border-color: rgba(96,165,250,.25); }
      .sn-btn-explorer:hover { background: rgba(96,165,250,.1); }
      .sn-btn-notifs { color: #f59e0b; border-color: rgba(245,158,11,.25); }
      .sn-btn-notifs:hover { background: rgba(245,158,11,.08); }

      .sn-close-btn {
        background: none;
        border: none;
        color: #475569;
        cursor: pointer;
        font-size: 15px;
        padding: 2px 5px;
        border-radius: 5px;
        line-height: 1;
        flex-shrink: 0;
        transition: color .15s;
        align-self: flex-start;
      }
      .sn-close-btn:hover { color: #cbd5e1; }

      /* Progress bar auto-dismiss */
      .sn-progress-bar {
        position: absolute;
        bottom: 0; left: 0;
        height: 3px;
        background: linear-gradient(90deg, #dc2626, #f59e0b);
        border-radius: 0 0 16px 16px;
        width: 100%;
        transform-origin: left;
        animation: sn-shrink var(--sn-duration, 60s) linear forwards;
        border-bottom-left-radius: 16px;
        border-bottom-right-radius: 16px;
      }
      @keyframes sn-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }

      /* ── Notification list items (used in notificationsPage) ──────── */
      .sn-notif-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        border-left: 3px solid #dc2626;
        background: #fff;
        border-radius: 0 8px 8px 0;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background .15s;
      }
      .sn-notif-item:hover { background: #fef2f2; }
      .sn-notif-item .sn-ni-icon {
        width: 38px; height: 38px;
        border-radius: 50%;
        background: #fee2e2;
        color: #dc2626;
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; flex-shrink: 0;
      }
      .sn-notif-item .sn-ni-content { flex: 1; min-width: 0; }
      .sn-notif-item .sn-ni-title {
        font-weight: 700; font-size: 13px; color: #1e293b; margin-bottom: 2px;
      }
      .sn-notif-item .sn-ni-msg { font-size: 12px; color: #64748b; }
      .sn-notif-item .sn-ni-time { font-size: 11px; color: #94a3b8; margin-top: 3px; }
      .sn-notif-item .sn-ni-unread {
        width: 8px; height: 8px; border-radius: 50%;
        background: #dc2626; flex-shrink: 0; margin-top: 4px;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Bell anchor finder ─────────────────────────────────────────────────────
  // Finds the existing <a href="/notifications"> element in the navbar.
  // We NEVER modify it structurally — we only inject our badge span inside it.
  function _findBellAnchor() {
    // Try by known href first
    return document.querySelector('a[href="/notifications"]') || null;
  }

  // ── Render / update bell badge ─────────────────────────────────────────────
  function _renderBadge(count) {
    const anchor = _findBellAnchor();
    if (!anchor) return;

    // Ensure anchor has position:relative for absolute badge child
    const cs = getComputedStyle(anchor);
    if (cs.position === 'static') anchor.style.position = 'relative';

    let badge = document.getElementById(BADGE_ID);
    if (count <= 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.id = BADGE_ID;
      anchor.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
  }

  // ── Footer alert element ───────────────────────────────────────────────────
  function _ensureFooter() {
    let el = document.getElementById(FOOTER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = FOOTER_ID;
      document.body.appendChild(el);
    }
    return el;
  }

  // ── Show footer alert ──────────────────────────────────────────────────────
  function _showFooterAlert(notif) {
    _injectStyles();
    const container = _ensureFooter();

    const explorerBase = (window.ARC && window.ARC.explorer)
      ? window.ARC.explorer : 'https://testnet.arcscan.app';
    const explorerUrl = notif.txHash ? explorerBase + '/tx/' + notif.txHash : null;
    const shortHash = notif.txHash
      ? notif.txHash.slice(0, 8) + '…' + notif.txHash.slice(-6)
      : null;
    const timeStr = new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    container.innerHTML = `
      <div class="sn-card" style="position:relative;overflow:hidden;">
        <div class="sn-icon-wrap">🛒</div>
        <div class="sn-body">
          <div class="sn-title">
            <span class="sn-live-dot"></span>
            New purchase received!
          </div>
          <div class="sn-detail">
            <strong style="color:#f1f5f9;">${_esc(notif.productName || 'Product')}</strong>
            &nbsp;·&nbsp;<span class="sn-amount">${parseFloat(notif.amount || 0).toFixed(2)} ${notif.token || 'USDC'}</span>
          </div>
          ${shortHash ? `<div class="sn-detail" style="margin-top:3px;">Tx: <span class="sn-hash">${shortHash}</span> &nbsp;·&nbsp; ${timeStr}</div>` : `<div class="sn-detail" style="margin-top:3px;">${timeStr}</div>`}
          <div class="sn-actions">
            ${explorerUrl ? `<a href="${explorerUrl}" target="_blank" rel="noopener" class="sn-btn sn-btn-explorer"><i class="fas fa-external-link-alt"></i> Explorer</a>` : ''}
            <a href="/notifications" class="sn-btn sn-btn-notifs"><i class="fas fa-bell"></i> View All</a>
          </div>
        </div>
        <button class="sn-close-btn" onclick="SellerNotify._dismissFooter()" title="Dismiss">✕</button>
        <div class="sn-progress-bar" style="--sn-duration:${FOOTER_VISIBLE_MS}ms;"></div>
      </div>
    `;

    // Animate in (next frame to allow CSS transition)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      container.classList.remove('sn-hide');
      container.classList.add('sn-visible');
    }));

    // Auto-dismiss after FOOTER_VISIBLE_MS
    if (container._snTimer) clearTimeout(container._snTimer);
    container._snTimer = setTimeout(() => SellerNotify._dismissFooter(), FOOTER_VISIBLE_MS);
  }

  function _dismissFooter() {
    const container = document.getElementById(FOOTER_ID);
    if (!container) return;
    if (container._snTimer) clearTimeout(container._snTimer);
    container.classList.remove('sn-visible');
    container.classList.add('sn-hide');
  }

  // ── Escape HTML ────────────────────────────────────────────────────────────
  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Add a notification to storage ─────────────────────────────────────────
  function _storeNotif(notif) {
    const arr = _load();
    // Deduplicate by orderId
    if (notif.orderId && arr.some(n => n.orderId === notif.orderId)) return arr;
    arr.unshift(notif);
    // Keep max 100 notifications
    if (arr.length > 100) arr.length = 100;
    _save(arr);
    return arr;
  }

  // ── Init badge on page load ────────────────────────────────────────────────
  function _initBadge() {
    _injectStyles();
    const count = _getUnread();
    if (count > 0) _renderBadge(count);
  }

  // ── Check for pending (offline) notifications to show on page load ─────────
  function _checkPending() {
    const arr = _load();
    if (!arr.length) return;

    const shown = _loadShown();
    const currentAddr = _currentAddress();

    // Find the newest unshown notification for this seller
    const pending = arr.find(n =>
      !shown.has(n.id) &&
      n.sellerAddress &&
      currentAddr &&
      n.sellerAddress.toLowerCase() === currentAddr
    );
    if (!pending) return;

    // Show footer alert for this notification (once)
    setTimeout(() => {
      _showFooterAlert(pending);
      shown.add(pending.id);
      _saveShown(shown);
    }, 800); // slight delay so page is fully rendered
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════
  const SellerNotify = {

    /**
     * Call this when a purchase is completed (after fundEscrow confirmed).
     *
     * opts: {
     *   orderId       string   — unique order ID
     *   productName   string   — product title
     *   amount        number   — total amount (e.g. 10.15)
     *   token         string   — 'USDC' | 'EURC'
     *   txHash        string   — fundEscrow tx hash (0x...)
     *   buyerAddress  string   — buyer wallet address
     *   sellerAddress string   — seller wallet address
     * }
     *
     * Only shows UI if currentWallet == sellerAddress.
     * ALWAYS stores the notification (for offline sellers).
     */
    onPurchase(opts = {}) {
      const notif = {
        id:            opts.orderId || ('SNF-' + Date.now()),
        orderId:       opts.orderId || null,
        productName:   opts.productName || opts.items?.[0]?.title || 'Product',
        amount:        opts.amount || 0,
        token:         opts.token  || 'USDC',
        txHash:        opts.txHash || null,
        buyerAddress:  (opts.buyerAddress  || '').toLowerCase(),
        sellerAddress: (opts.sellerAddress || '').toLowerCase(),
        createdAt:     new Date().toISOString(),
        read:          false,
      };

      if (!notif.sellerAddress) return; // safety guard

      // Always persist (seller may be offline)
      _storeNotif(notif);

      // Increment unread count
      const prev = _getUnread();
      _setUnread(prev + 1);

      // Update bell badge immediately
      _renderBadge(_getUnread());

      // Show footer alert ONLY if the current user IS the seller
      const currentAddr = _currentAddress();
      if (currentAddr && currentAddr === notif.sellerAddress) {
        // Mark as shown so offline check doesn't re-show it
        const shown = _loadShown();
        shown.add(notif.id);
        _saveShown(shown);

        _showFooterAlert(notif);
      }
      // (If buyer == seller in demo, alert still shows — expected test behavior)
    },

    /** All stored notifications, newest first */
    getAll() { return _load(); },

    /** Unread count */
    getUnread() { return _getUnread(); },

    /** Mark all as read (clears badge) */
    markAllRead() {
      _setUnread(0);
      _renderBadge(0);
      // Mark all items as read
      const arr = _load().map(n => ({ ...n, read: true }));
      _save(arr);
    },

    /** Clear all notifications */
    clearAll() {
      _save([]);
      _setUnread(0);
      _renderBadge(0);
      try { localStorage.removeItem(SHOWN_KEY); } catch {}
    },

    // Internal — dismiss footer alert (called from onclick in HTML)
    _dismissFooter,

    /**
     * Render seller purchase notifications into a container element.
     * Used by notificationsPage() to inject seller notifications.
     *
     * @param {HTMLElement} container  — DOM element to render into
     * @param {string|null} walletAddr — filter by this seller address (or null = show all)
     */
    renderList(container, walletAddr) {
      _injectStyles();
      let arr = _load();
      if (walletAddr) {
        arr = arr.filter(n => n.sellerAddress && n.sellerAddress.toLowerCase() === walletAddr.toLowerCase());
      }
      if (!arr.length) return; // nothing to inject — leave existing empty state

      const shown = _loadShown();
      const fragment = arr.map(n => {
        const shortH = n.txHash ? n.txHash.slice(0,8)+'…'+n.txHash.slice(-6) : null;
        const explorerBase = (window.ARC && window.ARC.explorer) ? window.ARC.explorer : 'https://testnet.arcscan.app';
        const explorerHref = n.txHash ? explorerBase + '/tx/' + n.txHash : null;
        const timeStr = new Date(n.createdAt).toLocaleString();
        const unreadDot = !n.read ? '<div class="sn-ni-unread"></div>' : '';
        return `<a href="${n.orderId ? '/orders/'+n.orderId : '#'}"
            class="sn-notif-item notification-item"
            style="text-decoration:none;">
          <div class="sn-ni-icon"><i class="fas fa-shopping-bag"></i></div>
          <div class="sn-ni-content">
            <div class="sn-ni-title">🛒 New purchase received</div>
            <div class="sn-ni-msg">
              <strong>${_esc(n.productName)}</strong>
              &nbsp;·&nbsp; <strong style="color:#16a34a;">${parseFloat(n.amount||0).toFixed(2)} ${n.token||'USDC'}</strong>
              ${shortH ? `&nbsp;·&nbsp; <span style="font-family:monospace;font-size:11px;color:#2563eb;">${shortH}</span>` : ''}
              ${explorerHref ? `&nbsp;<a href="${explorerHref}" target="_blank" rel="noopener" style="color:#2563eb;font-size:11px;" onclick="event.stopPropagation()"><i class="fas fa-external-link-alt"></i></a>` : ''}
            </div>
            <div class="sn-ni-time">${timeStr}</div>
          </div>
          ${unreadDot}
        </a>`;
      }).join('');

      // Prepend seller notifications to the container
      container.insertAdjacentHTML('afterbegin', fragment);
    },
  };

  // ── Expose globally ────────────────────────────────────────────────────────
  global.SellerNotify = SellerNotify;

  // ── Auto-init on DOMContentLoaded ─────────────────────────────────────────
  function _autoInit() {
    _initBadge();
    _checkPending();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoInit);
  } else {
    // DOM already ready (script loaded late / deferred after parse)
    setTimeout(_autoInit, 0);
  }

})(window);
