/** Sheet → nightly sales email. Bound to the sales spreadsheet. Run setup() once. */
var CONFIG = {
  SALES_SHEET: 'Sales',
  RECIPIENTS: ['owner@example.com'], // replace before running setup or sending
  SEND_WHEN_EMPTY: true,
  CURRENCY: '$',
};

/** Installs one daily trigger for this account; repeated setup replaces that handler's triggers. */
function setup() {
  readSalesRows_(); // validate the sheet before changing triggers
  recipients_();
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sendSummaryNow'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendSummaryNow').timeBased().atHour(19).nearMinute(0)
    .everyDays(1).inTimezone('Asia/Ho_Chi_Minh').create();
}

/** Manual entry point and daily trigger handler. Errors appear in Apps Script Executions. */
function sendSummaryNow() {
  var summary = buildSummary(readSalesRows_(), new Date());
  var message = renderSummary(summary, CONFIG.SEND_WHEN_EMPTY, CONFIG.CURRENCY);
  if (!message) return;
  message.to = recipients_();
  MailApp.sendEmail(message);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Sales summary')
    .addItem('Send summary now', 'sendSummaryNow').addToUi();
}

// ---- helpers (trailing _ keeps them out of the Run menu) ----

function readSalesRows_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SALES_SHEET);
  if (!sheet) throw new Error('Sheet not found: ' + CONFIG.SALES_SHEET);
  var data = sheet.getDataRange().getValues();
  var headers = ['Date', 'Order ID', 'Customer', 'Product', 'Quantity', 'Unit Price', 'Total'];
  if (!headers.every(function (h, i) { return data[0][i] === h; })) {
    throw new Error('Sales headers must be: ' + headers.join(' | '));
  }
  return data.slice(1);
}

function recipients_() {
  if (!Array.isArray(CONFIG.RECIPIENTS) || !CONFIG.RECIPIENTS.length ||
      !CONFIG.RECIPIENTS.every(function (email) {
        return typeof email === 'string' && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email);
      })) throw new Error('Set CONFIG.RECIPIENTS to valid email addresses');
  return CONFIG.RECIPIENTS.join(',');
}
