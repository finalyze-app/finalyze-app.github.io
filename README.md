# Finalyze — Local Spending Analyzer

A single-page webapp that analyzes your bank and credit-card exports **entirely on your own
machine**. No server, no uploads, no network calls. Works offline.

## Run it

Either:

- **Double-click `index.html`** (the landing page) and click *Open app*, or open
  `app.html` directly, or
- From this folder run a tiny local server and visit http://localhost:8000

  ```sh
  python3 -m http.server
  ```

Then click **Import statement** (or drag the file onto the page) and pick your bank/card
export (`.qfx` / `.ofx` / `.csv`). A sample is in `sample/activity.qfx`.

## Host it online

The app is fully static — drop the whole folder onto **Netlify, Vercel, or GitHub Pages**
(no build step, no backend). Transactions still stay in the visitor's browser; the only
optional server is Supabase, used solely for accounts (see `SUPABASE_SETUP.md`). It also
ships a web manifest so visitors can **install it** as a standalone app.

## Branding

The logo and app icon live in `assets/` (`logo.svg`, `icon.svg`) and are referenced by the
sidebar, the favicon, and the install manifest. Replace those files to rebrand.

## What it shows

- **Summary** — total spend, refunds, net, transaction count, averages, statement balance.
- **Spend by category** — categories are derived from the merchant name (Amex exports have no
  category field). Rules live in `js/categorize.js` and are easy to extend.
- **Spend over time**, **top merchants**, and **spend by cardmember**.
- **Month over month** — per-month totals with deltas and the biggest category movers. This
  fills in as you import more statements.
- **Recurring & subscriptions** and **anomalies** (possible duplicates, large outliers).
- **Spending patterns** (by day of week / week of month), a **spend heatmap** calendar, and a **review-uncategorized** queue.
- **Compare periods** — pick two arbitrary date ranges and see side-by-side totals, plus
  per-category and top-merchant deltas.
- **Year in review** — appears once you have 12+ months of data; pick a year for category
  totals, biggest merchants, most expensive day, subscriptions, and year-over-year change.
- **Merchant drill-down** — click a bar in *Top merchants* (or a merchant name in the ledger)
  for a modal with that merchant's monthly trend, average ticket, category history and txns.
- **Transactions table** — search, filter by category, sort, reassign a merchant's category
  category edits (default: ask each time, one transaction, or all at merchant — in Settings → Categories), tag rows with reimbursable %/$, and **bulk recategorize** multiple merchants at once.

## Categorization, rules & budgets

- **Auto-categorization rules** (Settings → *Auto-categorization rules*): match merchant text
  with your own regular expressions and assign a category. Resolution order is: merchant
  override → your custom rules → built-in keyword rules → *Other*. A live tester shows what a
  given merchant name would resolve to.
- **Budgets** (Settings → *Monthly budgets*): set a monthly limit per **category group** or ungrouped category.
  Group limits apply to combined member spend. The Overview flags any budget at ≥80% (caution) or ≥100% (over) for the current calendar month.
- **Category groups** (Settings → *Category groups*): roll up categories (e.g. Dining + Groceries → Food). Toggle **Groups** on the category chart to see group slices; click to filter.
- **Suggested merchant merges** (Settings → *Merge merchants*): fuzzy matches like `AMAZON.CA` vs `AMAZON CA` — merge or dismiss.
- **Tags**: tag any transaction as **Business** and/or **Reimbursable** (set **%** or **$** when reimbursable). The header
  *Exclude tagged* toggle removes tagged transactions from spend totals and charts (showing
  "True spend") while keeping them visible in the ledger; Business/Reimbursable totals use the amount you configure.

## Accounts & CSV import

- **Multiple accounts**: each import can be assigned to an account (Settings → *Accounts*, or
  the prompt shown on import). When more than one account exists, an **account filter** appears
  in the header — pick one account or *All accounts* for household totals.
- **Imports & auto-detection**: Finalyze reads **OFX/QFX** (both modern 2.x XML *and* older
  1.x SGML exports) and **CSV** from most banks. The CSV reader auto-detects:
  - the **delimiter** (comma, semicolon, tab, or pipe),
  - the **header row** (skipping any bank preamble/metadata lines above it),
  - **columns** by name (Date — preferring "transaction" over "posted" — Description/Merchant/
    Payee, Amount, or separate **Debit/Credit** columns, and an optional Card Member),
  - the **amount-sign convention** — known issuers (American Express, Discover, Chase, Bank of
    America, Capital One) are matched by their header signature; for anything else the sign is
    inferred from the data (a mostly-negative file means negatives are spend), and accounting
    `(12.34)` negatives, `$`, and thousands separators are handled.
  Headerless CSVs are supported too (it infers the date, amount, and description columns). The
  detected format is shown in the import confirmation toast.

## Monthly workflow & memory

Import a new `.qfx` each month — new transactions are added to your history (deduped by
transaction id, so re-importing the same file is safe). When you reassign a merchant's
category in the table, that choice is **remembered** and auto-applied to all past and future
transactions of that merchant.

## Backups

All data is stored in your browser's **IndexedDB** (migrated automatically from older `localStorage` saves). Use **Export backup** to save a JSON copy,
and **Import backup** to restore it (e.g. on another browser/machine). A warning appears when data exceeds ~4 MB — export a backup before it grows further. **Clear data** wipes
everything from this machine.

## AI (optional, on-device)

The **Finalyze AI** button opens insights, an ask-your-data chat, and an auto-categorizer.
These are **opt-in**: the models download only when you click *Download & enable* in the
**Models** tab, then run entirely in your browser — your transactions are never sent anywhere.
Categorization uses a small embedding model (~30 MB); chat uses a WebLLM model (~1 GB, needs
WebGPU). The Insights tab also works without any model via locally-computed observations.

The chat is **strictly a spending-analysis tool** — it answers questions about your recorded
transactions (totals, categories, merchants, trends, subscriptions, month-over-month changes).
It deliberately does **not** answer affordability, budgeting, forecasting, or investment
questions, because the app only holds past spend data — not income, savings, or balances. Use
**Clear chat** to reset the conversation.

> **Secure context required:** the on-device AI uses WebGPU and Cache Storage, which browsers
> only expose over **HTTPS** or **localhost**. Over plain HTTP on a LAN IP, chat shows
> "No WebGPU" and model caching is disabled. GitHub Pages (HTTPS) works out of the box.

## Privacy

Your financial data never leaves your computer. By default there are no external requests —
Chart.js is bundled locally in `vendor/`. Two **optional** features reach the network only when
you choose to use them: (1) signing in (Supabase stores just your email/account settings — never
transactions), and (2) the first download of an AI model. After an AI model is cached, it runs
offline. IndexedDB is tied to the browser/origin you use, so open the app the same way
(always `file://` or always `localhost`) to keep one continuous history, and export a backup
before clearing browser data.
