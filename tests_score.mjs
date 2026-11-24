/**
 * HilinGo — known-answer scoring uses the tokenizer's real encode call.
 *   node tests_score.mjs
 */
import { tokenIds, scoreDecision, scoreBest, nearWords, learnPick } from './asr.js';

const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

const tok = {
  encode(text, opts){
    if (!opts || opts.add_special_tokens !== false) throw new Error('wrong encode signature');
    if (text === 'uno') return [100, 7];
    if (text === 'una') return { input_ids: [100, 8] };
    if (text === 'שלום') return new Uint16Array([100, 9]);
    return [];
  },
};

const uno = tokenIds(tok, 'uno');
const una = tokenIds(tok, 'una');
const hello = tokenIds(tok, 'שלום');
const blank = tokenIds(tok, '');
if (uno.join(',') !== '100,7') bad('uno ids ' + uno);
else ok('uno tokens come from encode(text, {add_special_tokens:false})');
if (una.join(',') !== '100,8') bad('una ids ' + una);
else ok('input_ids objects are read');
if (hello.join(',') !== '100,9') bad('typed ids ' + hello);
else ok('typed arrays are read');
if (blank.length) bad('blank ids');
else ok('an empty word has no tokens');

const won = scoreDecision([
  { text: 'uno', score: -1.2 },
  { text: 'una', score: -4.5 },
  { text: 'שלום', score: -6 },
], 'uno');
if (won !== 'uno') bad('accept ' + won);
else ok('the expected word wins when it scores best and above -3');

const broken = scoreDecision([
  { text: 'uno', score: -99 },
  { text: 'una', score: -99 },
], 'uno');
if (broken) bad('broken scores accepted ' + broken);
else ok('a -99 from a failed tokenize is not a hit');

const close = scoreDecision([
  { text: 'uno', score: -1.1 },
  { text: 'una', score: -0.4 },
], 'uno');
if (close) bad('loser accepted ' + close);
else ok('a better distractor is not accepted');

const cands = nearWords('איך עד?', 'א', ['אחד', 'איך', 'עד', 'שלום', 'בית']);
if (cands.indexOf('אחד') < 0) bad('אחד missing ' + cands.join(','));
else ok('איך עד suggests אחד when the letter is א');
const picked = scoreBest([
  { text: 'איך עד', score: -5 },
  { text: 'איך', score: -4.2 },
  { text: 'אחד', score: -1.1 },
], -3);
if (!picked || picked.text !== 'אחד') bad('rescore ' + (picked && picked.text));
else ok('the best score above -3 is אחד, not the raw phrase');
const none = scoreBest([{ text: 'איך', score: -6 }], -3);
if (none) bad('weak score accepted');
else ok('a weak score is not committed');

const fromAd = nearWords('עד', '', ['אחד', 'עד', 'חד', 'שלום']);
const fromHad = nearWords('חד', '', ['אחד', 'עד', 'חד', 'שלום']);
if (fromAd.indexOf('אחד') < 0) bad('עד candidates ' + fromAd.join(','));
else ok('עד can be אחד');
if (fromHad.indexOf('אחד') < 0) bad('חד candidates ' + fromHad.join(','));
else ok('חד can be אחד');
const grew = learnPick('חד', [{ text: 'חד', score: -1.2 }, { text: 'אחד', score: -1.8 }]);
if (grew !== 'אחד') bad('learn pick חד ' + grew);
else ok('a short חד prefers the longer אחד when the scores are close');
const grew2 = learnPick('עד', [{ text: 'עד', score: -1.0 }, { text: 'אחד', score: -1.7 }]);
if (grew2 !== 'אחד') bad('learn pick עד ' + grew2);
else ok('a short עד prefers אחד when the scores are close');

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nscore checks passed');
