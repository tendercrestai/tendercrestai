import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regression test for the one item PR #101's live verification missed
// (Nov 18, 2026): the project list never showed "Currently open" on the
// open project. The list renders once at init, when lastOpenedId is null,
// and the "All projects" back button called showProjects(), which showed
// the dashboard without re-rendering the list, so the stale init-time
// list was what the user saw on every return. The fix makes
// showProjects() re-render the list. The shipped functions are extracted
// from assets/workspace.mjs and run against stubbed DOM helpers, the same
// pattern as the checklist-labels test: on the old code the list after
// open-then-back still has no "Currently open" label.

const root = new URL("../", import.meta.url);

function makeEl(tag, text) {
  const el = {
    tag, textContent: text ?? '', children: [], dataset: {}, className: '',
    value: '', checked: false, type: '', href: '', rel: '', target: '',
    disabled: false, hidden: false,
    append(...kids) { this.children.push(...kids); return this; },
    appendChild(k) { this.children.push(k); return k; },
    replaceChildren(...kids) { this.children = kids; return this; },
    setAttribute() {}, addEventListener() {}, querySelector() { return null; },
    scrollIntoView() {}, click() {}, select() {},
    onsubmit: null, onclick: null, oninput: null, onchange: null,
  };
  return el;
}

const ALPHA = {id: "aaaaaaaa-1111-1111-1111-111111111111", title: "Alpha project", updated_at: "2026-11-18T10:00:00.000Z"};
const BETA = {id: "bbbbbbbb-2222-2222-2222-222222222222", title: "Beta project", updated_at: "2026-11-17T10:00:00.000Z"};

async function loadHarness() {
  const source = await readFile(new URL("assets/workspace.mjs", root), "utf8");
  const lines = source.split("\n");
  const find = (prefix) => {
    const line = lines.find((l) => l.startsWith(prefix));
    assert.ok(line, prefix + " must exist in assets/workspace.mjs");
    return line;
  };
  const projectsLine = find("async function projects(page=0){");
  const openLine = find("async function open(id){");
  const showProjectsLine = find("function showProjects(){");
  const deleteLine = find("async function deleteProject(){");

  let serverProjects = [ALPHA, BETA];
  let failList = false;
  const calls = [];
  const messages = [];
  const byId = {};
  const $ = (id) => (byId[id] ||= makeEl("div"));
  const api = async (body) => {
    calls.push(body);
    if (body.action === "list") {
      if (failList) throw Error("List failed.");
      return {projects: serverProjects.map((p) => ({...p})), hasMore: false};
    }
    if (body.action === "get") return {project: {id: body.projectId, revision: 1, state: {title: "Alpha project"}}, role: "manager"};
    if (body.action === "delete") {
      serverProjects = serverProjects.filter((p) => p.id !== body.projectId);
      return {};
    }
    throw Error("unexpected action " + body.action);
  };
  const stubs = {
    node: (tag, text) => makeEl(tag, text),
    card: (parent, title) => { const c = makeEl("article", title); parent.append(c); return c; },
    button: (t) => makeEl("button", t),
    api,
    message: (t) => { messages.push(t); },
    render: () => {},
    history: {replaceState() {}},
    location: {pathname: "/workspace.html"},
    window: {scrollTo() {}},
  };
  const fn = new Function("$", "node", "card", "button", "api", "message",
    "render", "history", "location", "window",
    "let view=null,lastOpenedId=null,projectQuery='',orgFilter='',myOrgs=[],analysis=null;\n"
    + projectsLine + "\n" + openLine + "\n" + showProjectsLine + "\n" + deleteLine + "\n"
    + "return {projects,open,showProjects,deleteProject,getView:()=>view,getLastOpenedId:()=>lastOpenedId};")(
    $, stubs.node, stubs.card, stubs.button, stubs.api, stubs.message,
    stubs.render, stubs.history, stubs.location, stubs.window);
  return {
    ...fn, byId, calls, messages,
    setFailList: (v) => { failList = v; },
    serverProjects: () => serverProjects,
  };
}

function cards(h) {
  return (h.byId.projects?.children || []).filter((c) => c.tag === "article").map((c) => ({
    title: c.textContent,
    paras: c.children.filter((x) => x.tag === "p").map((x) => x.textContent),
    buttons: c.children.filter((x) => x.tag === "button").map((x) => x.textContent),
  }));
}

test("project list marks the open project after open then back", async () => {
  const h = await loadHarness();
  await h.projects();
  let list = cards(h);
  assert.equal(list.length, 2);
  assert.ok(list.every((c) => !c.paras.includes("Currently open")),
    "no card is marked open before any project is opened");
  assert.ok(list.every((c) => c.buttons.includes("Open project")),
    "both cards offer Open project at init");

  await h.open(ALPHA.id);
  assert.equal(h.getLastOpenedId(), ALPHA.id);
  await h.showProjects();
  assert.equal(h.byId.dashboard.hidden, false, "dashboard is shown again");
  assert.equal(h.byId.project.hidden, true, "project view is hidden again");
  list = cards(h);
  const alpha = list.find((c) => c.title === "Alpha project");
  const beta = list.find((c) => c.title === "Beta project");
  assert.ok(alpha, "Alpha card is listed");
  assert.ok(alpha.paras.includes("Currently open"),
    "the opened project is marked Currently open after going back");
  assert.ok(alpha.buttons.includes("Reopen project"),
    "the opened project offers Reopen project");
  assert.ok(!beta.paras.includes("Currently open"), "the other project is not marked open");
  assert.ok(beta.buttons.includes("Open project"), "the other project still offers Open project");
});

test("deleteProject re-renders the list without the deleted project", async () => {
  const h = await loadHarness();
  await h.projects();
  await h.open(ALPHA.id);
  await h.deleteProject();
  assert.ok(h.calls.some((c) => c.action === "delete" && c.confirm === "DELETE " + ALPHA.id),
    "the delete call carries its confirmation");
  const list = cards(h);
  assert.equal(list.length, 1, "only the surviving project is listed");
  assert.equal(list[0].title, "Beta project");
  assert.ok(list.every((c) => !c.paras.includes("Currently open")),
    "no card is marked open once the open project is deleted");
  assert.equal(h.messages.at(-1), "Project and its private copies deleted.");
});

test("showProjects surfaces a list failure instead of rejecting", async () => {
  const h = await loadHarness();
  await h.projects();
  h.setFailList(true);
  await h.showProjects();
  assert.equal(h.messages.at(-1), "List failed.");
  assert.equal(h.byId.dashboard.hidden, false, "the dashboard is still shown on a list failure");
});
