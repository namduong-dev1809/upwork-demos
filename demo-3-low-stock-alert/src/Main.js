/** Bound to the inventory spreadsheet. The buyer runs everything from the Stock Alerts menu. */
var CONFIG = {
  INVENTORY_SHEET: 'Inventory',
  SETTINGS_SHEET: 'Settings',
  STATUS_HEADER: 'Alert Status',
  STATE_KEY: 'stock_alert_state',
  // Defaults only: the buyer changes values in the Settings tab, never here.
  SETTINGS: {
    'Recipients': [],
    'Email suppliers (TRUE/FALSE)': false,
    'Check every N hours (1,2,4,6,8,12)': 1,
  },
  HELP: {
    'Recipients': 'Who gets the low-stock digest. Separate several emails with commas.',
    'Email suppliers (TRUE/FALSE)': 'TRUE also emails each supplier a draft reorder request for their newly low SKUs.',
    'Check every N hours (1,2,4,6,8,12)': 'How often the automatic check runs. Re-run Setup after changing it.',
  },
  SAMPLE_ROWS: [
    ['W-001', 'Sample widget (low)', 3, 5, 20, ''],
    ['W-002', 'Sample gadget (OK)', 12, 5, 10, ''],
  ],
};
// Apps Script's everyHours() accepts only these values.
var VALID_HOURS = [1, 2, 4, 6, 8, 12];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Stock Alerts')
    .addItem('Setup / re-run setup', 'setup')
    .addItem('Check stock now', 'checkStockFromMenu')
    .addToUi();
}

/** Menu action. Idempotent: creates missing tabs and Settings rows, then installs exactly one check trigger. */
function setup() {
  withAlert_(function () {
    var ss = SpreadsheetApp.getActive();
    var notes = [];
    var addedKeys = ensureSettingsSheet_(ss);
    if (addedKeys.length) notes.push('Added Settings rows: ' + addedKeys.join(', ') + '.');
    var settings = readSettings_();
    var inventory = ss.getSheetByName(CONFIG.INVENTORY_SHEET);
    if (!inventory) {
      inventory = ss.insertSheet(CONFIG.INVENTORY_SHEET);
      [STOCK_HEADERS].concat(CONFIG.SAMPLE_ROWS).forEach(function (row) { inventory.appendRow(row); });
      notes.push('Created the Inventory tab with 2 sample rows. Replace them with your products.');
    }
    ensureStatusHeader_(inventory);
    var hours = settings['Check every N hours (1,2,4,6,8,12)'];
    ScriptApp.getProjectTriggers()
      .filter(function (trigger) { return trigger.getHandlerFunction() === 'checkStockNow'; })
      .forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    ScriptApp.newTrigger('checkStockNow').timeBased().everyHours(hours).create();
    notes.push('Automatic stock check scheduled every ' + hours + ' hour(s).');
    notes.push(validRecipients_(settings.Recipients) ?
      'Next: choose Stock Alerts → Check stock now.' :
      'Next: fill the "Recipients" row in the Settings tab, then choose Stock Alerts → Check stock now.');
    return 'Setup complete.\n\n' + notes.join('\n');
  });
}

/** Menu action: same check as the trigger, but reports the result or error in a dialog. */
function checkStockFromMenu() {
  withAlert_(checkStockNow);
}

/** Trigger handler. Never touches the UI; errors surface in Executions and Google's failure emails. */
function checkStockNow() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var settings = readSettings_();
    if (!validRecipients_(settings.Recipients)) {
      throw new Error('Fill the "Recipients" row in the Settings tab with one or more valid email addresses, ' +
        'separated by commas.');
    }
    var sheet = inventorySheet_();
    var statusColumn = ensureStatusHeader_(sheet);
    var rows = sheet.getDataRange().getValues().slice(1).map(function (row) { return row.slice(0, 6); });
    var props = PropertiesService.getScriptProperties();
    var previous = JSON.parse(props.getProperty(CONFIG.STATE_KEY) || '{}');
    // Buyers are in many countries: use the Sheet's own timezone (File → Settings), not the manifest's.
    var timeZone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    var date = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    var result = evaluateStock_(rows, previous, date);
    if (result.newlyLow.length) sendStockEmail_(settings.Recipients.join(','), result.newlyLow, false);
    // Save only after digest succeeds, so a failed send remains eligible next run.
    props.setProperty(CONFIG.STATE_KEY, JSON.stringify(result.state));
    if (rows.length) sheet.getRange(2, statusColumn, rows.length, 1).setValues(result.statuses.map(function (status) { return [status]; }));
    if (settings['Email suppliers (TRUE/FALSE)']) {
      var suppliers = groupSuppliers_(result.newlyLow);
      if (suppliers.invalid.length) console.error('Skipped invalid supplier emails for SKUs: ' + suppliers.invalid.join(', '));
      Object.keys(suppliers.groups).forEach(function (email) {
        try {
          sendStockEmail_(email, suppliers.groups[email], true);
        } catch (err) {
          console.error('Supplier email failed for ' + email + ': ' + err.message);
        }
      });
    }
    return 'Checked ' + rows.length + ' row(s). ' + (result.newlyLow.length ?
      result.newlyLow.length + ' newly low SKU(s) emailed to ' + settings.Recipients.join(', ') + '.' :
      'No newly low SKUs, so no email was sent.') + ' See the Alert Status column.';
  } finally {
    lock.releaseLock();
  }
}

// ---- helpers (trailing _ keeps them out of the Run menu) ----

function withAlert_(action) {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert(action());
  } catch (err) {
    ui.alert('Stock Alerts stopped: ' + err.message);
  }
}

/** Appends only missing keys, so values the buyer typed are never overwritten. */
function ensureSettingsSheet_(ss) {
  var sheet = ss.getSheetByName(CONFIG.SETTINGS_SHEET) || ss.insertSheet(CONFIG.SETTINGS_SHEET);
  if (sheet.getLastRow() === 0) sheet.appendRow(['Setting', 'Value', 'Help']);
  var present = sheet.getDataRange().getValues().map(function (row) { return String(row[0]).trim(); });
  return Object.keys(CONFIG.SETTINGS).filter(function (key) {
    if (present.indexOf(key) !== -1) return false;
    var value = CONFIG.SETTINGS[key];
    sheet.appendRow([key, Array.isArray(value) ? value.join(', ') : value, CONFIG.HELP[key]]);
    return true;
  });
}

function readSettings_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SETTINGS_SHEET);
  if (!sheet) throw new Error('The Settings tab is missing. Choose Stock Alerts → Setup / re-run setup.');
  var settings = parseSettings_(sheet.getDataRange().getValues(), CONFIG.SETTINGS);
  if (VALID_HOURS.indexOf(settings['Check every N hours (1,2,4,6,8,12)']) === -1) {
    throw new Error('Settings tab, row "Check every N hours (1,2,4,6,8,12)": enter one of ' + VALID_HOURS.join(', ') + '.');
  }
  return settings;
}

function validRecipients_(list) {
  return list.length > 0 && list.every(isStockEmail_);
}

function inventorySheet_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.INVENTORY_SHEET);
  if (!sheet) throw new Error('The Inventory tab is missing. Choose Stock Alerts → Setup / re-run setup.');
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
  var message = buildStockEmail_(items, supplier);
  message.to = to;
  MailApp.sendEmail(message);
}
