---
name: "mock-exam-builder"
description: "Build or update a self-contained HTML midterms/finals mock exam and per-topic practice quizzes strictly from class materials in a sources/ folder, with clickable citations, exam-based mastery tracking, reorderable sections, and incremental updates."
---

# Mock Exam Builder

Turn a class's learning materials into one HTML review tool with two modes:

- **Mock Exam** — the full exam (default ~100 items) across all topics; answers are revealed only after the whole exam is submitted. **This is the only thing that measures mastery.**
- **Practice** — a quiz on one topic at a time, with immediate feedback, focusing on weak areas identified by the latest mock exam. Practice never changes mastery.

The tool tracks weak areas across mock exam attempts, lets the student reorder exam sections (with a weakest-first recommendation), links every citation back to the exact spot in the learning material, and can be **updated** when new materials are dropped in, without losing the student's history.

## Skill files (build from these — never from scratch)

```
mock-exam-builder/
├── SKILL.md
├── templates/
│   ├── base.html            page shell with {{slots}}: head, icon sprite, top bar, #app, dialog, data scripts
│   └── app.js               the shared runtime: every view, mastery logic, storage, keyboard, citations
├── design-system/
│   ├── tokens.css           ALL colors, fonts, type scale, spacing, radii, shadows, widths (+ dark mode)
│   ├── fonts/               Bebas Neue + Inter woff2 (Latin, OFL-1.1), inlined by build.py
│   └── components.css       every component class, built only from tokens
├── components/*.html        one reference snippet per component: exact markup + when to use it
├── examples/
│   ├── finished-exam.html   the gold-standard output (CSOPESY sample, version 2, 42-item bank with all three formats, 18-item exam)
│   ├── sample-content/exam.json   the input that builds it — the exact content format build.py expects
│   └── screenshots/         reference shots from test_exam.py --shots: 01–11 desktop screens (03b = multi-select), m-light-*/m-dark-* phone, d-dark-* desktop dark
├── scripts/
│   ├── build.py             verify bank → encode → fill template → inline CSS/JS → one self-contained .html
│   └── test_exam.py         headless Playwright test of a built exam (+ optional screenshots)
└── revise-questions/
    └── SKILL.md             sub-skill: change existing questions' cognitive level and/or format
```

**Changing existing questions** (rewrite at another cognitive level, or convert between single answer, multi-select and True/False): follow `revise-questions/SKILL.md` instead of the workflows below.

**Build rules**
0. **The skill folder is read-only while working on a class project.** Never edit anything under this skill (`SKILL.md`, `templates/`, `design-system/`, `components/`, `examples/`, `scripts/`) because of a project. Every change to an exam, including anything that departs from the example, is made only in the project folder the skill is pointed at (`<ClassCode>/`). Working files (`work/exam.json`, screenshots) go in the working directory, outside both the skill and the class folder. Edit the skill's own files only when the user explicitly asks to change the skill itself.
1. A **new build** starts from `templates/base.html` and `templates/app.js`. Never write a page shell or app logic from scratch. Exam-specific content goes in `exam.json` only.
2. A new build uses only classes from `design-system/components.css` and variables from `tokens.css`. No ad-hoc colors, fonts or inline styles. The one permitted inline style is the data variable `style="--pct: N"` on `.progress` / `.meter__fill`.
3. Before using or changing a component, read its snippet in `components/` and copy its markup structure.
4. Run `scripts/build.py` to produce the final single self-contained HTML file — it verifies the bank, encodes it, inlines the CSS and JS, and refuses to write output with external references, plain-text answers or stray inline styles. On an `--into` rebuild, inline styles are the project's own and only print as `NOTE` lines.
5. **A new build's UI must be a 1:1 replica of `examples/finished-exam.html`.** Only the content (manifest, items, source pages) differs; every screen, component, spacing, color and interaction matches `examples/screenshots/`. Compare your screenshots against them screen by screen, and treat any visual difference you didn't intend as a bug.
6. **When the user asks for something that departs from the example** (a new behavior, a restyled component, a different layout), make the change only in that project's HTML file: edit its inlined `<style>` and runtime `<script>` directly (new rules go in the `<style>` block, not in `style=""` attributes), reusing the classes and tokens already in the file where possible. This applies to a new build too: build it from the templates first, then make the requested change in the output file. Don't touch the skill's files, don't rebuild the example, don't replace `examples/screenshots/`. Later rebuilds use `build.py --into` (see **Existing projects**), which keeps these edits.

**Existing projects** (the requested exam file already exists)
- **Check alignment, don't enforce it.** Run `python3 <skill>/scripts/build.py --check-ui <ClassCode>/<file>.html`. It compares the file's page shell, inlined styles and runtime with the skill's current `templates/base.html`, `design-system/` and `templates/app.js`, and prints `MATCH` or `DIFFER` for each, with the differing lines. Content (questions, source text, title, footer text) is ignored. It's read-only. Mention mismatches in one or two lines of the reply (e.g. "This exam uses an older runtime / a customised top bar"). **Don't change the project to match the skill** unless the user asks for that.
- **Do only what the prompt asks.** An update request adds material; a restyle request changes the UI; neither quietly brings the rest of the file in line with the example.
- **Rebuild content with `--into`:** `python3 <skill>/scripts/build.py work/exam.json --into <ClassCode>/<file>.html` replaces only the manifest, item bank, page text, title and the generated footer, and keeps the file's own styles, runtime and page shell exactly as they are, drift included. Never rebuild an existing project without `--into`, which would reset its UI to the skill's.
- If the user wants a feature the project's older runtime lacks (e.g. multi-select), say so and ask which way to go: port just that feature into the project's file by hand (keeps its other differences), or replace the file's UI with the skill's current one (a plain rebuild without `--into`, which discards the project's own UI changes).

Visual direction and design rules live in the header of `design-system/components.css`; each component's markup and usage live in its `components/*.html` snippet. This file doesn't restate them.

## Folder structure

One folder per class, named by class code:

```
<ClassCode>/
├── <ClassCode>-mock-midterms-exam.html
├── <ClassCode>-mock-finals-exam.html      ← only once a finals exam is made
└── sources/                               ← learning materials go here
```

Example:
```
CSOPESY/
├── CSOPESY-mock-midterms-exam.html
└── sources/
```

- **`<ClassCode>`** is the class code exactly as the user gives it (e.g., `CSOPESY`), uppercase, no spaces. Infer it from the user's message, the folder name, or the materials (course code on slides/syllabus); ask only if none of these gives it.
- **Exam term** is `midterms` or `finals`. Infer it from the user's message or the materials (e.g., "Midterm coverage" slide); otherwise ask. The file name is always `<ClassCode>-mock-<midterms|finals>-exam.html`.
- **`sources/`** is the single source of truth, shared by the class's exams. Only files in `sources/` are used for questions. Keep original file names. Materials the user attaches in chat are copied into `sources/` first.
- Each exam's manifest lists which files in `sources/` it covers, so midterms and finals can share the folder:
  - **Building finals when a midterms exam exists:** ask whether finals are **cumulative** (all sources) or **post-midterms only** (sources not in the midterms manifest). Default: post-midterms only.
- The HTML must still work if opened alone: the embedded source viewer shows the cited text; only "Open original file" links need `sources/` beside it.

**Where the folder lives:**
- If the user's computer is connected and they name or connect a folder, work in `<that folder>/<ClassCode>/` (or in it directly if it already is the class folder) and write results there.
- Otherwise build `<ClassCode>/` in the working directory and deliver `<ClassCode>.zip` (HTML + `sources/`), plus the HTML on its own for quick viewing.

## Non-negotiable rules

1. **Scope lock.** Every question, correct answer and explanation must be traceable to a specific passage in a file in `sources/` that belongs to this exam's coverage. No outside facts, no "common knowledge" additions, no topics the materials only name in passing without teaching.
2. **Every item cites its source:** file name, page/slide/section, and the supporting excerpt. Citations are shown (and clickable) only once the answer is revealed.
3. **Explanations use only the materials' content and terminology.**
4. **Distractors** are built from concepts in the materials (a neighbouring term, a swapped step, a misapplied rule). Never introduce new named facts, people, dates or terms the student could mistake for course content.
5. **Question formats are strictly these three:**
   - **Multiple choice, single answer** (`mcq`) — one correct answer, 4 options (3 only when the material genuinely supports no more).
   - **Multiple choice, multi-select** (`msq`) — 4 or 5 options, **at least 2 correct and at least 1 incorrect**. Use it only where the materials give a list or set to choose from (what a structure contains, which criteria apply, which statements describe a model). The stem asks "Which … ?" without saying how many; the page adds "Select all that apply." **Scoring is all-or-nothing:** the answer counts as correct only if the student picks exactly the correct options. Vary the number of correct options across items, and never use "all/none of the above".
   - **True/False** (`tf`) — a single declarative statement that is unambiguously true or false according to the materials. Never a question, never two claims joined by "and", no absolutes ("always", "never") unless the materials say so. Do not write Yes/No items.
   - In **Practice mode only**, every question also shows a **"Not sure / Skip"** option. Never in Mock Exam mode.
6. **In Mock Exam mode, answers are never visible before submission** — not on screen, not in plain text in the page source.
7. **Coverage:** every topic in the exam's coverage gets questions, weighted by how much the materials cover it.
8. **Mastery comes only from mock exams.** Practice answers never change mastery bands, concept status, the recommended section order, or the weakness report.

## Step 0 — New build or update?

- Look in the connected folder, attachments, working directory and the user's artifacts for `<ClassCode>-mock-*-exam.html` containing `<script id="exam-manifest" type="application/json">`.
- If the user refers to "my exam" and none is found, ask them to attach it or connect its folder.
- **The requested exam (e.g., midterms) exists** → follow **Existing projects** (under Build rules). Use the **Update workflow** only when the request is to add new material; for anything else (a fix, a restyle, a question), do just that.
- **It doesn't exist** → **New build workflow** (even if the other term's exam exists).
- If new files appear in `sources/` and the user doesn't say which exam they're for: with only one exam in the folder, update that one; with both, ask (default: finals).

## New build workflow

### 1. Set up the folder and read everything
- Create `<ClassCode>/` and `<ClassCode>/sources/`; put materials in `sources/`.
- Decide this exam's coverage (all sources, or for finals possibly post-midterms only).
- Read every covered file completely (use file-reading / pdf-reading / pptx / docx skills; OCR images). Never sample or skim. If a file can't be read, say which and ask for another format.
- Keep the **text of each page/slide/section**, labeled by file and location, for the source viewer.
- Compute a SHA-256 hash of each source file for the manifest.

### 2. Build the source map
For each file extract:
- **Topics** (use the materials' own lecture/chapter/heading names) and **subtopics**.
- **Concepts** under each subtopic: definitions, key terms, processes/steps, formulas, examples, comparisons, lists, cause–effect relationships, worked problems. Each concept gets a stable id (`t2.scheduling.round-robin`) and a location.
- **Weight** per topic: volume plus emphasis signals (learning objectives, bold/"important", repeated across files, summary slides, review questions).
Learning objectives or an official coverage list, if present, are the primary blueprint.

### 3. Settle settings (ask once, briefly)
Use AskUserQuestion if available; ask class code / exam term here only if they couldn't be inferred. Defaults if no answer:
- **Mock exam length:** **100 items**; minimum 3 per topic. If the materials can't honestly support 100 fair items, use fewer and say how many they support.
- **Timer:** off; if on, suggest ~1 min per item.
- **Difficulty mix:** balanced.

### 4. Blueprint and item bank
- Per topic, write roughly **2× the items the mock exam draws** from it (~200 items for a 100-item exam), at least 6 per topic where supported. If the material doesn't support 2×, write as many fair items as it supports; the exam must still reach its length.
- The mock exam draws its per-topic quota from the bank, proportional to topic weight, minimum 3 per topic. Quotas live in the manifest; each attempt samples fresh items within quotas.
- Spread items across all concepts; every concept gets ≥1 item where the material supports a fair question.
- Tag cognitive level: **recall / understand / apply / analyze**, roughly 35/30/25/10 as the materials allow. The level is what the student must *do* to answer, not the format: all three formats can carry any level. Tag the highest level the item actually requires; if the stem can be answered by matching a phrase in the materials, it is recall, whatever it looks like.

  | Level | The student must… | MCQ example | True/False example |
  |---|---|---|---|
  | **recall** | retrieve a fact, term or definition as stated in the materials | "Which section of a process's memory holds function parameters and return addresses?" (Stack) | "The PCB stores the list of a process's open files." (True) |
  | **understand** | explain, classify or tell apart concepts in their own words; the answer is not a phrase lifted from the text | "What makes a process different from a program?" | "It is possible to have concurrency without parallelism." (True) |
  | **apply** | use a rule, algorithm or procedure on a concrete case the materials don't spell out | "Processes P1–P3 arrive at t=0 with bursts 24, 3, 3. What is the average FCFS waiting time?" (17) | "With a time quantum of 4, P1 (burst 10) needs three turns on the CPU under round robin." (True) |
  | **analyze** | compare mechanisms, infer a consequence, or reason about why/when something happens | "Why does a very large time quantum make round robin behave like FCFS?" | "In the many-to-one model, threads of one process can run in parallel on a multicore system." (False) |

  Levels are shown to the student only in the results' **Score by question type** (never as a tag on a question), so a wrong tag misleads the study plan. Where the materials only support recall for a concept, tag it recall rather than inflating it.
- Format mix: roughly **60% single-answer, 15% multi-select, 25% True/False**, as the materials allow. Balance True and False answers, and single-answer answer positions.
- Write the bank topic by topic (one file per topic, then merge) so quality holds across ~200 items.

Item schema:
```json
{
  "id": "t2-q07",
  "topic": "t2",
  "subtopic": "Round Robin",
  "concept": "t2.scheduling.round-robin",
  "concept_label": "Round-robin time quantum behaviour",
  "type": "mcq | msq | tf",
  "level": "recall | understand | apply | analyze",
  "difficulty": "easy | medium | hard",
  "stem": "...",
  "options": ["...", "...", "...", "..."],
  "answer": 2,
  "explanation": "Why the answer is right, and why the most tempting distractor is wrong, using only the materials.",
  "source": { "file": "Lecture3.pdf", "loc": "p. 12", "page": 12, "excerpt": "exact supporting sentence(s) from the material" },
  "added_in": 1
}
```
For `tf`, options are `["True", "False"]` and the stem is a statement, not a question. For `msq`, `answer` is a sorted list of the correct option indexes, and the explanation says why each wrong option is wrong. The excerpt must cover every correct option. `source.page` is the 1-based page (PDF), slide (PPTX) or section index; `source.excerpt` must match that page's extracted text exactly so it can be highlighted.

Item-writing standards: one clearly correct answer (for multi-select, one clearly correct set); options similar in length and grammar; no "all/none of the above" in single-answer items unless the materials use that style, and never in multi-select; no trick wording or double negatives; no trivia about slide numbers or titles; no two items test the same fact the same way; no item gives away another's answer. Don't copy the materials' own practice questions verbatim.

### 5. Verify (required)
Assemble `exam.json` in the working directory (never inside the class folder — it contains the answers) in the format of `examples/sample-content/exam.json`: `manifest`, `items`, `source_pages` (every page's extracted text, keyed by file then page number as a string). `build.py` runs these checks automatically and stops on errors:
- Every `source.file` exists in `sources/` and is in this exam's coverage; every `excerpt` is found verbatim in that page's text.
- Valid `answer` (an index for `mcq`/`tf`; for `msq`, a sorted list with ≥2 correct and ≥1 incorrect of 4–5 options); `type` only `mcq`, `msq` or `tf`. Legacy `yesno` items (older exams) still render, but `build.py` warns. Mention them in the reply; rewrite them as `tf` statements only if the user asks (a rewrite changes existing items).
- Bank sizes and quotas meet minimums; quotas sum to the exam length; every concept has ≥1 item or a noted reason.
- No duplicate stems; MCQ answer positions roughly even; True/False roughly balanced; multi-select items don't all have the same number of correct options.
Then audit every item manually against its excerpt. Rewrite or delete anything relying on outside knowledge. Fix every `ERROR` line; fix `WARN` lines unless the material genuinely can't support it (say so in the reply).

### 6. Build the HTML
```
python3 <skill>/scripts/build.py work/exam.json --out-dir <ClassCode>/
```
This writes `<ClassCode>/<ClassCode>-mock-<term>-exam.html` and prints the coverage table (topic → bank items → exam items) for the reply. It adds `citations`, `cited_pages` and `topics` to each manifest source, keeps only cited pages ± 1 of text, and splits each item into display fields plus an encoded secret (answer, explanation, source).

### 7. Test → 8. Deliver (see below).

## Update workflow (existing exam + new materials)

1. **Load the exam:** `python3 <skill>/scripts/build.py --extract <ClassCode>/<file>.html > work/exam.json` decodes the manifest, full item bank and embedded page text. Rebuilding from that JSON unchanged reproduces the same exam. Add new material to it, then rebuild with `build.py --into` in step 8. First run `build.py --check-ui` on the file (see **Existing projects**) and note any mismatches for the reply.
2. **Find new material:** compare files in `sources/` (plus chat attachments, copied into `sources/`) with the manifest's `sources` by hash.
   - Same hash → already included; skip.
   - Same name, different hash → edited file; treat changed pages as new material and flag existing items whose excerpt no longer appears (ask before removing them).
   - Listed in the manifest but missing from the folder → keep its items and embedded text; tell the user its "Open original" links break until it's back.
   - Files already covered by the *other* term's exam aren't added unless the user says this exam is cumulative.
3. **Read the new material fully** and build its source map.
4. **Classify every new concept** against the existing topic/concept map:
   - **New topic** → add as a new topic: its own Mock Exam section, its own Practice quiz, its own weight. If it clearly belongs to an existing unit (same lecture series or chapter), add it as a new **subtopic** there instead, and say which you chose.
   - **Existing topic, new information** (concepts, details, examples, processes not yet covered by any item) → new items in that topic.
   - **Already covered** → no new items.
   - **Conflicts** with existing material → no items on that point; flag it to the user.
5. **Preserve everything that exists:** same item ids, text, answers and `exam_id`, so history carries over. New items get `"added_in": <new version>`.
6. **Rebalance** quotas to include new topics/concepts while keeping exam length and minimums.
7. **Bump** `version`; add new sources (hashes, page text); add a changelog entry.
8. Re-verify the whole bank, rebuild the HTML in place with `python3 <skill>/scripts/build.py work/exam.json --into <ClassCode>/<file>.html` (keeps the file's own UI), and **report the diff**: new topics/subtopics, items added per topic, material already covered, conflicts. New topics and items show a "New" badge in the HTML until attempted; new topics are "Not attempted" until they appear in a submitted mock exam.

## HTML specification

One file, `<ClassCode>-mock-<midterms|finals>-exam.html`: all CSS/JS inline, no external requests, works offline by double-clicking. **`templates/app.js` already implements everything in this section.** `build.py` only has to fill it with content. Read this spec to understand the behaviour. A project that needs something new gets it in its own HTML file (build rule 6), never in `templates/app.js`. Optional manifest field: `timer_minutes` (null = untimed).

### Embedded data
- `<script id="exam-manifest" type="application/json">` (plain): `exam_id` (stable UUID, unique per exam file), `class_code`, `term` (`midterms`/`finals`), `title` (e.g., "CSOPESY Mock Midterms Exam"), `version`, `generated`, `exam_length`, `coverage` (`all` / `post-midterms` / list), `sources` [{file, hash, type, pages, added_in}], `topics` [{id, name, subtopics, concepts [{id, label}], weight, exam_quota, added_in}], `changelog`.
- `<script id="exam-bank" type="application/octet-stream">`: item bank as JSON → XOR with a key → base64. Stems/options decoded for display; answers, explanations and sources decoded **only** when revealed (Practice: per question; Mock Exam: on submit).
- `<script id="source-pages" type="application/octet-stream">`: extracted text of every **cited** page/slide/section plus one page of context either side, keyed by `file` + `page`, encoded the same way.

### Clickable citations and the Sources view
Every revealed citation (Practice feedback, exam answer review, weakness report's "where to study") is a link that opens the **Sources view**:
- **Left: the sources folder** — a file list mirroring `sources/` (type icon, name, number of questions citing it). The cited file is **highlighted and scrolled into view**; its cited pages are listed underneath with the current one selected.
- **Right: the source viewer** — the cited page's text with the **excerpt highlighted** (`<mark>`, scrolled into view), and Previous / Next page within the embedded context.
- **"Open original file"** — a relative link to `sources/<file>` with a page anchor where supported (`sources/Lecture3.pdf#page=12&search=<first words of excerpt>`). For PPTX/DOCX the label says e.g. "Opens in PowerPoint — go to slide 7", since browsers can't jump to a slide.
- **"Back to question"** returns the student to exactly where they were.
- Also reachable from the home screen as **Browse sources** (files and the topics each feeds). During an unsubmitted mock exam it shows only the file list and topics, not page text.

### Home screen
- Title (top bar; see `components/topbar-and-statusbar.html`), version, "Last updated".
- Entry points: **Mock Exam** (primary), **Practice by Topic**, **Browse sources** (`components/card.html`).
- **Topic mastery panel** (from mock exams only): each topic's band from its latest mock exam result, the change since the previous mock exam (▲/▼), and the number of mock exams taken. Bands: Mastered (≥85%), Solid (70–84%), Needs review (50–69%), Weak (<50%), Not attempted. Bands render per `components/badge-and-band.html`.
- **Mock exam history:** date, score, and a link to each past attempt's results.
- **Export progress** / **Import progress** (history JSON), since browser storage is tied to where the file is opened and can be wiped.

### Mock Exam mode
**Before starting: Section order screen.**
- Each topic is a **draggable card** (drag and drop, plus Up/Down buttons for touch and keyboard) with topic name, items in this exam, and mastery band. Drag and drop behaves per `components/reorder-list.html`.
- **Use recommended order** (weakest → most confident by current mastery; Not attempted topics right after Weak and Needs review) and **Use course order**.
- No mock exam taken yet → course order by default, noting that a recommendation appears after the first mock exam. Otherwise recommended order by default.
- Option: shuffle questions within each section.

**During the exam** (~100 items)
- Header: title, answered / total, progress bar, optional timer.
- **Sidebar** (sticky on desktop, drawer on mobile): sections in the chosen order, each collapsible, with numbered question chips (unanswered / answered / flagged / current) and answered/total per section; "Jump to next unanswered".
- One question at a time with Previous / Next, or scroll-all toggle.
- Per question: options (radio buttons; checkboxes with square keys for multi-select), **Flag for review**, **confidence** (Guessing / Sure; two choices only, so every correct non-Sure answer counts as a lucky guess). Keys: 1–5 / A–E (on multi-select, each key toggles its option), T / F, M to flag. A multi-select question counts as answered once at least one option is ticked.
- In-progress answers saved to `localStorage` (try/catch); **Resume** on the home screen.
- **Submit** → confirm dialog listing unanswered and flagged items (clickable) → lock inputs, stop timer, reveal, record the attempt.

**Results**
1. Score and band, correct / total, change from previous mock exam, and a one-line summary: misconceptions, lucky guesses, flagged, time taken (`components/stat-tile.html`).
2. **Section breakdown**: per-topic scores, bars, mastery bands.
3. **Weakness report:**
   - Weak / needs-review topics as cards, weakest first (the section breakdown already lists every topic's score, band and trend, so no separate table).
   - Per weak / needs-review topic: missed concepts (`concept_label`) and **where to study** as clickable citations, grouped and deduplicated (e.g., "Lecture3.pdf pp. 10–14").
   - **Misconceptions:** wrong while marked Sure — top priority.
   - **Lucky guesses:** right while marked Guessing — not yet secure.
   - Score by cognitive level with a one-line read. Each level row expands to the questions tagged with it (Q number, concept, result, link to its review). Levels appear only here, never as a tag on a question.
   - A 3–6 bullet **prioritized study plan** citing only the provided materials.
   - **Practice this topic** buttons; **Retake with recommended order**.
4. **Answer review:** every item with the student's answer, correct answer, explanation, clickable citation. Filters: All / Incorrect / Flagged / Guessed.
5. Print / Save as PDF via a print stylesheet.

### Practice mode
- **Topic picker:** a card per topic and subtopic showing its mastery band **from the latest mock exam** and a "New" badge where relevant. Weak and Needs-review topics are listed first under **Focus areas**, with the reason from the mock exam ("3 of 5 missed in your last mock exam"). With no mock exam yet, topics appear in course order with a note that focus areas appear after the first mock exam.
- The student picks a topic or subtopic and a length (10 / 20 / all bank items for it).
- **Question order:** items on concepts flagged in the latest mock exam (missed, misconceptions, lucky guesses) first, tagged "Focus"; then items not seen in any mock exam; then the rest.
- Each question shows its options plus **Not sure / Skip**.
- **Immediate feedback:** correct/incorrect, correct answer, explanation, clickable citation. Not sure / Skip reveals the answer. Single-answer and True/False answer on click; multi-select answers when the student presses **Check answer** (or Enter), and every correct option and every wrong pick is marked.
- Missed and skipped items are re-queued once at the end of the session.
- Sidebar lists the session's questions (unanswered / correct / incorrect / skipped / focus).
- **Session summary:** the session's score and the concepts missed or skipped (with clickable citations), clearly labeled "Practice results — doesn't affect mastery. Take a mock exam to update your mastery." Buttons: **Practice missed items again** / **Back to topics** / **Take mock exam**.
- Practice sessions are not stored as mastery data. Only a simple count of practice sessions per topic may be kept for display.

### History and mastery (mock exams only)
Stored in `localStorage` under `mockexam:<exam_id>` (try/catch; the page works without it):
- Each **submitted mock exam attempt**: date, order used, time taken, and per item: id, concept, topic, answer, result, confidence.
- **Topic mastery** = the topic's score in the most recent submitted mock exam that included it; trend compares with the previous one. Not attempted until a submitted mock exam includes it.
- **Concept status** (from mock exams only): *weak* (missed in the latest mock exam, or wrong while Sure), *shaky* (right but Guessing, or missed in the previous exam and right in the latest), *secure* (right with confidence in the latest mock exam).
- The recommended section order, Practice focus areas, and weakness report all read from this. Unsubmitted exams and Practice sessions never write to it.
- Stable ids keep history valid across updates.

### Design
Comes entirely from `design-system/` and `components/` (see **Skill files** above); readable at phone width with no horizontal scroll. Screen → components: Home = entry cards, callouts, rows (mastery, history) · Section order = reorder list · Exam = status bar, navigator, question · Results = score hero (one-line summary), meter list, collapsible level meters, weak-topic cards, callouts, study plan, revealed questions with filters · Practice = picker cards + segmented length, focus layout (centered question card, session panel docked on its left, status bar the same width as the card), question with skip, feedback, summary · Sources = file list + viewer.

## Test before delivering
Run `python3 <skill>/scripts/test_exam.py <ClassCode>/<file>.html --shots work/shots`. It covers the automated checks below. Then compare each screenshot, at desktop and phone width, against the matching one in `examples/screenshots/`. For a new build, apart from the content and anything the user asked to change, they must look the same. For an existing project, differences the project already had or the user asked for are expected: report them, don't fix them. If a check fails only because of such a difference, say so instead of changing the project to pass it. Confirm:
- No console errors; all items render; only `mcq`, `msq` and `tf` exist; multi-select items render checkboxes; Not sure / Skip appears in Practice and never in Mock Exam.
- A mock exam draws the configured length (default 100) with correct per-topic quotas.
- Scripted runs score correctly (all correct → 100%, all wrong → 0%, where every multi-select item gets a partial pick, which proves all-or-nothing scoring).
- **Mastery isolation:** a simulated Practice session with all wrong answers leaves mastery bands, concept status and recommended order unchanged; a simulated submitted mock exam changes them.
- Reordering sections changes sidebar and question order; recommended order matches stored mastery.
- Practice puts weak-concept items first after a simulated weak mock exam.
- Citations open the Sources view with the right file highlighted and excerpt marked; every "Open original file" link resolves to a file in `sources/`.
- Answers, explanations and excerpts aren't findable as plain text in the HTML.
- File name matches `<ClassCode>-mock-<midterms|finals>-exam.html`.
- For updates: existing item ids and answers unchanged, `exam_id` unchanged, new topics appear in both modes and in Browse sources.

## Deliver
- Connected folder: say where `<ClassCode>/` is and which HTML to open. Otherwise send `<ClassCode>.zip` (HTML + `sources/`) and the HTML alone; note that "Open original file" links need the HTML to stay next to `sources/`.
- Offer in one line to publish the HTML as a shareable page (the source viewer works there; "Open original file" links won't).
- In the reply: bank size, mock exam length, coverage table (topic → bank items → exam items), and anything thin, unreadable or conflicting. For updates, give the diff. Never reveal answers in the reply.

## Edge cases
- **Too little material for 100 items:** shorten the exam rather than padding; say how many items the material honestly supports.
- **Scanned PDFs/images:** OCR for the viewer; excerpts must match the OCR text.
- **Math/science notation:** plain HTML/Unicode or inline SVG; no external libraries.
- **Diagrams:** questions may refer to them in words but must be answerable from what the materials state; the viewer says "See the diagram on slide 7 in the original file."
- **Student deletes browser data:** mastery resets to Not attempted; Import progress restores it.