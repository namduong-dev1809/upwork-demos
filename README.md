# Google Apps Script automation demos

Small, production-style automations for businesses that run on Google Sheets. Each demo is a self-contained Apps Script project with a setup guide and Node tests for its business logic.

| Demo | What it does |
|---|---|
| [1. Form → invoice PDF → email](demo-1-form-invoice/) | A Google Form submission becomes a numbered PDF invoice, saved to Drive and emailed to the customer. Prices come from your own Products sheet. |
| [2. Nightly sales summary](demo-2-sales-summary/) | Every evening, an email with today's revenue, orders, units, top 3 products and the change vs the same weekday last week. |
| [3. Low-stock alert](demo-3-low-stock-alert/) | Hourly check of an Inventory sheet; one digest email for newly low items, no repeat alerts, optional reorder emails to suppliers. |

Common design choices:

- **Nothing fails silently**: bad rows are marked with an error status or counted in the report, and good rows still run.
- **Money in integer cents**, timezone-explicit dates.
- **Least-privilege OAuth scopes** and HTML-escaped email content.
- **Pure logic separated from Apps Script services**, so it is unit-tested outside Google.

Logic is unit-tested in Node; each demo's README lists what still has to be checked in a live Google account.

```bash
node --test */tests/*.test.js
```

Built by [Duong Thanh Nam](https://duongthanhnam.vercel.app) — Embedded Systems & IoT student, Da Nang, Vietnam.
