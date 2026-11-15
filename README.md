# HilinGo
HilinGo – a word-chain game for the family, named after Hili 💜

# HilinGo – word-chain game (v2.3)
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
