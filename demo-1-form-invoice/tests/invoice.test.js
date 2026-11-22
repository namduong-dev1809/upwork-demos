// Run: node --test demo-1-form-invoice/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const inv = require('../src/Invoice.js');

const form = (o) => ({
  'Full name': [o.name ?? 'Ann Lee'],
  Email: [o.email ?? 'ann@example.com'],
  Product: [o.product ?? 'Widget'],
  Quantity: [o.quantity ?? '3'],
});
const prices = { Widget: 19.99, Gadget: '0.10' };

test('valid order produces correct totals in cents', () => {
  const i = inv.computeInvoice_(inv.parseOrder_(form({})), prices, 0.1);
  assert.equal(i.unitCents, 1999);
  assert.equal(i.subtotalCents, 5997);
  assert.equal(i.taxCents, 600);
  assert.equal(i.totalCents, 6597);
});

test('string prices and small amounts do not drift', () => {
  const i = inv.computeInvoice_(inv.parseOrder_(form({ product: 'Gadget', quantity: '3' })), prices, 0);
  assert.equal(i.totalCents, 30);
});

test('price comes from the price map, not the form', () => {
  const values = { ...form({}), Price: ['0.01'] };
  assert.equal(inv.computeInvoice_(inv.parseOrder_(values), prices, 0).unitCents, 1999);
});

test('rejects bad input', () => {
  assert.throws(() => inv.parseOrder_(form({ email: 'not-an-email' })), /Invalid email/);
  assert.throws(() => inv.parseOrder_(form({ quantity: '0' })), /Invalid quantity/);
  assert.throws(() => inv.parseOrder_(form({ quantity: '2.5' })), /Invalid quantity/);
  assert.throws(() => inv.parseOrder_(form({ name: '  ' })), /Missing name/);
  assert.throws(() => inv.computeInvoice_(inv.parseOrder_(form({ product: 'Nope' })), prices, 0), /Unknown product/);
  assert.throws(() => inv.computeInvoice_(inv.parseOrder_(form({ product: 'toString' })), prices, 0), /Unknown product/);
});

test('invoice number and replacements', () => {
  assert.equal(inv.formatInvoiceNumber_(7, '2026'), 'INV-2026-0007');
  const r = inv.buildReplacements_(inv.computeInvoice_(inv.parseOrder_(form({})), prices, 0.1), 'INV-2026-0007', '2026-11-20', '$');
  assert.equal(r['{{total}}'], '$65.97');
  assert.equal(r['{{date}}'], '2026-11-20');
});

test('starter template contains every placeholder', () => {
  const r = inv.buildReplacements_(inv.computeInvoice_(inv.parseOrder_(form({})), prices, 0), 'X', '2026-11-20', '$');
  const text = JSON.stringify(inv.INVOICE_TEMPLATE);
  Object.keys(r).forEach((key) => assert.ok(text.includes(key), key));
});

const defaults = { Name: 'Shop', Rate: 0.1, On: false, Emails: ['a@x.com'] };

test('parseSettings_ merges, trims, coerces and ignores header, blank and unknown keys', () => {
  const s = inv.parseSettings_([
    ['Setting', 'Value', 'Help'],
    ['  Name ', '  Ann Shop  ', ''],
    ['Rate', '0.2', ''],
    ['On', 'yes', ''],
    ['Emails', 'b@x.com, c@x.com\nd@x.com,', ''],
    ['', 'ignored', ''],
    ['Unknown', 'x', ''],
  ], defaults);
  assert.deepEqual(s, { Name: 'Ann Shop', Rate: 0.2, On: true, Emails: ['b@x.com', 'c@x.com', 'd@x.com'] });
  assert.equal(inv.parseSettings_([['Setting', 'Value'], ['On', true]], defaults).On, true);
  assert.equal(inv.parseSettings_([['Setting', 'Value'], ['Rate', 0]], defaults).Rate, 0);
  assert.equal(inv.parseSettings_([['Name', 'Header row is skipped']], defaults).Name, 'Shop');
});

test('parseSettings_ keeps defaults for blank numbers, does not mutate defaults, and names bad rows', () => {
  const s = inv.parseSettings_([['Setting', 'Value'], ['Rate', ''], ['On', '']], defaults);
  assert.equal(s.Rate, 0.1);
  assert.equal(s.On, false);
  s.Emails.push('z');
  assert.deepEqual(defaults.Emails, ['a@x.com']);
  assert.deepEqual(inv.parseSettings_([], defaults).Emails, ['a@x.com']);
  assert.throws(() => inv.parseSettings_([['h'], ['Rate', 'ten']], defaults), /"Rate" must be a number/);
  assert.throws(() => inv.parseSettings_([['h'], ['On', 'maybe']], defaults), /"On" must be TRUE or FALSE/);
});

test('missingSettingsRows_ appends only keys the tab lacks', () => {
  const rows = [['Setting', 'Value', 'Help'], ['Name', 'Mine', '']];
  assert.deepEqual(inv.missingSettingsRows_(rows, defaults, { Rate: 'help' }), [
    ['Rate', 0.1, 'help'], ['On', false, ''], ['Emails', 'a@x.com', ''],
  ]);
  assert.equal(inv.missingSettingsRows_([['Setting'], ['Name'], ['Rate'], ['On'], [' Emails ']], defaults).length, 0);
});

test('checkSettings_ names the Settings row to fill', () => {
  const ok = { 'Seller name': 'S', 'Template Doc ID': 't', 'Output folder ID': 'f', 'Tax rate': 0.1 };
  assert.equal(inv.checkSettings_(ok), ok);
  assert.throws(() => inv.checkSettings_({ ...ok, 'Template Doc ID': '' }), /"Template Doc ID" is empty/);
  assert.throws(() => inv.checkSettings_({ ...ok, 'Output folder ID': '' }), /"Output folder ID" is empty/);
  assert.throws(() => inv.checkSettings_({ ...ok, 'Tax rate': 10 }), /"Tax rate" must be between 0 and 1/);
});

test('findResponsesSheet_ uses the form link, whatever the tab is called', () => {
  const sh = (name, url) => ({ getName: () => name, getFormUrl: () => url });
  const sheets = [sh('Products', null), sh('Câu trả lời biểu mẫu 1', 'https://forms/1'), sh('Form Responses 2', 'https://forms/2')];
  assert.equal(inv.findResponsesSheet_(sheets, '').getName(), 'Câu trả lời biểu mẫu 1');
  assert.equal(inv.findResponsesSheet_(sheets, 'Form Responses 2').getName(), 'Form Responses 2');
  assert.equal(inv.findResponsesSheet_([sh('Products', null)], ''), null);
  assert.throws(() => inv.findResponsesSheet_(sheets, 'Form Responses 1'), /"Responses sheet" says "Form Responses 1"/);
});

/** Service fakes check the glue without a Google account. */
function app(opts = {}) {
  const sheets = [];
  const alerts = [];
  const forms = [];
  const docs = [];
  const folders = [];
  const mails = [];
  const replaced = {};
  const props = {};
  let triggers = [{ getHandlerFunction: () => 'onFormSubmit' }, { getHandlerFunction: () => 'other' }];
  const makeSheet = (name, data = [], formUrl = null) => {
    const sheet = {
      data,
      getName: () => name,
      getFormUrl: () => formUrl,
      getLastRow: () => data.length,
      getLastColumn: () => Math.max(0, ...data.map((r) => r.length)),
      setFrozenRows: () => {},
      appendRow: (row) => data.push(row.slice()),
      getDataRange: () => ({ getValues: () => (data.length ? data.map((r) => r.slice()) : [['']]) }),
      getRange: (r, c, h = 1, w = 1) => {
        const range = {
          getValues: () => Array.from({ length: h }, (_, i) =>
            Array.from({ length: w }, (_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? '')),
          setValue: (v) => range.setValues([[v]]),
          setValues: (values) => {
            values.forEach((row, i) => row.forEach((v, j) => {
              while (data.length < r + i) data.push([]);
              data[r - 1 + i][c - 1 + j] = v;
            }));
            return range;
          },
          setFontWeight: () => range,
        };
        return range;
      },
    };
    return sheet;
  };
  (opts.sheets || [['Sheet1']]).forEach(([name, data, url]) => sheets.push(makeSheet(name, data, url)));
  const ss = {
    getId: () => 'ss1',
    getSpreadsheetTimeZone: () => 'America/New_York',
    getSheets: () => sheets.slice(),
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n, i) => { const s = makeSheet(n); sheets.splice(i ?? sheets.length, 0, s); return s; },
  };
  const formsById = {};
  const makeForm = (id) => {
    const items = [];
    const item = (type) => {
      const it = { type, choices: null, getTitle: () => it.title, asListItem: () => it,
        setTitle: (t) => { it.title = t; return it; }, setRequired: () => it,
        setChoiceValues: (c) => { it.choices = c; return it; } };
      items.push(it);
      return it;
    };
    return formsById[id] = {
      items,
      getId: () => id,
      getPublishedUrl: () => 'https://forms/' + id + '/viewform',
      addTextItem: () => item('TEXT'),
      addListItem: () => item('LIST'),
      getItems: (type) => items.filter((i) => i.type === type),
      setDestination: (type, ssId) => {
        assert.equal(ssId, 'ss1');
        // Google names the new tab in the account's language.
        sheets.push(makeSheet('Câu trả lời biểu mẫu 1',
          [['Dấu thời gian'].concat(items.map((i) => i.title))], 'https://forms/' + id + '/edit'));
      },
    };
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => ss, flush: () => {}, getUi: () => ({ alert: (m) => alerts.push(m) }) },
    FormApp: {
      DestinationType: { SPREADSHEET: 'SPREADSHEET' },
      ItemType: { LIST: 'LIST' },
      create: () => { const f = makeForm('form' + (forms.length + 1)); forms.push(f); return f; },
      openById: (id) => { if (!formsById[id]) throw new Error('no form'); return formsById[id]; },
      openByUrl: (url) => formsById[url.split('/')[3]] || makeForm(url.split('/')[3]),
    },
    DocumentApp: {
      ParagraphHeading: { HEADING1: 'H1' },
      openById: () => ({ saveAndClose: () => {}, getBody: () => ({
        replaceText: (re, text) => { replaced[re.replace(/\\/g, '')] = text; },
      }) }),
      create: () => {
        const text = [];
        const doc = { text, getId: () => 'doc' + docs.length, saveAndClose: () => {}, getBody: () => ({
          appendParagraph: (t) => { text.push(t); return { setHeading: () => {} }; },
          appendTable: (t) => { text.push(JSON.stringify(t)); },
        }) };
        docs.push(doc);
        return doc;
      },
    },
    DriveApp: {
      createFolder: () => { folders.push(1); return { getId: () => 'folder' + folders.length }; },
      getFileById: (id) => {
        if (!/^doc/.test(id)) throw new Error('no file');
        return { makeCopy: (name) => ({ getId: () => 'copy', getAs: () => 'blob', setTrashed: () => {} }) };
      },
      getFolderById: (id) => {
        if (!/^folder/.test(id)) throw new Error('no folder');
        return { createFile: () => ({ setName: (n) => ({ getUrl: () => 'https://drive/' + n, getAs: () => 'pdf' }) }) };
      },
    },
    MimeType: { PDF: 'application/pdf' },
    MailApp: { sendEmail: (m) => mails.push(m) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; },
    }) },
    Utilities: { formatDate: (d, tz, pattern) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(d).map((x) => [x.type, x.value]));
      return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
        .replace('HH', p.hour).replace('mm', p.minute);
    } },
    // 02:00 UTC on 1 Jan is still 31 Dec in New York.
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2027-01-01T02:00:00Z'])); } },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { triggers = triggers.filter((x) => x !== t); },
      newTrigger: (name) => ({ forSpreadsheet: (s) => ({ onFormSubmit: () => ({ create: () => {
        assert.equal(s, ss);
        triggers.push({ getHandlerFunction: () => name });
      } }) }) }),
    },
    console: { error: () => {} },
  });
  for (const filename of ['Invoice.js', 'Main.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), context);
  }
  const settingsRow = (key) => ss.getSheetByName('Settings').data.find((r) => r[0] === key);
  return { context, ss, alerts, forms, docs, folders, mails, replaced, props, settingsRow, get triggers() { return triggers; } };
}

test('setup builds everything on a blank sheet and is idempotent', () => {
  const a = app();
  a.context.setup();
  assert.equal(a.forms.length, 1);
  assert.deepEqual(a.forms[0].items.map((i) => i.title), ['Full name', 'Email', 'Product', 'Quantity']);
  assert.deepEqual([...a.forms[0].items[2].choices], ['Sample T-shirt', 'Sample mug', 'Gift wrap']);
  const responses = a.ss.getSheetByName('Câu trả lời biểu mẫu 1');
  assert.deepEqual(responses.data[0].slice(5), ['Invoice No', 'PDF', 'Status', 'Processed At']);
  assert.equal(a.settingsRow('Form ID')[1], 'form1');
  assert.equal(a.settingsRow('Form URL')[1], 'https://forms/form1/viewform');
  assert.equal(a.settingsRow('Template Doc ID')[1], 'doc1');
  assert.equal(a.settingsRow('Output folder ID')[1], 'folder1');
  assert.match(a.settingsRow('Tax rate')[2], /0\.1 means 10%/);
  assert.ok(a.docs[0].text.join(' ').includes('{{total}}'));
  assert.match(a.alerts[0], /Setup finished[\s\S]*https:\/\/forms\/form1\/viewform/);

  const settings = a.ss.getSheetByName('Settings');
  a.settingsRow('Seller name')[1] = 'Ann Shop';
  const rowCount = settings.data.length;
  a.context.setup();
  assert.equal(a.forms.length, 1);
  assert.equal(a.docs.length, 1);
  assert.equal(a.folders.length, 1);
  assert.equal(settings.data.length, rowCount);
  assert.equal(a.settingsRow('Seller name')[1], 'Ann Shop');
  assert.equal(responses.data[0].filter((h) => h === 'Invoice No').length, 1);
  assert.equal(a.triggers.filter((t) => t.getHandlerFunction() === 'onFormSubmit').length, 1);
  assert.equal(a.triggers.filter((t) => t.getHandlerFunction() === 'other').length, 1);
  assert.match(a.alerts[1], /already in place/);
});

test('setup reuses an already linked responses tab, whatever its name', () => {
  const a = app({ sheets: [['Câu trả lời biểu mẫu 1', [['Dấu thời gian', 'Full name']], 'https://forms/old/edit']] });
  a.context.setup();
  assert.equal(a.forms.length, 0);
  assert.equal(a.settingsRow('Form ID')[1], 'old');
});

test('setup errors go to an alert naming the Settings row; bad IDs are not replaced', () => {
  const a = app();
  a.context.setup();
  a.settingsRow('Template Doc ID')[1] = 'someone-elses-doc';
  a.context.setup();
  assert.match(a.alerts[1], /"Template Doc ID" \(someone-elses-doc\) cannot be opened/);
  assert.equal(a.settingsRow('Template Doc ID')[1], 'someone-elses-doc');
  a.settingsRow('Responses sheet')[1] = 'Form Responses 1';
  a.context.setup();
  assert.match(a.alerts[2], /"Responses sheet" says "Form Responses 1"/);
});

test('onFormSubmit writes setting errors to the row without using the UI', () => {
  const a = app();
  a.context.setup();
  a.settingsRow('Output folder ID')[1] = '';
  const sheet = a.ss.getSheetByName('Câu trả lời biểu mẫu 1');
  sheet.data.push(['2026-11-22', 'Ann', 'ann@example.com', 'Gift wrap', '1']);
  a.context.onFormSubmit({ range: { getSheet: () => sheet, getRow: () => 2 }, namedValues: form({}) });
  assert.match(sheet.data[1][7], /^ERROR: Settings tab: "Output folder ID" is empty/);
  assert.equal(a.alerts.length, 1);
});

test('refreshFormProducts rewrites the Product dropdown from the Products tab', () => {
  const a = app();
  a.context.setup();
  a.ss.getSheetByName('Products').data.push(['New hat', 25]);
  a.context.refreshFormProducts();
  assert.deepEqual([...a.forms[0].items[2].choices], ['Sample T-shirt', 'Sample mug', 'Gift wrap', 'New hat']);
  assert.match(a.alerts[1], /4 product/);
});

test('onFormSubmit sends the invoice with dates in the spreadsheet timezone', () => {
  const a = app();
  a.context.setup();
  a.settingsRow('Seller name')[1] = 'Ann Shop';
  const sheet = a.ss.getSheetByName('Câu trả lời biểu mẫu 1');
  sheet.data.push(['', 'Ann Lee', 'ann@example.com', 'Gift wrap', '2']);
  a.context.onFormSubmit({ range: { getSheet: () => sheet, getRow: () => 2 }, namedValues: form({ product: 'Gift wrap', quantity: '2' }) });
  assert.deepEqual([...sheet.data[1].slice(5)], ['INV-2026-0001', 'https://drive/INV-2026-0001.pdf', 'SENT', '2026-12-31 21:00']);
  assert.equal(a.replaced['{{date}}'], '2026-12-31');
  assert.equal(a.replaced['{{total}}'], '$6.60');
  assert.equal(a.props.invoice_seq_2026, '1');
  assert.equal(a.mails.length, 1);
  assert.equal(a.mails[0].to, 'ann@example.com');
  assert.equal(a.mails[0].subject, 'Invoice INV-2026-0001 from Ann Shop');
});
