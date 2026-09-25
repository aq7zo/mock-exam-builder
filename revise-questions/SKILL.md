---
name: "revise-questions"
description: "Revise questions in an existing mock exam built by mock-exam-builder: pick a topic, subtopic, single question or the whole coverage, review each question with its choices, then rewrite it at a different cognitive level (Recall / Understand / Apply / Analyze, or to a sentence the user writes) and/or convert its format (single-answer multiple choice, multi-select, True/False). Use it whenever the user wants to change, rewrite, re-level, harden, simplify or convert questions in an exam that already exists, even if they don't name the skill."
---

# Revise Questions

A sub-skill of **mock-exam-builder** (the parent folder). It changes existing questions in an existing exam. It never builds a new exam and never adds new material. Use the parent's Update workflow for that.

Everything in the parent `SKILL.md` still applies. In particular:
- **Build rule 0:** the skill folder is read-only. Every change is made in the class folder's exam file.
- **Non-negotiable rules 1–5:** scope lock, citations, the three question formats and their rules.
- **Existing projects:** rebuild with `--into` so the exam's own UI is kept.

Level definitions and examples are in the parent's cognitive-level table (step 4 of the New build workflow). Below, `<skill>` means the parent `mock-exam-builder/` folder, where `scripts/` lives.

## 1. Load the exam

1. Find `<ClassCode>-mock-<term>-exam.html` the same way as the parent's Step 0. If there's more than one, ask which one.
2. Decode it into the working directory, never into the class folder, because the JSON contains the answers:
   `python3 <skill>/scripts/build.py --extract <ClassCode>/<file>.html > work/exam.json`
3. Check what the exam's runtime supports. If `grep -c isMulti <file>` is `0`, the exam predates multi-select and can't show `msq` items. If the user later picks multi-select, say so and follow the parent's rule for missing features (port it in by hand, or replace the UI). Ask which; don't decide for them.

## 2. Narrow the selection

Use `AskUserQuestion` (one question at a time; its free-text "Other" answer covers anything not listed):

1. **Scope:** Whole coverage · A topic · A subtopic · A specific question.
2. Then, depending on the answer:
   - **Topic / subtopic:** list the names from the manifest. More than 4 → print the numbered list in chat and let them type the number or name.
   - **Specific question:** they type its ID (e.g. `t2-q07`) or a few words from the stem; search the stems and confirm the match if there's more than one.

## 3. Show the questions

Display the selection grouped by topic, then subtopic, **10 questions per batch** (then "show the next 10?"). One block per question, answers shown:

```
t2-q07 · Round Robin · Understand · Multiple choice (single answer)
In round robin, what happens if the time quantum is made very large?
  A. Context-switch overhead becomes too high
  B. RR behaves the same as FCFS                ✓
  C. Low-priority processes starve
  D. RR becomes SJF
  Source: L03-CPU-Scheduling.pptx, slide 6
```

Mark every correct option ✓ (several for multi-select). Show only what's there; don't comment on quality unless asked.

Then ask which questions to change. Accept any of:
- IDs from the batch (`t2-q07, t2-q09`),
- a rule over the selection ("every Recall question in CPU Scheduling → Apply"),
- "none, next batch" / "done".

## 4. Choose the change, per question

For each chosen question, ask two things with `AskUserQuestion`:

**a) Level:** Recall · Understand · Apply · Analyze, with the current level labelled "(current)". The free-text "Other" answer is for a specific sentence the user writes, which becomes the new question as closely as the materials allow. Picking the current level means only the format changes.

**b) Format:** Multiple choice (single answer) · Multiple choice (multi-select) · True / False · Keep current. **First work out whether the new level forces a format change**, and put that option first, marked "(Recommended)" with the reason in its description:

| New level / content | What it usually needs |
|---|---|
| Apply with a computed answer (a waiting time, a speedup) | Single answer with near-miss numeric distractors, or True/False about one computed claim. Multi-select rarely fits. |
| Analyze a *why* or *which consequence* | Single answer; True/False only if one consequence can be stated as a clean true/false claim. |
| Recall or Understand over a list or set in the materials | Multi-select fits well; single answer also works. |
| A custom sentence | Infer its level from what the student must do, tag it, and pick the format the sentence implies ("Which of the following…" with a set → multi-select; a statement → True/False). |

It also works the other way: changing only the format can change the level. Converting a multi-select about a list into True/False on one member usually drops Understand to Recall. Say so, and retag.

When the materials can't support the requested combination, e.g. multi-select where the source gives only one correct item, or Apply where the materials have no procedure to apply, say why and offer the nearest option that works. Never make something up to fill the gap.

## 5. Rewrite

For each change, write the new item following the parent's item schema and item-writing standards:
- **Scope lock:** the new stem, answer and explanation must come from the materials. Reuse the old excerpt when it still supports the answer. Otherwise pick a new excerpt, verbatim, from `source_pages` in `work/exam.json`. If the passage needed isn't embedded (only cited pages ± 1 are), read the original in `sources/` and add that page's text to `source_pages`.
- **Format rules:** `mcq` has 4 options and one answer. `msq` has 4–5 options, ≥2 correct, ≥1 incorrect, and a sorted `answer` list. `tf` has `["True", "False"]` and a single-claim statement as the stem. The explanation covers why the answer is right, plus the tempting distractor (or, for `msq`, each wrong option).
- **Keep:** `topic`, `subtopic`, `concept`, `concept_label` (unless the concept truly changed; ask first).
- **New ID, retire the old one:** give the rewrite a new ID, `<old id>-r1` (`-r2` if revised again), set `added_in` to the new version, and **remove the old item** from `items`. Past mock-exam results stay in the student's browser and still count toward scores and mastery; only the old wording drops out of those attempts' answer review. The rewrite starts fresh and shows a "New" badge until attempted.

Only change what the user picked. Don't touch other questions, even ones that look weak.

## 6. Confirm, then rebuild

1. Show each change as **before → after** in the same block format as step 3, including the new level and format and any consequential change (e.g. "format change also moves this from Understand to Recall"). Ask once: apply all · adjust some · cancel.
2. Bump `manifest.version` and add a changelog entry, e.g. `"Revised 3 questions: t2-q07 → Apply, t2-q09 → multi-select, t3-q02 → rewritten."`
3. Rebuild in place, keeping the exam's own UI:
   `python3 <skill>/scripts/build.py work/exam.json --into <ClassCode>/<file>.html`
   Fix every `ERROR`. Report `WARN` lines (e.g. True/False balance shifted) without fixing other questions to balance them, unless the user asks.
4. Run `python3 <skill>/scripts/test_exam.py <ClassCode>/<file>.html`. If a check fails only because of a difference the project already had, say so (parent rule) instead of changing the project.

## 7. Reply

List each revised question: old ID → new ID, level before → after, format before → after, one-line summary of the new stem. Say the file was rebuilt in place and that past results for the old questions still count toward mastery. Don't paste answers into the reply beyond what the user already saw in step 6.
