// PDF statement import — extract text locally with PDF.js, parse transaction rows on-device.

(function (global) {
  const normCSVDate = (s) => global.Finalyze.normCSVDate(s);
  const parseAmount = (s) => global.Finalyze.parseAmount(s);

  const SKIP_LINE = /^(page\s+\d+|continued|statement\s+period|account\s+(number|summary)|opening\s+balance|closing\s+balance|previous\s+balance|new\s+balance|total\s+(charges|payments|amount)|subtotal|payment\s+due|minimum\s+payment|interest\s+charge|annual\s+fee|credit\s+limit|available\s+credit|transaction\s+date|posting\s+date|date\s+transaction|amount\s+\(\$|description|charges|payments|card\s+#|card\s+number)/i;
  // Reward/loyalty lines often carry an integer point value that must NOT be read
  // as a dollar amount (they'd look like refunds). Skip them outright.
  const SKIP_REWARDS = /(reward|loyalty|aeroplan|air\s?miles|points?\s+(earned|redeemed|balance|total)|(points|rewards?)\s+(earned|redeemed|balance|summary)|cash\s?back\s+(earned|reward))/i;
  // Summary/account lines that may carry a dollar amount but are NOT transactions.
  const SKIP_SUMMARY = /(credit\s+limit|available\s+credit|cash\s+advance\s+limit|credit\s+available|amount\s+due|minimum\s+payment|payment\s+due|previous\s+balance|new\s+balance|balance\s+forward|statement\s+balance|outstanding\s+balance|annual\s+interest|interest\s+rate|interest\s+charged?|finance\s+charge|over[- ]?limit|past\s+due|rewards?\s+balance)/i;

  // Detect the start of a transactions table (a column header / section title) and
  // the end (totals / summary blocks). Used to bound parsing to the activity section.
  function isSectionStart(line) {
    const l = line.toLowerCase();
    if (/\bdate\b/.test(l) && /(description|details|merchant|amount|transaction|activity|charges?)/.test(l)) return true;
    if (/^(your\s+)?(transactions|transaction\s+details|account\s+activity|card\s+activity|new\s+transactions|purchases\s+and\s+(adjustments|other)|activity\s+detail|détails?\s+des\s+op)/.test(l)) return true;
    return false;
  }
  function isSectionEnd(line) {
    const l = line.toLowerCase();
    return /\b(total\s+(new\s+)?(charges|purchases|payments|credits|for\b|for\s+this\s+period|of\b)|sub-?total|closing\s+balance|new\s+balance|previous\s+balance|balance\s+summary|interest\s+charges?|fees?\s+charged|payment\s+information|important\s+payment|how\s+(you\s+can|to)\s+avoid|minimum\s+payment|estimated\s+time|account\s+summary)\b/.test(l);
  }

  const MONTH = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  let yearHint = new Date().getFullYear();

  const pad2 = (n) => String(n).padStart(2, '0');

  // Parse month-name dates with an inferred year when the statement omits it:
  // "May 12", "May 12, 2026", "12 May 2026", "Sept. 3".
  function monthDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    let m;
    if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(s))) {
      const mo = MON[m[1].slice(0, 3).toLowerCase()];
      if (mo == null) return null;
      return `${m[3] ? +m[3] : yearHint}-${pad2(mo + 1)}-${pad2(m[2])}`;
    }
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?$/.exec(s))) {
      const mo = MON[m[2].slice(0, 3).toLowerCase()];
      if (mo == null) return null;
      return `${m[3] ? +m[3] : yearHint}-${pad2(mo + 1)}-${pad2(m[1])}`;
    }
    // Numeric MM/DD or DD/MM with NO year — use the inferred statement year
    // (prevents new Date("05/12") defaulting to 2001).
    if ((m = /^(\d{1,2})[-/](\d{1,2})$/.exec(s))) {
      let mo = +m[1], da = +m[2];
      if (mo > 12 && da <= 12) { const t = mo; mo = da; da = t; } // looked like DD/MM
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${yearHint}-${pad2(mo)}-${pad2(da)}`;
    }
    // Numeric MM/DD/YY (2-digit year) — assume 20YY.
    if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/.exec(s))) {
      let mo = +m[1], da = +m[2];
      if (mo > 12 && da <= 12) { const t = mo; mo = da; da = t; }
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `20${m[3]}-${pad2(mo)}-${pad2(da)}`;
    }
    return null;
  }

  // Only treat a token as money if it has cents (e.g. 12.34) — this prevents
  // integer reward-point totals like "2,450" from being parsed as amounts.
  function currencyAmount(s) {
    if (s == null) return null;
    if (!/\d\.\d{2}\)?\s*(cr|dr)?\s*$/i.test(String(s).trim()) && !/\d\.\d{2}/.test(String(s))) return null;
    if (!/\.\d{2}/.test(String(s))) return null;
    return parseAmount(s);
  }

  function mkTxn(amount, dateStr, name, cardmember) {
    return {
      fitid: '',
      date: dateStr,
      type: amount < 0 ? 'DEBIT' : 'CREDIT',
      amount,
      isSpend: amount < 0,
      spend: amount < 0 ? Math.abs(amount) : 0,
      refund: amount > 0 ? amount : 0,
      name: (name || '').trim() || 'Unknown',
      cardmember: cardmember || 'Unknown',
    };
  }

  function cardLabel(cell) {
    if (!cell) return 'Unknown';
    const digits = String(cell).replace(/\D/g, '');
    if (digits.length >= 4 && digits.length <= 19 && !/[a-z]/i.test(cell)) {
      return 'Card ••••' + digits.slice(-4);
    }
    return 'Unknown';
  }

  function pdfLib() {
    const lib = global.pdfjsLib || global['pdfjs-dist/build/pdf'];
    if (!lib) throw new Error('PDF library not loaded.');
    return lib;
  }

  function initWorker() {
    const lib = pdfLib();
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    }
  }

  async function extractRows(arrayBuffer) {
    initWorker();
    const lib = pdfLib();
    const pdf = await lib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const rows = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      rows.push(...groupTextItems(content.items));
    }
    return rows;
  }

  // Group PDF text fragments by Y position into left-to-right cells.
  function groupTextItems(items, yTol) {
    yTol = yTol == null ? 4 : yTol;
    const pts = [];
    items.forEach((item) => {
      const s = (item.str || '').trim();
      if (!s) return;
      pts.push({ str: s, x: item.transform[4], y: item.transform[5] });
    });
    pts.sort((a, b) => b.y - a.y || a.x - b.x);
    const bands = [];
    pts.forEach((pt) => {
      const band = bands.find((b) => Math.abs(b.y - pt.y) <= yTol);
      if (band) band.items.push(pt);
      else bands.push({ y: pt.y, items: [pt] });
    });
    return bands.map((b) => {
      b.items.sort((a, b) => a.x - b.x);
      return b.items.map((i) => i.str);
    });
  }

  function parseDateToken(s) {
    if (!s) return null;
    return monthDate(s) || normCSVDate(s) || normCSVDate(s.replace(/\./g, ''));
  }

  // Some statements (e.g. CIBC) append a "Spend Categories" column to the
  // description. Strip a trailing known category label so merchant names stay clean.
  const SPEND_CAT_TAIL = /\s+(Retail and Grocery|Health and Education|Professional and Financial Services|Home\s*&\s*Office Improvement|Foreign Currency Transactions|Travel\s*&\s*Entertainment|Personal and Household Expenses|Recurring Payments|Transportation|Restaurants)\s*$/i;
  function cleanName(name) {
    return (name || '').replace(SPEND_CAT_TAIL, '').replace(/\s+/g, ' ').trim();
  }

  function parseTableRow(cells) {
    if (!cells || cells.length < 2) return null;
    const line = cells.join(' ').trim();
    if (!line || SKIP_LINE.test(line) || SKIP_REWARDS.test(line) || SKIP_SUMMARY.test(line)) return null;

    // Find where the description starts. The date can be split across two cells
    // ("May" + "12"), and many statements have two leading dates (transaction +
    // posting) — skip the second so it doesn't land in the merchant name.
    let date = parseDateToken(cells[0]);
    let nameStart = 1;
    if (!date && cells.length >= 3) {
      const combo = parseDateToken(cells[0] + ' ' + cells[1]);
      if (combo) { date = combo; nameStart = 2; }
    }
    if (!date) return null;
    if (cells[nameStart] != null && parseDateToken(cells[nameStart])) nameStart++;

    const last = cells.length - 1;
    const lastIsCard = looksLikeCard(cells[last]);
    const amtEnd = lastIsCard ? last - 1 : last;      // index of the last amount cell

    // Two-column Charges | Payments layout: only when BOTH trailing cells are
    // currency amounts. (A single Amount column falls through to the loop below,
    // where the sign is inferred from payment/credit keywords.)
    const aEnd = currencyAmount(cells[amtEnd]);
    const aPrev = currencyAmount(cells[amtEnd - 1]);
    if (aEnd != null && aPrev != null && amtEnd - 1 >= nameStart) {
      const name = cleanName(cells.slice(nameStart, amtEnd - 1).join(' '));
      const cm = lastIsCard ? cardLabel(cells[last]) : 'Unknown';
      if (aPrev !== 0) return mkTxn(-Math.abs(aPrev), date, name, cm);   // charges column
      if (aEnd !== 0) return mkTxn(Math.abs(aEnd), date, name, cm);      // payments column
    }

    // Single Amount column: find the last currency cell; sign by keyword.
    for (let i = amtEnd; i >= nameStart; i--) {
      const amt = currencyAmount(cells[i]);
      if (amt == null) continue;
      const name = cleanName(cells.slice(nameStart, i).join(' '));
      if (!name) continue;
      return mkTxn(inferSignedAmount(amt, name, line), date, name, 'Unknown');
    }
    return null;
  }

  // A card-number cell: 4–19 digits, no letters, and no decimal point (so an
  // amount like "200.00" is never mistaken for a card number).
  function looksLikeCard(s) {
    if (/[.,]\d{2}\b/.test(String(s || ''))) return false;
    const digits = String(s || '').replace(/\D/g, '');
    return digits.length >= 4 && digits.length <= 19 && !/[a-z]/i.test(s);
  }

  function inferSignedAmount(amt, name, line) {
    if (amt < 0) return amt;
    if (/\b(payment|credit|refund|reversal|thank you|paiement|crédit|remboursement)\b/i.test(name + ' ' + line)) {
      return Math.abs(amt);
    }
    return -Math.abs(amt);
  }

  // Fallback when table columns merge into one line of text.
  function parseTextLine(line) {
    line = line.replace(/\s+/g, ' ').trim();
    if (!line || SKIP_LINE.test(line) || SKIP_REWARDS.test(line)) return null;

    const dateRe = new RegExp(
      '^(' +
      '\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{8}|' +
      '(?:' + MONTH + ')[a-z]*\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?' +
      ')\\s+(.+)$', 'i');
    const dm = dateRe.exec(line);
    if (!dm) return null;
    const date = parseDateToken(dm[1]);
    if (!date) return null;
    let rest = dm[2].trim();

    // Trailing amount (optional CR/DR)
    const am = rest.match(/^(.+?)\s+(\(?-?\$?\s*[\d,]+\.\d{2}\)?)\s*(CR|DR)?\s*$/i);
    if (am) {
      let amt = parseAmount(am[2]);
      if (amt == null) return null;
      if (am[3] && /^CR/i.test(am[3])) amt = Math.abs(amt);
      else if (am[3] && /^DR/i.test(am[3])) amt = -Math.abs(amt);
      else amt = inferSignedAmount(amt, am[1], line);
      return mkTxn(amt, date, am[1].trim(), 'Unknown');
    }

    // Two amounts at end (charges + payments)
    const split = rest.match(/^(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/);
    if (split) {
      const ch = parseAmount(split[2]);
      const pay = parseAmount(split[3]);
      const name = split[1].trim();
      if (ch && !pay) return mkTxn(-Math.abs(ch), date, name, 'Unknown');
      if (pay && !ch) return mkTxn(Math.abs(pay), date, name, 'Unknown');
    }
    return null;
  }

  function dedupeTxns(txns) {
    const seen = new Set();
    return txns.filter((t) => {
      const k = t.date + '|' + t.name + '|' + t.amount;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function parsePDF(arrayBuffer) {
    const rows = await extractRows(arrayBuffer);
    // Infer the statement year from any explicit 4-digit year in the text so
    // month-name dates without a year ("May 12") resolve correctly.
    const years = {};
    const maxYear = new Date().getFullYear() + 1;
    rows.forEach((c) => {
      const mm = c.join(' ').match(/\b(20\d{2})\b/g);
      if (mm) mm.forEach((y) => { const n = +y; if (n >= 2015 && n <= maxYear) years[y] = (years[y] || 0) + 1; });
    });
    const top = Object.keys(years).sort((a, b) => years[b] - years[a])[0];
    if (top) yearHint = +top;

    // Pass 1 — only parse rows inside an activity/transactions section. A section
    // header turns parsing on; a totals/summary line turns it off. This keeps
    // summary blocks (credit limit, balances, payment due, etc.) out.
    const sectioned = [];
    let inSection = false, sawHeader = false;
    rows.forEach((cells) => {
      const line = cells.join(' ').trim();
      if (!line) return;
      if (isSectionStart(line)) { inSection = true; sawHeader = true; return; }
      if (isSectionEnd(line)) { inSection = false; return; }
      if (!inSection) return;
      const t = parseTableRow(cells);
      if (t) sectioned.push(t);
    });

    // Pass 2 — fallback: if no section headers were found (or they yielded too
    // little), parse the whole document. The per-row SKIP_* guards still apply.
    let txns = sectioned;
    if (!sawHeader || txns.length < 3) {
      txns = [];
      rows.forEach((cells) => { const t = parseTableRow(cells); if (t) txns.push(t); });
    }

    // Line fallback on joined rows when table parse found little
    if (txns.length < 3) {
      const lines = rows.map((r) => r.join(' ').trim()).filter(Boolean);
      lines.forEach((line) => {
        const t = parseTextLine(line);
        if (t) txns.push(t);
      });
    }

    // A real transaction has a merchant description with letters — drop rows whose
    // "description" is empty, numeric, or the Unknown fallback (summary figures,
    // account numbers, balances that slipped through).
    txns = txns.filter((t) => /[A-Za-z]{2,}/.test(t.name || '') && !/^unknown$/i.test((t.name || '').trim()));

    const transactions = dedupeTxns(txns);
    if (!transactions.length) {
      throw new Error('No transactions found in PDF. Try CSV/OFX export if available, or check the statement has a text layer (not a scanned image).');
    }
    return {
      currency: null,
      balance: null,
      balanceAsOf: null,
      transactions,
      source: 'PDF',
    };
  }

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.parsePDF = parsePDF;
})(window);
