// PDF statement import — extract text locally with PDF.js, parse transaction rows on-device.

(function (global) {
  const normCSVDate = (s) => global.Finalyze.normCSVDate(s);
  const parseAmount = (s) => global.Finalyze.parseAmount(s);

  const SKIP_LINE = /^(page\s+\d+|continued|statement\s+period|account\s+(number|summary)|opening\s+balance|closing\s+balance|previous\s+balance|new\s+balance|total\s+(charges|payments|amount)|subtotal|payment\s+due|minimum\s+payment|interest\s+charge|annual\s+fee|credit\s+limit|available\s+credit|transaction\s+date|posting\s+date|date\s+transaction|amount\s+\(\$|description|charges|payments|card\s+#|card\s+number)/i;
  const MONTH = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

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
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
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
    return normCSVDate(s) || normCSVDate(s.replace(/\./g, ''));
  }

  function splitChargePayment(cells, date, nameStart, nameEnd) {
    const name = cells.slice(nameStart, nameEnd).join(' ').trim();
    const ch = parseAmount(cells[nameEnd]);
    const pay = parseAmount(cells[nameEnd + 1]);
    const card = cells[nameEnd + 2];
    const cm = cardLabel(card);
    if (ch != null && ch !== 0) return mkTxn(-Math.abs(ch), date, name, cm);
    if (pay != null && pay !== 0) return mkTxn(Math.abs(pay), date, name, cm);
    return null;
  }

  function parseTableRow(cells) {
    if (!cells || cells.length < 2) return null;
    const line = cells.join(' ').trim();
    if (!line || SKIP_LINE.test(line)) return null;

    const date = parseDateToken(cells[0]);
    if (!date) return null;

    // CIBC-style: Date | Description | Charges | Payments | Card #
    if (cells.length >= 4) {
      const ch = parseAmount(cells[cells.length - 2]);
      const pay = parseAmount(cells[cells.length - 1]);
      const lastIsCard = cells.length >= 5 && looksLikeCard(cells[cells.length - 1]);
      if (lastIsCard) {
        const txn = splitChargePayment(cells, date, 1, cells.length - 3);
        if (txn) return txn;
      }
      if ((ch != null && ch !== 0) || (pay != null && pay !== 0)) {
        if (ch != null && ch !== 0 && (pay == null || pay === 0)) {
          return mkTxn(-Math.abs(ch), date, cells.slice(1, -1).join(' ').trim(), cardLabel(cells[cells.length - 1]));
        }
        if (pay != null && pay !== 0 && (ch == null || ch === 0)) {
          return mkTxn(Math.abs(pay), date, cells.slice(1, -1).join(' ').trim(), cardLabel(cells[cells.length - 1]));
        }
      }
    }

    // Date | Description | Amount
    for (let i = cells.length - 1; i >= 1; i--) {
      const amt = parseAmount(cells[i]);
      if (amt == null) continue;
      const name = cells.slice(1, i).join(' ').trim();
      if (!name) continue;
      const signed = inferSignedAmount(amt, name, line);
      return mkTxn(signed, date, name, 'Unknown');
    }
    return null;
  }

  function looksLikeCard(s) {
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
    if (!line || SKIP_LINE.test(line)) return null;

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
    const txns = [];
    rows.forEach((cells) => {
      const t = parseTableRow(cells);
      if (t) txns.push(t);
    });

    // Line fallback on joined rows when table parse found little
    if (txns.length < 3) {
      const lines = rows.map((r) => r.join(' ').trim()).filter(Boolean);
      lines.forEach((line) => {
        const t = parseTextLine(line);
        if (t) txns.push(t);
      });
    }

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
