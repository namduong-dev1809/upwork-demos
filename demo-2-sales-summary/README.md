# Demo 2 — Nightly Sales Summary Email

A sales Sheet becomes a daily email at about 19:00 Vietnam time: revenue, order count, units sold, top three products, and revenue change against the same weekday last week.

Built with Google Apps Script (no paid tools, no servers).

## What it shows a client

- **Automatic daily reporting** with an HTML table and a plain-text fallback.
- **Useful comparisons**: absolute and percentage revenue change against seven days earlier. A zero baseline displays `N/A: last week was zero`.
- **Nothing fails silently**: the email counts invalid rows across the entire sheet, including rows whose missing dates prevent bucketing.
- **Empty days stay visible**: a short “No sales today” email still includes totals, comparison, and skipped-row count. Disable with `SEND_WHEN_EMPTY: false`.
- **Manual access**: **Sales summary → Send summary now** sends today's report immediately.

## Files

| File | What it does |
|---|---|
| `src/Summary.js` | Pure logic: validate rows, bucket Vietnam dates, total cents, rank products, compare weeks, render escaped HTML and plain text. |
| `src/Main.js` | Apps Script glue: configuration, daily trigger, Sheet read, menu, email. |
| `src/appsscript.json` | Manifest: V8 runtime, Vietnam timezone, current spreadsheet/mail/trigger scopes. |
| `tests/summary.test.js` | Node tests for pure logic and mocked Apps Script wiring. |

## Set up (about 10 minutes)

1. Create a Google Sheet with a tab named **Sales**. Row 1 must contain these exact headers in columns A–G:
   ```text
   Date | Order ID | Customer | Product | Quantity | Unit Price | Total
   ```
2. Set the spreadsheet timezone to **Asia/Ho_Chi_Minh** in File → Settings. Enter real date cells or date-only text such as `2026-11-20`. Timestamp text must include an explicit offset, such as `2026-11-20T18:00:00+07:00`.
3. Add sales rows, for example `2026-11-20 | ORD-001 | Ann Lee | Widget | 3 | 19.99 | 59.97`. Use the same order ID for multiple product lines belonging to one order. Enter numeric prices without currency symbols.
4. Open Extensions → Apps Script. Copy in `Summary.js` and `Main.js`. In Project Settings enable “Show appsscript.json” and paste the manifest.
5. Replace `CONFIG.RECIPIENTS` with your email addresses. Set `CURRENCY` to the symbol for your sheet's currency. Leave `SEND_WHEN_EMPTY: true` unless empty days should be suppressed.
6. Run **setup** once and approve the permissions. It validates the headers and recipients, removes this account's existing `sendSummaryNow` triggers, and installs one daily trigger near 19:00 Vietnam time.
7. Run **sendSummaryNow** for a test email. Reload the Sheet to see the **Sales summary** menu. Add sales dated seven days earlier to demonstrate the comparison.

Limits worth telling a client:

- Apps Script schedules approximately: `nearMinute(0)` can run about 15 minutes either side of 19:00. The report covers today's rows present at execution time; later sales are not included.
- Run setup from one designated account. Apps Script cannot remove another account's triggers. Manual runs send again; there is no daily deduplication.
- Revenue uses **quantity × unit price rounded to integer cents**. The `Total` column is present for the sheet layout but is not read; discounts, taxes, and refunds are outside this demo. Use one currency with two decimal places.
- Order count means distinct nonempty order IDs for that day. Quantity must be a positive safe integer; price must be finite and nonnegative. Empty/malformed dates, missing order IDs/products, invalid numeric cells, and unsafe line amounts are skipped and counted. Customer is optional. Correct invalid rows in the Sheet and run again.
- Product revenue ties sort by product name. A date-only string means a Vietnam calendar date; ambiguous timestamp strings are rejected. All date bucketing uses UTC+07:00, independent of the host timezone.
- Every run reads the entire tab. Large sheets can hit Apps Script runtime limits; MailApp has daily recipient quotas. Unsafe aggregate totals and service failures stop the run and appear in **Executions**; no success email is sent. Apps Script trigger failure notifications may also be available to the trigger owner.

## Tests

From the repository root:

```bash
node --test demo-2-sales-summary/tests/*.test.js
```

Tests use explicit dates for date arithmetic and check totals, ranking, comparison, zero baselines, invalid rows, escaping, empty days, timezone boundaries, trigger wiring, and email/menu behavior. Apps Script services are mocked; live deployment and mail delivery require the setup above.
