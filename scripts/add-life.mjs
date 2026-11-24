/**
 * Add animal and plant common names from Wikipedia category pages.
 * Merges into cats/<lang>.json written by build-cats.mjs.
 */
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const CATS = {
  he: {
    animal: ['יונקים','עופות','דגים','חרקים','זוחלים','דינוזאורים','דו-חיים'],
    plant: ['עצים','פרחים','פירות','ירקות','עשבי תיבול','צמחים'],
  },
  en: {
    animal: ['Mammals','Birds','Fish','Insects','Reptiles','Dinosaurs','Amphibians'],
    plant: ['Trees','Flowers','Edible fruits','Vegetables','Herbs','Plants'],
  },
  nl: {
    animal: ['Zoogdieren','Vogels','Vissen','Insecten','Reptielen','Dinosauriërs','Amfibieën'],
    plant: ['Bomen','Bloemen','Vruchten','Groenten','Kruiden','Planten'],
  },
  pt: {
    animal: ['Mamíferos','Aves','Peixes','Insetos','Répteis','Dinossauros','Anfíbios'],
    plant: ['Árvores','Flores','Frutas','Vegetais','Ervas','Plantas'],
  },
};
const PREFIX = { he: 'קטגוריה:', en: 'Category:', nl: 'Categorie:', pt: 'Categoria:' };
const HOST = { he: 'he', en: 'en', nl: 'nl', pt: 'pt' };

function tokens(raw, he) {
  if (he) {
    let s = String(raw).replace(/[\u0591-\u05C7]/g, '');
    s = s.replace(/[ךםןףץ]/g, ch => FINALS[ch] || ch);
    const parts = s.match(/[\u05D0-\u05EA]+/g);
    if (!parts) return [];
    if (parts.length === 1) return parts[0].length >= 2 && parts[0].length <= 18 ? [parts[0]] : [];
    const joined = parts.join('');
    return joined.length >= 2 && joined.length <= 18 ? [joined] : [];
  }
  const s = String(raw).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase();
  const parts = s.match(/[a-z]+/g);
  if (!parts) return [];
  if (parts.length === 1) return parts[0].length >= 2 && parts[0].length <= 22 ? [parts[0]] : [];
  const joined = parts.join('');
  return joined.length >= 2 && joined.length <= 22 ? [joined] : [];
}

async function members(lang, title) {
  const names = [];
  let cont = '';
  for (let page = 0; page < 4; page++) {
    const url = new URL('https://' + HOST[lang] + '.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'categorymembers');
    url.searchParams.set('cmtitle', PREFIX[lang] + title);
    url.searchParams.set('cmlimit', '500');
    url.searchParams.set('cmtype', 'page');
    url.searchParams.set('format', 'json');
    if (cont) url.searchParams.set('cmcontinue', cont);
    const res = await fetch(url, { headers: { 'User-Agent': 'HilinGo (educational word game)' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(res.status + ' ' + title);
    const json = await res.json();
    const ms = (json.query && json.query.categorymembers) || [];
    ms.forEach(m => names.push(m.title));
    cont = json.continue && json.continue.cmcontinue;
    if (!cont) break;
  }
  return names;
}

for (const lang of Object.keys(CATS)) {
  const file = path.join(ROOT, 'cats', lang + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const he = lang === 'he';
  for (const kind of ['animal', 'plant']) {
    const set = new Set(data[kind] || []);
    for (const title of CATS[lang][kind]) {
      try {
        const names = await members(lang, title);
        let n = 0;
        for (const name of names) for (const t of tokens(name, he)) { if (!set.has(t)) { set.add(t); n++; } }
        console.log(lang, kind, title, names.length, 'new', n);
      } catch (err) {
        console.log('FAIL', lang, title, err.message);
      }
    }
    data[kind] = [...set].sort();
  }
  let text = JSON.stringify(data);
  if (text.length > 145000) {
    while (text.length > 145000 && data.city.length > 400) { data.city.pop(); text = JSON.stringify(data); }
  }
  fs.writeFileSync(file, text);
  console.log(lang, 'bytes', text.length, 'gzip', gzipSync(Buffer.from(text)).length, Object.fromEntries(['country','city','animal','plant'].map(k => [k, data[k].length])));
}
