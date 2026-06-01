// Pure aggregations over enriched transactions.
// Each txn is expected to already have: category, merchantKey (set by app.js).

(function (global) {
  const monthKey = (d) => d.slice(0, 7); // YYYY-MM
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

  function median(nums) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function summary(txns) {
    const debits = txns.filter((t) => t.isSpend);
    const payments = txns.filter((t) => t.flow === 'payment');
    const refundRows = txns.filter((t) => t.flow === 'refund');
    const spends = debits.map((t) => t.spend);
    const totalSpend = sum(debits, (t) => t.spend);
    const totalPayments = sum(payments, (t) => t.payment);
    const totalRefunds = sum(refundRows, (t) => t.refund);
    const dates = txns.map((t) => t.date).sort();
    return {
      count: txns.length,
      debitCount: debits.length,
      creditCount: payments.length + refundRows.length,
      totalSpend,
      totalPayments,
      totalRefunds,
      net: totalSpend - totalRefunds,
      avgSpend: debits.length ? totalSpend / debits.length : 0,
      medianSpend: median(spends),
      largest: [...debits].sort((a, b) => b.spend - a.spend).slice(0, 5),
      dateFrom: dates[0] || null,
      dateTo: dates[dates.length - 1] || null,
    };
  }

  function byCardmember(txns) {
    const map = {};
    for (const t of txns) {
      const k = t.cardmember;
      (map[k] = map[k] || { cardmember: k, spend: 0, count: 0 });
      map[k].spend += t.spend;
      map[k].count += 1;
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend);
  }

  function byCategory(txns) {
    const map = {};
    for (const t of txns) {
      if (!t.isSpend) continue;
      (map[t.category] = map[t.category] || { category: t.category, spend: 0, count: 0 });
      map[t.category].spend += t.spend;
      map[t.category].count += 1;
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend);
  }

  function byMerchant(txns, topN = 12) {
    const map = {};
    for (const t of txns) {
      if (!t.isSpend) continue;
      const k = t.merchantKey;
      (map[k] = map[k] || { merchant: k, spend: 0, count: 0 });
      map[k].spend += t.spend;
      map[k].count += 1;
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend).slice(0, topN);
  }

  // Spend per day, sorted ascending; for the trend line.
  function spendOverTime(txns) {
    const map = {};
    for (const t of txns) {
      if (!t.isSpend) continue;
      map[t.date] = (map[t.date] || 0) + t.spend;
    }
    return Object.keys(map).sort().map((d) => ({ date: d, spend: map[d] }));
  }

  // Spend over time split into one series per top-N merchant (for a multi-line chart).
  function topMerchantsOverTime(txns, topN = 5) {
    const top = byMerchant(txns, topN).map((m) => m.merchant);
    const idx = Object.fromEntries(top.map((m, i) => [m, i]));
    const dates = [...new Set(txns.filter((t) => t.isSpend).map((t) => t.date))].sort();
    const byDate = top.map(() => ({}));
    for (const t of txns) {
      if (!t.isSpend || !(t.merchantKey in idx)) continue;
      const b = byDate[idx[t.merchantKey]];
      b[t.date] = (b[t.date] || 0) + t.spend;
    }
    return {
      labels: dates,
      series: top.map((m, i) => ({ merchant: m, data: dates.map((d) => byDate[i][d] || 0) })),
    };
  }

  // Spend over time split into one series per top-N category.
  function topCategoriesOverTime(txns, topN = 5) {
    const top = byCategory(txns).slice(0, topN).map((c) => c.category);
    const idx = Object.fromEntries(top.map((c, i) => [c, i]));
    const dates = [...new Set(txns.filter((t) => t.isSpend).map((t) => t.date))].sort();
    const byDate = top.map(() => ({}));
    for (const t of txns) {
      if (!t.isSpend || !(t.category in idx)) continue;
      const b = byDate[idx[t.category]];
      b[t.date] = (b[t.date] || 0) + t.spend;
    }
    return {
      labels: dates,
      series: top.map((c, i) => ({ category: c, data: dates.map((d) => byDate[i][d] || 0) })),
    };
  }

  // Month-over-month: per-month totals + per-category, with deltas vs previous month.
  function monthOverMonth(txns) {
    const months = {};
    for (const t of txns) {
      const mk = monthKey(t.date);
      const m = (months[mk] = months[mk] || { month: mk, spend: 0, payments: 0, refunds: 0, byCategory: {} });
      m.spend += t.spend;
      m.payments += (t.payment || 0);
      m.refunds += (t.flow === 'refund' ? t.refund : 0);
      if (t.isSpend) m.byCategory[t.category] = (m.byCategory[t.category] || 0) + t.spend;
    }
    const ordered = Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
    ordered.forEach((m, i) => {
      m.net = m.spend - m.refunds;
      if (i > 0) {
        const prev = ordered[i - 1];
        m.deltaSpend = m.spend - prev.spend;
        m.pctSpend = prev.spend ? (m.deltaSpend / prev.spend) * 100 : null;
      } else {
        m.deltaSpend = null;
        m.pctSpend = null;
      }
    });
    return ordered;
  }

  // Biggest category movers between the last two months.
  function categoryMovers(mom) {
    if (mom.length < 2) return [];
    const cur = mom[mom.length - 1].byCategory;
    const prev = mom[mom.length - 2].byCategory;
    const cats = new Set([...Object.keys(cur), ...Object.keys(prev)]);
    const movers = [];
    for (const c of cats) {
      const delta = (cur[c] || 0) - (prev[c] || 0);
      movers.push({ category: c, current: cur[c] || 0, previous: prev[c] || 0, delta });
    }
    return movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  // Stable key for a recurring group: same merchant + same exact charge.
  const subKey = (merchantKey, amount) => merchantKey + '||' + Number(amount).toFixed(2);
  const isAmazon = (t) => t.category === 'Online/Amazon' || /AMZN|AMAZON/i.test(t.merchantKey);

  // Compile keyword/regex subscription rules once; test against the raw name and
  // the normalized merchant key.
  function compileSubRules(rules) {
    return (rules || []).map((r) => {
      try { return new RegExp(r.pattern, r.flags || 'i'); } catch (e) { return null; }
    }).filter(Boolean);
  }
  function matchesSubRule(t, compiled) {
    if (!compiled || !compiled.length) return false;
    const hay = (t.name || '') + ' ' + (t.merchantKey || '');
    return compiled.some((re) => re.test(hay));
  }

  // Recurring: identical merchant + identical charge appearing 2+ times, OR a
  // group the user marked as a subscription, OR any merchant matched by a
  // subscription keyword rule (grouped by merchant, any amount). Amazon excluded
  // from the amount-based detection but a keyword rule can still include it.
  function recurring(txns, subs, subRules) {
    subs = subs || {};
    const compiled = compileSubRules(subRules);
    const map = {};        // exact merchant+amount groups
    const kw = {};         // keyword-rule groups, keyed by merchant (any amount)
    for (const t of txns) {
      if (!t.isSpend) continue;
      if (matchesSubRule(t, compiled)) {
        const m = (kw[t.merchantKey] = kw[t.merchantKey] || {
          key: 'kw||' + t.merchantKey, merchant: t.merchantKey, category: t.category,
          amounts: [], months: new Set(), dates: [], count: 0,
        });
        m.amounts.push(t.spend);
        m.months.add(monthKey(t.date));
        m.dates.push(t.date);
        m.count += 1;
        m.category = t.category;
        continue; // keyword match takes precedence over exact-amount grouping
      }
      if (isAmazon(t)) continue;
      const key = subKey(t.merchantKey, t.spend);
      const m = (map[key] = map[key] || {
        key, merchant: t.merchantKey, category: t.category,
        amount: t.spend, months: new Set(), dates: [], count: 0,
      });
      m.months.add(monthKey(t.date));
      m.dates.push(t.date);
      m.count += 1;
      m.category = t.category;
    }
    const exact = Object.values(map)
      .filter((m) => m.count >= 2 || subs[m.key])
      .map((m) => ({
        key: m.key, merchant: m.merchant, category: m.category,
        amount: m.amount, varies: false, months: m.months.size, count: m.count,
        lastDate: m.dates.sort()[m.dates.length - 1], marked: !!subs[m.key], byRule: false,
      }));
    const keyword = Object.values(kw).map((m) => {
      const uniq = [...new Set(m.amounts.map((a) => Number(a).toFixed(2)))];
      const lastIdx = m.dates.map((d, i) => [d, i]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).pop()[1];
      return {
        key: m.key, merchant: m.merchant, category: m.category,
        amount: m.amounts[lastIdx], varies: uniq.length > 1, months: m.months.size,
        count: m.count, lastDate: m.dates.slice().sort().pop(), marked: true, byRule: true,
      };
    });
    return exact.concat(keyword).sort((a, b) => b.count - a.count || b.amount - a.amount);
  }

  // Anomalies: duplicates (same merchant+amount within 3 days) and category outliers.
  // `isSub` is an optional predicate (t) => bool; matching transactions (recurring
  // subscriptions) are excluded from anomaly detection.
  function anomalies(txns, isSub) {
    const out = [];
    const skip = typeof isSub === 'function' ? isSub : () => false;

    // Duplicates
    const debits = txns.filter((t) => t.isSpend && !skip(t));
    for (let i = 0; i < debits.length; i++) {
      for (let j = i + 1; j < debits.length; j++) {
        const a = debits[i], b = debits[j];
        if (a.merchantKey !== b.merchantKey) continue;
        if (Math.abs(a.spend - b.spend) > 0.001) continue;
        const days = Math.abs((new Date(a.date) - new Date(b.date)) / 86400000);
        if (days <= 3) {
          out.push({
            type: 'Possible duplicate',
            date: b.date,
            merchant: b.merchantKey,
            amount: b.spend,
            reason: `Same merchant & amount as ${a.date} (${days.toFixed(0)}d apart)`,
          });
        }
      }
    }

    // Category outliers: spend > mean + 3*stdev within its category.
    const byCat = {};
    for (const t of debits) (byCat[t.category] = byCat[t.category] || []).push(t);
    for (const cat in byCat) {
      const arr = byCat[cat];
      if (arr.length < 4) continue;
      const vals = arr.map((t) => t.spend);
      const mean = vals.reduce((a, x) => a + x, 0) / vals.length;
      const variance = vals.reduce((a, x) => a + (x - mean) ** 2, 0) / vals.length;
      const std = Math.sqrt(variance);
      const threshold = mean + 3 * std;
      for (const t of arr) {
        if (t.spend > threshold && t.spend > mean * 1.5) {
          out.push({
            type: 'Large outlier',
            date: t.date,
            merchant: t.merchantKey,
            amount: t.spend,
            reason: `${cat}: ${t.spend.toFixed(2)} vs avg ${mean.toFixed(2)}`,
          });
        }
      }
    }

    return out.sort((a, b) => b.amount - a.amount);
  }

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function byDayOfWeek(txns) {
    const totals = [0, 0, 0, 0, 0, 0, 0];
    for (const t of txns) {
      if (!t.isSpend) continue;
      const d = new Date(t.date + 'T12:00:00');
      totals[d.getDay()] += t.spend;
    }
    return DOW_LABELS.map((label, i) => ({ label, spend: totals[i] }));
  }

  function byWeekOfMonth(txns) {
    const totals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const t of txns) {
      if (!t.isSpend) continue;
      const day = Number(t.date.slice(8, 10));
      const week = Math.min(5, Math.ceil(day / 7));
      totals[week] += t.spend;
    }
    return [1, 2, 3, 4, 5].map((w) => ({ week: w, label: 'Wk ' + w, spend: totals[w] }));
  }

  // Distinct calendar months present in the data.
  function monthSpan(txns) {
    return new Set(txns.map((t) => monthKey(t.date))).size;
  }
  function yearsPresent(txns) {
    return [...new Set(txns.map((t) => t.date.slice(0, 4)))].sort();
  }

  // ---- Feature 5: compare two arbitrary periods ----
  function comparePeriods(txnsA, txnsB) {
    const sa = summary(txnsA), sb = summary(txnsB);
    const catA = {}, catB = {};
    byCategory(txnsA).forEach((c) => { catA[c.category] = c.spend; });
    byCategory(txnsB).forEach((c) => { catB[c.category] = c.spend; });
    const cats = [...new Set([...Object.keys(catA), ...Object.keys(catB)])];
    const categories = cats.map((c) => ({ category: c, a: catA[c] || 0, b: catB[c] || 0, delta: (catB[c] || 0) - (catA[c] || 0) }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const merA = {}, merB = {};
    byMerchant(txnsA, 9999).forEach((m) => { merA[m.merchant] = m.spend; });
    byMerchant(txnsB, 9999).forEach((m) => { merB[m.merchant] = m.spend; });
    const mers = [...new Set([...Object.keys(merA), ...Object.keys(merB)])];
    const merchants = mers.map((m) => ({ merchant: m, a: merA[m] || 0, b: merB[m] || 0, delta: (merB[m] || 0) - (merA[m] || 0) }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 12);
    return { a: sa, b: sb, categories, merchants };
  }

  // ---- Feature 6: year in review ----
  function yearInReview(txns, year) {
    const inYear = (y) => txns.filter((t) => t.date.slice(0, 4) === String(y));
    const cur = inYear(year);
    const prev = inYear(Number(year) - 1);
    const s = summary(cur);
    const categories = byCategory(cur);
    const merchants = byMerchant(cur, 10);
    // Most expensive single day (by spend).
    const byDay = {};
    cur.forEach((t) => { if (t.isSpend) byDay[t.date] = (byDay[t.date] || 0) + t.spend; });
    let bigDay = null;
    Object.keys(byDay).forEach((d) => { if (!bigDay || byDay[d] > bigDay.spend) bigDay = { date: d, spend: byDay[d] }; });
    const subs = recurring(cur, {});
    const subsTotal = subs.reduce((a, r) => a + r.amount * r.count, 0);
    const prevSpend = summary(prev).totalSpend;
    const yoyDelta = s.totalSpend - prevSpend;
    const yoyPct = prevSpend ? (yoyDelta / prevSpend) * 100 : null;
    return {
      year: String(year), totalSpend: s.totalSpend, count: s.count,
      categories, merchants, biggestDay: bigDay, subsTotal,
      prevSpend, yoyDelta, yoyPct, hasPrev: prev.length > 0,
    };
  }

  // ---- Fuzzy merchant merge suggestions ----
  function compareKey(key) {
    return (key || '').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+\d[\d\s]*$/, '').replace(/\s+/g, ' ').trim();
  }

  function pairKey(a, b) { return [a, b].sort().join('||'); }

  function levenshteinRatio(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return 1 - dp[m][n] / Math.max(m, n);
  }

  function sharedTokenPrefix(a, b) {
    const ta = a.split(' ').filter(Boolean), tb = b.split(' ').filter(Boolean);
    if (!ta.length || !tb.length || ta[0] !== tb[0] || ta[0].length < 4) return false;
    return true;
  }

  function canonicalOf(key, merges) {
    merges = merges || {};
    const seen = new Set();
    while (merges[key] && !seen.has(key)) { seen.add(key); key = merges[key]; }
    return key;
  }

  function suggestMerchantMerges(merchantStats, merges, dismissals) {
    merges = merges || {};
    dismissals = dismissals || {};
    const stats = merchantStats.filter((m) => m.count >= 2);
    const suggestions = [];
    for (let i = 0; i < stats.length; i++) {
      for (let j = i + 1; j < stats.length; j++) {
        const a = stats[i], b = stats[j];
        if (a.key === b.key) continue;
        if (canonicalOf(a.key, merges) === canonicalOf(b.key, merges)) continue;
        const pk = pairKey(a.key, b.key);
        if (dismissals[pk]) continue;
        const ca = compareKey(a.key), cb = compareKey(b.key);
        let score = 0;
        if (ca && ca === cb) score = 1;
        else if (sharedTokenPrefix(ca, cb)) score = 0.85;
        else if (ca && cb && levenshteinRatio(ca, cb) >= 0.88) score = 0.8;
        if (!score) continue;
        suggestions.push({
          a: a.key, b: b.key, score,
          combined: a.spend + b.spend,
          pairKey: pk,
        });
      }
    }
    return suggestions.sort((x, y) => y.combined - x.combined || y.score - x.score).slice(0, 12);
  }

  // ---- Heatmap calendar ----
  function dailySpendMap(txns) {
    const map = {};
    for (const t of txns) {
      if (!t.isSpend) continue;
      map[t.date] = (map[t.date] || 0) + t.spend;
    }
    return map;
  }

  function heatmapMonths(dailyMap, dateFrom, dateTo) {
    const months = new Set();
    Object.keys(dailyMap).forEach((d) => {
      if (dateFrom && d < dateFrom) return;
      if (dateTo && d > dateTo) return;
      months.add(d.slice(0, 7));
    });
    return [...months].sort().map((month) => {
      const [y, m] = month.split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      const lastDay = new Date(y, m, 0).getDate();
      const weeks = [];
      let week = [];
      for (let i = 0; i < first.getDay(); i++) week.push(null);
      for (let day = 1; day <= lastDay; day++) {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        if (dateFrom && date < dateFrom) { week.push(null); }
        else if (dateTo && date > dateTo) { week.push(null); }
        else week.push({ date, spend: dailyMap[date] || 0 });
        if (week.length === 7) { weeks.push(week); week = []; }
      }
      if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }
      return { month, label: first.toLocaleString(undefined, { month: 'long', year: 'numeric' }), weeks };
    });
  }

  // ---- Category groups rollup ----
  function byCategoryGroup(txns, groups) {
    groups = groups || [];
    const map = {};
    for (const t of txns) {
      if (!t.isSpend) continue;
      const g = groups.find((x) => x.categories.includes(t.category));
      const key = g ? g.name : t.category;
      const row = (map[key] = map[key] || {
        category: key, spend: 0, count: 0, isGroup: !!g, color: g ? g.color : null,
      });
      row.spend += t.spend;
      row.count += 1;
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend);
  }

  // ---- Feature 7: single-merchant detail ----
  function merchantDetail(txns, merchantKey) {
    const rows = txns.filter((t) => t.merchantKey === merchantKey);
    const spendRows = rows.filter((t) => t.isSpend);
    const total = sum(spendRows, (t) => t.spend);
    const monthsMap = {};
    spendRows.forEach((t) => { const mk = monthKey(t.date); monthsMap[mk] = (monthsMap[mk] || 0) + t.spend; });
    const monthly = Object.keys(monthsMap).sort().map((m) => ({ month: m, spend: monthsMap[m] }));
    const catMap = {};
    rows.forEach((t) => { catMap[t.category] = (catMap[t.category] || 0) + 1; });
    const categories = Object.keys(catMap).map((c) => ({ category: c, count: catMap[c] })).sort((a, b) => b.count - a.count);
    return {
      merchant: merchantKey, count: rows.length, total,
      avg: spendRows.length ? total / spendRows.length : 0,
      monthly, categories,
      txns: [...rows].sort((a, b) => b.date.localeCompare(a.date)),
    };
  }

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.analyze = {
    summary, byCardmember, byCategory, byMerchant, spendOverTime,
    monthOverMonth, categoryMovers, recurring, anomalies, subKey,
    compileSubRules, matchesSubRule, topMerchantsOverTime, topCategoriesOverTime,
    byDayOfWeek, byWeekOfMonth,
    monthSpan, yearsPresent, comparePeriods, yearInReview, merchantDetail,
    suggestMerchantMerges, dailySpendMap, heatmapMonths, byCategoryGroup, pairKey,
  };
})(window);
