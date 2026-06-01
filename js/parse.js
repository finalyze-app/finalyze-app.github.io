// Import layer: OFX/QFX (2.x XML and 1.x SGML) + CSV with auto-format detection.
// Everything runs locally in the browser; no network.

(function (global) {
  // ---------- shared helpers ----------
  function parseOfxDate(raw) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(raw || '').trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function ymd(d) { return d ? d.toISOString().slice(0, 10) : null; }

  // MEMO carries the cardmember, e.g. "MOUNIR EL-CHOUEIRI-92004".
  // CIBC CSV puts a card number in the last column - label it by last four digits.
  function parseCardmember(memo) {
    if (!memo) return 'Unknown';
    const s = String(memo).trim();
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 4 && digits.length <= 19 && !/[a-z]/i.test(s)) {
      return 'Card ••••' + digits.slice(-4);
    }
    return s.replace(/-\d+\s*$/, '').trim() || 'Unknown';
  }

  // Build a normalized transaction from a signed amount (debit negative = spend).
  function mkTxn(amount, dateStr, fitid, type, name, memo) {
    return {
      fitid: fitid || '',
      date: dateStr,
      type: type || (amount < 0 ? 'DEBIT' : 'CREDIT'),
      amount,
      isSpend: amount < 0,
      spend: amount < 0 ? Math.abs(amount) : 0,
      refund: amount > 0 ? amount : 0,
      name: (name || '').trim() || 'Unknown',
      cardmember: parseCardmember(memo),
    };
  }

  // ---------- OFX / QFX ----------
  function tryParseOFXXML(content) {
    let doc;
    try { doc = new DOMParser().parseFromString(content, 'text/xml'); } catch (e) { return null; }
    if (doc.getElementsByTagName('parsererror').length) return null;
    const trnNodes = doc.getElementsByTagName('STMTTRN');
    if (!trnNodes.length) return null;
    const text = (node, tag) => { const el = node.getElementsByTagName(tag)[0]; return el ? el.textContent.trim() : ''; };
    const currency = text(doc.documentElement, 'CURDEF') || null;
    const ledger = doc.getElementsByTagName('LEDGERBAL')[0];
    const balance = ledger ? Number(text(ledger, 'BALAMT')) : null;
    const balanceAsOf = ledger ? parseOfxDate(text(ledger, 'DTASOF')) : null;
    const transactions = [];
    for (let i = 0; i < trnNodes.length; i++) {
      const n = trnNodes[i];
      const amount = Number(text(n, 'TRNAMT'));
      const date = parseOfxDate(text(n, 'DTPOSTED'));
      if (!isFinite(amount) || !date) continue;
      transactions.push(mkTxn(amount, ymd(date), text(n, 'FITID') || text(n, 'REFNUM'), text(n, 'TRNTYPE'), text(n, 'NAME'), text(n, 'MEMO')));
    }
    return { currency, balance: isFinite(balance) ? balance : null, balanceAsOf, transactions, source: 'OFX/QFX' };
  }

  // OFX 1.x is SGML (tags frequently unclosed) - DOMParser can't read it as XML.
  // Parse it tag-by-tag with regex instead.
  function parseOFXSGML(content) {
    const field = (chunk, tag) => {
      const m = new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i').exec(chunk);
      return m ? m[1].trim() : '';
    };
    const first = (tag) => field(content, tag);
    const currency = first('CURDEF') || null;
    const balRaw = first('BALAMT');
    const balance = balRaw ? Number(balRaw) : null;
    const balanceAsOf = parseOfxDate(first('DTASOF'));
    const chunks = content.split(/<STMTTRN>/i).slice(1);
    const transactions = [];
    for (const c of chunks) {
      const amount = Number(field(c, 'TRNAMT'));
      const date = parseOfxDate(field(c, 'DTPOSTED'));
      if (!isFinite(amount) || !date) continue;
      transactions.push(mkTxn(amount, ymd(date), field(c, 'FITID') || field(c, 'REFNUM'), field(c, 'TRNTYPE'), field(c, 'NAME'), field(c, 'MEMO')));
    }
    return { currency, balance: isFinite(balance) ? balance : null, balanceAsOf, transactions, source: 'OFX (1.x)' };
  }

  function parseQFX(content) {
    const xml = tryParseOFXXML(content);
    if (xml && xml.transactions.length) return xml;
    const sgml = parseOFXSGML(content);
    if (sgml.transactions.length) return sgml;
    if (xml) return xml; // parsed but empty
    throw new Error('Could not parse file as OFX/QFX.');
  }

  // ---------- CSV ----------
  function splitLine(line, delim) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function detectDelimiter(sample) {
    const cands = [',', ';', '\t', '|'];
    let best = ',', bestN = -1;
    for (const d of cands) {
      const n = (sample.split(d).length - 1);
      if (n > bestN) { bestN = n; best = d; }
    }
    return best;
  }
  function normCSVDate(s) {
    s = String(s || '').trim();
    if (!s) return null;
    let m;
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s))) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    // Fallback for formats like "15 Jan 2026". Reject bare numbers/amounts so an
    // amount column (e.g. "52.10") isn't mistaken for a date.
    if (/^[\d.,()$-]+$/.test(s)) return null;
    if (!/[a-z]/i.test(s) && !/[/-]/.test(s)) return null;
    const d = new Date(s);
    return isNaN(d) ? null : ymd(d);
  }
  // Parse an amount cell; supports $, thousands commas, and accounting "(12.34)" negatives.
  function parseAmount(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-/.test(s)) neg = true;
    const n = Number(s.replace(/[^0-9.]/g, ''));
    if (!isFinite(n) || s.replace(/[^0-9.]/g, '') === '') return null;
    return neg ? -n : n;
  }

  // Known issuers: detect by header signature to fix the amount-sign convention and
  // label the import. (Auto sign-detection covers everything else.)
  function detectIssuer(h) {
    // United States
    if (h.includes('card member')) return { name: 'American Express', sign: 'charge-pos' };
    if (h.includes('trans. date')) return { name: 'Discover', sign: 'charge-pos' };
    if (h.includes('transaction date') && h.includes('post date')) return { name: 'Chase', sign: 'as-is' };
    if (h.includes('running bal')) return { name: 'Bank of America', sign: 'as-is' };
    // Canada
    if (h.includes('cad$') || h.includes('description 1')) return { name: 'RBC Royal Bank', sign: 'as-is' };
    if (h.includes('first bank card') || (h.includes('transaction amount') && h.includes('date posted'))) return { name: 'BMO', sign: 'as-is' };
    if (h.includes('montant') || h.includes('débit') || h.includes('crédit')) return { name: 'National Bank / Desjardins', sign: 'split' };
    if (h.includes('memo') && h.includes('name') && h.includes('amount') && h.includes('transaction')) return { name: 'Tangerine', sign: 'as-is' };
    if (h.includes('debit') && h.includes('credit')) {
      if (h.includes('card no')) return { name: 'Capital One', sign: 'split' };
      return { name: 'Bank CSV', sign: 'split' }; // debit/credit columns handle the sign
    }
    return null;
  }

  // Resolve column indices from a header row (lowercased cells).
  function colsFromHeader(H) {
    const find = (re) => H.findIndex((c) => re.test(c));
    const findAll = (re) => H.map((c, i) => (re.test(c) ? i : -1)).filter((i) => i >= 0);
    const dateIdxs = findAll(/date/);
    let di = dateIdxs.find((i) => /trans/.test(H[i]));
    if (di == null) di = dateIdxs.find((i) => !/post/.test(H[i]));
    if (di == null) di = dateIdxs[0];
    const ni = find(/description|payee|merchant|name|details|memo|reference|narration|libellé|libelle/);
    const ci = find(/card *member|cardmember|name on card/);
    const debitI = find(/debit|débit|withdraw|retrait|paid out|money out/);
    const creditI = find(/credit|crédit|deposit|dépôt|depot|paid in|money in/);
    let ai = find(/cad\$|^amount$|amount|amt|montant|^value$|charge/);
    if (ai === debitI || ai === creditI) ai = -1;
    return { di, ni, ci, debitI, creditI, ai };
  }

  // Trailing column of 4–19 digit card numbers (CIBC puts card # last).
  function looksLikeCardColumn(rows, colIdx) {
    let cardish = 0, total = 0;
    for (const r of rows) {
      const v = r[colIdx]; if (v == null || v === '') continue;
      total++;
      const digits = String(v).replace(/\D/g, '');
      if (digits.length >= 4 && digits.length <= 19 && !/[a-z]/i.test(v)) cardish++;
    }
    return total > 0 && cardish / total >= 0.7;
  }

  // CIBC credit card CSV: no header - Date, Description, Charges, Payments/refunds, Card #.
  function detectCIBCHeaderless(rows) {
    const sample = rows.slice(0, Math.min(40, rows.length)).filter((r) => r.length >= 4);
    if (sample.length < 2) return null;
    const colCount = Math.max(...sample.map((r) => r.length));
    if (colCount < 4 || colCount > 6) return null;

    let dates = 0, desc = 0, hasCharge = 0, hasPayment = 0, dual = 0;
    for (const r of sample) {
      if (normCSVDate(r[0])) dates++;
      if (r[1] && parseAmount(r[1]) == null && r[1].length > 1) desc++;
      const ch = parseAmount(r[2]);
      const pay = parseAmount(r[3]);
      if (ch != null && ch !== 0) hasCharge++;
      if (pay != null && pay !== 0) hasPayment++;
      if (ch != null && ch !== 0 && pay != null && pay !== 0) dual++;
    }
    const n = sample.length;
    if (dates / n < 0.75 || desc / n < 0.6) return null;
    if (hasCharge + hasPayment < n * 0.5) return null;
    if (dual / n > 0.05) return null;

    const ci = colCount >= 5 && looksLikeCardColumn(sample, 4) ? 4 : -1;
    return { di: 0, ni: 1, debitI: 2, creditI: 3, ci, ai: -1 };
  }

  // Infer columns when there is no header. Handles single-amount files and
  // Debit/Credit/Balance layouts (TD, CIBC, Simplii) by detecting the sparse,
  // mutually-exclusive debit & credit columns and ignoring a trailing balance.
  function colsHeaderless(rows) {
    const cibc = detectCIBCHeaderless(rows);
    if (cibc) return cibc;

    const n = rows.length;
    const colCount = Math.max(...rows.map((r) => r.length));
    const cardCols = new Set();
    for (let c = colCount - 1; c >= 0; c--) {
      if (looksLikeCardColumn(rows, c)) { cardCols.add(c); break; }
    }
    const stat = [];
    for (let c = 0; c < colCount; c++) {
      let dates = 0, nums = 0, filled = 0, textLen = 0;
      rows.forEach((r) => {
        const v = r[c]; if (v == null || v === '') return;
        filled++;
        if (normCSVDate(v)) dates++;
        else if (!cardCols.has(c) && parseAmount(v) != null) nums++;
        else textLen += String(v).length;
      });
      stat.push({ c, dates, nums, filled, textLen });
    }
    let di = stat.slice().sort((a, b) => b.dates - a.dates)[0];
    di = di && di.dates > 0 ? di.c : 0;
    const numeric = stat.filter((x) => x.c !== di && !cardCols.has(x.c) && x.nums > 0).sort((a, b) => a.c - b.c);
    let debitI = -1, creditI = -1, ai = -1;
    const sparse = numeric.filter((x) => x.nums / n < 0.95);
    if (sparse.length >= 2) { debitI = sparse[0].c; creditI = sparse[1].c; }
    else if (numeric.length) { ai = numeric[0].c; }
    const skip = new Set([di, ai, debitI, creditI, ...cardCols]);
    const ni = stat.filter((x) => !skip.has(x.c)).sort((a, b) => b.textLen - a.textLen)[0];
    const ci = cardCols.size ? [...cardCols][0] : -1;
    return { di, ni: ni ? ni.c : -1, ci, debitI, creditI, ai };
  }

  function readCSVRows(content) {
    const rawLines = content.split(/\r?\n/).filter((l) => l.trim().length);
    if (!rawLines.length) throw new Error('Empty CSV file.');
    const delim = detectDelimiter(rawLines.slice(0, 5).join('\n'));
    const rows = rawLines.map((l) => splitLine(l, delim).map((c) => c.trim()));
    return { rows, delim };
  }

  function detectHeaderRow(rows) {
    const DATE_RE = /date/i;
    const AMT_RE = /amount|amt|debit|credit|withdraw|deposit|money|paid|value|charge|cad|montant|retrait|dépôt|depot|débit|crédit/i;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const cells = rows[i].map((c) => c.toLowerCase());
      if (cells.some((c) => DATE_RE.test(c)) && cells.some((c) => AMT_RE.test(c))) return i;
    }
    return -1;
  }

  function guessCSVMapping(rows, hasHeader) {
    let mapping, source = 'CSV';
    if (hasHeader) {
      const H = rows[0].map((c) => c.toLowerCase());
      const cols = colsFromHeader(H);
      mapping = {
        date: cols.di, description: cols.ni, debit: cols.debitI, credit: cols.creditI,
        amount: cols.ai, cardmember: cols.ci,
      };
      const issuer = detectIssuer(H.join(' '));
      if (issuer) source = issuer.name;
    } else {
      const cols = colsHeaderless(rows);
      mapping = {
        date: cols.di, description: cols.ni, debit: cols.debitI, credit: cols.creditI,
        amount: cols.ai, cardmember: cols.ci,
      };
      if (detectCIBCHeaderless(rows)) source = 'CIBC';
      else if (cols.debitI >= 0 || cols.creditI >= 0) source = 'Bank CSV';
    }
    return { mapping, source };
  }

  function colCount(rows) {
    return rows.length ? Math.max(...rows.map((r) => r.length)) : 0;
  }

  function colLabel(rows, colIdx, hasHeader) {
    if (hasHeader && rows[0] && rows[0][colIdx]) return rows[0][colIdx];
    const sample = rows[hasHeader ? 1 : 0];
    const v = sample && sample[colIdx];
    if (!v) return 'Column ' + (colIdx + 1);
    return 'Column ' + (colIdx + 1) + ' (' + (v.length > 22 ? v.slice(0, 20) + '…' : v) + ')';
  }

  function inferAmountSign(rows, start, ai, issuerSign) {
    if (issuerSign && issuerSign !== 'split') return issuerSign;
    let pos = 0, neg = 0;
    for (let i = start; i < rows.length; i++) {
      const v = parseAmount(rows[i][ai]); if (v == null) continue;
      if (v < 0) neg++; else if (v > 0) pos++;
    }
    return neg >= pos ? 'as-is' : 'charge-pos';
  }

  function previewCSV(content) {
    const { rows, delim } = readCSVRows(content);
    const headerRow = detectHeaderRow(rows);
    const hasHeaderGuess = headerRow === 0;
    const { mapping, source } = guessCSVMapping(rows, hasHeaderGuess);
    const cols = colCount(rows);
    let amountSign = 'auto';
    const split = mapping.debit >= 0 || mapping.credit >= 0;
    if (!split && mapping.amount >= 0) {
      const issuer = hasHeaderGuess ? detectIssuer(rows[0].join(' ').toLowerCase()) : null;
      amountSign = inferAmountSign(rows, hasHeaderGuess ? 1 : 0, mapping.amount, issuer && issuer.sign);
    } else if (split) amountSign = 'split';
    return {
      rows: rows.slice(0, 8),
      totalRows: rows.length,
      colCount: cols,
      delim,
      hasHeaderGuess,
      mapping,
      source,
      amountSign,
    };
  }

  function parseCSVWithMapping(content, opts) {
    opts = opts || {};
    const { rows } = readCSVRows(content);
    const hasHeader = !!opts.hasHeader;
    const start = hasHeader ? 1 : 0;
    const m = opts.mapping || {};
    const di = m.date, ni = m.description;
    const debitI = m.debit == null || m.debit < 0 ? -1 : m.debit;
    const creditI = m.credit == null || m.credit < 0 ? -1 : m.credit;
    const ai = m.amount == null || m.amount < 0 ? -1 : m.amount;
    const ci = m.cardmember == null || m.cardmember < 0 ? -1 : m.cardmember;

    if (di == null || di < 0) throw new Error('Map a Date column.');
    if (ni == null || ni < 0) throw new Error('Map a Description column.');
    const split = debitI >= 0 || creditI >= 0;
    if (!split && ai < 0) throw new Error('Map Amount or Charges/Payments columns.');

    let sign = opts.amountSign || 'auto';
    if (!split && ai >= 0) {
      if (sign === 'auto') {
        const issuer = hasHeader ? detectIssuer(rows[0].join(' ').toLowerCase()) : null;
        sign = inferAmountSign(rows, start, ai, issuer && issuer.sign);
      }
    }

    const transactions = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i]; if (!r || r.length < 2) continue;
      const date = normCSVDate(r[di]);
      if (!date) continue;
      let amount = null;
      if (split) {
        const d = debitI >= 0 ? parseAmount(r[debitI]) : null;
        const c = creditI >= 0 ? parseAmount(r[creditI]) : null;
        if (d) amount = -Math.abs(d);
        else if (c) amount = Math.abs(c);
        else continue;
      } else {
        const v = parseAmount(r[ai]); if (v == null) continue;
        amount = sign === 'charge-pos' ? -Math.abs(v) : v;
      }
      if (!isFinite(amount)) continue;
      transactions.push(mkTxn(amount, date, '', null, r[ni] || '', ci >= 0 ? r[ci] : ''));
    }

    if (!transactions.length) throw new Error('No transactions found with this column mapping.');
    return {
      currency: null, balance: null, balanceAsOf: null, transactions,
      source: opts.sourceLabel || 'CSV',
    };
  }

  function parseCSV(content) {
    const { rows } = readCSVRows(content);
    const hasHeader = detectHeaderRow(rows) === 0;
    const { mapping, source } = guessCSVMapping(rows, hasHeader);
    return parseCSVWithMapping(content, { hasHeader, mapping, sourceLabel: source, amountSign: 'auto' });
  }

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.parseQFX = parseQFX;
  global.Finalyze.parseCSV = parseCSV;
  global.Finalyze.previewCSV = previewCSV;
  global.Finalyze.parseCSVWithMapping = parseCSVWithMapping;
  global.Finalyze.guessCSVMapping = guessCSVMapping;
  global.Finalyze.csvColLabel = colLabel;
  global.Finalyze.normCSVDate = normCSVDate;
  global.Finalyze.parseAmount = parseAmount;
})(window);
