/** Bound to the inventory spreadsheet. Run setup() once from the editor. */
var CONFIG = {
  INVENTORY_SHEET: 'Inventory',
  RECIPIENTS: ['owner@example.com'],
  EMAIL_SUPPLIERS: false,
  STATUS_HEADER: 'Alert Status',
  STATE_KEY: 'stock_alert_state',
};

/** Install exactly one hourly trigger for this handler. */
function setup() {
  ensureStatusHeader_(inventorySheet_());
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === 'checkStockNow'; })
    .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('checkStockNow').timeBased().everyHours(1).create();
}

function checkStockNow() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = inventorySheet_();
    var statusColumn = ensureStatusHeader_(sheet);
    var rows = sheet.getDataRange().getValues().slice(1).map(function (row) { return row.slice(0, 6); });
    var props = PropertiesService.getScriptProperties();
    var previous = JSON.parse(props.getProperty(CONFIG.STATE_KEY) || '{}');
    var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var result = evaluateStock(rows, previous, date);
    if (result.newlyLow.length) {
      if (!Array.isArray(CONFIG.RECIPIENTS) || !CONFIG.RECIPIENTS.length || !CONFIG.RECIPIENTS.every(isStockEmail)) {
        throw new Error('CONFIG.RECIPIENTS must contain valid email addresses');
      }
      sendStockEmail_(CONFIG.RECIPIENTS.join(','), result.newlyLow, false);
    }
    // Save only after digest succeeds, so a failed send remains eligible next run.
    props.setProperty(CONFIG.STATE_KEY, JSON.stringify(result.state));
    if (rows.length) sheet.getRange(2, statusColumn, rows.length, 1).setValues(result.statuses.map(function (status) { return [status]; }));
    if (CONFIG.EMAIL_SUPPLIERS) {
      var suppliers = groupSuppliers(result.newlyLow);
      if (suppliers.invalid.length) console.error('Skipped invalid supplier emails for SKUs: ' + suppliers.invalid.join(', '));
      Object.keys(suppliers.groups).forEach(function (email) {
        try {
          sendStockEmail_(email, suppliers.groups[email], true);
        } catch (err) {
          console.error('Supplier email failed for ' + email + ': ' + err.message);
        }
      });
    }
  } finally {
    lock.releaseLock();
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Stock Alerts').addItem('Check stock now', 'checkStockNow').addToUi();
}

// ---- helpers (trailing _ keeps them out of the Run menu) ----

function inventorySheet_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.INVENTORY_SHEET);
  if (!sheet) throw new Error('Sheet not found: ' + CONFIG.INVENTORY_SHEET);
  return sheet;
}

function ensureStatusHeader_(sheet) {
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 6)).getValues()[0];
  if (!STOCK_HEADERS.every(function (header, index) { return headers[index] === header; })) {
    throw new Error('Inventory columns A–F must be: ' + STOCK_HEADERS.join(' | '));
  }
  var column = headers.indexOf(CONFIG.STATUS_HEADER) + 1;
  if (!column) {
    column = headers.length + 1;
    sheet.getRange(1, column).setValue(CONFIG.STATUS_HEADER);
  }
  return column;
}

function sendStockEmail_(to, items, supplier) {
  var message = buildStockEmail(items, supplier);
  message.to = to;
  MailApp.sendEmail(message);
}
