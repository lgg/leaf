// Run: node --test tests/leaf.test.cjs
// Zero dependency regression tests for the single-file editor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8');
const from = html.indexOf('<script>') + 8;
const js = html.slice(from, html.indexOf('</script>', from));

function between(start, end) {
  const a = js.indexOf(start);
  assert.ok(a >= 0, 'Missing marker: ' + start);
  const b = js.indexOf(end, a + start.length);
  assert.ok(b > a, 'Missing end marker: ' + end);
  return js.slice(a, b);
}

test('editor compiles; black colors, font presets and credits are present', () => {
  assert.doesNotThrow(() => new Function(js));
  assert.match(html, /body\[data-theme="black"\]\s*\{\s*--bg:#000000/);
  assert.ok(html.includes('caret-color: rgb(200, 200, 200)'));
  for (const font of ['Roboto Mono', 'Open Sans', 'Times New Roman', 'Arial']) {
    assert.ok(html.includes('>' + font + '</option>'), font);
  }
  assert.ok(html.includes('https://github.com/uncle-jasper/leaf'));
  assert.ok(html.includes('https://github.com/lgg/leaf'));
  assert.ok(html.includes('updated by'));
});

test('statusbar collapses only when all five counters are hidden', () => {
  const source = between('function applyStatusBarVisibility() {', "\n\n['chk-show-words'");
  const ids = ['chk-show-words','chk-show-chars','chk-show-lines','chk-show-readtime','chk-show-cursor'];
  const nodes = Object.fromEntries(ids.map(id => [id, {checked:false}]));
  for (const id of ['word-count','char-count','line-count','cursor-pos'])
    nodes[id] = {style:{display:''}};
  let hidden = false;
  nodes.statusbar = {classList:{toggle(name, value){if(name==='statusbar-empty')hidden=value}}};
  const apply = new Function('document','updateStats',source+';return applyStatusBarVisibility;')(
    {getElementById:id => nodes[id]}, () => {}
  );
  apply();
  assert.equal(hidden, true);
  assert.equal(nodes['word-count'].style.display, 'none');
  nodes['chk-show-words'].checked = true;
  apply();
  assert.equal(hidden, false);
  nodes['chk-show-words'].checked = false;
  nodes['chk-show-readtime'].checked = true;
  apply();
  assert.equal(hidden, false);
});

test('empty-page placeholder can be hidden or restored', () => {
  const source = between('function applyPlaceholderVisibility() {',
    "\ndocument.getElementById('chk-show-placeholder').addEventListener");
  const editor = {placeholder:'old'};
  const checkbox = {checked:false};
  const apply = new Function('editor','document',source+';return applyPlaceholderVisibility;')(
    editor,{getElementById:()=>checkbox}
  );
  apply();
  assert.equal(editor.placeholder, '');
  checkbox.checked = true;
  apply();
  assert.match(editor.placeholder, /Start writing/);
});

test('ZIP export keeps Unicode text and avoids duplicate Markdown filenames', async () => {
  const source = between('function getMarkdownExportEntries(', 'function exportAllMarkdown()');
  const funcs = new Function('TextEncoder','Blob',source + ';return {getMarkdownExportEntries,makeMarkdownZip,zipCrc32};')(TextEncoder,Blob);
  assert.equal(funcs.zipCrc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const files = funcs.getMarkdownExportEntries([
    {name:'idea.txt', content:'Привет, мир'},
    {name:'idea.md', content:'other'},
    {name:'draft', content:'# test'},
    {name:'README.txt', content:'internal doc', readonly:true}
  ]);
  assert.equal(files.length, 3);
  assert.equal(files[0].name, 'idea.md');
  assert.equal(files[1].name, 'idea (2).md');
  assert.equal(files[2].name, 'draft.md');
  const blob = funcs.makeMarkdownZip(files);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  let offset = 0;
  for (const file of files) {
    assert.equal(view.getUint32(offset,true), 0x04034b50);
    const len = view.getUint16(offset+26,true);
    const size = view.getUint32(offset+18,true);
    const encoded = bytes.slice(offset+30, offset+30+len);
    assert.equal(decoder.decode(encoded), file.name);
    assert.equal(decoder.decode(bytes.slice(offset+30+len,offset+30+len+size)),file.content);
    offset += 30+len+size;
  }
  assert.equal(view.getUint32(bytes.length-22,true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length-22+10,true),files.length);
});

test('autosave is bounded, avoids duplicate writes and isolates a conflicting window', () => {
  const source = between("const WORKSPACE_KEY = 'leaf-workspace-v1';",
    'function restoreWorkspace(');
  const data = {};
  let writes = 0;
  const storage = {
    getItem: k => data[k] || null,
    setItem(k,v) { data[k]=v; writes++; },
    removeItem(k) { delete data[k]; }
  };
  const timer = {now:1000, next:0, jobs:new Map()};
  const timers = {
    setTimeout(cb,ms) {
      const id=++timer.next;
      timer.jobs.set(id,{cb,ms});
      return id;
    },
    clearTimeout(id) {timer.jobs.delete(id);}
  };
  const base =
    "const WORKSPACE_KEY_OLD='none',AUTOSAVE_KEY='leaf-autosave';" +
    "let tabs=deps.tabs,activeTabId=2;" +
    "const localStorage=deps.storage;" +
    "const document={getElementById:()=>deps.notice};" +
    "const window={addEventListener:(type,fn)=>{deps.listeners[type]=fn}};" +
    "const crypto={randomUUID:()=>deps.id};" +
    "const Date=class extends globalThis.Date{static now(){return deps.timer.now}};" +
    "const setTimeout=deps.timers.setTimeout,clearTimeout=deps.timers.clearTimeout;" +
    "function saveActiveTabState(){tabs.find(t=>t.id===activeTabId).content=deps.editor.value;}";
  const make = deps => new Function('deps',base+source+
    ';return {persistWorkspace,scheduleWorkspaceSave};')(deps);
  const first = {tabs:[{id:2,name:'a.md',content:'',dirty:true}],
    editor:{value:'before'},storage,timer,timers,notice:{hidden:true},listeners:{},id:'first'};
  const a = make(first);
  for(let n=0;n<25;n++){
    timer.now += 100;
    first.editor.value += 'x';
    a.scheduleWorkspaceSave();
  }
  const latest = timer.jobs.get(timer.next);
  assert.equal(latest.ms,0); // At max-wait a flush is due immediately.
  latest.cb();
  assert.equal(writes,1);
  assert.equal(JSON.parse(data['leaf-workspace-v1']).tabs[0].content,first.editor.value);
  a.persistWorkspace();
  assert.equal(writes,1); // Closing immediately after the flush writes nothing.

  const second = {tabs:[{id:2,name:'b.md',content:'in second window',dirty:true}],
    editor:{value:'in second window'},storage,timer,timers,notice:{hidden:true,textContent:''},
    listeners:{},id:'second'};
  const b = make(second);
  b.persistWorkspace();
  assert.ok(data['leaf-workspace-v1'].includes('second window'));
  first.listeners.storage({key:'leaf-workspace-v1',newValue:data['leaf-workspace-v1']});
  assert.ok(data['leaf-workspace-conflict-first']);
  assert.ok(data['leaf-workspace-v1'].includes('second window'));
});

test('restoring workspace keeps independent labels, filenames and active tab', () => {
  const source = between('function restoreWorkspace(', 'function availableWorkspaceRecoveries()');
  const saved = JSON.stringify({activeTabId:42,version:2,tabs:[
    {id:8,name:'one.md',content:'A',label:'Work',browserTitle:'First',dirty:false},
    {id:42,name:'two.md',content:'B',label:'Private',browserTitle:'Browser B',dirty:true}
  ]});
  const store = {getItem:()=>saved};
  const filename = {value:''};
  const context =
    "let tabs=[],activeTabId=1,nextTabId=2,fileHandle=null,isDirty=false,lastSavedContent='';" +
    "let workspaceLastRaw=null,workspaceLastPayload=null,workspaceConflictMode=false,workspaceLastConflictPayload=null;" +
    "const WORKSPACE_KEY='leaf-workspace-v1',localStorage=deps.store;" +
    "const editor={value:'',readOnly:false},document={getElementById:()=>deps.filename};" +
    "const currentMode='write';" +
    "function getActiveTab(){return tabs.find(t=>t.id===activeTabId)}" +
    "function workspaceSnapshot(){return {activeTabId,tabs}}" +
    "function seedMilestones(){} function updateStats(){} function renderTabs(){}" +
    "function renderPreview(){} function syncDocumentTitles(){}";
  const recovered = new Function('deps',context+source+
    ';const ok=restoreWorkspace();return {ok,tabs,activeTabId,nextTabId,editor,fileHandle};')(
    {store,filename}
  );
  assert.equal(recovered.ok,true);
  assert.equal(recovered.tabs.length,2);
  assert.equal(recovered.activeTabId,42);
  assert.equal(recovered.nextTabId,43);
  assert.equal(recovered.tabs[1].label,'Private');
  assert.equal(recovered.tabs[1].browserTitle,'Browser B');
  assert.equal(recovered.editor.value,'B');
  assert.equal(recovered.fileHandle,null);
});

test('preferences, independent tab names, input edits and recovery are wired', () => {
  assert.ok(html.includes('id="settings-tab-label"'));
  assert.ok(html.includes('id="settings-browser-title"'));
  assert.ok(html.includes('id="btn-recover-workspace"'));
  assert.ok(html.includes('id="btn-export-all"'));
  assert.ok(js.includes("showWords:    document.getElementById('chk-show-words').checked"));
  assert.ok(js.includes("showPlaceholder: document.getElementById('chk-show-placeholder').checked"));
  assert.ok(js.includes('if (s.showWords === false)'));
  assert.ok(js.includes('if (s.showPlaceholder === false)'));
  assert.ok(js.includes("if (s.font) {"));
  assert.ok(js.includes("editor.addEventListener('input', noteEditorEdit)"));
  assert.ok(js.includes("window.addEventListener('pagehide', persistWorkspace)"));
  assert.ok(js.includes("const backups = availableWorkspaceRecoveries()"));
});
