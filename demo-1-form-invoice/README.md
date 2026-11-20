# Demo 1 — Google Form → Invoice PDF → Email

A customer fills in a Google Form. Within seconds they get an emailed PDF invoice, the PDF is saved to Drive, and the response row in the Sheet shows the invoice number, PDF link and status.

Built with Google Apps Script (no paid tools, no servers).

## What it shows a client

- **No manual steps**: form submit → numbered invoice (`INV-2026-0001`) → PDF → email.
- **Prices are looked up from a `Products` sheet**, never taken from the form, so a customer cannot change the price they pay.
- **Nothing fails silently**: a bad response (unknown product, invalid email) is marked `ERROR: <reason>` on its row, and the menu **Invoices → Retry failed rows** re-runs it after the fix.
- **No duplicate numbers** when two people submit at the same moment (script lock around the counter).

## Files

| File | What it does |
|---|---|
| `src/Invoice.js` | Pure logic: parse and validate the response, compute totals in cents, invoice number, template placeholders. Tested in Node. |
| `src/Main.js` | Apps Script glue: trigger, price lookup, Doc template → PDF, email, status columns. |
| `src/appsscript.json` | Manifest: V8 runtime, timezone, OAuth scopes. |
| `tests/invoice.test.js` | Node tests for `Invoice.js`. |

## Set up (about 10 minutes)

1. **Google Form** with the fields `Full name`, `Email`, `Product` (dropdown), `Quantity`. Link it to a new Sheet (Responses → Link to Sheets). If the client's form uses other titles, edit `FORM_FIELDS` in `Invoice.js`.
2. In that Sheet add a tab **`Products`**: column A `Product`, column B `Price` (e.g. `Widget | 19.99`).
3. **Google Doc template** containing any of: `{{invoice_number}} {{date}} {{name}} {{email}} {{product}} {{quantity}} {{unit_price}} {{subtotal}} {{tax}} {{total}}`.
4. A Drive folder for the PDFs.
5. Sheet → Extensions → Apps Script. Copy in `Invoice.js` and `Main.js`, and in Project Settings enable "Show appsscript.json" and paste the manifest. Or use clasp:
   ```bash
   npm install -g @google/clasp
   clasp login
   clasp clone <scriptId> --rootDir src
   clasp push
   ```
6. In `Main.js` set `CONFIG.TEMPLATE_DOC_ID`, `CONFIG.OUTPUT_FOLDER_ID`, `TAX_RATE`, `SELLER_NAME`.
7. Run **`setup`** once from the editor and approve the permissions. Submit a test response.

Limits worth telling a client: `MailApp` has a daily recipient quota (lower on free Gmail accounts than on Workspace), and each run takes a few seconds because Docs → PDF is slow.

## Tests

```bash
node --test demo-1-form-invoice/tests/*.test.js
```
