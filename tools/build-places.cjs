// Builds places.txt (offline town list for location labels) from the all-the-cities npm package (GeoNames data,
// CC BY 4.0). Usage: npm pack all-the-cities@3.1.0 && tar xzf all-the-cities-3.1.0.tgz && npm i pbf@3.2.1
//        node tools/build-places.cjs package/cities.pbf > places.txt
// Kept: Europe from 1,000 people (fewer small towns let a border village win: Plitvice came out in Bosnia), the world from 15,000.
// Format, one place per line: name|country|lat*1000|lon*1000|population
const Pbf = require('pbf'), fs = require('fs');
const pbf = new Pbf(fs.readFileSync(process.argv[2])), rows = [];
let lastLat = 0, lastLon = 0;
while (pbf.pos < pbf.length) rows.push(pbf.readMessage((tag, c, p) => {
  if (tag === 2) c.name = p.readString(); else if (tag === 3) c.cc = p.readString();
  else if (tag === 7) c.fc = p.readString(); else if (tag === 9) c.pop = p.readVarint();
  else if (tag === 1) p.readSVarint(); else if (tag === 4 || tag === 5 || tag === 6 || tag === 8) p.readString();
  else if (tag === 10) { lastLon += p.readSVarint(); c.lon = lastLon / 1e5 } else if (tag === 11) { lastLat += p.readSVarint(); c.lat = lastLat / 1e5 }
}, { name: '', cc: '', fc: '', pop: 0, lat: 0, lon: 0 }));
const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE GB NO CH IS LI MC SM VA AD AL BA ME MK RS XK MD UA BY'.split(' '));
const keep = rows.filter(x => x.fc !== 'PPLX' && x.name && !x.name.includes('|') &&
  (EU.has(x.cc) || x.pop >= 15000));
process.stdout.write(keep.map(x => [x.name, x.cc, Math.round(x.lat * 1000), Math.round(x.lon * 1000), x.pop].join('|')).join('\n') + '\n');
