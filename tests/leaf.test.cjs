// Run: node --test tests/leaf.test.cjs
// Zero dependency regression tests for the single-file editor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8').replace(/\r\n/g, '\n');
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
    'theme-select','settings-font-select','settings-font-size-input','settings-font-size-slider','chk-focus-header-autohide',
    'settings-ui-font-select','settings-ui-font-size-input','settings-ui-font-size-slider',
    'chk-welcome','color-bg','color-text','color-accent',
    'hex-bg','hex-text','hex-accent',
    'chk-show-words','chk-show-placeholder','chk-show-chars',
    'chk-show-lines','chk-show-readtime','chk-show-cursor',
    'btn-pin-tabs','btn-autohide','chk-crt','custom-colors','chk-smart-punct',
    'chk-mobile-heading','chk-mobile-status','chk-mobile-autohide',
    'chk-about-show-startup','chk-about-dont-show'
  ];
  const nodes = Object.fromEntries(ids.map(id => [id, {
    value:'', checked:true, style:{}, classList:{
      add(){},remove(){},toggle(){}
    }
  }]));
  const vars = {};
  const root = {dataset:{}, style:{setProperty:(key,value)=>{vars[key]=value}}};
  const body = {dataset:{},classList:{contains:()=>false,remove(){}}};
  nodes['settings-ui-font-select'].options=[{value:"'JetBrains Mono', monospace"},{value:'Arial, Helvetica, sans-serif'}];
  const document = {getElementById:id=>nodes[id],documentElement:root,body};
  const init = "const SETTINGS_KEY='leaf-editor-settings',localStorage=deps.storage,document=deps.document;" +
    "let autohideEnabled=false,tabBarPinned=false,scrollSynced=true,smartPunctEnabled=false;" +
    "let appliedFontSize=22,focusHeaderAutohideEnabled=true,appliedUiFontSize=17;" +
    "function applyFontSize(v){const n=Number(v);appliedFontSize=n;document.getElementById('settings-font-size-input').value=String(n);document.getElementById('settings-font-size-slider').value=String(Math.max(6,Math.min(128,n)));document.documentElement.style.setProperty('--font-size',n+'px');return true;}" +
    "function applyUiFontSize(v){const n=Number(v);appliedUiFontSize=n;document.getElementById('settings-ui-font-size-input').value=String(n);document.getElementById('settings-ui-font-size-slider').value=String(Math.max(6,Math.min(128,n)));document.documentElement.style.setProperty('--ui-font-size',n+'px');return true;}" +
    "function applyFocusHeaderAutohide(){focusHeaderAutohideEnabled=document.getElementById('chk-focus-header-autohide').checked;}" +
    "function workspaceNotice(){} function applyCustomColors(){}" +
    "function updatePinIcon(){} function updateSyncIcon(){}" +
    "function applyStatusBarVisibility(){} function syncThemeUI(){} function applyMobilePreferences(){}";
  const settings = new Function('deps',init+source+';return {saveSettings,loadSettings};')({storage,document});
  nodes['theme-select'].value='black';
  nodes['settings-font-select'].value="'Open Sans', Arial, sans-serif";
  nodes['settings-font-size-input'].value='22';
  nodes['settings-ui-font-select'].value='Arial, Helvetica, sans-serif';
  nodes['settings-ui-font-size-input'].value='17';
  nodes['settings-font-size-slider'].value='22';
  nodes['chk-focus-header-autohide'].checked=true;
  nodes['chk-show-words'].checked=false;
  nodes['chk-show-placeholder'].checked=false;
  nodes['chk-show-chars'].checked=false;
  nodes['chk-show-lines'].checked=false;
  nodes['chk-show-readtime'].checked=false;
  nodes['chk-show-cursor'].checked=false;
  nodes['chk-mobile-heading'].checked=true;
  nodes['chk-mobile-status'].checked=true;
  nodes['chk-mobile-autohide'].checked=false;
  nodes['chk-about-show-startup'].checked=true;
  settings.saveSettings();
  assert.ok(data['leaf-editor-settings']);
  nodes['theme-select'].value='paper';
  nodes['settings-font-select'].value='Arial, Helvetica, sans-serif';
  nodes['settings-font-size-input'].value='14';
  nodes['settings-ui-font-select'].value="'JetBrains Mono', monospace";
  nodes['settings-ui-font-size-input'].value='10';
  nodes['settings-font-size-slider'].value='14';
  nodes['chk-focus-header-autohide'].checked=false;
  for (const id of ['chk-show-words','chk-show-placeholder','chk-show-chars',
    'chk-show-lines','chk-show-readtime','chk-show-cursor']) nodes[id].checked=true;
  nodes['chk-mobile-heading'].checked=false;
  nodes['chk-mobile-status'].checked=false;
  nodes['chk-mobile-autohide'].checked=true;
  nodes['chk-about-show-startup'].checked=false;
  nodes['chk-about-dont-show'].checked=true;
  settings.loadSettings();
  assert.equal(nodes['theme-select'].value,'black');
  assert.equal(body.dataset.theme,'black');
  assert.equal(nodes['settings-font-select'].value,"'Open Sans', Arial, sans-serif");
  assert.equal(vars['--editor-font'],"'Open Sans', Arial, sans-serif");
  assert.equal(nodes['settings-font-size-input'].value,'22');
  assert.equal(nodes['settings-ui-font-select'].value,'Arial, Helvetica, sans-serif');
  assert.equal(nodes['settings-ui-font-size-input'].value,'17');
  assert.equal(vars['--ui-font-size'],'17px');
  assert.equal(nodes['settings-font-size-slider'].value,'22');
  assert.equal(nodes['chk-focus-header-autohide'].checked,true);
  assert.equal(vars['--font-size'],'22px');
  assert.equal(nodes['chk-show-words'].checked,false);
  assert.equal(nodes['chk-show-placeholder'].checked,false);
  assert.equal(nodes['chk-show-cursor'].checked,false);
  assert.equal(nodes['chk-mobile-heading'].checked,true);
  assert.equal(nodes['chk-mobile-status'].checked,true);
  assert.equal(nodes['chk-mobile-autohide'].checked,false);
  assert.equal(nodes['chk-about-show-startup'].checked,true);
  assert.equal(nodes['chk-about-dont-show'].checked,false);
  // 1.10.4's old "don't show" state must migrate without surprising the user.
  const migrated=JSON.parse(data['leaf-editor-settings']);
  delete migrated.showAboutOnStartup;
  migrated.skipAboutDialog=true;
  data['leaf-editor-settings']=JSON.stringify(migrated);
  settings.loadSettings();
  assert.equal(nodes['chk-about-show-startup'].checked,false);
  assert.equal(nodes['chk-about-dont-show'].checked,true);
  // First-time web visits are quiet, while first-time native Windows starts
  // show the welcome window unless disabled.
  delete data['leaf-editor-settings'];
  body.dataset.leafDesktop='';
  settings.loadSettings();
  assert.equal(nodes['chk-about-show-startup'].checked,false);
  body.dataset.leafDesktop='true';
  settings.loadSettings();
  assert.equal(nodes['chk-about-show-startup'].checked,true);
  assert.equal(nodes['chk-about-dont-show'].checked,false);
});

test('every settings tab, including About, responds to clicks and keyboard navigation', () => {
  const source=between('// ── Settings internal tabs and interface typography ─────',
    'let appliedUiFontSize = 12;');
  const names=['document','appearance','status','editor','mobile','about'];
  const controls={};
  const nodes={};
  for(const name of names) {
    const listeners={};
    const node={
      dataset:{settingsTab:name}, listeners, tabIndex:-1, attributes:{}, focused:false,
      classList:{toggle(cls,on){if(cls==='active')node.active=on}},
      setAttribute(k,v){node.attributes[k]=v},
      addEventListener(k,cb){listeners[k]=cb},
      focus(){node.focused=true}
    };
    controls[name]=node;
    nodes['settings-tab-'+name]=node;
    nodes['settings-panel-'+name]={hidden:true,scrollTop:44};
  }
  const document={
    querySelectorAll:selector => {
      assert.equal(selector,'#settings-tabs [data-settings-tab]');
      return names.map(n=>controls[n]);
    },
    getElementById:id=>nodes[id]
  };
  const actions=new Function('document',source+';return {selectSettingsTab,SETTINGS_TAB_NAMES};')(document);
  assert.deepEqual(actions.SETTINGS_TAB_NAMES,names);
  controls.about.listeners.click();
  assert.equal(nodes['settings-panel-about'].hidden,false);
  assert.equal(controls.about.attributes['aria-selected'],'true');
  assert.equal(controls.mobile.active,false);
  assert.equal(nodes['settings-panel-mobile'].hidden,true);
  assert.equal(nodes['settings-panel-about'].scrollTop,0);
  let prevented=false;
  controls.about.listeners.keydown({key:'ArrowRight',preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  assert.equal(nodes['settings-panel-document'].hidden,false);
  assert.equal(controls.document.focused,true);
  controls.document.listeners.keydown({key:'ArrowLeft',preventDefault(){}});
  assert.equal(nodes['settings-panel-about'].hidden,false);
  controls.mobile.listeners.keydown({key:'End',preventDefault(){}});
  assert.equal(nodes['settings-panel-about'].hidden,false);
  controls.about.listeners.keydown({key:'Home',preventDefault(){}});
  assert.equal(nodes['settings-panel-document'].hidden,false);
});

test('welcome startup preference and manual About action are independent', () => {
  const source=between('function showAboutDialog() {',
    "document.getElementById('chk-welcome').addEventListener");
  const nodes={};
  const create=(id)=>nodes[id]||(nodes[id]={checked:false,style:{display:'none'},textContent:''});
  const hooks={};const selected=[],saves={count:0},reads={count:0};
  const document={
    body:{dataset:{leafDesktop:'true'}},
    getElementById:create,
    querySelectorAll:()=>[]
  };
  const window={
    __TAURI__:{},
    addEventListener:(type,handler)=>{hooks[type]=handler}
  };
  const env=
    "const document=deps.document,window=deps.window,location={protocol:'file:'};" +
    "const justWriteActive=false;" +
    "function updateAboutLinkColor(){}" +
    "function selectSettingsTab(name){deps.selected.push(name)}" +
    "function saveSettings(){deps.saves.count++}" +
    "function openReadmeTab(){deps.reads.count++}";
  const actions=new Function('deps',env+source+
    ';return {showAboutDialog,openAboutSettings,setAboutStartupEnabled,refreshAboutEdition};')(
      {document,window,selected,saves,reads});
  assert.equal(typeof hooks.load,'function');
  create('chk-about-show-startup').checked=true;
  hooks.load();
  assert.equal(create('about-overlay').style.display,'flex');
  create('chk-about-dont-show').checked=true;
  create('chk-about-dont-show').listeners.change({target:{checked:true}});
  assert.equal(create('chk-about-show-startup').checked,false);
  assert.equal(saves.count,1);
  create('about-overlay').style.display='none';
  // Preference off must never disable manual access to original popup.
  create('btn-about').listeners.click();
  assert.equal(create('about-overlay').style.display,'flex');
  assert.equal(create('chk-about-dont-show').checked,true);
  create('chk-about-show-startup').listeners.change({target:{checked:true}});
  assert.equal(create('chk-about-dont-show').checked,false);
  assert.equal(saves.count,2);
  create('btn-about-settings').listeners.click();
  assert.equal(selected.at(-1),'about');
  assert.equal(create('settings-overlay').style.display,'flex');
  assert.equal(create('about-overlay').style.display,'none');
  assert.equal(create('about-install-type').textContent,'Desktop · Windows (detecting…)');
  assert.equal(create('about-dialog-install-type').textContent,'Desktop · Windows (detecting…)');
});

test('settings order, responsive layout and unobtrusive backup control', () => {
  const modal = html.split('<!-- Settings Modal -->')[1].split('<!-- About Modal -->')[0];
  const sections = [...modal.matchAll(/<h3>([^<]+)<\/h3>/g)].map(item => item[1]);
  assert.equal(sections.join(','), 'Current document,Appearance,Status bar,Editor,Leaf');
  const tabs=[...modal.matchAll(/data-settings-tab="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(tabs,['document','appearance','status','editor','mobile','about']);
  for (const id of tabs) assert.ok(modal.includes('id="settings-panel-'+id+'"'));
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
  nodes['settings-font-size-input']={value:'22'};
  nodes['settings-ui-font-select']={value:"'JetBrains Mono', monospace"};
  nodes['settings-ui-font-size-input']={value:'17'};
  nodes['chk-focus-header-autohide']={checked:true};
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
    "let appliedFontSize=22,focusHeaderAutohideEnabled=true,appliedUiFontSize=17;" +
    "function workspaceNotice(){}";
  new Function('deps',prefix+source+';saveSettings();')({storage,document});
  const saved=JSON.parse(data['leaf-editor-settings']);
  const required=[
    'theme','font','fontSize','uiFont','uiFontSize','autohide','focusHeaderAutohide','tabPinned','showWelcome','crtEnabled',
    'scrollSynced','customBg','customText','customAccent','smartPunct',
    'showWords','showPlaceholder','showChars','showLines','showReadtime','showCursor',
    'mobileHeading','mobileStatus','mobileAutohide','showAboutOnStartup'
  ];
  assert.equal(required.every(key => Object.prototype.hasOwnProperty.call(saved,key)),true);
  assert.equal(saved.theme,'black');
  assert.equal(saved.font,'Arial, Helvetica, sans-serif');
  assert.equal(saved.fontSize,'22');
  assert.equal(saved.uiFont,"'JetBrains Mono', monospace");
  assert.equal(saved.uiFontSize,'17');
  assert.equal(saved.focusHeaderAutohide,true);
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
  assert.ok(sw.includes("const CACHE = 'leaf-lgg-v12'"));
  assert.ok(sw.includes("request.mode === 'navigate'"));
  assert.ok(sw.includes("fetch(request).then(response"));
  assert.ok(sw.includes("caches.match('./editor.html')"));
});

test('fork version matches README, changelog and visible About version', () => {
  const version='1.10.5-lgg.1';
  const readme=fs.readFileSync(path.join(__dirname,'..','README.md'),'utf8').replace(/\r\n/g, '\n');
  const changelog=fs.readFileSync(path.join(__dirname,'..','CHANGELOG.md'),'utf8');
  assert.ok(html.includes('id="about-current-version">v'+version+'</strong>'));
  assert.ok(html.includes('id="about-star-github"'));
  assert.ok(html.includes('id="about-install-type"'));
  assert.ok(readme.includes('v'+version));
  assert.ok(changelog.includes('v'+version));
  assert.ok(changelog.includes('uncle-jasper/leaf'));
  const marker='const README_CONTENT = '+String.fromCharCode(96);
  const at=html.indexOf(marker)+marker.length;
  const end=html.indexOf(String.fromCharCode(96)+';\n\n// ── Just Write mode',at);
  assert.equal(html.slice(at,end).replace(/\\`/g, '`').replace(/\\\$\{/g, '${'), readme.trimEnd());
});

test('mobile markup is minimal, touch accessible and CSS overrides desktop', () => {
  const mobileHtml=html.slice(html.indexOf('<div id="mobile-dock"'),
    html.indexOf('<div id="workspace-warning"'));
  assert.ok(mobileHtml.includes('id="mobile-dock-trigger"'));
  assert.ok(mobileHtml.includes('aria-label="Show editing controls"'));
  for(const id of ['mobile-action-documents','mobile-action-view','mobile-action-save',
    'mobile-action-more','mobile-sheet-overlay','mobile-sheet-close']) {
    assert.ok(mobileHtml.includes('id="'+id+'"'),id);
  }
  for(const id of ['chk-mobile-heading','chk-mobile-status','chk-mobile-autohide','settings-filename'])
    assert.ok(html.includes('id="'+id+'"'),id);
  const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  const mobileAt=css.indexOf('/* Mobile: the writing surface is the interface.');
  const desktopSettingsAt=css.indexOf('#settings-modal {');
  assert.ok(mobileAt > desktopSettingsAt, 'mobile CSS must override desktop settings');
  assert.ok(css.includes('#header { display: none !important; }'));
  assert.ok(css.includes('#mobile-dock.mobile-visible #mobile-controls'));
  assert.ok(css.includes('body.mobile-show-heading #mobile-document-heading { display: block; }'));
  assert.ok(css.includes('body.mobile-show-status #statusbar:not(.statusbar-empty)'));
  assert.ok(css.includes('env(safe-area-inset-bottom'));
  assert.ok(css.includes('max-width: 1366px'));
  assert.ok(css.includes('min-height: 48px'));
});

test('mobile dock reveals by bottom tap, auto-hides and pauses in a sheet', () => {
  const code=between('// ── Mobile writing mode: no permanent chrome',
    '// ── Progressive Web App installation and offline cache');
  const timers=new Map(), nodes={}, onWindow={}, onDoc={}, onVisual={};
  const makeNode=(id='') => {
    const classes=new Set(), listeners={};
    const node={
      id, style:{setProperty(k,v){this[k]=v}},hidden:false,value:'',textContent:'',checked:false,children:[],
      classList:{
        add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),
        toggle:(k,on)=>{if(on===undefined ? !classes.has(k) : on) classes.add(k);else classes.delete(k)}
      },
      setAttribute(k,v){this[k]=v},
      addEventListener(k,fn){listeners[k]=fn},
      dispatch(k,event={}){return listeners[k]?.(event)},
      appendChild(child){this.children.push(child);return child},
      append(...children){this.children.push(...children)},
      replaceChildren(...children){this.children=children},
      querySelector(sel){return makeNode(sel)},
      focus(){},
      blur(){if(id==='editor') doc.activeElement=null;},
    };
    return node;
  };
  const getNode=id => nodes[id]||(nodes[id]=makeNode(id));
  const body=makeNode('body');
  const editor=makeNode('editor');
  const doc={
    body,activeElement:null,
    getElementById:getNode,
    createElement:tag=>makeNode(tag),
    addEventListener:(name,fn)=>{onDoc[name]=fn},
  };
  const win={
    innerHeight:750,
    matchMedia:()=>({matches:true}),
    visualViewport:{height:750,addEventListener:(name,fn)=>{onVisual[name]=fn}},
    addEventListener:(name,fn)=>{onWindow[name]=fn}
  };
  getNode('chk-mobile-autohide').checked=true;
  getNode('mobile-sheet-overlay').hidden=true;
  getNode('mobile-action-view').querySelector=()=>getNode('mobile-view-label');
  getNode('mobile-dock').classList.remove('mobile-visible');
  let pendingId=0;
  const setTimer=(fn,ms)=>{const id=++pendingId;timers.set(id,{fn,ms});return id};
  const clearTimer=id=>timers.delete(id);
  const setup=
    "const window=deps.win,document=deps.doc,editor=deps.editor;" +
    "let mobileSheetState=null,mobileDockTimer=null,mobileFullViewportHeight=0,mobileKeyboardVisible=false;" +
    "let currentMode='write',activeTabId=1,focusActive=false,justWriteActive=false;" +
    "let tabs=[{id:1,name:'first.md',content:'Hello',dirty:false},{id:2,name:'second.md',content:'Second',dirty:false}];" +
    "const setTimeout=deps.setTimer,clearTimeout=deps.clearTimer;" +
    "function saveSettings(){} function closeTab(){} function saveFile(){}" +
    "function getActiveTab(){return tabs.find(t=>t.id===activeTabId)}" +
    "function switchTab(id){activeTabId=id;} function newTab(){}" +
    "function setMode(mode){currentMode=mode;updateMobileModeButton()}" +
    "function exportAllMarkdown(){} function enterFocus(){} function exitFocus(){}";
  const api=new Function('deps',setup+code+
    ';return {setMobileDockVisible,showMobileSheet,closeMobileSheet,applyMobilePreferences,updateMobileKeyboardVisibility};')({
      win,doc,editor,setTimer,clearTimer
    });
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),false);
  getNode('mobile-dock-trigger').dispatch('click');
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),true);
  assert.equal(getNode('mobile-dock-trigger')['aria-expanded'],'true');
  const job=[...timers.values()].find(x=>x.ms===4200);
  assert.ok(job,'dock should close after idle delay');
  job.fn();
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),false);

  getNode('mobile-dock-trigger').dispatch('click');
  getNode('mobile-action-documents').dispatch('click');
  assert.equal(getNode('mobile-sheet-overlay').hidden,false);
  assert.equal(getNode('mobile-sheet-title').textContent,'Documents');
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),false);
  assert.ok(getNode('mobile-sheet-content').children.length>=3);
  getNode('mobile-sheet-close').dispatch('click');
  assert.equal(getNode('mobile-sheet-overlay').hidden,true);
  getNode('mobile-action-more').dispatch('click');
  assert.equal(getNode('mobile-sheet-title').textContent,'Actions');
  assert.equal(getNode('mobile-sheet-content').children.length,5);
  getNode('mobile-sheet-close').dispatch('click');
  getNode('chk-mobile-autohide').checked=false;
  api.applyMobilePreferences();
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),true);
  assert.equal([...timers.values()].some(x=>x.ms===4200),false);
  doc.activeElement=editor;
  win.visualViewport.height=400;
  onVisual.resize();
  assert.equal(body.classList.contains('mobile-keyboard-open'),true);
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),false);
  assert.equal(getNode('mobile-dock').style['--leaf-keyboard-bottom'],'350px');
  getNode('mobile-dock-trigger').dispatch('click');
  assert.equal(body.classList.contains('mobile-keyboard-open'),false);
  const reveal=[...timers.values()].find(x=>x.ms===180);
  assert.ok(reveal,'tap-to-dismiss should reveal the dock');
  reveal.fn();
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),true);
  win.visualViewport.height=750;
  onVisual.resize();
  assert.equal(body.classList.contains('mobile-keyboard-open'),false);
  assert.equal(getNode('mobile-dock').classList.contains('mobile-visible'),true);
});

test('mobile filename can be edited without desktop filename field visible', () => {
  const listenerMarker="document.getElementById('settings-filename').addEventListener('input', event => {";
  const source=between(listenerMarker,
    "for (const [id, property] of [['settings-tab-label','label']");
  const input={value:'',listener:null,addEventListener(event,fn){this.listener=fn}};
  const desktop={value:'untitled.txt'};
  const tab={id:1,name:'untitled.txt'};
  const elements={'settings-filename':input,'filename-input':desktop};
  let renders=0, saves=0;
  const prefix=
    "const document={getElementById:id=>deps.elements[id]};" +
    "function getActiveTab(){return deps.tab}" +
    "function renderTabs(){deps.renders.count++;deps.elements['settings-filename'].value=deps.tab.name}" +
    "function scheduleWorkspaceSave(){deps.saves.count++}";
  const renderCount={count:0}, saveCount={count:0};
  new Function('deps',prefix+source)(
    {elements,tab,renders:renderCount,saves:saveCount});
  input.value='my-notes.md';
  input.listener({target:input});
  assert.equal(tab.name,'my-notes.md');
  assert.equal(desktop.value,'my-notes.md');
  assert.equal(saveCount.count,1);
  input.value='';
  input.listener({target:input});
  assert.equal(tab.name,'untitled.md');
  assert.equal(input.value,''); // Do not trap users by replacing the field while typing.
  input.value='work.md';
  input.listener({target:input});
  assert.equal(tab.name,'work.md');
  assert.equal(desktop.value,'work.md');
  assert.equal(renderCount.count,3);
});

test('PWA manifest exposes stable app identity, standalone scope and valid icons', () => {
  const m=JSON.parse(fs.readFileSync(path.join(__dirname,'..','leaf.webmanifest'),'utf8'));
  assert.equal(m.id,'./editor.html');
  assert.equal(m.start_url,'./editor.html');
  assert.equal(m.scope,'./');
  assert.equal(m.display,'standalone');
  assert.ok(m.icons.some(icon => icon.sizes==='192x192'));
  assert.ok(m.icons.some(icon => icon.sizes==='512x512'));
});

test('PWA registration and browser install prompt are functional on HTTPS', async () => {
  const marker='// ── Progressive Web App installation and offline cache';
  const pos=js.indexOf(marker);
  assert.ok(pos>0);
  const installSource=js.slice(pos);
  const group={style:{display:'none'}};
  const button={style:{display:'none'}};
  const events={};
  const calls=[];
  const ctx={
    group,button,events,calls,
    navigator:{
      onLine:true,
      serviceWorker:{register:(file,opts)=>{
        calls.push({file,opts});
        return Promise.resolve({update:()=>Promise.resolve()});
      }}
    }
  };
  const globals=
    "const navigator=deps.navigator,location={protocol:'https:',hostname:'lgg.github.io'};" +
    "const document={body:{dataset:deps.bodyDataset||{}},getElementById:id=>id==='btn-install'?deps.button:deps.group};" +
    "const window={__TAURI__:deps.tauri,leafDesktop:deps.leafDesktop,addEventListener:(event,fn)=>{deps.events[event]=fn}};" +
    "const console={warn:()=>{}};";
  const app=new Function('deps',globals+installSource+';return {installPWA};')(ctx);
  assert.equal(typeof events.load,'function');
  events.load();
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls.length,1);
  assert.equal(calls[0].file,'./sw.js');
  assert.equal(calls[0].opts.scope,'./');
  let prevented=false, prompted=false;
  events.beforeinstallprompt({
    preventDefault(){prevented=true},
    async prompt(){prompted=true},
    userChoice:Promise.resolve({outcome:'accepted'})
  });
  assert.equal(prevented,true);
  assert.equal(button.style.display,'');
  await app.installPWA();
  assert.equal(prompted,true);
  assert.equal(button.style.display,'none');
  events.appinstalled();
  assert.equal(group.style.display,'none');
});

test('portable and installed native desktop suppress browser PWA install events', async () => {
  const marker='// ── Progressive Web App installation and offline cache';
  const source=js.slice(js.indexOf(marker));
  for(const desktop of [
    {bodyDataset:{leafDesktop:'true'}}, // stable staging marker, even before Tauri JS appears
    {tauri:{core:{}}},                   // fallback detection for native runtime
    {leafDesktop:{}}                     // fallback after desktop bridge initialization
  ]) {
    const events={},group={style:{display:'none'}},button={style:{display:'none'}};
    let registered=0, prompted=0, prevented=0;
    const deps={...desktop,events,group,button,navigator:{
      onLine:true,
      serviceWorker:{register:()=>{registered++;return Promise.resolve({update:()=>Promise.resolve()})}}
    }};
    const env=
      "const navigator=deps.navigator,location={protocol:'https:',hostname:'example.test'};" +
      "const document={body:{dataset:deps.bodyDataset||{}},getElementById:id=>id==='btn-install'?deps.button:deps.group};" +
      "const window={__TAURI__:deps.tauri,leafDesktop:deps.leafDesktop,addEventListener:(event,fn)=>{deps.events[event]=fn}};" +
      "const console={warn:()=>{}};";
    const api=new Function('deps',env+source+';return {installPWA,setLeafInstallVisible};')(deps);
    // WebView2 might send an install event even when the executable is portable.
    events.beforeinstallprompt({
      preventDefault(){prevented++},
      prompt(){prompted++;return Promise.resolve()},
      userChoice:Promise.resolve({outcome:'accepted'})
    });
    assert.equal(prevented,1);
    assert.equal(button.style.display,'none');
    assert.equal(group.style.display,'none');
    api.setLeafInstallVisible(true); // even other callers cannot reveal it
    assert.equal(button.style.display,'none');
    assert.equal(group.style.display,'none');
    await api.installPWA();
    assert.equal(prompted,0);
    // Native marker and Tauri runtime block service-worker registration;
    // an already-loaded native bridge also remains a display-only blocker.
    if (desktop.tauri) assert.equal(typeof events.load,'undefined');
    if (desktop.bodyDataset) assert.equal(registered,0);
  }
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


test('Settings About has accessible credits, edition, Star link and dismissible popup', () => {
  const settings=html.split('id="settings-panel-about"')[1].split('<!-- About Modal -->')[0];
  const popup=html.split('<!-- About Modal -->')[1].split('<script>')[0];
  assert.ok(settings.includes('href="https://github.com/lgg/leaf"'));
  assert.ok(settings.includes('href="https://github.com/uncle-jasper/leaf"'));
  assert.ok(settings.includes('id="about-star-github"'));
  assert.ok(settings.includes('id="about-install-type"'));
  assert.ok(settings.includes('id="chk-about-show-startup"'));
  assert.ok(settings.includes('Show welcome window when Leaf starts'));
  assert.ok(settings.includes('The welcome window can always be opened manually'));
  for (const token of ['id="about-dialog-version"','id="about-dialog-install-type"',
      'original repository','fork repository','Windows downloads &amp; release notes',
      '☆ Star on GitHub','☕ buy me a coffee']) {
    assert.ok(popup.includes(token), token);
  }
  assert.ok(popup.includes('id="chk-about-dont-show"'));
  assert.ok(js.includes("document.getElementById('btn-about').addEventListener('click',showAboutDialog)"));
  assert.ok(js.includes("window.addEventListener('load', () => {"));
  assert.ok(js.includes("setAboutStartupEnabled(!event.target.checked)"));
  assert.ok(js.includes("selectSettingsTab('about')"));
  assert.ok(js.includes("location.protocol==='file:'"));
  assert.ok(js.includes("display-mode: standalone"));
  assert.ok(!html.includes('style="font-size:11px; color:var(--accent); opacity:0.7;'));
});

test('About link color preserves theme and meets 4.5:1 contrast for every preset or custom palette', () => {
  const fn=between('function aboutRgb(hex) {','function refreshAboutEdition() {');
  const values={};
  let theme={surface:'#141414',accent:'#444444',text:'#d8d8d8'};
  const root={style:{setProperty:(key,value)=>{values[key]=value;}}};
  const document={documentElement:root,getElementById:()=>({})};
  const methods=new Function('getComputedStyle','document',fn+
    ';return {updateAboutLinkColor,aboutRgb,aboutContrast};')(
      ()=>({getPropertyValue:key=>theme[key.slice(2)]}),document);
  const palettes=[
    ['#141414','#444444','#d8d8d8'],
    ['#000000','#606060','#c8c8c8'],
    ['#0f0f0f','#0a5c0a','#22cc22'],
    ['#ede8de','#8b6e4e','#2c2416'],
    ['#f5f7fa','#4a6080','#1a1d23'],
    ['#000000','#0000ff','#c0c0c0'],
    ['#eeeeee','#eeeeee','#222222'],
    ['#030303','#030303','#080808']
  ];
  for(const [surface,accent,text] of palettes) {
    theme={surface,accent,text};
    methods.updateAboutLinkColor();
    const ratio=methods.aboutContrast(methods.aboutRgb(values['--about-link']),methods.aboutRgb(surface));
    assert.ok(ratio>=4.49, 'unreadable link on '+surface+': '+ratio);
    assert.ok(values['--about-star-text']==='#ffffff'||values['--about-star-text']==='#000000');
  }
});

test('About offers desktop releases without adding a native runtime to web', () => {
  assert.ok(html.includes('href="https://github.com/lgg/leaf/releases"'));
  assert.ok(html.includes('Windows releases'));
  assert.ok(html.includes('if (window.leafDesktop) return window.leafDesktop.save()'));
  assert.ok(html.includes('if (window.leafDesktop) return window.leafDesktop.open()'));
  assert.ok(html.includes("if (!answer && !confirm('Discard unsaved changes in"));
  assert.ok(html.includes("!confirm('Discard unsaved changes in"));
});

function markdownSafetyMethods() {
  const source = html; // Shared top-level editor source; no undefined test root.
  const start = source.indexOf('function markdownAttr(');
  const end = source.indexOf('function renderPreview()', start);
  assert.ok(start >= 0 && end > start, 'Markdown parser source section must exist');
  return new Function(source.slice(start, end) +
    '; return {markdownTarget, parseMarkdown};')();
}

const blockedPreviewUrls = [
  ['embedded-newline', 'java' + String.fromCharCode(10) + 'script:1'],
  ['embedded-tab', 'java' + String.fromCharCode(9) + 'script:1'],
  ['embedded-NUL', 'ja' + String.fromCharCode(0) + 'vascript:1'],
  ['embedded-CR', 'javascript' + String.fromCharCode(13) + ':1'],
  ['javascript', 'javascript:1'],
  ['data', 'data:text/html,1'],
  ['vbscript', 'vbscript:1']
];
for (const [caseName, url] of blockedPreviewUrls) {
  test('Markdown preview blocks unsafe URL: ' + caseName, () => {
    const methods = markdownSafetyMethods();
    assert.equal(methods.markdownTarget(url, false), '#');
    assert.equal(methods.markdownTarget(url, true), '#');
    assert.match(methods.parseMarkdown('[click](' + url + ')'), /href="#"/);
  });
}
test('Markdown preview preserves safe absolute and relative URLs', () => {
  const methods = markdownSafetyMethods();
  for (const url of ['https://example.org', 'mailto:editor@example.org', 'relative/note.md', '#section']) {
    assert.equal(methods.markdownTarget(url, false), url);
  }
  assert.equal(methods.markdownTarget('mailto:editor@example.org', true), '#');
});

test('Markdown link and image URL schemes cannot be made executable in preview', () => {
  const start = js.indexOf('function markdownAttr(');
  const end = js.indexOf('function renderPreview()', start);
  assert.ok(start >= 0 && end > start);
  const {markdownTarget, parseMarkdown} = new Function(js.slice(start,end) +
    ';return {markdownTarget,parseMarkdown};')();
  const forbidden = [
    'javascript:alert(1)', 'data:text/html,hello', 'vbscript:1',
    'java' + String.fromCharCode(10) + 'script:alert(1)',
    'ja' + String.fromCharCode(0) + 'vascript:alert(1)',
    'java' + String.fromCharCode(9) + 'script:alert(1)'
  ];
  for (const url of forbidden) {
    assert.equal(markdownTarget(url, false), '#');
    assert.equal(markdownTarget(url, true), '#');
    assert.match(parseMarkdown('[test](' + url + ')'), /href="#"/);
  }
  assert.equal(markdownTarget('https://example.org', false), 'https://example.org');
  assert.equal(markdownTarget('mailto:writer@example.org', false), 'mailto:writer@example.org');
  assert.equal(markdownTarget('mailto:writer@example.org', true), '#');
  assert.equal(markdownTarget('./notes.md', false), './notes.md');
  assert.match(parseMarkdown('[safe](https://example.org)'), /rel="noopener noreferrer"/);
  assert.match(parseMarkdown('![alt" onerror="alert(1)](https://example.org/x.png)'), /alt="alt&quot; onerror=&quot;alert\(1\)"/);
});

test('closing a web tab cannot lose edits made while its Save dialog was pending', async () => {
  const start = js.indexOf('async function closeTab(');
  const end = js.indexOf("\ndocument.getElementById('btn-new-tab')", start);
  assert.ok(start >= 0 && end > start);
  const method = js.slice(start, end);
  const tabs = [{id:1,name:'draft.md',content:'new unsaved edit',dirty:true}];
  const harness = new Function('tabs','confirm','switchTab','saveFile','workspaceNotice',
    'let activeTabId=1; let isDirty=true; ' + method +
    '; return {closeTab, getTabs:()=>tabs};')(
      tabs, () => true, () => {}, async () => true, () => {}
    );
  await harness.closeTab(1);
  assert.equal(harness.getTabs().length, 1);
  assert.equal(harness.getTabs()[0].content, 'new unsaved edit');
});

test('Cancel on the discard prompt retains a dirty browser document', async () => {
  const start = js.indexOf('async function closeTab(');
  const end = js.indexOf("\ndocument.getElementById('btn-new-tab')", start);
  const method = js.slice(start, end);
  const openTabs = [{id:1,name:'important.md',content:'valuable draft',dirty:true}];
  let prompts = 0;
  const harness = new Function('tabs','confirm','switchTab','saveFile','workspaceNotice',
    'let activeTabId=1; let isDirty=true; ' + method +
    '; return {closeTab,getTabs:()=>tabs};')(
      openTabs, () => { prompts++; return false; }, () => {}, async () => true, () => {}
    );
  await harness.closeTab(1);
  assert.equal(prompts, 2);
  assert.equal(harness.getTabs().length, 1);
  assert.equal(harness.getTabs()[0].content, 'valuable draft');
});


test('file chooser uses the themed button and native WebView picker is hidden', () => {
  assert.match(html, /id="btn-open"[^>]*>⬆ choose file<\/button>/);
  assert.match(html, /id="file-open"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(html, /#file-open\[hidden\] \{ display: none !important; \}/);
  assert.ok(js.includes("document.getElementById('file-open').click()"));
  assert.ok(js.includes("if (window.leafDesktop) return window.leafDesktop.open()"));
});

test('font sizes use positive integers with no 128px input cap', () => {
  const start = js.indexOf('function parseFontSize(');
  const end = js.indexOf('function applyFontSize(', start);
  assert.ok(start > 0 && end > start);
  const parse = new Function(js.slice(start,end) + 'return parseFontSize;')();
  for (const value of ['1','6','18','128','129','1000','65536']) assert.equal(parse(value),Number(value));
  for (const value of ['', '0','-1','abc','12.5','1e3','Infinity','9007199254740992']) assert.equal(parse(value),null);
  assert.ok(html.includes('id="settings-font-size-slider" type="range" min="6" max="128"'));
  assert.ok(html.includes('id="settings-font-size-save"'));
  assert.ok(html.includes('id="settings-font-size-input" type="text"'));
  assert.ok(js.includes('String(Math.max(6, Math.min(128, size)))'));
  assert.ok(js.includes('fontSize:     String(appliedFontSize)'));
  assert.ok(js.includes('if (s.fontSize !== undefined) applyFontSize(s.fontSize, false)'));
  assert.ok(!html.includes('settings-font-size-select'));
});

test('focus-mode top bar auto-hide is saved independently and reveals document tabs', () => {
  assert.ok(html.includes('id="chk-focus-header-autohide"'));
  assert.ok(html.includes('body.focus-mode.focus-header-autohide #header'));
  assert.ok(html.includes('body.focus-mode.focus-header-autohide.toolbar-peek #header'));
  assert.ok(html.includes('body.focus-mode #tab-bar, body.focus-mode.tabbar-faded #tab-bar { display: flex;'));
  assert.ok(!html.includes('body.focus-mode #tab-bar { display: none; }'));
  assert.ok(js.includes('focusHeaderAutohide: focusHeaderAutohideEnabled'));
  assert.ok(js.includes('if (s.focusHeaderAutohide === true)'));
  assert.ok(js.includes('if (inFocus && focusHeaderAutohideEnabled)'));
  assert.ok(js.includes("document.getElementById('header').addEventListener('mouseleave'"));
});


test('six tabbed settings pages separate editor and interface typography', () => {
  const modal = html.split('<!-- Settings Modal -->')[1].split('<!-- About Modal -->')[0];
  const appearance = modal.split('id="settings-panel-appearance"')[1].split('id="settings-panel-status"')[0];
  const editor = modal.split('id="settings-panel-editor"')[1].split('id="settings-panel-mobile"')[0];
  for(const tab of ['document','appearance','status','editor','mobile','about']) {
    assert.ok(modal.includes('id="settings-tab-'+tab+'"'));
    assert.ok(modal.includes('role="tabpanel" aria-labelledby="settings-tab-'+tab+'"'));
  }
  assert.ok(modal.includes('role="tablist"'));
  assert.ok(appearance.indexOf('id="chk-focus-header-autohide"') < appearance.indexOf('theme &amp; colors'));
  assert.ok(appearance.includes('settings-ui-font-select'));
  assert.ok(appearance.includes('settings-ui-font-size-input'));
  assert.ok(appearance.includes('settings-ui-font-size-save'));
  assert.ok(appearance.includes('settings-ui-font-size-slider" type="range" min="6" max="128"'));
  assert.ok(!appearance.includes('id="settings-font-select"'));
  assert.ok(editor.includes('id="settings-font-select"'));
  assert.ok(editor.includes('id="settings-font-size-input"'));
  assert.ok(editor.includes('id="settings-font-size-save"'));
  assert.ok(!editor.includes('settings-ui-font-select'));
  const uiController = html.slice(html.indexOf('function applyUiFontSize('), html.indexOf('function commitUiFontSize('));
  assert.ok(uiController.includes("'--ui-font-size'"));
  assert.ok(uiController.includes('Math.max(6, Math.min(128, size))'));
  assert.ok(html.includes('uiFontSize:   String(appliedUiFontSize)'));
  assert.ok(html.includes('if (s.uiFontSize !== undefined) applyUiFontSize(s.uiFontSize, false)'));
});
