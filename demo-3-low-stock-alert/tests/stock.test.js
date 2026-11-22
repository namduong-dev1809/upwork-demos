// Run: node --test demo-3-low-stock-alert/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stock = require('../src/Stock.js');

const row = (sku = 'A', onHand = 5, point = 5, qty = 10, email = 'supply@example.com') =>
  [sku, 'Widget', onHand, point, qty, email];
const check = (rows, state = {}, date = '2026-11-20') => stock.evaluateStock_(rows, state, date);

test('equal to reorder point is LOW; strictly above is OK', () => {
  const result = check([row(), row('B', 6)]);
  assert.deepEqual(result.statuses, ['LOW (alerted 2026-11-20)', 'OK']);
  assert.equal(result.newlyLow.length, 1);
  assert.equal(result.newlyLow[0].reorderQty, 10);
});

test('still-low SKU keeps original alert date without another alert', () => {
  const first = check([row()]);
  const second = check([row('A', 1)], first.state, '2026-11-21');
  assert.equal(second.newlyLow.length, 0);
  assert.equal(second.statuses[0], 'LOW (alerted 2026-11-20)');
});

test('valid recovery clears state, then a drop alerts again', () => {
  const first = check([row()]);
  const recovered = check([row('A', 6)], first.state);
  assert.equal(Object.hasOwn(recovered.state, 'A'), false);
  const dropped = check([row()], recovered.state, '2026-11-22');
  assert.equal(dropped.newlyLow.length, 1);
  assert.equal(dropped.statuses[0], 'LOW (alerted 2026-11-22)');
  assert.equal(first.state.A, '2026-11-20');
});

test('all duplicate, missing SKU, and non-numeric rows are ERROR without stopping good rows', () => {
  const result = check([
    row('A'), row(' A ', 20), row('  '), row('B', 'bad'), row('C', 2, 'bad'),
    row('D', 2, 5, 'bad'), row('E'),
  ]);
  assert.deepEqual(result.statuses, [
    'ERROR: Duplicate SKU: A', 'ERROR: Duplicate SKU: A', 'ERROR: Missing SKU',
    'ERROR: Invalid On Hand', 'ERROR: Invalid Reorder Point', 'ERROR: Invalid Reorder Qty',
    'LOW (alerted 2026-11-20)',
  ]);
  assert.deepEqual(result.newlyLow.map(item => item.sku), ['E']);
});

test('blank, boolean, non-finite, and negative counts fail; numeric strings work', () => {
  for (const value of ['', ' ', null, undefined, true, false, NaN, Infinity, -1]) {
    const input = row();
    input[2] = value;
    assert.match(check([input]).statuses[0], /^ERROR:/);
  }
  assert.match(check([row('A', 1, 5, 0)]).statuses[0], /^ERROR:/);
  assert.equal(check([row('A', '5', '5', '10')]).newlyLow[0].reorderQty, 10);
});

test('invalid or absent rows cannot reset prior alert state', () => {
  const previous = check([row()]).state;
  assert.equal(check([], previous).state.A, '2026-11-20');
  const bad = check([row('A', 'bad')], previous);
  assert.equal(check([row()], bad.state).newlyLow.length, 0);
  const duplicate = check([row('A', 20), row('A', 20)], previous);
  assert.equal(check([row()], duplicate.state).newlyLow.length, 0);
});

test('prototype-like SKUs remain ordinary inventory keys', () => {
  const result = check([row('__proto__'), row('constructor'), row('toString')]);
  assert.equal(result.newlyLow.length, 3);
  assert.equal(check([row('__proto__')], result.state).newlyLow.length, 0);
});

test('invalid persisted state fails closed instead of sending repeat alerts', () => {
  for (const state of [null, [], 'bad', { A: false }]) {
    assert.throws(() => check([row()], state), /Invalid saved alert state/);
  }
});

test('supplier grouping combines addresses and rejects malformed recipients', () => {
  const items = check([
    row('A'), row('B', 1, 5, 10, 'SUPPLY@example.com'), row('C', 1, 5, 10, 'other@example.com'),
    row('D', 1, 5, 10, 'bad'), row('E', 1, 5, 10, 'x@example.com,evil@example.com'),
    row('F', 1, 5, 10, 'x@example.com\nBcc:evil@example.com'),
  ]).newlyLow;
  const result = stock.groupSuppliers_(items);
  assert.deepEqual(Object.keys(result.groups), ['supply@example.com', 'other@example.com']);
  assert.deepEqual(result.groups['supply@example.com'].map(item => item.sku), ['A', 'B']);
  assert.deepEqual(result.invalid, ['D', 'E', 'F']);
});

test('emails escape all sheet text and include plain text and suggested quantities', () => {
  const input = row('<A&"\'>');
  input[1] = '<script>alert("x")</script>';
  const items = check([input]).newlyLow;
  const message = stock.buildStockEmail_(items, false);
  assert.equal(stock.escapeStockHtml_('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.ok(message.htmlBody.includes('&lt;A&amp;&quot;&#39;&gt;'));
  assert.ok(message.htmlBody.includes('&lt;script&gt;'));
  assert.ok(!message.htmlBody.includes('<script>'));
  assert.ok(message.body.includes(input[1]));
  assert.match(message.htmlBody, /<td style="[^"]*text-align:right">10<\/td>/);
  assert.match(message.htmlBody, /<td style="[^"]*text-align:left">&lt;A/);
  assert.match(stock.buildStockEmail_(items, true).subject, /^DRAFT:/);
});

test('digest table has inline Gmail-safe styles', () => {
  const html = stock.buildStockEmail_(check([row()]).newlyLow, false).htmlBody;
  assert.match(html, /<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">/);
  assert.match(html, /<th style="border:1px solid #ddd;padding:6px 10px;text-align:left;background:#f3f4f6">SKU<\/th>/);
  assert.match(html, /<th style="[^"]*text-align:right;background:#f3f4f6">On Hand<\/th>/);
  assert.equal((html.match(/border:1px solid #ddd/g) || []).length, 10);
});

const DEFAULTS = { Recipients: [], 'Email suppliers (TRUE/FALSE)': false, 'Check every N hours (1,2,4,6,8,12)': 1 };

test('parseSettings_ merges rows over defaults, skipping header, blank and unknown keys', () => {
  const result = stock.parseSettings_([
    ['Recipients', 'header row is ignored', ''],
    ['  Recipients ', ' a@example.com, b@example.com\n c@example.com ,', 'help'],
    ['', 'x'], ['Unknown', 'y'],
    ['Email suppliers (TRUE/FALSE)', ' true '],
    ['Check every N hours (1,2,4,6,8,12)', '4'],
  ], DEFAULTS);
  assert.deepEqual(result, {
    Recipients: ['a@example.com', 'b@example.com', 'c@example.com'],
    'Email suppliers (TRUE/FALSE)': true, 'Check every N hours (1,2,4,6,8,12)': 4,
  });
  assert.deepEqual(DEFAULTS.Recipients, []);
});

test('parseSettings_ coerces sheet booleans/numbers, keeps defaults for blanks, rejects bad values', () => {
  const header = ['Setting', 'Value', 'Help'];
  const parsed = stock.parseSettings_([header, ['Email suppliers (TRUE/FALSE)', false],
    ['Check every N hours (1,2,4,6,8,12)', 6], ['Recipients', '']], { ...DEFAULTS, Recipients: ['x@example.com'] });
  assert.equal(parsed['Email suppliers (TRUE/FALSE)'], false);
  assert.equal(parsed['Check every N hours (1,2,4,6,8,12)'], 6);
  assert.deepEqual(parsed.Recipients, []);
  assert.equal(stock.parseSettings_([header, ['Check every N hours (1,2,4,6,8,12)', ' ']], DEFAULTS)[
    'Check every N hours (1,2,4,6,8,12)'], 1);
  assert.deepEqual(stock.parseSettings_([], DEFAULTS), DEFAULTS);
  assert.throws(() => stock.parseSettings_([header, ['Email suppliers (TRUE/FALSE)', 'maybe']], DEFAULTS),
    /row "Email suppliers \(TRUE\/FALSE\)": enter TRUE or FALSE/);
  assert.throws(() => stock.parseSettings_([header, ['Check every N hours (1,2,4,6,8,12)', 'often']], DEFAULTS),
    /row "Check every N hours \(1,2,4,6,8,12\)": enter a number/);
});

test('only entry points lack a trailing underscore (hidden from the Run dropdown)', () => {
  const entryPoints = ['setup', 'onOpen', 'checkStockFromMenu', 'checkStockNow'];
  for (const filename of ['Stock.js', 'Main.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8');
    const names = [...source.matchAll(/^function (\w+)/gm)].map(match => match[1]);
    assert.deepEqual(names.filter(name => !name.endsWith('_') && !entryPoints.includes(name)), [], filename);
  }
});

/** Service fakes verify the glue without contacting Google or sending email. */
// vm arrays come from another realm, so deepEqual needs plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

function fakeSheet(data) {
  return {
    data,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(0, ...data.map(values => values.length)),
    appendRow: values => { data.push(values.slice()); },
    getDataRange: () => ({ getValues: () => (data.length ? data.map(values => values.slice()) : [['']]) }),
    getRange: (r, c, height = 1, width = 1) => ({
      getValues: () => data.slice(r - 1, r - 1 + height).map(values =>
        Array.from({ length: width }, (_, i) => values[c - 1 + i] ?? '')),
      setValue: value => { data[r - 1][c - 1] = value; },
      setValues: values => values.forEach((valuesRow, i) => valuesRow.forEach((value, j) => {
        data[r - 1 + i][c - 1 + j] = value;
      })),
    }),
  };
}

function app({ blank = false } = {}) {
  const sheets = blank ? {} : {
    Inventory: fakeSheet([stock.STOCK_HEADERS.slice(), row(), row('B', 1)]),
    Settings: fakeSheet([['Setting', 'Value', 'Help'], ['Recipients', 'owner@example.com', ''],
      ['Email suppliers (TRUE/FALSE)', false, ''], ['Check every N hours (1,2,4,6,8,12)', 1, '']]),
  };
  const messages = [];
  const alerts = [];
  const menu = [];
  const hours = [];
  const zones = [];
  let saved = null;
  let failDigest = false;
  let released = 0;
  let created = 0;
  const errors = [];
  const trigger = name => ({ getHandlerFunction: () => name });
  let triggers = [trigger('checkStockNow'), trigger('checkStockNow'), trigger('unrelated')];
  const ui = { alert: message => alerts.push(message), createMenu: title => {
    const chain = { addItem: (label, fn) => { menu.push([label, fn]); return chain; }, addToUi: () => menu.unshift(title) };
    return chain;
  } };
  const context = vm.createContext({
    SpreadsheetApp: {
      getUi: () => ui,
      getActive: () => ({
        getSheetByName: name => sheets[name] || null,
        insertSheet: name => (sheets[name] = fakeSheet([])),
        getSpreadsheetTimeZone: () => 'America/New_York',
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => { released++; } }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: () => saved, setProperty: (key, value) => { saved = value; },
    }) },
    Utilities: { formatDate: (date, timeZone) => { zones.push(timeZone); return '2026-11-20'; } },
    MailApp: { sendEmail: message => {
      if (failDigest && !message.subject.startsWith('DRAFT:')) throw new Error('Mail quota exceeded');
      messages.push(message);
    } },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: value => { triggers = triggers.filter(t => t !== value); },
      newTrigger: name => ({ timeBased: () => ({ everyHours: value => {
        hours.push(value);
        return { create: () => { created++; triggers.push(trigger(name)); } };
      } }) }),
    },
    console: { error: message => errors.push(message) },
  });
  for (const filename of ['Stock.js', 'Main.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), context);
  }
  const setting = (key, value) => { sheets.Settings.data.find(values => values[0] === key)[1] = value; };
  return { context, sheets, setting, messages, alerts, menu, hours, zones, errors,
    get data() { return sheets.Inventory.data; },
    get saved() { return saved; }, get released() { return released; }, get created() { return created; },
    get triggers() { return triggers; }, set failDigest(value) { failDigest = value; } };
}

test('onOpen menu lists Setup first, then the menu check', () => {
  const a = app();
  a.context.onOpen();
  assert.deepEqual(plain(a.menu), ['Stock Alerts', ['Setup / re-run setup', 'setup'], ['Check stock now', 'checkStockFromMenu']]);
});

test('setup on a blank spreadsheet creates Settings and Inventory, then asks for Recipients', () => {
  const a = app({ blank: true });
  a.context.setup();
  assert.deepEqual(plain(a.sheets.Settings.data.map(values => values.slice(0, 2))), [
    ['Setting', 'Value'], ['Recipients', ''], ['Email suppliers (TRUE/FALSE)', false],
    ['Check every N hours (1,2,4,6,8,12)', 1],
  ]);
  assert.ok(a.sheets.Settings.data.slice(1).every(values => values[2]));
  assert.deepEqual(plain(a.data[0]), [...stock.STOCK_HEADERS, 'Alert Status']);
  assert.equal(a.data.length, 3);
  assert.deepEqual(a.hours, [1]);
  assert.match(a.alerts[0], /Setup complete[\s\S]*Created the Inventory tab[\s\S]*fill the "Recipients" row/);
  a.context.checkStockFromMenu();
  assert.match(a.alerts[1], /Fill the "Recipients" row in the Settings tab/);
  assert.equal(a.messages.length, 0);
});

test('setup is repeatable, keeps buyer values, uses the hours setting, preserves unrelated triggers', () => {
  const a = app();
  a.setting('Recipients', 'me@shop.com, you@shop.com');
  a.setting('Check every N hours (1,2,4,6,8,12)', 4);
  a.sheets.Settings.data.pop();
  a.sheets.Settings.data.push(['Check every N hours (1,2,4,6,8,12)', 4, 'buyer note']);
  a.sheets.Settings.data.splice(2, 1);
  a.context.setup();
  a.context.setup();
  assert.equal(a.sheets.Settings.data.length, 4);
  assert.deepEqual(plain(a.sheets.Settings.data[1]), ['Recipients', 'me@shop.com, you@shop.com', '']);
  assert.deepEqual(plain(a.sheets.Settings.data[2]), ['Check every N hours (1,2,4,6,8,12)', 4, 'buyer note']);
  assert.equal(a.sheets.Settings.data[3][0], 'Email suppliers (TRUE/FALSE)');
  assert.deepEqual(a.hours, [4, 4]);
  assert.equal(a.created, 2);
  assert.equal(a.triggers.filter(t => t.getHandlerFunction() === 'checkStockNow').length, 1);
  assert.equal(a.triggers.filter(t => t.getHandlerFunction() === 'unrelated').length, 1);
  assert.equal(a.data[0].filter(value => value === 'Alert Status').length, 1);
  assert.match(a.alerts[0], /Added Settings rows: Email suppliers[\s\S]*every 4 hour/);
  assert.match(a.alerts[1], /Next: choose Stock Alerts → Check stock now/);
});

test('setup rejects unsupported hours without replacing the existing trigger', () => {
  const a = app();
  a.setting('Check every N hours (1,2,4,6,8,12)', 3);
  a.context.setup();
  assert.match(a.alerts[0], /row "Check every N hours \(1,2,4,6,8,12\)": enter one of 1, 2, 4, 6, 8, 12/);
  assert.equal(a.created, 0);
  assert.equal(a.triggers.length, 3);
});

test('glue sends one digest, persists state, writes statuses, and suppresses repeats', () => {
  const a = app();
  a.context.checkStockNow();
  a.context.checkStockNow();
  assert.equal(a.messages.length, 1);
  assert.equal(a.messages[0].to, 'owner@example.com');
  assert.match(a.messages[0].subject, /2 SKU/);
  assert.equal(JSON.parse(a.saved).A, '2026-11-20');
  assert.equal(a.data[1][6], 'LOW (alerted 2026-11-20)');
  assert.deepEqual(a.zones, ['America/New_York', 'America/New_York']);
  assert.equal(a.released, 2);
  a.data[1][2] = 6;
  a.context.checkStockNow();
  assert.equal(a.data[1][6], 'OK');
  a.data[1][2] = 5;
  a.context.checkStockNow();
  assert.equal(a.messages.length, 2);
  assert.match(a.messages[1].subject, /1 SKU/);
});

test('menu check reports the result in an alert; several recipients join into one digest', () => {
  const a = app();
  a.setting('Recipients', 'a@shop.com\nb@shop.com');
  a.context.checkStockFromMenu();
  a.context.checkStockFromMenu();
  assert.equal(a.messages[0].to, 'a@shop.com,b@shop.com');
  assert.match(a.alerts[0], /Checked 2 row\(s\)\. 2 newly low SKU\(s\) emailed to a@shop.com, b@shop.com/);
  assert.match(a.alerts[1], /No newly low SKUs/);
});

test('failed digest does not commit alert state and always releases lock', () => {
  const a = app();
  a.failDigest = true;
  assert.throws(() => a.context.checkStockNow(), /Mail quota exceeded/);
  assert.equal(a.saved, null);
  assert.equal(a.released, 1);
  a.failDigest = false;
  a.context.checkStockNow();
  assert.equal(a.messages.length, 1);
});

test('supplier option sends grouped requests only once and skips invalid emails', () => {
  const a = app();
  a.setting('Email suppliers (TRUE/FALSE)', true);
  a.data.push(row('C', 1, 5, 10, 'bad'));
  a.context.checkStockNow();
  a.context.checkStockNow();
  assert.equal(a.messages.length, 2);
  assert.equal(a.messages[1].to, 'supply@example.com');
  assert.match(a.messages[1].subject, /^DRAFT:/);
  assert.match(a.errors[0], /Skipped invalid supplier emails for SKUs: C/);
});

test('invalid digest recipients leave state uncommitted', () => {
  const a = app();
  a.setting('Recipients', 'owner@example.com, bad');
  assert.throws(() => a.context.checkStockNow(), /Fill the "Recipients" row/);
  assert.equal(a.messages.length, 0);
  assert.equal(a.saved, null);
  assert.equal(a.released, 1);
});

test('missing Settings tab tells the buyer to run Setup', () => {
  const a = app();
  delete a.sheets.Settings;
  assert.throws(() => a.context.checkStockNow(), /Settings tab is missing\. Choose Stock Alerts → Setup/);
});

test('supplier failure preserves digest state and does not block another supplier', () => {
  const a = app();
  a.setting('Email suppliers (TRUE/FALSE)', 'TRUE');
  a.data[2][5] = 'other@example.com';
  const send = a.context.MailApp.sendEmail;
  a.context.MailApp.sendEmail = message => {
    if (message.to === 'supply@example.com') throw new Error('Supplier send failed');
    send(message);
  };
  a.context.checkStockNow();
  a.context.checkStockNow();
  assert.equal(a.messages.length, 2);
  assert.equal(a.messages[1].to, 'other@example.com');
  assert.equal(JSON.parse(a.saved).A, '2026-11-20');
  assert.match(a.errors[0], /Supplier email failed/);
});
