# Demo 1 — Google Form → Invoice PDF → Email

A customer fills in a Google Form. Within seconds they get an emailed PDF invoice, the PDF is saved to Drive, and the response row in the Sheet shows the invoice number, PDF link and status.

Built with Google Apps Script (no paid tools, no servers). You never edit code: everything runs from the **Invoices** menu and the **Settings** tab.

## What it does

- **No manual steps**: form submit → numbered invoice (`INV-2026-0001`) → PDF → email.
- **One-click setup**: creates the order form, a `Products` tab with sample rows, an invoice template Doc and a Drive folder for the PDFs, and links them all together.
- **Prices are looked up from the `Products` tab**, never taken from the form, so a customer cannot change the price they pay.
- **Nothing fails silently**: a bad response (unknown product, invalid email, missing setting) is marked `ERROR: <reason>` on its row, and **Invoices → Retry failed rows** re-runs it after the fix.
- **No duplicate numbers** when two people submit at the same moment.
- **Works in any Google account language**: the responses tab is found by its form link, not its name.

## Set up (about 5 minutes)

1. **Make a copy** of the Sheet (File → Make a copy).
2. **No need to open Extensions.** Reload the copy and use the menu **Invoices → Setup / re-run setup**.
3. **Approve the permissions.** Google shows "Google hasn't verified this app": click **Advanced → Go to … (unsafe)**. This appears because the script is not published on a marketplace; it runs only inside your own Google account and sends data nowhere else.
4. **Fill the Settings tab**: `Seller name`, `Tax rate` (0.1 = 10%, 0 for none) and `Currency symbol`. Setup has already filled the form, template and folder IDs.
   Edit the **Products** tab with your products and prices, then run **Invoices → Refresh form products** so the form's dropdown matches.
5. **Send a test order** using the `Form URL` shown in the Settings tab. The invoice arrives by email and the row shows `SENT`.

Setup is safe to run again at any time: it only adds what is missing and never overwrites values you entered. To use your own invoice design, edit the template Doc (keep the `{{placeholders}}`) or paste another Doc's ID into `Template Doc ID`.

Dates on invoices, invoice-number years and the `Processed At` column follow the spreadsheet's timezone. Check it in **File → Settings → Time zone**.

Limits: Google limits how many emails a script can send per day (lower on free Gmail than on Workspace), and each invoice takes a few seconds because making a PDF is slow.

## Files

| File | What it does |
|---|---|
| `src/Invoice.js` | Pure logic: validate the response, totals in cents, invoice number, placeholders, Settings parsing, finding the responses tab. Tested in Node. |
| `src/Main.js` | Apps Script glue: menu, setup, trigger, Doc template → PDF, email, status columns. |
| `src/appsscript.json` | Manifest: V8 runtime, OAuth scopes. |
| `tests/invoice.test.js` | Node tests for the logic, plus fake-service tests for the glue. |

## Developers

Before listing a template copy, leave the ID rows in Settings blank (or delete the Settings tab) so each buyer's Setup creates their own files. Deploy with clasp (`clasp clone <scriptId> --rootDir src`, then `clasp push`). Run the tests from the repo root:

```bash
node --test demo-1-form-invoice/tests/*.test.js
```
