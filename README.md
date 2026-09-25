<div align="center">

# Mock Exam Builder

**A Claude skill that turns class materials into a self-contained mock exam and practice quizzes, as a single HTML file.**

[Overview](#overview) • [Features](#features) • [Getting started](#getting-started) • [Usage](#usage) • [Scripts](#scripts) • [Project structure](#project-structure)

![Mock exam results screen](examples/screenshots/06-results-mixed.png)

</div>

## Overview

Drop your lecture slides, PDFs and notes into a `sources/` folder, ask Claude for a mock midterms or finals exam, and you get one HTML file. It works offline by double-clicking and has two modes:

- **Mock Exam**: the full exam (100 items by default) across every topic. Answers are revealed only after you submit, and it's the only thing that measures mastery.
- **Practice**: one topic at a time with instant feedback, weakest areas first. Practice never changes mastery.

Every question is written only from your materials and cites the exact page it came from. Citations open a built-in source viewer with the passage highlighted.

> [!NOTE]
> This is a skill for [Claude Code](https://claude.com/claude-code) and Claude apps. Claude follows `SKILL.md` to read the materials, write and verify the question bank, and run the build scripts. You don't run the pipeline by hand.

## Features

- **Scope-locked questions**: every answer and explanation traces back to a verbatim excerpt from a file in `sources/`. No outside facts.
- **Three question formats**: multiple choice with a single answer, multiple choice with multi-select (scored all-or-nothing), and True/False.
- **Cognitive levels**: every item is tagged Recall, Understand, Apply or Analyze, and the results break your score down by level.
- **Mastery tracking**: per-topic bands (Mastered, Solid, Needs review, Weak) with trends across attempts, a weakness report, misconceptions (wrong while sure) and lucky guesses.
- **Reorderable sections**: drag the exam sections into any order, or use the recommended weakest-first order.
- **Incremental updates**: add new materials later and the exam grows, without losing the student's history.
- **Question revisions**: rewrite existing questions at another cognitive level or convert their format with the `revise-questions` sub-skill.
- **One file, no network**: all CSS, JavaScript, fonts and data are inlined. Light and dark themes, phone-width layout, print stylesheet.

<div align="center">

| Exam | Practice feedback | Sources |
|:---:|:---:|:---:|
| ![Exam](examples/screenshots/03-exam.png) | ![Practice feedback](examples/screenshots/09-practice-feedback.png) | ![Sources](examples/screenshots/07-sources.png) |

</div>

## Getting started

### Prerequisites

- [Claude Code](https://claude.com/claude-code) or a Claude app with skills enabled
- [Python 3.8+](https://www.python.org/downloads/): the build script uses the standard library only
- Optional, for tests and screenshots: [Playwright](https://playwright.dev/python/) with Chromium

```bash
pip install playwright
```

```bash
playwright install chromium
```

### Install the skill

Copy this folder into your personal skills directory, so Claude can find it:

```bash
cp -r mock-exam-builder ~/.claude/skills/
```

> [!TIP]
> To share it with a team through a repository, put it in `.claude/skills/` inside that project instead.

## Usage

### Build a new exam

Put the class materials in a folder named after the class code, then ask Claude:

```text
CSOPESY/
└── sources/
    ├── L02-Processes.pdf
    └── L03-CPU-Scheduling.pptx
```

> Build a mock midterms exam for CSOPESY from the files in sources/.

Claude reads every file fully, asks a few settings (exam length, timer), writes and verifies the bank, and delivers `CSOPESY/CSOPESY-mock-midterms-exam.html`.

### Update an existing exam

Add the new files to `sources/` and ask:

> I added Lecture 4 to sources/. Update my CSOPESY midterms exam.

New topics get their own section and practice quiz. Existing question IDs and answers are kept, so saved history carries over. The exam's own look is kept too: rebuilds swap in the content only.

### Revise questions

> Make the Recall questions in CPU Scheduling harder.

Claude narrows the selection (whole coverage, topic, subtopic or one question), shows each question with its choices, and asks what to change: the cognitive level (or a sentence you write) and the format. It flags when one forces the other, and shows every change as before → after for approval.

> [!IMPORTANT]
> Answers in the HTML are encoded, not encrypted. They're hidden from casual view and from the page source, but anyone determined can decode them. The intermediate `exam.json` holds the answers in plain text, so it's kept out of the class folder.

## Scripts

Both scripts live in `scripts/`. Claude runs them, but you can use them directly.

| Command | What it does |
|---|---|
| `python scripts/build.py exam.json --out-dir CSOPESY/` | Verify the bank, then build a new exam from the templates |
| `python scripts/build.py exam.json --into CSOPESY/<file>.html` | Refill an existing exam's content, keeping its own styles, runtime and page shell |
| `python scripts/build.py --extract CSOPESY/<file>.html` | Decode an exam back to `exam.json` (answers included) |
| `python scripts/build.py --check-ui CSOPESY/<file>.html` | Report whether an exam's page shell, styles and runtime still match the skill (read-only) |
| `python scripts/build.py --lint-only` | Lint the design system (tokens only, no raw colors or px font sizes) |
| `python scripts/test_exam.py CSOPESY/<file>.html --shots shots/` | Headless test of a built exam, with optional desktop, phone and dark-mode screenshots |

The build stops on errors such as an excerpt that isn't verbatim on its cited page, an invalid answer, or quotas that don't add up to the exam length. It warns about balance issues such as True/False or answer-position skew.

## Project structure

```text
mock-exam-builder/
├── SKILL.md                 the skill: rules, workflows and HTML specification
├── revise-questions/        sub-skill for changing existing questions' level and format
├── templates/               page shell (base.html) and the shared runtime (app.js)
├── design-system/           tokens.css, components.css and inlined fonts
├── components/              one reference snippet per UI component
├── examples/
│   ├── finished-exam.html   reference output (42-item bank, 18-item exam)
│   ├── sample-content/      the exam.json that builds it
│   └── screenshots/         reference screenshots for every screen
└── scripts/                 build.py and test_exam.py
```

New exams are a 1:1 replica of `examples/finished-exam.html` with different content. Changes requested for one class's exam are made only in that exam's file, never in the skill itself.

## Try the example

Rebuild the reference exam and open it in a browser:

```bash
python scripts/build.py examples/sample-content/exam.json --key SampleKeyForReference2026 --out examples/finished-exam.html
```

```bash
python scripts/test_exam.py examples/finished-exam.html
```
