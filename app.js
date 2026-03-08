// ===== Music Data =====
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const NOTE_ALIASES = {
  'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb'
};

// Chord definitions: semitone intervals from root
const CHORD_TYPES = {
  major:        { label: 'Major',              intervals: [0, 4, 7],         formula: ['1', '3', '5'],          description: 'The major chord has a bright, happy sound. It is the most common chord in Western music.' },
  minor:        { label: 'Minor',              intervals: [0, 3, 7],         formula: ['1', 'b3', '5'],         description: 'The minor chord sounds darker and more melancholic than its major counterpart.' },
  dominant7:    { label: 'Dominant 7th',       intervals: [0, 4, 7, 10],     formula: ['1', '3', '5', 'b7'],    description: 'Adds a flat 7th to the major triad, creating tension that wants to resolve.' },
  major7:       { label: 'Major 7th',          intervals: [0, 4, 7, 11],     formula: ['1', '3', '5', '7'],     description: 'A lush, jazzy chord with a dreamy, sophisticated quality.' },
  minor7:       { label: 'Minor 7th',          intervals: [0, 3, 7, 10],     formula: ['1', 'b3', '5', 'b7'],   description: 'Smooth and jazzy — adds warmth and depth to the minor chord.' },
  diminished:   { label: 'Diminished',         intervals: [0, 3, 6],         formula: ['1', 'b3', 'b5'],        description: 'Tense and unstable, built entirely from minor 3rds. Often used for dramatic effect.' },
  augmented:    { label: 'Augmented',          intervals: [0, 4, 8],         formula: ['1', '3', '#5'],         description: 'Mysterious and tense, built from major 3rds. Common in jazz and film scores.' },
  sus2:         { label: 'Suspended 2nd',      intervals: [0, 2, 7],         formula: ['1', '2', '5'],          description: 'Replaces the 3rd with a 2nd, creating an open, floating sound.' },
  sus4:         { label: 'Suspended 4th',      intervals: [0, 5, 7],         formula: ['1', '4', '5'],          description: 'Replaces the 3rd with a 4th. Feels unresolved, like it needs to move to major or minor.' },
  dim7:         { label: 'Diminished 7th',     intervals: [0, 3, 6, 9],      formula: ['1', 'b3', 'b5', 'bb7'], description: 'Four notes equally spaced. Eerie and symmetrical, used heavily in classical music.' },
  half_dim7:    { label: 'Half Diminished 7th',intervals: [0, 3, 6, 10],     formula: ['1', 'b3', 'b5', 'b7'],  description: 'Also called minor 7 flat 5. Common in jazz as the ii chord in minor keys.' },
  major6:       { label: 'Major 6th',          intervals: [0, 4, 7, 9],      formula: ['1', '3', '5', '6'],     description: 'Adds a major 6th to the major triad. Bright and jazzy.' },
  minor6:       { label: 'Minor 6th',          intervals: [0, 3, 7, 9],      formula: ['1', 'b3', '5', '6'],    description: 'Adds a major 6th to the minor triad. Bittersweet sound used in jazz and bossa nova.' },
  power:        { label: 'Power Chord (5th)',   intervals: [0, 7],            formula: ['1', '5'],               description: 'Just the root and perfect 5th — neither major nor minor. Staple of rock and metal.' },
};

// ===== Piano Layout =====
// Two octaves starting at C3
const OCTAVE_START = 3;
const NUM_OCTAVES = 2;
const WHITE_NOTE_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTE_ORDER = ['C#', 'D#', null, 'F#', 'G#', 'A#', null]; // null = no black key

// ===== Audio =====
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Unlock AudioContext on first user gesture (required by browser autoplay policy)
    const resume = () => audioCtx.resume();
    document.addEventListener('mousedown', resume, { once: true });
    document.addEventListener('touchstart', resume, { once: true });
  }
  return audioCtx;
}

function noteToFreq(note, octave) {
  const semitone = NOTES.indexOf(note);
  // A4 = 440 Hz, A is index 9 in octave 4
  const halfStepsFromA4 = (octave - 4) * 12 + (semitone - 9);
  return 440 * Math.pow(2, halfStepsFromA4 / 12);
}

function scheduleNote(ctx, freq, when, duration) {
  // Add 50ms buffer to ensure we never schedule in the past
  const t = ctx.currentTime + when + 0.05;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const masterGain = ctx.createGain();

  osc1.type = 'triangle';
  osc2.type = 'sine';
  osc1.frequency.value = freq;
  osc2.frequency.value = freq * 2;

  osc1.connect(masterGain);
  osc2.connect(masterGain);
  masterGain.connect(ctx.destination);

  masterGain.gain.setValueAtTime(0, t);
  masterGain.gain.linearRampToValueAtTime(0.4, t + 0.01);
  masterGain.gain.exponentialRampToValueAtTime(0.15, t + 0.3);
  masterGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  osc1.start(t);
  osc2.start(t);
  osc1.stop(t + duration);
  osc2.stop(t + duration);
}

// Returns a promise that resolves once audio is scheduled.
// Must be called from within a user gesture handler for iOS Safari.
function playNote(freq, when = 0, duration = 1.2) {
  const ctx = getAudioContext();
  return ctx.resume().then(() => scheduleNote(ctx, freq, when, duration)).catch(err => console.error('Audio playback failed:', err));
}

// ===== State =====
let selectedRoot = 'C';
let selectedChordType = 'major';
let quizScore = 0;
let quizTotal = 0;
let quizAnswer = null;
let quizAnswered = false;
let quizPlayRoot = null;
let quizPlayChordType = null;

// ===== Helpers =====
function getChordNotes(root, chordType) {
  const rootIdx = NOTES.indexOf(root);
  const intervals = CHORD_TYPES[chordType].intervals;
  return intervals.map(interval => NOTES[(rootIdx + interval) % 12]);
}

function getChordNotesFull(root, chordType) {
  // Returns [{note, octave}] starting from the first occurrence at or after C3
  const rootIdx = NOTES.indexOf(root);
  const intervals = CHORD_TYPES[chordType].intervals;
  const result = [];
  const baseOctave = OCTAVE_START;

  intervals.forEach((interval, i) => {
    const noteIdx = (rootIdx + interval) % 12;
    const note = NOTES[noteIdx];
    // If interval wraps past 12, increment octave
    const octaveOffset = Math.floor((rootIdx + interval) / 12);
    result.push({ note, octave: baseOctave + octaveOffset });
  });
  return result;
}

function noteName(note) {
  const alias = NOTE_ALIASES[note];
  return alias ? `${note} / ${alias}` : note;
}

// ===== UI: Piano Keyboard =====
function buildKeyboard() {
  const keyboard = document.getElementById('piano-keyboard');
  keyboard.innerHTML = '';

  let whiteX = 0;
  const whiteKeyWidth = 46;
  const blackKeyWidth = 28;
  const blackOffsets = { 'C#': 30, 'D#': 62, 'F#': 156, 'G#': 188, 'A#': 220 };

  for (let oct = OCTAVE_START; oct < OCTAVE_START + NUM_OCTAVES; oct++) {
    const octaveOffset = (oct - OCTAVE_START) * (whiteKeyWidth * 7);

    WHITE_NOTE_ORDER.forEach((noteName, i) => {
      const key = document.createElement('div');
      key.className = 'key white';
      key.dataset.note = noteName;
      key.dataset.octave = oct;

      const label = document.createElement('span');
      label.className = 'key-label';
      label.textContent = noteName + oct;
      key.appendChild(label);

      key.addEventListener('mousedown', () => handleKeyClick(noteName, oct, key));
      key.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleKeyClick(noteName, oct, key);
      }, { passive: false });
      keyboard.appendChild(key);
    });

    // Black keys positioned absolutely within the octave
    Object.entries(blackOffsets).forEach(([note, offsetPx]) => {
      const key = document.createElement('div');
      key.className = 'key black';
      key.dataset.note = note;
      key.dataset.octave = oct;
      key.style.left = `${octaveOffset + offsetPx}px`;

      const label = document.createElement('span');
      label.className = 'key-label';
      label.textContent = note.replace('#', '♯') + oct;
      key.appendChild(label);

      key.addEventListener('mousedown', () => handleKeyClick(note, oct, key));
      key.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleKeyClick(note, oct, key);
      }, { passive: false });
      keyboard.appendChild(key);
    });
  }

  // Set keyboard width
  keyboard.style.width = `${whiteKeyWidth * 7 * NUM_OCTAVES}px`;
  keyboard.style.position = 'relative';
  keyboard.style.height = '170px';
}

function handleKeyClick(note, octave, keyEl) {
  // Visual press
  keyEl.classList.add('pressed');
  setTimeout(() => keyEl.classList.remove('pressed'), 200);

  // Play note
  const freq = noteToFreq(note, parseInt(octave));
  playNote(freq);
}

function highlightChord(root, chordType) {
  // Clear existing highlights
  document.querySelectorAll('.key').forEach(k => {
    k.classList.remove('highlighted', 'root-highlighted');
  });

  const chordNotes = getChordNotes(root, chordType);

  document.querySelectorAll('.key').forEach(k => {
    if (chordNotes.includes(k.dataset.note)) {
      if (k.dataset.note === root) {
        k.classList.add('root-highlighted');
      } else {
        k.classList.add('highlighted');
      }
    }
  });
}

// ===== UI: Selects =====
function buildSelects() {
  const rootSelect = document.getElementById('root-select');
  const chordSelect = document.getElementById('chord-select');

  NOTES.forEach(note => {
    const opt = document.createElement('option');
    opt.value = note;
    const alias = NOTE_ALIASES[note];
    opt.textContent = alias ? `${note} / ${alias}` : note;
    rootSelect.appendChild(opt);
  });

  Object.entries(CHORD_TYPES).forEach(([key, val]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = val.label;
    chordSelect.appendChild(opt);
  });

  rootSelect.addEventListener('change', () => {
    selectedRoot = rootSelect.value;
    updateChordDisplay();
  });

  chordSelect.addEventListener('change', () => {
    selectedChordType = chordSelect.value;
    updateChordDisplay();
  });
}

function updateChordDisplay() {
  const chord = CHORD_TYPES[selectedChordType];
  const notes = getChordNotes(selectedRoot, selectedChordType);

  document.getElementById('chord-name').textContent =
    `${selectedRoot} ${chord.label}`;
  document.getElementById('chord-description').textContent = chord.description;

  // Notes chips
  const notesList = document.getElementById('chord-notes-list');
  notesList.innerHTML = '';
  notes.forEach((note, i) => {
    const chip = document.createElement('span');
    chip.className = i === 0 ? 'note-chip root-chip' : 'note-chip';
    chip.textContent = note;
    notesList.appendChild(chip);
  });

  // Formula chips
  const formulaList = document.getElementById('chord-intervals-list');
  formulaList.innerHTML = '';
  chord.formula.forEach(f => {
    const chip = document.createElement('span');
    chip.className = 'interval-chip';
    chip.textContent = f;
    formulaList.appendChild(chip);
  });

  highlightChord(selectedRoot, selectedChordType);
}

// ===== Playback =====
function playChord(root, chordType, arpeggiate = false) {
  const ctx = getAudioContext();
  ctx.resume().then(() => {
    const notesFull = getChordNotesFull(root, chordType);
    if (arpeggiate) {
      notesFull.forEach((n, i) => scheduleNote(ctx, noteToFreq(n.note, n.octave), i * 0.18, 1.4));
    } else {
      notesFull.forEach(n => scheduleNote(ctx, noteToFreq(n.note, n.octave), 0, 1.5));
    }
  }).catch(err => console.error('Audio playback failed:', err));
}

// ===== Tabs =====
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ===== Quiz =====
const QUIZ_QUESTION_TYPES = ['identify-chord', 'identify-notes', 'identify-root'];

function getRandomChordType() {
  const keys = Object.keys(CHORD_TYPES);
  return keys[Math.floor(Math.random() * keys.length)];
}

function getRandomRoot() {
  return NOTES[Math.floor(Math.random() * NOTES.length)];
}

function getWrongOptions(correctKey, count, type) {
  const pool = type === 'identify-notes'
    ? NOTES.filter(n => n !== correctKey)
    : Object.keys(CHORD_TYPES).filter(k => k !== correctKey);

  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function startQuiz() {
  const qType = QUIZ_QUESTION_TYPES[Math.floor(Math.random() * QUIZ_QUESTION_TYPES.length)];
  const root = getRandomRoot();
  const chordType = getRandomChordType();
  const chord = CHORD_TYPES[chordType];
  const notes = getChordNotes(root, chordType);

  let prompt, correctAnswer, optionValues, displayFn;

  if (qType === 'identify-chord') {
    prompt = `Listen to this chord and identify it:`;
    correctAnswer = chordType;
    const wrongs = getWrongOptions(chordType, 3, 'identify-chord');
    const allOptions = [chordType, ...wrongs].sort(() => Math.random() - 0.5);
    optionValues = allOptions.map(k => ({ value: k, label: CHORD_TYPES[k].label }));
    // Store for the play button (auto-play blocked on iOS outside user gesture)
    quizPlayRoot = root;
    quizPlayChordType = chordType;
  } else if (qType === 'identify-notes') {
    prompt = `Which notes are in a ${root} ${chord.label} chord?`;
    correctAnswer = notes.join(', ');
    // Generate 3 plausible wrong note sets
    const wrongs = [
      getChordNotes(root, getRandomChordType()),
      getChordNotes(getRandomRoot(), chordType),
      getChordNotes(getRandomRoot(), getRandomChordType()),
    ].filter(w => w.join(',') !== notes.join(','));
    const allSets = [notes, ...wrongs.slice(0,3)].sort(() => Math.random() - 0.5);
    optionValues = allSets.map(ns => ({ value: ns.join(', '), label: ns.join(' – ') }));
  } else {
    // identify-root: show the chord notes, guess the root
    prompt = `The notes ${notes.join(', ')} form a ${chord.label} chord. What is the root note?`;
    correctAnswer = root;
    const wrongs = NOTES.filter(n => n !== root).sort(() => Math.random() - 0.5).slice(0, 3);
    const allOptions = [root, ...wrongs].sort(() => Math.random() - 0.5);
    optionValues = allOptions.map(n => ({ value: n, label: n }));
  }

  // Remember state
  quizAnswer = correctAnswer;
  quizAnswered = false;

  // Highlight the chord for visual types
  if (qType !== 'identify-chord') {
    highlightChord(root, chordType);
  } else {
    document.querySelectorAll('.key').forEach(k =>
      k.classList.remove('highlighted', 'root-highlighted')
    );
  }

  // Render
  document.getElementById('quiz-question').classList.remove('hidden');
  document.getElementById('quiz-prompt').textContent = prompt;
  document.getElementById('quiz-feedback').classList.add('hidden');
  document.getElementById('quiz-next-btn').classList.add('hidden');

  // Show play button only for listen-and-identify questions
  const playBtn = document.getElementById('quiz-play-btn');
  if (qType === 'identify-chord') {
    playBtn.classList.remove('hidden');
  } else {
    playBtn.classList.add('hidden');
  }

  const optionsEl = document.getElementById('quiz-options');
  optionsEl.innerHTML = '';
  optionValues.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.textContent = opt.label;
    btn.dataset.value = opt.value;
    btn.addEventListener('click', () => handleQuizAnswer(opt.value, root, chordType));
    optionsEl.appendChild(btn);
  });
}

function handleQuizAnswer(selected, root, chordType) {
  if (quizAnswered) return;
  quizAnswered = true;
  quizTotal++;
  document.getElementById('quiz-total').textContent = quizTotal;

  const isCorrect = selected === quizAnswer;
  if (isCorrect) quizScore++;
  document.getElementById('quiz-score').textContent = quizScore;

  // Mark options
  document.querySelectorAll('.quiz-option').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.value === quizAnswer) btn.classList.add('correct');
    else if (btn.dataset.value === selected && !isCorrect) btn.classList.add('wrong');
  });

  // Feedback
  const feedbackEl = document.getElementById('quiz-feedback');
  feedbackEl.classList.remove('hidden', 'correct', 'wrong');
  feedbackEl.classList.add(isCorrect ? 'correct' : 'wrong');

  const notes = getChordNotes(root, chordType).join(', ');
  feedbackEl.textContent = isCorrect
    ? `Correct! The ${root} ${CHORD_TYPES[chordType].label} chord uses notes: ${notes}.`
    : `Not quite. The correct answer was: ${quizAnswer}. The ${root} ${CHORD_TYPES[chordType].label} uses: ${notes}.`;

  // Show chord on keyboard
  highlightChord(root, chordType);

  // Play the chord so user hears it
  playChord(root, chordType);

  document.getElementById('quiz-next-btn').classList.remove('hidden');
}

// ===== Init =====
function init() {
  buildKeyboard();
  buildSelects();
  setupTabs();
  updateChordDisplay();

  document.getElementById('play-btn').addEventListener('click', () => {
    playChord(selectedRoot, selectedChordType, false);
  });

  document.getElementById('play-arp-btn').addEventListener('click', () => {
    playChord(selectedRoot, selectedChordType, true);
  });

  document.getElementById('quiz-start-btn').addEventListener('click', startQuiz);
  document.getElementById('quiz-next-btn').addEventListener('click', startQuiz);
  document.getElementById('quiz-play-btn').addEventListener('click', () => {
    if (quizPlayRoot && quizPlayChordType) playChord(quizPlayRoot, quizPlayChordType);
  });
}

document.addEventListener('DOMContentLoaded', init);
