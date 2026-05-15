/* ═══════════════════════════════════════════════════════════════════════════
   DISPUTE RESOLUTION SYSTEM — Shukly Store
   Full-featured: timeline, bidirectional evidence, chat, countdown timers,
   auto-resolution, status system, safe actions with validation & modals.
   External script loaded via <script src="/static/disputes.js" defer>
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════════════════
     CONSTANTS & CONFIG
  ════════════════════════════════════════════════════════════════════════ */
  var DISPUTE_SELLER_RESPONSE_HOURS = 48;   // hours for seller to respond
  var DISPUTE_BUYER_EVIDENCE_HOURS  = 72;   // hours for buyer to submit evidence
  var DISPUTE_INACTIVITY_HOURS      = 120;  // auto-resolve if no activity
  var LS_DISPUTES_KEY               = 'rh_disputes_v2';
  var LS_ORDERS_KEY                 = 'rh_orders';
  var LS_EVIDENCE_KEY               = 'rh_dispute_evidence';
  var LS_CHAT_KEY                   = 'rh_dispute_chat';

  /* ════════════════════════════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════════════════════════════ */
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function shortAddr(addr) {
    if (!addr || addr.length < 12) return addr || '—';
    return addr.slice(0, 8) + '…' + addr.slice(-6);
  }

  function shortHash(h) {
    if (!h || h.length < 16) return h || 'Pending';
    return h.slice(0, 14) + '…';
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - new Date(ts).getTime();
    var s = Math.floor(diff / 1000);
    if (s < 60)  return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60)  return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24)  return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function msToHMS(ms) {
    if (ms <= 0) return '00:00:00';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600); s %= 3600;
    var m = Math.floor(s / 60);  s %= 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function getWallet() {
    if (typeof getStoredWallet === 'function') {
      try { return getStoredWallet(); } catch (e) {}
    }
    try { var r = localStorage.getItem('rh_wallet'); return r ? JSON.parse(r) : null; }
    catch (e) { return null; }
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') { showToast(msg, type || 'info'); return; }
    alert(msg);
  }

  function getOrders() {
    try { return JSON.parse(localStorage.getItem(LS_ORDERS_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveOrders(arr) {
    localStorage.setItem(LS_ORDERS_KEY, JSON.stringify(arr));
  }

  function getDisputeMeta() {
    try { return JSON.parse(localStorage.getItem(LS_DISPUTES_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function saveDisputeMeta(obj) {
    localStorage.setItem(LS_DISPUTES_KEY, JSON.stringify(obj));
  }

  function getEvidence(orderId) {
    try {
      var all = JSON.parse(localStorage.getItem(LS_EVIDENCE_KEY) || '{}');
      return all[orderId] || { buyer: [], seller: [] };
    } catch (e) { return { buyer: [], seller: [] }; }
  }

  function saveEvidence(orderId, ev) {
    try {
      var all = JSON.parse(localStorage.getItem(LS_EVIDENCE_KEY) || '{}');
      all[orderId] = ev;
      localStorage.setItem(LS_EVIDENCE_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function getChat(orderId) {
    try {
      var all = JSON.parse(localStorage.getItem(LS_CHAT_KEY) || '{}');
      return all[orderId] || [];
    } catch (e) { return []; }
  }

  function saveChat(orderId, msgs) {
    try {
      var all = JSON.parse(localStorage.getItem(LS_CHAT_KEY) || '{}');
      all[orderId] = msgs;
      localStorage.setItem(LS_CHAT_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function getArcExplorer() {
    if (typeof ARC !== 'undefined' && ARC.explorer) return ARC.explorer;
    return 'https://testnet.arcscan.app';
  }

  /* ════════════════════════════════════════════════════════════════════════
     DISPUTE META — ensure each dispute has a full meta record
  ════════════════════════════════════════════════════════════════════════ */
  function ensureDisputeMeta(order) {
    var meta = getDisputeMeta();
    if (!meta[order.id]) {
      meta[order.id] = {
        id: order.id,
        orderId: order.id,
        status: 'awaiting_seller',
        createdAt: order.disputedAt || order.updatedAt || order.createdAt || new Date().toISOString(),
        sellerDeadline: new Date(new Date(order.disputedAt || order.createdAt).getTime() + DISPUTE_SELLER_RESPONSE_HOURS * 3600000).toISOString(),
        buyerDeadline: new Date(new Date(order.disputedAt || order.createdAt).getTime() + DISPUTE_BUYER_EVIDENCE_HOURS * 3600000).toISOString(),
        escrowAmount: order.amount || 0,
        escrowToken: order.token || 'USDC',
        autoResolvable: true,
        messages: [],
        resolution: null,
        resolvedAt: null
      };
      saveDisputeMeta(meta);
    }
    return meta[order.id];
  }

  /* ════════════════════════════════════════════════════════════════════════
     AUTO-RESOLUTION ENGINE
  ════════════════════════════════════════════════════════════════════════ */
  function handleAutoResolution(dispute, order) {
    if (!dispute.autoResolvable) return null;
    if (dispute.resolution) return null; // already resolved

    var now = Date.now();
    var sellerDeadline = new Date(dispute.sellerDeadline).getTime();
    var buyerDeadline  = new Date(dispute.buyerDeadline).getTime();
    var evidence       = getEvidence(order.id);
    var hasBuyerEv     = evidence.buyer && evidence.buyer.length > 0;
    var hasSellerEv    = evidence.seller && evidence.seller.length > 0;

    // Rule 1: No seller response within deadline → refund buyer
    if (now > sellerDeadline && !hasSellerEv && dispute.status === 'awaiting_seller') {
      return { action: 'refund', reason: 'Seller did not respond within 48 hours. Auto-refund to buyer.' };
    }

    // Rule 2: Seller responded but buyer submitted no evidence → release to seller
    if (now > buyerDeadline && hasSellerEv && !hasBuyerEv) {
      return { action: 'release', reason: 'Seller provided evidence; buyer submitted no counter-evidence within deadline. Funds released to seller.' };
    }

    // Rule 3: Seller has delivery proof (images) → favor seller
    if (hasSellerEv) {
      var proofFiles = evidence.seller.filter(function (e) {
        return e.files && e.files.some(function (f) { return f.type && f.type.startsWith('image/'); });
      });
      if (proofFiles.length > 0 && !hasBuyerEv) {
        return { action: 'release', reason: 'Seller provided delivery proof images. Funds released to seller.' };
      }
    }

    // Rule 4: Inactivity auto-resolve
    var lastActivity = dispute.lastActivity || dispute.createdAt;
    var inactiveSince = Date.now() - new Date(lastActivity).getTime();
    if (inactiveSince > DISPUTE_INACTIVITY_HOURS * 3600000) {
      return { action: 'refund', reason: 'No activity for ' + DISPUTE_INACTIVITY_HOURS + ' hours. Auto-refund to buyer.' };
    }

    return null;
  }

  /* Compute dispute status label from meta */
  function getDisputeStatusLabel(dispute) {
    var s = dispute.status;
    var map = {
      'awaiting_seller': { label: 'Awaiting Seller Response', color: '#f59e0b', bg: '#fffbeb', icon: 'fa-clock' },
      'awaiting_buyer':  { label: 'Awaiting Buyer Evidence',  color: '#3b82f6', bg: '#eff6ff', icon: 'fa-clock' },
      'under_review':    { label: 'Under Review',             color: '#8b5cf6', bg: '#f5f3ff', icon: 'fa-search' },
      'ready':           { label: 'Ready to Resolve',         color: '#10b981', bg: '#ecfdf5', icon: 'fa-check-circle' },
      'resolved':        { label: 'Resolved',                 color: '#64748b', bg: '#f8fafc', icon: 'fa-gavel' }
    };
    return map[s] || { label: s || 'Disputed', color: '#ef4444', bg: '#fef2f2', icon: 'fa-exclamation-circle' };
  }

  /* ════════════════════════════════════════════════════════════════════════
     TIMELINE RENDERER
  ════════════════════════════════════════════════════════════════════════ */
  function renderTimeline(order, dispute) {
    var steps = [
      { key: 'created',    icon: 'fa-shopping-cart', label: 'Order Created',       ts: order.createdAt },
      { key: 'funded',     icon: 'fa-lock',          label: 'Payment Locked',      ts: order.fundedAt || order.createdAt },
      { key: 'delivered',  icon: 'fa-truck',         label: 'Delivery Claimed',    ts: order.shippedAt || null },
      { key: 'disputed',   icon: 'fa-gavel',         label: 'Dispute Opened',      ts: order.disputedAt || dispute.createdAt },
      { key: 'reviewing',  icon: 'fa-search',        label: 'Under Review',        ts: dispute.status === 'under_review' ? dispute.createdAt : null },
      { key: 'resolved',   icon: 'fa-check-circle',  label: 'Resolved',            ts: dispute.resolvedAt || null }
    ];

    var activeIdx = steps.findIndex(function (s) {
      if (s.key === 'resolved') return !!dispute.resolvedAt;
      if (s.key === 'reviewing') return dispute.status === 'under_review' || dispute.status === 'ready';
      if (s.key === 'disputed') return true;
      if (s.key === 'delivered') return !!order.shippedAt;
      if (s.key === 'funded') return true;
      if (s.key === 'created') return true;
      return false;
    });
    if (activeIdx < 0) activeIdx = 3; // default to disputed

    var html = '<div class="disp-timeline">';
    steps.forEach(function (step, idx) {
      var done    = idx < activeIdx || (idx === activeIdx && step.ts);
      var current = idx === activeIdx && !dispute.resolvedAt;
      var cls     = done ? 'done' : (current ? 'current' : 'pending');
      html +=
        '<div class="disp-tl-step ' + cls + '">' +
        '<div class="disp-tl-icon"><i class="fas ' + step.icon + '"></i></div>' +
        '<div class="disp-tl-body">' +
        '<div class="disp-tl-label">' + escHtml(step.label) + '</div>' +
        (step.ts ? '<div class="disp-tl-ts">' + fmtDate(step.ts) + '</div>' : '<div class="disp-tl-ts">—</div>') +
        '</div>' +
        (idx < steps.length - 1 ? '<div class="disp-tl-line"></div>' : '') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ════════════════════════════════════════════════════════════════════════
     COUNTDOWN TIMER RENDERER
  ════════════════════════════════════════════════════════════════════════ */
  function renderCountdown(dispute) {
    var now = Date.now();
    var sellerMs = Math.max(0, new Date(dispute.sellerDeadline).getTime() - now);
    var buyerMs  = Math.max(0, new Date(dispute.buyerDeadline).getTime() - now);
    var sellerPct = Math.min(100, (sellerMs / (DISPUTE_SELLER_RESPONSE_HOURS * 3600000)) * 100);
    var buyerPct  = Math.min(100, (buyerMs  / (DISPUTE_BUYER_EVIDENCE_HOURS  * 3600000)) * 100);

    return (
      '<div class="disp-countdown-grid">' +
      // Seller countdown
      '<div class="disp-countdown-box">' +
      '<div class="disp-cd-header"><i class="fas fa-store mr-1"></i> Seller Response Window</div>' +
      '<div class="disp-cd-timer seller-cd" data-deadline="' + escHtml(dispute.sellerDeadline) + '">' + msToHMS(sellerMs) + '</div>' +
      '<div class="disp-cd-bar"><div class="disp-cd-fill seller-fill" style="width:' + sellerPct.toFixed(1) + '%"></div></div>' +
      '<div class="disp-cd-sub">Deadline: ' + fmtDate(dispute.sellerDeadline) + '</div>' +
      (sellerMs <= 0 ? '<div class="disp-cd-expired"><i class="fas fa-exclamation-triangle mr-1"></i>Expired — auto-refund eligible</div>' : '') +
      '</div>' +
      // Buyer countdown
      '<div class="disp-countdown-box">' +
      '<div class="disp-cd-header"><i class="fas fa-user mr-1"></i> Buyer Evidence Window</div>' +
      '<div class="disp-cd-timer buyer-cd" data-deadline="' + escHtml(dispute.buyerDeadline) + '">' + msToHMS(buyerMs) + '</div>' +
      '<div class="disp-cd-bar"><div class="disp-cd-fill buyer-fill" style="width:' + buyerPct.toFixed(1) + '%"></div></div>' +
      '<div class="disp-cd-sub">Deadline: ' + fmtDate(dispute.buyerDeadline) + '</div>' +
      (buyerMs <= 0 ? '<div class="disp-cd-expired"><i class="fas fa-exclamation-triangle mr-1"></i>Expired</div>' : '') +
      '</div>' +
      '</div>'
    );
  }

  /* ════════════════════════════════════════════════════════════════════════
     EVIDENCE SECTION (bidirectional)
  ════════════════════════════════════════════════════════════════════════ */
  function renderEvidenceSection(orderId, role, myAddr, isBuyer, isSeller) {
    var ev = getEvidence(orderId);
    var myRole = isBuyer ? 'buyer' : (isSeller ? 'seller' : null);
    var canSubmit = (role === 'buyer' && isBuyer) || (role === 'seller' && isSeller);

    function buildEntries(list, label) {
      if (!list || !list.length) {
        return '<p class="disp-ev-empty">No ' + label + ' evidence yet.</p>';
      }
      return list.map(function (entry, idx) {
        return (
          '<div class="disp-ev-entry">' +
          '<div class="disp-ev-entry-head">' +
          '<span class="disp-ev-idx">#' + (idx + 1) + '</span>' +
          '<span class="disp-ev-by">by <code>' + escHtml(shortAddr(entry.by)) + '</code></span>' +
          '<span class="disp-ev-time">' + fmtDate(entry.ts) + '</span>' +
          '</div>' +
          (entry.text ? '<div class="disp-ev-text">' + escHtml(entry.text) + '</div>' : '') +
          (entry.link ? '<div class="disp-ev-link"><i class="fas fa-link mr-1"></i><a href="' + escHtml(entry.link) + '" target="_blank" rel="noopener noreferrer">' + escHtml(entry.link) + '</a></div>' : '') +
          (entry.files && entry.files.length ? '<div class="disp-ev-files">' + entry.files.map(function (f) {
            var isImg = f.type && f.type.startsWith('image/');
            return '<div class="disp-ev-file">' +
              '<i class="fas ' + (isImg ? 'fa-image' : 'fa-file') + ' mr-1"></i>' +
              '<span>' + escHtml(f.name) + '</span>' +
              (isImg && f.dataUrl ? '<img src="' + f.dataUrl + '" class="disp-ev-img-thumb">' : '') +
              '</div>';
          }).join('') + '</div>' : '') +
          '</div>'
        );
      }).join('');
    }

    var buyerHtml   = buildEntries(ev.buyer,  'buyer');
    var sellerHtml  = buildEntries(ev.seller, 'seller');

    var submitForm = '';
    if (canSubmit) {
      submitForm = (
        '<div class="disp-ev-form" id="ev-form-' + escHtml(orderId) + '-' + role + '">' +
        '<h4 class="disp-ev-form-title"><i class="fas fa-plus-circle mr-1 text-red-500"></i> Add Evidence</h4>' +
        '<textarea id="ev-text-' + escHtml(orderId) + '-' + role + '" class="disp-ev-textarea" placeholder="Describe your evidence (required)…" maxlength="2000"></textarea>' +
        '<input id="ev-link-' + escHtml(orderId) + '-' + role + '" class="disp-ev-input" type="url" placeholder="Optional link (screenshot URL, tracking, etc.)" />' +
        '<div class="disp-ev-file-row">' +
        '<label class="disp-ev-file-label"><i class="fas fa-paperclip mr-1"></i> Attach files <input type="file" id="ev-file-' + escHtml(orderId) + '-' + role + '" accept="image/*,.pdf" multiple style="display:none" /></label>' +
        '<span id="ev-file-name-' + escHtml(orderId) + '-' + role + '" class="disp-ev-file-name">No file selected</span>' +
        '</div>' +
        '<button class="disp-ev-submit-btn" onclick="submitEvidence(\'' + escHtml(orderId) + '\',\'' + role + '\')">Submit Evidence (Append-Only)</button>' +
        '</div>'
      );
    }

    return (
      '<div class="disp-ev-section">' +
      '<h3 class="disp-section-title"><i class="fas fa-folder-open mr-2 text-red-500"></i>Evidence</h3>' +
      '<div class="disp-ev-columns">' +
      '<div class="disp-ev-col">' +
      '<h4 class="disp-ev-col-title buyer-col"><i class="fas fa-user mr-1"></i>Buyer Evidence (' + (ev.buyer ? ev.buyer.length : 0) + ')</h4>' +
      buyerHtml +
      '</div>' +
      '<div class="disp-ev-col">' +
      '<h4 class="disp-ev-col-title seller-col"><i class="fas fa-store mr-1"></i>Seller Evidence (' + (ev.seller ? ev.seller.length : 0) + ')</h4>' +
      sellerHtml +
      '</div>' +
      '</div>' +
      submitForm +
      '</div>'
    );
  }

  /* Evidence submit handler (exposed globally) */
  window.submitEvidence = function (orderId, role) {
    var wallet = getWallet();
    if (!wallet || !wallet.address) { toast('Connect your wallet first', 'error'); return; }

    var textEl = document.getElementById('ev-text-' + orderId + '-' + role);
    var linkEl = document.getElementById('ev-link-' + orderId + '-' + role);
    var fileEl = document.getElementById('ev-file-' + orderId + '-' + role);

    var text = textEl ? textEl.value.trim() : '';
    if (!text) { toast('Please describe your evidence before submitting.', 'error'); return; }

    var link = linkEl ? linkEl.value.trim() : '';
    var files = fileEl && fileEl.files ? Array.from(fileEl.files) : [];

    var MAX_FILES = 5;
    var ev = getEvidence(orderId);
    if (!ev[role]) ev[role] = [];
    var total = ev[role].reduce(function (sum, e) { return sum + (e.files ? e.files.length : 0); }, 0);
    if (total + files.length > MAX_FILES) {
      toast('Maximum ' + MAX_FILES + ' files total per party.', 'error'); return;
    }

    var btn = document.querySelector('#ev-form-' + orderId + '-' + role + ' .disp-ev-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    function finish(processedFiles) {
      var entry = {
        by: wallet.address.toLowerCase(),
        ts: new Date().toISOString(),
        text: text,
        link: link || null,
        files: processedFiles
      };

      var ev2 = getEvidence(orderId);
      if (!ev2[role]) ev2[role] = [];
      ev2[role].push(entry);
      saveEvidence(orderId, ev2);

      // Update dispute last activity
      var meta = getDisputeMeta();
      if (meta[orderId]) {
        meta[orderId].lastActivity = new Date().toISOString();
        // Advance status
        if (meta[orderId].status === 'awaiting_seller' && role === 'seller') {
          meta[orderId].status = 'awaiting_buyer';
        } else if (meta[orderId].status === 'awaiting_buyer' && role === 'buyer') {
          meta[orderId].status = 'under_review';
        }
        if (ev2.buyer && ev2.buyer.length && ev2.seller && ev2.seller.length) {
          meta[orderId].status = 'ready';
        }
        saveDisputeMeta(meta);
      }

      if (textEl) textEl.value = '';
      if (linkEl) linkEl.value = '';
      if (fileEl) fileEl.value = '';
      var nameSpan = document.getElementById('ev-file-name-' + orderId + '-' + role);
      if (nameSpan) nameSpan.textContent = 'No file selected';

      toast('Evidence submitted successfully (append-only).', 'success');
      renderDetailModal(orderId); // refresh
    }

    if (!files.length) { finish([]); return; }

    var results = [];
    var done = 0;
    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function (e) {
        results.push({ name: file.name, type: file.type, size: file.size, dataUrl: e.target.result });
        done++;
        if (done === files.length) finish(results);
      };
      reader.readAsDataURL(file);
    });
  };

  /* File input change handler */
  document.addEventListener('change', function (e) {
    if (e.target && e.target.type === 'file' && e.target.id && e.target.id.startsWith('ev-file-')) {
      var parts = e.target.id.split('-');
      var role = parts[parts.length - 1];
      var orderId = parts.slice(2, parts.length - 1).join('-');
      var nameSpan = document.getElementById('ev-file-name-' + orderId + '-' + role);
      if (nameSpan) {
        nameSpan.textContent = e.target.files.length > 0
          ? Array.from(e.target.files).map(function (f) { return f.name; }).join(', ')
          : 'No file selected';
      }
    }
  });

  /* ════════════════════════════════════════════════════════════════════════
     DISPUTE CHAT
  ════════════════════════════════════════════════════════════════════════ */
  function renderChat(orderId, myAddr, isBuyer, isSeller) {
    var msgs = getChat(orderId);
    var canChat = isBuyer || isSeller;

    var msgsHtml = msgs.length === 0
      ? '<p class="disp-chat-empty">No messages yet. Start the conversation.</p>'
      : msgs.map(function (msg) {
          var isMine = msg.by && msg.by.toLowerCase() === myAddr;
          var cls = isMine ? 'disp-msg mine' : 'disp-msg theirs';
          return (
            '<div class="' + cls + '">' +
            '<div class="disp-msg-bubble">' +
            '<div class="disp-msg-meta">' +
            '<span class="disp-msg-addr">' + escHtml(shortAddr(msg.by)) + '</span>' +
            '<span class="disp-msg-role">' + escHtml(msg.role || '') + '</span>' +
            '<span class="disp-msg-time">' + timeAgo(msg.ts) + '</span>' +
            '</div>' +
            '<div class="disp-msg-text">' + escHtml(msg.text) + '</div>' +
            (canChat ? '<button class="disp-msg-add-ev" onclick="addChatAsEvidence(\'' + escHtml(orderId) + '\',\'' + escHtml(msg.by) + '\',\'' + escHtml(msg.text.replace(/'/g, '\\\'').slice(0, 200)) + '\',\'' + escHtml(msg.ts) + '\')"><i class="fas fa-plus-circle mr-1"></i>Add as Evidence</button>' : '') +
            '</div>' +
            '</div>'
          );
        }).join('');

    return (
      '<div class="disp-chat-section">' +
      '<h3 class="disp-section-title"><i class="fas fa-comments mr-2 text-red-500"></i>Dispute Chat</h3>' +
      '<div class="disp-chat-messages" id="chat-msgs-' + escHtml(orderId) + '">' + msgsHtml + '</div>' +
      (canChat ?
        '<div class="disp-chat-input-row">' +
        '<input id="chat-input-' + escHtml(orderId) + '" class="disp-chat-input" placeholder="Type a message…" maxlength="500" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendChatMessage(\'' + escHtml(orderId) + '\');}" />' +
        '<button class="disp-chat-send-btn" onclick="sendChatMessage(\'' + escHtml(orderId) + '\')"><i class="fas fa-paper-plane"></i></button>' +
        '</div>'
        : '<p class="disp-chat-readonly">Chat is visible to buyer and seller only.</p>'
      ) +
      '</div>'
    );
  }

  window.sendChatMessage = function (orderId) {
    var wallet = getWallet();
    if (!wallet || !wallet.address) { toast('Connect wallet first', 'error'); return; }
    var orders = getOrders();
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order) { toast('Order not found', 'error'); return; }
    var myAddr = wallet.address.toLowerCase();
    var isBuyer  = order.buyerAddress  && order.buyerAddress.toLowerCase()  === myAddr;
    var isSeller = order.sellerAddress && order.sellerAddress.toLowerCase() === myAddr;
    if (!isBuyer && !isSeller) { toast('Only buyer or seller can chat.', 'error'); return; }

    var input = document.getElementById('chat-input-' + orderId);
    var text = input ? input.value.trim() : '';
    if (!text) return;

    var msgs = getChat(orderId);
    msgs.push({ by: myAddr, role: isBuyer ? 'Buyer' : 'Seller', text: text, ts: new Date().toISOString() });
    saveChat(orderId, msgs);
    if (input) input.value = '';
    renderDetailModal(orderId);
  };

  window.addChatAsEvidence = function (orderId, by, text, ts) {
    var wallet = getWallet();
    if (!wallet || !wallet.address) { toast('Connect wallet first', 'error'); return; }
    var orders = getOrders();
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order) return;
    var myAddr = wallet.address.toLowerCase();
    var isBuyer  = order.buyerAddress  && order.buyerAddress.toLowerCase()  === myAddr;
    var isSeller = order.sellerAddress && order.sellerAddress.toLowerCase() === myAddr;
    var role = isBuyer ? 'buyer' : (isSeller ? 'seller' : null);
    if (!role) { toast('Only buyer or seller can add evidence.', 'error'); return; }

    var ev = getEvidence(orderId);
    if (!ev[role]) ev[role] = [];
    ev[role].push({
      by: myAddr,
      ts: new Date().toISOString(),
      text: '[From chat — ' + fmtDate(ts) + '] ' + text,
      link: null,
      files: []
    });
    saveEvidence(orderId, ev);
    toast('Chat message added as evidence.', 'success');
    renderDetailModal(orderId);
  };

  /* ════════════════════════════════════════════════════════════════════════
     SAFE ACTIONS — Refund / Release with validation & confirmation modal
  ════════════════════════════════════════════════════════════════════════ */
  window.openResolveModal = function (orderId, action) {
    var wallet = getWallet();
    if (!wallet || !wallet.address) { toast('Connect wallet first', 'error'); return; }
    var orders = getOrders();
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order) { toast('Order not found', 'error'); return; }

    var myAddr = wallet.address.toLowerCase();
    var isBuyer  = order.buyerAddress  && order.buyerAddress.toLowerCase()  === myAddr;
    var isSeller = order.sellerAddress && order.sellerAddress.toLowerCase() === myAddr;
    if (!isBuyer && !isSeller) { toast('Unauthorized action', 'error'); return; }

    var label = action === 'refund' ? 'Refund Buyer' : 'Release to Seller';
    var icon  = action === 'refund' ? 'fa-hand-holding-usd' : 'fa-coins';
    var color = action === 'refund' ? '#2563eb' : '#10b981';
    var recipient = action === 'refund'
      ? (order.buyerAddress || '—')
      : (order.sellerAddress || '—');
    var amount = (order.amount || 0) + ' ' + (order.token || 'USDC');

    var modalRoot = document.getElementById('disputes-modal-root');
    if (!modalRoot) return;

    modalRoot.innerHTML =
      '<div id="resolve-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">' +
      '<div style="background:#fff;border-radius:18px;box-shadow:0 25px 60px rgba(0,0,0,.3);width:100%;max-width:480px;padding:28px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">' +
      '<div style="width:44px;height:44px;border-radius:12px;background:' + color + '22;display:flex;align-items:center;justify-content:center;">' +
      '<i class="fas ' + icon + '" style="color:' + color + ';font-size:18px;"></i></div>' +
      '<div><h3 style="margin:0;font-size:17px;font-weight:700;color:#1e293b;">' + escHtml(label) + '</h3>' +
      '<p style="margin:0;font-size:12px;color:#94a3b8;">Dispute resolution action</p></div>' +
      '</div>' +

      '<div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:20px;">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
      '<span style="font-size:12px;color:#64748b;">Order</span>' +
      '<span style="font-size:12px;font-family:monospace;color:#1e293b;">' + escHtml(orderId) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
      '<span style="font-size:12px;color:#64748b;">Amount</span>' +
      '<span style="font-size:13px;font-weight:700;color:' + color + ';">' + escHtml(amount) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;">' +
      '<span style="font-size:12px;color:#64748b;">Recipient</span>' +
      '<span style="font-size:11px;font-family:monospace;color:#1e293b;">' + escHtml(shortAddr(recipient)) + '</span></div>' +
      '</div>' +

      '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:20px;">' +
      '<div style="display:flex;align-items:flex-start;gap:8px;">' +
      '<i class="fas fa-exclamation-triangle" style="color:#f59e0b;margin-top:2px;flex-shrink:0;"></i>' +
      '<p style="font-size:12px;color:#92400e;margin:0;">This action is <strong>irreversible</strong>. Escrow funds will be released from the smart contract. Make sure you\'ve reviewed all evidence before proceeding.</p>' +
      '</div></div>' +

      '<div style="display:flex;gap:10px;">' +
      '<button id="resolve-confirm-btn" style="flex:1;padding:11px;background:' + color + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;" onclick="confirmResolve(\'' + escHtml(orderId) + '\',\'' + action + '\')">' +
      '<i class="fas ' + icon + ' mr-2"></i>' + escHtml(label) + '</button>' +
      '<button style="flex:1;padding:11px;background:#f1f5f9;color:#475569;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;" onclick="document.getElementById(\'disputes-modal-root\').innerHTML=\'\'">' +
      'Cancel</button>' +
      '</div>' +
      '</div></div>';
  };

  window.confirmResolve = function (orderId, action) {
    var btn = document.getElementById('resolve-confirm-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing…'; }

    setTimeout(function () {
      var orders = getOrders();
      var idx = orders.findIndex(function (o) { return o.id === orderId; });
      if (idx < 0) { toast('Order not found', 'error'); return; }

      orders[idx].status = 'completed';
      orders[idx].disputeResolution = action;
      orders[idx].resolvedAt = new Date().toISOString();
      orders[idx].disputeLockedFunds = false;
      saveOrders(orders);

      var meta = getDisputeMeta();
      if (meta[orderId]) {
        meta[orderId].status = 'resolved';
        meta[orderId].resolution = action;
        meta[orderId].resolvedAt = new Date().toISOString();
        saveDisputeMeta(meta);
      }

      var modalRoot = document.getElementById('disputes-modal-root');
      if (modalRoot) modalRoot.innerHTML = '';

      var msg = action === 'refund'
        ? 'Buyer refunded. Escrow released back to buyer.'
        : 'Funds released to seller. Dispute resolved.';
      toast(msg, 'success');

      setTimeout(function () { renderDisputes(); }, 500);
    }, 1200);
  };

  /* ════════════════════════════════════════════════════════════════════════
     DETAIL MODAL — full dispute view
  ════════════════════════════════════════════════════════════════════════ */
  function renderDetailModal(orderId) {
    var orders  = getOrders();
    var order   = orders.find(function (o) { return o.id === orderId; });
    if (!order) { toast('Order not found', 'error'); return; }

    var dispute = ensureDisputeMeta(order);
    var wallet  = getWallet();
    var myAddr  = wallet && wallet.address ? wallet.address.toLowerCase() : '';
    var isBuyer  = order.buyerAddress  && order.buyerAddress.toLowerCase()  === myAddr;
    var isSeller = order.sellerAddress && order.sellerAddress.toLowerCase() === myAddr;

    // Run auto-resolution check
    var autoResult = handleAutoResolution(dispute, order);

    var statusInfo = getDisputeStatusLabel(dispute);
    var explorer   = getArcExplorer();
    var txUrl      = order.explorerUrl || (explorer + '/tx/' + (order.txHash || ''));

    var autoHtml = '';
    if (autoResult && !dispute.resolution) {
      autoHtml =
        '<div class="disp-auto-banner">' +
        '<i class="fas fa-robot mr-2"></i>' +
        '<div><strong>Auto-Resolution Available:</strong> ' + escHtml(autoResult.reason) + '<br>' +
        '<button class="disp-auto-btn" onclick="confirmResolve(\'' + escHtml(orderId) + '\',\'' + autoResult.action + '\')">' +
        '<i class="fas fa-bolt mr-1"></i>Apply Auto-Resolution</button></div>' +
        '</div>';
    }

    var resolvedHtml = '';
    if (dispute.resolution) {
      var resolvedAction = dispute.resolution === 'refund' ? 'Refunded to Buyer' : 'Released to Seller';
      resolvedHtml =
        '<div class="disp-resolved-banner">' +
        '<i class="fas fa-check-circle mr-2"></i>' +
        '<div><strong>Resolved: ' + escHtml(resolvedAction) + '</strong><br>' +
        '<span style="font-size:12px;opacity:.85;">Resolved at ' + fmtDate(dispute.resolvedAt) + '</span></div>' +
        '</div>';
    }

    var actionsHtml = '';
    if (!dispute.resolution) {
      actionsHtml =
        '<div class="disp-actions-row">' +
        '<button class="disp-action-refund" onclick="openResolveModal(\'' + escHtml(orderId) + '\',\'refund\')">' +
        '<i class="fas fa-hand-holding-usd mr-2"></i>Refund Buyer</button>' +
        '<button class="disp-action-release" onclick="openResolveModal(\'' + escHtml(orderId) + '\',\'release\')">' +
        '<i class="fas fa-coins mr-2"></i>Release to Seller</button>' +
        '<a href="/orders/' + escHtml(orderId) + '" class="disp-action-order">' +
        '<i class="fas fa-receipt mr-2"></i>View Order</a>' +
        '</div>';
    }

    var modalRoot = document.getElementById('disputes-modal-root');
    if (!modalRoot) return;

    var html =
      '<div id="detail-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:flex-start;justify-content:center;z-index:9998;padding:16px;overflow-y:auto;">' +
      '<div class="disp-detail-modal">' +

      // Header
      '<div class="disp-modal-header">' +
      '<div class="disp-modal-title-row">' +
      '<div class="disp-modal-icon"><i class="fas fa-gavel"></i></div>' +
      '<div>' +
      '<h2 class="disp-modal-title">Dispute Details</h2>' +
      '<p class="disp-modal-sub">Order <code>' + escHtml(orderId) + '</code></p>' +
      '</div>' +
      '</div>' +
      '<button class="disp-modal-close" onclick="document.getElementById(\'disputes-modal-root\').innerHTML=\'\'">&times;</button>' +
      '</div>' +

      // Escrow highlight
      '<div class="disp-escrow-highlight">' +
      '<i class="fas fa-lock mr-2"></i>' +
      '<span><strong>' + escHtml(String(order.amount || 0)) + ' ' + escHtml(order.token || 'USDC') + ' locked in escrow</strong> — funds are safe on Arc Network</span>' +
      '<span class="disp-status-pill" style="background:' + statusInfo.bg + ';color:' + statusInfo.color + ';">' +
      '<i class="fas ' + statusInfo.icon + ' mr-1"></i>' + escHtml(statusInfo.label) + '</span>' +
      '</div>' +

      autoHtml +
      resolvedHtml +

      // Timeline
      '<div class="disp-section">' +
      '<h3 class="disp-section-title"><i class="fas fa-list-ol mr-2 text-red-500"></i>Timeline</h3>' +
      renderTimeline(order, dispute) +
      '</div>' +

      // Countdown
      (dispute.status !== 'resolved' ? '<div class="disp-section">' +
      '<h3 class="disp-section-title"><i class="fas fa-hourglass-half mr-2 text-red-500"></i>Response Windows</h3>' +
      renderCountdown(dispute) +
      '</div>' : '') +

      // Parties
      '<div class="disp-section">' +
      '<h3 class="disp-section-title"><i class="fas fa-users mr-2 text-red-500"></i>Parties</h3>' +
      '<div class="disp-parties-grid">' +
      '<div class="disp-party-card buyer-party">' +
      '<p class="disp-party-role"><i class="fas fa-user mr-1"></i>Buyer' + (isBuyer ? ' <span class="disp-you-badge">You</span>' : '') + '</p>' +
      '<p class="disp-party-addr">' + escHtml(shortAddr(order.buyerAddress)) + '</p>' +
      '</div>' +
      '<div class="disp-party-card seller-party">' +
      '<p class="disp-party-role"><i class="fas fa-store mr-1"></i>Seller' + (isSeller ? ' <span class="disp-you-badge">You</span>' : '') + '</p>' +
      '<p class="disp-party-addr">' + escHtml(shortAddr(order.sellerAddress)) + '</p>' +
      '</div>' +
      '<div class="disp-party-card tx-card">' +
      '<p class="disp-party-role"><i class="fas fa-link mr-1"></i>Transaction</p>' +
      '<a href="' + txUrl + '" target="_blank" class="disp-party-tx">' + escHtml(shortHash(order.txHash)) + '</a>' +
      '</div>' +
      '</div>' +
      '</div>' +

      // Evidence
      renderEvidenceSection(orderId, isBuyer ? 'buyer' : 'seller', myAddr, isBuyer, isSeller) +

      // Chat
      renderChat(orderId, myAddr, isBuyer, isSeller) +

      // Actions
      actionsHtml +

      '</div></div>';

    modalRoot.innerHTML = html;

    // Close on backdrop click
    var overlay = document.getElementById('detail-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) modalRoot.innerHTML = '';
      });
    }

    // Scroll to bottom of chat
    var chatMsgs = document.getElementById('chat-msgs-' + orderId);
    if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;

    // Start countdown tickers
    startCountdownTickers(dispute);
  }

  /* ════════════════════════════════════════════════════════════════════════
     COUNTDOWN LIVE TICKERS
  ════════════════════════════════════════════════════════════════════════ */
  var _tickerInterval = null;

  function startCountdownTickers(dispute) {
    if (_tickerInterval) clearInterval(_tickerInterval);
    _tickerInterval = setInterval(function () {
      var now = Date.now();
      document.querySelectorAll('.seller-cd').forEach(function (el) {
        var dl = el.dataset.deadline;
        if (dl) el.textContent = msToHMS(Math.max(0, new Date(dl).getTime() - now));
      });
      document.querySelectorAll('.buyer-cd').forEach(function (el) {
        var dl = el.dataset.deadline;
        if (dl) el.textContent = msToHMS(Math.max(0, new Date(dl).getTime() - now));
      });
    }, 1000);
  }

  /* ════════════════════════════════════════════════════════════════════════
     DISPUTES LIST RENDERER
  ════════════════════════════════════════════════════════════════════════ */
  function renderDisputes() {
    var container = document.getElementById('disputes-container');
    if (!container) return;

    var wallet = getWallet();
    if (!wallet || !wallet.address) {
      container.innerHTML =
        '<div class="card p-12 text-center">' +
        '<div class="empty-state">' +
        '<i class="fas fa-gavel"></i>' +
        '<h3 class="font-bold text-slate-600 mb-2 mt-3">Connect Wallet</h3>' +
        '<p class="text-sm text-slate-400 mb-4">Connect your wallet to see your disputes.</p>' +
        '<a href="/wallet" class="btn-primary mx-auto">Connect Wallet</a>' +
        '</div></div>';
      return;
    }

    var myAddr  = wallet.address.toLowerCase();
    var orders  = getOrders();

    var disputes = orders.filter(function (o) {
      return o.status === 'dispute' &&
        ((o.buyerAddress  && o.buyerAddress.toLowerCase()  === myAddr) ||
         (o.sellerAddress && o.sellerAddress.toLowerCase() === myAddr));
    });

    var resolvedOrders = orders.filter(function (o) {
      return o.disputeResolution &&
        ((o.buyerAddress  && o.buyerAddress.toLowerCase()  === myAddr) ||
         (o.sellerAddress && o.sellerAddress.toLowerCase() === myAddr));
    });

    if (!disputes.length && !resolvedOrders.length) {
      container.innerHTML =
        '<div class="card p-12 text-center">' +
        '<div class="empty-state">' +
        '<i class="fas fa-handshake"></i>' +
        '<h3 class="font-bold text-slate-600 mb-2 mt-3">No Active Disputes</h3>' +
        '<p class="text-sm text-slate-400">Open a dispute from any order with delivery issues.</p>' +
        '</div></div>';
      return;
    }

    function buildCard(d) {
      var dispute    = ensureDisputeMeta(d);
      var isBuyer    = d.buyerAddress  && d.buyerAddress.toLowerCase()  === myAddr;
      var isSeller   = d.sellerAddress && d.sellerAddress.toLowerCase() === myAddr;
      var statusInfo = getDisputeStatusLabel(dispute);
      var ev         = getEvidence(d.id);
      var buyerEvCnt = ev.buyer ? ev.buyer.length : 0;
      var sellerEvCnt = ev.seller ? ev.seller.length : 0;
      var msgs       = getChat(d.id);
      var autoResult = handleAutoResolution(dispute, d);
      var isResolved = !!dispute.resolution;

      return (
        '<div class="disp-card ' + (isResolved ? 'resolved-card' : '') + '">' +
        '<div class="disp-card-left">' +
        (isBuyer  ? '<span class="role-badge buyer-badge"><i class="fas fa-user mr-1"></i>Buyer</span>' : '') +
        (isSeller ? '<span class="role-badge seller-badge"><i class="fas fa-store mr-1"></i>Seller</span>' : '') +
        '</div>' +
        '<div class="disp-card-body">' +
        '<div class="disp-card-top">' +
        '<div>' +
        '<p class="disp-card-id">' + escHtml(d.id) + '</p>' +
        '<p class="disp-card-date">Opened ' + timeAgo(d.disputedAt || d.createdAt) + '</p>' +
        '</div>' +
        '<span class="disp-status-pill" style="background:' + statusInfo.bg + ';color:' + statusInfo.color + ';">' +
        '<i class="fas ' + statusInfo.icon + ' mr-1"></i>' + escHtml(statusInfo.label) + '</span>' +
        '</div>' +

        '<div class="disp-card-escrow">' +
        '<i class="fas fa-lock mr-1"></i>' +
        '<strong>' + escHtml(String(d.amount || 0)) + ' ' + escHtml(d.token || 'USDC') + ' locked in escrow</strong>' +
        '</div>' +

        '<div class="disp-card-stats">' +
        '<span><i class="fas fa-user mr-1 text-blue-500"></i>' + buyerEvCnt + ' buyer evidence</span>' +
        '<span><i class="fas fa-store mr-1 text-green-500"></i>' + sellerEvCnt + ' seller evidence</span>' +
        '<span><i class="fas fa-comments mr-1 text-purple-500"></i>' + msgs.length + ' messages</span>' +
        '</div>' +

        (autoResult && !isResolved ? '<div class="disp-card-auto"><i class="fas fa-robot mr-1"></i>' + escHtml(autoResult.reason) + '</div>' : '') +
        (isResolved ? '<div class="disp-card-resolved"><i class="fas fa-check-circle mr-1"></i>Resolved: ' + escHtml(dispute.resolution === 'refund' ? 'Refunded to Buyer' : 'Released to Seller') + '</div>' : '') +

        '<div class="disp-card-actions">' +
        '<button class="btn-primary text-xs py-1.5 px-3 open-detail-btn" data-oid="' + escHtml(d.id) + '">' +
        '<i class="fas fa-gavel mr-1"></i>Open Dispute Panel</button>' +
        '<a href="/orders/' + escHtml(d.id) + '" class="btn-secondary text-xs py-1.5 px-3">View Order</a>' +
        '</div>' +
        '</div></div>'
      );
    }

    var html = '';
    if (disputes.length) {
      html += '<h2 class="text-lg font-bold text-slate-700 mb-3"><i class="fas fa-exclamation-circle text-red-500 mr-2"></i>Active Disputes (' + disputes.length + ')</h2>';
      html += disputes.map(buildCard).join('');
    }
    if (resolvedOrders.length) {
      html += '<h2 class="text-lg font-bold text-slate-500 mt-6 mb-3"><i class="fas fa-check-circle text-green-500 mr-2"></i>Resolved Disputes (' + resolvedOrders.length + ')</h2>';
      html += resolvedOrders.map(buildCard).join('');
    }

    container.innerHTML = html;

    container.querySelectorAll('.open-detail-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        renderDetailModal(this.dataset.oid);
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     CSS INJECTION
  ════════════════════════════════════════════════════════════════════════ */
  var style = document.createElement('style');
  style.textContent = `
  /* ── Cards ── */
  .disp-card{display:flex;gap:0;background:#fff;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05);transition:box-shadow .2s}
  .disp-card:hover{box-shadow:0 4px 18px rgba(0,0,0,.1)}
  .disp-card.resolved-card{opacity:.8;border-color:#e2e8f0}
  .disp-card-left{width:6px;background:linear-gradient(180deg,#ef4444,#dc2626);flex-shrink:0;border-radius:16px 0 0 16px}
  .disp-card.resolved-card .disp-card-left{background:linear-gradient(180deg,#10b981,#059669)}
  .disp-card-body{flex:1;padding:16px 18px}
  .disp-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px}
  .disp-card-id{font-weight:700;color:#1e293b;font-size:14px;font-family:monospace;margin:0}
  .disp-card-date{font-size:11px;color:#94a3b8;margin:2px 0 0}
  .disp-card-escrow{display:flex;align-items:center;gap:6px;padding:7px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:10px;font-size:12px;color:#7f1d1d}
  .disp-card-stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}
  .disp-card-stats span{font-size:11px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:3px 8px}
  .disp-card-auto{font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:7px 10px;margin-bottom:10px}
  .disp-card-resolved{font-size:11px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:7px;padding:7px 10px;margin-bottom:10px}
  .disp-card-actions{display:flex;gap:8px;flex-wrap:wrap}
  .role-badge{font-size:10px;padding:2px 8px;border-radius:99px;font-weight:700;display:inline-block;margin-bottom:4px}
  .buyer-badge{background:#dbeafe;color:#1d4ed8}
  .seller-badge{background:#fef3c7;color:#92400e}
  .disp-status-pill{font-size:11px;padding:4px 10px;border-radius:99px;font-weight:600;white-space:nowrap}

  /* ── Timeline ── */
  .disp-timeline{display:flex;flex-direction:column;gap:0;position:relative}
  .disp-tl-step{display:flex;align-items:flex-start;gap:12px;position:relative}
  .disp-tl-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;position:relative;z-index:1}
  .disp-tl-step.done .disp-tl-icon{background:#dcfce7;color:#16a34a;border:2px solid #16a34a}
  .disp-tl-step.current .disp-tl-icon{background:#fee2e2;color:#dc2626;border:2px solid #dc2626;box-shadow:0 0 0 4px rgba(220,38,38,.15)}
  .disp-tl-step.pending .disp-tl-icon{background:#f1f5f9;color:#94a3b8;border:2px solid #e2e8f0}
  .disp-tl-body{padding-bottom:20px}
  .disp-tl-label{font-size:13px;font-weight:600;color:#334155;margin:6px 0 2px}
  .disp-tl-step.pending .disp-tl-label{color:#94a3b8}
  .disp-tl-ts{font-size:11px;color:#94a3b8}
  .disp-tl-line{position:absolute;left:15px;top:32px;bottom:0;width:2px;background:#e2e8f0;z-index:0}
  .disp-tl-step.done .disp-tl-line{background:#16a34a}

  /* ── Countdown ── */
  .disp-countdown-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:520px){.disp-countdown-grid{grid-template-columns:1fr}}
  .disp-countdown-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px}
  .disp-cd-header{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px}
  .disp-cd-timer{font-size:24px;font-weight:900;color:#1e293b;font-family:monospace;margin-bottom:6px}
  .disp-cd-bar{height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-bottom:6px}
  .disp-cd-fill{height:100%;border-radius:99px;transition:width .5s}
  .seller-fill{background:linear-gradient(90deg,#f59e0b,#d97706)}
  .buyer-fill{background:linear-gradient(90deg,#3b82f6,#1d4ed8)}
  .disp-cd-sub{font-size:10px;color:#94a3b8}
  .disp-cd-expired{font-size:11px;color:#dc2626;background:#fef2f2;border-radius:6px;padding:4px 8px;margin-top:6px;font-weight:600}

  /* ── Evidence ── */
  .disp-ev-section{margin-bottom:20px}
  .disp-ev-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
  @media(max-width:580px){.disp-ev-columns{grid-template-columns:1fr}}
  .disp-ev-col{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
  .disp-ev-col-title{font-size:12px;font-weight:700;margin:0 0 8px;padding:5px 10px;border-radius:7px;text-transform:uppercase;letter-spacing:.03em}
  .buyer-col{background:#eff6ff;color:#1d4ed8}
  .seller-col{background:#f0fdf4;color:#16a34a}
  .disp-ev-empty{font-size:12px;color:#94a3b8;padding:8px 0}
  .disp-ev-entry{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px}
  .disp-ev-entry-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
  .disp-ev-idx{font-size:10px;font-weight:700;background:#f1f5f9;color:#64748b;padding:2px 6px;border-radius:4px}
  .disp-ev-by{font-size:10px;color:#94a3b8}
  .disp-ev-time{font-size:10px;color:#94a3b8;margin-left:auto}
  .disp-ev-text{font-size:12px;color:#334155;white-space:pre-wrap;margin-bottom:4px}
  .disp-ev-link{font-size:11px;margin-bottom:4px}
  .disp-ev-link a{color:#3b82f6;word-break:break-all}
  .disp-ev-files{display:flex;flex-direction:column;gap:4px;margin-top:6px}
  .disp-ev-file{font-size:11px;color:#64748b;display:flex;align-items:center;gap:5px}
  .disp-ev-img-thumb{max-width:100%;max-height:120px;border-radius:6px;margin-top:4px;border:1px solid #e2e8f0}
  .disp-ev-form{background:#fff;border:1.5px dashed #e2e8f0;border-radius:12px;padding:14px;margin-top:10px}
  .disp-ev-form-title{font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px}
  .disp-ev-textarea{width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;resize:vertical;min-height:70px;margin-bottom:8px;box-sizing:border-box;font-family:inherit}
  .disp-ev-input{width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;font-size:12px;margin-bottom:8px;box-sizing:border-box}
  .disp-ev-file-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .disp-ev-file-label{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;padding:5px 12px;font-size:12px;cursor:pointer;color:#475569;font-weight:600}
  .disp-ev-file-name{font-size:11px;color:#94a3b8}
  .disp-ev-submit-btn{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:12px;font-weight:700;cursor:pointer;width:100%}
  .disp-ev-submit-btn:disabled{opacity:.6;cursor:not-allowed}

  /* ── Chat ── */
  .disp-chat-section{margin-bottom:20px}
  .disp-chat-messages{max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:10px}
  .disp-chat-empty{font-size:12px;color:#94a3b8;text-align:center;padding:12px 0}
  .disp-msg{display:flex}
  .disp-msg.mine{justify-content:flex-end}
  .disp-msg.theirs{justify-content:flex-start}
  .disp-msg-bubble{max-width:78%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 12px}
  .disp-msg.mine .disp-msg-bubble{background:#fee2e2;border-color:#fecaca}
  .disp-msg-meta{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
  .disp-msg-addr{font-size:10px;font-family:monospace;color:#64748b;font-weight:700}
  .disp-msg-role{font-size:9px;background:#f1f5f9;color:#475569;padding:1px 5px;border-radius:4px}
  .disp-msg-time{font-size:10px;color:#94a3b8;margin-left:auto}
  .disp-msg-text{font-size:12px;color:#334155;word-break:break-word}
  .disp-msg-add-ev{background:none;border:1px solid #e2e8f0;border-radius:5px;font-size:10px;color:#64748b;cursor:pointer;padding:2px 6px;margin-top:5px}
  .disp-msg-add-ev:hover{background:#f1f5f9}
  .disp-chat-input-row{display:flex;gap:8px}
  .disp-chat-input{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:13px;outline:none}
  .disp-chat-send-btn{background:#dc2626;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:14px}
  .disp-chat-readonly{font-size:11px;color:#94a3b8;text-align:center;padding:6px 0}

  /* ── Detail modal ── */
  .disp-detail-modal{background:#fff;border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.35);width:100%;max-width:760px;margin:20px auto;overflow:hidden}
  .disp-modal-header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid #f1f5f9}
  .disp-modal-title-row{display:flex;align-items:center;gap:12px}
  .disp-modal-icon{width:40px;height:40px;background:#fee2e2;border-radius:11px;display:flex;align-items:center;justify-content:center;color:#dc2626;font-size:16px}
  .disp-modal-title{margin:0;font-size:18px;font-weight:800;color:#1e293b}
  .disp-modal-sub{margin:2px 0 0;font-size:12px;color:#94a3b8}
  .disp-modal-close{width:34px;height:34px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:20px;color:#64748b;line-height:1}
  .disp-escrow-highlight{display:flex;align-items:center;gap:10px;padding:12px 24px;background:linear-gradient(90deg,#fef2f2,#fff5f5);border-bottom:1px solid #fecaca;font-size:13px;font-weight:600;color:#7f1d1d;flex-wrap:wrap}
  .disp-auto-banner{display:flex;align-items:flex-start;gap:10px;padding:12px 24px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:13px;color:#92400e}
  .disp-auto-btn{background:#f59e0b;color:#fff;border:none;border-radius:7px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;margin-top:6px}
  .disp-resolved-banner{display:flex;align-items:flex-start;gap:10px;padding:12px 24px;background:#ecfdf5;border-bottom:1px solid #a7f3d0;font-size:13px;color:#065f46;font-weight:600}
  .disp-section{padding:18px 24px;border-bottom:1px solid #f1f5f9}
  .disp-section-title{font-size:14px;font-weight:700;color:#1e293b;margin:0 0 12px;display:flex;align-items:center}
  .disp-parties-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
  .disp-party-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
  .buyer-party{border-left:3px solid #3b82f6}
  .seller-party{border-left:3px solid #10b981}
  .tx-card{border-left:3px solid #8b5cf6}
  .disp-party-role{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin:0 0 4px;display:flex;align-items:center}
  .disp-party-addr{font-size:11px;font-family:monospace;color:#1e293b;margin:0;word-break:break-all}
  .disp-party-tx{font-size:11px;font-family:monospace;color:#3b82f6;text-decoration:none;word-break:break-all}
  .disp-you-badge{font-size:9px;background:#fee2e2;color:#dc2626;padding:1px 5px;border-radius:4px;margin-left:4px;font-weight:700}
  .disp-actions-row{display:flex;flex-wrap:wrap;gap:10px;padding:18px 24px}
  .disp-action-refund{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center}
  .disp-action-release{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center}
  .disp-action-order{background:#f1f5f9;color:#475569;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;text-decoration:none;display:flex;align-items:center}
  `;
  document.head.appendChild(style);

  /* ════════════════════════════════════════════════════════════════════════
     BOOTSTRAP
  ════════════════════════════════════════════════════════════════════════ */
  function init() {
    if (!document.getElementById('disputes-container')) return;
    renderDisputes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
