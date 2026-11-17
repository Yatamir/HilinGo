# HilinGo – word-chain game (v3.2)
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
