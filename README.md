# HilinGo – word-chain game (v4.8.3)
Open index.html (needs words.js next to it). Speech recognition needs https or http://localhost:
  cd hebrew-word-game && python3 -m http.server 8000  ->  http://localhost:8000
Word list: words.txt / words.js derived from hermitdave/FrequencyWords (OpenSubtitles 2018, he_full),
content licensed CC BY-SA 4.0 (https://github.com/hermitdave/FrequencyWords). Filtered: Hebrew letters only,
len>=2, frequency>=8, no triple-repeated letters, niqqud stripped. 232,118 forms.
Tests: node tests.mjs (logic + typed UI) and node tests_voice.mjs (mocked Safari-style speech: final, interim-only, onend-without-final, rejections). Both need puppeteer-core + Chrome.
v1.1: voice words are submitted on final result, after 1s of stable interim text, or on onend (Safari rarely sends isFinal); typing switches the mic off for that turn (Safari mic restarts/permission prompts were stealing keyboard focus); auto-mic restarts capped; visible "heard" line, error messages and on-screen JS error bar.
v1.2: if the required letter is already removed on your own board you still must say a word starting with it; it is accepted, nothing is removed, turn passes. That tile now stays highlighted (dashed/pulsing) and a note "האות X כבר נמחקה אצלך – אמור מילה ב־X, לא יימחק כלום" is shown (previously the .gone style hid the highlight, so the board showed no required letter). Voice picker prefers a token starting with the required letter. Regression: node tests_removed.mjs (playwright, Chromium + WebKit, voice + typed, ה and ך/ם/ן/ף/ץ).
v1.3: voice path restored byte-for-byte to v1.1 (removed the v1.2 "fallback to a token starting with the required letter" in pickWord); v1.2 visuals (highlighted removed required tile, note) kept — they don't touch recognition. Backups: index.v1.1.html, index.v1.3.html.
Tests (Chromium + WebKit): BROWSER=chromium|webkit node tests.mjs / tests_voice.mjs (via pwshim.mjs), node tests_removed.mjs, node tests_lifecycle.mjs (UI re-renders never stop/abort/restart the recognizer).
v2.0: start-screen choice of language – עברית (default, RTL, 22 letters), English, Nederlands (LTR, A–Z; case-insensitive; accents folded é/ë/ï→e/e/i; Dutch IJ counts as I + J).
  Speech lang he-IL / en-US / nl-NL; all UI text per language. Dictionaries words_en.js / words_nl.js are loaded lazily when that language is picked.
  English/Dutch word lists: hermitdave/FrequencyWords (OpenSubtitles 2018, en_full / nl_full), CC BY-SA 4.0, https://github.com/hermitdave/FrequencyWords –
  same filtering (letters only after folding, len>=2, frequency>=8, no triple-repeated letters): en 225,820 words, nl 178,638 words.
  Players 2/3/4 with optional names (empty → שחקן N / Player N / Speler N). 3 = three columns (2+1 on narrow screens), 4 = 2x2 grid; each section has its own board, timer, mic, input and status.
  Turns rotate P1→P2→…; a timeout passes the same letter to the next player; if everyone misses that letter in a row the next player gets a free letter.
  Game ends when a board is empty, after 6 consecutive misses (2 players, unchanged) or two full rounds of misses (3–4 players: 6 / 8), or via End game; fewest letters wins, ties named.
  The voice/recognition lifecycle is identical to v1.1/v1.3 (only the UI strings and r.lang come from the language table). Test: node tests_multi.mjs (Chromium + WebKit).
v2.1: Safari voice = push-to-talk. In Safari (auto-detected; ?ptt=1 / ?ptt=0 force) the mic never auto-starts: each turn tap the big
  🎤 "לחצו ודברו" button (or Enter in the empty box, or Space outside text fields). recognition.start() runs synchronously inside that
  click/keydown on a fresh webkitSpeechRecognition (continuous=false, interimResults=true, lang per language); word submitted on final
  result / 1s stable interim / onend; no automatic restarts. Clear on-screen help for not-allowed, service-not-allowed (enable Siri +
  Dictation), audio-capture, network, no-speech, language-not-supported; 6s "mic open but no sound" watchdog (suggests Cmd+Q, sounds off,
  Sound→Input). Countdown tick sound muted while listening. 🔍 toggles a small mic lifecycle log (start/audiostart/soundstart/speechstart/
  result/speechend/end/error) at the bottom – on by default in Safari. No getUserMedia anywhere. Chrome keeps optional auto-mic.
  When the turn passes (word accepted or timeout) all input boxes are emptied and the previous player's interim voice text/status cleared.
  Test: node tests_ptt.mjs (Chromium + WebKit). Older suites now load index.html?ptt=0 (auto-mic mode).
v2.2: renamed to HilinGo (named after Hili). Start-screen logo is "Hilin" + highlighted "Go" in Latin letters in every language, with a localized subtitle (Hebrew: משחק שרשרת מילים; English: A word-chain game; Dutch: Een woordkettingspel). Same mark appears on the end screen. Inline SVG favicon.
  Visual redesign: bright purple / blue / white / yellow palette with cheerful player accents (purple, turquoise, orange, pink) and green/yellow highlights. Gradient backdrop, card-based start screen, 3D letter tiles with a pop/strike on removal, glowing active-player panel, circular countdown ring, polished mic states (idle / listening pulse / heard), celebratory end screen with confetti and a podium. Rubik via Google Fonts, with Varela Round / Assistant / Arial Hebrew / system fallbacks for offline use. No game-logic or voice/recognition changes.
v2.3: Portuguese (Português) as a 5th language, start-screen button "Português 🇵🇹🇧🇷". Speech recognition uses pt-BR (Brazilian Portuguese); European Portuguese (pt-PT) words are also in the dictionary. Letter board is A–Z; accents are folded for first/last-letter logic (á/à/â/ã/é/ê/í/ó/ô/õ/ú/ç → base letter, same latin() normalizer as English/Dutch). Accented typed or spoken words are accepted. UI strings are in Brazilian Portuguese. Dictionary words_pt.js is loaded lazily like en/nl.
  Portuguese word list: hermitdave/FrequencyWords (OpenSubtitles 2018, union of filtered pt_full + pt_br_full), CC BY-SA 4.0, https://github.com/hermitdave/FrequencyWords –
  same filtering (letters only after folding, len>=2, frequency>=8, no triple-repeated letters): 227,775 words. No change to Safari push-to-talk or the v2.2 visual design.

## v2.4 – iPhone layout
- Phone (≤720px wide, or landscape ≤520px tall): panels stack vertically at natural height and the page scrolls; nothing overlaps.
  Active panel: 8-column board (9 for A–Z), input + Send + mic row inside the panel. Waiting players: compact card (name + small 11/13-column board).
- Compact header on phones; safe-area insets (viewport-fit=cover) and dvh units for the Safari toolbar.
- Mic diagnostic log (🔍) is hidden by default on every device; tap 🔍 to show it.
- Countdown number inside the timer ring is visible again.
- New test: tests_phone.mjs (WebKit iPhone 13 + Chromium, 2/3/4 players, he/en, bounding-box overlap checks).

## v2.5 – auto-mic everywhere + plan with the next board
- "Turn the mic on automatically every turn" is checked by default in every browser with speech recognition, Safari / iPhone included; the 🎤 button still works as a manual fallback (tap to stop / start). Start-screen note: "במידה והמיקרופון לא עובד, יש ללחוץ במשחק על 🎤" (en/nl/pt equivalents). Old Safari notes (localhost settings, "Chrome recommended", "not recommended in Safari") removed.
- Phone layout: the active player's panel and the NEXT player's panel are always fully on screen together (iPhone 13 / SE portrait, landscape side by side). With 3–4 players the panels are reordered on phones only (active first, next right after); desktop layout unchanged.

## v3.0 – words you add stay on this device
- "זו מילה אמיתית – אשרו בכל זאת" (and the en/nl/pt equivalents) saves that word in localStorage under `hilingo_custom_words_<lang>` (a JSON array). The word is normalized the same way dictionary lookups are (Hebrew niqqud stripped, Latin case and accents folded).
- On load and on language switch those words are merged into that language's dictionary, so later games accept them like built-in words (validation, chaining, used-word tracking). Hints still come from the built-in hint list.
- Start screen → "המילים שלי" / "My words" / "Mijn woorden" / "Minhas palavras" lists the saved words for the current language. ✕ asks a short confirm, then removes the word. Hebrew stays RTL.
- If localStorage is unavailable (private mode), the word still counts until the page is closed and nothing throws. Nothing is sent to a server or shared with anyone else.

## v3.1 – toast after a word is saved on this device
- Right after the existing "real word" button saves a word to localStorage, a small pill fades in, stays about 2 seconds, and fades out by itself: "המילה נשמרה רק במכשיר הזה" / "Word saved on this device only" / "Woord alleen op dit apparaat opgeslagen" / "Palavra salva apenas neste dispositivo".
- The pill does not take taps or focus, does not pause the game, and does not stop the microphone. If storage fails, there is no toast.

## v3.2 – Portuguese word list cleaned up
- The list still starts from hermitdave/FrequencyWords (OpenSubtitles 2018, union of pt_full + pt_br_full), CC BY-SA 4.0, https://github.com/hermitdave/FrequencyWords — letters only after accent-folding, len>=2, frequency>=8, no triple-repeated letters (227,775 tokens). Other languages are unchanged.
- Final letter must be a vowel or l, m, r, s, z (same rule a native speaker described). 43,332 tokens ending in another letter were removed. 29 real dictionary lemmas are allowlisted and kept: hífen, pólen, abdômen, líquen, elétron, próton, nêutron, glúten, hímen, sêmen, cânon, íon, néon, plâncton, rádon, cólon, gérmen, lúmen, tórax, látex, ônix, clímax, fax, cóccix, fênix, córtex, sílex, bórax, hélix.
- What remains is kept only when the folded token occurs in the union of the LibreOffice Hunspell dictionaries pt_BR (Vero) and pt_PT, affixes expanded, accents folded the same way as `latin()` (NFKD, strip marks, lowercase, first a–z run). That removed 70,170 further tokens (English words with a legal ending, names, brands). 114,273 words remain. Brazilian and European forms are both kept. hospital and computador stay; the, you, house, love, people, show, king, blog, computer are gone.
- Hints: ketchup → karaokê (still a K word, now ending in a vowel); windsurf → Wikipédia (still a W word, ending in a). yeti and yakisoba are not in that lexicon, so those hints were dropped; Y is still covered by yoga.
- A Portuguese word a player tries to add is rejected, with the usual red message and without the "accept anyway" button, when its final letter is outside that set and it is not on the allowlist.

## v4.8.3 – Light a button before you say the word
- משפט and the category buttons are pressed during your own turn, before the word. The one you tap lights up. Tap another dim button to switch. The challenge goes to the next player. Your sentence word is word number one.

## v4.8.2 – The game checks the category itself
- Country, city, animal, and plant lists live in `cats/<language>.json` and load only for the language you are playing. They stay on this device for next time.
- A word that is not on the list is checked with Wikidata for a moment (the clock waits). If that is unsure or offline, the players still decide with ✓ / ✗.

## v4.8.1 – The button row stays bright, and the mic waits for a tap
- משפט, ארץ, עיר, חי, צומח and 🤪 stay on screen in full color in a two-player game and in solo. A tap before a word shows a short hint.
- An automatic microphone restart that is blocked does not show the settings card. The card appears only after a tap, and it names this site.
- The mic log has a Copy all button.

## v4.8 – Sentences, categories, and a silly word
- The sentence button is משפט / Sentence / Zin / Frase, green with white text, still five words. Starting one slides the old words off to the right.
- Country, city, animal, and plant challenge the next player for one word. The game checks a list, the players can decide, and a pass has no penalty.
- 🤪 once a turn accepts a silly word with the right letter, no points, and the turn stays. Hili is never allowed.

## v4.7.2 – The mic in the notes matches the button
- Every on-screen mention of the microphone uses the same purple round mic as the button in the game, including the note under the start button. Hint messages use the yellow hint button.

## v4.7.1 – Rules you can actually read
- The home-screen rules are three short sections in every language: how to play, the rules, and tips. Same facts as before, written for kids, and the box scrolls on a phone.
- Sentence words are called out as turning green. Stuck in a sentence, you have to say Hili, and two already-deleted letters light back up. The mic and the hint in the rules look like the buttons in the game.

## v4.7 – Sentence of 5 words
- After a real word, that player can start a five-word sentence. The next players continue it, still starting with the last letter. "Not logical" voids the last word and gives the turn back. "Hili" cancels the sentence and returns two deleted letters. Five words ends it with confetti and one extra deleted letter per word. Hili is never a normal word. The sentence line is the only green in the game.

## v4.6.2 – Come back and the mic starts again
- Auto-mic is on at every load and every game or Learn start. An old saved "off" is ignored.
- Leaving for WhatsApp or a notification, then coming back, tears the recognizer down and starts a fresh one. The boards are redrawn and any disruption is cleared. Focus and blur while the app stayed open do not restart it.

## v4.6.1 – Mic listens again, countdown is just the number
- Recognition is no longer torn down on focus, blur, or a normal audio-end. It restarts after a real audio error, and not while a session is already listening.
- The Learn "Test pt-BR mic" button no longer aborts a listen that is already running. iOS was replaying that click and killing the mic.
- The turn clock is digits only. The colored ring is gone.

## v4.6 – Stronger secret disruptions, and a mic that comes back
- The next player double-taps their own letter grid. There is no badge. Each player can disrupt again after 20 seconds. Effects are larger, and the overlay does not take taps.
- A notification, a volume change, or a dropped audio session tears down speech recognition and starts a fresh one when auto-mic is on. The mic button always resets and restarts. The listening light goes out while recognition is dead.

## v4.5 – Disruptions
- In a 2–4 player game, the next player can double-tap the active letter grid. Solo and Learn cannot. Each player waits 90 seconds after their own disruption. Effects are silent visuals and do not touch the mic or the turn timer.

## v4.4.1 – Home screen no longer crashes on a saved record
- `SOLO_CAP` is declared before the startup call that paints "My New record". A saved solo time no longer throws `Cannot access 'SOLO_CAP' before initialization`.

## v4.4 – Vivid palette, no green or teal
- Player 1 is a stronger purple, player 2 vivid pink, player 3 strong blue, and player 4 vivid orange. Compact keys, win cards, and the name fields use those colors. Shared accents (the timer ring, selected buttons, and the Learn target panel) stay blue. Greens and teals are gone.

## v4.3 – Fixed keyboards, a smaller clock, records only for a real win
- The solo choice is the button `1`, same as 2, 3 and 4.
- On a phone the large keyboard stays the top card and the compact ones stay underneath, in a fixed order. A turn changes the name, the letters and the status inside those cards. The stack does not jump or change height.
- The solo clock is smaller and sits in the flow under both cards, including on a 375×667 screen.
- A record is saved only when the game ends by itself (a win or the miss limit). End game, quit and restart do not save. Older `hilingo_solo_best_` times are ignored.
- Auto-mic starts on unless this device has saved a choice under `hilingo_automic_v2`.
- If the mic goes quiet after a notification, a screenshot, or coming back to the app, the recognizer is torn down and started again when auto-mic is on and it is still your turn. If that fails, a small “tap to restart” chip appears. Those events are written to the mic log.

## v4.2 – Solo mode and a personal stopwatch
- Start screen adds שחקן 1 / Player 1 / Solo beside 2, 3 and 4. Solo still shows two keyboards, שחקן 1 and שחקן 2, and one person plays both turns. The rules are the same as a two-player game.
- A calm count-up clock (mm:ss, up to 99:59) sits in the empty area under the active keyboard. It runs only in solo, pauses with the game, and does not appear in multiplayer or Learn.
- Finishing saves the time on this device for the current language (`hilingo_solo_best_<lang>`). Quitting or starting again before the end drops it. The home screen shows the best as `My New record 02:07` in English in every language. A new best gets a short celebration on the end screen.

## v4.1 – Clear is back on the native word
- נקה / Clear / Wissen / Limpar sits on the native word whenever that word or a result is showing, and returns to an empty native step.

## v4.0 – Learn words ship as audio files, and Play’s mic is unchanged
- Google’s translate TTS URL returns `audio/mpeg` only when the request has no Referer. With `Referer: https://yatamir.github.io/` it returns a 404 HTML page, which an `<audio>` element reports as `NotSupportedError` code 4. StreamElements’ speech URL now answers 401 without an API key. Dictionary words are therefore stored as 24kbps mono MP3s under `audio/tts/<lang>/<id>.mp3`, generated where that Google URL still returns audio. A word that is not in the dictionary still tries the same URL with `referrerpolicy=no-referrer` (and a page referrer policy of `no-referrer`). `speechSynthesis` is only the last fallback, and nothing calls it when the page loads, so Play’s recognizer is not sharing the speech engine.
- Play’s `startRec` is the v3.5 function. Learn opens a recognizer the same way: a new instance, `continuous` false, interim results, 5 alternatives, `start()` inside the tap. A silent clip is no longer played on the microphone tap. If iOS reports `kAFAssistantErrorDomain error 7` (dictation language not installed), Learn does not try `pt-PT`. It shows once how to add that keyboard, and נקה / Skip / אמרתי (“I said it”) stay available so the round can be confirmed.
- Play’s speak button uses the same white outline microphone. While that recognizer is running, the blue waveform circle is shown beside what was heard.
- The Portuguese language button is the word Português, with no flag emoji.
- The debug log (five taps on v4.0) has a white copy icon, Copy all, and Clear log pinned at the top. Copy uses the clipboard and falls back to `execCommand` for the home-screen app. Test pt-BR mic starts Portuguese recognition only, and the log says `path: cold` when speech was never started on that load. After any spoken word, the target mic first cancels speech, removes the audio element, and waits 450ms. The log says `mic path: after-release` and `tts path: local-mp3`, `audio-url`, or `speechSynthesis`.
- Test: `node tests_learn.mjs`, `node tests_intro.mjs`, `node tests_tablet.mjs`, `node tests_learn_webkit.mjs`.

## v3.9 – Learn mode speaks through an audio file, and the mic matches Play
- On an iPhone home-screen app the target word still made no sound. `speechSynthesis` reported an end after about a second and never played audio (silent switch on or off, and again from a direct tap on 🔊). The repeat step never appeared, because iOS does not auto-listen and the only microphone was on the native panel. Hebrew results sometimes arrived with a hidden right-to-left mark (`U+200F`), and after the first `speechSynthesis` call every target-language recognizer aborted about 30ms after `start()`.
- The target word now plays in an `<audio>` element, the same way `audio/hilingo.mp3` does. The file is the Google Translate TTS endpoint `translate_tts?client=tw-ob` (verified: it returns `audio/mpeg` for pt-BR, he, and nl, and the response is `cross-origin`, so an audio element can play it with no fetch and no key). The debug log says `tts path: audio-url` when that plays. `speechSynthesis` runs only if that file errors or times out: `cancel()`, then 130ms, then `speak()`. An `end` sooner than 200ms counts as a failure. A play blocked for lack of a tap does not call `speechSynthesis`, because that was aborting the next recognizer. `speechSynthesis.cancel()` is not used around the microphone.
- Learn recognition follows Play: a new `SpeechRecognition` on every session, `continuous` false, interim results, 5 alternatives, `lang` set before `start()`, and no `getUserMedia`. The 8s hard abort is gone. At 10s, interim text is accepted; if nothing has arrived, `stop()` lets the engine deliver a result on `end`. An `aborted` error within 500ms of `start()` retries once, 400ms later, on a fresh instance. The target microphone waits 300ms after the word finishes. The outline microphone on the native panel always starts a native word, including from the repeat step, so a new word replaces the current one. The target panel shows its own outline microphone after the word plays. נקה / Clear / Wissen / Limpar aborts the mic and the word audio and returns to an empty native step.
- The outline microphone is white (`#fff`) on a purple button in every state. The blue waveform still shows only while a recognizer is actually running. Script, dictionary, and intro-audio URLs carry `?v=3.9`. There is no service worker.
- Five taps on the v3.9 label show the debug log, including the user agent, whether the app is standalone, how many voices the engine reported, the recognition error text, and which path called `abort()`.
- Test: `node tests_learn.mjs` (Chromium and WebKit). `tests_tablet.mjs` and `tests_intro.mjs` still cover the game.

## v3.8 – Learn mode: one sound at a time
- On an iPhone home-screen app the intro was cut off, Hebrew was only sometimes recognized, Portuguese was never recognized, and 🔊 froze and vanished. The mic indicator stayed on because Learn kept restarting recognition while also trying to speak, and the status line said "listening" even after the recognizer had stopped.
- Learn now has one owner at a time: the intro clip, or the spoken translation, or the microphone. The mic does not start until `audio/hilingo.mp3` fires `ended` (or the clip's duration plus one second). It is the same `play()` from the Let's learn tap that Play uses. Nothing calls `speechSynthesis` during the intro.
- iOS does not auto-listen. One tap is one recognition session (`continuous` false). It stops on a result, on end, on error, or after 8 seconds, and it does not start itself again. "מקשיב" is shown only while that session is actually running. The same WebKit object is reused; `lang` is set only while it is stopped, and a failed `start()` (`InvalidStateError`) waits for `onend` and tries once.
- 🔊 aborts recognition, waits up to 500ms for `onend`, cancels any previous speech, then speaks from that tap. The button is put back on `onend`, `onerror`, and a timeout, because iOS often never fires `onend`.
- Portuguese listens as `pt-BR`. If that session hears nothing, one follow-up uses `pt-PT` and then it stops. What was heard is shown. Matching still ignores accents, nikud, and articles (`de`/`het`/`een`, `the`/`a`, `o`/`a`/`um`) and allows one wrong letter on longer words.
- The outline microphone is only on the button you tap to speak. While that recognizer is actually running, a blue waveform shows in the status row and, during the repeat, in the 🔊 spot (still tappable). Both disappear when listening stops.
- Tap the small v3.8 label five times for a debug log of state changes and recognition events.
- Test: `node tests_learn.mjs`. `tests_tablet.mjs` and `tests_intro.mjs` still cover the game.

## v3.7 – Learn mode speaks, then listens in the new language
- On a phone the target word never came out of the speaker, and the repeat mic often stayed on the first language. Play mode was fine: it never switches language and it never uses `speechSynthesis`.
- iOS/Safari will not play `speechSynthesis` until `speak()` has run inside a tap. The Let's learn button (and a tap on a saved word) now speaks a silent utterance and calls `resume()` in that tap, which unlocks later speech. Chrome's speech queue is nudged with `resume()` while a word is playing so it does not stall.
- The microphone was holding the audio session, so the translation was silent. Recognition is aborted before `speechSynthesis.cancel()` + `speak()`. The target-language mic starts only after that utterance ends (or a short timeout). 🔊 is a real button on the translation: the tap itself calls `speak()`, then the mic comes back in the language you are learning.
- Voices often are not loaded yet. A missing exact voice (pt-BR, he-IL, nl-NL, en-US) does not block speech; the utterance still gets that `lang`.
- The repeat recognizer is a new instance, with the same settings as Play (`continuous` false, interim results, 5 alternatives, full BCP-47 tag). Interim text counts, so a match is not lost when Safari never sends a final result. "de hond" / "the dog" / "o cachorro" match the bare word. One letter off still counts for words of 4+ letters. The status line says which language is listening, and a miss still shows what was heard, with retry and skip.
- Test: `node tests_learn.mjs`. `tests_tablet.mjs` and `tests_intro.mjs` still cover the game.

## v3.6 – Learn mode
- Start screen: Play / Learn. Play is unchanged. In Learn, pick the language you speak and the language you are learning (he, en, nl, pt; any two different ones). The start button becomes "Let's learn!" / "יאללה, לומדים!" / "Laten we leren!" / "Vamos aprender!".
- Hili's intro (`audio/hilingo.mp3`) plays when Learn starts, the same way it does for a game, and the microphone waits until it ends.
- One learner, no timer, no turns, no letters removed. Say or type a word in your language. The other panel shows the translation, large, and speaks it with `speechSynthesis` (pt-BR, he-IL, nl-NL, en-US). 🔊 plays it again. The mic stays closed until that speech finishes, then listens in the target language.
- A repeat counts when any recognition alternative matches, accents and nikud folded, case ignored, or within one letter (Levenshtein) for a word of 5+ letters. A match shows ✅ and is saved on this device for that language pair. A miss shows what was heard, and you can retry, hear it again, or skip.
- "My words" on the Learn screen, and on the start screen while Learn is selected, lists the saved pairs. Tap one to hear it and practice it again. ✕ deletes it.
- Translations come from `learn_dict.js` first (about 1,980 everyday nouns, verbs and adjectives). Hebrew lookup strips nikud and folds final letters (ך→כ and the rest). If the word is missing, HilinGo asks the free MyMemory API (`https://api.mymemory.translated.net/get`, no key). If that fails, it says it couldn't translate and you can try another word.
- Dictionary sources, combined here under CC BY-SA 4.0:
  - Open Multilingual Wordnet 1.4 (https://github.com/omwn/omw-data). English: Princeton WordNet 3.0, Copyright 2006 Princeton University, WordNet license (https://wordnet.princeton.edu/license-and-commercial-use). Hebrew: Hebrew Wordnet, Copyright 2007 Noam Ordan and Shuly Wintner, University of Haifa, WordNet license. Dutch: Open Dutch WordNet, CC BY-SA 4.0. Portuguese: OpenWN-PT, CC BY-SA 3.0.
  - Wiktionary lemmas aligned to those synsets by Francis Bond and Ryan Foster (2013), CC BY-SA 3.0. Wiktionary is preferred; the wordnets fill gaps such as כלב.
  - Ranking: hermitdave/FrequencyWords, OpenSubtitles 2018 (en, he, nl, pt_BR, pt), CC BY-SA 4.0. Portuguese uses the Brazilian list first, so כלב → cachorro (not cão).
- Test: `node tests_learn.mjs` (playwright-core, mocked speech recognition and speechSynthesis). `tests_tablet.mjs` and `tests_intro.mjs` still cover the game.

## v3.5 – Hili says "HilinGo"
- Every new game, in every language, plays `audio/hilingo.mp3` once: Hili saying "HilinGo" (about 2.2 seconds). The clip is preloaded. Playback starts inside the tap on the start button (יאללה, מתחילים! / Let's play! / Spelen! / Vamos jogar!), including a game started again after New game / play again / rematch returns to that button. iOS Safari allows the sound only from that tap.
- The microphone for the opening turn — auto-mic or a tap on 🎤 — waits until the clip fires `ended`. If that never happens, it waits about 3 seconds and then continues. Later turns are unchanged. If the browser blocks or fails the sound, nothing is shown and the game starts as before.

## v3.4 – iPad / tablet boards fit on screen
- iPad portrait and landscape (including Safari with the tab bar open) keep every letter tile on screen. The mic, text box and send button sit below the grid; they no longer cover the last row (Y/Z, or ת/ש). Both players' boards stay inside the viewport — tiles scale down with the space (CSS grid + `min()` / container query size, capped at 72px) instead of overflowing sideways.
- `svh` plus safe-area insets keep `#game` inside the visible height when the browser chrome is showing. Phone layout (≤720px, or landscape ≤520px tall) is unchanged.
- The purple flicker behind the tiles and the mic was Safari repainting `background-attachment: fixed` through the animated tile/mic layers, plus the countdown ring's `z-index: -1` disc escaping while the timer updates. The backdrop is a fixed layer now, and the ring is a mask with no negative z-index. The timer bar no longer casts a purple glow.
- Layout check: `node tests_tablet.mjs` (install `playwright-core` once; uses the system Google Chrome). Two players, Portuguese and Hebrew, at 768×1024, 1024×768, 820×1180, 1180×820, 1024×1366, a short 1024×640 Safari-chrome height, phone 390×844 and desktop 1440×900. Every tile must sit on screen, above the mic / input / send row.

## v3.3 – Portuguese: K, W, Y off the board, and a fallback chain letter
- Portuguese only. Hebrew, English and Dutch still chain on the last letter, and K, W, Y stay normal tiles there.
- K, W and Y are drawn grey (not with the red strike of a deleted letter). They are never removed, never the required letter, and they do not count toward emptying the board.
- Default chain is unchanged: the next word starts with the last letter. If that letter is already deleted on the **next** player's board (the next seat, `(turn + 1) % players`) and the word contains one of B, C, D, F, G, H, J, N, P, Q, T, V, X, the required letter is the one of those closest to the end (accents folded the same way as `latin()`). No such letter → the last letter stays required. If that special letter is also already deleted, it is still required.
- The status bar and the yellow tile show the required letter. In the word chain, that letter is highlighted in the word that set it. Hints and the voice picker follow the same letter. A timeout still passes that letter on; it is not recomputed for the player after.
- Examples: `tempo` with O already deleted for the next player → **P**. `amor` with R already deleted → **R** (no special letter).
