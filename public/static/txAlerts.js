// ══════════════════════════════════════════════════════════════════════════════
//  TxAlert — Rich Contextual Transaction Alert Service
//  Shukly Store · Arc Network · Non-destructive extension
//
//  ▸ Provides multi-stage, rich blockchain transaction toasts
//  ▸ Does NOT modify showToast(), existing CSS, or any existing logic
//  ▸ Injects its own overlay container (#tx-alert-container) into <body>
//  ▸ Fully self-contained — safe to remove without side effects
//
//  API:
//    TxAlert.sent(id, { hash, amount, token, network })
//    TxAlert.pending(id, { hash, amount, token, network })
//    TxAlert.confirmed(id, { hash, amount, token, network, blockTimestamp? })
//    TxAlert.failed(id, { hash, amount, token, network, reason? })
//    TxAlert.info(id, { title, message })
//    TxAlert.dismiss(id)
//    TxAlert.dismissAll()
// ══════════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const CONTAINER_ID  = 'tx-alert-container';
  const ALERT_PREFIX  = 'txa-';
  const Z_INDEX       = 10000;
  const AUTO_DISMISS_SUCCESS_MS = 8000;
  const AUTO_DISMISS_INFO_MS    = 6000;

  // ── Inject container + styles once ────────────────────────────────────────
  function ensureContainer() {
    if (document.getElementById(CONTAINER_ID)) return;

    // Style block — scoped to #tx-alert-container so no global bleed
    const style = document.createElement('style');
    style.id = 'tx-alert-styles';
    style.textContent = `
      #${CONTAINER_ID} {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: ${Z_INDEX};
        display: flex;
        flex-direction: column-reverse;
        gap: 10px;
        pointer-events: none;
        max-width: 380px;
        width: calc(100vw - 32px);
      }
      .txa-card {
        pointer-events: all;
        background: #1e293b;
        border-radius: 14px;
        padding: 14px 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,.35);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 13px;
        color: #e2e8f0;
        line-height: 1.45;
        border-left: 4px solid #64748b;
        transform: translateX(120%);
        opacity: 0;
        transition: transform .35s cubic-bezier(.22,1,.36,1), opacity .25s ease;
        position: relative;
        overflow: hidden;
      }
      .txa-card.txa-show {
        transform: translateX(0);
        opacity: 1;
      }
      .txa-card.txa-hide {
        transform: translateX(130%);
        opacity: 0;
        transition: transform .28s ease-in, opacity .2s ease;
      }
      /* Stage colours */
      .txa-card.txa-success { border-left-color: #22c55e; }
      .txa-card.txa-pending { border-left-color: #f59e0b; }
      .txa-card.txa-sent    { border-left-color: #3b82f6; }
      .txa-card.txa-error   { border-left-color: #ef4444; }
      .txa-card.txa-info    { border-left-color: #6366f1; }

      /* Shimmer progress bar for pending */
      .txa-card.txa-pending::after {
        content: '';
        position: absolute;
        bottom: 0; left: -100%;
        width: 100%; height: 2px;
        background: linear-gradient(90deg, transparent, #f59e0b, transparent);
        animation: txa-shimmer 1.8s infinite;
      }
      @keyframes txa-shimmer {
        0%   { left: -100%; }
        100% { left: 200%;  }
      }

      .txa-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        gap: 8px;
      }
      .txa-title {
        font-weight: 700;
        font-size: 13px;
        color: #f1f5f9;
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
      }
      .txa-icon { flex-shrink: 0; font-size: 15px; }
      .txa-close {
        background: none;
        border: none;
        color: #64748b;
        cursor: pointer;
        padding: 2px 5px;
        border-radius: 5px;
        font-size: 14px;
        line-height: 1;
        flex-shrink: 0;
        transition: color .15s;
      }
      .txa-close:hover { color: #cbd5e1; }

      .txa-rows {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .txa-row {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 12px;
        color: #94a3b8;
      }
      .txa-row-label {
        color: #64748b;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .04em;
        font-weight: 600;
        white-space: nowrap;
        min-width: 56px;
      }
      .txa-row-val {
        color: #cbd5e1;
        font-size: 12px;
        word-break: break-all;
        flex: 1;
      }
      .txa-amount { color: #4ade80; font-weight: 700; font-size: 13px; }
      .txa-amount.txa-amt-pending { color: #fbbf24; }
      .txa-amount.txa-amt-error   { color: #f87171; }

      .txa-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .txa-btn {
        background: rgba(255,255,255,.07);
        border: 1px solid rgba(255,255,255,.12);
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
        transition: background .15s, color .15s;
        font-family: inherit;
        white-space: nowrap;
      }
      .txa-btn:hover { background: rgba(255,255,255,.13); color: #e2e8f0; }
      .txa-btn-explorer {
        color: #60a5fa;
        border-color: rgba(96,165,250,.25);
      }
      .txa-btn-explorer:hover { background: rgba(96,165,250,.1); color: #93c5fd; }
      .txa-btn-copy-ok { color: #4ade80; }

      .txa-stage-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,.06);
      }
      .txa-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: #334155;
        flex-shrink: 0;
        transition: background .3s;
      }
      .txa-dot.done    { background: #22c55e; }
      .txa-dot.active  { background: #f59e0b; animation: txa-pulse .9s infinite alternate; }
      .txa-dot.fail    { background: #ef4444; }
      @keyframes txa-pulse { from { opacity: 1; } to { opacity: .4; } }
      .txa-dot-label {
        font-size: 10px; color: #475569; font-weight: 600;
        text-transform: uppercase; letter-spacing: .04em;
      }
      .txa-dot-label.active { color: #fbbf24; }
      .txa-dot-label.done   { color: #4ade80; }
      .txa-dot-label.fail   { color: #f87171; }
    `;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    document.body.appendChild(container);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function shortHash(hash) {
    if (!hash || hash.length < 12) return hash || '—';
    return hash.slice(0, 8) + '…' + hash.slice(-6);
  }

  function explorerUrl(hash) {
    const base = (window.ARC && window.ARC.explorer)
      ? window.ARC.explorer
      : 'https://testnet.arcscan.app';
    return hash ? base + '/tx/' + hash : base;
  }

  function networkName() {
    return (window.ARC && window.ARC.networkName)
      ? window.ARC.networkName
      : 'Arc Testnet';
  }

  function formatTs(ts) {
    // ts can be: unix seconds (number), ISO string, Date, or undefined
    let d;
    if (!ts) { d = new Date(); }
    else if (typeof ts === 'number') {
      // eth block timestamps are in seconds
      d = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
    } else {
      d = new Date(ts);
    }
    if (isNaN(d.getTime())) d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function copyToClipboard(text, btn) {
    const orig = btn.innerHTML;
    try {
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.classList.add('txa-btn-copy-ok');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('txa-btn-copy-ok'); }, 2000);
      }).catch(() => legacyCopy(text, btn, orig));
    } catch(e) { legacyCopy(text, btn, orig); }
  }

  function legacyCopy(text, btn, orig) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(_) {}
    document.body.removeChild(ta);
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    btn.classList.add('txa-btn-copy-ok');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('txa-btn-copy-ok'); }, 2000);
  }

  function cardId(id) { return ALERT_PREFIX + id.replace(/[^a-zA-Z0-9_-]/g, '_'); }

  // ── Core render/update ─────────────────────────────────────────────────────

  function getOrCreate(id) {
    ensureContainer();
    const cid = cardId(id);
    let el = document.getElementById(cid);
    if (!el) {
      el = document.createElement('div');
      el.id = cid;
      el.className = 'txa-card';
      document.getElementById(CONTAINER_ID).prepend(el);
      // Animate in on next frame
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('txa-show')));
    }
    return el;
  }

  function setAutoDismiss(el, ms) {
    if (el._txaDismissTimer) clearTimeout(el._txaDismissTimer);
    if (!ms) return;
    el._txaDismissTimer = setTimeout(() => dismissEl(el), ms);
  }

  function dismissEl(el) {
    if (!el) return;
    if (el._txaDismissTimer) clearTimeout(el._txaDismissTimer);
    el.classList.add('txa-hide');
    el.classList.remove('txa-show');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
  }

  // ── Stage indicator (3 dots: Sent → Pending → Confirmed) ──────────────────
  function stageIndicatorHTML(activeStage) {
    // stages: 0=sent, 1=pending, 2=confirmed/failed
    const stages = [
      { key:'sent',    label:'Sent' },
      { key:'pending', label:'Pending' },
      { key:'done',    label:'Confirmed' }
    ];
    return '<div class="txa-stage-indicator">'
      + stages.map((s, i) => {
          let dotClass = i < activeStage ? 'done'
                       : i === activeStage ? 'active'
                       : '';
          return `<div class="txa-dot ${dotClass}"></div>`
               + `<span class="txa-dot-label ${dotClass}">${s.label}</span>`
               + (i < stages.length-1 ? '<div style="flex:1;height:1px;background:rgba(255,255,255,.06);"></div>' : '');
        }).join('')
      + '</div>';
  }

  // ── Render a full rich card ────────────────────────────────────────────────
  function renderCard(el, opts) {
    const {
      stage,       // 'sent' | 'pending' | 'confirmed' | 'failed' | 'info'
      title,
      icon,
      amount,
      token,
      hash,
      timestamp,
      network,
      reason,
      message,
      stageIndex,
    } = opts;

    // Border + colour class
    el.className = 'txa-card txa-show ' + (
      stage === 'confirmed' ? 'txa-success' :
      stage === 'pending'   ? 'txa-pending'  :
      stage === 'sent'      ? 'txa-sent'     :
      stage === 'failed'    ? 'txa-error'    :
      'txa-info'
    );

    const amtClass = stage === 'pending' ? 'txa-amount txa-amt-pending'
                   : stage === 'failed'  ? 'txa-amount txa-amt-error'
                   : 'txa-amount';

    const explorerHref = hash ? explorerUrl(hash) : null;
    const net = network || networkName();
    const ts  = timestamp !== undefined ? timestamp : null;

    // Stage dots (only for tx stages, not plain info)
    const stageDots = (stage !== 'info')
      ? stageIndicatorHTML(stageIndex !== undefined ? stageIndex
          : stage === 'sent' ? 0 : stage === 'pending' ? 1 : 2)
      : '';

    // Rows
    let rows = '';
    if (amount && token) {
      rows += `<div class="txa-row">
        <span class="txa-row-label">Amount</span>
        <span class="txa-row-val ${amtClass}">${parseFloat(amount).toFixed(2)} ${token}</span>
      </div>`;
    }
    rows += `<div class="txa-row">
      <span class="txa-row-label">Time</span>
      <span class="txa-row-val">${formatTs(ts)}</span>
    </div>`;
    if (hash) {
      rows += `<div class="txa-row">
        <span class="txa-row-label">Tx</span>
        <span class="txa-row-val" style="font-family:monospace;font-size:11px;color:#7dd3fc;">${shortHash(hash)}</span>
      </div>`;
    }
    rows += `<div class="txa-row">
      <span class="txa-row-label">Network</span>
      <span class="txa-row-val">${net}</span>
    </div>`;
    if (reason) {
      rows += `<div class="txa-row">
        <span class="txa-row-label">Reason</span>
        <span class="txa-row-val" style="color:#fca5a5;">${reason}</span>
      </div>`;
    }
    if (message && !reason) {
      rows += `<div class="txa-row">
        <span class="txa-row-label">Info</span>
        <span class="txa-row-val">${message}</span>
      </div>`;
    }

    // Action buttons
    let actions = '';
    if (hash) {
      actions += `<button class="txa-btn" onclick="window._txaCopy('${hash}', this)">
        <i class="fas fa-copy"></i> Copy Tx
      </button>`;
    }
    if (explorerHref) {
      actions += `<a href="${explorerHref}" target="_blank" rel="noopener"
        class="txa-btn txa-btn-explorer">
        <i class="fas fa-external-link-alt"></i> Explorer
      </a>`;
    }

    el.innerHTML = `
      <div class="txa-header">
        <span class="txa-title">
          <i class="txa-icon">${icon || ''}</i>
          ${title || ''}
        </span>
        <button class="txa-close" onclick="TxAlert.dismiss('${el.id.replace(ALERT_PREFIX,'')}')" title="Dismiss">✕</button>
      </div>
      ${stageDots}
      <div class="txa-rows">${rows}</div>
      ${actions ? '<div class="txa-actions">' + actions + '</div>' : ''}
    `;
  }

  // ── Clipboard global helper (called from onclick in card HTML) ─────────────
  global._txaCopy = function(hash, btn) { copyToClipboard(hash, btn); };

  // ══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════
  const TxAlert = {

    /**
     * Transaction sent (waiting for wallet confirmation / broadcast)
     * id     — unique string to allow in-place update
     * opts   — { hash?, amount?, token?, network? }
     */
    sent(id, opts = {}) {
      const el = getOrCreate(id);
      renderCard(el, {
        stage: 'sent',
        stageIndex: 0,
        title: 'Transaction Sent',
        icon: '📤',
        hash: opts.hash || null,
        amount: opts.amount,
        token: opts.token,
        network: opts.network,
        message: opts.message || (opts.hash ? null : 'Waiting for wallet to broadcast…'),
      });
      // No auto-dismiss — will be updated to pending/confirmed
    },

    /**
     * Waiting for on-chain confirmation (tx broadcast, not yet mined)
     */
    pending(id, opts = {}) {
      const el = getOrCreate(id);
      renderCard(el, {
        stage: 'pending',
        stageIndex: 1,
        title: 'Pending Confirmation…',
        icon: '⏳',
        hash: opts.hash,
        amount: opts.amount,
        token: opts.token,
        network: opts.network,
        message: opts.message || 'Waiting for Arc Network to confirm…',
      });
      // No auto-dismiss for pending
    },

    /**
     * Transaction confirmed on-chain
     */
    confirmed(id, opts = {}) {
      const el = getOrCreate(id);
      renderCard(el, {
        stage: 'confirmed',
        stageIndex: 2,
        title: 'Purchase Confirmed ✓',
        icon: '✅',
        hash: opts.hash,
        amount: opts.amount,
        token: opts.token,
        network: opts.network,
        timestamp: opts.blockTimestamp || opts.timestamp,
        message: opts.message,
      });
      setAutoDismiss(el, AUTO_DISMISS_SUCCESS_MS);
    },

    /**
     * Transaction failed / reverted
     */
    failed(id, opts = {}) {
      const el = getOrCreate(id);
      renderCard(el, {
        stage: 'failed',
        stageIndex: 2,
        title: 'Transaction Failed',
        icon: '❌',
        hash: opts.hash,
        amount: opts.amount,
        token: opts.token,
        network: opts.network,
        reason: opts.reason || opts.message || 'Transaction was rejected or reverted.',
      });
      // Errors never auto-dismiss
    },

    /**
     * Generic info alert (non-tx, e.g. "Fetching details…")
     */
    info(id, opts = {}) {
      const el = getOrCreate(id);
      renderCard(el, {
        stage: 'info',
        title: opts.title || 'Info',
        icon: opts.icon || 'ℹ️',
        hash: opts.hash,
        amount: opts.amount,
        token: opts.token,
        network: opts.network,
        timestamp: opts.timestamp,
        message: opts.message,
      });
      if (opts.autoDismiss !== false) {
        setAutoDismiss(el, AUTO_DISMISS_INFO_MS);
      }
    },

    /**
     * Dismiss a specific alert by id
     */
    dismiss(id) {
      const el = document.getElementById(cardId(id));
      if (el) dismissEl(el);
    },

    /**
     * Dismiss all active TxAlert cards
     */
    dismissAll() {
      const container = document.getElementById(CONTAINER_ID);
      if (!container) return;
      Array.from(container.children).forEach(dismissEl);
    },
  };

  global.TxAlert = TxAlert;

})(window);
