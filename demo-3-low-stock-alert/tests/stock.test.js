// Run: node --test demo-3-low-stock-alert/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stock = require('../src/Stock.js');

const row = (sku = 'A', onHand = 5, point = 5, qty = 10, email = 'supply@example.com') =>
  [sku, 'Widget', onHand, point, qty, email];
const check = (rows, state = {}, date = '2026-11-20') => stock.evaluateStock(rows, state, date);

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
  const result = stock.groupSuppliers(items);
  assert.deepEqual(Object.keys(result.groups), ['supply@example.com', 'other@example.com']);
  assert.deepEqual(result.groups['supply@example.com'].map(item => item.sku), ['A', 'B']);
  assert.deepEqual(result.invalid, ['D', 'E', 'F']);
});

test('emails escape all sheet text and include plain text and suggested quantities', () => {
  const input = row('<A&"\'>');
  input[1] = '<script>alert("x")</script>';
  const items = check([input]).newlyLow;
  const message = stock.buildStockEmail(items, false);
  assert.equal(stock.escapeStockHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.ok(message.htmlBody.includes('&lt;A&amp;&quot;&#39;&gt;'));
  assert.ok(message.htmlBody.includes('&lt;script&gt;'));
  assert.ok(!message.htmlBody.includes('<script>'));
  assert.ok(message.body.includes(input[1]));
  assert.ok(message.htmlBody.includes('<td>10</td>'));
  assert.match(stock.buildStockEmail(items, true).subject, /^DRAFT:/);
});

/** Service fakes verify the glue without contacting Google or sending email. */
function app() {
  const data = [stock.STOCK_HEADERS.slice(), row(), row('B', 1)];
  const messages = [];
  let saved = null;
  let failDigest = false;
  let released = 0;
  let created = 0;
  const deleted = [];
  const errors = [];
  const sheet = {
    getLastColumn: () => data[0].length,
    getDataRange: () => ({ getValues: () => data.map(values => values.slice()) }),
    getRange: (r, c, height = 1, width = 1) => ({
      getValues: () => data.slice(r - 1, r - 1 + height).map(values =>
        Array.from({ length: width }, (_, i) => values[c - 1 + i] ?? '')),
      setValue: value => { data[r - 1][c - 1] = value; },
      setValues: values => values.forEach((valuesRow, i) => valuesRow.forEach((value, j) => {
        data[r - 1 + i][c - 1 + j] = value;
      })),
    }),
  };
  const trigger = name => ({ getHandlerFunction: () => name });
  let triggers = [trigger('checkStockNow'), trigger('checkStockNow'), trigger('unrelated')];
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => sheet }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => { released++; } }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: () => saved, setProperty: (key, value) => { saved = value; },
    }) },
    Utilities: { formatDate: () => '2026-11-20' },
    Session: { getScriptTimeZone: () => 'Asia/Ho_Chi_Minh' },
    MailApp: { sendEmail: message => {
      if (failDigest && !message.subject.startsWith('DRAFT:')) throw new Error('Mail quota exceeded');
      messages.push(message);
    } },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: value => { deleted.push(value); triggers = triggers.filter(t => t !== value); },
      newTrigger: name => ({ timeBased: () => ({ everyHours: hours => {
        assert.equal(hours, 1);
        return { create: () => { created++; triggers.push(trigger(name)); } };
      } }) }),
    },
    console: { error: message => errors.push(message) },
  });
  for (const filename of ['Stock.js', 'Main.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), context);
  }
  return { context, data, messages, deleted, errors, get saved() { return saved; },
    get released() { return released; }, get created() { return created; },
    get triggers() { return triggers; }, set failDigest(value) { failDigest = value; } };
}

test('setup is repeatable and preserves unrelated triggers', () => {
  const a = app();
  a.context.setup();
  a.context.setup();
  assert.equal(a.created, 2);
  assert.equal(a.triggers.filter(t => t.getHandlerFunction() === 'checkStockNow').length, 1);
  assert.equal(a.triggers.filter(t => t.getHandlerFunction() === 'unrelated').length, 1);
  assert.equal(a.data[0].filter(value => value === 'Alert Status').length, 1);
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
  assert.equal(a.released, 2);
  a.data[1][2] = 6;
  a.context.checkStockNow();
  assert.equal(a.data[1][6], 'OK');
  a.data[1][2] = 5;
  a.context.checkStockNow();
  assert.equal(a.messages.length, 2);
  assert.match(a.messages[1].subject, /1 SKU/);
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
  a.context.CONFIG.EMAIL_SUPPLIERS = true;
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
  a.context.CONFIG.RECIPIENTS = ['bad'];
  assert.throws(() => a.context.checkStockNow(), /valid email addresses/);
  assert.equal(a.messages.length, 0);
  assert.equal(a.saved, null);
  assert.equal(a.released, 1);
});

test('supplier failure preserves digest state and does not block another supplier', () => {
  const a = app();
  a.context.CONFIG.EMAIL_SUPPLIERS = true;
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
