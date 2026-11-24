/**
 * HilinGo — learning listen state machine.
 * Mocked capture: a tap with samples commits, a deaf track reacquires once,
 * and nothing is acquired or committed without a tap.
 *   node tests_learnflow.mjs
 */
import { runLearnListen, primeDecision, afterCapture, cheapScores, decideLearn } from './asr.js';
import { readFileSync } from 'node:fs';

const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
if (!page.includes("if(s.inFlight && !s.forceFresh) return {act:'wait', settleMs:0}")) bad('page can start a second capture while one is opening');
else ok('a second tap event waits for the capture already opening');
if (!page.includes('learn tap state=')) bad('mic tap has no log');
else ok('the mic tap logs its state first');
if (!page.includes("previous session log:\\n")) bad('copy omits the previous session');
else ok('copy keeps the previous session separate');

const waiting = primeDecision({ inFlight: true, fromPlayback: true });
if (waiting.act !== 'wait') bad('in-flight decision ' + waiting.act);
else ok('an in-flight open is not replaced');
const settled = primeDecision({ fromPlayback: true });
if (settled.act !== 'open' || settled.settleMs !== 400) bad('settle ' + JSON.stringify(settled));
else ok('playback to play-and-record waits 400ms before the context and the mic');
const retry = primeDecision({ forceFresh: true });
if (retry.act !== 'open' || retry.settleMs !== 400) bad('retry settle ' + JSON.stringify(retry));
else ok('the one reacquire also waits for the route');

{
  const calls = [];
  const heard = await runLearnListen({
    tapped: true,
    fromPlayback: true,
    acquire(info){ calls.push(info); return { peak: 0.8, audio: new Float32Array([0.2]) }; },
    async transcribe(){ return 'עד'; },
    correct(text){
      const scores = cheapScores(text, ['אחד', 'עד', 'חד']);
      const choice = decideLearn(text, scores, true);
      return choice.commit ? choice.text : text;
    }
  });
  if (calls.length !== 1 || calls[0].settleMs !== 400) bad('tap acquire ' + JSON.stringify(calls));
  else ok('one tap opens the mic once, after the route settles');
  if (!heard.commit || heard.text !== 'אחד' || heard.acquires !== 1) bad('tap commit ' + JSON.stringify(heard));
  else ok('a tap with samples commits the cheap dictionary correction');
}

{
  let n = 0;
  const calls = [];
  const recovered = await runLearnListen({
    tapped: true,
    fromPlayback: true,
    acquire(info){
      n++;
      calls.push(info);
      return { peak: n === 1 ? 0.0002 : 0.7, audio: new Float32Array([0.4]) };
    },
    async transcribe(){ return 'אחד'; },
    correct(text){ return text; }
  });
  if (n !== 2 || !calls[1].fresh || calls[1].settleMs !== 400) bad('reacquire ' + JSON.stringify(calls));
  else ok('a deaf track reacquires once');
  if (!recovered.commit || recovered.text !== 'אחד' || recovered.acquires !== 2) bad('recovered ' + JSON.stringify(recovered));
  else ok('the second take commits');
}

{
  let n = 0;
  const silent = await runLearnListen({
    tapped: true,
    acquire(){ n++; return { peak: 0.0001, audio: new Float32Array(0) }; },
    async transcribe(){ return 'לא'; }
  });
  if (n !== 2 || silent.commit || silent.why !== 'silent') bad('two deaf ' + n + ' ' + JSON.stringify(silent));
  else ok('two deaf takes stop, they do not keep reacquiring');
}

{
  let n = 0;
  const none = await runLearnListen({
    tapped: false,
    acquire(){ n++; return { peak: 1, audio: new Float32Array([0.5]) }; },
    async transcribe(){ return 'אחד'; }
  });
  if (n !== 0 || none.commit || none.acquires !== 0 || none.why !== 'no-tap') bad('no tap ' + n + ' ' + JSON.stringify(none));
  else ok('without a tap nothing is acquired or committed');
}

if (afterCapture(1, 0.0002, true) !== 'retry' || afterCapture(2, 0.0002, true) !== 'silent') bad('deaf plan');
else ok('deaf-early plans one retry and then stops');

const scores = cheapScores('עד', ['אחד', 'עד', 'חד', 'אגרד']);
if (scores.some(s => s.text === 'אחד' && s.score > -3) && !scores.some(s => s.score === undefined)) ok('dictionary correction is an edit-distance score, not a decoder pass');
else bad('cheap scores ' + JSON.stringify(scores));

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nlearn-flow checks passed');
