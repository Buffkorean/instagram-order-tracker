(function () {
  'use strict';

  // ── Order intent keywords ──────────────────────────────────────────────────
  const INTENT_EN = [
    'sold', "i'll take", "i'll get", "ill take", "ill get",
    'can i get', 'i want', 'i need', "i'd like", 'id like', 'i order', 'ordering'
  ];
  const INTENT_KR = [
    '주세요', '살게요', '살게', '주문', '원해요', '살래요',
    '주문할게요', '주문해요', '사고싶어요', '사겠습니다',
    '주문합니다', '구매할게요', '사려고요', '살려고요'
  ];
  // These show interest but lack detail → flagged as Incomplete
  const INCOMPLETE_SIGNALS = [
    '저요', '저도요', '저도', 'me!', 'me please', 'i want one', '하나요', '있나요'
  ];

  // ── Size ──────────────────────────────────────────────────────────────────
  // Korean numeric sizes: 55 66 77 88 95 100
  const SIZE_RE = /\b(XXS|XXL|2XL|3XL|XS|XL|S|M|L|Small|Medium|Large|55|66|77|88|95|100)\b/i;

  // ── Quantity ──────────────────────────────────────────────────────────────
  const QTY_RE = /\b([1-9]|1[0-9]|20)\s*(개|pcs|pieces|ea|sets?)?\b/i;
  const QTY_KR = {
    '하나': 1, '한개': 1, '둘': 2, '두개': 2,
    '셋': 3, '세개': 3, '넷': 4, '네개': 4, '다섯': 5, '다섯개': 5
  };

  // ── Color ─────────────────────────────────────────────────────────────────
  const COLORS_EN = [
    'black', 'white', 'blue', 'navy', 'red', 'green', 'pink',
    'purple', 'yellow', 'orange', 'gray', 'grey', 'beige', 'brown',
    'cream', 'ivory', 'mint', 'lavender', 'khaki', 'camel'
  ];
  const COLORS_KR = [
    '블랙', '화이트', '블루', '네이비', '레드', '그린', '핑크',
    '퍼플', '옐로우', '오렌지', '그레이', '베이지', '브라운',
    '크림', '아이보리', '민트', '라벤더', '카키', '카멜',
    '검정', '검은색', '흰색', '파랑', '파란색', '빨강', '빨간색',
    '초록', '초록색', '분홍', '분홍색', '보라', '노랑', '회색', '갈색'
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  let captured = [];
  let seenIds = new Set();
  let sessionStart = new Date().toISOString();
  let currentItem = { name: '', price: '' };

  chrome.storage.local.get(['currentItem'], r => {
    if (r.currentItem) currentItem = r.currentItem;
  });

  // ── Parser ────────────────────────────────────────────────────────────────
  function parseComment(username, text) {
    const lower = text.toLowerCase();

    const hasENIntent = INTENT_EN.some(k => lower.includes(k));
    const hasKRIntent = INTENT_KR.some(k => text.includes(k));
    const hasIncomplete = INCOMPLETE_SIGNALS.some(k => lower.includes(k) || text.includes(k));

    const sizeMatch = text.match(SIZE_RE);
    const size = sizeMatch ? sizeMatch[0].toUpperCase() : null;

    let qty = null;
    const qtyMatch = text.match(QTY_RE);
    if (qtyMatch) {
      qty = parseInt(qtyMatch[1]);
    } else {
      for (const [word, num] of Object.entries(QTY_KR)) {
        if (text.includes(word)) { qty = num; break; }
      }
    }
    if (!qty) qty = 1;

    let color = null;
    for (const c of COLORS_EN) {
      if (lower.includes(c)) { color = c[0].toUpperCase() + c.slice(1); break; }
    }
    if (!color) {
      for (const c of COLORS_KR) {
        if (text.includes(c)) { color = c; break; }
      }
    }

    let status;
    if ((hasENIntent || hasKRIntent) && size) {
      status = 'order';
    } else if (hasENIntent || hasKRIntent || hasIncomplete) {
      status = 'incomplete';
    } else {
      status = 'filtered';
    }

    return {
      username,
      rawText: text,
      size,
      qty,
      color,
      status,
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
      })
    };
  }

  // ── DOM extraction ────────────────────────────────────────────────────────
  // Looks for Instagram username links (href="/username/") inside a node,
  // then extracts the surrounding comment text.
  const SKIP_USERNAMES = new Set([
    'explore', 'reels', 'stories', 'direct', 'accounts', 'p', 'tv', 'about', 'help'
  ]);

  function tryExtract(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const text = node.textContent.trim();
    if (!text || text.length < 2 || text.length > 400) return null;

    for (const link of node.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
      if (!m || SKIP_USERNAMES.has(m[1])) continue;

      const username = m[1];
      const commentText = text.replace(username, '').replace(/^[\s:·•\-]+/, '').trim();
      if (commentText.length < 1) continue;
      return { username, text: commentText };
    }
    return null;
  }

  // ── Comment intake ────────────────────────────────────────────────────────
  function addComment(username, text) {
    const id = `${username}::${text.slice(0, 100)}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const parsed = parseComment(username, text);
    if (parsed.status === 'filtered') return;

    parsed.item  = currentItem.name  || '';
    parsed.price = currentItem.price || '';

    captured.push(parsed);
    save();
  }

  function handleNode(node) {
    const c = tryExtract(node);
    if (c) { addComment(c.username, c.text); return; }

    for (const child of node.children) {
      const cc = tryExtract(child);
      if (cc) addComment(cc.username, cc.text);
    }
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  function save() {
    chrome.storage.local.set({ orders: captured, sessionStart, savedAt: Date.now() });
  }

  // ── MutationObserver ──────────────────────────────────────────────────────
  const observer = new MutationObserver(mutations => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        handleNode(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Auto-save every 20 seconds as a safety backup
  setInterval(save, 20000);

  // ── Storage change listener ───────────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.currentItem) {
      currentItem = changes.currentItem.newValue || { name: '', price: '' };
    }
    if (changes.clearSignal && changes.clearSignal.newValue === true) {
      captured = [];
      seenIds.clear();
      sessionStart = new Date().toISOString();
      chrome.storage.local.remove('clearSignal');
      save();
    }
  });

})();
