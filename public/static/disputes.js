/* ═══════════════════════════════════════════════════════════════════════════
   DISPUTES PAGE — redhawk-store
   External script loaded via <script src="/static/disputes.js" defer>
   Depends on: getStoredWallet (globalScript), showToast (globalScript)
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── helpers ──────────────────────────────────────────────────────────── */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shortAddr(addr) {
    if (!addr || addr.length < 12) return addr || '—';
    return addr.slice(0, 10) + '…' + addr.slice(-6);
  }

  function shortHash(hash) {
    if (!hash || hash.length < 16) return hash || 'Pending';
    return hash.slice(0, 18) + '…';
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString(); } catch (e) { return ts; }
  }

  function getWallet() {
    if (typeof getStoredWallet === 'function') {
      try { return getStoredWallet(); } catch (e) { /* fall through */ }
    }
    try {
      var raw = localStorage.getItem('rh_wallet');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function getOrders() {
    try { return JSON.parse(localStorage.getItem('rh_orders') || '[]'); } catch (e) { return []; }
  }

  function saveOrders(orders) {
    localStorage.setItem('rh_orders', JSON.stringify(orders));
  }

  function getAllEvidence() {
    try { return JSON.parse(localStorage.getItem('rh_dispute_evidence') || '{}'); } catch (e) { return {}; }
  }

  function getArcExplorer() {
    if (typeof ARC !== 'undefined' && ARC.explorer) return ARC.explorer;
    return 'https://testnet.arcscan.app';
  }

  /* ── evidence viewer modal ─────────────────────────────────────────────── */
  function showEvidenceModal(orderId) {
    var allEvidence = getAllEvidence();
    var entries = allEvidence[orderId] || [];

    var modalRoot = document.getElementById('disputes-modal-root');
    if (!modalRoot) return;

    if (!entries.length) {
      showToast('No evidence files were submitted for this dispute.', 'info');
      return;
    }

    /* Build file list HTML */
    function buildFileHtml(files) {
      if (!files || !files.length) return '<p style="font-size:13px;color:#94a3b8;">No files attached.</p>';
      return files.map(function (f) {
        var isImage = f.type && f.type.startsWith('image/');
        var isPdf = f.type === 'application/pdf';
        var icon = isPdf ? 'fa-file-pdf' : (isImage ? 'fa-file-image' : 'fa-file');
        var sizeKb = f.size ? Math.round(f.size / 1024) + ' KB' : '';

        var preview = '';
        if (isImage && f.dataUrl) {
          preview =
            '<div style="margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">' +
            '<img src="' + f.dataUrl + '" alt="' + escHtml(f.name) + '" ' +
            'style="max-width:100%;max-height:260px;object-fit:contain;display:block;" />' +
            '</div>';
        } else if (isPdf && f.dataUrl) {
          preview =
            '<div style="margin-top:8px;">' +
            '<a href="' + f.dataUrl + '" target="_blank" download="' + escHtml(f.name) + '" ' +
            'style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:7px;font-size:12px;color:#dc2626;text-decoration:none;font-weight:600;">' +
            '<i class="fas fa-download"></i> Download PDF' +
            '</a></div>';
        }

        return (
          '<li style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '<i class="fas ' + icon + '" style="color:#64748b;flex-shrink:0;"></i>' +
          '<span style="flex:1;font-size:12px;color:#334155;word-break:break-all;">' + escHtml(f.name) + '</span>' +
          '<span style="font-size:11px;color:#94a3b8;flex-shrink:0;">' + sizeKb + '</span>' +
          '</div>' +
          preview +
          '</li>'
        );
      }).join('');
    }

    /* Build entries HTML */
    var entriesHtml = entries.map(function (ev, idx) {
      return (
        '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:12px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.04em;">Submission #' + (idx + 1) + '</span>' +
        '<span style="font-size:11px;color:#94a3b8;">' + fmtDate(ev.submittedAt) + '</span>' +
        '</div>' +
        '<p style="font-size:11px;color:#94a3b8;margin:0 0 6px;">Submitted by: <span style="font-family:monospace;color:#64748b;">' + escHtml(shortAddr(ev.submittedBy)) + '</span></p>' +
        (ev.description
          ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:10px 12px;margin-bottom:10px;">' +
            '<p style="font-size:11px;font-weight:700;color:#92400e;margin:0 0 4px;text-transform:uppercase;">Description</p>' +
            '<p style="font-size:13px;color:#78350f;margin:0;white-space:pre-wrap;">' + escHtml(ev.description) + '</p>' +
            '</div>'
          : '') +
        (ev.files && ev.files.length
          ? '<p style="font-size:11px;font-weight:700;color:#475569;margin:0 0 6px;text-transform:uppercase;">Files (' + ev.files.length + ')</p>' +
            '<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;">' + buildFileHtml(ev.files) + '</ul>'
          : '<p style="font-size:12px;color:#94a3b8;">No files attached.</p>') +
        '</div>'
      );
    }).join('');

    modalRoot.innerHTML =
      '<div id="ev-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">' +
      '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:580px;max-height:90vh;overflow-y:auto;">' +

      /* Header */
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid #f1f5f9;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
      '<div style="width:36px;height:36px;border-radius:10px;background:#fee2e2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-folder-open" style="color:#dc2626;font-size:15px;"></i></div>' +
      '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Dispute Evidence</p>' +
      '<p style="font-size:11px;color:#94a3b8;margin:0;">Order ' + escHtml(orderId) + ' &bull; ' + entries.length + ' submission(s)</p>' +
      '</div></div>' +
      '<button id="ev-close-btn" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>' +
      '</div>' +

      /* Body */
      '<div style="padding:18px 20px;">' + entriesHtml + '</div>' +

      /* Footer */
      '<div style="padding:12px 20px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;">' +
      '<button id="ev-close-footer-btn" style="padding:9px 22px;border:none;border-radius:8px;background:#f1f5f9;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Close</button>' +
      '</div>' +

      '</div></div>';

    function closeEvModal() { modalRoot.innerHTML = ''; }
    document.getElementById('ev-close-btn').onclick = closeEvModal;
    document.getElementById('ev-close-footer-btn').onclick = closeEvModal;
    document.getElementById('ev-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeEvModal();
    });
  }

  /* ── resolve dispute ───────────────────────────────────────────────────── */
  function resolveDispute(id, favor) {
    var orders = getOrders();
    var i = orders.findIndex(function (o) { return o.id === id; });
    if (i < 0) { showToast('Order not found', 'error'); return; }

    orders[i].status = 'completed';
    orders[i].disputeResolution = favor;
    orders[i].resolvedAt = new Date().toISOString();
    orders[i].disputeLockedFunds = false;
    saveOrders(orders);

    showToast('Dispute resolved in favor of ' + favor + '. Escrow released.', 'success');
    setTimeout(function () { location.reload(); }, 900);
  }

  /* ── render disputes list ─────────────────────────────────────────────── */
  function renderDisputes() {
    var container = document.getElementById('disputes-container');
    if (!container) return;

    var wallet = getWallet();
    if (!wallet || !wallet.address) {
      container.innerHTML =
        '<div class="card p-12 text-center">' +
        '<div class="empty-state">' +
        '<i class="fas fa-gavel"></i>' +
        '<h3 class="font-bold text-slate-600 mb-2">Connect Wallet</h3>' +
        '<p class="text-sm mb-4">Connect your wallet to see your disputes.</p>' +
        '<a href="/wallet" class="btn-primary mx-auto">Connect Wallet</a>' +
        '</div></div>';
      return;
    }

    var myAddr = wallet.address.toLowerCase();
    var orders = getOrders();
    var allEvidence = getAllEvidence();
    var explorer = getArcExplorer();

    /* Show disputes where user is buyer OR seller */
    var disputes = orders.filter(function (o) {
      return o.status === 'dispute' &&
        ((o.buyerAddress && o.buyerAddress.toLowerCase() === myAddr) ||
          (o.sellerAddress && o.sellerAddress.toLowerCase() === myAddr));
    });

    if (!disputes.length) {
      container.innerHTML =
        '<div class="card p-12 text-center">' +
        '<div class="empty-state">' +
        '<i class="fas fa-handshake"></i>' +
        '<h3 class="font-bold text-slate-600 mb-2">No Active Disputes</h3>' +
        '<p class="text-sm">Open a dispute from any order with delivery issues.</p>' +
        '</div></div>';
      return;
    }

    var cardsHtml = disputes.map(function (d) {
      var isBuyer = d.buyerAddress && d.buyerAddress.toLowerCase() === myAddr;
      var isSeller = d.sellerAddress && d.sellerAddress.toLowerCase() === myAddr;
      var evidenceList = allEvidence[d.id] || [];
      var evidenceCount = evidenceList.length;
      var txUrl = d.explorerUrl || (explorer + '/tx/' + (d.txHash || ''));
      var roleBadge = isBuyer
        ? '<span style="font-size:11px;padding:3px 8px;border-radius:99px;background:#dbeafe;color:#1d4ed8;font-weight:600;">Buyer</span>'
        : isSeller
          ? '<span style="font-size:11px;padding:3px 8px;border-radius:99px;background:#fef3c7;color:#92400e;font-weight:600;">Seller</span>'
          : '';

      /* Evidence description preview */
      var latestEvDesc = '';
      if (evidenceList.length) {
        var last = evidenceList[evidenceList.length - 1];
        if (last.description) {
          latestEvDesc = last.description.length > 120
            ? escHtml(last.description.slice(0, 120)) + '…'
            : escHtml(last.description);
        }
      }

      return (
        '<div class="card p-5 mb-4" style="border-left:4px solid #ef4444;">' +
        /* Top row */
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;gap:8px;">' +
        '<div>' +
        '<p style="font-weight:700;color:#1e293b;margin:0 0 3px;font-size:15px;">' + escHtml(d.id) + '</p>' +
        '<p style="font-size:11px;color:#94a3b8;margin:0;">Opened: ' + fmtDate(d.disputedAt || d.createdAt) + '</p>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
        roleBadge +
        '<span style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;background:#fee2e2;color:#dc2626;">Disputed</span>' +
        '</div>' +
        '</div>' +

        /* Fund-lock banner */
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:12px;">' +
        '<i class="fas fa-lock" style="color:#dc2626;font-size:13px;flex-shrink:0;"></i>' +
        '<span style="font-size:12px;color:#7f1d1d;"><strong>' + escHtml(String(d.amount || 0)) + ' ' + escHtml(d.token || 'USDC') + ' locked in escrow.</strong> Funds cannot be released until this dispute is resolved.</span>' +
        '</div>' +

        /* Details grid */
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:12px;">' +
        '<div style="padding:8px 10px;background:#f8fafc;border-radius:7px;">' +
        '<p style="font-size:10px;color:#94a3b8;margin:0 0 2px;text-transform:uppercase;font-weight:700;">Buyer</p>' +
        '<p style="font-size:11px;font-family:monospace;color:#334155;margin:0;word-break:break-all;">' + escHtml(shortAddr(d.buyerAddress)) + '</p>' +
        '</div>' +
        '<div style="padding:8px 10px;background:#f8fafc;border-radius:7px;">' +
        '<p style="font-size:10px;color:#94a3b8;margin:0 0 2px;text-transform:uppercase;font-weight:700;">Seller</p>' +
        '<p style="font-size:11px;font-family:monospace;color:#334155;margin:0;word-break:break-all;">' + escHtml(shortAddr(d.sellerAddress)) + '</p>' +
        '</div>' +
        '<div style="padding:8px 10px;background:#f8fafc;border-radius:7px;">' +
        '<p style="font-size:10px;color:#94a3b8;margin:0 0 2px;text-transform:uppercase;font-weight:700;">Transaction</p>' +
        '<a href="' + txUrl + '" target="_blank" style="font-size:11px;font-family:monospace;color:#3b82f6;text-decoration:none;word-break:break-all;">' + escHtml(shortHash(d.txHash)) + '</a>' +
        '</div>' +
        '</div>' +

        /* Evidence preview */
        (latestEvDesc
          ? '<div style="padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;margin-bottom:12px;">' +
            '<p style="font-size:10px;font-weight:700;color:#92400e;margin:0 0 4px;text-transform:uppercase;">Latest Evidence</p>' +
            '<p style="font-size:12px;color:#78350f;margin:0;">' + latestEvDesc + '</p>' +
            '</div>'
          : '') +

        /* Action buttons */
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
        /* View evidence button (always visible to buyer/seller) */
        '<button data-did="' + escHtml(d.id) + '" class="view-evidence-btn btn-secondary text-xs py-1.5">' +
        '<i class="fas fa-folder-open mr-1"></i> View Evidence' +
        (evidenceCount ? ' (' + evidenceCount + ')' : '') +
        '</button>' +
        /* Resolve buttons — visible to both parties so either can request resolution */
        '<button data-did="' + escHtml(d.id) + '" data-favor="buyer" class="resolve-btn btn-primary text-xs py-1.5" style="background:#2563eb;border:none;">' +
        '<i class="fas fa-hand-holding-usd mr-1"></i> Refund Buyer' +
        '</button>' +
        '<button data-did="' + escHtml(d.id) + '" data-favor="seller" class="resolve-btn btn-secondary text-xs py-1.5">' +
        '<i class="fas fa-coins mr-1"></i> Release to Seller' +
        '</button>' +
        /* Link back to order */
        '<a href="/orders/' + escHtml(d.id) + '" class="btn-secondary text-xs py-1.5" style="text-decoration:none;">' +
        '<i class="fas fa-receipt mr-1"></i> View Order' +
        '</a>' +
        '</div>' +

        '</div>'
      );
    }).join('');

    container.innerHTML = cardsHtml;

    /* Attach event listeners */
    container.querySelectorAll('.view-evidence-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showEvidenceModal(this.dataset.did);
      });
    });

    container.querySelectorAll('.resolve-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        resolveDispute(this.dataset.did, this.dataset.favor);
      });
    });
  }

  /* ── bootstrap ────────────────────────────────────────────────────────── */
  function init() {
    var container = document.getElementById('disputes-container');
    if (!container) return; /* not on disputes page */
    renderDisputes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
