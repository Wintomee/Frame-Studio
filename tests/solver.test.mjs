// Pure-logic tests for the layout solver. No dependencies: `node tests/solver.test.mjs`
// The solver lives between /*SOLVER-START*/ and /*SOLVER-END*/ in index.html and must stay DOM-free.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.split('/*SOLVER-START*/')[1].split('/*SOLVER-END*/')[0];
const S = new Function(src + ';return {LAYOUTS,rectsOf,bestPage,suggestionsFor,bestSplit,compose,clustersOf,validPage};')();

const L = (d, id) => ({ id: 'L' + id, w: 4032, h: 3024, date: d });
const P = (d, id) => ({ id: 'P' + id, w: 3024, h: 4032, date: d });
const R = { dates: 1, portrait: true, minKeep: .8, maxUp: 1, minArea: .08, min: 2, max: 4, pad: .04, ins: 0 };
let n = 0; const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('rects tile the 4K canvas with equal padding', () => {
  for (const L0 of S.LAYOUTS) {
    const rs = S.rectsOf(L0, .04, 0), p = Math.round(.04 * 2160);
    assert.equal(Math.min(...rs.map(r => r.x)), p);
    assert.equal(Math.min(...rs.map(r => r.y)), p);
    assert.equal(Math.max(...rs.map(r => r.x + r.w)), 3840 - p);
    assert.equal(Math.max(...rs.map(r => r.y + r.h)), 2160 - p);
  }
});

test('1 horizontal + 3 verticals is never squeezed into one image', () => {
  const pages = S.compose([L(0, 1), P(1, 2), P(2, 3), P(3, 4)], R);
  assert.ok(pages.length >= 2, 'expected a split');
  // (no fully valid grouping exists for this set: two verticals end up alone together)
  for (const pg of pages) assert.ok(pg.score.minArea >= R.minArea, 'no postage-stamp photos');
});

test('2 verticals + 2 horizontals keeps a decent crop', () => {
  const b = S.bestPage([P(0, 1), L(1, 2), L(2, 3), P(3, 4)], R);
  assert.ok(b.score.minKeep >= .8, 'minKeep ' + b.score.minKeep);
});

test('moments: bursts, trip days and a location jump', () => {
  const MIN = 60e3, H = 3600e3, D = 24 * H; let t = Date.UTC(2026, 5, 1, 9), i = 0; const ph = [];
  const add = (k, step, tag, lat, lon) => { for (let j = 0; j < k; j++) { ph.push({ id: tag + i++, tag, date: t, w: 4032, h: 3024, lat, lon }); t += step; } };
  add(8, 5 * MIN, 'A'); t += 3 * H; add(6, 10 * MIN, 'B'); t += 20 * H; add(5, 15 * MIN, 'C');
  t += 7 * D; for (let d = 0; d < 5; d++) { add(3, 30 * MIN, 'T'); t += D - 90 * MIN; }
  t += 14 * D; add(4, 2 * MIN, 'Prague', 50.08, 14.42); t += 40 * MIN; add(4, 2 * MIN, 'Paris', 48.85, 2.35);
  const tags = cl => cl.map(c => [...new Set(c.map(p => p.tag))].join(''));
  assert.deepEqual(tags(S.clustersOf(ph, { ...R, dates: 1 })), ['A', 'B', 'C', 'T', 'Prague', 'Paris']);
  assert.equal(S.clustersOf(ph, { ...R, dates: 2 }).length, 10); // Max splits the trip per day
});

test('100 photos in one moment: chunked, fast, all images valid', () => {
  const shapes = [[4032, 3024], [3024, 4032], [3840, 2160], [3024, 3024]], pool = [];
  for (let i = 0; i < 100; i++) { const [w, h] = shapes[(i * 7 + (i >> 2)) % 4]; pool.push({ id: 'x' + i, w, h, date: i * 3 * 60e3 }); }
  for (const dates of [0, 1]) {
    const t0 = Date.now(), pages = S.compose(pool, { ...R, dates });
    assert.equal(pages.flatMap(pg => pg.photos).length, 100, 'every photo placed once');
    assert.ok(pages.every(pg => S.validPage(pg, { ...R, dates })), 'all images pass the rules');
    assert.ok(Date.now() - t0 < 15000, 'took ' + (Date.now() - t0) + 'ms');
  }
});

console.log(`\n${n} tests passed`);
