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

test('actual localStorage settings round-trip restores font, theme and hidden UI options', () => {
  const source = between('function saveSettings() {', "\n['theme-select'].forEach");
  const data = {};
  const storage = {
    getItem:key => data[key] || null,
    setItem:(key,value) => {data[key]=value}
  };
  const ids = [
    'theme-select','settings-font-select','settings-font-size-select',
    'chk-welcome','color-bg','color-text','color-accent',
    'hex-bg','hex-text','hex-accent',
    'chk-show-words','chk-show-placeholder','chk-show-chars',
    'chk-show-lines','chk-show-readtime','chk-show-cursor',
    'btn-pin-tabs','btn-autohide','chk-crt','custom-colors','chk-smart-punct'
  ];
  const nodes = Object.fromEntries(ids.map(id => [id, {
    value:'', checked:true, style:{}, classList:{
      add(){},remove(){},toggle(){}
    }
  }]));
  const vars = {};
  const root = {dataset:{}, style:{setProperty:(key,value)=>{vars[key]=value}}};
  const body = {dataset:{},classList:{contains:()=>false,remove(){}}};
  const document = {getElementById:id=>nodes[id],documentElement:root,body};
  const init = "const SETTINGS_KEY='leaf-editor-settings',localStorage=deps.storage,document=deps.document;" +
    "let autohideEnabled=false,tabBarPinned=false,scrollSynced=true,smartPunctEnabled=false;" +
    "function workspaceNotice(){} function applyCustomColors(){}" +
    "function updatePinIcon(){} function updateSyncIcon(){}" +
    "function applyStatusBarVisibility(){} function syncThemeUI(){}";
  const settings = new Function('deps',init+source+';return {saveSettings,loadSettings};')({storage,document});
  nodes['theme-select'].value='black';
  nodes['settings-font-select'].value="'Open Sans', Arial, sans-serif";
  nodes['settings-font-size-select'].value='22';
  nodes['chk-show-words'].checked=false;
  nodes['chk-show-placeholder'].checked=false;
  nodes['chk-show-chars'].checked=false;
  nodes['chk-show-lines'].checked=false;
  nodes['chk-show-readtime'].checked=false;
  nodes['chk-show-cursor'].checked=false;
  settings.saveSettings();
  assert.ok(data['leaf-editor-settings']);
  nodes['theme-select'].value='paper';
  nodes['settings-font-select'].value='Arial, Helvetica, sans-serif';
  nodes['settings-font-size-select'].value='14';
  for (const id of ['chk-show-words','chk-show-placeholder','chk-show-chars',
    'chk-show-lines','chk-show-readtime','chk-show-cursor']) nodes[id].checked=true;
  settings.loadSettings();
  assert.equal(nodes['theme-select'].value,'black');
  assert.equal(body.dataset.theme,'black');
  assert.equal(nodes['settings-font-select'].value,"'Open Sans', Arial, sans-serif");
  assert.equal(vars['--editor-font'],"'Open Sans', Arial, sans-serif");
  assert.equal(nodes['settings-font-size-select'].value,'22');
  assert.equal(nodes['chk-show-words'].checked,false);
  assert.equal(nodes['chk-show-placeholder'].checked,false);
  assert.equal(nodes['chk-show-cursor'].checked,false);
});

test('settings order, responsive layout and unobtrusive backup control', () => {
  const modal = html.split('<!-- Settings Modal -->')[1].split('<!-- About Modal -->')[0];
  const sections = [...modal.matchAll(/<h3>([^<]+)<\/h3>/g)].map(item => item[1]);
  assert.equal(sections.join(','), 'Current document,Appearance,Status bar,Editor');
  assert.ok(modal.includes('id="workspace-recovery-row" class="settings-recovery" hidden'));
  assert.ok(modal.includes('aria-label="Restore latest recovery copy"'));
  assert.ok(!modal.includes('title="Restore a separately saved workspace'));
  assert.ok(html.includes('max-height: calc(100dvh - 24px)'));
  assert.ok(html.includes('overflow-y: auto'));
  assert.ok(html.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  assert.ok(html.includes('#settings-modal .settings-recovery[hidden] { display: none; }'));
  assert.ok(html.includes('overflow-wrap: anywhere'));
});

test('recovery button appears only for valid backups; invalid copies do not block others', () => {
  const source = between('function availableWorkspaceRecoveries() {',
    "document.getElementById('btn-recover-workspace').addEventListener('click'");
  const entries = {};
  const container = {
    hidden:true, span:{textContent:''},
    querySelector(){return this.span}
  };
  const storage = {
    get length(){return Object.keys(entries).length},
    key:index=>Object.keys(entries)[index],
    getItem:key=>entries[key]||null
  };
  const code =
    "const WORKSPACE_CONFLICT_PREFIX='leaf-workspace-conflict-',localStorage=deps.storage;" +
    "const document={getElementById:()=>deps.container};" +
    source + ';return {availableWorkspaceRecoveries,refreshRecoveryControl};';
  const actions = new Function('deps', code)({storage,container});
  actions.refreshRecoveryControl();
  assert.equal(container.hidden,true);
  entries['leaf-workspace-conflict-corrupt']='not JSON';
  entries['leaf-workspace-conflict-valid']=JSON.stringify({
    savedAt:'2026-11-19T09:00:00Z',
    tabs:[{id:1,name:'draft.md',content:'safe'}]
  });
  actions.refreshRecoveryControl();
  assert.equal(container.hidden,false);
  assert.equal(actions.availableWorkspaceRecoveries().length,1);
  assert.match(container.span.textContent,/backup/);
  delete entries['leaf-workspace-conflict-valid'];
  actions.refreshRecoveryControl();
  assert.equal(container.hidden,true);
});

test('restoring a backup preserves the prior primary and writes recovered content to primary', () => {
  const source = between(
    "document.getElementById('btn-recover-workspace').addEventListener('click', () => {",
    '\nfunction markDirty()'
  );
  const original = JSON.stringify({tabs:[{id:1,name:'old.md',content:'Old'}],savedAt:'2026-11-19T08:00:00Z'});
  const backup = JSON.stringify({tabs:[{id:2,name:'new.md',content:'Recovered'}],savedAt:'2026-11-19T09:00:00Z'});
  const data = {'leaf-workspace-v1':original};
  const storage = {
    getItem:k=>data[k]||null,
    setItem:(k,v)=>{data[k]=v}
  };
  const modal = {style:{display:'flex'}};
  const btn = {handle:null,addEventListener(type,fn){this.handle=fn}};
  let state=JSON.parse(original),lastPayload=JSON.stringify(state);
  const notices=[];
  const code =
    "const WORKSPACE_KEY='leaf-workspace-v1',WORKSPACE_CONFLICT_PREFIX='leaf-workspace-conflict-';" +
    "const workspaceWriterId='session-123',localStorage=deps.storage;" +
    "let workspaceConflictMode=false,workspaceLastConflictPayload=null,workspaceLastPayload='prior';" +
    "const document={getElementById:id=>id==='btn-recover-workspace'?deps.btn:deps.modal};" +
    "const confirm=()=>true;" +
    "function availableWorkspaceRecoveries(){return [{raw:deps.backup,savedAt:'2026-11-19T09:00:00Z'}]}" +
    "function persistWorkspace(){if(!workspaceConflictMode){localStorage.setItem(WORKSPACE_KEY,JSON.stringify(deps.state.value));workspaceLastPayload=JSON.stringify(deps.state.value)}}" +
    "function restoreWorkspace(raw){deps.state.value=JSON.parse(raw);workspaceConflictMode=true;return true}" +
    "function workspaceNotice(message){deps.notices.push(message)}" +
    "function refreshRecoveryControl(){}" +
    source + ';return deps.btn.handle;';
  const holder={value:state};
  const click=new Function('deps',code)({storage,btn,modal,backup,state:holder,notices});
  click();
  assert.equal(JSON.parse(data['leaf-workspace-v1']).tabs[0].content,'Recovered');
  assert.equal(Object.keys(data).filter(k=>k.startsWith('leaf-workspace-conflict-before-restore-')).length,1);
  assert.equal(modal.style.display,'none');
  assert.ok(notices.some(x=>x.includes('Recovered draft restored')));
});

test('all persisted settings keys are included in a saved preferences record', () => {
  const source=between('function saveSettings() {','function loadSettings() {');
  const data={};
  const nodes=new Proxy({}, {get:(obj,key) => obj[key] || (obj[key]={value:'22',checked:false})});
  nodes['theme-select']={value:'black'};
  nodes['settings-font-select']={value:'Arial, Helvetica, sans-serif'};
  nodes['settings-font-size-select']={value:'22'};
  nodes['color-bg']={value:'#010203'};
  nodes['color-text']={value:'#aabbcc'};
  nodes['color-accent']={value:'#334455'};
  nodes['chk-show-words']={checked:false};
  nodes['chk-show-placeholder']={checked:false};
  nodes['chk-welcome']={checked:false};
  nodes['chk-crt']={checked:true};
  const document={
    getElementById:id=>nodes[id],
    body:{classList:{contains:()=>true}}
  };
  const storage={setItem:(key,value)=>{data[key]=value}};
  const prefix=
    "const SETTINGS_KEY='leaf-editor-settings',localStorage=deps.storage,document=deps.document;" +
    "let autohideEnabled=true,tabBarPinned=true,scrollSynced=false,smartPunctEnabled=true;" +
    "function workspaceNotice(){}";
  new Function('deps',prefix+source+';saveSettings();')({storage,document});
  const saved=JSON.parse(data['leaf-editor-settings']);
  const required=[
    'theme','font','fontSize','autohide','tabPinned','showWelcome','crtEnabled',
    'scrollSynced','customBg','customText','customAccent','smartPunct',
    'showWords','showPlaceholder','showChars','showLines','showReadtime','showCursor'
  ];
  assert.equal(required.every(key => Object.prototype.hasOwnProperty.call(saved,key)),true);
  assert.equal(saved.theme,'black');
  assert.equal(saved.font,'Arial, Helvetica, sans-serif');
  assert.equal(saved.customBg,'#010203');
  assert.equal(saved.autohide,true);
  assert.equal(saved.tabPinned,true);
  assert.equal(saved.scrollSynced,false);
  assert.equal(saved.smartPunct,true);
  assert.equal(saved.showWords,false);
  assert.equal(saved.showPlaceholder,false);
});

test('valid custom HEX input saves the choice; invalid input does not', () => {
  const source=between('// Sync color picker → hex input','// ── Font / Size');
  const nodes={};
  const fired={};
  for(const kind of ['bg','text','accent']) {
    for(const type of ['color-','hex-']) {
      const id=type+kind;
      nodes[id]={value:'#123456',addEventListener(event,cb){fired[id+':'+event]=cb}};
    }
  }
  let saves=0,applied=0;
  new Function('deps',
    "const document={getElementById:id=>deps.nodes[id]};" +
    "function saveSettings(){deps.saves.count++}" +
    "function applyCustomColors(){deps.applied.count++}" +
    source
  )({nodes,saves:{count:0},applied:{count:0}});
  // The registered listener must be present for each of the three colors.
  for(const kind of ['bg','text','accent'])
    assert.equal(typeof fired['hex-'+kind+':input'],'function');
  const saveCounter={count:0};
  const applyCounter={count:0};
  const registered={};
  for(const kind of ['bg','text','accent'])for(const type of ['color-','hex-']){
    const id=type+kind;
    nodes[id].addEventListener=(event,cb)=>{registered[id+':'+event]=cb};
  }
  new Function('deps',
    "const document={getElementById:id=>deps.nodes[id]};" +
    "function saveSettings(){deps.saved.count++}" +
    "function applyCustomColors(){deps.updated.count++}" +
    source
  )({nodes,saved:saveCounter,updated:applyCounter});
  nodes['hex-bg'].value='#aabbcc';
  registered['hex-bg:input']();
  assert.equal(nodes['color-bg'].value,'#aabbcc');
  assert.equal(saveCounter.count,1);
  assert.equal(applyCounter.count,1);
  nodes['hex-bg'].value='not-a-color';
  registered['hex-bg:input']();
  assert.equal(saveCounter.count,1);
  registered['hex-bg:blur']();
  assert.equal(nodes['hex-bg'].value,'#aabbcc');
});

test('GitHub Pages service worker prefers fresh HTML and keeps an offline fallback', () => {
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  assert.ok(sw.includes("const CACHE = 'leaf-lgg-v4'"));
  assert.ok(sw.includes("request.mode === 'navigate'"));
  assert.ok(sw.includes("fetch(request).then(response"));
  assert.ok(sw.includes("caches.match('./editor.html')"));
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
