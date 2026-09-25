/* ==========================================================================
   Mock Exam Builder — runtime (templates/app.js)
   Shared by every exam file; build.py inlines it into templates/base.html.
   Do not fork this per exam. Exam-specific content lives in the manifest,
   item bank and source pages that build.py embeds.

   It renders ONLY classes from design-system/components.css. The one inline
   style it writes is the data variable `--pct` on .progress / .meter__fill.

   Views: home · order · exam · results · picker · practice · summary · sources
   Storage: localStorage "mockexam:<exam_id>" (try/catch; works without it).
   Mastery is written ONLY by submitExam(). Practice never touches it.
   ========================================================================== */
(function () {
  'use strict';

  /* ── 0. Helpers ─────────────────────────────────────────────────────── */
  var doc = document;
  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function shuffle(arr) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
  function icon(name, cls) { return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtDate(iso, withTime) {
    try {
      var d = new Date(iso);
      var o = { year: 'numeric', month: 'short', day: 'numeric' };
      if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
      return d.toLocaleString(undefined, o);
    } catch (e) { return String(iso); }
  }
  function fmtDur(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + two(m) + ':' + two(ss) : m + ':' + two(ss);
  }
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  var LEVELS = ['recall', 'understand', 'apply', 'analyze'];
  var LEVEL_LABEL = { recall: 'Recall', understand: 'Understand', apply: 'Apply', analyze: 'Analyze' };
  var LEVEL_HINT = {
    recall: 're-read the definitions and key terms in the cited pages',
    understand: 'explain each concept in your own words from the cited pages',
    apply: 'rework the worked examples in the materials step by step',
    analyze: 'compare related concepts side by side using the materials'
  };
  // Two choices on purpose: fewer decisions, and every non-sure right answer counts as a lucky guess.
  var CONF = [['guess', 'Guessing'], ['sure', 'Sure']];
  function lowConf(r) { return !!r.conf && r.conf !== 'sure'; }  // also covers 'unsure' in attempts saved before it was removed
  function isBinary(it) { return it.type === 'tf' || it.type === 'yesno'; }  // yesno: legacy exams only
  // Multi-select (msq): the answer key and the student's answer are sorted index arrays; scoring is all-or-nothing.
  function isMulti(it) { return it.type === 'msq'; }
  function picked(ans, i) { return Array.isArray(ans) ? ans.indexOf(i) >= 0 : ans === i; }
  function sameAnswer(ans, key) {
    if (!Array.isArray(key)) return ans === key;
    return Array.isArray(ans) && ans.length === key.length && key.every(function (k) { return ans.indexOf(k) >= 0; });
  }
  function toggled(ans, i) { var a = Array.isArray(ans) ? ans.slice() : []; var j = a.indexOf(i); if (j >= 0) a.splice(j, 1); else a.push(i); return a.sort(function (x, y) { return x - y; }); }

  /* ── 1. Embedded data ───────────────────────────────────────────────── */
  var M = JSON.parse($('#exam-manifest').textContent);
  var bankEl = $('#exam-bank');
  var KEY = bankEl.getAttribute('data-k') || 'k';
  function decode(b64) {
    var bin = atob(String(b64).replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  var BANK = decode(bankEl.textContent).items;
  var ITEM = {}, ORDER_IN_BANK = {};
  BANK.forEach(function (it, i) { ITEM[it.id] = it; ORDER_IN_BANK[it.id] = i; });
  var SECRETS = {};
  /* Answers, explanations and sources are decoded only here, only on reveal. */
  function reveal(id) { if (!SECRETS[id]) SECRETS[id] = decode(ITEM[id].s); return SECRETS[id]; }
  var PAGES = null;
  function pages() {
    if (!PAGES) { var el = $('#source-pages'); PAGES = el && el.textContent.trim() ? decode(el.textContent) : {}; }
    return PAGES;
  }
  var TOPICS = M.topics || [];
  var TOPIC = {}; TOPICS.forEach(function (t) { TOPIC[t.id] = t; });
  var SOURCES = M.sources || [];
  var SOURCE = {}; SOURCES.forEach(function (s) { SOURCE[s.file] = s; });

  /* ── 2. Storage ─────────────────────────────────────────────────────── */
  var STORE_KEY = 'mockexam:' + M.exam_id;
  var THEME_KEY = 'mockexam:theme';
  function normalize(s) {
    s = s || {};
    return { v: 1, attempts: Array.isArray(s.attempts) ? s.attempts : [], inProgress: s.inProgress || null, practiceCounts: s.practiceCounts || {} };
  }
  function loadStore() { try { var raw = localStorage.getItem(STORE_KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { /* storage unavailable */ } return normalize(); }
  var store = loadStore();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* in-memory only */ } }

  /* ── 3. Mastery (mock exams only) ───────────────────────────────────── */
  var BANDS = {
    weak: { label: 'Weak', glyph: '✕', rank: 0 },
    review: { label: 'Needs review', glyph: '!', rank: 1 },
    none: { label: 'Not attempted', glyph: '–', rank: 2 },
    solid: { label: 'Solid', glyph: '✓', rank: 3 },
    mastered: { label: 'Mastered', glyph: '★', rank: 4 }
  };
  function bandOf(p) { return p == null ? 'none' : p >= 85 ? 'mastered' : p >= 70 ? 'solid' : p >= 50 ? 'review' : 'weak'; }
  function bandPill(b) { var d = BANDS[b] || BANDS.none; return '<span class="band" data-band="' + b + '"><span class="band__dot" aria-hidden="true">' + d.glyph + '</span>' + d.label + '</span>'; }
  function topicScore(a, tid) {
    var c = 0, n = 0;
    a.items.forEach(function (r) { if (r.topic === tid) { n++; if (r.result) c++; } });
    return n ? { correct: c, total: n, pct: pct(c, n) } : null;
  }
  function masteryMap() {
    var out = {};
    TOPICS.forEach(function (t) {
      var hits = store.attempts.map(function (a) { return topicScore(a, t.id); }).filter(Boolean);
      var last = hits[hits.length - 1], prev = hits[hits.length - 2];
      out[t.id] = { pct: last ? last.pct : null, band: bandOf(last ? last.pct : null), last: last || null, prevPct: prev ? prev.pct : null, exams: hits.length };
    });
    return out;
  }
  function conceptStatus() {
    var by = {};
    store.attempts.forEach(function (a, ai) {
      a.items.forEach(function (r) { by[r.concept] = by[r.concept] || {}; (by[r.concept][ai] = by[r.concept][ai] || []).push(r); });
    });
    var st = {};
    Object.keys(by).forEach(function (c) {
      var idx = Object.keys(by[c]).map(Number).sort(function (a, b) { return a - b; });
      var latest = by[c][idx[idx.length - 1]], prev = idx.length > 1 ? by[c][idx[idx.length - 2]] : null;
      var missed = latest.some(function (r) { return !r.result; });
      var low = latest.some(function (r) { return r.result && lowConf(r); });
      var prevMissed = prev && prev.some(function (r) { return !r.result; });
      st[c] = missed ? 'weak' : (low || prevMissed) ? 'shaky' : 'secure';
    });
    return st;
  }
  function recommendedOrder(mm) {
    return TOPICS.map(function (t, i) { return { t: t, i: i, m: mm[t.id] }; })
      .sort(function (a, b) {
        return (BANDS[a.m.band].rank - BANDS[b.m.band].rank) || ((a.m.pct == null ? 0 : a.m.pct) - (b.m.pct == null ? 0 : b.m.pct)) || (a.i - b.i);
      }).map(function (x) { return x.t.id; });
  }
  function courseOrder() { return TOPICS.map(function (t) { return t.id; }); }
  function attemptedIds() { var s = {}; store.attempts.forEach(function (a) { a.items.forEach(function (r) { s[r.id] = true; }); }); return s; }
  function isNewTopic(t, mm) { return M.version > 1 && t.added_in === M.version && mm[t.id].exams === 0; }
  function isNewItem(it, seen) { return M.version > 1 && it.added_in === M.version && !seen[it.id]; }
  function trendHTML(cur, prev) {
    if (cur == null || prev == null) return '';
    var d = cur - prev;
    if (d > 0) return '<span class="trend trend--up" title="Change since previous mock exam">▲ +' + d + '</span>';
    if (d < 0) return '<span class="trend trend--down" title="Change since previous mock exam">▼ ' + d + '</span>';
    return '<span class="trend trend--flat" title="No change since previous mock exam">– 0</span>';
  }

  /* ── 4. Citations ───────────────────────────────────────────────────── */
  function typeOf(file) { var s = SOURCE[file]; var t = s && s.type ? s.type : String(file).split('.').pop().toLowerCase(); return (t === 'pdf' || t === 'pptx' || t === 'docx') ? t : 'text'; }
  function locWord(type, many) {
    if (type === 'pdf') return many ? 'pp.' : 'p.';
    if (type === 'pptx') return many ? 'slides' : 'slide';
    return many ? 'sections' : 'section';
  }
  function ranges(nums) {
    var out = [], s = null, p = null;
    nums.forEach(function (n) { if (s === null) { s = p = n; } else if (n === p + 1) { p = n; } else { out.push(s === p ? '' + s : s + '–' + p); s = p = n; } });
    if (s !== null) out.push(s === p ? '' + s : s + '–' + p);
    return out.join(', ');
  }
  function citeButton(itemId, label, file) {
    var t = typeOf(file);
    return '<button type="button" class="citation" data-action="cite" data-item="' + esc(itemId) + '">' + icon('file-' + t, 'icon--sm') +
      '<span class="citation__file">' + esc(file) + '</span><span class="citation__loc">' + esc(label) + '</span></button>';
  }
  function itemCitation(id) { var s = reveal(id).source; return citeButton(id, s.loc || (locWord(typeOf(s.file)) + ' ' + s.page), s.file); }
  /* Group many items' sources into "Lecture3.pdf pp. 10–14" buttons. */
  function groupedCitations(ids) {
    var files = {}, orderF = [];
    ids.forEach(function (id) {
      if (!ITEM[id]) return;
      var s = reveal(id).source;
      if (!files[s.file]) { files[s.file] = {}; orderF.push(s.file); }
      if (!files[s.file][s.page]) files[s.file][s.page] = id;
    });
    return orderF.map(function (f) {
      var ps = Object.keys(files[f]).map(Number).sort(function (a, b) { return a - b; });
      var label = locWord(typeOf(f), ps.length > 1) + ' ' + ranges(ps);
      return citeButton(files[f][ps[0]], label, f);
    }).join(' ');
  }

  /* ── 5. UI state & rendering ────────────────────────────────────────── */
  var app = $('#app');
  var ui = { view: 'home', params: {}, back: null, practiceLen: '10', filter: 'all', order: null, shuffleWithin: false, prac: null, after: null };
  var VIEWS = {};
  function render() {
    var fn = VIEWS[ui.view] || VIEWS.home;
    ui.after = null;
    app.innerHTML = fn(ui.params || {});
    if (ui.after) ui.after();
  }
  function go(view, params, keepScroll) {
    ui.view = view; ui.params = params || {};
    render();
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function pageHead(eyebrow, title, desc, actions) {
    return '<div class="section-head"><div class="section-head__text">' + (eyebrow ? '<span class="eyebrow">' + eyebrow + '</span>' : '') +
      '<h1>' + title + '</h1>' + (desc ? '<p class="section-head__desc">' + desc + '</p>' : '') + '</div>' +
      (actions ? '<div class="cluster no-print">' + actions + '</div>' : '') + '</div>';
  }
  function sectionHead(title, desc, actions) {
    return '<div class="section-head"><div class="section-head__text"><h2>' + title + '</h2>' + (desc ? '<p class="section-head__desc">' + desc + '</p>' : '') + '</div>' +
      (actions ? '<div class="cluster no-print">' + actions + '</div>' : '') + '</div>';
  }
  function callout(kind, iconName, title, body, actions) {
    return '<div class="callout' + (kind ? ' callout--' + kind : '') + '"><span class="callout__icon">' + icon(iconName) + '</span><div class="callout__body">' +
      (title ? '<p class="callout__title">' + title + '</p>' : '') + (body ? '<div>' + body + '</div>' : '') +
      (actions ? '<div class="callout__actions">' + actions + '</div>' : '') + '</div></div>';
  }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.setAttribute('data-show', 'true');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.setAttribute('data-show', 'false'); }, 3200);
  }
  var dialog = $('#dialog');
  function openDialog(title, desc, body, foot) {
    dialog.innerHTML = '<div class="dialog__inner"><div class="dialog__head"><h2 id="dialog-title">' + title + '</h2>' + (desc ? '<p class="muted small">' + desc + '</p>' : '') +
      '</div><div class="dialog__body">' + body + '</div><div class="dialog__foot">' + foot + '</div></div>';
    if (dialog.showModal) { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  }
  function closeDialog() { if (dialog.close) { if (dialog.open) dialog.close(); } else dialog.removeAttribute('open'); }

  /* ── 6. Home ────────────────────────────────────────────────────────── */
  VIEWS.home = function () {
    var mm = masteryMap(), run = store.inProgress, attempts = store.attempts;
    var h = '<div class="page stack stack--xl">';
    h += pageHead('', '<span class="visually-hidden">' + esc(M.title) + '</span>',
      'Version ' + esc(M.version) + ' · Last updated ' + esc(fmtDate(M.generated)) + ' · ' + plural(BANK.length, 'item') + ' in the bank · ' + M.exam_length + '-item mock exam');

    if (run) {
      var ans = Object.keys(run.answers).length;
      h += callout('warning', 'history', 'You have a mock exam in progress',
        ans + ' of ' + run.items.length + ' answered · ' + fmtDur(run.elapsed) + ' elapsed. Your answers are saved in this browser.',
        '<button class="btn btn--primary btn--sm" data-action="resume">' + icon('play', 'icon--sm') + 'Resume exam</button><button class="btn btn--sm btn--danger" data-action="discard">' + icon('trash', 'icon--sm') + 'Discard</button>');
    }
    var last = M.changelog && M.changelog.length ? M.changelog[M.changelog.length - 1] : null;
    if (M.version > 1 && last) h += callout('neutral', 'history', 'New in version ' + esc(last.version), esc(last.summary));

    h += '<div class="grid grid--3">';
    h += '<button class="card card--interactive card--accent entry" data-action="' + (run ? 'resume' : 'start-order') + '"><span class="card__title">' + (run ? 'Resume mock exam' : 'Mock exam') + '</span>' +
      '<span class="card__desc">' + M.exam_length + ' items across ' + plural(TOPICS.length, 'topic') + '. Answers are revealed only after you submit. This is what measures mastery.</span></button>';
    h += '<button class="card card--interactive entry" data-action="picker"><span class="card__title">Practice by topic</span>' +
      '<span class="card__desc">One topic at a time with instant feedback, weakest areas first.</span></button>';
    h += '<button class="card card--interactive entry" data-action="sources"><span class="card__title">Browse sources</span>' +
      '<span class="card__desc">' + plural(SOURCES.length, 'file') + ' in <span class="strong">sources/</span>. Every question links to the exact page it came from.</span></button>';
    h += '</div>';

    // Mastery panel
    h += '<div class="grid grid--2">';
    h += '<section class="section">' + sectionHead('Topic mastery', attempts.length ? 'From your latest mock exam. Practice doesn’t change these.' : 'Take a mock exam to see where you stand.') +
      '<div class="card card--flush"><ul class="rows">';
    TOPICS.forEach(function (t) {
      var m = mm[t.id];
      h += '<li class="row"><div class="row__main"><span class="row__title">' + esc(t.name) + (isNewTopic(t, mm) ? ' <span class="badge badge--new">' + 'New</span>' : '') + '</span>' +
        '<span class="row__meta">' + (m.last ? m.last.correct + ' of ' + m.last.total + ' correct (' + m.pct + '%) · ' : '') + plural(m.exams, 'mock exam') + '</span></div>' +
        '<div class="row__aside">' + trendHTML(m.pct, m.prevPct) + bandPill(m.band) + '</div></li>';
    });
    h += '</ul></div></section>';

    // History
    h += '<section class="section">' + sectionHead('Mock exam history', 'Your submitted mock exams, newest first.');
    if (!attempts.length) {
      h += '<div class="empty"><span class="empty__title">No mock exams yet</span><span>Your scores and results will appear here after you submit your first mock exam.</span></div>';
    } else {
      h += '<div class="card card--flush"><ul class="rows">';
      attempts.slice().reverse().forEach(function (a) {
        var n = store.attempts.indexOf(a) + 1, c = a.items.filter(function (r) { return r.result; }).length, p = pct(c, a.items.length);
        h += '<li class="row row--link" data-action="open-attempt" data-id="' + esc(a.id) + '" tabindex="0" role="link"><div class="row__main"><span class="row__title">Attempt ' + n + ' · ' + esc(fmtDate(a.date, true)) + '</span>' +
          '<span class="row__meta">' + c + ' of ' + a.items.length + ' correct · took ' + fmtDur(a.duration) + '</span></div><div class="row__aside"><span class="strong num">' + p + '%</span>' + bandPill(bandOf(p)) + icon('chevron-right', 'icon--sm') + '</div></li>';
      });
      h += '</ul></div>';
    }
    h += '<div class="card card--inset"><p class="small muted">Progress is saved in this browser only. Export it as a backup, or to move to another device.</p><div class="cluster">' +
      '<button class="btn btn--sm" data-action="export">' + icon('download', 'icon--sm') + 'Export progress</button>' +
      '<button class="btn btn--sm" data-action="import">' + icon('upload', 'icon--sm') + 'Import progress</button>' +
      '<input type="file" id="import-file" accept="application/json,.json" hidden></div></div>';
    h += '</section></div></div>';
    return h;
  };

  /* ── 7. Section order ───────────────────────────────────────────────── */
  VIEWS.order = function () {
    var mm = masteryMap(), hasAttempts = store.attempts.length > 0;
    if (!ui.order) ui.order = hasAttempts ? recommendedOrder(mm) : courseOrder();
    var rec = recommendedOrder(mm).join(), cur = ui.order.join();
    var which = cur === rec && hasAttempts ? 'Recommended order (weakest first)' : cur === courseOrder().join() ? 'Course order' : 'Custom order';
    var h = '<div class="page page--read stack stack--lg">';
    h += pageHead('Mock exam · step 1 of 2', 'Choose your section order',
      'Drag the sections, or use the arrows. ' + M.exam_length + ' items' + (M.timer_minutes ? ' · ' + M.timer_minutes + '-minute timer' : ' · untimed') + '. Answers are revealed after you submit.');
    h += hasAttempts ? callout('', 'info', 'Weakest topics first is recommended', 'Based on your latest mock exam, topics are ordered weakest to strongest; topics you haven’t attempted come right after the weak ones.')
      : callout('neutral', 'info', 'Course order', 'After your first mock exam, a recommended order (weakest topics first) will appear here.');
    h += '<div class="cluster cluster--between"><span class="small muted">Using: <span class="strong">' + which + '</span></span><div class="cluster">' +
      '<button class="btn btn--sm" data-action="order-rec"' + (hasAttempts ? '' : ' disabled') + '>' + icon('target', 'icon--sm') + 'Use recommended order</button>' +
      '<button class="btn btn--sm" data-action="order-course">' + icon('list', 'icon--sm') + 'Use course order</button></div></div>';
    h += '<ol class="reorder" aria-label="Exam sections in order">';
    ui.order.forEach(function (tid, i) {
      var t = TOPIC[tid], m = mm[tid];
      h += '<li class="reorder__item" draggable="true" data-topic="' + esc(tid) + '"><span class="reorder__handle" aria-hidden="true">' + icon('grip') + '</span><span class="reorder__index" aria-hidden="true"></span>' +
        '<span class="reorder__name">' + esc(t.name) + '</span><span class="reorder__meta"><span>' + plural(t.exam_quota, 'item') + '</span>' + bandPill(m.band) + '</span>' +
        '<span class="reorder__moves"><button class="btn btn--icon btn--sm" data-action="move" data-topic="' + esc(tid) + '" data-dir="-1" aria-label="Move ' + esc(t.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + icon('chevron-up', 'icon--sm') + '</button>' +
        '<button class="btn btn--icon btn--sm" data-action="move" data-topic="' + esc(tid) + '" data-dir="1" aria-label="Move ' + esc(t.name) + ' down"' + (i === ui.order.length - 1 ? ' disabled' : '') + '>' + icon('chevron-down', 'icon--sm') + '</button></span></li>';
    });
    h += '</ol>';
    h += '<label class="check"><input type="checkbox" data-action="shuffle-within"' + (ui.shuffleWithin ? ' checked' : '') + '>Shuffle questions within each section</label>';
    h += '<div class="cluster cluster--between"><button class="btn btn--ghost" data-action="home">' + icon('arrow-left', 'icon--sm') + 'Back</button>' +
      '<button class="btn btn--primary btn--lg" data-action="start-exam">' + icon('play', 'icon--sm') + 'Start mock exam</button></div></div>';
    return h;
  };
  function buildRun(order, shuffleWithin) {
    var seen = {};
    store.attempts.forEach(function (a) { a.items.forEach(function (r) { seen[r.id] = (seen[r.id] || 0) + 1; }); });
    var sections = order.map(function (tid) {
      var pool = shuffle(BANK.filter(function (it) { return it.topic === tid; }))
        .sort(function (a, b) { return (seen[a.id] || 0) - (seen[b.id] || 0); }); // least-seen first, random within ties
      var chosen = pool.slice(0, TOPIC[tid].exam_quota);
      chosen = shuffleWithin ? shuffle(chosen) : chosen.sort(function (a, b) { return ORDER_IN_BANK[a.id] - ORDER_IN_BANK[b.id]; });
      return { topic: tid, items: chosen.map(function (it) { return it.id; }) };
    });
    var items = [];
    sections.forEach(function (s) { items = items.concat(s.items); });
    return { id: 'a' + Date.now().toString(36), started: new Date().toISOString(), elapsed: 0, order: order.slice(), shuffle: !!shuffleWithin, sections: sections, items: items, answers: {}, flags: {}, conf: {}, cur: 0, mode: 'one' };
  }

  /* ── 8. Exam ────────────────────────────────────────────────────────── */
  function sectionIndexOf(run, i) { var n = 0; for (var s = 0; s < run.sections.length; s++) { n += run.sections[s].items.length; if (i < n) return s; } return run.sections.length - 1; }
  function optionKey(it, i) { return isBinary(it) ? it.options[i].charAt(0) : LETTERS[i]; }
  function optionsHTML(it, cfg) {
    // cfg: {name, action, checked, disabled, states: [..], statuses: [..], skip: bool, skipChecked}
    var multi = isMulti(it), mod = isBinary(it) ? ' options--inline' : multi ? ' options--multi' : '';
    var h = '<ul class="options' + mod + '" role="' + (multi ? 'group' : 'radiogroup') + '" aria-label="Answer choices"' + (cfg.disabled ? ' aria-disabled="true"' : '') + '>';
    it.options.forEach(function (o, i) {
      var st = cfg.states && cfg.states[i] ? ' data-state="' + cfg.states[i] + '"' : '';
      var inp = cfg.action ? '<input type="' + (multi ? 'checkbox' : 'radio') + '" name="' + cfg.name + '" value="' + i + '" data-action="' + cfg.action + '" data-id="' + esc(it.id) + '"' + (picked(cfg.checked, i) ? ' checked' : '') + (cfg.disabled ? ' disabled' : '') + '>' : '';
      var tag = cfg.action ? 'label' : 'div';
      h += '<li><' + tag + ' class="option"' + st + '>' + inp + '<span class="option__key" aria-hidden="true">' + optionKey(it, i) + '</span><span class="option__text">' + esc(o) + '</span>' +
        (cfg.statuses && cfg.statuses[i] ? '<span class="option__status">' + cfg.statuses[i] + '</span>' : '') + '</' + tag + '></li>';
    });
    if (cfg.skip) {
      var sst = cfg.skipChecked ? ' data-state="selected"' : '';
      h += '<li><label class="option option--skip"' + sst + '><input type="radio" name="' + cfg.name + '" value="skip" data-action="' + cfg.action + '" data-id="' + esc(it.id) + '"' + (cfg.skipChecked ? ' checked' : '') + (cfg.disabled ? ' disabled' : '') + '>' +
        '<span class="option__key" aria-hidden="true">?</span><span class="option__text">Not sure / Skip</span></label></li>';
    }
    return h + '</ul>';
  }
  function qMeta(numLabel, it, extra) {
    return '<div class="question__meta"><span class="question__number">' + numLabel + '</span><span class="tag">' + esc(TOPIC[it.topic] ? TOPIC[it.topic].name : it.topic) + '</span>' +
      '<span class="tag">' + (it.type === 'tf' ? 'True / False' : it.type === 'yesno' ? 'Yes / No' : isMulti(it) ? 'Multiple select' : 'Multiple choice') + '</span>' + (extra || '') + '</div>';
  }
  function stemHTML(it) { return '<p class="question__stem">' + esc(it.stem) + '</p>' + (isMulti(it) ? '<p class="small muted">Select all that apply.</p>' : ''); }
  function revealStates(key, ans, n) {
    var states = [], statuses = [];
    for (var i = 0; i < n; i++) {
      if (picked(key, i)) { states[i] = 'correct'; statuses[i] = icon('check', 'icon--sm') + (picked(ans, i) ? 'Your answer' : 'Correct answer'); }
      else if (picked(ans, i)) { states[i] = 'incorrect'; statuses[i] = icon('x', 'icon--sm') + 'Your answer'; }
    }
    return { states: states, statuses: statuses };
  }
  function examQuestionHTML(run, i, seen) {
    var id = run.items[i], it = ITEM[id], flagged = !!run.flags[id], conf = run.conf[id] || '';
    var h = '<article class="question" id="q-' + i + '" data-index="' + i + '"' + (run.mode === 'all' && run.cur === i ? ' data-current="true"' : '') + '>';
    h += qMeta('Question ' + (i + 1) + ' of ' + run.items.length, it, isNewItem(it, seen) ? '<span class="badge badge--new">New</span>' : '');
    h += stemHTML(it);
    h += optionsHTML(it, { name: 'q-' + id, action: 'answer', checked: run.answers[id] });
    h += '<div class="question__tools"><button type="button" class="btn btn--sm" data-action="flag" data-id="' + esc(id) + '" aria-pressed="' + flagged + '">' + icon('flag', 'icon--sm') + (flagged ? 'Flagged' : 'Flag for review') + '</button>' +
      '<div class="cluster"><span class="segmented__caption">Confidence</span><div class="segmented" role="radiogroup" aria-label="Confidence">';
    CONF.forEach(function (c) {
      h += '<span class="segmented__option"><input type="radio" id="c-' + esc(id) + '-' + c[0] + '" name="c-' + esc(id) + '" value="' + c[0] + '" data-action="conf" data-id="' + esc(id) + '"' + (conf === c[0] ? ' checked' : '') + '><label class="segmented__label" for="c-' + esc(id) + '-' + c[0] + '">' + c[1] + '</label></span>';
    });
    h += '</div></div></div></article>';
    return h;
  }
  function qnavHTML(run) {
    var h = '', i = 0;
    run.sections.forEach(function (s, si) {
      var done = s.items.filter(function (id) { return run.answers[id] != null; }).length;
      var open = run.mode === 'all' || sectionIndexOf(run, run.cur) === si || run.sections.length <= 6;
      h += '<details class="qnav__section"' + (open ? ' open' : '') + '><summary class="qnav__summary"><span class="qnav__name">' + (si + 1) + '. ' + esc(TOPIC[s.topic].name) + '</span><span class="qnav__count">' + done + '/' + s.items.length + '</span></summary><div class="chips">';
      s.items.forEach(function (id) {
        var st = run.answers[id] != null ? 'answered' : 'unanswered', fl = !!run.flags[id];
        h += '<button type="button" class="chip" data-action="goto" data-index="' + i + '" data-state="' + st + '"' + (fl ? ' data-flagged="true"' : '') + (run.cur === i ? ' aria-current="true"' : '') +
          ' aria-label="Question ' + (i + 1) + ', ' + (st === 'answered' ? 'answered' : 'not answered') + (fl ? ', flagged' : '') + '">' + (i + 1) + '</button>';
        i++;
      });
      h += '</div></details>';
    });
    return h;
  }
  var LEGEND_EXAM = '<div class="chip-legend" aria-hidden="true"><span class="chip-legend__item"><span class="chip"></span>Unanswered</span><span class="chip-legend__item"><span class="chip" data-state="answered"></span>Answered</span><span class="chip-legend__item"><span class="chip" data-flagged="true"></span>Flagged</span><span class="chip-legend__item"><span class="chip" aria-current="true"></span>Current</span></div>';
  function examStatusHTML(run) {
    var a = Object.keys(run.answers).length, n = run.items.length, p = pct(a, n);
    return '<div class="statusbar__progress"><div class="progress__label"><span>' + a + ' of ' + n + ' answered</span><span class="num">' + p + '%</span></div>' +
      '<div class="progress" role="progressbar" aria-label="Answered" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p + '" style="--pct: ' + p + '"></div></div>';
  }
  function timerText(run) {
    if (M.timer_minutes) { var left = M.timer_minutes * 60000 - run.elapsed; return fmtDur(left) + ' left'; }
    return fmtDur(run.elapsed);
  }
  VIEWS.exam = function () {
    var run = store.inProgress;
    if (!run) return VIEWS.home();
    var seen = attemptedIds();
    var h = '<div class="statusbar"><div class="page"><div class="statusbar__inner">' +
      '<button type="button" class="btn btn--sm drawer-toggle" data-action="drawer" aria-controls="qnav-drawer" aria-expanded="false">' + icon('list', 'icon--sm') + 'Questions</button>' +
      '<div class="grow" id="exam-status">' + examStatusHTML(run) + '</div>' +
      '<span class="timer" id="timer"' + (M.timer_minutes && (M.timer_minutes * 60000 - run.elapsed) < 300000 ? ' data-warn="true"' : '') + '>' + icon('clock', 'icon--sm') + '<span id="timer-text">' + timerText(run) + '</span></span>' +
      '<div class="segmented" role="radiogroup" aria-label="View">' +
      '<span class="segmented__option"><input type="radio" id="mode-one" name="mode" value="one" data-action="mode"' + (run.mode === 'one' ? ' checked' : '') + '><label class="segmented__label" for="mode-one">One at a time</label></span>' +
      '<span class="segmented__option"><input type="radio" id="mode-all" name="mode" value="all" data-action="mode"' + (run.mode === 'all' ? ' checked' : '') + '><label class="segmented__label" for="mode-all">All</label></span></div>' +
      '<button type="button" class="btn btn--primary btn--sm" data-action="submit-open">' + icon('check', 'icon--sm') + 'Submit</button></div></div></div>';

    h += '<div class="page"><div class="split">';
    h += '<aside class="sidebar sidebar--drawer" id="qnav-drawer" data-open="false" aria-label="Question navigator"><div class="sidebar__head"><span class="eyebrow">Sections</span>' +
      '<button type="button" class="btn btn--ghost btn--icon btn--sm sidebar__close" data-action="drawer-close" aria-label="Close navigator">' + icon('x', 'icon--sm') + '</button></div>' +
      '<button type="button" class="btn btn--sm btn--block" data-action="next-unanswered">Jump to next unanswered</button><nav class="qnav" id="qnav">' + qnavHTML(run) + '</nav>' + LEGEND_EXAM + '</aside>' +
      '<div class="drawer-scrim" data-action="drawer-close" hidden></div>';

    h += '<div class="split__main stack">';
    if (run.mode === 'one') {
      var si = sectionIndexOf(run, run.cur);
      h += '<div class="stack stack--xs"><span class="eyebrow">Section ' + (si + 1) + ' of ' + run.sections.length + '</span><h2>' + esc(TOPIC[run.sections[si].topic].name) + '</h2></div>';
      h += examQuestionHTML(run, run.cur, seen);
      h += '<div class="cluster cluster--between"><button type="button" class="btn" data-action="prev"' + (run.cur === 0 ? ' disabled' : '') + '>' + icon('chevron-left', 'icon--sm') + 'Previous</button>' +
        (run.cur === run.items.length - 1 ? '<button type="button" class="btn btn--primary" data-action="submit-open">' + icon('check', 'icon--sm') + 'Review &amp; submit</button>'
          : '<button type="button" class="btn btn--primary" data-action="next">Next' + icon('chevron-right', 'icon--sm') + '</button>') + '</div>';
    } else {
      var i = 0;
      run.sections.forEach(function (s, si2) {
        h += '<div class="stack stack--xs"><span class="eyebrow">Section ' + (si2 + 1) + ' of ' + run.sections.length + '</span><h2>' + esc(TOPIC[s.topic].name) + '</h2></div>';
        s.items.forEach(function () { h += examQuestionHTML(run, i, seen); i++; });
      });
      h += '<div class="cluster cluster--end"><button type="button" class="btn btn--primary btn--lg" data-action="submit-open">' + icon('check', 'icon--sm') + 'Review &amp; submit</button></div>';
    }
    h += '<div class="kbd-hints"><span><span class="kbd">←</span> <span class="kbd">→</span> previous / next</span><span><span class="kbd">1</span>–<span class="kbd">5</span> or <span class="kbd">A</span>–<span class="kbd">E</span> answer</span><span><span class="kbd">T</span> <span class="kbd">F</span> true / false</span><span><span class="kbd">M</span> flag</span></div>';
    h += '</div></div></div>';
    return h;
  };
  function refreshExamChrome() {
    var run = store.inProgress; if (!run || ui.view !== 'exam') return;
    var st = $('#exam-status'); if (st) st.innerHTML = examStatusHTML(run);
    var nav = $('#qnav');
    if (nav) {
      var open = $$('.qnav__section', nav).map(function (d) { return d.open; });
      nav.innerHTML = qnavHTML(run);
      $$('.qnav__section', nav).forEach(function (d, k) { if (open[k] !== undefined) d.open = open[k]; });
    }
    $$('.question').forEach(function (q) { if (+q.getAttribute('data-index') === run.cur && run.mode === 'all') q.setAttribute('data-current', 'true'); else q.removeAttribute('data-current'); });
  }
  function gotoIndex(i) {
    var run = store.inProgress; if (!run) return;
    run.cur = Math.max(0, Math.min(run.items.length - 1, i)); save();
    setDrawer(false);
    if (run.mode === 'one') { render(); var q = $('#q-' + run.cur); if (q && q.getBoundingClientRect().top < 0) q.scrollIntoView({ block: 'start' }); }
    else { refreshExamChrome(); var el = $('#q-' + run.cur); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  function setAnswer(id, v) {
    var run = store.inProgress; if (!run) return;
    if (Array.isArray(v) && !v.length) delete run.answers[id]; else run.answers[id] = v;
    save();
    $$('input[name="q-' + CSS.escape(id) + '"]').forEach(function (inp) { inp.checked = picked(v, +inp.value); });
    refreshExamChrome();
  }
  function toggleFlag(id) {
    var run = store.inProgress; if (!run) return;
    if (run.flags[id]) delete run.flags[id]; else run.flags[id] = true; save();
    var b = $('[data-action="flag"][data-id="' + CSS.escape(id) + '"]');
    if (b) { var f = !!run.flags[id]; b.setAttribute('aria-pressed', f); b.innerHTML = icon('flag', 'icon--sm') + (f ? 'Flagged' : 'Flag for review'); }
    refreshExamChrome();
  }
  function setDrawer(open) {
    var d = $('#qnav-drawer'), s = $('.drawer-scrim'), t = $('.drawer-toggle');
    if (d) d.setAttribute('data-open', open ? 'true' : 'false');
    if (s) s.hidden = !open;
    if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function openSubmit() {
    var run = store.inProgress; if (!run) return;
    var un = [], fl = [];
    run.items.forEach(function (id, i) { if (run.answers[id] == null) un.push(i); if (run.flags[id]) fl.push(i); });
    var chipList = function (list, flag) {
      return '<div class="chips">' + list.map(function (i) { return '<button type="button" class="chip" data-action="dialog-goto" data-index="' + i + '"' + (flag ? ' data-flagged="true"' : '') + ' aria-label="Go to question ' + (i + 1) + '">' + (i + 1) + '</button>'; }).join('') + '</div>';
    };
    var body = '';
    body += un.length ? callout('warning', 'alert', plural(un.length, 'unanswered question'), 'Unanswered questions are marked wrong. Select one to go back to it.') + chipList(un, false)
      : callout('success', 'check', 'All ' + run.items.length + ' questions answered', '');
    if (fl.length) body += '<p class="strong small">' + plural(fl.length, 'flagged question') + '</p>' + chipList(fl, true);
    openDialog('Submit your mock exam?', 'After you submit, your answers are locked and the results are recorded in your mastery.', body,
      '<button type="button" class="btn" data-action="dialog-close">Keep working</button><button type="button" class="btn btn--primary" data-action="submit-confirm">Submit exam</button>');
  }
  function submitExam() {
    var run = store.inProgress; if (!run) return;
    var items = run.items.filter(function (id) { return ITEM[id]; }).map(function (id) {
      var it = ITEM[id], sec = reveal(id), ans = run.answers[id];
      return { id: id, topic: it.topic, concept: it.concept, level: it.level, answer: ans == null ? null : ans, result: sameAnswer(ans, sec.answer), conf: run.conf[id] || null, flag: !!run.flags[id] };
    });
    var attempt = { id: run.id, date: new Date().toISOString(), order: run.order, duration: run.elapsed, version: M.version, items: items };
    store.attempts.push(attempt); store.inProgress = null; save();
    closeDialog(); ui.filter = 'all'; ui.order = null;
    go('results', { id: attempt.id });
  }

  /* ── 9. Results & weakness report ───────────────────────────────────── */
  function analyze(a) {
    var idx = store.attempts.indexOf(a), prev = idx > 0 ? store.attempts[idx - 1] : null;
    var correct = a.items.filter(function (r) { return r.result; }).length, total = a.items.length;
    var topics = a.order.filter(function (tid) { return TOPIC[tid] && topicScore(a, tid); }).map(function (tid) {
      var s = topicScore(a, tid), ps = prev ? topicScore(prev, tid) : null;
      var rs = a.items.filter(function (r) { return r.topic === tid; });
      var concepts = {}, corder = [];
      rs.forEach(function (r) { if (!concepts[r.concept]) { concepts[r.concept] = { id: r.concept, total: 0, missed: 0, ids: [] }; corder.push(r.concept); } concepts[r.concept].total++; if (!r.result) { concepts[r.concept].missed++; concepts[r.concept].ids.push(r.id); } });
      return { tid: tid, correct: s.correct, total: s.total, pct: s.pct, band: bandOf(s.pct), prevPct: ps ? ps.pct : null,
        missedConcepts: corder.map(function (c) { return concepts[c]; }).filter(function (c) { return c.missed; }),
        missedIds: rs.filter(function (r) { return !r.result; }).map(function (r) { return r.id; }) };
    });
    var ranked = topics.slice().sort(function (x, y) { return x.pct - y.pct; });
    var levels = LEVELS.map(function (l) {
      var rs = a.items.filter(function (r) { return (r.level || (ITEM[r.id] || {}).level) === l; });
      return rs.length ? { level: l, correct: rs.filter(function (r) { return r.result; }).length, total: rs.length, items: rs } : null;
    }).filter(Boolean);
    return {
      n: idx + 1, prev: prev, correct: correct, total: total, p: pct(correct, total), topics: topics, ranked: ranked, levels: levels,
      prevP: prev ? pct(prev.items.filter(function (r) { return r.result; }).length, prev.items.length) : null,
      misconceptions: a.items.filter(function (r) { return !r.result && r.answer != null && r.conf === 'sure' && ITEM[r.id]; }),
      lucky: a.items.filter(function (r) { return r.result && r.conf === 'guess' && ITEM[r.id]; }),
      flagged: a.items.filter(function (r) { return r.flag; }).length
    };
  }
  function conceptLabel(cid) {
    for (var i = 0; i < BANK.length; i++) if (BANK[i].concept === cid) return BANK[i].concept_label || cid;
    return cid;
  }
  function studyPlan(A) {
    var plan = [];
    if (A.misconceptions.length) {
      var ids = A.misconceptions.map(function (r) { return r.id; });
      var labels = uniq(A.misconceptions.map(function (r) { return conceptLabel(r.concept); })).slice(0, 3);
      plan.push('<span class="strong">Fix misconceptions first.</span> You were sure but wrong on ' + esc(labels.join('; ')) + '. Re-read ' + groupedCitations(ids));
    }
    A.ranked.filter(function (t) { return t.band === 'weak' || t.band === 'review'; }).forEach(function (t) {
      if (plan.length >= 5) return;
      var labels = t.missedConcepts.slice(0, 3).map(function (c) { return conceptLabel(c.id); });
      plan.push('<span class="strong">Re-study ' + esc(TOPIC[t.tid].name) + ' (' + t.pct + '%).</span> Focus on ' + esc(labels.join('; ')) + '. Read ' + groupedCitations(t.missedIds) +
        ' then <button type="button" class="btn btn--link" data-action="practice-topic" data-topic="' + esc(t.tid) + '">practice this topic</button>.');
    });
    if (A.lucky.length && plan.length < 6) {
      plan.push('<span class="strong">Firm up lucky guesses.</span> You got ' + plural(A.lucky.length, 'item') + ' right while guessing. Review ' + groupedCitations(A.lucky.map(function (r) { return r.id; })));
    }
    if (A.levels.length > 1 && plan.length < 6) {
      var lv = A.levels.slice().sort(function (x, y) { return pct(x.correct, x.total) - pct(y.correct, y.total); })[0];
      if (pct(lv.correct, lv.total) < 70) plan.push('<span class="strong">Train ' + LEVEL_LABEL[lv.level].toLowerCase() + ' questions (' + pct(lv.correct, lv.total) + '%).</span> In your practice sessions, ' + LEVEL_HINT[lv.level] + '.');
    }
    if (plan.length < 3) {
      var low = A.ranked[0];
      if (low) plan.push('<span class="strong">Keep ' + esc(TOPIC[low.tid].name) + ' fresh.</span> It was your lowest section at ' + low.pct + '%. <button type="button" class="btn btn--link" data-action="practice-topic" data-topic="' + esc(low.tid) + '">Practice it</button>.');
      plan.push('<span class="strong">Retake a mock exam in a few days</span> with the recommended order, and check that your weakest sections improve.');
    }
    return plan.slice(0, 6);
  }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }
  function levelRead(levels) {
    if (levels.length < 2) return '';
    var s = levels.slice().sort(function (x, y) { return pct(y.correct, y.total) - pct(x.correct, x.total); });
    var best = s[0], worst = s[s.length - 1], bp = pct(best.correct, best.total), wp = pct(worst.correct, worst.total);
    if (bp - wp < 10) return 'You scored about the same across all question types.';
    return 'Strongest at ' + LEVEL_LABEL[best.level].toLowerCase() + ' (' + bp + '%), weakest at ' + LEVEL_LABEL[worst.level].toLowerCase() + ' (' + wp + '%). To improve, ' + LEVEL_HINT[worst.level] + '.';
  }
  function meterRow(label, value, p, band, extra) {
    return '<li class="meter" data-band="' + band + '"><span class="meter__label">' + label + '</span><span class="meter__track" role="img" aria-label="' + esc(p) + '%"><span class="meter__fill" style="--pct: ' + p + '"></span></span>' +
      '<span class="meter__value">' + value + '</span><span class="meter__band">' + (extra || '') + '</span></li>';
  }
  function reviewItemHTML(r, n) {
    var it = ITEM[r.id]; if (!it) return '';
    var sec = reveal(r.id), rs = revealStates(sec.answer, r.answer, it.options.length);
    var extra = (r.result ? '<span class="badge badge--correct">' + icon('check', 'icon--sm') + 'Correct</span>' : r.answer == null ? '<span class="badge badge--incorrect">' + icon('x', 'icon--sm') + 'Unanswered</span>' : '<span class="badge badge--incorrect">' + icon('x', 'icon--sm') + 'Incorrect</span>') +
      (r.flag ? '<span class="badge badge--flag">' + icon('flag', 'icon--sm') + 'Flagged</span>' : '') +
      (r.conf ? '<span class="badge badge--outline">' + (r.conf === 'sure' ? 'Sure' : 'Guessing') + '</span>' : '');
    var fb = r.result ? 'correct' : 'incorrect';
    return '<article class="question" id="review-' + esc(r.id) + '">' + qMeta('Question ' + n, it, extra) + stemHTML(it) +
      optionsHTML(it, { disabled: true, states: rs.states, statuses: rs.statuses }) +
      '<div class="feedback feedback--' + fb + '"><p class="feedback__body">' + esc(sec.explanation) + '</p><blockquote class="excerpt">' + esc(sec.source.excerpt) + '</blockquote><div>' + itemCitation(r.id) + '</div></div></article>';
  }
  VIEWS.results = function (p) {
    var a = store.attempts.filter(function (x) { return x.id === p.id; })[0];
    if (!a) return '<div class="page">' + callout('danger', 'alert', 'Attempt not found', 'It may have been removed when browser data was cleared.', '<button class="btn btn--sm" data-action="home">Home</button>') + '</div>';
    var A = analyze(a), band = bandOf(A.p);
    var h = '<div class="page stack stack--xl">';
    h += pageHead('Mock exam results · attempt ' + A.n, esc(fmtDate(a.date, true)), 'Mastery below is updated from this attempt.',
      '<button class="btn btn--sm" data-action="print">' + icon('print', 'icon--sm') + 'Print / Save PDF</button><button class="btn btn--sm btn--primary" data-action="retake">' + icon('target', 'icon--sm') + 'Retake with recommended order</button>');

    h += '<div class="score-hero"><div class="stack stack--sm"><span class="score-hero__value">' + A.p + '%</span>' + bandPill(band) + '</div><div class="stack">' +
      '<p class="score-hero__caption">' + A.correct + ' of ' + A.total + ' correct' + (A.prevP != null ? ' · ' + trendHTML(A.p, A.prevP) + ' vs previous mock exam (' + A.prevP + '%)' : ' · your first mock exam') + '</p>' +
      '<p class="small">' + (A.misconceptions.length ? '<span class="strong text-incorrect">' + plural(A.misconceptions.length, 'misconception') + '</span> (wrong while sure)' : 'No misconceptions') +
      ' · ' + plural(A.lucky.length, 'lucky guess', 'lucky guesses') + ' · ' + A.flagged + ' flagged · took ' + fmtDur(a.duration) + (M.timer_minutes ? ' of ' + M.timer_minutes + ' min' : '') + '</p>' +
      '</div></div>';

    // Section breakdown
    h += '<section class="section">' + sectionHead('Section breakdown', 'In the order you took them.') + '<div class="card"><ul class="meter-list">';
    A.topics.forEach(function (t) { h += meterRow(esc(TOPIC[t.tid].name), t.correct + '/' + t.total, t.pct, t.band, bandPill(t.band) + ' ' + trendHTML(t.pct, t.prevPct)); });
    h += '</ul></div></section>';

    // Weakness report
    h += '<section class="section">' + sectionHead('Weakness report', 'Weakest topics first, with the concepts you missed and where to study them.');

    var focus = A.ranked.filter(function (t) { return t.band === 'weak' || t.band === 'review'; });
    if (focus.length) {
      h += '<div class="grid grid--2">';
      focus.forEach(function (t) {
        h += '<div class="card"><div class="card__head"><div class="grow stack stack--xs"><span class="card__title">' + esc(TOPIC[t.tid].name) + '</span><span class="small muted">' + t.correct + ' of ' + t.total + ' correct</span></div>' + bandPill(t.band) + '</div>' +
          '<p class="eyebrow">Missed concepts</p><ul class="concept-list">' + t.missedConcepts.map(function (c) { return '<li class="concept"><span class="concept__label">' + esc(conceptLabel(c.id)) + '</span><span class="small muted nowrap">missed ' + c.missed + ' of ' + c.total + '</span></li>'; }).join('') + '</ul>' +
          '<p class="eyebrow">Where to study</p><div class="cluster">' + groupedCitations(t.missedIds) + '</div>' +
          '<div class="card__foot no-print"><button class="btn btn--sm btn--primary" data-action="practice-topic" data-topic="' + esc(t.tid) + '">' + icon('layers', 'icon--sm') + 'Practice this topic</button></div></div>';
      });
      h += '</div>';
    } else {
      h += callout('success', 'check', 'No weak topics this time', 'Every section scored 70% or higher. Use the study plan below to keep it that way.');
    }
    var mcList = function (list) {
      return '<ul class="concept-list">' + list.map(function (r) { var n = a.items.indexOf(r) + 1; return '<li class="concept"><span class="concept__label"><a href="#review-' + esc(r.id) + '" data-action="to-review" data-id="' + esc(r.id) + '">Q' + n + '</a> · ' + esc(conceptLabel(r.concept)) + '</span>' + itemCitation(r.id) + '</li>'; }).join('') + '</ul>';
    };
    h += '<div class="grid grid--2">';
    h += A.misconceptions.length ? callout('danger', 'alert', 'Misconceptions: ' + A.misconceptions.length + ' (top priority)', '<p class="small">You marked these Sure and got them wrong. They are the likeliest to cost you marks on the real exam.</p>' + mcList(A.misconceptions))
      : callout('success', 'check', 'No misconceptions', 'Every answer you marked Sure was correct.');
    h += A.lucky.length ? callout('warning', 'help', 'Lucky guesses: ' + A.lucky.length, '<p class="small">Right, but you were guessing, so you don’t know these yet.</p>' + mcList(A.lucky))
      : callout('neutral', 'info', 'No lucky guesses', 'None of your correct answers were marked Guessing.');
    h += '</div>';

    if (A.levels.length) {
      h += '<div class="card"><div class="stack stack--xs"><h3>Score by question type</h3><p class="small muted">' + esc(levelRead(A.levels)) + '</p></div><ul class="meter-list">';
      // Each level expands to the questions tagged with it; levels are shown nowhere else in the exam.
      A.levels.forEach(function (l) {
        var lp = pct(l.correct, l.total);
        h += '<li><details class="level"><summary class="meter" data-band="accent"><span class="meter__label"><span class="level__caret" aria-hidden="true">▸</span>' + LEVEL_LABEL[l.level] + '</span>' +
          '<span class="meter__track" role="img" aria-label="' + lp + '%"><span class="meter__fill" style="--pct: ' + lp + '"></span></span><span class="meter__value">' + l.correct + '/' + l.total + '</span><span class="meter__band"><span class="small muted num">' + lp + '%</span></span></summary>' +
          '<ul class="concept-list level__items">' + l.items.map(function (r) {
            var n = a.items.indexOf(r) + 1;
            return '<li class="concept"><span class="concept__label"><a href="#review-' + esc(r.id) + '" data-action="to-review" data-id="' + esc(r.id) + '">Q' + n + '</a> · ' + esc(conceptLabel(r.concept)) + '</span>' +
              (r.result ? '<span class="badge badge--correct">' + icon('check', 'icon--sm') + 'Correct</span>' : '<span class="badge badge--incorrect">' + icon('x', 'icon--sm') + (r.answer == null ? 'Unanswered' : 'Incorrect') + '</span>') + '</li>';
          }).join('') + '</ul></details></li>';
      });
      h += '</ul></div>';
    }
    h += '<div class="card"><h3>Study plan</h3><ol class="plan">' + studyPlan(A).map(function (s) { return '<li class="plan__item"><div class="plan__body"><p>' + s + '</p></div></li>'; }).join('') + '</ol></div>';
    h += '</section>';

    // Answer review
    var counts = {
      all: a.items.length,
      incorrect: a.items.filter(function (r) { return !r.result; }).length,
      flagged: A.flagged,
      low: a.items.filter(lowConf).length
    };
    var names = [['all', 'All'], ['incorrect', 'Incorrect'], ['flagged', 'Flagged'], ['low', 'Guessed']];
    h += '<section class="section" id="answer-review">' + sectionHead('Answer review', 'Every question with the correct answer, an explanation and its source.') +
      '<div class="filters no-print" role="group" aria-label="Filter answers">' + names.map(function (n) { return '<button type="button" class="filter" data-action="filter" data-filter="' + n[0] + '" aria-pressed="' + (ui.filter === n[0]) + '">' + n[1] + ' <span class="filter__count">' + counts[n[0]] + '</span></button>'; }).join('') + '</div><div class="stack">';
    var shown = 0;
    a.items.forEach(function (r, i) {
      var ok = ui.filter === 'all' || (ui.filter === 'incorrect' && !r.result) || (ui.filter === 'flagged' && r.flag) || (ui.filter === 'low' && lowConf(r));
      if (ok) { h += reviewItemHTML(r, i + 1); shown++; }
    });
    if (!shown) h += '<div class="empty"><span class="empty__title">No ' + (ui.filter === 'low' ? 'guessed' : ui.filter) + ' questions in this attempt</span><button type="button" class="btn btn--sm" data-action="filter" data-filter="all">Show all ' + counts.all + '</button></div>';
    h += '</div></section>';
    h += '<div class="cluster cluster--between no-print"><button class="btn btn--ghost" data-action="home">' + icon('arrow-left', 'icon--sm') + 'Home</button><button class="btn btn--primary" data-action="retake">' + icon('target', 'icon--sm') + 'Retake with recommended order</button></div>';
    h += '</div>';
    return h;
  };

  /* ── 10. Practice ───────────────────────────────────────────────────── */
  function latestFlags() {
    // Concepts flagged in the latest mock exam: missed, misconceptions, lucky guesses.
    var a = store.attempts[store.attempts.length - 1], out = {};
    if (!a) return out;
    a.items.forEach(function (r) { if (!r.result || r.conf === 'guess') out[r.concept] = true; });
    return out;
  }
  VIEWS.picker = function () {
    var mm = masteryMap(), seen = attemptedIds(), last = store.attempts[store.attempts.length - 1];
    var h = '<div class="page stack stack--xl">';
    h += pageHead('', 'Practice by topic', 'Instant feedback after every question. Practice results never change your mastery; only mock exams do.');
    h += '<div class="cluster"><span class="small strong">Questions per session</span><div class="segmented" role="radiogroup" aria-label="Session length">' +
      [['10', '10'], ['20', '20'], ['all', 'All']].map(function (o) { return '<span class="segmented__option"><input type="radio" id="len-' + o[0] + '" name="plen" value="' + o[0] + '" data-action="plen"' + (ui.practiceLen === o[0] ? ' checked' : '') + '><label class="segmented__label" for="len-' + o[0] + '">' + o[1] + '</label></span>'; }).join('') + '</div></div>';

    var focus = TOPICS.filter(function (t) { return mm[t.id].band === 'weak' || mm[t.id].band === 'review'; })
      .sort(function (x, y) { return (mm[x.id].pct || 0) - (mm[y.id].pct || 0); });
    h += '<section class="section">' + sectionHead('Focus areas', last ? 'From your latest mock exam (' + fmtDate(last.date) + ').' : '');
    if (!last) h += callout('neutral', 'info', 'Focus areas appear after your first mock exam', 'Until then, topics are listed in course order below.');
    else if (!focus.length) h += callout('success', 'check', 'No weak topics in your latest mock exam', 'Pick any topic below to keep it fresh.');
    else { h += '<div class="grid grid--3">'; focus.forEach(function (t) { h += topicCard(t, mm, seen, last); }); h += '</div>'; }
    h += '</section>';
    h += '<section class="section">' + sectionHead('All topics', 'In course order.') + '<div class="grid grid--3">';
    TOPICS.forEach(function (t) { h += topicCard(t, mm, seen, last); });
    h += '</div></section></div>';
    return h;
  };
  function topicCard(t, mm, seen, last) {
    var m = mm[t.id], items = BANK.filter(function (it) { return it.topic === t.id; });
    var reason = '';
    if (last) { var s = topicScore(last, t.id); if (s) reason = (s.total - s.correct) + ' of ' + s.total + ' missed in your last mock exam'; }
    var subs = (t.subtopics || []).filter(function (sub) { return items.some(function (it) { return it.subtopic === sub; }); });
    var newCount = items.filter(function (it) { return isNewItem(it, seen); }).length;
    return '<div class="card"><div class="card__head"><div class="grow stack stack--xs"><span class="card__title">' + esc(t.name) + '</span>' +
      '<span class="small muted">' + plural(items.length, 'question') + (store.practiceCounts[t.id] ? ' · practiced ' + plural(store.practiceCounts[t.id], 'time') : '') + '</span></div>' + bandPill(m.band) + '</div>' +
      (reason ? '<p class="small">' + reason + '</p>' : '') +
      (isNewTopic(t, mm) ? '<span><span class="badge badge--new">' + 'New topic</span></span>' : newCount ? '<span><span class="badge badge--new">' + newCount + ' new</span></span>' : '') +
      (subs.length > 1 ? '<div class="filters" role="group" aria-label="Subtopics">' + subs.map(function (sub) { return '<button type="button" class="filter" data-action="practice-sub" data-topic="' + esc(t.id) + '" data-sub="' + esc(sub) + '">' + esc(sub) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="card__foot"><button type="button" class="btn btn--primary btn--sm" data-action="practice-topic" data-topic="' + esc(t.id) + '">' + icon('play', 'icon--sm') + 'Practice topic</button></div></div>';
  }
  function startPractice(tid, sub, onlyIds) {
    var flagged = latestFlags(), seen = attemptedIds();
    var items = onlyIds ? onlyIds.map(function (id) { return ITEM[id]; }).filter(Boolean)
      : BANK.filter(function (it) { return it.topic === tid && (!sub || it.subtopic === sub); });
    var focus = shuffle(items.filter(function (it) { return flagged[it.concept]; }));
    var fset = {}; focus.forEach(function (it) { fset[it.id] = 1; });
    var unseen = shuffle(items.filter(function (it) { return !fset[it.id] && !seen[it.id]; }));
    var useen = {}; unseen.forEach(function (it) { useen[it.id] = 1; });
    var rest = shuffle(items.filter(function (it) { return !fset[it.id] && !useen[it.id]; }));
    var q = onlyIds ? shuffle(items) : focus.concat(unseen, rest);
    var n = ui.practiceLen === 'all' || onlyIds ? q.length : Math.min(q.length, Number(ui.practiceLen));
    ui.prac = { tid: tid, sub: sub || null, queue: q.slice(0, n).map(function (it) { return { id: it.id, focus: !!fset[it.id], retry: false, state: null, answer: null }; }), idx: 0, requeued: false, counted: false };
    go('practice');
  }
  function practiceTitle(P) { return esc(TOPIC[P.tid] ? TOPIC[P.tid].name : 'Practice') + (P.sub ? ' · ' + esc(P.sub) : ''); }
  VIEWS.practice = function () {
    var P = ui.prac; if (!P) return VIEWS.picker();
    var e = P.queue[P.idx], it = ITEM[e.id], done = P.queue.filter(function (x) { return x.state; }).length, p = pct(done, P.queue.length);
    // Focus layout: centered question column; the session panel docks to its left (drawer on small screens).
    // The status bar uses the same grid so it is exactly as wide as the question card.
    var h = '<div class="statusbar"><div class="page page--full"><div class="focus"><div class="focus__main statusbar__inner">' +
      '<button type="button" class="btn btn--sm drawer-toggle" data-action="drawer" aria-controls="qnav-drawer" aria-expanded="false">' + icon('list', 'icon--sm') + 'Questions</button>' +
      '<div class="grow statusbar__progress"><div class="progress__label"><span>Practice · ' + practiceTitle(P) + '</span><span class="num">' + done + '/' + P.queue.length + '</span></div><div class="progress" role="progressbar" aria-label="Practice progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p + '" style="--pct: ' + p + '"></div></div>' +
      '<button type="button" class="btn btn--sm" data-action="practice-end">End session</button></div></div></div></div>';
    h += '<div class="page page--full"><div class="focus">';
    h += '<aside class="sidebar sidebar--drawer focus__side" id="qnav-drawer" data-open="false" aria-label="Session questions"><div class="sidebar__head"><span class="eyebrow">This session</span>' +
      '<button type="button" class="btn btn--ghost btn--icon btn--sm sidebar__close" data-action="drawer-close" aria-label="Close">' + icon('x', 'icon--sm') + '</button></div>' +
      '<div class="qnav__section"><div class="chips">' + P.queue.map(function (x, i) {
        var st = x.state || 'unanswered';
        return '<button type="button" class="chip" data-action="pgoto" data-index="' + i + '" data-state="' + st + '"' + (x.focus ? ' data-focus="true"' : '') + (i === P.idx ? ' aria-current="true"' : '') + ' aria-label="Question ' + (i + 1) + ', ' + st + (x.focus ? ', focus' : '') + (x.retry ? ', retry' : '') + '">' + (i + 1) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="chip-legend" aria-hidden="true"><span class="chip-legend__item"><span class="chip" data-state="correct"></span>Correct</span><span class="chip-legend__item"><span class="chip" data-state="incorrect"></span>Incorrect</span><span class="chip-legend__item"><span class="chip" data-state="skipped"></span>Skipped</span><span class="chip-legend__item"><span class="chip" data-focus="true"></span>Focus</span></div></aside>' +
      '<div class="drawer-scrim" data-action="drawer-close" hidden></div>';

    h += '<div class="focus__main stack">';
    var extra = (e.focus ? '<span class="badge badge--focus">' + icon('target', 'icon--sm') + 'Focus</span>' : '') + (e.retry ? '<span class="badge badge--flag">Second try</span>' : '');
    h += '<article class="question" id="q-p">' + qMeta('Question ' + (P.idx + 1) + ' of ' + P.queue.length, it, extra) + stemHTML(it);
    if (!e.state) {
      h += optionsHTML(it, { name: 'p-' + P.idx, action: 'panswer', skip: true, checked: e.pick });
      // Multi-select can't answer on one click: the student ticks options, then checks.
      if (isMulti(it)) h += '<div class="question__tools"><span class="push"></span><button type="button" class="btn btn--primary" data-action="pcheck"' + (e.pick && e.pick.length ? '' : ' disabled') + '>' + icon('check', 'icon--sm') + 'Check answer</button></div>';
    } else {
      var sec = reveal(e.id), rs = revealStates(sec.answer, e.answer, it.options.length);
      h += optionsHTML(it, { disabled: true, states: rs.states, statuses: rs.statuses });
      var v = e.state === 'correct' ? ['correct', 'check', 'Correct'] : e.state === 'incorrect' ? ['incorrect', 'x', 'Not quite'] : ['skipped', 'help', 'Skipped — here’s the answer'];
      h += '<div class="feedback feedback--' + v[0] + '" role="status"><p class="feedback__verdict">' + icon(v[1]) + v[2] + '</p><p class="feedback__body">' + esc(sec.explanation) + '</p>' +
        '<blockquote class="excerpt">' + esc(sec.source.excerpt) + '</blockquote><div>' + itemCitation(e.id) + '</div></div>';
      h += '<div class="question__tools"><span class="small muted">' + (e.state !== 'correct' && !e.retry && !P.requeued ? 'You’ll see this one again at the end.' : '') + '</span><span class="push"></span>' +
        '<button type="button" class="btn btn--primary" data-action="pnext">' + (P.idx === P.queue.length - 1 && P.requeued ? 'Finish session' : 'Next') + icon('chevron-right', 'icon--sm') + '</button></div>';
    }
    h += '</article>';
    h += '<div class="kbd-hints"><span><span class="kbd">1</span>–<span class="kbd">5</span> or <span class="kbd">A</span>–<span class="kbd">E</span> answer</span><span><span class="kbd">T</span> <span class="kbd">F</span> true / false</span><span><span class="kbd">S</span> not sure / skip</span><span><span class="kbd">Enter</span> ' + (isMulti(it) && !e.state ? 'check answer' : 'next') + '</span></div>';
    h += '</div></div></div>';
    ui.after = function () { var el = $('#q-p'); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' }); };
    return h;
  };
  function practiceAnswer(v) {
    var P = ui.prac; if (!P) return;
    var e = P.queue[P.idx]; if (e.state) return;
    var sec = reveal(e.id);
    if (v === 'skip') { e.state = 'skipped'; e.answer = null; }
    else { e.answer = Array.isArray(v) ? v : Number(v); e.state = sameAnswer(e.answer, sec.answer) ? 'correct' : 'incorrect'; }
    render();
  }
  function practicePick(i) {
    var P = ui.prac; if (!P) return;
    var e = P.queue[P.idx]; if (e.state) return;
    e.pick = toggled(e.pick, i);
    $$('input[name="p-' + P.idx + '"]').forEach(function (inp) { if (inp.value !== 'skip') inp.checked = picked(e.pick, +inp.value); });
    var b = $('[data-action="pcheck"]'); if (b) b.disabled = !e.pick.length;
  }
  function practiceCheck() { var P = ui.prac; if (!P) return; var e = P.queue[P.idx]; if (e.pick && e.pick.length) practiceAnswer(e.pick); }
  function practiceNext() {
    var P = ui.prac; if (!P) return;
    var firstUnanswered = P.queue.findIndex(function (x) { return !x.state; });
    if (P.idx < P.queue.length - 1) { P.idx++; render(); return; }
    if (firstUnanswered >= 0) { P.idx = firstUnanswered; render(); return; }
    if (!P.requeued) {
      P.requeued = true;
      var again = P.queue.filter(function (x) { return !x.retry && x.state !== 'correct'; });
      if (again.length) {
        again.forEach(function (x) { P.queue.push({ id: x.id, focus: x.focus, retry: true, state: null, answer: null }); });
        P.idx++; render(); toast('Second try: ' + plural(again.length, 'question') + ' you missed or skipped.'); return;
      }
    }
    go('summary');
  }
  VIEWS.summary = function () {
    var P = ui.prac; if (!P) return VIEWS.picker();
    if (!P.counted && P.tid) { P.counted = true; store.practiceCounts[P.tid] = (store.practiceCounts[P.tid] || 0) + 1; save(); }
    var first = P.queue.filter(function (x) { return !x.retry && x.state; });
    var right = first.filter(function (x) { return x.state === 'correct'; }).length;
    var retries = P.queue.filter(function (x) { return x.retry && x.state; });
    var fixed = retries.filter(function (x) { return x.state === 'correct'; }).length;
    var missed = first.filter(function (x) { return x.state !== 'correct'; });
    var p = pct(right, first.length);
    var h = '<div class="page page--read stack stack--lg">';
    h += pageHead('Practice · ' + practiceTitle(P), 'Session summary', '');
    h += callout('neutral', 'info', 'Practice results — doesn’t affect mastery.', 'Take a mock exam to update your mastery.');
    h += '<div class="stat-grid"><div class="stat"><span class="stat__label">First try</span><span class="stat__value">' + p + '<span class="stat__unit">%</span></span><span class="stat__foot">' + right + ' of ' + first.length + ' correct</span></div>' +
      '<div class="stat"><span class="stat__label">Second try</span><span class="stat__value">' + fixed + '<span class="stat__unit">/' + retries.length + '</span></span><span class="stat__foot">fixed on retry</span></div></div>';
    if (missed.length) {
      var byC = {}, order = [];
      missed.forEach(function (x) { var c = ITEM[x.id].concept; if (!byC[c]) { byC[c] = []; order.push(c); } byC[c].push(x); });
      h += '<div class="card"><h3>Missed or skipped</h3><ul class="concept-list">' + order.map(function (c) {
        return '<li class="concept"><span class="concept__label">' + esc(conceptLabel(c)) + ' <span class="small muted">(' + byC[c].map(function (x) { return x.state === 'skipped' ? 'skipped' : 'missed'; }).join(', ') + ')</span></span>' + itemCitation(byC[c][0].id) + '</li>';
      }).join('') + '</ul></div>';
    } else {
      h += callout('success', 'check', 'Everything correct on the first try', 'Nice work. Try a longer session or another topic.');
    }
    h += '<div class="cluster">' + (missed.length ? '<button class="btn btn--primary" data-action="practice-missed">' + icon('history', 'icon--sm') + 'Practice missed items again</button>' : '') +
      '<button class="btn" data-action="picker">' + icon('layers', 'icon--sm') + 'Back to topics</button><button class="btn" data-action="start-order">' + icon('target', 'icon--sm') + 'Take mock exam</button></div></div>';
    return h;
  };

  /* ── 11. Sources ────────────────────────────────────────────────────── */
  function sourceHref(file, page, excerpt) {
    var t = typeOf(file), href = 'sources/' + encodeURIComponent(file);
    if (t === 'pdf' && page) href += '#page=' + page + (excerpt ? '&search=' + encodeURIComponent(String(excerpt).split(/\s+/).slice(0, 6).join(' ')) : '');
    return href;
  }
  function openLabel(file, page) {
    var t = typeOf(file);
    if (t === 'pptx') return 'Opens in PowerPoint — go to slide ' + page;
    if (t === 'docx') return 'Opens in Word — go to section ' + page;
    return 'Open original file';
  }
  function highlight(text, ex) {
    if (!ex) return esc(text);
    var i = text.indexOf(ex), len = ex.length;
    if (i < 0) {
      // tolerate whitespace differences
      var re = new RegExp(ex.trim().split(/\s+/).map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('\\s+'));
      var m = re.exec(text); if (m) { i = m.index; len = m[0].length; }
    }
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark id="cited">' + esc(text.slice(i, i + len)) + '</mark>' + esc(text.slice(i + len));
  }
  VIEWS.sources = function (p) {
    var locked = !!store.inProgress;
    var file = p.file && SOURCE[p.file] ? p.file : (SOURCES[0] && SOURCES[0].file);
    var src = SOURCE[file] || {};
    var avail = locked ? [] : Object.keys((pages()[file]) || {}).map(Number).sort(function (a, b) { return a - b; });
    var page = p.page != null ? Number(p.page) : (src.cited_pages && src.cited_pages[0]) || avail[0];
    var h = '<div class="page stack stack--lg">';
    h += pageHead('', 'Browse sources', 'Every question comes from these files in <span class="strong">sources/</span>.',
      ui.back ? '<button class="btn btn--primary btn--sm" data-action="back">' + icon('arrow-left', 'icon--sm') + ui.back.label + '</button>' : '<button class="btn btn--sm btn--ghost" data-action="home">' + icon('arrow-left', 'icon--sm') + 'Home</button>');
    h += '<div class="split split--wide-side"><aside class="sidebar" aria-label="Files in sources"><span class="eyebrow">' + icon('folder', 'icon--sm') + ' sources/</span><ul class="file-list">';
    SOURCES.forEach(function (s) {
      var t = typeOf(s.file), cur = s.file === file;
      h += '<li><button type="button" class="file" data-action="src-file" data-file="' + esc(s.file) + '"' + (cur ? ' aria-current="true"' : '') + '><span class="file__icon" data-type="' + t + '">' + icon('file-' + t) + '</span>' +
        '<span class="file__name">' + esc(s.file) + '</span><span class="file__count" title="Questions citing this file">' + (s.citations || 0) + ' Q</span></button>';
      if (cur && !locked && s.cited_pages && s.cited_pages.length) {
        h += '<ul class="file-pages" aria-label="Cited pages">' + s.cited_pages.map(function (pg) { return '<li><button type="button" class="filter" data-action="src-page" data-file="' + esc(s.file) + '" data-page="' + pg + '" aria-pressed="' + (pg === page) + '">' + locWord(t) + ' ' + pg + '</button></li>'; }).join('') + '</ul>';
      }
      h += '</li>';
    });
    h += '</ul></aside><div class="split__main viewer" id="viewer">';
    var feeds = (src.topics || []).map(function (tid) { return TOPIC[tid] ? TOPIC[tid].name : tid; });
    h += '<div class="viewer__head"><span class="file__icon" data-type="' + typeOf(file) + '">' + icon('file-' + typeOf(file), 'icon--lg') + '</span><div class="grow stack stack--xs"><h2 class="truncate">' + esc(file) + '</h2>' +
      '<span class="small muted">' + (feeds.length ? 'Feeds: ' + esc(feeds.join(', ')) : '') + (src.pages ? ' · ' + src.pages + ' ' + (typeOf(file) === 'pptx' ? 'slides' : typeOf(file) === 'pdf' ? 'pages' : 'sections') : '') + '</span></div>' +
      '<a class="btn btn--sm" href="' + esc(sourceHref(file, page, p.excerpt)) + '" target="_blank" rel="noopener">' + icon('external', 'icon--sm') + esc(openLabel(file, page)) + '</a></div>';
    if (locked) {
      h += callout('warning', 'alert', 'Page text is hidden during a mock exam', 'Submit or discard your in-progress mock exam to read the sources. You can still see which files feed which topics.');
    } else if (page == null || !pages()[file] || pages()[file][page] == null) {
      h += '<div class="empty"><span class="empty__title">This page isn’t embedded</span><span>Only cited pages (and one page either side) are stored in the exam file. Open the original file to read it.</span></div>';
    } else {
      var ai = avail.indexOf(page);
      h += '<p class="eyebrow">' + locWord(typeOf(file)) + ' ' + page + (p.excerpt ? ' · cited passage highlighted' : '') + '</p>';
      h += '<div class="viewer__page" tabindex="0">' + highlight(pages()[file][page], p.excerpt) + '</div>';
      h += '<div class="viewer__pager"><button class="btn btn--sm" data-action="src-page" data-file="' + esc(file) + '" data-page="' + (avail[ai - 1] || '') + '"' + (ai <= 0 ? ' disabled' : '') + '>' + icon('chevron-left', 'icon--sm') + 'Previous</button>' +
        '<span class="small muted num">' + (ai + 1) + ' of ' + avail.length + ' embedded</span>' +
        '<button class="btn btn--sm" data-action="src-page" data-file="' + esc(file) + '" data-page="' + (avail[ai + 1] || '') + '"' + (ai >= avail.length - 1 ? ' disabled' : '') + '>Next' + icon('chevron-right', 'icon--sm') + '</button></div>';
    }
    h += '</div></div></div>';
    ui.after = function () { var mk = $('#cited'); if (mk) mk.scrollIntoView({ block: 'center' }); };
    return h;
  };
  function openCitation(itemId) {
    var s = reveal(itemId).source;
    ui.back = { view: ui.view, params: ui.params, y: window.scrollY, label: ui.view === 'results' ? 'Back to results' : 'Back to question' };
    ui.view = 'sources'; ui.params = { file: s.file, page: s.page, excerpt: s.excerpt };
    render();
    if (!$('#cited')) window.scrollTo(0, 0);
  }

  /* ── 12. Import / export ────────────────────────────────────────────── */
  function exportProgress() {
    var data = { kind: 'mock-exam-progress', exam_id: M.exam_id, class_code: M.class_code, term: M.term, exported: new Date().toISOString(), attempts: store.attempts, practiceCounts: store.practiceCounts };
    try {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = doc.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = M.class_code + '-' + M.term + '-progress.json'; doc.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('Progress exported.');
    } catch (e) { toast('Export isn’t available here.'); }
  }
  function importProgress(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (d.exam_id !== M.exam_id) { toast('That progress file belongs to a different exam.'); return; }
        var have = {}; store.attempts.forEach(function (a) { have[a.id] = 1; });
        var added = 0;
        (d.attempts || []).forEach(function (a) { if (!have[a.id]) { store.attempts.push(a); added++; } });
        store.attempts.sort(function (x, y) { return String(x.date).localeCompare(String(y.date)); });
        Object.keys(d.practiceCounts || {}).forEach(function (k) { store.practiceCounts[k] = Math.max(store.practiceCounts[k] || 0, d.practiceCounts[k]); });
        save(); render(); toast('Imported ' + plural(added, 'mock exam attempt') + '.');
      } catch (e) { toast('Couldn’t read that file.'); }
    };
    r.readAsText(file);
  }

  /* ── 13. Events ─────────────────────────────────────────────────────── */
  function applyTheme(t) { if (t) doc.documentElement.setAttribute('data-theme', t); else doc.documentElement.removeAttribute('data-theme'); updateThemeIcon(); }
  function effectiveTheme() { var t = doc.documentElement.getAttribute('data-theme'); return t || 'light'; }
  function updateThemeIcon() { var b = $('[data-action="theme"]'); if (b) b.innerHTML = icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'); }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (e) { updateThemeIcon(); }

  var ACTIONS = {
    home: function () { ui.back = null; go('home'); },
    theme: function () { var n = effectiveTheme() === 'dark' ? 'light' : 'dark'; applyTheme(n); try { localStorage.setItem(THEME_KEY, n); } catch (e) { /* ignore */ } },
    'start-order': function () { if (store.inProgress) { go('exam'); return; } ui.order = null; go('order'); },
    resume: function () { go('exam'); },
    discard: function () {
      openDialog('Discard the exam in progress?', 'Your answers so far will be deleted. This doesn’t change your mastery.', '',
        '<button type="button" class="btn" data-action="dialog-close">Cancel</button><button type="button" class="btn btn--danger" data-action="discard-confirm">' + icon('trash', 'icon--sm') + 'Discard</button>');
    },
    'discard-confirm': function () { store.inProgress = null; save(); closeDialog(); go('home'); toast('In-progress exam discarded.'); },
    picker: function () { go('picker'); },
    sources: function () { ui.back = null; go('sources', {}); },
    'order-rec': function () { ui.order = recommendedOrder(masteryMap()); render(); },
    'order-course': function () { ui.order = courseOrder(); render(); },
    move: function (el) {
      var tid = el.getAttribute('data-topic'), d = +el.getAttribute('data-dir'), i = ui.order.indexOf(tid), j = i + d;
      if (j < 0 || j >= ui.order.length) return;
      ui.order.splice(i, 1); ui.order.splice(j, 0, tid); render();
      var b = $('[data-action="move"][data-topic="' + CSS.escape(tid) + '"][data-dir="' + d + '"]'); if (b && !b.disabled) b.focus();
    },
    'start-exam': function () { store.inProgress = buildRun(ui.order || courseOrder(), ui.shuffleWithin); save(); go('exam'); },
    prev: function () { gotoIndex(store.inProgress.cur - 1); },
    next: function () { gotoIndex(store.inProgress.cur + 1); },
    goto: function (el) { gotoIndex(+el.getAttribute('data-index')); },
    'next-unanswered': function () {
      var run = store.inProgress, n = run.items.length;
      for (var k = 1; k <= n; k++) { var i = (run.cur + k) % n; if (run.answers[run.items[i]] == null) { gotoIndex(i); return; } }
      toast('All questions are answered.');
    },
    flag: function (el) { toggleFlag(el.getAttribute('data-id')); },
    drawer: function () { setDrawer(true); },
    'drawer-close': function () { setDrawer(false); },
    'submit-open': function () { openSubmit(); },
    'submit-confirm': function () { submitExam(); },
    'dialog-close': function () { closeDialog(); },
    'dialog-goto': function (el) { closeDialog(); gotoIndex(+el.getAttribute('data-index')); },
    'open-attempt': function (el) { ui.filter = 'all'; go('results', { id: el.getAttribute('data-id') }); },
    retake: function () { if (store.inProgress) { go('exam'); return; } ui.order = recommendedOrder(masteryMap()); go('order'); },
    print: function () { window.print(); },
    filter: function (el) { ui.filter = el.getAttribute('data-filter'); var y = window.scrollY; render(); window.scrollTo(0, y); },
    'to-review': function (el) { ui.filter = 'all'; render(); var t = $('#review-' + CSS.escape(el.getAttribute('data-id'))); if (t) t.scrollIntoView({ block: 'start' }); },
    'practice-topic': function (el) { startPractice(el.getAttribute('data-topic')); },
    'practice-sub': function (el) { startPractice(el.getAttribute('data-topic'), el.getAttribute('data-sub')); },
    'practice-missed': function () {
      var P = ui.prac; var ids = uniq(P.queue.filter(function (x) { return !x.retry && x.state !== 'correct'; }).map(function (x) { return x.id; }));
      var tid = P.tid, sub = P.sub; startPractice(tid, sub, ids);
    },
    pnext: function () { practiceNext(); },
    pcheck: function () { practiceCheck(); },
    pgoto: function (el) { ui.prac.idx = +el.getAttribute('data-index'); render(); },
    'practice-end': function () { go('summary'); },
    cite: function (el) { openCitation(el.getAttribute('data-item')); },
    'src-file': function (el) { var f = el.getAttribute('data-file'); go('sources', { file: f }, true); },
    'src-page': function (el) { var pg = el.getAttribute('data-page'); if (!pg) return; go('sources', { file: el.getAttribute('data-file'), page: +pg }, true); var v = $('#viewer'); if (v && v.getBoundingClientRect().top < 0) v.scrollIntoView({ block: 'start' }); },
    back: function () { var b = ui.back; ui.back = null; if (!b) { go('home'); return; } ui.view = b.view; ui.params = b.params; render(); window.scrollTo(0, b.y || 0); },
    export: function () { exportProgress(); },
    import: function () { var f = $('#import-file'); if (f) f.click(); }
  };
  doc.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    var fn = ACTIONS[el.getAttribute('data-action')];
    if (!fn) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'link' || el.classList.contains('drawer-scrim')) e.preventDefault();
    fn(el, e);
  });
  doc.addEventListener('keydown', function (e) {
    var el = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && el && el.getAttribute && el.getAttribute('role') === 'link' && el.getAttribute('data-action')) { e.preventDefault(); ACTIONS[el.getAttribute('data-action')](el, e); }
  });
  doc.addEventListener('change', function (e) {
    var el = e.target, a = el.getAttribute('data-action');
    if (a === 'answer') { var aid = el.getAttribute('data-id'), ar = store.inProgress; if (ar) setAnswer(aid, isMulti(ITEM[aid]) ? toggled(ar.answers[aid], Number(el.value)) : Number(el.value)); }
    else if (a === 'conf') { var run = store.inProgress; if (run) { run.conf[el.getAttribute('data-id')] = el.value; save(); } }
    else if (a === 'mode') { var r = store.inProgress; if (r) { r.mode = el.value; save(); render(); var q = $('#q-' + r.cur); if (q && r.mode === 'all') q.scrollIntoView({ block: 'start' }); } }
    else if (a === 'panswer') { if (el.type === 'checkbox') practicePick(Number(el.value)); else practiceAnswer(el.value); }
    else if (a === 'plen') ui.practiceLen = el.value;
    else if (a === 'shuffle-within') ui.shuffleWithin = el.checked;
    else if (el.id === 'import-file' && el.files && el.files[0]) importProgress(el.files[0]);
  });

  // Keyboard shortcuts for exam and practice
  doc.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (dialog.open) return;
    var t = e.target, tag = t && t.tagName;
    if ((tag === 'INPUT' && t.type !== 'radio' && t.type !== 'checkbox') || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    function choice(it) {
      if (isBinary(it)) { var first = it.options.map(function (o) { return o.charAt(0).toLowerCase(); }); if (k === first[0] || k === '1' || k === 'a') return 0; if (k === first[1] || k === '2' || k === 'b') return 1; return -1; }
      var i = '123456'.indexOf(k); if (i < 0) i = 'abcdef'.indexOf(k);
      return i < it.options.length ? i : -1;
    }
    if (ui.view === 'exam' && store.inProgress) {
      var run = store.inProgress, id = run.items[run.cur], it = ITEM[id];
      if (k === 'ArrowLeft') { e.preventDefault(); gotoIndex(run.cur - 1); return; }
      if (k === 'ArrowRight') { e.preventDefault(); gotoIndex(run.cur + 1); return; }
      if (k === 'm') { e.preventDefault(); toggleFlag(id); return; }  // M = mark; F answers False
      var c = choice(it); if (c >= 0) { e.preventDefault(); setAnswer(id, isMulti(it) ? toggled(run.answers[id], c) : c); }
    } else if (ui.view === 'practice' && ui.prac) {
      var P = ui.prac, en = P.queue[P.idx];
      if (en.state) { if (k === 'Enter' || k === 'ArrowRight') { e.preventDefault(); practiceNext(); } return; }
      if (k === 's') { e.preventDefault(); practiceAnswer('skip'); return; }
      var pit = ITEM[en.id];
      if (k === 'Enter' && isMulti(pit)) { e.preventDefault(); practiceCheck(); return; }
      var c2 = choice(pit); if (c2 >= 0) { e.preventDefault(); if (isMulti(pit)) practicePick(c2); else practiceAnswer(c2); }
    }
  });

  // Drag and drop for the section order list
  var dragId = null;
  app.addEventListener('dragstart', function (e) {
    var li = e.target.closest && e.target.closest('.reorder__item'); if (!li) return;
    dragId = li.getAttribute('data-topic'); li.setAttribute('data-dragging', 'true');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* ignore */ }
  });
  // Drop slot = gap between cards (0 = above the first, n = below the last), taken from the pointer's
  // position over the whole list, so the gaps between cards are valid drop zones too. Both cards that
  // border the slot light up: the one above on its bottom edge, the one below on its top edge.
  var dropSlot = null;
  app.addEventListener('dragover', function (e) {
    var list = e.target.closest && e.target.closest('.reorder'); if (!list || !dragId) return;
    e.preventDefault();
    var items = $$('.reorder__item'), from = ui.order.indexOf(dragId), slot = 0;
    items.forEach(function (x) { var r = x.getBoundingClientRect(); if (e.clientY > r.top + r.height / 2) slot++; });
    dropSlot = (slot === from || slot === from + 1) ? null : slot;  // dropping next to itself changes nothing
    items.forEach(function (x, i) {
      var pos = dropSlot === null ? null : i === dropSlot - 1 ? 'after' : i === dropSlot ? 'before' : null;
      if (pos) x.setAttribute('data-drop', pos); else x.removeAttribute('data-drop');
    });
  });
  app.addEventListener('drop', function (e) {
    var list = e.target.closest && e.target.closest('.reorder'); if (!list || !dragId) return;
    e.preventDefault();
    if (dropSlot !== null) {
      var from = ui.order.indexOf(dragId);
      ui.order.splice(from, 1);
      ui.order.splice(dropSlot > from ? dropSlot - 1 : dropSlot, 0, dragId);
    }
    dragId = dropSlot = null; render();
  });
  app.addEventListener('dragend', function () { dragId = dropSlot = null; $$('.reorder__item').forEach(function (x) { x.removeAttribute('data-drop'); x.removeAttribute('data-dragging'); }); });

  // Timer (counts only while the exam view is visible)
  var tick = 0;
  setInterval(function () {
    var run = store.inProgress;
    if (!run || ui.view !== 'exam' || doc.hidden) return;
    run.elapsed += 1000; tick++;
    if (tick % 5 === 0) save();
    var tt = $('#timer-text'); if (tt) tt.textContent = timerText(run);
    if (M.timer_minutes) {
      var left = M.timer_minutes * 60000 - run.elapsed;
      var tm = $('#timer'); if (tm && left < 300000) tm.setAttribute('data-warn', 'true');
      if (left <= 0) { toast('Time’s up. Your exam was submitted.'); submitExam(); }
    }
  }, 1000);
  // Only an exam in progress has unsaved state (elapsed time). Saving on every
  // pagehide would let a stale tab overwrite progress saved by another tab.
  window.addEventListener('pagehide', function () { if (store.inProgress && ui.view === 'exam') save(); });
  // Another tab changed the saved progress: pick it up unless we're mid-session here.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || ui.view === 'exam' || ui.view === 'practice') return;
    store = loadStore(); render();
  });

  /* ── 14. Test hooks (used by the headless test; harmless otherwise) ─── */
  window.__mockExam = {
    store: function () { return store; },
    mastery: masteryMap,
    recommendedOrder: function () { return recommendedOrder(masteryMap()); },
    conceptStatus: conceptStatus,
    go: go,
    ui: ui
  };

  render();
})();
