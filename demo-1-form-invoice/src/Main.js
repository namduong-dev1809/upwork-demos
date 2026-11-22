/**
 * Google Form → invoice PDF → email.
 * Bound to the Sheet. The buyer runs everything from the Invoices menu and edits only the Settings tab.
 */

/** Defaults for the Settings tab. Values in the tab win; this only supplies keys and first values. */
var CONFIG = {
  'Seller name': 'My Store',
  'Tax rate': 0.1,
  'Currency symbol': '$',
  'Responses sheet': '',
  'Template Doc ID': '',
  'Output folder ID': '',
  'Form ID': '',
  'Form URL': '',
};

var SETTINGS_HELP = {
  'Seller name': 'Shown at the top of the invoice and in the email subject and signature.',
  'Tax rate': 'Between 0 and 1. 0.1 means 10%. Use 0 for no tax.',
  'Currency symbol': 'Shown before every amount, e.g. $, €, £.',
  'Responses sheet': 'Optional. Leave blank to use the tab linked to your form.',
  'Template Doc ID': 'Filled by Setup. To use your own invoice Doc, paste its ID (the long code in its link).',
  'Output folder ID': 'Filled by Setup. Drive folder where invoice PDFs are saved.',
  'Form ID': 'Filled by Setup.',
  'Form URL': 'Filled by Setup. Share this link with your customers.',
};

var SETTINGS_SHEET = 'Settings';
var PRODUCTS_SHEET = 'Products'; // columns: Product | Price
var SAMPLE_PRODUCTS = [['Product', 'Price'], ['Sample T-shirt', 19.99], ['Sample mug', 12.5], ['Gift wrap', 3]];
// Status columns appended after the form's own columns.
var STATUS_HEADERS = ['Invoice No', 'PDF', 'Status', 'Processed At'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Invoices')
    .addItem('Setup / re-run setup', 'setup')
    .addItem('Refresh form products', 'refreshFormProducts')
    .addItem('Retry failed rows', 'retryFailedRows')
    .addToUi();
}

/** Menu: creates whatever is missing. Safe to re-run: it never overwrites values in Settings. */
function setup() {
  runFromMenu_(function () {
    var ss = SpreadsheetApp.getActive();
    var done = [];
    ensureSettingsSheet_(ss, done);
    var settings = readSettings_(ss);

    if (!ss.getSheetByName(PRODUCTS_SHEET)) {
      ss.insertSheet(PRODUCTS_SHEET).getRange(1, 1, SAMPLE_PRODUCTS.length, 2).setValues(SAMPLE_PRODUCTS);
      done.push('Created the Products tab with 3 sample products.');
    }

    var sheet = findResponsesSheet_(ss.getSheets(), settings['Responses sheet']);
    if (!sheet) {
      var form = openSetting_(settings, 'Form ID', function (id) { return FormApp.openById(id); });
      if (!form) {
        form = createOrderForm_();
        done.push('Created the order form.');
      }
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
      SpreadsheetApp.flush();
      sheet = findResponsesSheet_(SpreadsheetApp.getActive().getSheets(), '');
      if (!sheet) throw new Error('The form is linked but its responses tab has not appeared yet. Wait a minute, then run Setup again.');
    }
    var linked = linkedForm_(sheet);
    writeSetting_(ss, 'Form ID', linked.getId());
    writeSetting_(ss, 'Form URL', linked.getPublishedUrl());
    ensureStatusHeaders_(sheet);

    if (!openSetting_(settings, 'Template Doc ID', function (id) { return DriveApp.getFileById(id); })) {
      writeSetting_(ss, 'Template Doc ID', createTemplateDoc_().getId());
      done.push('Created the invoice template Doc. Restyle it freely, but keep the {{placeholders}}.');
    }
    if (!openSetting_(settings, 'Output folder ID', function (id) { return DriveApp.getFolderById(id); })) {
      writeSetting_(ss, 'Output folder ID', DriveApp.createFolder('Invoices (PDF)').getId());
      done.push('Created the Drive folder "Invoices (PDF)".');
    }

    ScriptApp.getProjectTriggers()
      .filter(function (t) { return t.getHandlerFunction() === 'onFormSubmit'; })
      .forEach(function (t) { ScriptApp.deleteTrigger(t); }); // avoid duplicate emails
    ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();

    SpreadsheetApp.getUi().alert('Setup finished.\n\n' +
      (done.length ? done.join('\n') : 'Everything was already in place.') +
      '\nNew form responses now get an invoice automatically.\n\nNext:\n' +
      '1. Settings tab: check Seller name, Tax rate and Currency symbol.\n' +
      '2. Products tab: enter your products and prices, then Invoices > Refresh form products.\n' +
      '3. Send yourself a test order: open the link in the "Form URL" row of the Settings tab.');
  });
}

/** Trigger handler. Never throws and never uses the UI: errors are written to the row. */
function onFormSubmit(e) {
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  var cols = ensureStatusHeaders_(sheet);
  try {
    var settings = checkSettings_(readSettings_(SpreadsheetApp.getActive()));
    var order = parseOrder_(e.namedValues);
    var invoice = computeInvoice_(order, readPriceMap_(), settings['Tax rate']);
    var now = new Date();
    var year = localDate_(now, 'yyyy');
    var number = formatInvoiceNumber_(nextSequence_(year), year);
    var replacements = buildReplacements_(invoice, number, localDate_(now, 'yyyy-MM-dd'), settings['Currency symbol'], settings['Seller name']);
    var pdf = createPdf_(replacements, number, settings);
    sendEmail_(invoice, number, pdf, settings);
    writeStatus_(sheet, row, cols, [number, pdf.getUrl(), 'SENT', localDate_(now, 'yyyy-MM-dd HH:mm')]);
  } catch (err) {
    writeStatus_(sheet, row, cols, ['', '', 'ERROR: ' + err.message, localDate_(new Date(), 'yyyy-MM-dd HH:mm')]);
    console.error('Row ' + row + ': ' + err.stack);
  }
}

/** Menu: re-process rows marked ERROR, after fixing the cause. */
function retryFailedRows() {
  runFromMenu_(function () {
    var sheet = responsesSheet_(SpreadsheetApp.getActive());
    var cols = ensureStatusHeaders_(sheet);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var retried = 0;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][cols.status - 1]).indexOf('ERROR') !== 0) continue;
      var namedValues = {};
      headers.forEach(function (h, i) { namedValues[h] = [data[r][i]]; });
      onFormSubmit({ range: sheet.getRange(r + 1, 1), namedValues: namedValues });
      retried++;
    }
    SpreadsheetApp.getUi().alert('Retried ' + retried + ' failed row(s). Check the Status column.');
  });
}

/** Menu: rewrites the form's Product dropdown from the Products tab. */
function refreshFormProducts() {
  runFromMenu_(function () {
    var form = linkedForm_(responsesSheet_(SpreadsheetApp.getActive()));
    var item = form.getItems(FormApp.ItemType.LIST).filter(function (i) {
      return i.getTitle() === FORM_FIELDS.product;
    })[0];
    if (!item) throw new Error('The form has no dropdown question named "' + FORM_FIELDS.product + '".');
    var names = productNames_();
    item.asListItem().setChoiceValues(names);
    SpreadsheetApp.getUi().alert('The form\'s Product list now has ' + names.length + ' product(s).');
  });
}

// ---- helpers (trailing _ keeps them out of the Run menu) ----

function runFromMenu_(fn) {
  try {
    fn();
  } catch (err) {
    console.error(err.stack);
    SpreadsheetApp.getUi().alert('Something needs fixing:\n\n' + err.message);
  }
}

function ensureSettingsSheet_(ss, done) {
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET, 0);
    sheet.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'Help']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    done.push('Created the Settings tab.');
  }
  var missing = missingSettingsRows_(sheet.getDataRange().getValues(), CONFIG, SETTINGS_HELP);
  if (missing.length) sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
}

function readSettings_(ss) {
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  return parseSettings_(sheet ? sheet.getDataRange().getValues() : [], CONFIG);
}

function writeSetting_(ss, key, value) {
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  var rows = sheet.getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][0]).trim() === key) return sheet.getRange(r + 1, 2).setValue(value);
  }
  sheet.appendRow([key, value, SETTINGS_HELP[key] || '']);
}

/** Opens the ID in a Settings row, or returns null if blank. A bad ID is the buyer's to fix, so it is never replaced. */
function openSetting_(settings, key, open) {
  var id = settings[key];
  if (!id) return null;
  try {
    return open(id);
  } catch (err) {
    throw new Error('Settings tab: "' + key + '" (' + id + ') cannot be opened. Check the ID, or clear the cell and run Setup to create a new one.');
  }
}

function responsesSheet_(ss) {
  var sheet = findResponsesSheet_(ss.getSheets(), readSettings_(ss)['Responses sheet']);
  if (!sheet) throw new Error('No tab is linked to a Google Form yet. Run Invoices > Setup / re-run setup.');
  return sheet;
}

function linkedForm_(sheet) {
  var url = sheet.getFormUrl();
  if (!url) {
    throw new Error('The "' + sheet.getName() + '" tab is not linked to a Google Form. Clear "Responses sheet" in the Settings tab.');
  }
  return FormApp.openByUrl(url);
}

function createOrderForm_() {
  var form = FormApp.create('Order form');
  form.addTextItem().setTitle(FORM_FIELDS.name).setRequired(true);
  form.addTextItem().setTitle(FORM_FIELDS.email).setRequired(true);
  form.addListItem().setTitle(FORM_FIELDS.product).setChoiceValues(productNames_()).setRequired(true);
  form.addTextItem().setTitle(FORM_FIELDS.quantity).setRequired(true);
  return form;
}

function createTemplateDoc_() {
  var doc = DocumentApp.create('Invoice template');
  var body = doc.getBody();
  body.appendParagraph(INVOICE_TEMPLATE.title).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  INVOICE_TEMPLATE.lines.forEach(function (line) { body.appendParagraph(line); });
  body.appendTable(INVOICE_TEMPLATE.table);
  INVOICE_TEMPLATE.totals.forEach(function (line) { body.appendParagraph(line); });
  doc.saveAndClose();
  return doc;
}

function ensureStatusHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var start = headers.indexOf(STATUS_HEADERS[0]) + 1;
  if (start === 0) {
    start = lastCol + 1;
    sheet.getRange(1, start, 1, STATUS_HEADERS.length).setValues([STATUS_HEADERS]);
  }
  return { start: start, status: start + 2 };
}

function writeStatus_(sheet, row, cols, values) {
  sheet.getRange(row, cols.start, 1, values.length).setValues([values]);
}

function readPriceMap_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(PRODUCTS_SHEET);
  if (!sheet) throw new Error('The Products tab is missing. Run Invoices > Setup / re-run setup.');
  var map = {};
  sheet.getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[0] !== '') map[String(r[0]).trim()] = r[1];
  });
  return map;
}

function productNames_() {
  var names = Object.keys(readPriceMap_());
  if (!names.length) throw new Error('The Products tab has no products. Add at least one row (Product | Price).');
  return names;
}

/** Buyers are worldwide, so dates follow the spreadsheet's timezone (File > Settings), not the script's. */
function localDate_(date, pattern) {
  return Utilities.formatDate(date, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), pattern);
}

/** Per-year counter in Script Properties; the lock stops two submissions getting one number. */
function nextSequence_(year) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'invoice_seq_' + year;
    var next = Number(props.getProperty(key) || 0) + 1;
    props.setProperty(key, String(next));
    return next;
  } finally {
    lock.releaseLock();
  }
}

function createPdf_(replacements, number, settings) {
  var folder = DriveApp.getFolderById(settings['Output folder ID']);
  var copy = DriveApp.getFileById(settings['Template Doc ID']).makeCopy(number, folder);
  var doc = DocumentApp.openById(copy.getId());
  var body = doc.getBody();
  Object.keys(replacements).forEach(function (key) {
    // replaceText takes a regex; escape so {{...}} is matched literally.
    body.replaceText(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), replacements[key]);
  });
  doc.saveAndClose();
  var pdf = folder.createFile(copy.getAs(MimeType.PDF)).setName(number + '.pdf');
  copy.setTrashed(true); // keep only the PDF
  return pdf;
}

function sendEmail_(invoice, number, pdf, settings) {
  var seller = settings['Seller name'];
  MailApp.sendEmail({
    to: invoice.email,
    subject: 'Invoice ' + number + ' from ' + seller,
    body: 'Hi ' + invoice.name + ',\n\nThanks for your order. Your invoice ' + number +
      ' (' + formatMoney_(invoice.totalCents, settings['Currency symbol']) + ') is attached.\n\n' + seller,
    name: seller,
    attachments: [pdf.getAs(MimeType.PDF)],
  });
}
