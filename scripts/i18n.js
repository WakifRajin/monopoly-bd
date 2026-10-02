// ═══════════════════════════════════════════════
//  INTERFACE LANGUAGE
//  English is the source language everywhere in the code, and the game state
//  (log lines included) stays English, so players in one online match can use
//  different languages. Translation happens at display time: every text node
//  and label that reaches the page is looked up in the dictionary for the
//  chosen language (scripts/i18n-bn.js): exact phrases first, then patterns
//  for sentences with names and amounts in them. Board names and card texts
//  come from the board itself and are left alone.
// ═══════════════════════════════════════════════

const UI_LANG_KEY = "monopoly_ui_lang";
const UI_LANGS = ["en", "bn"];
const I18N = {
  lang: "en",
  cache: new Map(),
  original: new WeakMap(), // text node -> source text
  shown: new WeakMap(), // text node -> what we last wrote
  attrs: new WeakMap(), // element -> { attr: { source, shown } }
  observer: null,
};
const I18N_ATTRS = ["placeholder", "title", "aria-label", "alt"];
// Never translated here: things people type, codes that must be read exactly,
// and the game log, which is translated as whole sentences when it is built.
const I18N_SKIP =
  "script, style, textarea, code, [data-no-i18n], .online-open-room-code, #chat-log, #drawer-chat, .chat-msg, .chat-text, .log-entry, .log-turn-head";
// Soft hyphens (in board names) and non-breaking spaces don't change meaning.
const SOFT_HYPHEN_RE = new RegExp(String.fromCharCode(0xad), "g");
const NBSP_RE = new RegExp(String.fromCharCode(0xa0), "g");

function currentUiLanguage() {
  return I18N.lang;
}

function readUiLanguage() {
  try {
    const saved = localStorage.getItem(UI_LANG_KEY);
    if (UI_LANGS.includes(saved)) return saved;
  } catch (_err) {
    /* fall through to the browser's language */
  }
  const nav = String(navigator.language || "").toLowerCase();
  return nav.startsWith("bn") ? "bn" : "en";
}

function i18nDictionary() {
  return I18N.lang === "bn" && typeof I18N_BN !== "undefined" ? I18N_BN : null;
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
// Numbers that stand on their own become Bangla digits; ones attached to a
// word (Gulshan-1, room codes like AB12CD) are part of a name and stay.
// Text inside {{ }} in a dictionary entry is kept exactly (examples of what
// to type, which must stay in Latin digits).
function toBanglaDigits(text) {
  return text
    .split(/(\{\{.*?\}\})/)
    .map((part) => (part.startsWith("{{") ? part.slice(2, -2) : banglaDigitsIn(part)))
    .join("");
}

function banglaDigitsIn(text) {
  return text.replace(/(^|[^A-Za-z0-9\-_/#:])(\d[\d,.:]*)(?![A-Za-z0-9_])/g, (m, pre, num) => pre + num.replace(/\d/g, (d) => BN_DIGITS[d]));
}

// Translates one piece of text. Surrounding whitespace is kept as it was.
function translateText(text) {
  const dict = i18nDictionary();
  const raw = String(text ?? "");
  if (!dict || !/[A-Za-z0-9]/.test(raw)) return raw;
  const lead = raw.match(/^\s*/)[0];
  const trail = raw.slice(lead.length).match(/\s*$/)[0];
  const core = raw.slice(lead.length, raw.length - trail.length);
  if (!core) return raw;
  if (I18N.cache.has(core)) return lead + I18N.cache.get(core) + trail;
  const key = core.replace(SOFT_HYPHEN_RE, "").replace(NBSP_RE, " ").replace(/\s+/g, " ");
  let out = null;
  if (Object.prototype.hasOwnProperty.call(dict.exact, key)) {
    out = dict.exact[key];
  } else {
    for (const [re, rep] of dict.patterns) {
      re.lastIndex = 0;
      if (re.test(key)) {
        re.lastIndex = 0;
        out = key.replace(re, (...args) => {
          const groups = args.slice(1, -2).map((g) => (g === undefined ? "" : translateFragment(g)));
          return typeof rep === "function" ? rep(...groups) : rep.replace(/\$(\d)/g, (_, n) => groups[n - 1] ?? "");
        });
        break;
      }
    }
  }
  // A list of parts ("2 players · Dhaka City · 3 turns in"): each part alone.
  if (out === null && key.includes(" · ")) {
    const parts = key.split(" · ");
    const done = parts.map((part) => translateText(part));
    if (done.some((t, i) => t !== parts[i])) out = done.join(" · ");
  }
  // Unknown English stays exactly as written, digits included (instructions
  // such as "house:25" must stay typeable). Amounts, times and other text
  // with no words in it still get Bangla digits.
  const known = out !== null;
  if (out === null) out = core;
  out = dict.finish ? dict.finish(out) : out;
  if (known || !/[A-Za-z]/.test(out)) out = toBanglaDigits(out);
  else out = out.replace(/\{\{(.*?)\}\}/g, "$1");
  if (I18N.cache.size > 5000) I18N.cache.clear();
  I18N.cache.set(core, out);
  return lead + out + trail;
}

// A captured piece of a sentence (a player name, a property, an amount, a
// nested phrase): translated only if the whole piece is a known phrase.
let I18N_LOWER = null;
function translateFragment(text) {
  const dict = i18nDictionary();
  if (!dict) return text;
  const key = String(text).replace(SOFT_HYPHEN_RE, "");
  if (Object.prototype.hasOwnProperty.call(dict.exact, key)) return dict.exact[key];
  // Board names arrive upper-cased on the board ("DHAKA CITY EDITION").
  if (!I18N_LOWER) {
    I18N_LOWER = new Map();
    for (const k of Object.keys(dict.exact)) I18N_LOWER.set(k.toLowerCase(), dict.exact[k]);
  }
  const lower = I18N_LOWER.get(key.toLowerCase());
  if (lower !== undefined) return lower;
  if (dict.fragment) return dict.fragment(key);
  return key;
}

// For code that builds display text itself (the game log, the 3D board): the
// text as it should be shown in the current language.
function uiText(text) {
  return I18N.lang === "en" ? String(text ?? "") : translateText(text);
}

function i18nSkipped(el) {
  return !!(el && el.closest && el.closest(I18N_SKIP));
}

// `force` re-applies the current language to text this file already wrote
// (a language switch); otherwise only new text is handled. Either way the
// English source is kept, so any number of switches end up right.
function translateTextNode(node, force = false) {
  const parent = node.parentElement;
  if (!parent || i18nSkipped(parent)) return;
  const current = node.nodeValue;
  const ours = I18N.original.has(node) && I18N.shown.get(node) === current;
  if (ours && !force) return;
  const source = ours ? I18N.original.get(node) : current;
  I18N.original.set(node, source);
  const next = I18N.lang === "en" ? source : translateText(source);
  I18N.shown.set(node, next);
  if (next !== current) node.nodeValue = next;
}

function translateAttributes(el, force = false) {
  if (i18nSkipped(el)) return;
  const rec = I18N.attrs.get(el) || {};
  for (const attr of I18N_ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const current = el.getAttribute(attr);
    const r = rec[attr];
    const ours = !!r && r.shown === current;
    if (ours && !force) continue;
    const source = ours ? r.source : current;
    const next = I18N.lang === "en" ? source : translateText(source);
    rec[attr] = { source, shown: next };
    if (next !== current) el.setAttribute(attr, next);
  }
  I18N.attrs.set(el, rec);
}

function translateTree(root, force = false) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root, force);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || i18nSkipped(root)) return;
  translateAttributes(root, force);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && i18nSkipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) translateTextNode(n, force);
    else translateAttributes(n, force);
  }
}

function onI18nMutations(list) {
  if (I18N.lang === "en") return;
  for (const m of list) {
    if (m.type === "characterData") translateTextNode(m.target);
    else if (m.type === "attributes") translateAttributes(m.target);
    else m.addedNodes.forEach((node) => translateTree(node));
  }
}

function startI18nObserver() {
  if (I18N.observer) return;
  I18N.observer = new MutationObserver(onI18nMutations);
  I18N.observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: I18N_ATTRS,
  });
}

// The English text an element was built from, for code that needs to
// recognise what it last wrote.
function sourceText(el) {
  if (!el) return "";
  const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (!node) return el.textContent;
  const src = I18N.original.get(node);
  return src !== undefined && I18N.shown.get(node) === node.nodeValue ? src : node.nodeValue;
}

let I18N_TITLE_SOURCE = "";
function translateDocumentTitle() {
  if (!I18N_TITLE_SOURCE) I18N_TITLE_SOURCE = document.title;
  document.title = I18N.lang === "en" ? I18N_TITLE_SOURCE : translateText(I18N_TITLE_SOURCE);
}

function applyUiLanguage() {
  document.documentElement.lang = I18N.lang;
  document.documentElement.classList.toggle("lang-bn", I18N.lang === "bn");
  I18N.cache.clear();
  translateTree(document.body, true);
  translateDocumentTitle();
}

function setUiLanguage(lang) {
  if (!UI_LANGS.includes(lang) || lang === I18N.lang) return;
  I18N.lang = lang;
  try {
    localStorage.setItem(UI_LANG_KEY, lang);
  } catch (_err) {
    /* applies for this visit only */
  }
  applyUiLanguage();
  // Redraw what is built from code so it picks up the language, the log and
  // the 3D board included.
  if (typeof refreshSettingsViews === "function") refreshSettingsViews();
  if (typeof G !== "undefined" && G && Array.isArray(G.players) && typeof renderAll === "function") renderAll();
  // The Bengali font arrives on first use; redraw the 3D board once it has,
  // or its labels stay in the fallback font.
  if (lang === "bn" && document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('700 24px "Noto Sans Bengali"', "অ"), document.fonts.load('400 24px "Noto Sans Bengali"', "অ")])
      .then(() => {
        const scene = window.Board3D && window.Board3D.instance;
        if (scene && scene.sig) scene.sig.texture = "";
        if (typeof G !== "undefined" && G && Array.isArray(G.players) && typeof renderAll === "function") renderAll();
      })
      .catch(() => {});
  }
}

function installI18n() {
  I18N.lang = readUiLanguage();
  applyUiLanguage();
  startI18nObserver();
}
