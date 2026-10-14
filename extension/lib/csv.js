// 名簿CSVの読み込み・書き出し（すべて端末内で処理）

// ---------- 文字コード ----------
// Mac の Numbers / Excel の「CSV UTF-8」は UTF-8、Excel の「CSV（コンマ区切り）」は Shift_JIS
export function decode(buffer) {
  const bytes = new Uint8Array(buffer);
  // Excel の「UTF-16 Unicode テキスト」
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

// ---------- CSV パース（ダブルクォート・改行入りセル対応） ----------
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------- 見出しの対応付け ----------
const normHeader = (h) => (h || '').replace(/[\s　（）()・\-_［］\[\]【】]/g, '').toLowerCase();
const isKanaWord = (h) => /ふりがな|フリガナ|かな|カナ|よみ|ヨミ|kana|yomi/.test(h);

export function mapHeader(raw) {
  const h = normHeader(raw);
  if (!h) return null;
  if (/状態|入力済|ステータス|status|done/.test(h)) return 'doneAt';
  if (/メモ|備考|memo|note/.test(h)) return 'memo';
  if (/mail|メール/.test(h)) return 'email';
  if (/tel|phone|電話|携帯/.test(h)) return 'phone';
  if (/郵便|〒|zip|postal/.test(h)) return 'zip';
  if (/都道府県|pref/.test(h)) return 'pref';
  if (/市区町村|市町村|city/.test(h)) return 'city';
  if (/建物|マンション|部屋|building|address2|住所2/.test(h)) return 'building';
  if (/番地|町名|street|address1/.test(h)) return 'street';
  if (/住所|address/.test(h)) return 'address';
  if (/生年月日|誕生日|birth/.test(h)) return 'birth';
  if (/性別|gender|sex/.test(h)) return 'gender';
  if (/会社|勤務先|company|organization/.test(h)) return 'company';
  if (/部署|所属|department/.test(h)) return 'department';
  if (isKanaWord(h) || /^(せい|セイ|めい|メイ)$/.test(h)) {
    if (/姓|せい|セイ|last|family/.test(h)) return 'last_kana';
    if (/名(?!前)|めい|メイ|first|given/.test(h) && !/氏名/.test(h)) return 'first_kana';
    return 'kana';
  }
  if (/氏名|名前|fullname|^name$/.test(h)) return 'name';
  if (/^姓名$/.test(h)) return 'name';
  if (/^(姓|氏|苗字|lastname|familyname|sei)/.test(h)) return 'last_name';
  if (/^(名|firstname|givenname|mei)$|^名漢字$/.test(h)) return 'first_name';
  return null;
}

// ---------- 値の正規化 ----------
const toHalf = (s) => (s || '').replace(/[０-９Ａ-Ｚａ-ｚ－／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
export const toHiragana = (s) => (s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const splitName = (s) => {
  const parts = (s || '').trim().split(/[\s　]+/);
  return parts.length >= 2 ? [parts[0], parts.slice(1).join(' ')] : [parts[0] || '', ''];
};

const ERAS = { 明治: 1868, 大正: 1912, 昭和: 1926, 平成: 1989, 令和: 2019, m: 1868, t: 1912, s: 1926, h: 1989, r: 2019 };

export function normalizeBirth(raw) {
  let s = toHalf(raw).trim().toLowerCase();
  if (!s) return '';
  const era = s.match(/^(明治|大正|昭和|平成|令和|[mtshr])\.?\s*(元|\d{1,2})[年.\/-]\s*(\d{1,2})[月.\/-]\s*(\d{1,2})/);
  if (era) {
    const y = ERAS[era[1]] + (era[2] === '元' ? 1 : Number(era[2])) - 1;
    return `${y}-${era[3].padStart(2, '0')}-${era[4].padStart(2, '0')}`;
  }
  const m = s.match(/^(\d{4})[年.\/-]\s*(\d{1,2})[月.\/-]\s*(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

export function normalizeGender(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(男|男性|m|male|1)$/.test(s)) return 'male';
  if (/^(女|女性|f|female|2)$/.test(s)) return 'female';
  return 'other';
}

// Excel で先頭の 0 が消えた番号を補う
export function normalizePhone(raw) {
  const d = toHalf(raw).replace(/\D/g, '');
  if (!d) return '';
  const fixed = !d.startsWith('0') && (d.length === 9 || d.length === 10) ? '0' + d : d;
  if (fixed.length === 11) return `${fixed.slice(0, 3)}-${fixed.slice(3, 7)}-${fixed.slice(7)}`;
  if (fixed.length === 10 && /^0[36]/.test(fixed)) return `${fixed.slice(0, 2)}-${fixed.slice(2, 6)}-${fixed.slice(6)}`;
  if (fixed.length === 10) return `${fixed.slice(0, 3)}-${fixed.slice(3, 6)}-${fixed.slice(6)}`;
  return fixed;
}

export function normalizeZip(raw) {
  const d = toHalf(raw).replace(/\D/g, '');
  if (!d) return '';
  const z = d.padStart(7, '0').slice(0, 7);
  return `${z.slice(0, 3)}-${z.slice(3)}`;
}

const TOKYO_WARDS = /^(千代田区|中央区|港区|新宿区|文京区|台東区|墨田区|江東区|品川区|目黒区|大田区|世田谷区|渋谷区|中野区|杉並区|豊島区|北区|荒川区|板橋区|練馬区|足立区|葛飾区|江戸川区)/;

// 市区町村を切り出す。四日市市・十日町市・東村山市・大和郡山市のように名前に「市町村郡」を含む市にも対応
export function splitCity(s) {
  const ward = s.match(TOKYO_WARDS);
  if (ward) return ward[1];
  const town = s.match(/^(.{1,5}?郡.{1,5}?[町村])/);
  if (town && !town[1].includes('市')) return town[1];
  const shi = s.match(/^(.{1,7}?市)(市)?/);
  if (shi) {
    const city = shi[1] + (shi[2] || '');
    const seirei = s.slice(city.length).match(/^(.{1,4}?区)/); // 政令指定都市の区
    return city + (seirei ? seirei[1] : '');
  }
  const other = s.match(/^(.+?[区町村])/);
  return other ? other[1] : '';
}

// 「東京都渋谷区神宮前1-2-3 ○○マンション101」を各部分に分ける（目安）
export function splitAddress(raw) {
  let s = (raw || '').trim();
  const out = { pref: '', city: '', street: '', building: '' };
  const pref = s.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);
  if (pref) { out.pref = pref[1]; s = s.slice(pref[1].length); }
  const city = splitCity(s);
  if (city) { out.city = city; s = s.slice(city.length); }
  const sp = s.search(/[\s　]/);
  if (sp > 0) { out.street = s.slice(0, sp); out.building = s.slice(sp).trim(); } else out.street = s;
  return out;
}

export const DATA_KEYS = ['last_name', 'first_name', 'last_kana', 'first_kana', 'birth', 'gender', 'email', 'phone',
  'zip', 'pref', 'city', 'street', 'building', 'company', 'department'];

// CSV テキスト → 名簿レコード
export function recordsFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('見出し行とデータ行が必要です');
  const keys = rows[0].map(mapHeader);
  if (!keys.some((k) => k === 'name' || k === 'last_name')) {
    throw new Error('「氏名」または「姓」の列が見つかりません。1行目に見出しを入れてください');
  }
  const unknown = rows[0].filter((h, i) => h.trim() && !keys[i]);
  // 同じ項目に当たる列が複数あるとき（電話番号と携帯電話など）は左の列を優先し、空なら次の列を使う
  const duplicated = [];
  keys.forEach((k, i) => {
    const first = keys.indexOf(k);
    if (k && first !== i) duplicated.push(`「${rows[0][i].trim()}」は「${rows[0][first].trim()}」が空のときだけ使います`);
  });
  const warnings = { noSpaceName: [], badBirth: [], badAddress: [] };
  const records = rows.slice(1).map((row) => {
    const raw = {};
    keys.forEach((k, i) => { if (k && !raw[k] && row[i] != null && row[i].trim() !== '') raw[k] = row[i].trim(); });
    const d = Object.fromEntries(DATA_KEYS.map((k) => [k, raw[k] || '']));
    if (raw.name && !d.last_name) {
      [d.last_name, d.first_name] = splitName(raw.name);
      if (!d.first_name) warnings.noSpaceName.push(raw.name);
    }
    if (raw.kana && !d.last_kana) [d.last_kana, d.first_kana] = splitName(raw.kana);
    d.last_kana = toHiragana(d.last_kana);
    d.first_kana = toHiragana(d.first_kana);
    if (raw.address) {
      const a = splitAddress(raw.address);
      for (const k of ['pref', 'city', 'street', 'building']) d[k] ||= a[k];
      if (!a.pref || !a.city) warnings.badAddress.push(raw.address);
    }
    const birthRaw = d.birth;
    d.birth = normalizeBirth(d.birth);
    if (birthRaw && !d.birth) warnings.badBirth.push(`${displayName(d)}（${birthRaw}）`);
    d.gender = normalizeGender(d.gender);
    d.phone = normalizePhone(d.phone);
    d.zip = normalizeZip(d.zip);
    const doneAt = raw.doneAt && !/^(未|未入力|no|false|0|-)$/i.test(raw.doneAt) ? raw.doneAt : null;
    return { name: displayName(d), data: d, memo: raw.memo || '', doneAt };
  }).filter((r) => r.data.last_name || r.data.first_name);
  return { records, unknown, duplicated, warnings };
}

// 同じ人かどうかの目印（氏名＋電話・メール・生年月日のどれか）
export function personKey(r) {
  const d = r.data;
  const name = `${d.last_name}${d.first_name}`.replace(/\s/g, '');
  const tie = (d.phone || '').replace(/\D/g, '') || (d.email || '').toLowerCase() || d.birth || '';
  return `${name}|${tie}`;
}

export const displayName = (d) => [d.last_name, d.first_name].filter(Boolean).join(' ') || '名称未設定';

// ---------- 書き出し ----------
const GENDER_LABEL = { male: '男性', female: '女性', other: 'その他' };
export const EXPORT_COLUMNS = [
  ['入力済み', (r) => r.doneAt || ''],
  ['姓', (r) => r.data.last_name], ['名', (r) => r.data.first_name],
  ['せい', (r) => r.data.last_kana], ['めい', (r) => r.data.first_kana],
  ['生年月日', (r) => (r.data.birth || '').replace(/-/g, '/')], ['性別', (r) => GENDER_LABEL[r.data.gender] || ''],
  ['メールアドレス', (r) => r.data.email], ['電話番号', (r) => r.data.phone],
  ['郵便番号', (r) => r.data.zip], ['都道府県', (r) => r.data.pref], ['市区町村', (r) => r.data.city],
  ['番地', (r) => r.data.street], ['建物名', (r) => r.data.building],
  ['会社名', (r) => r.data.company], ['部署', (r) => r.data.department], ['メモ', (r) => r.memo],
];

const esc = (v) => (/[",\r\n]/.test(v ?? '') ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');

// Excel で文字化けしないよう BOM 付き UTF-8
export function toCSV(records) {
  const lines = [EXPORT_COLUMNS.map(([h]) => h).join(',')];
  for (const r of records) lines.push(EXPORT_COLUMNS.map(([, f]) => esc(f(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function templateCSV() {
  const sample = {
    doneAt: '', memo: '例の行は消してください',
    data: { last_name: '山田', first_name: '太郎', last_kana: 'やまだ', first_kana: 'たろう', birth: '1990-04-01',
      gender: 'male', email: 'taro@example.com', phone: '090-1234-5678', zip: '150-0001', pref: '東京都',
      city: '渋谷区', street: '神宮前1-2-3', building: '〇〇マンション101', company: '', department: '' },
  };
  return toCSV([sample]);
}
