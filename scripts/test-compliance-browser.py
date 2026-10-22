"""Offline UI integration checks; mocked auth/API, real Chromium and app modules.

Requires Python Playwright and Chromium. Never contacts live Supabase, OpenAI,
Airtable or Stripe. Run from the repository root:
  python scripts/test-compliance-browser.py
"""
import copy
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path("/tmp/tendercrest-compliance-browser")
ARTIFACTS.mkdir(exist_ok=True)
ORIGIN = "https://fixture.tendercrest.invalid"
ANALYSIS = "a3333333-3333-4333-8333-333333333333"
DOCUMENT = "a4444444-4444-4444-8444-444444444444"
QUOTE = "The vendor must provide three references."
actions, errors, checks = [], [], []
source = dict(document_id=DOCUMENT, document="Fictional RFP.txt",
              segment_id=DOCUMENT + ":0", page=None,
              section="Section L", quote=QUOTE)
workspace = {
    "analysis": {
        "id": ANALYSIS, "fingerprint": "a" * 64, "status": "Pending",
        "documents": [{"id": DOCUMENT, "name": "Fictional RFP.txt",
            "format": "txt", "warnings": [], "sha256": "b" * 64,
            "segments": [{"id": DOCUMENT + ":0", "document_id": DOCUMENT,
                          "page": None, "section": "Section L", "text": QUOTE}]}],
        "facts": [], "warnings": [], "processed": 0, "total_chunks": 1,
        "attempts": 0, "error_code": None, "created_at": "2026-10-01T00:00:00Z"
    },
    "requirements": [], "similar_pairs": []
}
row = dict(id="a5555555-5555-4555-8555-555555555555", requirement=QUOTE,
           original_requirement=QUOTE, category="Eligibility", mandatory="Yes",
           evaluation_weight=None, status="Needs Review", evidence="",
           evidence_reference="", response_owner="", comments="",
           recommendation="Provide company evidence.", sources=[source],
           uncertain=False, duplicate_count=0, revision=0)
second = copy.deepcopy(row)
second.update(id="a6666666-6666-4666-8666-666666666666",
              requirement="Technical evaluation weight: 40%.",
              original_requirement="Technical evaluation weight: 40%.",
              category="Evaluation", mandatory="No", evaluation_weight="40%",
              comments='<img src=x onerror="window.__xss=true">')
second["sources"] = [dict(source, section="Section M", quote=second["requirement"])]

SUPABASE = """
export function createClient() {
  const user={id:'a1111111-1111-4111-8111-111111111111',email:'fixture@example.invalid'};
  const chain={select(){return this},eq(){return this},
    async maybeSingle(){return {data:null,error:null}},
    async single(){return {data:{storage_path:'fixture/source.txt'},error:null}},
    async insert(){return {error:null}}};
  return {
    auth:{
      async getUser(){return {data:{user},error:null}},
      async getSession(){return {data:{session:{user,access_token:'fictional-token'}},error:null}},
      onAuthStateChange(callback){window.__authCallback=callback;return {data:{subscription:{unsubscribe(){}}}}}
    },
    from(){return chain},
    storage:{from(){return {
      async upload(){return {data:{},error:null}},
      async download(){return {data:new Blob(['Fictional original']),error:null}}
    }}}
  };
}
"""


def route_request(route):
    parsed = urlparse(route.request.url)
    if parsed.netloc == "cdn.jsdelivr.net" and "@supabase/supabase-js@" in parsed.path:
        route.fulfill(content_type="text/javascript", body=SUPABASE)
        return
    if parsed.netloc != "fixture.tendercrest.invalid":
        route.fulfill(content_type="text/css", body="")
        return
    if parsed.path == "/.netlify/functions/compliance-config":
        route.fulfill(json={"url": "https://fixture.supabase.co",
                           "key": "sb_publishable_fixture", "enabled": True})
        return
    if parsed.path == "/.netlify/functions/compliance":
        payload = route.request.post_data_json
        action = payload["action"]
        actions.append(action)
        if action == "list":
            result = {"analyses": []}
        elif action in ("prepare", "get"):
            result = workspace
        elif action == "step":
            assert payload["reviewed"] is True
            workspace["analysis"].update(status="Completed", processed=1)
            workspace["requirements"] = [copy.deepcopy(row), copy.deepcopy(second)]
            result = workspace
        elif action == "update":
            found = next(r for r in workspace["requirements"]
                         if r["id"] == payload["requirementId"])
            assert found["revision"] == payload["revision"]
            found.update(payload["changes"])
            found["revision"] += 1
            result = {"requirement": found}
        else:
            raise AssertionError("Unexpected API action: " + action)
        route.fulfill(json=copy.deepcopy(result))
        return
    assert not parsed.path.startswith("/.netlify/functions/"), parsed.path
    path = (ROOT / (parsed.path.lstrip("/") or "index.html")).resolve()
    assert path.is_relative_to(ROOT) and path.is_file(), path
    content_type = "text/javascript" if path.suffix == ".mjs" else (
        mimetypes.guess_type(str(path))[0] or "text/plain")
    route.fulfill(content_type=content_type, body=path.read_bytes())


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True,
                               args=["--no-sandbox", "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/*", route_request)
    page.goto(ORIGIN + "/compliance.html")
    expect(page.locator("#workspace")).to_be_visible()
    checks.append("authenticated workspace initialization")
    page.keyboard.press("Tab")
    expect(page.get_by_role("link", name="Skip to workspace")).to_be_focused()
    page.keyboard.press("Enter")
    checks.append("keyboard skip navigation")
    page.locator("#documents").set_input_files(str(ROOT / "tests/fixtures/fictional-rfp.txt"))
    page.locator("#prepare").click()
    expect(page.locator("#source-review")).to_be_visible()
    expect(page.locator("#source-documents")).to_contain_text(QUOTE)
    checks.append("upload and canonical source text review")
    page.locator("#analyze").click()
    expect(page.locator("#message")).to_contain_text("confirm")
    assert "step" not in actions
    checks.append("source review confirmation enforced")
    page.locator("#reviewed").check()
    page.locator("#analyze").click()
    expect(page.locator("#analysis-status")).to_have_text("Completed")
    expect(page.locator("#rows tr")).to_have_count(2)
    checks.append("analysis progress and matrix rendering")
    assert page.locator("#rows img").count() == 0
    assert page.evaluate("window.__xss === undefined")
    checks.append("untrusted reviewer text does not execute HTML")
    page.locator("#search").fill("references")
    expect(page.locator("#rows tr")).to_have_count(1)
    page.locator("#search").fill("")
    page.locator("#category").select_option("Evaluation")
    expect(page.locator("#rows tr")).to_have_count(1)
    page.locator("#category").select_option("")
    page.locator("#sort").select_option("mandatory")
    expect(page.locator("#rows tr").first).to_contain_text(QUOTE)
    checks.append("search, filtering and sorting")
    page.get_by_role("button", name="Verify source").first.click()
    expect(page.locator("#source-dialog")).to_be_visible()
    expect(page.locator("#source-content")).to_contain_text("Page unavailable")
    expect(page.locator("#source-content")).to_contain_text(QUOTE)
    page.locator("#close-source").click()
    checks.append("source verification dialog")
    page.get_by_role("button", name="Edit R0001", exact=True).click()
    expect(page.locator("#edit-requirement")).to_be_focused()
    page.keyboard.press("Escape")
    expect(page.locator("#edit-dialog")).not_to_be_visible()
    page.get_by_role("button", name="Edit R0001", exact=True).click()
    checks.append("native dialog focus and keyboard dismissal")
    page.locator("#edit-status").select_option("Compliant")
    page.locator("#save-row").click()
    expect(page.locator("#edit-error")).to_contain_text("Provide company evidence")
    assert "update" not in actions
    checks.append("Compliant requires human evidence and reference")
    page.locator("#edit-evidence").fill("Three signed fictional reference letters")
    page.locator("#edit-evidence-reference").fill("Company evidence packet, section 3")
    page.locator("#edit-owner").fill("Pat Reviewer")
    page.locator("#save-row").click()
    expect(page.locator("#edit-dialog")).not_to_be_visible()
    expect(page.locator("#rows tr").first).to_contain_text("Compliant")
    expect(page.locator("#metrics")).to_contain_text("50%")
    checks.append("saved review and evidence coverage")
    for control, filename in [("csv", "matrix.csv"), ("xlsx", "matrix.xlsx")]:
        with page.expect_download() as download:
            page.locator("#" + control).click()
        download.value.save_as(ARTIFACTS / filename)
        assert (ARTIFACTS / filename).stat().st_size > 100
    checks.append("CSV and Excel browser downloads")
    page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
    page.set_viewport_size({"width": 768, "height": 1024})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    page.screenshot(path=str(ARTIFACTS / "tablet.png"), full_page=True)
    checks.append("tablet page width and contained table scrolling")
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    page.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)
    checks.append("mobile page width and contained table scrolling")
    page.evaluate("window.__authCallback('SIGNED_OUT', null)")
    expect(page.locator("#workspace")).not_to_be_visible()
    expect(page.locator("#rows tr")).to_have_count(0)
    expect(page.locator("#source-documents")).to_be_empty()
    checks.append("sign-out clears sensitive workspace text")
    page.goto(ORIGIN + "/compliance.html?analysis=" + ANALYSIS)
    expect(page.locator("#rows tr")).to_have_count(2)
    page.locator("#continue").click()
    expect(page.locator("#rfp-content")).to_have_value(QUOTE)
    expect(page.locator("#proposal-qualifications")).to_have_value("")
    checks.append("existing proposal form handoff without submission")
    assert not errors, errors
    checks.append("no JavaScript page errors")
    browser.close()
print(json.dumps({"passed": len(checks), "checks": checks,
                  "api_actions": actions, "artifacts": str(ARTIFACTS)}, indent=2))
