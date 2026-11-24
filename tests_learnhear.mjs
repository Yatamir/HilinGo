/**
 * HilinGo — learning trim, early deaf check, and commit decision.
 *   node tests_learnhear.mjs
 */
import { trimPcm, deafEarly, decideLearn, nearWords } from './asr.js';

const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

{
  const rate = 16000;
  const n = rate * 5;
  const audio = new Float32Array(n);
  const toneAt = Math.round(rate * 3.3);
  for (let i = toneAt; i < n; i++) audio[i] = Math.sin(i / 8) * 0.4;
  const kept = trimPcm(audio, rate);
  const start = kept.start / rate;
  const end = kept.end / rate;
  if (start > 3.05 || end < 4.95) bad('trim ' + start.toFixed(2) + '-' + end.toFixed(2));
  else ok('silence then a tone from 3.3s is kept from about 3.0s through 5.0s');
}

if (!deafEarly(0.0002, 600)) bad('deaf early missed');
else ok('a zero track is deaf after 600ms');
if (deafEarly(0.5, 600) || deafEarly(0.0002, 200)) bad('deaf early false');
else ok('a loud track, or a short wait, is not deaf');

const fromAd = nearWords('עד', '', ['אחד', 'עד', 'חד', 'אגרד']);
const fromHad = nearWords('חד', '', ['אחד', 'עד', 'חד', 'אגרד']);
if (fromAd.indexOf('אחד') < 0 || fromHad.indexOf('אחד') < 0) bad('neighbors ' + fromAd + ' / ' + fromHad);
else ok('עד and חד both offer אחד');

const frag = decideLearn('עד', [{ text: 'עד', score: -1.0 }, { text: 'אחד', score: -1.6 }], true);
if (!frag.commit || frag.text !== 'אחד') bad('עד decision ' + JSON.stringify(frag));
else ok('עד commits אחד');
const frag2 = decideLearn('חד', [{ text: 'חד', score: -1.2 }, { text: 'אחד', score: -1.8 }], true);
if (!frag2.commit || frag2.text !== 'אחד') bad('חד decision ' + JSON.stringify(frag2));
else ok('חד commits אחד');

const garbage = decideLearn('אגרד', [{ text: 'אגרד', score: -2.4 }, { text: 'אחד', score: -1.1 }], true);
if (!garbage.commit || garbage.text !== 'אחד') bad('אגרד better ' + JSON.stringify(garbage));
else ok('אגרד loses to a clearly better אחד');

const unknown = decideLearn('אגרד', [{ text: 'אגרד', score: -4.5 }], false);
if (unknown.commit) bad('unknown committed ' + JSON.stringify(unknown));
else ok('a non-dictionary word is not committed');

const sure = decideLearn('אחד', [{ text: 'אחד', score: -0.8 }], true);
if (!sure.commit || sure.text !== 'אחד') bad('sure ' + JSON.stringify(sure));
else ok('a confident dictionary word is committed');

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nlearn-hear checks passed');
