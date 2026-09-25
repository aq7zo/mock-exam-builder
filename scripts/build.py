#!/usr/bin/env python3
"""
Mock Exam Builder — build.py
============================
Turns exam content (JSON) into ONE self-contained HTML file:
templates/base.html + design-system/tokens.css + components.css + templates/app.js,
with the manifest, encoded item bank and encoded source pages embedded.

Standard library only (Python 3.8+).

USAGE
-----
    python3 scripts/build.py <exam.json> [--out-dir DIR] [--out FILE]
                             [--context 1] [--key KEY] [--no-verify] [--strict]

    python3 scripts/build.py examples/sample-content/exam.json --out-dir /tmp/out
    python3 scripts/build.py CSOPESY/build/exam.json --out-dir CSOPESY

    --out-dir DIR   folder to write into (default: current folder). The file name is
                    always <class_code>-mock-<term>-exam.html unless --out is given.
    --out FILE      exact output path (overrides --out-dir naming).
    --context N     pages of context embedded either side of each cited page (default 1).
    --key KEY       XOR key for the bank (default: random). Obfuscation only.
    --no-verify     skip the item-bank verification (NOT recommended).
    --strict        treat verification warnings as errors.
    --lint-only     only lint the design system and exit.
    --into HTML     (update workflow) refill an EXISTING exam file with the new content, keeping its own
                    styles, runtime and page shell exactly as they are (writes back to that file unless
                    --out is given). Use this for every rebuild of an existing project.
    --check-ui HTML report whether an existing exam's inlined styles and runtime still match the skill's
                    design-system/ and templates/app.js. Read-only; it changes nothing.
    --extract HTML  (update workflow) decode an existing exam file back into exam.json:
                    python3 scripts/build.py --extract CSOPESY/CSOPESY-mock-midterms-exam.html > work/exam.json
                    Gives the manifest, full items (answers included) and the embedded page text.
                    Keep that JSON in the working directory, never inside the class folder.

INPUT FORMAT (exam.json)
------------------------
{
  "manifest": {
    "exam_id": "uuid", "class_code": "CSOPESY", "term": "midterms",
    "title": "CSOPESY Mock Midterms Exam", "version": 1, "generated": "2026-09-25",
    "exam_length": 100, "timer_minutes": null, "coverage": "all",
    "sources": [{"file": "L02-Processes.pdf", "hash": "sha256…", "type": "pdf", "pages": 14, "added_in": 1}],
    "topics": [{"id": "t1", "name": "Processes", "subtopics": ["…"], "concepts": [{"id": "t1.pcb", "label": "…"}],
                "weight": 0.3, "exam_quota": 30, "added_in": 1}],
    "changelog": [{"version": 1, "date": "2026-09-25", "summary": "First build."}]
  },
  "items": [ { item schema from SKILL.md } ],
  "source_pages": { "L02-Processes.pdf": { "1": "page text…", "2": "…" } },
  "footer": "optional footer text"
}

source_pages may contain every page; build.py keeps only cited pages ± --context.
build.py adds to each manifest source: citations (question count), cited_pages, topics.

WHAT IT DOES
------------
1. Lints the design system (no hex / px font sizes in components.css).
2. Verifies the bank (errors stop the build): ids, types, options, answer index,
   topics, sources in coverage, excerpt verbatim on the cited page, duplicate stems,
   quotas vs exam_length and bank size. Warnings: answer-position balance,
   True/False balance, concepts without items, level mix.
3. Splits each item into public fields + an encoded secret (answer, explanation,
   source), encodes bank and pages (UTF-8 → XOR key → base64).
4. Fills the template slots, inlines CSS + JS, writes one .html file.
5. Checks the output: no external CSS/JS/fonts, no answers/explanations/excerpts
   in plain text, only the permitted inline style (--pct).
"""
import argparse
import base64
import difflib
import html
import json
import random
import re
import string
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "templates" / "base.html"
APP_JS = ROOT / "templates" / "app.js"
TOKENS = ROOT / "design-system" / "tokens.css"
COMPONENTS = ROOT / "design-system" / "components.css"

PUBLIC_FIELDS = ["id", "topic", "subtopic", "concept", "concept_label", "type", "level", "difficulty", "stem", "options", "added_in"]
LEVELS = {"recall", "understand", "apply", "analyze"}


class BuildError(Exception):
    pass


# ── Encoding ───────────────────────────────────────────────────────────────
def encode(obj, key):
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    k = key.encode("ascii")
    x = bytes(b ^ k[i % len(k)] for i, b in enumerate(raw))
    return base64.b64encode(x).decode("ascii")


def wrap(b64, width=120):
    return "\n".join(b64[i:i + width] for i in range(0, len(b64), width))


# ── Lint ───────────────────────────────────────────────────────────────────
def lint_design_system():
    problems = []
    css = COMPONENTS.read_text(encoding="utf-8")
    body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"#[0-9a-fA-F]{3,8}\b", body):
        problems.append(f"components.css: raw hex color {m.group(0)}")
    for m in re.finditer(r"font-size:\s*[0-9.]+px", body):
        problems.append(f"components.css: px font size '{m.group(0)}'")
    for m in re.finditer(r"font-family:(?!\s*var\()", body):
        problems.append("components.css: font-family not from a token")
    tokens = TOKENS.read_text(encoding="utf-8")
    if ':root[data-theme="dark"]' not in tokens:
        problems.append("tokens.css: missing dark-mode override")
    defined = set(re.findall(r"(--[a-z0-9-]+)\s*:", tokens))
    used = set(re.findall(r"var\((--[a-z0-9-]+)", body))
    local = {"--pct"}
    for v in sorted(used - defined - local):
        problems.append(f"components.css uses undefined token {v}")
    return problems


# ── Verification ───────────────────────────────────────────────────────────
def norm_ws(s):
    return re.sub(r"\s+", " ", s).strip()


def verify(manifest, items, pages):
    errors, warnings = [], []
    req = ["exam_id", "class_code", "term", "title", "version", "generated", "exam_length", "sources", "topics"]
    for k in req:
        if k not in manifest:
            errors.append(f"manifest: missing '{k}'")
    if errors:
        return errors, warnings
    if manifest["term"] not in ("midterms", "finals"):
        errors.append("manifest.term must be 'midterms' or 'finals'")
    if not re.fullmatch(r"[A-Z0-9]+", str(manifest["class_code"])):
        errors.append("manifest.class_code must be uppercase letters/digits, no spaces")

    topics = {t["id"]: t for t in manifest["topics"]}
    sources = {s["file"]: s for s in manifest["sources"]}
    ids = Counter(it.get("id") for it in items)
    for i, n in ids.items():
        if n > 1:
            errors.append(f"duplicate item id {i}")

    stems = defaultdict(list)
    per_topic = Counter()
    concepts_with_items = set()
    mcq_pos = Counter()
    yn = Counter()
    msq_n = Counter()  # msq items by number of correct options
    level_mix = Counter()
    for it in items:
        iid = it.get("id", "?")
        for f in ["id", "topic", "concept", "type", "level", "stem", "options", "answer", "explanation", "source"]:
            if f not in it:
                errors.append(f"{iid}: missing '{f}'")
        if any(f not in it for f in ["topic", "type", "options", "answer", "source"]):
            continue
        if it["topic"] not in topics:
            errors.append(f"{iid}: unknown topic {it['topic']}")
        per_topic[it["topic"]] += 1
        concepts_with_items.add(it["concept"])
        level_mix[it.get("level")] += 1
        if it.get("level") not in LEVELS:
            errors.append(f"{iid}: level must be one of {sorted(LEVELS)}")
        t = it["type"]
        opts = it["options"]
        if t == "mcq":
            if not (3 <= len(opts) <= 4):
                errors.append(f"{iid}: mcq needs 4 options (3 only when the material supports no more)")
            if len(set(map(norm_ws, opts))) != len(opts):
                errors.append(f"{iid}: duplicate options")
            if any(re.search(r"\b(all|none) of the above\b", o, re.I) for o in opts):
                warnings.append(f"{iid}: 'all/none of the above' — only if the materials use that style")
            mcq_pos[it["answer"]] += 1
        elif t == "msq":
            a = it["answer"]
            if not (4 <= len(opts) <= 5):
                errors.append(f"{iid}: msq needs 4 or 5 options")
            if len(set(map(norm_ws, opts))) != len(opts):
                errors.append(f"{iid}: duplicate options")
            if any(re.search(r"\b(all|none) of the above\b", o, re.I) for o in opts):
                errors.append(f"{iid}: msq must not use 'all/none of the above'")
            if not (isinstance(a, list) and all(type(x) is int and 0 <= x < len(opts) for x in a) and a == sorted(set(a))):
                errors.append(f"{iid}: msq answer must be a sorted list of unique option indexes")
            elif not (2 <= len(a) < len(opts)):
                errors.append(f"{iid}: msq needs at least 2 correct and at least 1 incorrect option")
            msq_n[len(a) if isinstance(a, list) else 0] += 1
        elif t == "tf":
            if opts != ["True", "False"]:
                errors.append(f"{iid}: tf options must be exactly [\"True\", \"False\"]")
            yn[it["answer"]] += 1
        elif t == "yesno":  # legacy: still renders, but new banks use tf
            warnings.append(f"{iid}: legacy yesno item; rewrite it as a True/False statement (type tf)")
        else:
            errors.append(f"{iid}: type must be 'mcq', 'msq' or 'tf' (got {t})")
        if t != "msq" and (type(it["answer"]) is not int or not (0 <= it["answer"] < len(opts))):
            errors.append(f"{iid}: answer index out of range")
        stems[norm_ws(it["stem"]).lower()].append(iid)

        src = it["source"]
        f, pg, ex = src.get("file"), src.get("page"), src.get("excerpt", "")
        if f not in sources:
            errors.append(f"{iid}: source file '{f}' is not in manifest.sources (coverage)")
            continue
        if not isinstance(pg, int):
            errors.append(f"{iid}: source.page must be an integer")
            continue
        text = pages.get(f, {}).get(str(pg))
        if text is None:
            errors.append(f"{iid}: no extracted text for {f} page {pg}")
        elif not ex:
            errors.append(f"{iid}: empty excerpt")
        elif ex not in text:
            hint = " (matches only after whitespace normalisation — copy it exactly)" if norm_ws(ex) in norm_ws(text) else ""
            errors.append(f"{iid}: excerpt not found verbatim on {f} page {pg}{hint}")
        if not src.get("loc"):
            warnings.append(f"{iid}: source.loc missing (e.g. 'p. 12', 'slide 7')")

    for s, group in stems.items():
        if len(group) > 1:
            errors.append(f"duplicate stem in {', '.join(group)}")

    quota_sum = 0
    for tid, t in topics.items():
        q = t.get("exam_quota", 0)
        quota_sum += q
        if q < 3:
            warnings.append(f"topic {tid}: exam_quota {q} is below the minimum of 3")
        if per_topic[tid] < q:
            errors.append(f"topic {tid}: bank has {per_topic[tid]} items but exam_quota is {q}")
        elif per_topic[tid] < 2 * q:
            warnings.append(f"topic {tid}: bank {per_topic[tid]} < 2× quota {q} (fine if the material supports no more)")
        for c in t.get("concepts", []):
            if c["id"] not in concepts_with_items:
                warnings.append(f"concept {c['id']} has no items (note the reason)")
    if quota_sum != manifest["exam_length"]:
        errors.append(f"topic quotas sum to {quota_sum}, but exam_length is {manifest['exam_length']}")

    if mcq_pos:
        n = sum(mcq_pos.values())
        k = max(len(it["options"]) for it in items if it.get("type") == "mcq")
        for pos in range(k):
            share = mcq_pos[pos] / n
            if share < 0.5 / k or share > 1.6 / k:
                warnings.append(f"MCQ answer position {'ABCD'[pos]} is {share:.0%} of answers — rebalance")
    if yn:
        n = sum(yn.values())
        if n >= 4 and abs(yn[0] - yn[1]) / n > 0.3:
            warnings.append(f"True/False answers unbalanced: {yn[0]} True vs {yn[1]} False")
    if sum(msq_n.values()) >= 4 and len(msq_n) == 1:
        warnings.append(f"every multi-select item has {next(iter(msq_n))} correct options — vary it so the count isn't a giveaway")
    return errors, warnings


# ── Assemble ───────────────────────────────────────────────────────────────
def enrich_manifest(manifest, items):
    by_file = defaultdict(lambda: {"n": 0, "pages": set(), "topics": []})
    for it in items:
        s = it["source"]
        d = by_file[s["file"]]
        d["n"] += 1
        d["pages"].add(s["page"])
        if it["topic"] not in d["topics"]:
            d["topics"].append(it["topic"])
    course = [t["id"] for t in manifest["topics"]]
    for s in manifest["sources"]:
        d = by_file.get(s["file"], {"n": 0, "pages": set(), "topics": []})
        s["citations"] = d["n"]
        s["cited_pages"] = sorted(d["pages"])
        s["topics"] = sorted(d["topics"], key=course.index)
        s.setdefault("type", s["file"].rsplit(".", 1)[-1].lower())
    return manifest


def trim_pages(pages, items, context):
    keep = defaultdict(set)
    for it in items:
        s = it["source"]
        for p in range(s["page"] - context, s["page"] + context + 1):
            keep[s["file"]].add(str(p))
    out = {}
    for f, pmap in pages.items():
        kept = {p: t for p, t in pmap.items() if p in keep.get(f, set())}
        if kept:
            out[f] = dict(sorted(kept.items(), key=lambda kv: int(kv[0])))
    return out


def skill_ui():
    """The styles and runtime a fresh build inlines: tokens.css + components.css (fonts inlined) and app.js."""
    styles = TOKENS.read_text(encoding="utf-8").rstrip() + "\n\n" + COMPONENTS.read_text(encoding="utf-8").rstrip()
    # Inline design-system/fonts/*.woff2 as data: URIs so the file needs no network.
    styles = re.sub(r'url\("fonts/([^"]+\.woff2)"\)', lambda m: 'url("data:font/woff2;base64,'
                    + base64.b64encode((TOKENS.parent / "fonts" / m.group(1)).read_bytes()).decode() + '")', styles)
    return styles, APP_JS.read_text(encoding="utf-8")


def file_ui(doc):
    """The inlined styles and runtime of an existing exam file."""
    st = re.search(r"<style>\n(.*?)\n</style>", doc, re.S)
    sc = re.findall(r"<script>\n(.*?)\n</script>", doc, re.S)
    if not st or not sc:
        raise BuildError("not a mock exam file: no inlined <style> / runtime <script>")
    return st.group(1), sc[-1]


def shell_of(doc):
    """The page shell (base.html markup: icon sprite, top bar, main, footer, dialog) with every content slot,
    the styles and the runtime emptied, so a filled exam and templates/base.html compare like for like."""
    doc = re.sub(r"<!--\s*\n\s*Mock Exam Builder — page shell.*?-->\n", "", doc, count=1, flags=re.S)
    for pat, rep in ((r'<html lang="[^"]*">', '<html lang="">'), (r"<title>.*?</title>", "<title></title>"),
                     (r'(<meta name="description" content=")[^"]*', r"\1"), (r"<style>\n.*?\n</style>", "<style></style>"),
                     (r'(<span class="topbar__title">).*?(</span>)', r"\1\2"), (r'(<div id="app">).*?(\s*</div>\s*</main>)', r"\1\2"),
                     (r'(<footer class="footer"[^>]*>).*?(</footer>)', r"\1\2"),
                     (r'(<script id="(?:exam-manifest|exam-bank|source-pages)")[^>]*>.*?</script>', r"\1></script>"),
                     (r"<script>\n.*?\n</script>", "<script></script>")):
        doc = re.sub(pat, rep, doc, flags=re.S)
    return doc


def check_ui(path):
    """Report whether an existing exam still uses the skill's current page shell, design system and runtime. Read-only."""
    doc = Path(path).read_text(encoding="utf-8")
    report = []
    parts = zip(("page shell (base.html)", "styles (tokens.css + components.css)", "runtime (app.js)"),
                (shell_of(doc),) + file_ui(doc), (shell_of(TEMPLATE.read_text(encoding="utf-8")),) + skill_ui())
    for label, mine, skill in parts:
        if mine == skill:
            report.append(f"MATCH  {label}")
            continue
        diff = list(difflib.unified_diff(skill.splitlines(), mine.splitlines(), "skill", "project", n=0, lineterm=""))
        changed = sum(1 for d in diff if d[:1] in "+-" and d[:3] not in ("+++", "---"))
        report.append(f"DIFFER {label}: {changed} line(s) differ from the skill")
        report += ["       " + d[:160] for d in diff[2:42]]
        if len(diff) > 42:
            report.append("       …")
    return report


def fill_existing(doc, manifest, key, data, foot):
    """Swap only the content (manifest, bank, page text, title, default footer) into an existing exam file,
    keeping its own styles, runtime and page shell exactly as they are."""
    def swap(pattern, new, required=True):
        nonlocal doc
        doc, n = re.subn(pattern, lambda m: new, doc, count=1, flags=re.S)
        if required and not n:
            raise BuildError(f"not a mock exam file: missing {pattern[:40]}")
    swap(r'<script id="exam-manifest"[^>]*>.*?</script>', f'<script id="exam-manifest" type="application/json">{data["manifest"]}</script>')
    swap(r'<script id="exam-bank"[^>]*>.*?</script>', f'<script id="exam-bank" type="application/octet-stream" data-k="{key}">{data["bank"]}</script>')
    swap(r'<script id="source-pages"[^>]*>.*?</script>', f'<script id="source-pages" type="application/octet-stream">{data["source_pages"]}</script>')
    title = html.escape(manifest["title"])
    swap(r"<title>.*?</title>", f"<title>{title}</title>", False)
    swap(r'<span class="topbar__title">.*?</span>', f'<span class="topbar__title">{title}</span>', False)
    # Refresh the footer only if it is still the generated one; a customised footer is the project's own.
    swap(r'<footer class="footer">[^<]*· version \d+ · generated [^<]*</footer>', f'<footer class="footer">{html.escape(foot)}</footer>', False)
    return doc


def build(content, key=None, context=1, footer=None, into=None):
    """Build a fresh exam from the skill's templates, or, with `into` (an existing exam's HTML),
    refill that file's content and keep its UI untouched."""
    manifest = json.loads(json.dumps(content["manifest"]))
    items = content["items"]
    pages = {f: {str(k): v for k, v in pm.items()} for f, pm in content.get("source_pages", {}).items()}
    key = key or "".join(random.SystemRandom().choice(string.ascii_letters + string.digits) for _ in range(24))

    manifest = enrich_manifest(manifest, items)
    bank = []
    for it in items:
        pub = {k: it[k] for k in PUBLIC_FIELDS if k in it}
        pub["s"] = encode({"answer": it["answer"], "explanation": it["explanation"], "source": it["source"]}, key)
        bank.append(pub)
    pages_used = trim_pages(pages, items, context)

    manifest_json = json.dumps(manifest, ensure_ascii=False, indent=1).replace("</", "<\\/")
    foot = footer if footer is not None else content.get(
        "footer", f"{manifest['title']} · version {manifest['version']} · generated {manifest['generated']} · built only from the files in sources/")
    data = {"manifest": manifest_json, "bank": wrap(encode({"items": bank}, key)), "source_pages": wrap(encode(pages_used, key))}
    if into is not None:
        return fill_existing(into, manifest, key, data, foot), manifest

    styles, script = skill_ui()
    if "</script" in script.lower():
        raise BuildError("app.js must not contain '</script'")

    term_label = "Finals" if manifest["term"] == "finals" else "Midterms"
    loading = ('    <div class="page"><div class="empty"><span class="empty__title">Loading your exam…</span>'
               '<noscript>This review tool needs JavaScript. Open the file in a current browser (Chrome, Edge, Firefox or Safari).</noscript></div></div>')
    slots = {
        "lang": content.get("lang", "en"),
        "title": html.escape(manifest["title"]),
        "description": html.escape(f"{manifest['class_code']} {term_label.lower()} mock exam and practice quizzes built from class materials."),
        "class_code": html.escape(manifest["class_code"]),
        "styles": styles,
        "content": loading,
        "footer": html.escape(foot),
        "manifest": data["manifest"],
        "bank": data["bank"],
        "bank_key": key,
        "source_pages": data["source_pages"],
        "script": script,
    }
    out = TEMPLATE.read_text(encoding="utf-8")
    # Strip the template's authoring comment so it isn't shipped in every exam.
    out = re.sub(r"<!--\s*\n\s*Mock Exam Builder — page shell.*?-->\n", "", out, count=1, flags=re.S)
    for k, v in slots.items():
        out = out.replace("{{" + k + "}}", v)
    left = re.findall(r"\{\{[a-z_]+\}\}", out)
    if left:
        raise BuildError(f"unfilled template slots: {sorted(set(left))}")
    return out, manifest


def check_output(doc, items, project_ui=False):
    """Errors that stop the write. With project_ui (a rebuild --into an existing file), inline styles belong to
    the project's own UI, so they are returned as notes instead of errors."""
    problems, notes = [], []
    if re.search(r"<link[^>]+rel=[\"']?stylesheet", doc, re.I):
        problems.append("external stylesheet <link> found")
    if re.search(r"<script[^>]+src=", doc, re.I):
        problems.append("external <script src> found")
    if re.search(r"@import|url\(\s*['\"]?https?:", doc, re.I):
        problems.append("external CSS import/url found")
    if re.search(r"(src|href)=[\"']https?://", doc, re.I):
        problems.append("external src/href found")
    bad_styles = [m for m in re.findall(r'style="([^"]*)"', doc) if not re.fullmatch(r"--pct: [^;\"]+", m)]
    bad_styles += [m for m in re.findall(r"style=\\?\"([^\"]*)", doc) if m and not m.startswith("--pct")]
    if bad_styles:
        (notes if project_ui else problems).append(f"inline styles other than --pct: {bad_styles[:3]}")
    for it in items:
        for label, text in (("explanation", it["explanation"]), ("excerpt", it["source"]["excerpt"])):
            if len(text) >= 24 and text in doc:
                problems.append(f"{it['id']}: {label} visible as plain text")
    return problems, notes


def extract(path):
    doc = Path(path).read_text(encoding="utf-8")
    key = re.search(r'id="exam-bank"[^>]*data-k="([^"]+)"', doc).group(1)

    def dec(b64):
        raw = base64.b64decode(re.sub(r"\s+", "", b64))
        return json.loads(bytes(b ^ ord(key[i % len(key)]) for i, b in enumerate(raw)).decode("utf-8"))

    manifest = json.loads(re.search(r'id="exam-manifest"[^>]*>(.*?)</script>', doc, re.S).group(1).replace("<\\/", "</"))
    for s in manifest.get("sources", []):
        for k in ("citations", "cited_pages", "topics"):
            s.pop(k, None)
    items = []
    for it in dec(re.search(r'id="exam-bank"[^>]*>(.*?)</script>', doc, re.S).group(1))["items"]:
        secret = dec(it.pop("s"))
        items.append({**it, **secret})
    pages = dec(re.search(r'id="source-pages"[^>]*>(.*?)</script>', doc, re.S).group(1))
    return {"manifest": manifest, "items": items, "source_pages": pages}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a self-contained mock exam HTML file.")
    ap.add_argument("content", nargs="?", help="exam.json")
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--out")
    ap.add_argument("--context", type=int, default=1)
    ap.add_argument("--key")
    ap.add_argument("--no-verify", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--lint-only", action="store_true")
    ap.add_argument("--extract", metavar="HTML")
    ap.add_argument("--into", metavar="HTML")
    ap.add_argument("--check-ui", metavar="HTML")
    a = ap.parse_args(argv)

    if a.extract:
        print(json.dumps(extract(a.extract), ensure_ascii=False, indent=1))
        return 0
    if a.check_ui:
        print("\n".join(check_ui(a.check_ui)))
        return 0
    into = Path(a.into).read_text(encoding="utf-8") if a.into else None
    lint = [] if into is not None else lint_design_system()  # --into ships the project's CSS, not the skill's
    for p in lint:
        print("LINT  ", p)
    if a.lint_only or lint:
        if lint:
            print("\nFix the design-system lint problems above (tokens only in components.css).")
        return 1 if lint else 0
    if not a.content:
        ap.error("content JSON is required")
    content = json.loads(Path(a.content).read_text(encoding="utf-8"))

    if not a.no_verify:
        errors, warnings = verify(content["manifest"], content["items"], {f: {str(k): v for k, v in pm.items()} for f, pm in content.get("source_pages", {}).items()})
        for w in warnings:
            print("WARN  ", w)
        for e in errors:
            print("ERROR ", e)
        if errors or (a.strict and warnings):
            print(f"\nBuild stopped: {len(errors)} error(s), {len(warnings)} warning(s).")
            return 1

    doc, manifest = build(content, key=a.key, context=a.context, into=into)
    problems, notes = check_output(doc, content["items"], project_ui=into is not None)
    for p in notes:
        print("NOTE  ", p, "(project's own UI, kept)")
    for p in problems:
        print("OUTPUT", p)
    if problems:
        return 1

    name = f"{manifest['class_code']}-mock-{manifest['term']}-exam.html"
    out = Path(a.out) if a.out else Path(a.into) if a.into else Path(a.out_dir) / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    kb = out.stat().st_size / 1024
    topics = Counter(it["topic"] for it in content["items"])
    print(f"OK    wrote {out} ({kb:.0f} KB)")
    print(f"      bank {len(content['items'])} items · exam {manifest['exam_length']} items · {len(manifest['sources'])} sources")
    for t in manifest["topics"]:
        print(f"      {t['id']:<6} {t['name'][:40]:<40} bank {topics[t['id']]:>3} · exam {t['exam_quota']:>3}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BuildError as e:
        print("ERROR ", e)
        sys.exit(1)
