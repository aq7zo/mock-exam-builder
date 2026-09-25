#!/usr/bin/env python3
"""
Headless test for a built mock exam (Playwright + Chromium).

USAGE
    python3 scripts/test_exam.py <path/to/CLASS-mock-term-exam.html> [--shots DIR]

Checks (per SKILL.md "Test before delivering"):
  - no console errors; home renders; only mcq/msq/tf; items decode
  - multi-select renders checkboxes, scores all-or-nothing (a partial pick is wrong), and is
    answered in practice with Check answer
  - mock exam draws exam_length with the manifest's per-topic quotas
  - Not sure / Skip never appears in the mock exam, always in practice
  - all-correct run scores 100%, all-wrong run scores 0%
  - mastery isolation: an all-wrong practice session changes nothing;
    a submitted mock exam does
  - recommended order = weakest first after a weak exam; practice puts focus items first
  - citations open the Sources view with the file selected and the excerpt marked
  - page text is hidden in Sources while an exam is in progress
  - answers / explanations / excerpts are not in the HTML as plain text
  - no horizontal scroll at 375px
With --shots, saves desktop + phone screenshots (light and dark) of each screen.
"""
import base64
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def decode(b64, key):
    raw = base64.b64decode(re.sub(r"\s+", "", b64))
    return json.loads(bytes(b ^ ord(key[i % len(key)]) for i, b in enumerate(raw)).decode("utf-8"))


def main():
    path = Path(sys.argv[1]).resolve()
    shots = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    doc = path.read_text(encoding="utf-8")
    key = re.search(r'id="exam-bank"[^>]*data-k="([^"]+)"', doc).group(1)
    bank_b64 = re.search(r'id="exam-bank"[^>]*>(.*?)</script>', doc, re.S).group(1)
    manifest = json.loads(re.search(r'id="exam-manifest"[^>]*>(.*?)</script>', doc, re.S).group(1))
    items = decode(bank_b64, key)["items"]
    secret = {it["id"]: decode(it["s"], key) for it in items}
    item = {it["id"]: it for it in items}
    fails = []

    def check(cond, msg):
        print(("PASS  " if cond else "FAIL  ") + msg)
        if not cond:
            fails.append(msg)

    check(all(it["type"] in ("mcq", "msq", "tf") for it in items), "only mcq / msq / tf items")
    msq_ids = {i for i, it in item.items() if it["type"] == "msq"}
    msq_seen = set()
    shot_done = set()

    def right(iid):
        a = secret[iid]["answer"]
        return a if isinstance(a, list) else [a]

    def wrong(iid):
        a = secret[iid]["answer"]
        # multi-select: every correct option but one, so passing the 0% check proves all-or-nothing scoring
        return a[:-1] if isinstance(a, list) else [(a + 1) % len(item[iid]["options"])]

    def pick(scope, iid, vals):
        if iid in msq_ids and iid not in msq_seen:
            msq_seen.add(iid)
            boxes = pg.locator(f"{scope} .options input[type=checkbox]").count()
            radios = pg.locator(f"{scope} .options input[type=radio]:not([value=skip])").count()
            check(boxes == len(item[iid]["options"]) and radios == 0, f"{iid}: multi-select renders checkboxes")
        for v in vals:
            pg.click(f'{scope} label.option:has(input[value="{v}"])')
    leaks = [i for i, s in secret.items() if (len(s["explanation"]) > 24 and s["explanation"] in doc) or s["source"]["excerpt"] in doc]
    check(not leaks, "answers/explanations/excerpts not in plain text")
    check(re.search(r"<link[^>]+stylesheet|<script[^>]+src=", doc) is None, "no external CSS/JS")

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(path.as_uri())
        pg.wait_for_selector("text=Topic mastery")

        def shot(name, full=True):
            if shots:
                pg.evaluate("document.getElementById('toast').setAttribute('data-show', 'false')")  # no leftover toast in reference shots
                pg.wait_for_timeout(300)
                pg.screenshot(path=str(shots / f"{name}.png"), full_page=full)

        shot("01-home-empty")

        def run_exam(correct):
            pg.click("[data-action=start-order]")
            pg.wait_for_selector(".reorder")
            if correct:
                shot("02-order")
            pg.click("[data-action=start-exam]")
            pg.wait_for_selector(".question")
            run = pg.evaluate("window.__mockExam.store().inProgress")
            if correct:
                shot("03-exam", full=False)
            for idx, iid in enumerate(run["items"]):
                pick(f"#q-{idx}", iid, right(iid) if correct else wrong(iid))
                if correct and iid in msq_ids and "msq" not in shot_done:
                    shot_done.add("msq")
                    shot("03b-exam-multi-select", full=False)
                pg.click(f'#q-{idx} label[for="c-{iid}-sure"]')
                if idx < len(run["items"]) - 1:
                    pg.click("[data-action=next]")
            pg.click(".split__main [data-action=submit-open]")
            pg.wait_for_selector("#dialog[open]")
            if correct:
                shot("04-submit-dialog", full=False)
            pg.click("[data-action=submit-confirm]")
            pg.wait_for_selector(".score-hero")
            return run

        # ---- Exam 1: all correct
        pg.click("[data-action=start-order]")
        pg.wait_for_selector(".reorder")
        pg.click("[data-action=start-exam]")
        pg.wait_for_selector(".question")
        run = pg.evaluate("window.__mockExam.store().inProgress")
        check(len(run["items"]) == manifest["exam_length"], f"exam draws {manifest['exam_length']} items")
        quotas_ok = all(len(s["items"]) == next(t["exam_quota"] for t in manifest["topics"] if t["id"] == s["topic"]) for s in run["sections"])
        check(quotas_ok, "per-topic quotas match manifest")
        check(pg.locator(".option--skip").count() == 0, "no Not sure / Skip in mock exam")
        # Sources locked during an exam
        pg.click("[data-action=home]")
        pg.click("[data-action=sources]")
        check(pg.locator(".viewer__page").count() == 0 and pg.locator("text=Page text is hidden").count() == 1, "sources page text hidden during exam")
        pg.click("[data-action=home]")
        pg.click("[data-action=discard]")
        pg.click("[data-action=discard-confirm]")

        run_exam(True)
        pct = pg.inner_text(".score-hero__value")
        check(pct.strip() == "100%", f"all-correct scores 100% (got {pct})")
        shot("05-results-perfect")

        # ---- Exam 2: all wrong
        pg.click("[data-action=home]")
        run_exam(False)
        pct = pg.inner_text(".score-hero__value")
        check(pct.strip() == "0%", f"all-wrong scores 0% (got {pct})")
        m_before = pg.evaluate("JSON.stringify(window.__mockExam.mastery())")
        o_before = pg.evaluate("JSON.stringify(window.__mockExam.recommendedOrder())")
        c_before = pg.evaluate("JSON.stringify(window.__mockExam.conceptStatus())")
        check(all(v["band"] == "weak" for v in json.loads(m_before).values()), "submitted mock exam changes mastery (all weak)")

        # ---- Exam 3: mixed (t1 correct, others wrong) for realistic screenshots
        pg.click("[data-action=home]")
        pg.click("[data-action=start-order]")
        pg.click("[data-action=start-exam]")
        pg.wait_for_selector(".question")
        run = pg.evaluate("window.__mockExam.store().inProgress")
        confs = ["sure", "guess"]
        for idx, iid in enumerate(run["items"]):
            tpos = [t["id"] for t in manifest["topics"]].index(item[iid]["topic"])
            good = tpos == 0 or idx % (tpos + 1) == 0  # first topic strong, later topics progressively weaker
            pick(f"#q-{idx}", iid, right(iid) if good else wrong(iid))
            pg.click(f'#q-{idx} label[for="c-{iid}-{confs[idx % 2]}"]')
            if idx % 5 == 0:
                pg.click(f'#q-{idx} [data-action=flag]')
            if idx < len(run["items"]) - 1:
                pg.click("[data-action=next]")
        pg.click(".split__main [data-action=submit-open]")
        pg.click("[data-action=submit-confirm]")
        pg.wait_for_selector(".score-hero")
        shot("06-results-mixed")
        check(msq_ids <= msq_seen, f"every multi-select item answered in a mock exam ({len(msq_seen & msq_ids)}/{len(msq_ids)})")
        order = pg.evaluate("window.__mockExam.recommendedOrder()")
        mm = pg.evaluate("window.__mockExam.mastery()")
        ranks = {"weak": 0, "review": 1, "none": 2, "solid": 3, "mastered": 4}
        check([ranks[mm[t]["band"]] for t in order] == sorted(ranks[mm[t]["band"]] for t in order), "recommended order is weakest first")

        # ---- Citation → sources
        pg.locator(".citation").first.click()
        pg.wait_for_selector(".viewer__page mark")
        check(pg.locator(".file[aria-current=true]").count() == 1, "citation highlights the cited file")
        check(pg.locator("mark#cited").count() == 1, "citation marks the excerpt")
        shot("07-sources", full=False)
        pg.click("[data-action=back]")
        pg.wait_for_selector(".score-hero")

        # ---- Practice isolation
        m_before = pg.evaluate("JSON.stringify(window.__mockExam.mastery())")
        o_before = pg.evaluate("JSON.stringify(window.__mockExam.recommendedOrder())")
        c_before = pg.evaluate("JSON.stringify(window.__mockExam.conceptStatus())")
        pg.click("[data-action=home]")
        pg.click("[data-action=picker]")
        pg.wait_for_selector("text=Focus areas")
        shot("08-practice-picker")
        weakest = order[0]
        pg.click(f'[data-action=practice-topic][data-topic="{weakest}"] >> nth=0')
        pg.wait_for_selector(".option--skip")
        check(pg.locator(".option--skip").count() == 1, "Not sure / Skip shown in practice")
        P = pg.evaluate("window.__mockExam.ui.prac")
        flags = pg.evaluate("(() => { const s = window.__mockExam.store(); const a = s.attempts[s.attempts.length-1]; const o = {}; a.items.forEach(r => { if (!r.result || r.conf === 'guess') o[r.concept] = true; }); return o; })()")
        focus_flags = [e["focus"] for e in P["queue"]]
        check(focus_flags == sorted(focus_flags, reverse=True) and any(focus_flags), "practice puts focus items first")
        first = True
        while pg.evaluate("window.__mockExam.ui.view") == "practice":
            e = pg.evaluate("window.__mockExam.ui.prac.queue[window.__mockExam.ui.prac.idx]")
            if not e["state"]:
                pick("#q-p", e["id"], wrong(e["id"]))
                if e["id"] in msq_ids:
                    check(pg.locator(".feedback").count() == 0, "practice multi-select waits for Check answer")
                    pg.click("[data-action=pcheck]")
                    check(pg.locator(".feedback--incorrect").count() == 1, "practice multi-select partial pick is incorrect")
                if first:
                    shot("09-practice-feedback", full=False)
                    first = False
            pg.click("[data-action=pnext]")
        pg.wait_for_selector("text=Session summary")
        shot("10-practice-summary")
        check(pg.evaluate("JSON.stringify(window.__mockExam.mastery())") == m_before, "practice leaves mastery unchanged")
        check(pg.evaluate("JSON.stringify(window.__mockExam.recommendedOrder())") == o_before, "practice leaves recommended order unchanged")
        check(pg.evaluate("JSON.stringify(window.__mockExam.conceptStatus())") == c_before, "practice leaves concept status unchanged")

        pg.click("[data-action=picker]")
        pg.click("[data-action=home]")
        shot("11-home-history")

        check(not errors, f"no console errors {errors[:3]}")

        # ---- Light is the default even when the OS prefers dark; dark comes only from the toggle
        oc = b.new_context(color_scheme="dark"); op = oc.new_page(); op.goto(path.as_uri())
        check(op.evaluate("document.documentElement.getAttribute('data-theme')") is None
              and op.evaluate("getComputedStyle(document.body).colorScheme") != "dark", "light by default when the OS prefers dark")
        oc.close()

        # ---- Phone width + dark mode screenshots (theme set the way the toggle saves it)
        store = pg.evaluate("localStorage.getItem('mockexam:' + " + json.dumps(manifest["exam_id"]) + ")")
        for scheme in ("light", "dark"):
            mctx = b.new_context(viewport={"width": 375, "height": 800}, device_scale_factor=2)
            mp = mctx.new_page()
            mp.goto(path.as_uri())
            mp.evaluate("([k, v, t]) => { localStorage.setItem(k, v); localStorage.setItem('mockexam:theme', t); }", ["mockexam:" + manifest["exam_id"], store, scheme])
            mp.reload()
            mp.wait_for_selector("text=Topic mastery")
            overflow = []
            def sw():
                return mp.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            if shots:
                mp.screenshot(path=str(shots / f"m-{scheme}-home.png"), full_page=True)
            overflow.append(("home", sw()))
            mp.locator(".row--link").first.click()
            mp.wait_for_selector(".score-hero")
            overflow.append(("results", sw()))
            if shots:
                mp.screenshot(path=str(shots / f"m-{scheme}-results.png"), full_page=True)
            mp.click("[data-action=home]")
            mp.click("[data-action=start-order]")
            overflow.append(("order", sw()))
            if shots:
                mp.screenshot(path=str(shots / f"m-{scheme}-order.png"), full_page=True)
            mp.click("[data-action=start-exam]")
            mp.wait_for_selector(".question")
            overflow.append(("exam", sw()))
            if shots:
                mp.screenshot(path=str(shots / f"m-{scheme}-exam.png"))
            mp.click("[data-action=drawer]")
            mp.wait_for_timeout(300)
            if shots:
                mp.screenshot(path=str(shots / f"m-{scheme}-drawer.png"))
            mp.click(".sidebar__close")
            mp.click("[data-action=home]")
            mp.click("[data-action=discard]")
            mp.click("[data-action=discard-confirm]")
            mp.click("[data-action=sources]")
            overflow.append(("sources", sw()))
            if shots:
                mp.screenshot(path=str(shots / f"m-{scheme}-sources.png"), full_page=True)
            check(all(o <= 0 for _, o in overflow), f"no horizontal scroll at 375px ({scheme}) {overflow}")
            if scheme == "dark" and shots:
                dp = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
                dp.goto(path.as_uri())
                dp.evaluate("([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('mockexam:theme', 'dark'); }", ["mockexam:" + manifest["exam_id"], store])
                dp.reload()
                dp.wait_for_selector("text=Topic mastery")
                dp.screenshot(path=str(shots / "d-dark-home.png"), full_page=True)
                dp.locator(".row--link").first.click()
                dp.wait_for_selector(".score-hero")
                dp.screenshot(path=str(shots / "d-dark-results.png"), full_page=True)
            mctx.close()
        b.close()

    print(f"\n{'ALL CHECKS PASSED' if not fails else str(len(fails)) + ' CHECK(S) FAILED'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
