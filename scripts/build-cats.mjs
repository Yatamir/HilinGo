/**
 * Build compact category lists from Wikidata.
 *   node scripts/build-cats.mjs
 */
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'cats');
const LANGS = ['he', 'en', 'nl', 'pt', 'es', 'it'];
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

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

async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(28000),
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'HilinGo (educational word game; category list build)',
    },
  });
  if (!res.ok) throw new Error('sparql ' + res.status);
  const json = await res.json();
  return json.results.bindings.map(b => b.name && b.name.value).filter(Boolean);
}

async function grab(label, query) {
  try {
    const names = await sparql(query);
    console.log('  ', label, names.length);
    return names;
  } catch (err) {
    console.log('  FAIL', label, err.message);
    return [];
  }
}

function addAll(set, names, he) {
  for (const name of names) for (const t of tokens(name, he)) set.add(t);
}

const seeds = {
  he: {
    country: ['צרפת','ישראל','ברזיל','ספרד','איטליה','יוון','גרמניה','אנגליה','מצרים','הולנד','סין','יפן','הודו','קנדה','מקסיקו','פולין','רוסיה','אוקראינה','תורכיה','איראן','עיראק','ירדן','לבנון','סוריה','מרוקו','תוניס','ארגנטינה','צילה','פרו','קובה','אוסטרליה','פורטוגל','אירלנד','שוודיה','נורווגיה','דנמרק','פינלנד','שווייץ','אוסטריה','בלגיה','יוון'],
    city: ['חיפה','ירושלים','תלאביב','אילת','בארשבע','נתניה','עכו','צפת','טבריה','אשדוד','אשקלון','רחובות','הרצליה','רעננה','חולון','רמתגן','נהריה','לוד','חדרה'],
    animal: ['נמר','כלב','חתול','סוס','אריה','נחש','דג','נשר','פיל','זאב','דוב','שועל','ארנב','צב','צפרדע','יונה','כריש','דולפין','קוף','זברה','גירפה','תנין','פינגווין','עטלף','דבורה','נמלה','פרפר','ינשוף','פרה','כבש','עז','גמל','חמור','תרנגול','ברווז','עכביש','תמנון','פנדה','קנגורו','דינוזאור','היפופוטם'],
    plant: ['ורד','אלון','זית','תפוח','חיטה','נענע','אורן','דקל','תמר','רימון','אגס','בננה','תפוז','לימון','גזר','בצל','שום','עגבניה','מלפפון','חסה','תות','אבטיח','מנגו','חמניה','סחלב','כלנית','נרקיס','שקד','תאנה','ענב','אורז','תירס'],
  },
  en: {
    country: ['brazil','france','israel','spain','italy','greece','germany','egypt','portugal','netherlands','china','japan','india','canada','mexico','poland','russia','ukraine','turkey','iran','iraq','jordan','lebanon','syria','morocco','argentina','chile','peru','cuba','australia','ireland','sweden','norway','denmark','finland','switzerland','austria','belgium','england','scotland'],
    city: ['lisbon','paris','london','rome','haifa','jerusalem','telaviv','berlin','madrid','amsterdam','vienna','athens','moscow','tokyo','cairo','dubai','sydney','chicago','boston','miami','toronto','dublin','oslo'],
    animal: ['cat','dog','tiger','lion','shark','eagle','ant','horse','cow','sheep','goat','elephant','wolf','bear','fox','rabbit','snake','frog','whale','dolphin','monkey','zebra','giraffe','penguin','bee','butterfly','owl','panda','kangaroo','dinosaur','crocodile','spider'],
    plant: ['tulip','rose','oak','olive','apple','wheat','mint','pine','palm','banana','orange','lemon','carrot','onion','garlic','tomato','lettuce','strawberry','sunflower','orchid','fig','grape','rice','corn','cactus','basil','lavender'],
  },
  nl: {
    country: ['brazilie','frankrijk','israel','spanje','italie','duitsland','nederland','portugal','china','japan','india','canada','mexico','polen','rusland','turkije','egypte','marokko','argentinie','australie','ierland','zweden','noorwegen','denemarken','finland','zwitserland','oostenrijk','belgie','engeland'],
    city: ['lissabon','parijs','amsterdam','londen','rotterdam','berlijn','rome','madrid','wenen','athene','moskou','tokio','haifa','utrecht','haarlem','leiden','delft','groningen','maastricht','eindhoven'],
    animal: ['kat','hond','tijger','leeuw','haai','adelaar','paard','koe','schaap','olifant','wolf','beer','vos','konijn','slang','kikker','walvis','dolfijn','aap','zebra','giraf','pingu','bij','vlinder','uil','panda','kangoeroe','dinosaurus','spin'],
    plant: ['tulp','roos','eik','olijf','appel','tarwe','munt','den','palm','banaan','sinaasappel','citroen','wortel','ui','knoflook','tomaat','sla','aardbei','zonnebloem','orchidee','vijg','druif','rijst','mais','cactus'],
  },
  pt: {
    country: ['brasil','franca','israel','espanha','italia','alemanha','portugal','egito','china','japao','india','canada','mexico','polonia','russia','turquia','marrocos','argentina','chile','peru','cuba','australia','irlanda','suecia','noruega','holanda','belgica','grecia','angola','mocambique'],
    city: ['lisboa','paris','roma','recife','salvador','haifa','rio','saopaulo','brasilia','curitiba','fortaleza','manaus','belem','porto','madrid','berlim','amsterda','londres','tokyo','cairo'],
    animal: ['gato','cachorro','tigre','leao','tubarao','aguia','cavalo','vaca','ovelha','elefante','lobo','urso','raposa','coelho','cobra','sapo','baleia','golfinho','macaco','zebra','girafa','pinguim','abelha','borboleta','coruja','panda','canguru','dinossauro','aranha','jacare'],
    plant: ['tulipa','rosa','carvalho','oliveira','maca','trigo','hortela','pinheiro','palmeira','banana','laranja','limao','cenoura','cebola','alho','tomate','alface','morango','girassol','orquidea','figo','uva','arroz','milho','cacto'],
  },
  es: {
    country: ['espana','francia','israel','italia','alemania','portugal','egipto','china','japon','india','canada','mexico','polonia','rusia','turquia','marruecos','argentina','chile','peru','cuba','australia','irlanda','suecia','noruega','holanda','belgica','grecia','brasil'],
    city: ['madrid','barcelona','sevilla','valencia','paris','roma','londres','berlin','lisboa','amsterdam','atenas','moscu','tokio','elcairo','haifa','jerusalen'],
    animal: ['perro','gato','tigre','leon','caballo','vaca','oveja','elefante','lobo','oso','zorro','conejo','serpiente','rana','ballena','delfin','mono','cebra','jirafa','pinguino','abeja','mariposa','buho','panda','canguro','dinosaurio','arana'],
    plant: ['rosa','roble','olivo','manzana','trigo','menta','pino','palmera','platano','naranja','limon','zanahoria','cebolla','ajo','tomate','lechuga','fresa','girasol','orquidea','higo','uva','arroz','maiz','cactus'],
  },
  it: {
    country: ['spagna','francia','israele','italia','germania','portogallo','egitto','cina','giappone','india','canada','messico','polonia','russia','turchia','marocco','argentina','cile','peru','cuba','australia','irlanda','svezia','norvegia','olanda','belgio','grecia','brasile'],
    city: ['roma','milano','napoli','torino','firenze','venezia','parigi','londra','berlino','madrid','lisbona','amsterdam','atene','mosca','tokyo','gerusalemme','haifa'],
    animal: ['cane','gatto','tigre','leone','cavallo','mucca','pecora','elefante','lupo','orso','volpe','coniglio','serpente','rana','balena','delfino','scimmia','zebra','giraffa','pinguino','ape','farfalla','gufo','panda','canguro','dinosauro','ragno'],
    plant: ['rosa','quercia','olivo','mela','grano','menta','pino','palma','banana','arancia','limone','carota','cipolla','aglio','pomodoro','lattuga','fragola','girasole','orchidea','fico','uva','riso','mais','cactus'],
  },
};

function countryQ(lang) {
  return `SELECT DISTINCT ?name WHERE {
    ?item wdt:P31 wd:Q6256 .
    { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
    FILTER(LANG(?name)="${lang}")
    FILTER(STRLEN(?name) < 42)
  }`;
}
function cityPopQ(lang, minPop) {
  return `SELECT DISTINCT ?name WHERE {
    ?item wdt:P31 wd:Q515 .
    ?item wdt:P1082 ?pop .
    FILTER(?pop > ${minPop})
    ?item rdfs:label ?name .
    FILTER(LANG(?name)="${lang}")
    FILTER(STRLEN(?name) < 28)
  } LIMIT 5000`;
}
function localQ(lang, countryQid, classes) {
  const unions = classes.map(q => `{ ?item wdt:P31 wd:${q} }`).join(' UNION ');
  return `SELECT DISTINCT ?name WHERE {
    ?item wdt:P17 wd:${countryQid} .
    ${unions}
    { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
    FILTER(LANG(?name)="${lang}")
    FILTER(STRLEN(?name) < 28)
  } LIMIT 6000`;
}
function lifeQ(lang, root, offset) {
  return `SELECT DISTINCT ?name WHERE {
    ?item wdt:P1843 ?name .
    FILTER(LANG(?name)="${lang}")
    FILTER(STRLEN(?name) < 22)
    ?item wdt:P171/wdt:P171/wdt:P171/wdt:P171/wdt:P171/wdt:P171 wd:${root} .
  } LIMIT 1000 OFFSET ${offset}`;
}

fs.mkdirSync(OUT, { recursive: true });
const report = {};

for (const lang of LANGS) {
  console.log('\n==', lang);
  const he = lang === 'he';
  const bags = { country: new Set(), city: new Set(), animal: new Set(), plant: new Set() };
  for (const key of Object.keys(seeds[lang])) addAll(bags[key], seeds[lang][key], he);

  addAll(bags.country, await grab('countries', countryQ(lang)), he);
  addAll(bags.city, await grab('cities>100k', cityPopQ(lang, 100000)), he);
  addAll(bags.city, await grab('cities>30k', cityPopQ(lang, 30000)), he);
  if (lang === 'he') addAll(bags.city, await grab('israel', localQ('he', 'Q801', ['Q515', 'Q3957', 'Q532', 'Q1115575', 'Q1112453', 'Q18511725'])), he);
  if (lang === 'nl') addAll(bags.city, await grab('nl', localQ('nl', 'Q55', ['Q515', 'Q3957', 'Q532', 'Q2039348'])), he);
  if (lang === 'pt') {
    addAll(bags.city, await grab('brazil', localQ('pt', 'Q155', ['Q515', 'Q3957', 'Q532', 'Q3184121'])), he);
    addAll(bags.city, await grab('portugal', localQ('pt', 'Q45', ['Q515', 'Q3957', 'Q532'])), he);
  }
  if (lang === 'es') addAll(bags.city, await grab('spain', localQ('es', 'Q29', ['Q515', 'Q3957'])), he);
  if (lang === 'it') addAll(bags.city, await grab('italy', localQ('it', 'Q38', ['Q515', 'Q3957'])), he);

  for (const [kind, root] of [['animal', 'Q729'], ['plant', 'Q756']]) {
    for (let off = 0; off < 4000; off += 1000) {
      const names = await grab(kind + ' ' + off, lifeQ(lang, root, off));
      const before = bags[kind].size;
      addAll(bags[kind], names, he);
      if (names.length < 1000 || bags[kind].size === before) break;
    }
  }

  const data = {};
  for (const key of ['country', 'city', 'animal', 'plant']) data[key] = [...bags[key]].sort();
  let text = JSON.stringify(data);
  if (text.length > 145000) {
    while (text.length > 145000 && data.city.length > seeds[lang].city.length) {
      data.city.pop();
      text = JSON.stringify(data);
    }
  }
  fs.writeFileSync(path.join(OUT, lang + '.json'), text);
  const g = gzipSync(Buffer.from(text));
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  report[lang] = { bytes: text.length, gzip: g.length, counts };
  console.log(lang, report[lang]);
}
fs.writeFileSync(path.join(OUT, 'sizes.json'), JSON.stringify(report, null, 2));
console.log('\nDONE', JSON.stringify(report));
