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

test('hero: a vertical takes the full height, within the rules', () => {
  const R2 = { ...R, portrait: false }, hero = { ...P(3, 9), hero: true }, b = S.bestPage([P(0, 1), hero], R2);
  const rs = S.rectsOf(b.L, R.pad, 0), i = b.photos.indexOf(hero), ih = 2160 - 2 * Math.round(R.pad * 2160);
  assert.ok(S.validPage(b, R2), 'passes the rules');
  assert.ok(rs[i].h >= ih - 1, 'hero height ' + rs[i].h + ' of ' + ih);
});

test('hero never breaks the rules when a valid layout exists (square hero)', () => {
  const sq = { id: 'Q', w: 3024, h: 3024, date: 5, hero: true };
  for (const set of [[L(0, 1), P(1, 2), sq], [L(0, 1), L(1, 2), sq]]) assert.ok(S.validPage(S.bestPage(set, R), R));
});

test('a square partners a vertical (portrait rule)', () => {
  const sq = { id: 'Q', w: 3024, h: 3024, date: 5, hero: true }, b = S.bestPage([sq, P(1, 2)], { ...R, pad: .06 });
  assert.ok(S.validPage(b, { ...R, pad: .06 }), 'square + vertical passes the rules');
  const rs = S.rectsOf(b.L, .06, 0), i = b.photos.indexOf(sq);
  assert.ok(rs[i].h >= 2160 - 2 * Math.round(.06 * 2160) - 1, 'square hero takes the full height');
});

test('bigger photos: mostly 2 per image', () => {
  const pool = []; for (let i = 0; i < 24; i++) pool.push((i % 5 < 3 ? L : P)(i * 60e3, i));
  const per = big => { const pg = S.compose(pool, { ...R, dates: 0, big }); return pool.length / pg.length; };
  const a = per(false), b = per(true);
  assert.ok(b < a && b <= 2.5, `avg per image ${a.toFixed(2)} → ${b.toFixed(2)}`);
});

// location labels: the LABELS block uses kmBetween from the solver
const lsrc = html.split('/*LABELS-START*/')[1].split('/*LABELS-END*/')[0];
const LB = new Function(src + lsrc + ';return {parsePlaces,placeAt,czDate,placeText,labelText,poiQuery,poiPick,poiBatchQuery,poiSplit};')();
const grid = LB.parsePlaces(readFileSync(new URL('../places.txt', import.meta.url), 'utf8'));
const cn = cc => new Intl.DisplayNames(['cs'], { type: 'region' }).of(cc);

test('places: city outskirts say the city, Czech names, abroad gets Czech names', () => {
  const at = (la, lo) => LB.placeAt(grid, la, lo);
  assert.equal(at(50.0875, 14.4213).name, 'Praha');            // Old Town Square
  assert.equal(at(50.1003, 14.3415).name, 'Praha');            // Prague 6, next to Horoměřice
  assert.equal(at(49.1951, 16.6068).name, 'Brno');
  assert.equal(at(48.8106, 14.3154).name, 'Český Krumlov');
  assert.deepEqual(at(48.2082, 16.3738), { name: 'Vídeň', cc: 'AT' });
  assert.deepEqual(at(48.8584, 2.2945), { name: 'Paříž', cc: 'FR' });   // Eiffel Tower
});

test('places: holiday islands by island name, mainland next to them is not', () => {
  const at = (la, lo) => LB.placeAt(grid, la, lo);
  assert.deepEqual(at(28.2724, -16.6425), { name: 'Tenerife', cc: 'ES' });     // Teide summit
  assert.deepEqual(at(39.5696, 2.6502), { name: 'Mallorka', cc: 'ES' });       // Palma
  assert.equal(at(38.1938, 15.5540).name, 'Sicílie');                          // Messina
  assert.notEqual(at(38.1110, 15.6475).name, 'Sicílie');                       // Reggio Calabria, across the strait
  assert.equal(at(39.6243, 19.9217).name, 'Korfu');
  assert.notEqual(at(39.7454, 20.0207).name, 'Korfu');                         // Butrint, Albania
  assert.equal(at(35.3387, 25.1442).name, 'Kréta');                            // Heraklion
});

test('label text: dates in Czech, place only abroad on auto, two places and countries', () => {
  const d = (y, m) => new Date(y, m, 15).getTime(), P = (name, cc) => ({ name, cc });
  assert.equal(LB.czDate([d(2025, 7), d(2025, 7)]), 'srpen 2025');
  assert.equal(LB.czDate([d(2025, 7), d(2025, 8)]), 'srpen – září 2025');
  assert.equal(LB.czDate([d(2024, 11), d(2025, 0)]), 'prosinec 2024 – leden 2025');
  assert.equal(LB.labelText([P('Praha', 'CZ'), P('Brno', 'CZ')], [d(2025, 5)], 'auto', cn), 'červen 2025');
  assert.equal(LB.labelText([P('Praha', 'CZ'), P('Brno', 'CZ')], [d(2025, 5)], 'both', cn), 'Praha · Brno · červen 2025');
  assert.equal(LB.labelText([P('Paříž', 'FR'), P('Paříž', 'FR'), P('Lyon', 'FR')], [d(2025, 6)], 'auto', cn), 'Paříž & Lyon, Francie · červenec 2025');
  assert.equal(LB.labelText([P('Paříž', 'FR'), P('Lyon', 'FR'), P('Nice', 'FR')], [d(2025, 6)], 'auto', cn), 'Paříž · Lyon · Nice, Francie · červenec 2025');
  assert.equal(LB.labelText([P('Paříž', 'FR'), P('Vídeň', 'AT'), P('Lyon', 'FR')], [d(2025, 6)], 'auto', cn), 'Paříž, Francie · Vídeň, Rakousko · Lyon, Francie · červenec 2025');
  assert.equal(LB.labelText([P('Paříž', 'FR'), P('Lyon', 'FR'), P('Vídeň', 'AT')], [d(2025, 6)], 'auto', cn), 'Paříž & Lyon, Francie · Vídeň, Rakousko · červenec 2025');
  assert.equal(LB.labelText([P('Vídeň', 'AT'), P('Brno', 'CZ')], [d(2025, 6)], 'auto', cn), 'Vídeň, Rakousko · Brno · červenec 2025');
  assert.equal(LB.labelText([], [d(2025, 6)], 'auto', cn), 'červenec 2025');
  assert.equal(LB.labelText([P('Praha', 'CZ')], [d(2025, 6)], 'off', cn), '');
  const many = [P('Praha', 'CZ'), P('Brno', 'CZ'), P('Brno', 'CZ'), P('Olomouc', 'CZ'), P('Zlín', 'CZ')];
  assert.equal(LB.labelText(many, [d(2025, 6)], 'both', cn), 'Praha · Brno · Olomouc · Zlín · červenec 2025');
});

test('landmarks: picks what you stand in, then a sight nearby, then the national park; auto at home shows only landmarks', () => {
  const area = (name, tags, b) => ({ type: 'way', tags: { name, ...tags }, bounds: b });
  const pt = (name, tags, lat, lon) => ({ type: 'node', tags: { name, ...tags }, lat, lon });
  const box = (la, lo, d) => ({ minlat: la - d, minlon: lo - d, maxlat: la + d, maxlon: lo + d });
  // Stromovka: standing in the park, a pavilion 120 m away -> the park
  assert.deepEqual(LB.poiPick({ elements: [area('Královská obora', { leisure: 'park', 'name:cs': 'Stromovka' }, box(50.106, 14.422, .006)),
    pt('Místodržitelský letohrádek', { historic: 'castle' }, 50.1065, 14.4235)] }, 50.106, 14.422), { name: 'Stromovka' });
  // Teide: inside the national park, nothing small around -> the national park, Czech name
  assert.deepEqual(LB.poiPick({ elements: [area('Parque Nacional del Teide', { boundary: 'national_park', 'name:cs': 'Národní park Teide' }, box(28.27, -16.64, .12))] }, 28.2724, -16.6425), { name: 'Národní park Teide' });
  // a sight nearby beats the big national park; a landscape protected area (class 5) is ignored
  assert.deepEqual(LB.poiPick({ elements: [area('Šumava', { boundary: 'national_park' }, box(49, 13.5, .4)), area('CHKO X', { boundary: 'protected_area', protect_class: '5' }, box(50, 14, .01)),
    pt('Černé jezero', { natural: 'waterfall' }, 49.1805, 13.1810)] }, 49.1800, 13.1800), { name: 'Černé jezero' });
  assert.equal(LB.poiPick({ elements: [] }, 50, 14), null);
  assert.match(LB.poiQuery(50.1, 14.4), /is_in\(50\.1,14\.4\).*around:150,50\.1,14\.4/);
  assert.doesNotMatch(LB.poiQuery(50.1, 14.4), /\[~"/);                    // no regex over key names (slow)
  const q = LB.poiBatchQuery(['50.088,14.421', '48.858,2.294']);
  assert.match(q, /^\[out:json\].*make spot k="50\.088,14\.421";out;is_in\(50\.088,14\.421\).*make spot k="48\.858,2\.294";out;is_in\(48\.858,2\.294\)/);
  const parts = LB.poiSplit({ elements: [{ type: 'spot', tags: { k: 'a' } }, { type: 'node', id: 1 }, { type: 'spot', tags: { k: 'b' } }, { type: 'spot', tags: { k: 'c' } }, { type: 'way', id: 2 }] });
  assert.deepEqual([...parts].map(([k, v]) => [k, v.length]), [['a', 1], ['b', 0], ['c', 1]]);
  const d = new Date(2025, 8, 3).getTime(), P = (name, cc, poi) => ({ name, cc, poi });
  assert.equal(LB.labelText([P('Praha', 'CZ'), P('Stromovka', 'CZ', true)], [d], 'auto', cn), 'Stromovka · září 2025');
  assert.equal(LB.labelText([P('Praha', 'CZ'), P('Praha', 'CZ')], [d], 'auto', cn), 'září 2025');
  assert.equal(LB.labelText([P('Národní park Teide', 'ES', true)], [d], 'auto', cn), 'Národní park Teide, Španělsko · září 2025');
});

console.log(`\n${n} tests passed`);
