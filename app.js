/* Chai Practice — demo app engine.
   Plain JS, no dependencies. State in localStorage. Data from data.js (CHAI_DATA). */

'use strict';

const CUP_TARGET = 12;            // correct answers to fill the day's estekān
const DAILY_LEN = 12;             // questions per Daily Cup session
const FLASH_LEN = 10;
const CHOICE_LEN = 10;
const DIALOGUE_LEN = 5;
const LETTER_LEN = 10;
const PAIRS_COUNT = 5;

const PRAISE = [
  { fa: 'آفَرین', ph: 'āfarin!', en: 'bravo!' },
  { fa: 'خِیلی خوب', ph: 'khaylee khoob!', en: 'very good!' },
  { fa: 'عالی', ph: 'ālee!', en: 'great!' },
];

/* ---------------- state ---------------- */

const defaultState = () => ({
  scriptMode: 'phonetic',    // 'phonetic' | 'both' | 'script' — how Persian words are shown
  lessonMax: 10,
  streak: 0,
  lastFilled: null,          // 'YYYY-MM-DD' of last day the cup was filled
  cupDate: null,             // day the cup counter belongs to
  cupToday: 0,               // correct answers today (fills the estekān)
  ghand: 0,
  words: {},                 // id -> { box: 0 new | 1 steeping | 2 brewed }
  letters: {},               // letter -> { r: rights, w: wrongs } for Letter Spotter
});

let S = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem('chai-practice');
    if (raw) {
      const s = Object.assign(defaultState(), JSON.parse(raw));
      // migrate the old on/off `script` flag to the three-way scriptMode
      if (typeof s.script === 'boolean') s.scriptMode = s.script ? 'both' : 'phonetic';
      delete s.script;
      return s;
    }
  } catch (e) { /* corrupted state — start fresh */ }
  return defaultState();
}
function save() { localStorage.setItem('chai-practice', JSON.stringify(S)); }

/* true whenever Persian script is on screen (Both or Script-only modes) */
const scriptShown = () => S.scriptMode !== 'phonetic';

function today() { return new Date().toISOString().slice(0, 10); }
function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function rolloverDay() {
  if (S.cupDate !== today()) { S.cupDate = today(); S.cupToday = 0; }
  // streak broken if the last filled day is neither today nor yesterday
  if (S.lastFilled && S.lastFilled !== today() && S.lastFilled !== yesterday()) S.streak = 0;
  save();
}

/* ---------------- helpers ---------------- */

const $ = sel => document.querySelector(sel);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (a, n) => shuffle(a).slice(0, n);
const pick = a => a[Math.floor(Math.random() * a.length)];
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function vocabPool() { return CHAI_DATA.vocab.filter(v => v.lesson <= S.lessonMax); }
function box(id) { return (S.words[id] && S.words[id].box) || 0; }
function setBox(id, b) { S.words[id] = { box: Math.max(0, Math.min(2, b)) }; save(); }

/* A word only advances if it wasn't missed earlier this session —
   a lucky or corrected guess shouldn't count as mastery. */
function markResult(id, correct) {
  if (!correct) {
    if (SESSION) SESSION.missed.add(id);
    setBox(id, 0);
    return;
  }
  if (SESSION && SESSION.missed.has(id)) return;
  setBox(id, box(id) + 1);
}
/* Prefer words that need work: new + in-progress first, learned as filler. */
function pickVocab(n) {
  const pool = vocabPool();
  const need = shuffle(pool.filter(v => box(v.id) < 2));
  const brewed = shuffle(pool.filter(v => box(v.id) === 2));
  return need.concat(brewed).slice(0, n);
}

/* ---------- distractor quality (see notes/quiz-research.md) ---------- */

const stripDiacritics = s => s.toLowerCase()
  .replace(/[āáà]/g, 'a').replace(/[éè]/g, 'e').replace(/[ō]/g, 'o').replace(/[’‘']/g, '');
const glossCore = s => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/* Two words whose English glosses match or contain each other could both be right
   answers (merci / mamnoon-am are both "thank you") — never in the same option set. */
function sameMeaning(a, b) {
  const x = glossCore(a.english), y = glossCore(b.english);
  return !x || !y || x === y || x.includes(y) || y.includes(x);
}

/* Loanwords (piāno, shokolāt…) leak the answer in MC — route them to non-MC games. */
function isCognate(v) {
  const p = stripDiacritics(v.phonetic).replace(/[^a-z]/g, '');
  const e = v.english.toLowerCase().replace(/[^a-z]/g, '');
  for (let i = 0; i + 4 <= e.length; i++) if (p.includes(e.slice(i, i + 4))) return true;
  return false;
}

const hasNumber = t => /(\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b)/.test(t.toLowerCase());

/* A "(formal)" / "(paternal)" clarifier is a disambiguator, not part of the word.
   Strip it before counting words/length so "Aunt (paternal)" reads as one short word. */
const clarifierRe = /\([^)]*\)/;
const coreGloss = t => t.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

/* Options must match the key's FORM so surface features don't leak the answer:
   question↔question, phrase↔phrase, number↔number, clarifier↔clarifier, similar length. */
function formMatch(key, cand, side) {
  const tk = side === 'en' ? key.english : key.phonetic;
  const tc = side === 'en' ? cand.english : cand.phonetic;
  const ck = coreGloss(tk), cc = coreGloss(tc);
  if (/\?/.test(tk) !== /\?/.test(tc)) return false;
  // a lone bracketed clarifier is a visual tell — all options carry one, or none do
  if (clarifierRe.test(tk) !== clarifierRe.test(tc)) return false;
  if ((ck.split(/\s+/).length > 1) !== (cc.split(/\s+/).length > 1)) return false;
  if (hasNumber(key.english) !== hasNumber(cand.english)) return false;
  if (Math.abs(ck.length - cc.length) > Math.max(6, ck.length * 0.6)) return false;
  return true;
}

/* The giveaway cues (question mark, number, bracketed clarifier) that must ALWAYS
   match, even when the full form filter runs out of candidates. */
function looseMatch(key, cand, side) {
  const tk = side === 'en' ? key.english : key.phonetic;
  const tc = side === 'en' ? cand.english : cand.phonetic;
  return /\?/.test(tk) === /\?/.test(tc)
    && clarifierRe.test(tk) === clarifierRe.test(tc)
    && hasNumber(key.english) === hasNumber(cand.english);
}

/* Difficulty ladder (verified research): unrelated distractors are easiest,
   same-topic (same-lesson) ones are harder. hard=false → new-word mode.
   Distractors must differ in meaning from the key AND from each other
   (two options both meaning "how are you?" is as broken as an echoed key).
   Filters relax in tiers — full form match, then loose match — never to random. */
function pickDistractors(key, n, side, hard) {
  const pool = vocabPool().filter(x => x.id !== key.id && !sameMeaning(x, key));
  const tiers = [
    pool.filter(x => formMatch(key, x, side)),
    pool.filter(x => looseMatch(key, x, side)),
    pool,
  ];
  const out = [];
  for (const tier of tiers) {
    const same = tier.filter(x => x.lesson === key.lesson);
    const other = tier.filter(x => x.lesson !== key.lesson);
    const ranked = hard ? shuffle(same).concat(shuffle(other)) : shuffle(other).concat(shuffle(same));
    for (const c of ranked) {
      if (out.length === n) return out;
      if (out.some(o => o.id === c.id || sameMeaning(o, c))) continue;
      out.push(c);
    }
  }
  return out;
}

/* Keep the session in the ~66-80% success band the testing effect needs:
   struggling → easier questions; cruising → harder ones. */
function sessionWantsHard(v) {
  const s = SESSION;
  if (s && s.correct + s.wrong >= 4) {
    const acc = s.correct / (s.correct + s.wrong);
    if (acc < 0.6) return false;
    if (acc > 0.9) return true;
  }
  return box(v.id) >= 1; // review words get the harder distractor set
}

function wordHTML(v, side) {
  // side: 'fa' (Persian) or 'en'
  if (side === 'en') return esc(v.english);
  if (S.scriptMode === 'script') return `<span class="fa">${esc(v.script)}</span>`;
  let h = esc(v.phonetic);
  if (S.scriptMode === 'both') h += ` <span class="fa">${esc(v.script)}</span>`;
  return h;
}

/* Answer-explanation form of a word. Always keeps the romanized spelling as a
   safety net; in Script-only mode it leads with the Persian glyph. */
function revealWord(v) {
  return S.scriptMode === 'script'
    ? `<span class="fa">${esc(v.script)}</span> (<strong>${esc(v.phonetic)}</strong>)`
    : `<strong>${esc(v.phonetic)}</strong>`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------------- screens ---------------- */

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

function renderHome() {
  rolloverDay();
  const pct = Math.min(100, Math.round(S.cupToday / CUP_TARGET * 100));
  // estekān glass runs y=12..94 inside the SVG clip
  const fill = $('#teaFill');
  const h = 82 * pct / 100;
  fill.setAttribute('y', 94 - h);
  fill.setAttribute('height', h);

  $('#cupHeadline').textContent = pct >= 100 ? 'Your cup is full — nooshé jān!' : "Today's cup";
  $('#cupSub').textContent =
    pct >= 100 ? 'Come back tomorrow to keep the samovar going.' :
    pct === 0 ? 'Your estekān is empty — time to brew.' :
    `${pct}% brewed — keep pouring.`;

  $('#statStreak').textContent = `🔥 ${S.streak}-day streak`;
  $('#statGhand').textContent = `🍬 ${S.ghand} ghand`;

  document.querySelectorAll('#scriptModes .seg').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === S.scriptMode));
  $('#tileLetters').classList.toggle('locked', !scriptShown());

  const sel = $('#lessonMax');
  if (!sel.options.length) {
    CHAI_DATA.lessons.forEach(l => {
      const o = document.createElement('option');
      o.value = l.lesson;
      o.textContent = `Lesson ${l.lesson} — ${l.title.length > 34 ? l.title.slice(0, 34) + '…' : l.title}`;
      sel.appendChild(o);
    });
  }
  sel.value = S.lessonMax;

  const exWrap = $('#exerciseTiles');
  if (exWrap && !exWrap.children.length && CHAI_DATA.exercises) {
    CHAI_DATA.exercises.forEach(ex => {
      const b = document.createElement('button');
      b.className = 'game-tile';
      b.innerHTML = `<span class="gt-emoji">${ex.emoji}</span>` +
        `<span class="gt-name">${esc(ex.name)}</span>` +
        `<span class="gt-desc">${esc(ex.desc)}</span>`;
      b.onclick = () => runExercise(ex);
      exWrap.appendChild(b);
    });
  }

  show('#screen-home');
}

/* ---------------- session engine ----------------
   A session = list of "steps". Each step is a function(container, done)
   where done(correct|null) advances. */

let SESSION = null;

function startSession(kind, steps, opts = {}) {
  SESSION = {
    kind, steps, i: 0, correct: 0, wrong: 0,
    pours: opts.pours || false,
    hasNew: opts.hasNew !== false,   // ghand only for sessions with unmastered words
    missed: new Set(),
    startedAt: Date.now(),
  };
  show('#screen-session');
  nextStep();
}

function nextStep() {
  const s = SESSION;
  if (!s) return;
  $('#sessionProgress').style.width = `${s.i / s.steps.length * 100}%`;
  if (s.i >= s.steps.length) return endSession();
  const body = $('#sessionBody');
  body.innerHTML = '';
  s.steps[s.i](body, (correct) => {
    if (SESSION !== s) return; // stale click after the session ended
    if (correct === true) {
      s.correct++;
      if (s.pours) { rolloverDay(); S.cupToday++; save(); }
    } else if (correct === false) s.wrong++;
    s.i++;
    nextStep();
  });
}

function endSession() {
  const s = SESSION;
  $('#sessionProgress').style.width = '100%';
  // no ghand for grinding already-brewed words (reward-farming guard)
  const perfect = s.wrong === 0 && s.correct > 0 && s.hasNew;
  if (perfect) { S.ghand++; save(); }

  rolloverDay();
  let filledNow = false;
  if (S.cupToday >= CUP_TARGET && S.lastFilled !== today()) {
    S.streak = (S.lastFilled === yesterday()) ? S.streak + 1 : 1;
    S.lastFilled = today();
    filledNow = true;
    save();
  }

  const secs = Math.round((Date.now() - s.startedAt) / 1000);
  const card = $('#resultsCard');
  card.className = 'results-card' + (filledNow ? ' is-filled' : perfect ? ' is-perfect' : '');
  const praise = pick(PRAISE);
  card.innerHTML = `
    <div class="big-cup">${filledNow ? '🍵' : perfect ? '🍬' : '☕'}</div>
    <h2>${filledNow
      ? `nooshé jān! ${scriptShown() ? '<span class="fa">نوش جان</span>' : ''}`
      : `${esc(praise.ph)} ${scriptShown() ? `<span class="fa">${praise.fa}</span>` : ''}`}</h2>
    <p>${filledNow
      ? 'May it nourish your soul — your cup is full for today.'
      : perfect ? 'A perfect round — have a ghand with your chai. 🍬' : 'Good work — the tricky words will come back around.'}</p>
    <div class="results-stats">
      <span>✅ ${s.correct}</span>
      ${s.wrong ? `<span>❌ ${s.wrong}</span>` : ''}
      ${s.kind === 'pairs' ? `<span>⏱ ${secs}s</span>` : ''}
      ${filledNow ? `<span>🔥 ${S.streak} day${S.streak === 1 ? '' : 's'}</span>` : ''}
    </div>
    <button class="btn btn-primary btn-big" id="btnHome">Back to the samovar</button>
  `;
  $('#btnHome').onclick = renderHome;
  show('#screen-results');
  if (filledNow) sugarShower(card);
  SESSION = null;
}

/* nooshé jān delight — a shower of ghand (sugar cubes) over the results card.
   Purely presentational; touches no game state. */
function sugarShower(card) {
  const layer = document.createElement('div');
  layer.className = 'sugar-shower';
  for (let i = 0; i < 18; i++) {
    const bit = document.createElement('span');
    bit.className = 'ghand-bit';
    bit.style.left = (Math.random() * 100) + '%';
    bit.style.width = (11 + Math.random() * 6).toFixed(1) + 'px';
    bit.style.animationDuration = (1.6 + Math.random() * 1.4).toFixed(2) + 's';
    bit.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
    layer.appendChild(bit);
  }
  card.appendChild(layer);
}

/* ---------------- shared multiple-choice card ---------------- */

function mcStep({ kicker, prompt, sub, options, reveal, onMark }) {
  return (body, done) => {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.innerHTML = `
      <div class="q-kicker">${kicker}</div>
      <div class="q-prompt">${prompt}</div>
      ${sub ? `<div class="q-sub">${sub}</div>` : ''}
      <div class="options"></div>
      <div class="feedback"></div>
    `;
    const optWrap = card.querySelector('.options');
    const fb = card.querySelector('.feedback');
    shuffle(options).forEach(o => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.innerHTML = o.html;
      b.onclick = () => {
        optWrap.querySelectorAll('.opt').forEach(x => { x.disabled = true; });
        b.classList.add(o.correct ? 'right' : 'wrong');
        if (!o.correct) {
          optWrap.querySelectorAll('.opt').forEach(x => { if (x.dataset.correct === '1') x.classList.add('right'); });
        }
        if (onMark) onMark(o.correct);
        const praise = pick(PRAISE);
        fb.innerHTML = o.correct
          ? `<div class="praise">${esc(praise.ph)} ${scriptShown() ? `<span class="fa">${praise.fa}</span>` : ''} <small>(${praise.en})</small></div>`
          : `<div class="reveal">${reveal || ''}</div>`;
        const next = document.createElement('button');
        next.className = 'btn btn-primary btn-next';
        next.textContent = 'Next →';
        next.onclick = () => done(o.correct);
        fb.appendChild(next);
        next.focus();
      };
      b.dataset.correct = o.correct ? '1' : '0';
      optWrap.appendChild(b);
    });
    body.appendChild(card);
  };
}

/* ---------------- question builders ---------------- */

/* Both directions: 3 options (research optimum), distractors picked lazily at
   display time so difficulty can adapt to how the session is going. */
function qChoiceFaEn(v) {
  return (body, done) => {
    const distract = pickDistractors(v, 2, 'en', sessionWantsHard(v));
    mcStep({
      kicker: 'What does this mean?',
      prompt: wordHTML(v, 'fa'),
      options: [{ html: esc(v.english), correct: true }]
        .concat(distract.map(d => ({ html: esc(d.english), correct: false }))),
      reveal: `${revealWord(v)} means “${esc(v.english)}” — it'll come back around.`,
      onMark: c => markResult(v.id, c),
    })(body, done);
  };
}

function qChoiceEnFa(v) {
  return (body, done) => {
    const distract = pickDistractors(v, 2, 'fa', sessionWantsHard(v));
    mcStep({
      kicker: 'How do you say…',
      prompt: `“${esc(v.english)}”`,
      options: [{ html: wordHTML(v, 'fa'), correct: true }]
        .concat(distract.map(d => ({ html: wordHTML(d, 'fa'), correct: false }))),
      reveal: `“${esc(v.english)}” is ${revealWord(v)}.`,
      onMark: c => markResult(v.id, c),
    })(body, done);
  };
}

/* Conversation comprehension: show a short Persian dialogue, then ask an English
   question about what was said. Only dialogues that carry authored questions (and
   the site's English) are used. */
function comprehensionPool() {
  return CHAI_DATA.dialogues.filter(d =>
    d.lesson <= S.lessonMax && d.questions && d.questions.length);
}

function qComprehension() {
  const pool = comprehensionPool();
  if (!pool.length) return null;
  const dlg = pick(pool);
  const q = pick(dlg.questions);

  // show only the short exchange the question is about, not the whole conversation;
  // an ellipsis marks where earlier/later lines were trimmed off.
  const shown = (q.lines && q.lines.length) ? q.lines.slice().sort((a, b) => a - b)
                                            : dlg.lines.map((_, i) => i);
  const ELL = '<div class="dlg-line dlg-ellipsis" aria-hidden="true">⋯</div>';
  let linesHTML = shown[0] > 0 ? ELL : '';
  shown.forEach(i => {
    const l = dlg.lines[i];
    linesHTML += `<div class="dlg-line"><span class="who">${esc(l.speaker)}:</span> ${wordHTML(l, 'fa')}</div>`;
  });
  if (shown[shown.length - 1] < dlg.lines.length - 1) linesHTML += ELL;

  const options = [{ html: esc(q.a), correct: true }]
    .concat(sample(q.d, 2).map(x => ({ html: esc(x), correct: false })));

  return mcStep({
    kicker: `Read &amp; understand · Lesson ${dlg.lesson}`,
    prompt: `<div class="dlg-lines">${linesHTML}</div><p class="q-ask">${esc(q.q)}</p>`,
    options,
    reveal: `The answer is <strong>${esc(q.a)}</strong>.`,
  });
}

/* Letter Spotter distractors follow the research: a letter the learner has already
   got right gets SAME-SHAPE-FAMILY distractors (differ only by dots — the real
   confusions); a first-exposure letter gets visually distinct ones. */
function letterStats(ch) { return S.letters[ch] || { r: 0, w: 0 }; }
function markLetter(ch, correct) {
  const t = letterStats(ch);
  correct ? t.r++ : t.w++;
  S.letters[ch] = t;
  save();
}

function letterDistractors(l, n) {
  const A = CHAI_DATA.alphabet.filter(x => x.letter !== l.letter);
  const familiar = letterStats(l.letter).r >= 1;
  const kin = A.filter(x => x.family && x.family === l.family);
  const strangers = A.filter(x => !x.family || x.family !== l.family);
  const ranked = familiar ? shuffle(kin).concat(shuffle(strangers))
                          : shuffle(strangers).concat(shuffle(kin));
  return ranked.slice(0, n);
}

// Positional letterforms, rendered by joining to a kashida stroke (ـ).
const LETTER_FORMS = {
  start: ch => `${ch}ـ`, middle: ch => `ـ${ch}ـ`, end: ch => `ـ${ch}`,
};

function qLetter() {
  const A = CHAI_DATA.alphabet;
  const kinds = ['toSound', 'toLetter', 'readWord', 'form'];
  const kind = pick(kinds);

  if (kind === 'toSound') {
    const l = pick(A);
    const distract = letterDistractors(l, 2);
    return mcStep({
      kicker: 'What sound does this letter make?',
      prompt: `<span class="fa letter-big">${l.letter}</span>`,
      // no name shown — the Persian letter names (té, zé, seen…) telegraph the sound
      options: [{ html: esc(l.sound), correct: true }]
        .concat(distract.map(d => ({ html: esc(d.sound), correct: false }))),
      reveal: `<span class="fa">${l.letter}</span> (${esc(l.name)}) makes the sound ${esc(l.sound)}. ${esc(l.note)}`,
      onMark: c => markLetter(l.letter, c),
    });
  }

  if (kind === 'toLetter') {
    const l = pick(A);
    const distract = letterDistractors(l, 2);
    return mcStep({
      kicker: 'Spot the letter',
      prompt: `Which letter makes the sound<br>“${esc(l.sound)}”?`,
      options: [{ html: `<span class="fa letter-big">${l.letter}</span>`, correct: true }]
        .concat(distract.map(d => ({ html: `<span class="fa letter-big">${d.letter}</span>`, correct: false }))),
      reveal: `It's <span class="fa">${l.letter}</span> — “${esc(l.name)}”. ${esc(l.note)}`,
      onMark: c => markLetter(l.letter, c),
    });
  }

  if (kind === 'form') {
    // positional forms exist only for connecting letters
    const conn = A.filter(x => x.connects);
    const l = pick(conn);
    const pos = pick(['start', 'middle', 'end']);
    const posLabel = { start: 'START', middle: 'MIDDLE', end: 'END' }[pos];
    const distract = letterDistractors(l, 2).filter(d => d.connects);
    while (distract.length < 2) {
      const extra = pick(conn.filter(x => x.letter !== l.letter && !distract.includes(x)));
      distract.push(extra);
    }
    return mcStep({
      kicker: 'Letters change shape inside words',
      prompt: `How does “${esc(l.name)}” (<span class="fa">${l.letter}</span>) look at the<br>${posLabel} of a word?`,
      options: [{ html: `<span class="fa letter-big">${LETTER_FORMS[pos](l.letter)}</span>`, correct: true }]
        .concat(distract.map(d => ({ html: `<span class="fa letter-big">${LETTER_FORMS[pos](d.letter)}</span>`, correct: false }))),
      reveal: `“${esc(l.name)}” at the ${pos} of a word: <span class="fa">${LETTER_FORMS[pos](l.letter)}</span>`,
      onMark: c => markLetter(l.letter, c),
    });
  }

  const w = pick(CHAI_DATA.readWords);
  const distract = sample(CHAI_DATA.readWords.filter(x => x.phonetic !== w.phonetic && x.english !== w.english), 2);
  return mcStep({
    kicker: 'Read the word',
    prompt: `<span class="fa letter-big">${esc(w.script)}</span>`,
    options: [{ html: `${esc(w.phonetic)} — ${esc(w.english)}`, correct: true }]
      .concat(distract.map(d => ({ html: `${esc(d.phonetic)} — ${esc(d.english)}`, correct: false }))),
    reveal: `<span class="fa">${esc(w.script)}</span> reads <strong>${esc(w.phonetic)}</strong> (${esc(w.english)}).`,
  });
}

/* ---------------- flashcards ---------------- */

function flashStep(v) {
  return (body, done) => {
    let flipped = false;
    const card = document.createElement('div');
    card.className = 'flash-card';
    const render = () => {
      card.innerHTML = `
        <div class="q-kicker">${box(v.id) === 1 ? '📖 learning' : box(v.id) === 2 ? '✅ learned' : '✨ new'} · Lesson ${v.lesson}</div>
        <div class="flash-word">${wordHTML(v, 'fa')}</div>
        ${flipped ? `<div class="flash-answer">${esc(v.english)}</div>` : `<div class="flash-hint">tap to flip</div>`}
      `;
    };
    render();
    card.onclick = () => { if (!flipped) { flipped = true; render(); btns.classList.remove('hidden'); } };

    const btns = document.createElement('div');
    btns.className = 'flash-buttons hidden';
    const steep = document.createElement('button');
    steep.className = 'btn btn-steep';
    steep.textContent = '📖 Still learning';
    steep.onclick = () => { setBox(v.id, 1); done(false); };
    const knew = document.createElement('button');
    knew.className = 'btn btn-knew';
    knew.textContent = '✅ Knew it';
    knew.onclick = () => { markResult(v.id, true); done(true); };
    btns.append(steep, knew);

    body.append(card, btns);
  };
}

/* ---------------- match the pairs ---------------- */

function pairsStep(words) {
  return (body, done) => {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.innerHTML = `<div class="q-kicker">Match the pairs</div><div class="pairs-grid"></div><div class="pairs-timer">0s</div>`;
    const grid = card.querySelector('.pairs-grid');
    const timerEl = card.querySelector('.pairs-timer');
    const t0 = Date.now();
    const timer = setInterval(() => { timerEl.textContent = `${Math.round((Date.now() - t0) / 1000)}s`; }, 500);

    let selected = null, matched = 0, misses = 0;
    const tiles = shuffle(
      words.flatMap(v => [
        { id: v.id, side: 'fa', html: wordHTML(v, 'fa') },
        { id: v.id, side: 'en', html: esc(v.english) },
      ])
    );
    tiles.forEach(t => {
      const b = document.createElement('button');
      b.className = 'pair-tile';
      b.innerHTML = t.html;
      b.onclick = () => {
        if (b.classList.contains('done')) return;
        if (!selected) { selected = { t, b }; b.classList.add('sel'); return; }
        if (selected.b === b) { b.classList.remove('sel'); selected = null; return; }
        if (selected.t.id === t.id && selected.t.side !== t.side) {
          selected.b.classList.add('done'); b.classList.add('done');
          selected.b.classList.remove('sel');
          markResult(t.id, true);
          matched++;
          selected = null;
          if (matched === words.length) {
            clearInterval(timer);
            setTimeout(() => done(misses === 0 ? true : null), 450);
          }
        } else {
          b.classList.add('shake'); selected.b.classList.add('shake');
          misses++;
          const sb = selected.b;
          setTimeout(() => { b.classList.remove('shake'); sb.classList.remove('shake', 'sel'); }, 350);
          selected = null;
        }
      };
      grid.appendChild(b);
    });
    body.appendChild(card);
  };
}

/* ---------------- game launchers ---------------- */

const anyNew = words => words.some(v => box(v.id) < 2);

/* Pairs grid: no two words sharing an English meaning (two tiles would both match),
   and at most 2 first-exposure words per lesson (semantic-interference guard). */
function pickPairsWords(n) {
  const cands = pickVocab(n * 4);
  const out = [], glosses = new Set(), perLesson = {};
  for (const v of cands) {
    if (out.length === n) break;
    const g = glossCore(v.english);
    if (!g || glosses.has(g)) continue;
    if (box(v.id) === 0 && (perLesson[v.lesson] || 0) >= 2) continue;
    out.push(v); glosses.add(g);
    perLesson[v.lesson] = (perLesson[v.lesson] || 0) + 1;
  }
  for (const v of cands) { // top up if the guards left us short
    if (out.length === n) break;
    if (!out.includes(v) && !glosses.has(glossCore(v.english))) { out.push(v); glosses.add(glossCore(v.english)); }
  }
  return out;
}

function startDaily() {
  const words = pickVocab(DAILY_LEN);
  const steps = [];
  words.forEach((v, i) => {
    if (scriptShown() && i % 4 === 3) { const q = qLetter(); if (q) { steps.push(q); return; } }
    if (i % 3 === 2) { const q = qComprehension(); if (q) { steps.push(q); return; } }
    // loanwords leak in MC (piāno/piano) — practise them as flashcards instead
    if (isCognate(v)) { steps.push(flashStep(v)); return; }
    steps.push(i % 2 ? qChoiceEnFa(v) : qChoiceFaEn(v));
  });
  startSession('daily', steps.slice(0, DAILY_LEN), { pours: true, hasNew: anyNew(words) });
}

/* Unit 1 Exercises — quiz every item of an exercise as multiple choice, with the
   wrong options drawn from the other answers in the same exercise. */
function runExercise(ex) {
  const answers = ex.items.map(it => it.a);
  const steps = shuffle(ex.items.slice()).map(it => {
    const distract = sample(answers.filter(a => a !== it.a), 2);
    return mcStep({
      kicker: ex.kicker,
      prompt: esc(it.q),
      options: [{ html: esc(it.a), correct: true }]
        .concat(distract.map(d => ({ html: esc(d), correct: false }))),
      reveal: `The answer is <strong>${esc(it.a)}</strong>.`,
    });
  });
  startSession('exercise', steps, { hasNew: false });
}

const GAMES = {
  flashcards() {
    const words = pickVocab(FLASH_LEN);
    startSession('flashcards', words.map(flashStep), { hasNew: anyNew(words) });
  },
  choice() {
    const words = pickVocab(CHOICE_LEN * 2).filter(v => !isCognate(v)).slice(0, CHOICE_LEN);
    startSession('choice', words.map((v, i) => i % 2 ? qChoiceEnFa(v) : qChoiceFaEn(v)), { hasNew: anyNew(words) });
  },
  pairs() {
    const words = pickPairsWords(PAIRS_COUNT);
    startSession('pairs', [pairsStep(words)], { hasNew: anyNew(words) });
  },
  dialogue() {
    if (!comprehensionPool().length) {
      toast('Set your lesson higher in Settings to unlock conversation questions 💬');
      return;
    }
    const steps = [];
    for (let i = 0; i < DIALOGUE_LEN; i++) { const q = qComprehension(); if (q) steps.push(q); }
    startSession('dialogue', steps);
  },
  letters() {
    if (!scriptShown()) { toast('Turn on Persian script (Both or Script) in Settings to unlock Letter Spotter ✍️'); return; }
    startSession('letters', Array.from({ length: LETTER_LEN }, () => qLetter()));
  },
};

/* ---------------- wiring ---------------- */

$('#btnDaily').onclick = startDaily;
document.querySelectorAll('.game-tile').forEach(b => { b.onclick = () => GAMES[b.dataset.game](); });

$('#btnQuit').onclick = () => {
  if (!SESSION || confirm('Leave this session? Your poured tea is safe.')) { SESSION = null; renderHome(); }
};

document.querySelectorAll('#scriptModes .seg').forEach(btn => {
  btn.onclick = () => {
    S.scriptMode = btn.dataset.mode; save();
    document.querySelectorAll('#scriptModes .seg').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === S.scriptMode));
    $('#tileLetters').classList.toggle('locked', !scriptShown());
    toast(
      S.scriptMode === 'phonetic' ? 'Speaking mode — phonetic Persian only.' :
      S.scriptMode === 'both'     ? 'Phonetic + Persian script — Letter Spotter unlocked ✍️' :
                                    'Persian script only — khosh āmadeed to the alphabet! ✍️'
    );
  };
});

$('#lessonMax').onchange = e => { S.lessonMax = +e.target.value; save(); renderHome(); };

/* remember which home sections are open/collapsed (kept separate from
   chai-practice state so "Reset all progress" doesn't undo layout choices) */
document.querySelectorAll('details[data-section]').forEach(d => {
  const key = 'chai-section-' + d.dataset.section;
  const saved = localStorage.getItem(key);
  if (saved !== null) d.open = saved === '1';
  d.addEventListener('toggle', () => localStorage.setItem(key, d.open ? '1' : '0'));
});

$('#btnReset').onclick = () => {
  if (confirm('Reset ALL progress — streak, ghand and word progress? This cannot be undone.')) {
    localStorage.removeItem('chai-practice');
    S = defaultState();
    renderHome();
  }
};

renderHome();
