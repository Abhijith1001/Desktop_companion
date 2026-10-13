import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { evaluate, format } from '../../src/utils/calc.js';
const require = createRequire(import.meta.url);
const { open } = require('../../electron/database/db');
const { createNoteService } = require('../../electron/services/notes');
const { createHandlers } = require('../../electron/ipc/handlers');

describe('calculator', () => {
  it.each([
    ['1 + 2 × 3', '7'],
    ['(1 + 2) × 3', '9'],
    ['0.1 + 0.2', '0.3'],
    ['2 ^ 3 ^ 2', '512'],
    ['-3 ^ 2', '9'],
    ['10 ÷ 4', '2.5'],
    ['50%', '0.5'],
    ['200 × 15%', '30'],
    ['10 % 3', '1'],
    ['√(16) + 1', '5'],
    ['−5 − −5', '0'],
    ['1e20 × 10', '1e+21'],
    ['1e+21 ÷ 1e20', '10'],
  ])('%s = %s', (expr, want) => expect(format(evaluate(expr))).toBe(want));

  it.each([
    ['1 ÷ 0', /divide by zero/],
    ['(1 + 2', /Missing \)/],
    ['1 + 2)', /Unmatched/],
    ['2 +', /Incomplete/],
    ['alert(1)', /Unexpected/],
    ['√(-4)', /negative/],
    ['10 ^ 400', /too large/],
  ])('rejects %s', (expr, msg) => expect(() => evaluate(expr)).toThrow(msg));
});

describe('notepad', () => {
  function setup() {
    const db = open(':memory:');
    let t = Date.parse('2026-10-12T08:00:00.000Z');
    const notes = createNoteService({ db, clock: () => new Date(t += 1000) });
    const copyText = vi.fn();
    return { h: createHandlers({ notes, copyText }), copyText };
  }

  it('creates, edits, lists newest first, searches and deletes', () => {
    const { h, copyText } = setup();
    const a = h['notes:create']({ title: 'Groceries', body: 'milk\neggs' });
    const b = h['notes:create']();
    h['notes:update'](b.id, { body: '100% done_ish' });
    expect(h['notes:list']().map((n) => n.id)).toEqual([b.id, a.id]);
    expect(h['notes:list']('EGGS').map((n) => n.id)).toEqual([a.id]);
    expect(h['notes:list']('%').map((n) => n.id)).toEqual([b.id]); // LIKE wildcards are escaped
    expect(h['notes:list']('_').map((n) => n.id)).toEqual([b.id]);
    h['notes:copy'](a.id);
    expect(copyText).toHaveBeenCalledWith('milk\neggs');
    h['notes:delete'](a.id);
    expect(() => h['notes:get'](a.id)).toThrow(/not found/);
  });

  it('validates input', () => {
    const { h } = setup();
    expect(() => h['notes:create']({ title: 'x', owner: 'me' })).toThrow();
    expect(() => h['notes:update']('nope', { body: 'x' })).toThrow(/id/);
    expect(() => h['notes:create']({ body: 'x'.repeat(1_000_001) })).toThrow(/too long/);
  });
});
