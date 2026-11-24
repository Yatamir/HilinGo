/**
 * HilinGo — capture stays the 4.13.9 open (no settle wait), an 8s watchdog
 * ends a silent hang, and the existing send button opens Hebrew typing.
 *   node tests_learnflow.mjs
 */
import { readFileSync } from 'node:fs';
import { runLearnListen, watchExpired, typedWord, WATCH_MS, cheapScores, decideLearn } from './asr.js';

const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
if (page.includes('cap settle 400ms') || page.includes("act:'wait'")) bad('settle or prime-wait is still in the page');
else ok('capture does not wait 400ms and does not park on an in-flight open');
if (!page.includes("diag('cap ctx state '")) bad('context is not opened with the capture');
else ok('the audio context is opened in the tap, with getUserMedia');
if (!page.includes("diag('cap watch 8s')")) bad('no 8s watchdog');
else ok('a listen that produces nothing is released after 8s');
if (!page.includes('function learnSendTap') || !page.includes("diag('type open learn')")) bad('learn send does not open typing');
else ok('the existing learn send button opens the Hebrew field when it is empty');
if (!page.includes('function sendOrType') || !page.includes("diag('type open game '")) bad('game send does not open typing');
else ok('the existing game send button opens the Hebrew field when it is empty');
if (!page.includes("t.closest('input,textarea,.send,.inputs')")) bad('a type tap still retunes the audio session');
else ok('tapping the field or send does not switch the audio session');

if (WATCH_MS !== 8000) bad('watch window ' + WATCH_MS);
if (!watchExpired(8000, false) || watchExpired(7999, false) || watchExpired(9000, true)) bad('watchExpired');
else ok('8s with no voice is a hang, and heard audio is not');

{
  const calls = [];
  const heard = await runLearnListen({
    tapped: true,
    acquire(info){ calls.push(info); return { peak: 0.8, at: 400, audio: new Float32Array([0.2]) }; },
    async transcribe(){ return 'עד'; },
    correct(text){
      const choice = decideLearn(text, cheapScores(text, ['אחד', 'עד', 'חד']), true);
      return choice.commit ? choice.text : text;
    }
  });
  if (calls.length !== 1 || calls[0].settleMs !== 0) bad('tap acquire ' + JSON.stringify(calls));
  else ok('a tap opens the mic immediately');
  if (!heard.commit || heard.text !== 'אחד') bad('commit ' + JSON.stringify(heard));
  else ok('samples commit the dictionary correction');
}

{
  let n = 0;
  const hung = await runLearnListen({
    tapped: true,
    acquire(){ n++; return { peak: 0, at: 8000, audio: new Float32Array(0) }; },
    async transcribe(){ return 'לא'; }
  });
  if (hung.commit || hung.why !== 'watch' || n !== 1) bad('hang ' + n + ' ' + JSON.stringify(hung));
  else ok('silence at 8s stops without another capture');
}

{
  const none = await runLearnListen({
    tapped: false,
    acquire(){ throw new Error('acquired'); },
    async transcribe(){ return 'אחד'; }
  });
  if (none.commit || none.why !== 'no-tap') bad('no tap ' + JSON.stringify(none));
  else ok('without a tap nothing is acquired');
}

const typed = typedWord('  אחד ');
if (!typed.commit || typed.text !== 'אחד') bad('typed ' + JSON.stringify(typed));
else ok('a typed Hebrew word is a commit');
if (typedWord('   ').commit) bad('empty typed word committed');
else ok('an empty send is not a word');

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nlearn-flow checks passed');
