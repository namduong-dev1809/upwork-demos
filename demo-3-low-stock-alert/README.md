# Demo 3 — Inventory → Low-stock Digest → Reorder Requests

An hourly check reads an inventory Sheet and sends one digest of newly low SKUs, including suggested reorder quantities. Each row shows its status. A SKU alerts again only after a valid recovery above its reorder point followed by another drop.

Built with Google Apps Script (no paid tools, no servers).

## What it shows a client

- **No repeated alerts while stock stays low**: Script Properties remembers each alerted SKU and its alert date.
- **Actionable digest**: `On Hand <= Reorder Point` triggers an alert with the configured `Reorder Qty`.
- **Bad rows do not block good rows**: missing or duplicate SKUs and invalid counts show `ERROR: <reason>`.
- **Optional supplier requests**: one draft-style email per valid supplier address, grouping their newly low SKUs. Disabled by default.
- **Safe overlap**: a script lock serializes manual and scheduled checks. Sheet text is HTML-escaped in emails.

## Files

| File | What it does |
|---|---|
| `src/Stock.js` | Pure validation, low/recovery state transitions, supplier grouping, and escaped email content. |
| `src/Main.js` | Apps Script glue: hourly trigger, menu, Sheet access, Script Properties, lock, email and statuses. |
| `src/appsscript.json` | Manifest: V8 runtime, Asia/Ho_Chi_Minh timezone, current spreadsheet, mail and trigger scopes. |
| `tests/stock.test.js` | Node tests for pure logic and service-faked Apps Script integration. |

## Set up (about 10 minutes)

1. Create a Google Sheet with a tab named **`Inventory`**. Put these exact headers in columns A–F:

   ```text
   SKU | Product | On Hand | Reorder Point | Reorder Qty | Supplier Email
   ```

   Example row: `W-001 | Widget | 5 | 5 | 20 | supplier@example.com`.
   Use unique, case-sensitive SKUs. Counts must be finite, nonnegative numbers; `Reorder Qty` must be greater than zero. Numeric strings are accepted. Surrounding SKU whitespace is ignored.
2. Open **Extensions → Apps Script** from this Sheet. Copy `Stock.js` and `Main.js` into script files. Enable **Show appsscript.json** in Project Settings and paste the manifest.
3. Set `CONFIG.RECIPIENTS` to an array of real recipient addresses, for example `['owner@yourcompany.com']`. Keep `EMAIL_SUPPLIERS: false` for the first test.
4. Run **`setup`** from the editor and approve permissions. It adds `Alert Status` without overwriting other columns and replaces only existing `checkStockNow` triggers with one hourly trigger. Run setup under one owner account; Apps Script exposes only that account's installed triggers.
5. Reload the Sheet. Choose **Stock Alerts → Check stock now** (or run `checkStockNow` from the editor). Check the digest and row statuses: `OK`, `LOW (alerted YYYY-MM-DD)`, or `ERROR: <reason>`. Dates use Asia/Ho_Chi_Minh.
6. Run again while stock remains low: no new email. Raise stock above the reorder point and run a check; lower it again and run another check: a new digest arrives.
7. Optional: set `EMAIL_SUPPLIERS: true`. On future newly low events, each valid supplier gets one email with subject **DRAFT: Inventory reorder request**, asking for availability and pricing confirmation. These are sent emails, not Gmail drafts or purchase orders. Invalid supplier addresses are skipped and logged in Apps Script **Executions**; they do not block the owner digest. Already-alerted SKUs are not emailed when enabling the flag.

## Limits worth telling a client

- Hourly triggers run approximately hourly, not at an exact minute. A recovery must be observed by a check to reset an alert.
- Invalid rows, removed rows, and duplicate SKUs retain prior alert state until a valid row shows recovery. Fix errors and run the check again. Blank inventory rows are marked as missing SKU. Keep SKUs stable; a renamed SKU is a new item.
- `Reorder Qty` is the Sheet's suggested quantity, not an automatic purchase. Fractional counts are allowed.
- MailApp recipient quotas and Apps Script runtime/storage quotas apply. Alert state is stored in one Script Property (9 KB value limit); this demo fits a small inventory. Retained state for removed SKUs also uses that space.
- Digest failures throw an error in Executions and leave state uncommitted for the next check. Supplier failures are logged per supplier and do not retry automatically, preserving owner digest suppression.
- Email delivery and Script Properties cannot form one transaction. If delivery succeeds but saving state fails, a later run may repeat the email. Sheet status writes can also fail after state is saved. Check Executions after any failed run; no exactly-once delivery guarantee.
- Tests use local service fakes. Live Google authorization, trigger execution, quotas, and mailbox delivery require the setup checks above.

## Tests

```bash
node --test demo-3-low-stock-alert/tests/*.test.js
```
