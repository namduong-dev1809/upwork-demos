# Google Apps Script automation demos

Small, production-style automations for businesses that run on Google Sheets. Each demo is a self-contained Apps Script project with a setup guide and Node tests for its business logic.

| Demo | What it does |
|---|---|
| [1. Form → invoice PDF → email](demo-1-form-invoice/) | A Google Form submission becomes a numbered PDF invoice, saved to Drive and emailed to the customer. Prices come from your own Products sheet. |
| [2. Nightly sales summary](demo-2-sales-summary/) | Every evening, an email with today's revenue, orders, units, top 3 products and the change vs the same weekday last week. |
| [3. Low-stock alert](demo-3-low-stock-alert/) | Scheduled check (every 1–12 hours) of an Inventory sheet; one digest email for newly low items, no repeat alerts, optional reorder emails to suppliers. |

Common design choices:

- **No code editing for the user**: open the Sheet's own menu → **Setup**, approve Google's permission screen, fill the **Settings** tab. Setup is safe to re-run and never overwrites values already entered.
- **Nothing fails silently**: bad rows are marked with an error status or counted in the report, good rows still run, and menu actions explain problems in a dialog.
- **Money in integer cents**; dates and schedules follow the spreadsheet's own timezone (File → Settings).
- **Narrow OAuth scopes** (current spreadsheet only, except demo 1, which needs Drive and Docs to create invoice PDFs) and HTML-escaped email content.
- **Pure logic separated from Apps Script services**, so it is unit-tested outside Google.

All three were run end to end in a live Google account on 2026-11-22, including Setup on a blank spreadsheet with a non-English locale.

```bash
node --test */tests/*.test.js
```

Built by [Duong Thanh Nam](https://duongthanhnam.vercel.app) — Embedded Systems & IoT student, Da Nang, Vietnam.
