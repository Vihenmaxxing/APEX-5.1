/* ==========================================
   APEX 5.1 — QUOTES

   The original build had no quotes of its own. The home card read an
   imported quotes.txt out of localStorage and, if that key was missing or
   the module never initialised, showed "Import your quote library to begin."
   A fresh install had nothing to say, and the midnight crash made an intact
   library look deleted.

   This version:
     * ships a built-in library, so APEX always has something to show;
     * keeps the personal library separate, so importing a new file can
       never wipe the built-ins and vice versa;
     * stores imported text itself — the original .txt file is not needed
       again after import;
     * picks one quote per LOCAL calendar day and remembers the choice, so
       refreshing mid-day does not reshuffle it.
   ========================================== */

/* ---------- Storage keys ----------
   apexQuoteLibrary is the ORIGINAL key and still holds the personal library,
   so anybody upgrading from 5.0 keeps the quotes they imported. */
const QUOTE_KEYS = {
  personal:  "apexQuoteLibrary",   // unchanged from 5.0 — do not rename
  dailyPick: "apexDailyQuote",     // unchanged from 5.0
  prefs:     "apexQuotePrefs"      // new: which library/libraries to draw from
};

/* ---------- Built-in library ----------
   Attributions are restricted to quotations that are reliably and commonly
   attributed to the named person. Where a line is proverbial, widely
   misattributed, or of disputed origin it is either omitted or marked
   "Proverb" rather than given a false author.

   Known traps deliberately avoided here: the "we are what we repeatedly do"
   line is Will Durant summarising Aristotle, not Aristotle; and the
   "it always seems impossible until it's done" line is frequently attached
   to Mandela without a reliable primary source. Neither is in this list. */
const APEX_BUILTIN_QUOTES = [
  { text: "Discipline equals freedom.", author: "Jocko Willink" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "Waste no more time arguing about what a good man should be. Be one.", author: "Marcus Aurelius" },
  { text: "If it is not right, do not do it; if it is not true, do not say it.", author: "Marcus Aurelius" },
  { text: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  { text: "He who fears he shall suffer, already suffers what he fears.", author: "Michel de Montaigne" },
  { text: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { text: "Luck is what happens when preparation meets opportunity.", author: "Seneca" },
  { text: "It is not that we have a short time to live, but that we waste much of it.", author: "Seneca" },
  { text: "No man is free who is not master of himself.", author: "Epictetus" },
  { text: "First say to yourself what you would be; and then do what you have to do.", author: "Epictetus" },
  { text: "It is impossible for a man to learn what he thinks he already knows.", author: "Epictetus" },
  { text: "Knowing yourself is the beginning of all wisdom.", author: "Aristotle" },
  { text: "The unexamined life is not worth living.", author: "Socrates" },
  { text: "A journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "Mastering others is strength. Mastering yourself is true power.", author: "Lao Tzu" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "The man who moves a mountain begins by carrying away small stones.", author: "Confucius" },
  { text: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },

  { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison" },
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison" },
  { text: "Nothing in life is to be feared, it is only to be understood.", author: "Marie Curie" },
  { text: "Be less curious about people and more curious about ideas.", author: "Marie Curie" },
  { text: "If I have seen further it is by standing on the shoulders of giants.", author: "Isaac Newton" },
  { text: "It's not that I'm so smart, it's just that I stay with problems longer.", author: "Albert Einstein" },
  { text: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
  { text: "The important thing is not to stop questioning.", author: "Albert Einstein" },
  { text: "Somewhere, something incredible is waiting to be known.", author: "Carl Sagan" },
  { text: "The first principle is that you must not fool yourself — and you are the easiest person to fool.", author: "Richard Feynman" },
  { text: "Study hard what interests you the most in the most undisciplined, irreverent and original manner possible.", author: "Richard Feynman" },
  { text: "What I cannot create, I do not understand.", author: "Richard Feynman" },

  { text: "It always seems impossible until it is done.", author: "Proverb" },
  { text: "The best time to plant a tree was twenty years ago. The second best time is now.", author: "Proverb" },
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
  { text: "Smooth seas do not make skilful sailors.", author: "Proverb" },
  { text: "Slow is smooth, and smooth is fast.", author: "Proverb" },

  { text: "I never lose. I either win or learn.", author: "Nelson Mandela" },
  { text: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela" },
  { text: "The greatest glory in living lies not in never falling, but in rising every time we fall.", author: "Nelson Mandela" },
  { text: "Everybody is a genius. But if you judge a fish by its ability to climb a tree, it will live its whole life believing that it is stupid.", author: "Attributed to Albert Einstein (disputed)" },
  { text: "Whether you think you can or you think you can't, you're right.", author: "Henry Ford" },
  { text: "Quality means doing it right when no one is looking.", author: "Henry Ford" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Attributed to Winston Churchill (disputed)" },
  { text: "Perfection is not attainable, but if we chase perfection we can catch excellence.", author: "Vince Lombardi" },
  { text: "The only place where success comes before work is in the dictionary.", author: "Vidal Sassoon" },
  { text: "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.", author: "Stephen King" },
  { text: "If you want to be a writer, you must do two things above all others: read a lot and write a lot.", author: "Stephen King" },

  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "I've missed more than 9,000 shots in my career. I've lost almost 300 games. I've failed over and over again in my life. And that is why I succeed.", author: "Michael Jordan" },
  { text: "Some people want it to happen, some wish it would happen, others make it happen.", author: "Michael Jordan" },
  { text: "You have to fight to reach your dream. You have to sacrifice and work hard for it.", author: "Lionel Messi" },
  { text: "If you don't believe you are the best, then you will never achieve all that you are capable of.", author: "Cristiano Ronaldo" },
  { text: "Once you have been part of a team, you know what it is to fight for something bigger than yourself.", author: "Dennis Bergkamp" },
  { text: "Being second is to be the first of the ones who lose.", author: "Ayrton Senna" },
  { text: "If you no longer go for a gap that exists, you're no longer a racing driver.", author: "Ayrton Senna" },
  { text: "You will never know the feeling of a driver when winning a race. The helmet hides feelings that cannot be understood.", author: "Ayrton Senna" },
  { text: "To achieve anything, you must be prepared to dabble on the boundary of disaster.", author: "Stirling Moss" },
  { text: "Straight roads are for fast cars, turns are for fast drivers.", author: "Colin McRae" },

  { text: "What gets measured gets managed.", author: "Peter Drucker" },
  { text: "There is nothing so useless as doing efficiently that which should not be done at all.", author: "Peter Drucker" },
  { text: "The key is not to prioritise what's on your schedule, but to schedule your priorities.", author: "Stephen Covey" },
  { text: "Most of what we say and do is not essential. If you can eliminate it, you'll have more time and more tranquillity.", author: "Marcus Aurelius" },
  { text: "You do not rise to the level of your goals. You fall to the level of your systems.", author: "James Clear" },
  { text: "Every action you take is a vote for the type of person you wish to become.", author: "James Clear" },
  { text: "Deep work is the ability to focus without distraction on a cognitively demanding task.", author: "Cal Newport" },
  { text: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { text: "I fear not the man who has practised 10,000 kicks once, but I fear the man who has practised one kick 10,000 times.", author: "Bruce Lee" },
  { text: "Absorb what is useful, discard what is useless, and add what is specifically your own.", author: "Bruce Lee" },

  { text: "Nothing will work unless you do.", author: "Maya Angelou" },
  { text: "You may not control all the events that happen to you, but you can decide not to be reduced by them.", author: "Maya Angelou" },
  { text: "Do the best you can until you know better. Then when you know better, do better.", author: "Maya Angelou" },
  { text: "Courage is resistance to fear, mastery of fear — not absence of fear.", author: "Mark Twain" },
  { text: "The secret of getting ahead is getting started.", author: "Attributed to Mark Twain (disputed)" },
  { text: "Continuous effort — not strength or intelligence — is the key to unlocking our potential.", author: "Attributed to Winston Churchill (disputed)" },
  { text: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { text: "By failing to prepare, you are preparing to fail.", author: "Benjamin Franklin" },
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  { text: "Tell me and I forget. Teach me and I remember. Involve me and I learn.", author: "Attributed to Benjamin Franklin (disputed)" },

  { text: "The mind is everything. What you think you become.", author: "Attributed to the Buddha" },
  { text: "Change is the end result of all true learning.", author: "Leo Buscaglia" },
  { text: "Live as if you were to die tomorrow. Learn as if you were to live forever.", author: "Attributed to Mahatma Gandhi" },
  { text: "Strength does not come from physical capacity. It comes from an indomitable will.", author: "Mahatma Gandhi" },
  { text: "In a gentle way, you can shake the world.", author: "Mahatma Gandhi" },
  { text: "Arise, awake, and stop not till the goal is reached.", author: "Swami Vivekananda" },
  { text: "Take up one idea. Make that one idea your life.", author: "Swami Vivekananda" },
  { text: "Dream is not that which you see while sleeping, it is something that does not let you sleep.", author: "A. P. J. Abdul Kalam" },
  { text: "If you want to shine like a sun, first burn like a sun.", author: "A. P. J. Abdul Kalam" },
  { text: "Excellence is a continuous process and not an accident.", author: "A. P. J. Abdul Kalam" },
  { text: "All the world's problems can be solved in a garden.", author: "Geoff Lawton" },

  { text: "Simplicity is the ultimate sophistication.", author: "Attributed to Leonardo da Vinci" },
  { text: "Poor is the pupil who does not surpass his master.", author: "Leonardo da Vinci" },
  { text: "I am still learning.", author: "Michelangelo" },
  { text: "Whatever you are, be a good one.", author: "Attributed to Abraham Lincoln" },
  { text: "Give me six hours to chop down a tree and I will spend the first four sharpening the axe.", author: "Attributed to Abraham Lincoln (disputed)" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "Perseverance is not a long race; it is many short races one after the other.", author: "Walter Elliot" },
  { text: "Great things are not done by impulse, but by a series of small things brought together.", author: "Vincent van Gogh" },
  { text: "I would rather die of passion than of boredom.", author: "Vincent van Gogh" },
  { text: "Done is better than perfect.", author: "Proverb" },
  { text: "Comparison is the thief of joy.", author: "Attributed to Theodore Roosevelt" },
  { text: "Nothing in the world is worth having or worth doing unless it means effort, pain, difficulty.", author: "Theodore Roosevelt" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "Out of clutter, find simplicity. From discord, find harmony. In the middle of difficulty lies opportunity.", author: "Attributed to Albert Einstein" },
  { text: "Rivers know this: there is no hurry. We shall get there some day.", author: "A. A. Milne" },
  { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "Success is where preparation and opportunity meet.", author: "Bobby Unser" },
  { text: "Motivation gets you going, but discipline keeps you growing.", author: "John C. Maxwell" },
  { text: "A goal without a plan is just a wish.", author: "Attributed to Antoine de Saint-Exupery" }
];

/* ---------- Preferences ---------- */
const QUOTE_MODES = { BUILTIN: "builtin", PERSONAL: "personal", BOTH: "both" };

function quoteDefaultPrefs() {
  return { mode: QUOTE_MODES.BOTH, v: 1 };
}

function quoteLoadPrefs() {
  const raw = ApexStore.read(QUOTE_KEYS.prefs, null);
  const prefs = quoteDefaultPrefs();
  if (raw && typeof raw === "object" &&
      Object.values(QUOTE_MODES).includes(raw.mode)) prefs.mode = raw.mode;
  return prefs;
}

function quoteSavePrefs(prefs) { return ApexStore.write(QUOTE_KEYS.prefs, prefs); }

/* ---------- Personal library ---------- */
function quoteLoadPersonal() {
  const raw = ApexStore.read(QUOTE_KEYS.personal, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(q => {
      if (typeof q === "string") return { text: q.trim(), author: "" };
      if (q && typeof q.text === "string") return { text: String(q.text).trim(), author: String(q.author || "").trim() };
      return null;
    })
    .filter(q => q && q.text);
}

function quoteSavePersonal(list) { return ApexStore.write(QUOTE_KEYS.personal, list); }

/* ---------- Parsing an uploaded quotes.txt ----------
   One quote per line. "Text | Author" splits on the first pipe. Blank lines
   and lines starting with # are ignored. A trailing "— Author" or "- Author"
   is also recognised, because that is how most people actually write them. */
function quoteParseText(text) {
  const out = [];
  String(text || "").split(/\r\n|\r|\n/).forEach(line => {
    const trimmed = line.trim().replace(/^\uFEFF/, "");   // strip a UTF-8 BOM
    if (!trimmed || trimmed.startsWith("#")) return;

    let body = trimmed, author = "";
    const pipe = body.indexOf("|");
    if (pipe >= 0) {
      author = body.slice(pipe + 1).trim();
      body = body.slice(0, pipe).trim();
    } else {
      const dash = body.match(/\s+[—–-]{1,2}\s*([^—–-]{2,60})$/);
      if (dash) { author = dash[1].trim(); body = body.slice(0, dash.index).trim(); }
    }
    body = body.replace(/^["“”']+|["“”']+$/g, "").trim();
    if (!body) return;
    out.push({ text: body, author });
  });
  return out;
}

/* Normalised form used for duplicate detection: case, punctuation and
   whitespace insensitive, so the same quote typed twice is caught. */
function quoteFingerprint(q) {
  return String(q && q.text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Import. `mode` is "merge" (default) or "replace".
   Replace only ever touches the PERSONAL library — the built-ins are code,
   not storage, so they can never be deleted by an import. */
function quoteImport(text, mode = "merge") {
  const parsed = quoteParseText(text);
  if (!parsed.length) {
    return { ok: false, added: 0, duplicates: 0, total: quoteLoadPersonal().length,
             message: "No usable quotes found. Put one quote per line, optionally as \"Quote | Author\"." };
  }

  const existing = mode === "replace" ? [] : quoteLoadPersonal();
  const seen = new Set(existing.map(quoteFingerprint));
  let added = 0, duplicates = 0;

  parsed.forEach(q => {
    const fp = quoteFingerprint(q);
    if (!fp) return;
    if (seen.has(fp)) { duplicates++; return; }
    seen.add(fp);
    existing.push(q);
    added++;
  });

  if (!quoteSavePersonal(existing)) {
    return { ok: false, added: 0, duplicates, total: quoteLoadPersonal().length,
             message: "Could not save the quotes — browser storage refused the write. Nothing was changed." };
  }

  /* A fresh import should be visible straight away, so drop today's pick and
     let it be re-chosen from the new library. The LIBRARY is untouched. */
  ApexStore.remove(QUOTE_KEYS.dailyPick);

  const parts = [`${added} quote${added === 1 ? "" : "s"} imported`];
  if (duplicates) parts.push(`${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped`);
  parts.push(`${existing.length} in your personal library`);
  return { ok: true, added, duplicates, total: existing.length, message: parts.join(" · ") + "." };
}

function quoteClearPersonal() {
  const n = quoteLoadPersonal().length;
  quoteSavePersonal([]);
  ApexStore.remove(QUOTE_KEYS.dailyPick);
  return n;
}

/* ---------- The active pool ----------
   The safety net the brief asks for: an empty personal library must never
   produce an empty display while built-ins exist. If the chosen mode yields
   nothing, fall back to the built-ins rather than showing nothing. */
function quoteActivePool() {
  const prefs = quoteLoadPrefs();
  const personal = quoteLoadPersonal();
  let pool = [];

  if (prefs.mode === QUOTE_MODES.BUILTIN) pool = APEX_BUILTIN_QUOTES.slice();
  else if (prefs.mode === QUOTE_MODES.PERSONAL) pool = personal.slice();
  else pool = APEX_BUILTIN_QUOTES.concat(personal);

  if (!pool.length) pool = APEX_BUILTIN_QUOTES.slice();
  return pool;
}

/* ---------- Daily selection ----------
   Index-free: the stored pick carries the quote itself plus a fingerprint,
   so re-importing or reordering a library cannot make yesterday's stored
   index point at a different quote (which is what made the old version jump
   around). Selection is deterministic per day, derived from the date key,
   so two devices on the same day agree and a refresh never reshuffles. */
function quoteHashDay(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function quoteOfTheDay(dayKey = ApexDate.today()) {
  const pool = quoteActivePool();
  if (!pool.length) return null;   // cannot happen: built-ins are non-empty

  const saved = ApexStore.read(QUOTE_KEYS.dailyPick, null);
  if (saved && saved.date === dayKey && saved.text) {
    const still = pool.find(q => quoteFingerprint(q) === saved.fp);
    if (still) return still;
    /* The saved quote is no longer in the pool (library or mode changed).
       Fall through and pick again — but never blank the display. */
  }

  const index = quoteHashDay(dayKey) % pool.length;
  const chosen = pool[index];
  ApexStore.write(QUOTE_KEYS.dailyPick, {
    date: dayKey, text: chosen.text, author: chosen.author || "",
    fp: quoteFingerprint(chosen)
  });
  return chosen;
}

/* ---------- Stats for the settings panel ---------- */
function quoteStats() {
  const personal = quoteLoadPersonal();
  return { builtin: APEX_BUILTIN_QUOTES.length, personal: personal.length,
           mode: quoteLoadPrefs().mode, active: quoteActivePool().length };
}

window.ApexQuotes = {
  KEYS: QUOTE_KEYS, MODES: QUOTE_MODES, BUILTIN: APEX_BUILTIN_QUOTES,
  parse: quoteParseText, import: quoteImport, clearPersonal: quoteClearPersonal,
  loadPersonal: quoteLoadPersonal, loadPrefs: quoteLoadPrefs, savePrefs: quoteSavePrefs,
  pool: quoteActivePool, ofTheDay: quoteOfTheDay, stats: quoteStats,
  fingerprint: quoteFingerprint
};

/* ---------- Quote library settings card ----------
   Appended to the Progression page by platform.js, next to the data tools,
   so library management lives alongside backup and restore. */
function renderQuoteSettings(){
  const root = document.getElementById("xpRoot");
  if (!root || typeof section !== "function" || typeof btn !== "function") return;

  const stats = ApexQuotes.stats();
  const card = section("QUOTE LIBRARY");
  card.appendChild(el("p", "muted-small",
    `${stats.builtin} built-in quotes ship with APEX and cannot be deleted. ` +
    `You have ${stats.personal} personal quote${stats.personal === 1 ? "" : "s"} imported. ` +
    `${stats.active} are in today's pool.`));

  /* Mode picker */
  const modes = [
    [QUOTE_MODES.BOTH,     "BOTH LIBRARIES", "Built-in quotes and your own, together."],
    [QUOTE_MODES.BUILTIN,  "BUILT-IN ONLY",  "Only the quotes that ship with APEX."],
    [QUOTE_MODES.PERSONAL, "PERSONAL ONLY",  "Only quotes you imported. Falls back to the built-ins if yours are empty."]
  ];
  const picker = el("div", "quote-modes");
  modes.forEach(([value, label, help]) => {
    const row = el("label", "cal-check quote-mode" + (stats.mode === value ? " is-on" : ""));
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "apexQuoteMode"; radio.value = value;
    radio.checked = stats.mode === value;
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      const prefs = ApexQuotes.loadPrefs();
      prefs.mode = value;
      ApexQuotes.savePrefs(prefs);
      /* Drop today's pick so the new mode takes effect immediately. The
         libraries themselves are untouched. */
      ApexStore.remove(QUOTE_KEYS.dailyPick);
      if (typeof showDailyQuote === "function") showDailyQuote();
      renderXPPage();
    });
    const copy = el("span", "quote-mode-copy");
    copy.append(el("strong", "", label), el("small", "", help));
    row.append(radio, copy);
    picker.appendChild(row);
  });
  card.appendChild(picker);

  /* Import / manage */
  const actions = el("div", "apex-data-actions");
  const label = el("label", "file-import", "IMPORT QUOTES.TXT");
  label.setAttribute("for", "apexQuoteSettingsFile");
  const input = document.createElement("input");
  input.type = "file"; input.id = "apexQuoteSettingsFile";
  input.accept = ".txt,text/plain"; input.hidden = true;
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const existing = ApexQuotes.loadPersonal().length;
    let mode = "merge";
    if (existing > 0){
      mode = confirm(`You already have ${existing} personal quote${existing === 1 ? "" : "s"}.\n\n` +
                     `OK      — add this file to them\n` +
                     `Cancel  — replace your personal quotes with this file\n\n` +
                     `The ${APEX_BUILTIN_QUOTES.length} built-in quotes are kept either way.`)
             ? "merge" : "replace";
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = ApexQuotes.import(String(reader.result || ""), mode);
      const msg = document.getElementById("apexQuoteMsg");
      if (msg) msg.textContent = result.message;
      if (result.ok && typeof showDailyQuote === "function") showDailyQuote();
      input.value = "";
      if (result.ok) renderXPPage();
    };
    reader.onerror = () => {
      const msg = document.getElementById("apexQuoteMsg");
      if (msg) msg.textContent = "Could not read that file. Save it as plain UTF-8 text.";
      input.value = "";
    };
    reader.readAsText(file, "utf-8");
  });
  actions.append(label, input);

  actions.appendChild(btn("EXPORT MY QUOTES", "secondary", () => {
    const personal = ApexQuotes.loadPersonal();
    const msg = document.getElementById("apexQuoteMsg");
    if (!personal.length){ if (msg) msg.textContent = "You have no personal quotes to export."; return; }
    const text = personal.map(q => q.author ? `${q.text} | ${q.author}` : q.text).join("\n") + "\n";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `apex-quotes-${ApexDate.today()}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (msg) msg.textContent = `${personal.length} quotes exported as a .txt file.`;
  }));

  if (stats.personal > 0){
    actions.appendChild(btn("CLEAR MY QUOTES", "record-delete", () => {
      if (!confirm(`Delete all ${stats.personal} of your personal quotes?\n\n` +
                   `The ${APEX_BUILTIN_QUOTES.length} built-in quotes are NOT affected, and your ` +
                   `most recent daily snapshot still contains them.`)) return;
      const n = ApexQuotes.clearPersonal();
      if (typeof showDailyQuote === "function") showDailyQuote();
      renderXPPage();
      const msg = document.getElementById("apexQuoteMsg");
      if (msg) msg.textContent = `${n} personal quotes removed. The built-in library is intact.`;
    }));
  }
  card.appendChild(actions);

  card.appendChild(el("p", "muted-small",
    "File format: one quote per line. Add an author with a pipe — \"Quote text | Author\" — " +
    "or a trailing dash. Blank lines and lines starting with # are ignored. Duplicates are skipped."));

  const msg = el("p", "form-message apex-data-msg", "");
  msg.id = "apexQuoteMsg"; msg.setAttribute("role", "status");
  card.appendChild(msg);
  root.appendChild(card);
}
window.renderQuoteSettings = renderQuoteSettings;
