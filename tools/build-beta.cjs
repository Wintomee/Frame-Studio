// Builds the beta copy that GitHub Pages serves at /beta/, next to the main app.
// Usage: node tools/build-beta.cjs <path to the beta branch's index.html> <version>
// The beta keeps its own data (IndexedDB, localStorage), its own offline cache and its own home-screen name,
// so trying it never touches the photos in the main app. It shares places.txt and the icons with the main app.
const fs = require('fs'), path = require('path');
const [src, ver] = process.argv.slice(2);
if (!src || !ver) { console.error('usage: node tools/build-beta.cjs <index.html> <version>'); process.exit(1); }
const root = path.join(__dirname, '..'), out = path.join(root, 'beta');
fs.mkdirSync(out, { recursive: true });
const swap = (s, a, b) => { if (!s.includes(a)) throw new Error('beta build: not found: ' + a); return s.split(a).join(b); };
let html = fs.readFileSync(src, 'utf8');
html = swap(html, "indexedDB.open('frame-studio-v2'", "indexedDB.open('frame-studio-beta'");
html = swap(html, "localStorage.getItem('fs-'+k)", "localStorage.getItem('fsb-'+k)");
html = swap(html, "localStorage.setItem('fs-'+k,v)", "localStorage.setItem('fsb-'+k,v)");
html = swap(html, "fetch('places.txt')", "fetch('../places.txt')");
html = swap(html, 'href="icons/apple-touch-icon.png"', 'href="../icons/apple-touch-icon.png"');
html = swap(html, '<title>Frame Studio</title>', '<title>Frame Studio β</title>');
fs.writeFileSync(path.join(out, 'index.html'), html);
const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
man.name = 'Frame Studio β'; man.short_name = 'Frame β';
man.icons = man.icons.map(i => ({ ...i, src: '../' + i.src }));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(man, null, 2) + '\n');
let sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
sw = sw.replace(/const VERSION = '[^']+';/, `const VERSION = 'fsb-${ver}';`);
sw = swap(sw, "'./places.txt'", "'../places.txt'");
sw = sw.replace(/'\.\/icons\//g, "'../icons/");
sw = sw.replace(/if \(url\.pathname\.includes\('\/beta\/'\)\) return;[^\n]*\n/, ''); // that guard is for the main worker only
fs.writeFileSync(path.join(out, 'sw.js'), sw);
console.log('beta built:', ver);
