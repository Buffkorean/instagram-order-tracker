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
  // Regex-based Korean color patterns — catches adjective forms (빨간거, 파란색으로)
  // and loanwords (블랙, 네이비, etc.)
  const COLOR_PATTERNS_KR = [
    { re: /빨간(?:거|색|것|색으로)?|빨강/, label: '빨강' },
    { re: /파란(?:거|색|것|색으로)?|파랑/, label: '파랑' },
    { re: /검은(?:거|것)?|검정(?:으로|이요)?|검은색|검정색?/, label: '검정' },
    { re: /하얀(?:거|것)?|흰(?:거|색|것)?|흰색/, label: '흰색' },
    { re: /노란(?:거|색|것)?|노랑/, label: '노랑' },
    { re: /초록(?:거|색|것)?/, label: '초록' },
    { re: /분홍(?:거|색|것)?/, label: '분홍' },
    { re: /보라(?:거|색|것)?/, label: '보라' },
    { re: /갈색(?:거|것)?/, label: '갈색' },
    { re: /회색(?:거|것)?/, label: '회색' },
    { re: /블랙/, label: '블랙' },
    { re: /화이트/, label: '화이트' },
    { re: /블루/, label: '블루' },
    { re: /네이비/, label: '네이비' },
    { re: /레드/, label: '레드' },
    { re: /그린/, label: '그린' },
    { re: /핑크/, label: '핑크' },
    { re: /퍼플/, label: '퍼플' },
    { re: /옐로우?/, label: '옐로우' },
    { re: /오렌지/, label: '오렌지' },
    { re: /그레이/, label: '그레이' },
    { re: /베이지/, label: '베이지' },
    { re: /브라운/, label: '브라운' },
    { re: /크림/, label: '크림' },
    { re: /아이보리/, label: '아이보리' },
    { re: /민트/, label: '민트' },
    { re: /라벤더/, label: '라벤더' },
    { re: /카키/, label: '카키' },
    { re: /카멜/, label: '카멜' },
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
    let explicitQty = false;
    const qtyMatch = text.match(QTY_RE);
    if (qtyMatch) {
      qty = parseInt(qtyMatch[1]);
      explicitQty = true;
    } else {
      for (const [word, num] of Object.entries(QTY_KR)) {
        if (text.includes(word)) { qty = num; explicitQty = true; break; }
      }
    }
    if (!qty) qty = 1;

    let color = null;
    for (const c of COLORS_EN) {
      if (lower.includes(c)) { color = c[0].toUpperCase() + c.slice(1); break; }
    }
    if (!color) {
      for (const { re, label } of COLOR_PATTERNS_KR) {
        if (re.test(text)) { color = label; break; }
      }
    }

    // Order = clear intent + at least one detail (size, color, or explicit quantity)
    // e.g. "빨간거 하나 주세요" → order; "주세요" alone → incomplete
    const hasOrderIntent = hasENIntent || hasKRIntent;
    let status;
    if (hasOrderIntent) {
      status = (size || color || explicitQty) ? 'order' : 'incomplete';
    } else if (hasIncomplete) {
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
  const SKIP_USERNAMES = new Set([
    'explore', 'reels', 'stories', 'direct', 'accounts', 'p', 'tv', 'about', 'help',
    'reply', 'like', 'likes', 'view', 'views', 'add', 'comment', 'comments',
    'share', 'follow', 'following', 'followers', 'message', 'live', 'watch',
    'send', 'more', 'less', 'see', 'load', 'show', 'hide', 'close', 'open',
    'login', 'signup', 'instagram', 'meta', 'verified'
  ]);

  const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._]{3,29}$/;
  const UI_NOISE = /\b(Reply|Replies|Like|Likes|View replies|Hide replies|Load more)\b/gi;

  function tryExtract(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const rawText = node.textContent.trim();
    if (!rawText || rawText.length < 3 || rawText.length > 400) return null;

    // Method 1: <a href="/username/"> anchor links (regular feed)
    for (const link of node.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
      if (!m || SKIP_USERNAMES.has(m[1].toLowerCase())) continue;
      const username = m[1];
      const commentText = rawText.replace(username, '').replace(/^[\s:·•\-]+/, '').trim();
      if (commentText.length >= 1) return { username, text: commentText };
    }

    // Method 2: child element whose entire text looks like a username
    // (Instagram Live renders username in a dedicated child span/div)
    for (const child of node.children) {
      const childText = child.textContent.trim();
      if (!USERNAME_RE.test(childText) || SKIP_USERNAMES.has(childText.toLowerCase())) continue;
      const rest = Array.from(node.children)
        .filter(c => c !== child)
        .map(c => c.textContent.trim())
        .join(' ')
        .replace(UI_NOISE, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (rest.length >= 1) return { username: childText, text: rest };
    }

    // Method 3: parse "username<space>comment" from raw text
    // Strip common UI noise first
    const cleaned = rawText.replace(UI_NOISE, '').replace(/\s+/g, ' ').trim();
    const m3 = cleaned.match(/^([a-zA-Z0-9][a-zA-Z0-9._]{3,29})\s+(.{1,300})$/s);
    if (m3 && !SKIP_USERNAMES.has(m3[1].toLowerCase())) {
      return { username: m3[1], text: m3[2].trim() };
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
