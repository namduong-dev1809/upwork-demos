# Demo 2 — Nightly Sales Summary Email

A sales Sheet becomes a daily email at the hour you choose (default 19:00, spreadsheet timezone): revenue, order count, units sold, top three products, and revenue change against the same weekday last week.

Built with Google Apps Script (no paid tools, no servers).

## What it shows a client

- **Automatic daily reporting** with Gmail-friendly styled HTML tables and a plain-text fallback.
- **Useful comparisons**: absolute and percentage revenue change against seven days earlier. A zero baseline displays `N/A: last week was zero`.
- **Nothing fails silently**: the email counts invalid rows across the entire sheet, including rows whose missing dates prevent bucketing.
- **Empty days stay visible**: a short “No sales today” email still includes totals, comparison, and skipped-row count. Turn off with the `Send when no sales` setting.
- **No code editing**: everything runs from the **Sales summary** menu and a **Settings** tab.
- **Manual access**: **Sales summary → Send summary now** sends today's report immediately.

## Files

| File | What it does |
|---|---|
| `src/Summary.js` | Pure logic: validate rows, validate sale days, total cents, rank products, compare weeks, render escaped HTML and plain text, parse and validate settings. |
| `src/Main.js` | Apps Script glue: setting defaults, Settings tab, menu, daily trigger, Sheet read, email. |
| `src/appsscript.json` | Manifest: V8 runtime, current spreadsheet/mail/trigger scopes. |
| `tests/summary.test.js` | Node tests for pure logic and mocked Apps Script wiring. |

## Set up (about 5 minutes, no code)

1. **Make a copy** of the template Sheet (File → Make a copy). The script comes with it.
2. Reload the copy. **Do not open Extensions.** Use the menu **Sales summary → Setup / re-run setup**.
3. **Approve the permissions.** Google shows "Google hasn't verified this app"; click **Advanced → Go to … (unsafe)**. This warning appears for any private script; it runs only inside your own Google account and sends mail only to the addresses you set.
4. **Fill the Settings tab** that setup created:

   | Setting | Meaning |
   |---|---|
   | `Recipients` | Email addresses, separated by commas. Required. |
   | `Send when no sales` | `TRUE` sends a short "No sales today" email; `FALSE` skips empty days. |
   | `Currency symbol` | e.g. `$` or `€`. Blank = `$` for English, `₫` for Vietnamese. |
   | `Language (en/vi)` | `en` or `vi` (Vietnamese text, VND format `105.000 ₫`, dates `20/11/2026`). |
   | `Send hour (0-23)` | Hour of the daily email. Default `19`. Re-run Setup after changing it. Use 22 or earlier: a run near midnight can start after the day ends and report an empty day. |

   Re-running Setup never overwrites values you entered; it only adds missing rows.
5. **Run the action:** **Sales summary → Send summary now** sends a test email. After that the email arrives daily.

The **Sales** tab must keep these headers in row 1, columns A–G:

```text
Date | Order ID | Customer | Product | Quantity | Unit Price | Total
```

All times (send hour, which day a sale belongs to) follow the spreadsheet's timezone in **File → Settings**. Enter real date or date-time cells, or date-only text such as `2026-11-20`; other date text is skipped and counted. Use the same order ID for several product lines of one order, and numeric prices without currency symbols. If something is wrong, the menu shows a plain-English message naming the tab or Settings row to fix.

Limits worth telling a client:

- Apps Script schedules approximately: `nearMinute(0)` can run about 15 minutes either side of the send hour. The report covers today's rows present at execution time; later sales are not included.
- Run Setup from one designated account; it owns the daily trigger. Apps Script cannot remove another account's triggers. Manual runs send again; there is no daily deduplication.
- Revenue uses **quantity × unit price rounded to integer cents**. The `Total` column is present for the sheet layout but is not read; discounts, taxes, and refunds are outside this demo. Use one currency with two decimal places.
- Order count means distinct nonempty order IDs for that day. Quantity must be a positive safe integer; price must be finite and nonnegative. Empty/malformed dates, missing order IDs/products, invalid numeric cells, and unsafe line amounts are skipped and counted. Customer is optional. Correct invalid rows in the Sheet and run again.
- Product revenue ties sort by product name. Date cells are converted to calendar days in the spreadsheet timezone; date-only text is taken as that day.
- Every run reads the entire tab. Large sheets can hit Apps Script runtime limits; MailApp has daily recipient quotas. Unsafe aggregate totals and service failures stop the run and appear in **Executions**; no success email is sent. Apps Script trigger failure notifications may also be available to the trigger owner.

## For developers

Paste `Summary.js`, `Main.js` and `appsscript.json` into the Sheet's bound project (or `clasp push` with your own `.clasp.json`, `rootDir: src`). Tests, from the repository root:

```bash
node --test demo-2-sales-summary/tests/*.test.js
```

Apps Script services are mocked; live authorization and mail delivery need a real Google account.
