// ページに注入されるフォーム判定・入力ロジック。
// 外部への通信は一切行わない。値はポップアップ／バックグラウンドから引数で渡される。
(() => {
  if (window.__localAutofill) return;

  // ---------- 文字列ユーティリティ ----------
  const norm = (s) => (s || '').replace(/[\s　]+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();
  const digits = (s) => (s || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, '');
  const toKatakana = (s) => (s || '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const toHiragana = (s) => (s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const toZenkaku = (s) => (s || '').replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, '　');
  const hasKanji = (s) => /[一-鿿]/.test(s);
  const isHiraganaOnly = (s) => /^[ぁ-ゟー ]+$/.test(s);
  const isKatakanaOnly = (s) => /^[゠-ヿ ]+$/.test(s);

  // ---------- 対象となる入力欄 ----------
  const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'number', 'date', 'search', 'url']);
  const CONTROL_SEL = 'input, select, textarea';

  function effectiveOpacity(el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1 && o > 0.1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  }

  // 人の目に見える大きさと場所にあるか（画面外・極小・透明の欄を除外する）
  function isShown(el) {
    if (el.getClientRects().length === 0) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return false;
    const r = el.getBoundingClientRect();
    const px = (k) => parseFloat(st[k]) || 0;
    const innerW = r.width - px('paddingLeft') - px('paddingRight') - px('borderLeftWidth') - px('borderRightWidth');
    const innerH = r.height - px('paddingTop') - px('paddingBottom') - px('borderTopWidth') - px('borderBottomWidth');
    if (r.width < 4 || r.height < 4 || innerW < 3 || innerH < 3) return false;
    const docW = Math.max(document.documentElement.scrollWidth, innerWidth);
    if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0 || r.left + scrollX >= docW) return false;
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(st.clip)) return false;
    return true;
  }

  function isVisible(el) {
    if (isShown(el) && effectiveOpacity(el) > 0.1) return true;
    // デザイン用に本体を透明にしたラジオボタン・選択欄は、見えているラベルや外枠があれば対象にする
    if (el.type === 'radio' || el.tagName === 'SELECT') {
      const visual = [...(el.labels || []), el.parentElement].filter(Boolean);
      return visual.some((v) => isShown(v) && effectiveOpacity(v) > 0.1 && v.getBoundingClientRect().width >= 8);
    }
    return false;
  }

  function isCandidate(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (!TEXT_TYPES.has(t) && t !== 'radio') return false;
    }
    return isVisible(el);
  }

  const isControl = (n) => n.nodeType === 1 && n.matches(CONTROL_SEL) && n.type !== 'hidden';

  // ---------- 欄の周辺テキストを集める ----------
  const SKIP_TEXT_IN = new Set(['SELECT', 'OPTION', 'TEXTAREA', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON']);

  function textOf(node, max = 200) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    let out = '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(t) {
        for (let p = t.parentElement; p && p !== node.parentElement; p = p.parentElement) {
          if (SKIP_TEXT_IN.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      out += ' ' + walker.currentNode.textContent;
      if (out.length > max) break;
    }
    return norm(out);
  }

  function countControls(node) {
    return node.querySelectorAll(CONTROL_SEL).length;
  }

  // 欄の直前（dir='prev'）または直後（dir='next'）にあるテキスト
  function siblingText(el, dir) {
    let base = el;
    for (let level = 0; level < 3; level++) {
      let out = '';
      let n = dir === 'prev' ? base.previousSibling : base.nextSibling;
      for (let steps = 0; n && steps < 6; steps++) {
        if (n.nodeType === 1) {
          if (isControl(n) || countControls(n) > 0) break;
          if (n.tagName === 'BR') { if (norm(out)) break; }
          else out = dir === 'prev' ? textOf(n, 60) + ' ' + out : out + ' ' + textOf(n, 60);
        } else if (n.nodeType === 3) {
          out = dir === 'prev' ? n.textContent + ' ' + out : out + ' ' + n.textContent;
        }
        n = dir === 'prev' ? n.previousSibling : n.nextSibling;
      }
      out = norm(out);
      if (out) return out.length > 40 ? (dir === 'prev' ? out.slice(-40) : out.slice(0, 40)) : out;
      const parent = base.parentElement;
      if (!parent || countControls(parent) !== 1) break;
      base = parent;
    }
    return '';
  }

  function labelText(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(textOf(l, 60));
    const ids = el.getAttribute('aria-labelledby');
    if (ids) for (const id of ids.split(/\s+/)) parts.push(textOf(document.getElementById(id), 60));
    parts.push(el.getAttribute('aria-label') || '', el.getAttribute('title') || '');
    return norm(parts.join(' '));
  }

  // 表（th/td）や定義リスト（dt/dd）の見出し
  function headerText(el) {
    const cell = el.closest('td, dd');
    if (!cell) return '';
    if (cell.tagName === 'DD') {
      let p = cell.previousElementSibling;
      while (p && p.tagName !== 'DT') p = p.previousElementSibling;
      return p ? textOf(p, 60) : '';
    }
    let p = cell.previousElementSibling;
    while (p && p.tagName !== 'TH' && countControls(p) > 0) p = p.previousElementSibling;
    if (p) return textOf(p, 60);
    const row = cell.parentElement;
    const th = row && row.querySelector('th');
    return th ? textOf(th, 60) : '';
  }

  // 行（欄を含む最も近いブロック）のテキスト
  function rowText(el) {
    let node = el;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      if (node.tagName === 'FORM' || node === document.body) break;
      // 他の行まで含む大きな塊に達したら打ち切る
      if (countControls(node) > 4) return '';
      const t = textOf(node, 120);
      if (t) return t.length <= 80 ? t : '';
    }
    return '';
  }

  // ---------- 判定ルール ----------
  const SKIP_RE = /件名|題名|subject|タイトル|物件名|商品名|ニックネーム|nickname|ユーザー名|ユーザ名|username|ログイン|パスワード|password|検索|search|クーポン|coupon|認証|captcha|年齢|fax|ファックス|ファクス|人数|日時|希望日|予算|金額|数量/i;

  const CATEGORY_RULES = [
    ['email', /e-?mail|メール|mail/i],
    ['phone', /tel|phone|電話|携帯/i],
    ['zip', /zip|postal|post.?code|郵便|〒|yubin/i],
    ['pref', /pref|都道府県|address-level1/i],
    ['city', /city|市区町村|市町村|市区郡|locality|address-level2/i],
    ['building', /building|建物|ビル名|マンション|部屋番号|address-?line-?2|addr(ess)?[_-]?2|apartment/i],
    ['street', /street|番地|丁目|町名|町域|address-?line-?1|addr(ess)?[_-]?1/i],
    ['address', /住所|所在地|address|addr/i],
    ['birth', /birth|生年月日|誕生日|生まれ|bday|dob/i],
    ['company', /company|会社|法人|社名|企業|勤務先|organization|corp/i],
    ['department', /部署|所属|department|division/i],
    ['gender', /gender|性別|(^|[^a-z])sex([^a-z]|$)/i],
    ['kana', /kana|furigana|ふりがな|フリガナ|カナ|かな|よみ|ヨミ|yomi|ruby|セイ|メイ/i],
    ['name', /name|氏名|名前|姓|名|(^|[^a-z])(sei|mei)([^a-z]|$)|first|last/i],
  ];

  const AUTOCOMPLETE_MAP = {
    'family-name': 'name', 'given-name': 'name', name: 'name', email: 'email', tel: 'phone',
    'tel-national': 'phone', 'postal-code': 'zip', 'address-level1': 'pref', 'address-level2': 'city',
    'address-line1': 'street', 'street-address': 'address', 'address-line2': 'building',
    organization: 'company', bday: 'birth', 'bday-year': 'birth', 'bday-month': 'birth', 'bday-day': 'birth', sex: 'gender',
  };

  function classifyText(s) {
    if (!s) return null;
    const skip = SKIP_RE.exec(s);
    for (const [cat, re] of CATEGORY_RULES) {
      const m = re.exec(s);
      if (m) return skip && skip.index <= m.index ? 'skip' : cat;
    }
    return skip ? 'skip' : null;
  }

  const KANA_WORD_RE = /kana|furigana|ふりがな|フリガナ|カナ|かな|よみ|ヨミ|yomi|ruby|セイ|メイ|せい|めい/i;
  const LAST_RE = /姓|せい|セイ|苗字|みょうじ|last|family|surname|(^|[^a-z])sei([^a-z]|$)/i;
  const FIRST_RE = /(^|[^氏お])名(?!前)|めい|メイ|first|given|(^|[^a-z])mei([^a-z]|$)/i;

  function describe(el) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop();
    return {
      ac,
      label: labelText(el),
      prev: siblingText(el, 'prev'),
      next: siblingText(el, 'next'),
      attr: norm(`${el.name || ''} ${el.id || ''}`),
      ph: norm(el.getAttribute('placeholder') || ''),
      header: headerText(el),
      row: rowText(el),
    };
  }

  function categorize(el, c) {
    if (el.type === 'radio') {
      // ラジオボタンは性別のみ対象。選択肢が「男性／女性」なら見出しがなくても性別とみなす
      const radios = radioGroup(el);
      const box = commonAncestor(radios);
      const around = [c.header, c.attr, box && textOf(box, 120), box && siblingText(box, 'prev'), box && rowText(box)];
      const options = radios.map((r) => `${labelText(r)} ${siblingText(r, 'next')}`).join(' ');
      if (around.some((s) => /gender|性別|sex/i.test(s || ''))) return 'gender';
      return /男/.test(options) && /女/.test(options) ? 'gender' : 'skip';
    }
    let cat = AUTOCOMPLETE_MAP[c.ac] || null;
    if (!cat) {
      for (const s of [c.label, c.prev, c.attr, c.header, c.row, c.ph]) {
        cat = classifyText(s);
        if (cat) break;
      }
    }
    if (cat === 'name' && isKana(c)) cat = 'kana';
    return cat || null;
  }

  function radioGroup(el) {
    return el.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)] : [el];
  }

  function radioHeading(el) {
    const box = commonAncestor(radioGroup(el));
    return box ? (siblingText(box, 'prev') || headerText(el)).slice(0, 30) : '';
  }

  function commonAncestor(els) {
    let node = els[0]?.parentElement;
    while (node && !els.every((e) => node.contains(e))) node = node.parentElement;
    return node && node !== document.body ? node : null;
  }

  function isKana(c) {
    const proximal = `${c.label} ${c.prev} ${c.attr}`;
    if (KANA_WORD_RE.test(proximal)) return true;
    if (/漢字/.test(proximal)) return false;
    if (c.ac === 'family-name' || c.ac === 'given-name') return false;
    const ph = c.ph.replace(/^例[)）:：]?\s*|[（(]?例[)）]/g, '');
    if (ph.length >= 2) {
      if (isHiraganaOnly(ph) || isKatakanaOnly(ph)) return true;
      if (hasKanji(ph)) return false;
    }
    return KANA_WORD_RE.test(`${c.header} ${c.row}`);
  }

  // かなの表記（ひらがな／カタカナ）
  function kanaStyle(c) {
    const ph = c.ph.replace(/例/g, '');
    if (ph && isHiraganaOnly(ph)) return 'hira';
    if (ph && isKatakanaOnly(ph)) return 'kata';
    const all = `${c.label} ${c.prev} ${c.header} ${c.row}`;
    if (/ふりがな|ひらがな|かな|せい|めい/.test(all) && !/フリガナ|カタカナ|カナ|セイ|メイ/.test(all)) return 'hira';
    return 'kata';
  }

  function namePart(c) {
    for (const s of [c.prev, c.label, c.attr, c.next]) {
      if (!s) continue;
      const last = LAST_RE.test(s), first = FIRST_RE.test(s);
      if (last && !first) return 'last';
      if (first && !last) return 'first';
    }
    if (c.ac === 'family-name') return 'last';
    if (c.ac === 'given-name') return 'first';
    return null;
  }

  function birthPart(el, c) {
    if (el.type === 'date') return 'full';
    const n = c.next.charAt(0);
    if (n === '年') return 'year';
    if (n === '月') return 'month';
    if (n === '日') return 'day';
    if (c.ac === 'bday-year') return 'year';
    if (c.ac === 'bday-month') return 'month';
    if (c.ac === 'bday-day') return 'day';
    if (/year|yyyy/i.test(c.attr)) return 'year';
    if (/month|(^|[^a-z])mm([^a-z]|$)/i.test(c.attr)) return 'month';
    if (/day|(^|[^a-z])dd([^a-z]|$)/i.test(c.attr)) return 'day';
    if (el.tagName === 'SELECT') {
      const opts = [...el.options].map((o) => digits(o.text) || digits(o.value)).filter(Boolean).map(Number);
      if (opts.some((v) => v > 1900)) return 'year';
      const max = Math.max(0, ...opts);
      if (max === 12) return 'month';
      if (max >= 28 && max <= 31) return 'day';
    }
    const near = `${c.label} ${c.prev}`;
    if (/年/.test(near) && !/月|日/.test(near)) return 'year';
    return null;
  }

  // ---------- 欄の一覧を作る ----------
  // React などが毎回作り直す id（:r1:、mui-123、input-v-4 など）
  const GENERATED_ID = /[:]|\d{3,}|^(mui|react|radix|headlessui|chakra|mantine|v-|el-|input-|field-|ember|ext-gen)/i;

  function signature(el, c, all) {
    if (el.name && !GENERATED_ID.test(el.name)) {
      if (el.type === 'radio') return `r:${el.name}`;
      const same = all.filter((e) => e.name === el.name);
      return `n:${el.name}@${same.indexOf(el)}`;
    }
    if (el.id && !GENERATED_ID.test(el.id) && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${el.id}`;
    // 名前で特定できない欄は「ラベル＋同じラベル内の順番」で覚える
    const label = shortLabel(c);
    const same = all.filter((e) => e.__laLabel === label);
    return `t:${label}@${same.indexOf(el)}`;
  }

  function shortLabel(c) {
    const clean = (t) => norm((t || '').replace(/必須|任意|[※*＊]/g, ''));
    const pick = [c.label, c.prev, c.header, c.row, c.ph, c.attr].map(clean).find((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length >= 2);
    return (pick || '(名称なし)').slice(0, 30);
  }

  function collect(rules) {
    const els = [...document.querySelectorAll(CONTROL_SEL)].filter(isCandidate);
    const seenRadio = new Set();
    const fields = [];
    const descs = els.map((el) => {
      const c = describe(el);
      el.__laLabel = shortLabel(c);
      return c;
    });
    els.forEach((el, i) => {
      const c = descs[i];
      const sig = signature(el, c, els);
      if (el.type === 'radio') {
        if (seenRadio.has(sig)) return;
        seenRadio.add(sig);
      }
      const cat = categorize(el, c);
      const label = el.type === 'radio' ? (cat === 'gender' ? '性別' : radioHeading(el) || el.__laLabel) : el.__laLabel;
      fields.push({ el, sig, c, cat, part: null, key: null, label });
    });

    // 部分（姓／名、年／月／日など）を判定
    for (const f of fields) {
      if (f.cat === 'name' || f.cat === 'kana') f.part = namePart(f.c);
      else if (f.cat === 'birth') f.part = birthPart(f.el, f.c);
      else if (f.cat === 'zip') {
        const ml = f.el.maxLength;
        f.part = ml === 3 ? '1' : ml === 4 ? '2' : null;
      }
    }

    // 同じ行に並ぶ同じ種類の欄をまとめて分割する
    for (let i = 0; i < fields.length; ) {
      const f = fields[i];
      let j = i + 1;
      while (j < fields.length && f.cat && fields[j].cat === f.cat && fields[j].c.row === f.c.row) j++;
      const group = fields.slice(i, j);
      if (group.length > 1) assignGroup(f.cat, group);
      i = j;
    }

    for (const f of fields) {
      if (!f.key) f.key = finalKey(f);
      if (rules && rules[f.sig]) f.key = rules[f.sig];
    }
    return fields;
  }

  function assignGroup(cat, group) {
    const n = group.length;
    if ((cat === 'name' || cat === 'kana') && n === 2) {
      if (!group[0].part && !group[1].part) { group[0].part = 'last'; group[1].part = 'first'; }
      else if (!group[1].part) group[1].part = group[0].part === 'last' ? 'first' : 'last';
      else if (!group[0].part) group[0].part = group[1].part === 'last' ? 'first' : 'last';
    } else if (cat === 'zip' && n === 2) {
      group[0].part = '1'; group[1].part = '2';
    } else if (cat === 'phone' && n === 3) {
      const lens = group.map((f) => (f.el.maxLength > 0 ? f.el.maxLength : 0));
      group.forEach((f, k) => { f.part = String(k + 1); f.lens = lens; });
    } else if (cat === 'birth' && n === 3) {
      const order = ['year', 'month', 'day'];
      group.forEach((f, k) => { if (!f.part || f.part === 'full') f.part = order[k]; });
    } else if (cat === 'address' && n === 2) {
      group[1].key = 'building';
    }
  }

  function finalKey(f) {
    switch (f.cat) {
      case 'name': return f.part === 'last' ? 'last_name' : f.part === 'first' ? 'first_name' : 'name';
      case 'kana': return f.part === 'last' ? 'last_kana' : f.part === 'first' ? 'first_kana' : 'kana';
      case 'zip': return f.part ? `zip${f.part}` : 'zip';
      case 'phone': return f.part ? `phone${f.part}` : 'phone';
      case 'birth': return f.part && f.part !== 'full' ? `birth_${f.part}` : 'birth';
      default: return f.cat || null;
    }
  }

  // ---------- 値を組み立てる ----------
  function splitPhone(num, lens) {
    if (lens && lens.every((l) => l > 0) && lens.reduce((a, b) => a + b, 0) === num.length) {
      return [num.slice(0, lens[0]), num.slice(lens[0], lens[0] + lens[1]), num.slice(lens[0] + lens[1])];
    }
    if (num.length === 11) return [num.slice(0, 3), num.slice(3, 7), num.slice(7)];
    if (/^0[36]/.test(num) && num.length === 10) return [num.slice(0, 2), num.slice(2, 6), num.slice(6)];
    return [num.slice(0, 3), num.slice(3, 6), num.slice(6)];
  }

  function joinPhone(num) {
    const p = splitPhone(num);
    return p.filter(Boolean).join('-');
  }

  // 住所の各部分を、ページ上に存在する欄へ割り振る
  // selectKeys: 選択欄の項目（都道府県の選択欄などには、ほかの部分をつなげて入れられない）
  function addressPlan(present, selectKeys = new Set()) {
    const parts = ['pref', 'city', 'street', 'building'];
    const canTake = (o) => o && !selectKeys.has(o);
    const owner = {};
    parts.forEach((p, i) => {
      if (present.has(p)) owner[p] = p;
      else if (canTake('address') && present.has('address')) owner[p] = 'address';
      else {
        let o = null;
        for (let k = i - 1; k >= 0 && !o; k--) if (canTake(owner[parts[k]])) o = owner[parts[k]];
        for (let k = i + 1; k < parts.length && !o; k++) if (present.has(parts[k]) && canTake(parts[k])) o = parts[k];
        owner[p] = o;
      }
    });
    return owner;
  }

  function addressValue(key, d, plan) {
    let out = '';
    for (const p of ['pref', 'city', 'street', 'building']) {
      if (plan[p] !== key || !d[p]) continue;
      out += p === 'building' && out ? ' ' + d[p] : d[p];
    }
    return out;
  }

  function valueFor(f, d, plan) {
    const c = f.c;
    const birth = (d.birth || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const zip = digits(d.zip);
    const tel = digits(d.phone);
    const wantsHyphen = /-|ー|－/.test(c.ph);
    const style = kanaStyle(c);
    const kana = (s) => (style === 'hira' ? toHiragana(s || '') : toKatakana(s || ''));
    let v;
    switch (f.key) {
      case 'name': v = [d.last_name, d.first_name].filter(Boolean).join(' '); break;
      case 'last_name': v = d.last_name; break;
      case 'first_name': v = d.first_name; break;
      case 'kana': v = [kana(d.last_kana), kana(d.first_kana)].filter(Boolean).join(' '); break;
      case 'last_kana': v = kana(d.last_kana); break;
      case 'first_kana': v = kana(d.first_kana); break;
      case 'email': v = d.email; break;
      case 'phone':
        if (!tel) break;
        v = wantsHyphen || f.el.maxLength >= 12 ? joinPhone(tel) : tel; break;
      case 'phone1': case 'phone2': case 'phone3':
        if (tel) v = splitPhone(tel, f.lens)[Number(f.key.slice(-1)) - 1]; break;
      case 'zip':
        if (!zip) break;
        v = wantsHyphen || f.el.maxLength === 8 ? `${zip.slice(0, 3)}-${zip.slice(3)}` : zip; break;
      case 'zip1': v = zip.slice(0, 3); break;
      case 'zip2': v = zip.slice(3); break;
      case 'pref': case 'city': case 'street': case 'building': case 'address':
        v = addressValue(f.key, d, plan); break;
      case 'company': v = d.company; break;
      case 'department': v = d.department; break;
      case 'birth':
        if (!birth) break;
        if (f.el.type === 'date') v = `${birth[1]}-${birth[2].padStart(2, '0')}-${birth[3].padStart(2, '0')}`;
        else {
          const sep = /\//.test(c.ph) ? '/' : /-/.test(c.ph) ? '-' : /^\d{8}$/.test(digits(c.ph)) && c.ph.length === 8 ? '' : '/';
          v = [birth[1], birth[2].padStart(2, '0'), birth[3].padStart(2, '0')].join(sep);
        }
        break;
      case 'birth_year': if (birth) v = birth[1]; break;
      case 'birth_month': if (birth) v = String(Number(birth[2])); break;
      case 'birth_day': if (birth) v = String(Number(birth[3])); break;
      case 'gender': v = d.gender; break;
    }
    if (v && f.el.tagName !== 'SELECT' && /全角/.test(`${c.label} ${c.prev} ${c.next} ${c.ph}`) && !/半角/.test(`${c.label} ${c.prev} ${c.next}`)) {
      v = toZenkaku(v);
    }
    return v || '';
  }

  // ---------- 実際に入力する ----------
  const PREF_STRIP = (s) => lower(s).replace(/[都道府県]$/, '');

  function findOption(sel, key, v) {
    const opts = [...sel.options];
    const num = Number(digits(v));
    const tests = {
      pref: (o) => PREF_STRIP(o.text) === PREF_STRIP(v) || PREF_STRIP(o.value) === PREF_STRIP(v),
      birth_year: (o) => o.text.includes(v) || o.value.includes(v),
      birth_month: (o) => Number(digits(o.text) || digits(o.value)) === num && digits(o.text || o.value).length <= 2,
      birth_day: (o) => Number(digits(o.text) || digits(o.value)) === num && digits(o.text || o.value).length <= 2,
      gender: (o) => {
        const t = lower(`${o.text} ${o.value}`);
        if (v === 'male') return /男|(^|[^e])male|^m( |$)/.test(t);
        if (v === 'female') return /女|female|^f( |$)/.test(t);
        return /その他|other|回答しない/.test(t);
      },
    };
    const test = tests[key] || ((o) => lower(o.text) === lower(v) || lower(o.value) === lower(v));
    return opts.find(test) || (tests[key] ? null : opts.find((o) => v && lower(o.text).includes(lower(v))));
  }

  function isEmpty(el) {
    if (el.tagName === 'SELECT') {
      if (!el.value) return true;
      const opt = el.options[el.selectedIndex];
      if (el.selectedIndex <= 0 && !!opt && /選択|選んで|^-+$|^ *$|please|select/i.test(opt.text)) return true;
      // ページが最初から選んでいた選択肢（例：都道府県の初期値「東京都」）のままなら空とみなす
      return !!opt && opt.defaultSelected && !wasSetByUs(el, opt.value);
    }
    if (el.type === 'radio') {
      const checked = radioGroup(el).find((r) => r.checked);
      return !checked || checked.defaultChecked;
    }
    return el.value === '';
  }

  // この拡張が前に入れた値（同じページ内）
  const lastSet = new WeakMap();
  const wasSetByUs = (el, value) => lastSet.has(el) && lastSet.get(el) === value;

  function currentValue(el) {
    if (el.type === 'radio') return radioGroup(el).find((r) => r.checked)?.value ?? '';
    return el.value;
  }

  // すでに同じ値が入っているか（同じ人を2回入力したときなど）
  function alreadyHas(f, v) {
    const cur = currentValue(f.el);
    if (!cur) return false;
    if (f.el.tagName === 'SELECT') return findOption(f.el, f.key, v)?.value === cur && !isEmpty(f.el);
    if (f.el.type === 'radio') return radioFor(f.el, v)?.value === cur && !isEmpty(f.el);
    return cur === v;
  }

  // 前の人の値が残っている欄か（この拡張が入れた値、または前に入力した人のデータと一致）
  function isLeftover(f, prevData, plan) {
    const cur = currentValue(f.el);
    if (!cur) return false;
    if (wasSetByUs(f.el, cur)) return true;
    if (!prevData) return false;
    const pv = valueFor(f, prevData, plan);
    if (!pv) return false;
    if (f.el.tagName === 'SELECT') return findOption(f.el, f.key, pv)?.value === cur;
    if (f.el.type === 'radio') return radioFor(f.el, pv)?.value === cur;
    return pv === cur;
  }

  function setValue(el, v) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function radioFor(el, v) {
    const radios = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
    return radios.find((r) => {
      const t = lower(`${labelText(r)} ${siblingText(r, 'next')} ${r.value}`);
      if (v === 'male') return /男|(^|[^e])male|^m$/.test(t);
      if (v === 'female') return /女|female|^f$/.test(t);
      return /その他|other|回答しない/.test(t);
    });
  }

  function flash(el) {
    const prev = el.style.outline;
    el.style.outline = '2px solid #1f9d6b';
    el.style.outlineOffset = '1px';
    setTimeout(() => { el.style.outline = prev; }, 2500);
  }

  let undoStack = [];

  // 判定できた欄がいちばん多いフォームだけを対象にする（ヘッダーのログイン欄やメルマガ欄を避ける）
  function mainGroup(fields) {
    const score = new Map();
    for (const f of fields) {
      f.group = f.el.form || f.el.closest('form') || null;
      if (f.key && f.key !== 'skip') score.set(f.group, (score.get(f.group) || 0) + 1);
    }
    let best = null, bestScore = -1;
    for (const [g, n] of score) if (n > bestScore) { best = g; bestScore = n; }
    return best;
  }

  function fill(data, rules, opts = {}) {
    const fields = collect(rules);
    const main = mainGroup(fields);
    const inMain = fields.filter((f) => f.group === main);
    const present = new Set(inMain.map((f) => f.key).filter(Boolean));
    const plan = addressPlan(present, new Set(inMain.filter((f) => f.el.tagName === 'SELECT').map((f) => f.key)));
    const changes = [];
    const report = [];
    for (const f of fields) {
      const entry = { sig: f.sig, label: f.label, key: f.key, status: 'unknown' };
      report.push(entry);
      if (f.group !== main) { entry.status = 'other-form'; continue; }
      // 判定できない自由記述欄（お問い合わせ内容など）は「未判定」に数えない
      if (f.key === 'skip' || (!f.key && f.el.tagName === 'TEXTAREA')) { entry.status = 'skip'; continue; }
      if (!f.key) continue;
      const v = valueFor(f, data || {}, plan);
      if (!v) { entry.status = 'no-value'; continue; }
      if (alreadyHas(f, v)) { entry.status = 'filled'; entry.same = true; continue; }
      if (!opts.overwrite && !isEmpty(f.el)) {
        if (isLeftover(f, opts.prevData, plan)) entry.replaced = true;
        else { entry.status = 'kept'; continue; }
      }
      const el = f.el;
      if (el.type === 'radio') {
        const r = radioFor(el, v);
        if (!r) { entry.status = 'no-match'; continue; }
        const checked = document.querySelector(`input[type=radio][name="${CSS.escape(el.name)}"]:checked`);
        changes.push({ el: r, radio: true, prevChecked: checked });
        r.click();
        lastSet.set(el, r.value);
        flash(r.labels?.[0] || r);
      } else if (el.tagName === 'SELECT') {
        const o = findOption(el, f.key, v);
        if (!o) { entry.status = 'no-match'; continue; }
        changes.push({ el, prev: el.value });
        setValue(el, o.value);
        lastSet.set(el, o.value);
        flash(el);
      } else {
        changes.push({ el, prev: el.value });
        setValue(el, v);
        lastSet.set(el, el.value);
        flash(el);
      }
      entry.status = 'filled';
    }
    if (changes.length) undoStack.push(changes);
    return { host: location.hostname, fields: report };
  }

  function scan(rules) {
    const fields = collect(rules);
    const main = mainGroup(fields);
    return { host: location.hostname, fields: fields.filter((f) => f.group === main).map((f) => ({ sig: f.sig, label: f.label, key: f.key, status: 'scan' })) };
  }

  function undo() {
    const changes = undoStack.pop();
    if (!changes) return 0;
    for (const ch of changes.reverse()) {
      if (ch.radio) {
        if (ch.prevChecked) ch.prevChecked.click();
        else { ch.el.checked = false; ch.el.dispatchEvent(new Event('change', { bubbles: true })); }
      } else setValue(ch.el, ch.prev);
    }
    return changes.length;
  }

  window.__localAutofill = { fill, scan, undo };
})();
