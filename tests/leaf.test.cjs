// Run: node --test tests/leaf.test.cjs
// Dependency-free regression tests using Node's built-in test runner.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8');
const from = html.indexOf('<script>') + 8;
const js = html.slice(from, html.indexOf('</script>', from));

function between(start, end) {
  const a = js.indexOf(start);
  assert.ok(a >= 0, 'Missing start marker: ' + start);
  const b = js.indexOf(end, a + start.length);
  assert.ok(b >= 0, 'Missing end marker: ' + end);
  return js.slice(a, b);
}

test('valid JavaScript and an exact black preset', () => {
  assert.doesNotThrow(() => new Function(js));
  assert.match(html, /body\[data-theme="black"\]\s*\{\s*--bg:#000000/);
  assert.ok(html.includes('caret-color: rgb(200, 200, 200)'));
  assert.ok(html.includes("font-family: 'iAWriterMonoS', monospace"));
  assert.ok(html.includes('<option value="black">black</option>'));
});

test('statusbar disappears only when all configured metrics are disabled', () => {
  const source = between('function applyStatusBarVisibility() {', "\n\n['chk-show-words'");
  const ids = ['chk-show-words','chk-show-chars','chk-show-lines','chk-show-readtime','chk-show-cursor'];
  const nodes = Object.fromEntries(ids.map(id => [id, {checked:false}]));
  for (const id of ['word-count','char-count','line-count','cursor-pos'])
    nodes[id] = {style:{display:''}};
  let empty = false;
  nodes.statusbar = {classList:{toggle(name, visible){if(name==='statusbar-empty')empty=visible}}};
  const apply = new Function('document','updateStats',source+';return applyStatusBarVisibility;')(
    {getElementById:id => nodes[id]}, () => {}
  );
  apply();
  assert.equal(empty, true);
  assert.equal(nodes['word-count'].style.display, 'none');
  nodes['chk-show-words'].checked = true;
  apply();
  assert.equal(empty, false);
  nodes['chk-show-words'].checked = false;
  nodes['chk-show-readtime'].checked = true;
  apply();
  assert.equal(empty, false);
});

test('writing hint can be hidden and shown', () => {
  const source = between('function applyPlaceholderVisibility() {',
    "\ndocument.getElementById('chk-show-placeholder').addEventListener");
  const editor = {placeholder:'old'};
  const checkbox = {checked:false};
  const apply = new Function('editor','document',source+';return applyPlaceholderVisibility;')(
    editor,{getElementById:()=>checkbox}
  );
  apply();assert.equal(editor.placeholder, '');
  checkbox.checked = true;
  apply();assert.match(editor.placeholder, /Start writing/);
});

test('whole workspace saves and restores several files', () => {
  const save = between('function persistWorkspace() {','\nfunction scheduleWorkspaceSave()');
  const restore = between('function restoreWorkspace() {','\nfunction markDirty()');
  const data = {};
  const localStorage = {
    getItem:k => data[k] || null,
    setItem:(k,v) => {data[k]=v},
    removeItem:k => {delete data[k]}
  };
  const tabs = [
    {id:8,name:'one.md',content:'# One',dirty:true},
    {id:42,name:'two.md',content:'# Two',dirty:false}
  ];
  const persistSetup =
    "let tabs=deps.tabs,activeTabId=42,workspaceSaveTimer=null,storageWarningShown=false;" +
    "const WORKSPACE_KEY='leaf-workspace-v1',AUTOSAVE_KEY='leaf-autosave',localStorage=deps.localStorage;" +
    "const clearTimeout=()=>{};" +
    "function saveActiveTabState(){tabs.find(t=>t.id===activeTabId).content='# Two updated';}" +
    "function alert(msg){throw Error(msg);}";
  new Function('deps',persistSetup+save+';persistWorkspace();')({tabs,localStorage});
  const snapshot = JSON.parse(data['leaf-workspace-v1']);
  assert.equal(snapshot.tabs.length, 2);
  assert.equal(snapshot.tabs[0].content, '# One');
  assert.equal(snapshot.tabs[1].content, '# Two updated');
  assert.equal(snapshot.activeTabId, 42);
  const restoreSetup =
    "let tabs=[],activeTabId=1,nextTabId=2,fileHandle=null,isDirty=false,lastSavedContent='';" +
    "const WORKSPACE_KEY='leaf-workspace-v1',localStorage=deps.localStorage;" +
    "const editor={value:'',readOnly:false},document={getElementById:()=>({value:''})};" +
    "const currentMode='write';" +
    "function getActiveTab(){return tabs.find(t=>t.id===activeTabId)}" +
    "function seedMilestones(){} function updateStats(){} function renderTabs(){} function renderPreview(){}";
  const result = new Function('deps',restoreSetup+restore+
    ';const ok=restoreWorkspace();return {ok,tabs,activeTabId,nextTabId,editor,fileHandle};')({localStorage});
  assert.equal(result.ok, true);
  assert.equal(result.tabs.length, 2);
  assert.equal(result.activeTabId, 42);
  assert.equal(result.nextTabId, 43);
  assert.equal(result.editor.value, '# Two updated');
  assert.equal(result.fileHandle, null);
});

test('preferences and workspace restore are wired to boot', () => {
  assert.ok(html.includes('id="chk-show-words"'));
  assert.ok(html.includes('id="chk-show-placeholder"'));
  assert.ok(js.includes("showWords:    document.getElementById('chk-show-words').checked"));
  assert.ok(js.includes("showPlaceholder: document.getElementById('chk-show-placeholder').checked"));
  assert.ok(js.includes('if (s.showWords === false)'));
  assert.ok(js.includes('if (s.showPlaceholder === false)'));
  assert.ok(js.includes('if (!restoreWorkspace()) restoreAutosave();'));
});
