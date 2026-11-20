/**
 * Google Form → invoice PDF → email.
 * Bound to the Sheet that receives the Form responses. Run setup() once from the editor.
 */

var CONFIG = {
  TEMPLATE_DOC_ID: 'PASTE_TEMPLATE_DOC_ID', // Google Doc with {{placeholders}}
  OUTPUT_FOLDER_ID: 'PASTE_DRIVE_FOLDER_ID', // where PDFs are saved
  RESPONSES_SHEET: 'Form Responses 1',
  PRODUCTS_SHEET: 'Products', // columns: Product | Price
  TAX_RATE: 0.1,
  CURRENCY: '$',
  SELLER_NAME: 'Demo Store',
  // Status columns appended after the form's own columns.
  STATUS_HEADERS: ['Invoice No', 'PDF', 'Status', 'Processed At'],
};

/** One-time setup: status headers + a single onFormSubmit trigger. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(CONFIG.RESPONSES_SHEET);
  if (!sheet) throw new Error('Sheet not found: ' + CONFIG.RESPONSES_SHEET);
  ensureStatusHeaders_(sheet);

  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'onFormSubmit'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); }); // avoid duplicate emails
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
}

/** Trigger handler. Never throws: errors are written to the row so nothing is lost silently. */
function onFormSubmit(e) {
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  var cols = ensureStatusHeaders_(sheet);
  try {
    var order = parseOrder(e.namedValues);
    var invoice = computeInvoice(order, readPriceMap_(), CONFIG.TAX_RATE);
    var now = new Date();
    var number = formatInvoiceNumber(nextSequence_(now), now);
    var pdf = createPdf_(buildReplacements(invoice, number, now, CONFIG.CURRENCY), number);
    sendEmail_(invoice, number, pdf);
    writeStatus_(sheet, row, cols, [number, pdf.getUrl(), 'SENT', now]);
  } catch (err) {
    writeStatus_(sheet, row, cols, ['', '', 'ERROR: ' + err.message, new Date()]);
    console.error('Row ' + row + ': ' + err.stack);
  }
}

/** Re-process rows marked ERROR (after fixing the cause), from the editor or a menu. */
function retryFailedRows() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.RESPONSES_SHEET);
  var cols = ensureStatusHeaders_(sheet);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][cols.status - 1]).indexOf('ERROR') !== 0) continue;
    var namedValues = {};
    headers.forEach(function (h, i) { namedValues[h] = [data[r][i]]; });
    onFormSubmit({ range: sheet.getRange(r + 1, 1), namedValues: namedValues });
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Invoices').addItem('Retry failed rows', 'retryFailedRows').addToUi();
}

// ---- helpers (trailing _ keeps them out of the Run menu) ----

function ensureStatusHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var start = headers.indexOf(CONFIG.STATUS_HEADERS[0]) + 1;
  if (start === 0) {
    start = lastCol + 1;
    sheet.getRange(1, start, 1, CONFIG.STATUS_HEADERS.length).setValues([CONFIG.STATUS_HEADERS]);
  }
  return { start: start, status: start + 2 };
}

function writeStatus_(sheet, row, cols, values) {
  sheet.getRange(row, cols.start, 1, values.length).setValues([values]);
}

function readPriceMap_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.PRODUCTS_SHEET);
  if (!sheet) throw new Error('Sheet not found: ' + CONFIG.PRODUCTS_SHEET);
  var map = {};
  sheet.getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[0] !== '') map[String(r[0]).trim()] = r[1];
  });
  return map;
}

/** Per-year counter in Script Properties; the lock stops two submissions getting one number. */
function nextSequence_(date) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'invoice_seq_' + date.getFullYear();
    var next = Number(props.getProperty(key) || 0) + 1;
    props.setProperty(key, String(next));
    return next;
  } finally {
    lock.releaseLock();
  }
}

function createPdf_(replacements, number) {
  var folder = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID);
  var copy = DriveApp.getFileById(CONFIG.TEMPLATE_DOC_ID).makeCopy(number, folder);
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

function sendEmail_(invoice, number, pdf) {
  MailApp.sendEmail({
    to: invoice.email,
    subject: 'Invoice ' + number + ' from ' + CONFIG.SELLER_NAME,
    body: 'Hi ' + invoice.name + ',\n\nThanks for your order. Your invoice ' + number +
      ' (' + formatMoney(invoice.totalCents, CONFIG.CURRENCY) + ') is attached.\n\n' + CONFIG.SELLER_NAME,
    name: CONFIG.SELLER_NAME,
    attachments: [pdf.getAs(MimeType.PDF)],
  });
}
