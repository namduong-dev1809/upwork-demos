# Demo 3 — Inventory → Low-stock Digest → Reorder Requests

A scheduled check (every 1–12 hours) reads an inventory Sheet and sends one digest of newly low SKUs, including suggested reorder quantities. Each row shows its status. A SKU alerts again only after a valid recovery above its reorder point followed by another drop.

Built with Google Apps Script (no paid tools, no servers).

## What it shows a client

- **No repeated alerts while stock stays low**: Script Properties remembers each alerted SKU and its alert date.
- **Actionable digest**: `On Hand <= Reorder Point` triggers an alert with the configured `Reorder Qty`.
- **Bad rows do not block good rows**: missing or duplicate SKUs and invalid counts show `ERROR: <reason>`.
- **Optional supplier requests**: one draft-style email per valid supplier address, grouping their newly low SKUs. Disabled by default.
- **Safe overlap**: a script lock serializes manual and scheduled checks. Sheet text is HTML-escaped in emails.

## Set up (about 5 minutes, no code)

1. Open the template link and choose **File → Make a copy**. The script comes with the copy.
2. **No need to open Extensions.** Reload your copy, then use the menu **Stock Alerts → Setup / re-run setup**.
3. Approve the permissions. Google may show "Google hasn't verified this app": click **Advanced → Go to … (unsafe)**. The warning appears because this is your own private copy, not a published app; the script runs only inside your own Google account.
4. Fill the **Settings** tab (Setup creates it, and the **Inventory** tab with 2 sample rows if they are missing):

   | Setting | What to enter |
   |---|---|
   | `Recipients` | Who gets the digest. Separate several emails with commas. Required. |
   | `Email suppliers (TRUE/FALSE)` | `TRUE` also emails each supplier a draft reorder request. Default `FALSE`. |
   | `Check every N hours (1,2,4,6,8,12)` | How often the automatic check runs. Default `1`. Re-run Setup after changing it. |

   Inventory columns A–F must stay: `SKU | Product | On Hand | Reorder Point | Reorder Qty | Supplier Email`. Use unique SKUs. Counts must be nonnegative numbers; `Reorder Qty` must be greater than zero.
5. Choose **Stock Alerts → Check stock now**. A dialog reports what happened. Row statuses appear in **Alert Status**: `OK`, `LOW (alerted YYYY-MM-DD)`, or `ERROR: <reason>`. Dates use your spreadsheet's time zone (**File → Settings**).

Running Setup again is safe: it never overwrites values you typed in Settings, only adds missing rows, and keeps exactly one automatic check. If a setting is missing or invalid, the dialog names the Settings row to fix.

Try it: run the check again while stock stays low: no new email. Raise stock above the reorder point and check; lower it again and check: a new digest arrives.

With `Email suppliers` set to `TRUE`, each valid supplier gets one email per newly low event, subject **DRAFT: Inventory reorder request**, asking for availability and pricing. These are sent emails, not Gmail drafts or purchase orders. Invalid supplier addresses are skipped and logged; they do not block the owner digest. Already-alerted SKUs are not emailed when you turn this on.

## Limits worth telling a client

- Scheduled checks run approximately on time, not at an exact minute. A recovery must be observed by a check to reset an alert.
- Invalid rows, removed rows, and duplicate SKUs retain prior alert state until a valid row shows recovery. Fix errors and run the check again. Blank inventory rows are marked as missing SKU. Keep SKUs stable; a renamed SKU is a new item.
- `Reorder Qty` is the Sheet's suggested quantity, not an automatic purchase. Fractional counts are allowed.
- MailApp recipient quotas and Apps Script runtime/storage quotas apply. Alert state is stored in one Script Property (9 KB value limit); this demo fits a small inventory. Retained state for removed SKUs also uses that space.
- Digest failures throw an error in Executions and leave state uncommitted for the next check. Supplier failures are logged per supplier and do not retry automatically, preserving owner digest suppression.
- Email delivery and Script Properties cannot form one transaction. If delivery succeeds but saving state fails, a later run may repeat the email. Sheet status writes can also fail after state is saved. Check Executions after any failed run; no exactly-once delivery guarantee.
- Automatic checks report errors in Apps Script **Executions** (and Google's failure emails), not in a dialog. Alert dates follow the spreadsheet's own time zone (**File → Settings → Time zone**); set it before the first check.
- Run Setup under one owner account; Apps Script exposes only that account's installed triggers.

## For developers

| File | What it does |
|---|---|
| `src/Stock.js` | Pure logic: validation, low/recovery state, supplier grouping, Settings parsing, inline-styled escaped emails. |
| `src/Main.js` | Apps Script glue: menu, Setup, Settings and Inventory tabs, trigger, Script Properties, lock, email. |
| `src/appsscript.json` | Manifest: V8, current spreadsheet, mail and trigger scopes. |
| `tests/stock.test.js` | Node tests for pure logic and service-faked Apps Script integration. |

Copy the `src/` files into the Sheet's bound script (or use clasp with your own `.clasp.json`). Helpers end in `_` so the editor's Run list shows only entry points. Tests use local fakes, so live authorization, triggers, quotas and delivery need a real Sheet:

```bash
node --test demo-3-low-stock-alert/tests/*.test.js
```
