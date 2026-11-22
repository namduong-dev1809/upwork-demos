/** Sheet → nightly sales email. Bound to the sales spreadsheet. Buyers use the Sales summary menu only. */

// Defaults only: buyers change values in the Settings tab, never here.
var CONFIG = {
  'Recipients': [],
  'Send when no sales': true,
  'Currency symbol': '',
  'Language (en/vi)': 'en',
  'Send hour (0-23)': 19,
};

var SETTINGS_HELP_ = {
  'Recipients': 'Email addresses that get the summary. Separate several with commas.',
  'Send when no sales': 'TRUE = still send a short "No sales today" email. FALSE = skip empty days.',
  'Currency symbol': 'Shown with amounts, e.g. $ or €. Leave blank for $ (en) or ₫ (vi).',
  'Language (en/vi)': 'en = English email. vi = Vietnamese email with VND format.',
  'Send hour (0-23)': 'Hour of the daily email, in the spreadsheet timezone (File → Settings). Re-run Setup after changing it.',
};

var SALES_SHEET_ = 'Sales';
var SETTINGS_SHEET_ = 'Settings';
var SALES_HEADERS_ = ['Date', 'Order ID', 'Customer', 'Product', 'Quantity', 'Unit Price', 'Total'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Sales summary')
    .addItem('Setup / re-run setup', 'setup')
    .addItem('Send summary now', 'sendSummaryFromMenu')
    .addToUi();
}

/** Menu: idempotent. Adds missing Settings rows, then replaces this account's daily trigger. */
function setup() {
  runFromMenu_(function () {
    var added = ensureSettings_();
    readSalesRows_(); // validate the sheet before changing triggers
    var settings = readSettings_();
    var hour = sendHour_(settings['Send hour (0-23)']);
    var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    ScriptApp.getProjectTriggers()
      .filter(function (t) { return t.getHandlerFunction() === 'sendSummaryNow'; })
      .forEach(function (t) { ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('sendSummaryNow').timeBased().atHour(hour).nearMinute(0)
      .everyDays(1).inTimezone(tz).create();
    var next;
    try {
      emailOptions_(settings);
      next = 'Next: use Sales summary → Send summary now to send a test email.';
    } catch (err) {
      next = 'Next: ' + err.message + ' Then use Sales summary → Send summary now.';
    }
    return 'Setup done.\n\n' +
      (added ? 'Added ' + added + ' row(s) to the Settings tab.' : 'Settings tab already complete; your values were kept.') +
      '\nDaily email scheduled around ' + hour + ':00 (' + tz + ').\n\n' + next;
  });
}

function sendSummaryFromMenu() {
  runFromMenu_(function () {
    var to = sendSummary_();
    return to ? 'Summary sent to ' + to + '.' :
      'No sales today and "Send when no sales" is FALSE, so no email was sent.';
  });
}

/** Daily trigger handler. No UI here: errors appear in Apps Script Executions and Google's failure email. */
function sendSummaryNow() {
  sendSummary_();
}

// ---- helpers (trailing _ keeps them out of the Run menu) ----

function runFromMenu_(task) {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert(task());
  } catch (err) {
    ui.alert('Sales summary: ' + err.message);
  }
}

/** Returns the recipients, or null when nothing was sent. */
function sendSummary_() {
  var options = emailOptions_(readSettings_());
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var localDay = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var rows = readSalesRows_().map(function (row) {
    var d = row[0];
    // Invalid Date cells stay as-is so buildSummary_ counts them as skipped rows.
    var isDate = Object.prototype.toString.call(d) === '[object Date]' && isFinite(d.getTime());
    return isDate ? [localDay(d)].concat(row.slice(1)) : row;
  });
  var message = renderSummary_(buildSummary_(rows, localDay(new Date())),
    options.sendWhenEmpty, options.currency, options.lang);
  if (!message) return null;
  message.to = options.to;
  MailApp.sendEmail(message);
  return options.to;
}

function emailOptions_(settings) {
  var lang = settings['Language (en/vi)'].toLowerCase();
  if (lang !== 'en' && lang !== 'vi') throw new Error('Settings tab, row "Language (en/vi)": enter en or vi.');
  return {
    to: recipients_(settings['Recipients']),
    sendWhenEmpty: settings['Send when no sales'],
    currency: settings['Currency symbol'],
    lang: lang,
  };
}

/** Creates the Settings tab if missing and appends only absent keys. Returns how many rows were added. */
function ensureSettings_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SETTINGS_SHEET_) || ss.insertSheet(SETTINGS_SHEET_);
  if (sheet.getLastRow() === 0) sheet.appendRow(['Setting', 'Value', 'Help']);
  var missing = missingSettingsRows_(sheet.getDataRange().getValues(), CONFIG, SETTINGS_HELP_);
  if (missing.length) sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  return missing.length;
}

function readSettings_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SETTINGS_SHEET_);
  if (!sheet) throw new Error('No Settings tab yet. Use the menu Sales summary → Setup / re-run setup.');
  return parseSettings_(sheet.getDataRange().getValues(), CONFIG);
}

function readSalesRows_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SALES_SHEET_);
  var wanted = 'row 1 must contain these headers in columns A-G: ' + SALES_HEADERS_.join(' | ');
  if (!sheet) throw new Error('No tab named "' + SALES_SHEET_ + '". Add it; ' + wanted);
  var data = sheet.getDataRange().getValues();
  if (!SALES_HEADERS_.every(function (h, i) { return data[0][i] === h; })) {
    throw new Error('Sales tab: ' + wanted);
  }
  return data.slice(1);
}
