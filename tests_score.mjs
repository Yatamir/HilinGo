/**
 * HilinGo — known-answer scoring uses the tokenizer's real encode call.
 *   node tests_score.mjs
 */
import { tokenIds, scoreDecision } from './asr.js';

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

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nscore checks passed');
