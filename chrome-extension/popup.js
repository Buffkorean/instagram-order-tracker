'use strict';

let orders = [];
let incomplete = [];
let paymentLink = '';
let currentItem = { name: '', price: '' };

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['orders', 'paymentLink', 'currentItem']);
  paymentLink = stored.paymentLink || '';
  document.getElementById('paymentLink').value = paymentLink;

  if (stored.currentItem) {
    currentItem = stored.currentItem;
    document.getElementById('nsItem').value = currentItem.name || '';
    document.getElementById('nsPrice').value = currentItem.price || '';
  }
  updateNsDisplay();
  renderAll(stored.orders || []);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.orders) renderAll(changes.orders.newValue || []);
    if (changes.currentItem) {
      currentItem = changes.currentItem.newValue || { name: '', price: '' };
      updateNsDisplay();
    }
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  document.getElementById('downloadBtn').addEventListener('click', download);
  document.getElementById('clearBtn').addEventListener('click', clearSession);
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('popoutBtn').addEventListener('click', popOut);
  document.getElementById('nsSet').addEventListener('click', setCurrentItem);
});

// ── Now Selling ────────────────────────────────────────────────────────────
async function setCurrentItem() {
  const name  = document.getElementById('nsItem').value.trim();
  const price = document.getElementById('nsPrice').value.trim();
  currentItem = { name, price };
  await chrome.storage.local.set({ currentItem });
  updateNsDisplay();
  const btn = document.getElementById('nsSet');
  btn.textContent = '✓ Set!';
  btn.classList.add('ns-set-btn--done');
  setTimeout(() => {
    btn.textContent = 'Set';
    btn.classList.remove('ns-set-btn--done');
  }, 1500);
}

function updateNsDisplay() {
  const el = document.getElementById('nsDisplay');
  if (currentItem.name && currentItem.price) {
    el.textContent = `${currentItem.name} — $${parseFloat(currentItem.price).toFixed(2)}`;
    el.classList.add('ns-display--set');
  } else if (currentItem.name) {
    el.textContent = currentItem.name;
    el.classList.add('ns-display--set');
  } else {
    el.textContent = 'Not set';
    el.classList.remove('ns-display--set');
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderAll(allOrders) {
  orders = allOrders.filter(o => o.status === 'order');
  incomplete = allOrders.filter(o => o.status === 'incomplete');

  document.getElementById('orderCount').textContent = orders.length;
  document.getElementById('incompleteCount').textContent = incomplete.length;

  const badge = document.getElementById('statusBadge');
  if (orders.length + incomplete.length > 0) {
    badge.textContent = `● ${orders.length + incomplete.length} captured`;
    badge.className = 'badge badge-live';
  } else {
    badge.textContent = 'Waiting...';
    badge.className = 'badge badge-waiting';
  }

  renderList('ordersList', orders, 'order');
  renderList('incompleteList', incomplete, 'incomplete');
}

function renderList(containerId, items, type) {
  const el = document.getElementById(containerId);
  if (!items.length) {
    el.innerHTML = '<div class="empty">None yet.</div>';
    return;
  }

  el.innerHTML = items.map((o, i) => {
    const total = (o.price && o.qty)
      ? `$${(parseFloat(o.price) * o.qty).toFixed(2)}`
      : null;
    return `
    <div class="order-card ${type}">
      <div class="order-top">
        <span class="username">@${o.username}</span>
        <span class="timestamp">${o.timestamp}</span>
      </div>
      <div class="order-details">
        ${o.item  ? `<span class="tag tag-item">📦 ${o.item}</span>` : ''}
        ${o.size  ? `<span class="tag">Size: ${o.size}</span>` : '<span class="tag missing">Size: ?</span>'}
        ${o.color ? `<span class="tag">Color: ${o.color}</span>` : ''}
        <span class="tag">Qty: ${o.qty}</span>
        ${total   ? `<span class="tag tag-total">${total}</span>` : ''}
      </div>
      <div class="comment-raw">"${o.rawText}"</div>
      <button class="btn-copy" data-i="${i}" data-type="${type}">Copy DM</button>
    </div>
  `}).join('');

  el.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = parseInt(e.target.dataset.i);
      const list = e.target.dataset.type === 'order' ? orders : incomplete;
      copyDM(list[i], e.target);
    });
  });
}

// ── DM Template ───────────────────────────────────────────────────────────
function buildDM(order) {
  const link  = paymentLink || '[payment link]';
  const total = (order.price && order.qty)
    ? `$${(parseFloat(order.price) * order.qty).toFixed(2)}`
    : '$___';
  return `Hi @${order.username}! Thank you for your order 감사합니다! 🙏

Here are your order details:
Item: ${order.item || '___'}
Size: ${order.size || '___'}
Color: ${order.color || ''}
Qty: ${order.qty || 1}
Unit Price: ${order.price ? '$' + parseFloat(order.price).toFixed(2) : '$___'}
Total: ${total}
Payment: ${link}

Please complete payment within 24 hours!
문의사항 있으시면 편하게 DM 주세요 💜`;
}

function copyDM(order, btn) {
  navigator.clipboard.writeText(buildDM(order)).then(() => {
    const original = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 2000);
  });
}

// ── Download CSV (opens in Excel) ─────────────────────────────────────────
function download() {
  const all = [...orders, ...incomplete];
  if (!all.length) {
    alert('No orders to download yet!');
    return;
  }

  const date = new Date().toLocaleDateString('en-US').replace(/\//g, '-');

  const headers = ['#', 'Time', 'Username', 'Item', 'Size', 'Color', 'Qty', 'Unit Price ($)', 'Total ($)', 'Status', 'Comment', 'DM Message'];

  const rows = all.map((o, i) => {
    const unitPrice = o.price ? parseFloat(o.price).toFixed(2) : '';
    const total     = (o.price && o.qty) ? (parseFloat(o.price) * o.qty).toFixed(2) : '';
    return [
      i + 1,
      o.timestamp,
      '@' + o.username,
      csvCell(o.item || ''),
      o.size  || '',
      o.color || '',
      o.qty   || 1,
      unitPrice,
      total,
      o.status === 'order' ? 'Order' : 'Needs Info',
      csvCell(o.rawText),
      csvCell(buildDM(o))
    ];
  });

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  // BOM so Excel reads Korean characters correctly
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `LiveOrders_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(text) {
  return '"' + String(text).replace(/"/g, '""') + '"';
}

// ── Clear session ─────────────────────────────────────────────────────────
async function clearSession() {
  const ok = confirm('Start a new session?\n\nMake sure you have already downloaded the Excel file for this live!');
  if (!ok) return;
  await chrome.storage.local.set({ clearSignal: true });
  await chrome.storage.local.remove(['orders']);
  renderAll([]);
}

// ── Settings ──────────────────────────────────────────────────────────────
async function saveSettings() {
  paymentLink = document.getElementById('paymentLink').value.trim();
  await chrome.storage.local.set({ paymentLink });
  const btn = document.getElementById('saveBtn');
  btn.textContent = '✓ Saved!';
  setTimeout(() => (btn.textContent = 'Save'), 2000);
}

// ── Pop out ───────────────────────────────────────────────────────────────
function popOut() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 440,
    height: 660
  });
  window.close();
}

// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`${name}-panel`).classList.remove('hidden');
}
