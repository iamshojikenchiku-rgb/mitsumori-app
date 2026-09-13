'use strict';
/* ============================================================
   現場メモ → 見積たたき台  v2
   - 自動保存（localStorage）／案件履歴／設定
   - 単位・行金額・法定福利費・消費税・端数処理
   - リスクと原価項目の整合チェック
   ============================================================ */
const LS_DRAFT='mitsumori.draft', LS_CASES='mitsumori.cases', LS_SETTINGS='mitsumori.settings', LS_SUGGEST='mitsumori.suggest';

const WORK_TYPES=['新築工事','増築工事','リフォーム','内装工事','外装工事','屋根工事','水廻り工事','外構工事','修理・メンテナンス','耐震・断熱改修'];
const RISKS=['足場が必要','アスベスト懸念','雨漏り・水損あり','シロアリ懸念','腐朽・腐食あり','隣地近接','狭小・搬入困難','解体が必要','確認申請が必要','追加工事の可能性大','施主支給あり','工期が短い','居住中の工事','積雪期にかかる','電気・給排水の移設'];
const UNITS={material:['㎡','m','本','枚','袋','個','㎥','坪','式','セット'],labor:['人工','式'],sub:['式','㎡','m','本','個','箇所','日']};
/* リスク → 原価項目に含まれているべきキーワード */
const RISK_CHECKS=[
  {risk:'足場が必要',kw:['足場'],msg:'「足場が必要」だが原価に足場の項目がない'},
  {risk:'解体が必要',kw:['解体','撤去'],msg:'「解体が必要」だが解体・撤去の項目がない'},
  {risk:'アスベスト懸念',kw:['アスベスト','石綿','分析','調査'],msg:'「アスベスト懸念」だが事前調査・分析費の項目がない（2023年10月以降、有資格者による事前調査が義務）'},
  {risk:'確認申請が必要',kw:['申請','設計','確認'],msg:'「確認申請が必要」だが申請・設計費の項目がない'},
  {risk:'シロアリ懸念',kw:['防蟻','シロアリ','防腐'],msg:'「シロアリ懸念」だが防蟻・防腐処理の項目がない'},
  {risk:'電気・給排水の移設',kw:['電気','給排水','配管','配線','設備'],msg:'「電気・給排水の移設」だが設備工事の項目がない'},
];
/* ---------- 入力データの検証（localStorage／JSON取り込み共通） ---------- */
const STR=(v,max)=>{ if(typeof v!=='string'){ if(v==null) return ''; if(typeof v==='number'&&Number.isFinite(v)) v=String(v); else return ''; } return v.slice(0,max); };
const NUMV=(v,def)=>Number.isFinite(v)?v:def;
function sanitizeRows(a){ return Array.isArray(a)?a.slice(0,300).map(r=>{ r=r&&typeof r==='object'?r:{}; return {name:STR(r.name,200),unit:STR(r.unit,20),qty:STR(r.qty,32),unit_price:STR(r.unit_price,32)}; }):[]; }
function sanitizeCase(c,requireId){
  if(!c||typeof c!=='object'||Array.isArray(c)) return null;
  const id=STR(c.id,40).replace(/[^0-9A-Za-z_-]/g,'');
  if(requireId&&!id) return null;
  const strArr=(a,allow)=>Array.isArray(a)?a.filter(x=>typeof x==='string'&&allow.includes(x)).slice(0,allow.length):[];
  return {
    id:id||null, step:[0,1,2,3].includes(c.step)?c.step:0, updated:NUMV(c.updated,0),
    client:STR(c.client,200), address:STR(c.address,300), date:STR(c.date,20), caseNo:STR(c.caseNo,50),
    workTypes:strArr(c.workTypes,WORK_TYPES), siteNote:STR(c.siteNote,8000), dimNote:STR(c.dimNote,8000), photoNote:STR(c.photoNote,4000),
    material:sanitizeRows(c.material), labor:sanitizeRows(c.labor), sub:sanitizeRows(c.sub),
    expenseRate:STR(c.expenseRate,16), profitRate:STR(c.profitRate,16),
    risks:strArr(c.risks,RISKS), riskNote:STR(c.riskNote,8000),
    duration:STR(c.duration,200), validity:STR(c.validity,200), payment:STR(c.payment,100), excluded:STR(c.excluded,4000),
    quote:NUMV(c.quote,0), pct:NUMV(c.pct,0)
  };
}
function loadCases(){ return loadArr(LS_CASES).map(c=>sanitizeCase(c,true)).filter(Boolean).slice(0,200); }
const DEFAULT_SETTINGS={company:'',area:'',expense:10,profit:25,tax:10,welfare:0,round:'none',warn:20,theme:'dark'};

function sanitizeSettings(s){ s=Object.assign({},DEFAULT_SETTINGS,s&&typeof s==='object'?s:{});
  return {company:STR(s.company,100),area:STR(s.area,100),expense:NUMV(s.expense,10),profit:NUMV(s.profit,25),tax:NUMV(s.tax,10),welfare:NUMV(s.welfare,0),
    round:['none','up1000','round1000','down1000'].includes(s.round)?s.round:'none',warn:NUMV(s.warn,20),theme:s.theme==='light'?'light':'dark'}; }
let settings=sanitizeSettings(loadJSON(LS_SETTINGS,DEFAULT_SETTINGS));
let currentStep=0, currentCaseId=null, saveTimer=null;
const stepLabels=['STEP 1　現場情報','STEP 2　原価入力','STEP 3　リスク確認','STEP 4　出力'];

/* ---------- utilities ---------- */
function loadJSON(k,def){ try{ const v=localStorage.getItem(k); return v?Object.assign({},def,JSON.parse(v)):def; }catch(e){ return def; } }
function loadArr(k){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):[]; }catch(e){ return []; } }
function saveLS(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } }
function $(id){ return document.getElementById(id); }
function todayLocal(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmt(n){ return '¥'+Math.round(n).toLocaleString('ja-JP'); }
function yen(n){ return Math.round(n).toLocaleString('ja-JP')+'円'; }
function num(v,def){ const n=parseFloat(v); return Number.isFinite(n)?n:def; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),1800); }
function applyTheme(){ document.documentElement.setAttribute('data-theme',settings.theme==='light'?'light':'dark'); document.querySelector('meta[name=theme-color]').content=settings.theme==='light'?'#ffffff':'#0f1117'; }

/* ---------- init ---------- */
window.addEventListener('DOMContentLoaded',()=>{
  applyTheme();
  WORK_TYPES.forEach(w=>{ const l=document.createElement('label'); l.className='check-item'; const i=document.createElement('input'); i.type='checkbox'; i.value=w;
    i.addEventListener('change',()=>{ l.classList.toggle('checked',i.checked); scheduleSave(); });
    const ic=document.createElement('div'); ic.className='check-icon'; ic.textContent='✓'; l.append(i,ic,document.createTextNode(w)); $('workTypeGroup').appendChild(l); });
  RISKS.forEach(r=>{ const s=document.createElement('span'); s.className='risk-tag'; s.textContent=r; s.addEventListener('click',()=>{ s.classList.toggle('selected'); scheduleSave(); }); $('riskTags').appendChild(s); });
  bindActions();
  document.querySelectorAll('input,textarea,select').forEach(el=>{ if(!el.closest('.panel')) el.addEventListener('input',scheduleSave); });
  $('expenseRate').addEventListener('input',calcTotals); $('profitRate').addEventListener('input',calcTotals);
  refreshDatalists();
  const draft=sanitizeCase(loadJSON(LS_DRAFT,null),false);
  if(draft){ applyState(draft); currentCaseId=draft.id||null; $('saveState').textContent='下書き復元'; }
  else { blankCase(); }
  goStep(draft&&draft.step?draft.step:0,true);
  if(!navigator.share) $('shareBtn').style.display='none';
  setupServiceWorker();
});

/* ---------- service worker（オフライン起動）と更新 ---------- */
function setupServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  const sw=navigator.serviceWorker;
  const hadController=!!sw.controller;
  sw.addEventListener('controllerchange',()=>{ if(hadController) $('updateBar').hidden=false; });
  sw.register('sw.js').then(reg=>{
    if(reg.waiting&&sw.controller) $('updateBar').hidden=false;
    reg.addEventListener('updatefound',()=>{ const nw=reg.installing; if(!nw) return; nw.addEventListener('statechange',()=>{ if(nw.state==='installed'&&sw.controller) $('updateBar').hidden=false; }); });
    reg.update().catch(()=>{});
  }).catch(()=>{});
}
function applyUpdate(){ $('updateBar').hidden=true; location.reload(); }
async function refreshApp(){
  if(navigator.onLine===false){ alert('オフラインのため更新できません。電波のある場所で実行してください。'); return; }
  if(!confirm('アプリ本体のキャッシュを消して最新版を読み直します。案件データ・設定はそのまま残ります。よろしいですか？')) return;
  try{ if('serviceWorker' in navigator){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); } }catch(e){}
  try{ if(window.caches){ const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); } }catch(e){}
  location.reload();
}
function bindActions(){
  const ACTS={saveCase:()=>saveCase(true),shareText,newCase,exportAll,saveSettings,closePanel,wipeAll,applyUpdate,refreshApp};
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-step],[data-panel],[data-addrow],[data-copy],[data-act],[data-case],[data-del]');
    if(!el) return;
    if(el.dataset.step!==undefined) return goStep(Number(el.dataset.step));
    if(el.dataset.panel) return openPanel(el.dataset.panel);
    if(el.dataset.addrow) return void addRow(el.dataset.addrow);
    if(el.dataset.copy) return copyText(el.dataset.copy,el);
    if(el.dataset.case) return loadCase(el.dataset.case);
    if(el.dataset.del) return deleteCase(el.dataset.del);
    if(el.dataset.act&&ACTS[el.dataset.act]) return ACTS[el.dataset.act]();
  });
  $('importFile').addEventListener('change',e=>importAll(e.target));
}
function wipeAll(){
  if(!confirm('この端末に保存された案件・下書き・設定・入力候補をすべて消去します。よろしいですか？')) return;
  if(!confirm('本当に消去しますか？（元に戻せません。必要なら先に「全案件をJSONで書き出し」を実行してください）')) return;
  [LS_DRAFT,LS_CASES,LS_SETTINGS,LS_SUGGEST].forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
  settings=sanitizeSettings(DEFAULT_SETTINGS); currentCaseId=null; applyTheme(); applyState({}); blankCase(); refreshDatalists(); closePanel(); goStep(0,true); toast('全データを消去しました');
}
function blankCase(){
  $('surveyDate').value=todayLocal();
  $('expenseRate').value=settings.expense; $('profitRate').value=settings.profit;
  $('materialRows').innerHTML=''; $('laborRows').innerHTML=''; $('subRows').innerHTML='';
  addRow('material'); addRow('labor');
  calcTotals();
}

/* ---------- steps ---------- */
function goStep(n,silent){
  if(n===3 && !silent){ if(!validateBeforeOutput()) return; }
  document.querySelectorAll('.step-page').forEach((p,i)=>p.classList.toggle('active',i===n));
  document.querySelectorAll('.step-dot').forEach((d,i)=>{ d.classList.toggle('active',i===n); d.classList.toggle('done',i<n); });
  currentStep=n; $('stepLabel').textContent=stepLabels[n];
  window.scrollTo(0,0);
  if(n===1) calcTotals();
  if(n===3) generateOutput();
  if(!silent) scheduleSave();
}
function validateBeforeOutput(){
  const c=compute();
  if(c.base===0){ return confirm('原価が未入力です（合計 ¥0）。このまま出力しますか？'); }
  return true;
}

/* ---------- rows ---------- */
function addRow(type,data){
  const c=$(type+'Rows');
  const d=document.createElement('div'); d.className='cost-row'; d.dataset.type=type;
  const p1=type==='material'?'品名・規格':type==='labor'?'工種（例：大工手間）':'業者名・工種';
  const p2=type==='labor'?'人工':'数量';
  const units=UNITS[type].map(u=>`<option value="${u}">${u}</option>`).join('');
  const dl=type==='material'?'dlMaterial':type==='labor'?'dlLabor':'dlSub';
  d.innerHTML=`<div class="r1">
      <input type="text" class="nm" placeholder="${p1}" list="${dl}" autocomplete="off">
      <select class="un">${units}</select>
      <div class="del-btn" role="button" aria-label="削除">×</div>
    </div>
    <div class="r2">
      <input type="number" class="qt" placeholder="${p2}" inputmode="decimal" min="0" step="any">
      <span class="op">×</span>
      <input type="number" class="up" placeholder="単価" inputmode="numeric" min="0" step="any">
      <div class="amt zero">¥0</div>
    </div>`;
  const nm=d.querySelector('.nm'), un=d.querySelector('.un'), qt=d.querySelector('.qt'), up=d.querySelector('.up');
  if(data){ nm.value=data.name||''; if(data.unit) un.value=data.unit; qt.value=data.qty??''; up.value=data.unit_price??''; }
  else if(type==='sub'){ qt.value=1; }
  [nm,un,qt,up].forEach(el=>el.addEventListener('input',()=>{ calcTotals(); scheduleSave(); }));
  nm.addEventListener('change',()=>{ const s=findSuggest(type,nm.value); if(s){ if(!up.value&&s.unit_price) up.value=s.unit_price; if(s.unit&&UNITS[type].includes(s.unit)) un.value=s.unit; calcTotals(); } });
  d.querySelector('.del-btn').addEventListener('click',()=>{ d.remove(); calcTotals(); scheduleSave(); });
  c.appendChild(d);
  return d;
}
function getRowData(type){
  const items=[]; let total=0;
  document.querySelectorAll('#'+type+'Rows .cost-row').forEach(r=>{
    const name=r.querySelector('.nm').value.trim(), unit=r.querySelector('.un').value;
    const qty=num(r.querySelector('.qt').value,0), unit_price=num(r.querySelector('.up').value,0);
    const amount=qty*unit_price; total+=amount;
    const a=r.querySelector('.amt'); a.textContent=fmt(amount); a.classList.toggle('zero',amount===0);
    if(name||qty||unit_price) items.push({name:name||'（未記入）',unit,qty,unit_price,amount,priceMissing:!!name&&qty>0&&unit_price===0});
  });
  return {items,total};
}

/* ---------- calculation (single source of truth) ---------- */
function roundQuote(q){
  switch(settings.round){
    case 'up1000': return Math.ceil(q/1000)*1000;
    case 'round1000': return Math.round(q/1000)*1000;
    case 'down1000': return Math.floor(q/1000)*1000;
    default: return Math.round(q);
  }
}
function compute(){
  const mat=getRowData('material'), lab=getRowData('labor'), sub=getRowData('sub');
  const er=Math.max(0,num($('expenseRate').value,settings.expense))/100;
  const pr=Math.min(0.95,Math.max(0,num($('profitRate').value,settings.profit)/100));
  const wr=Math.max(0,num(settings.welfare,0))/100, tr=Math.max(0,num(settings.tax,10))/100;
  const base=mat.total+lab.total+sub.total;
  const welfare=lab.total*wr;
  const exp=(base+welfare)*er;
  const cost=base+welfare+exp;
  const quoteRaw=cost/(1-pr);
  const quote=roundQuote(quoteRaw);
  const profit=quote-cost, pct=quote>0?profit/quote*100:0;
  const tax=Math.floor(quote*tr), gross=quote+tax;
  return {mat,lab,sub,er,pr,wr,tr,base,welfare,exp,cost,quoteRaw,quote,profit,pct,tax,gross};
}
function calcTotals(){
  const c=compute();
  $('matSub').textContent=fmt(c.mat.total); $('labSub').textContent=fmt(c.lab.total); $('subSub').textContent=fmt(c.sub.total);
  $('matTotal').textContent=fmt(c.mat.total); $('labTotal').textContent=fmt(c.lab.total); $('subTotal').textContent=fmt(c.sub.total);
  $('welfareRow').hidden=!(c.wr>0); $('welfareTotal').textContent=fmt(c.welfare); $('welfareNote').textContent=c.wr>0?`（労務費×${settings.welfare}%）`:'';
  $('expNote').textContent=`（${(c.er*100).toFixed(1).replace(/\.0$/,'')}%）`;
  $('expTotal').textContent=fmt(c.exp); $('costTotal').textContent=fmt(c.cost);
  $('quoteTotal').textContent=fmt(c.quote); $('roundNote').textContent=settings.round!=='none'?'（千円処理後）':'';
  $('taxNote').textContent=`（${settings.tax}%）`; $('taxTotal').textContent=fmt(c.tax); $('grossTotal').textContent=fmt(c.gross);
  $('profitTotal').textContent=fmt(c.profit);
  $('profitPct').textContent=c.pct.toFixed(1)+'%';
  const f=$('meterFill'); f.style.width=Math.min(c.pct,100)+'%';
  const warn=num(settings.warn,20);
  f.style.background=c.pct<warn*0.75?'var(--danger)':c.pct<warn?'var(--accent)':'var(--success)';
  renderChecks(c,'checkBox');
}

/* ---------- consistency checks ---------- */
function buildWarnings(c){
  const w=[];
  const allNames=[...c.mat.items,...c.lab.items,...c.sub.items].map(i=>i.name).join('|');
  const risks=getSelectedRisks();
  if(c.base===0) w.push('原価が未入力です');
  if(c.base>0 && c.lab.total===0 && c.sub.total===0) w.push('労務費・外注費が0円です（手間の見込みが抜けていませんか）');
  const missing=[...c.mat.items,...c.lab.items,...c.sub.items].filter(i=>i.priceMissing).map(i=>i.name);
  if(missing.length) w.push('単価未入力：'+missing.join('、')+'（合計に含まれていません）');
  const warn=num(settings.warn,20);
  if(c.quote>0 && c.pct<warn) w.push(`実効粗利率 ${c.pct.toFixed(1)}% が警告ライン ${warn}% を下回っています`);
  RISK_CHECKS.forEach(rc=>{ if(risks.includes(rc.risk) && !rc.kw.some(k=>allNames.includes(k))) w.push(rc.msg); });
  const wt=getCheckedValues('workTypeGroup');
  const demolish=risks.includes('解体が必要')||wt.some(t=>['リフォーム','内装工事','外装工事','屋根工事','水廻り工事'].includes(t));
  if(c.base>0 && demolish && !/処分|廃棄|廃材|運搬/.test(allNames)) w.push('廃材処分費・運搬費の項目がありません（改修工事では通常発生）');
  if(risks.includes('施主支給あり') && !/施主支給|支給/.test(allNames+$('excluded').value)) w.push('「施主支給あり」の品目を別途工事・除外事項に明記してください');
  return w;
}
function renderChecks(c,targetId){
  const w=buildWarnings(c);
  const box=$(targetId);
  if(w.length===0){ box.innerHTML=c.base>0?'<div class="warn-box ok">✓ 整合チェック：指摘なし</div>':''; return; }
  box.innerHTML=`<div class="warn-box"><div class="wt">⚠ 整合チェック（${w.length}件）</div><ul>${w.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></div>`;
}

/* ---------- state ---------- */
function getCheckedValues(gid){ return Array.from(document.querySelectorAll('#'+gid+' input:checked')).map(i=>i.value); }
function getSelectedRisks(){ return Array.from(document.querySelectorAll('#riskTags .risk-tag.selected')).map(t=>t.textContent); }
function rowsRaw(type){ return Array.from(document.querySelectorAll('#'+type+'Rows .cost-row')).map(r=>({name:r.querySelector('.nm').value,unit:r.querySelector('.un').value,qty:r.querySelector('.qt').value,unit_price:r.querySelector('.up').value})); }
function getState(){
  return {
    id:currentCaseId, step:currentStep, updated:Date.now(),
    client:$('clientName').value, address:$('address').value, date:$('surveyDate').value, caseNo:$('caseNo').value,
    workTypes:getCheckedValues('workTypeGroup'), siteNote:$('siteNote').value, dimNote:$('dimensionNote').value, photoNote:$('photoNote').value,
    material:rowsRaw('material'), labor:rowsRaw('labor'), sub:rowsRaw('sub'),
    expenseRate:$('expenseRate').value, profitRate:$('profitRate').value,
    risks:getSelectedRisks(), riskNote:$('riskNote').value,
    duration:$('duration').value, validity:$('validity').value, payment:$('payment').value, excluded:$('excluded').value
  };
}
function applyState(s){
  $('clientName').value=s.client||''; $('address').value=s.address||''; $('surveyDate').value=s.date||todayLocal(); $('caseNo').value=s.caseNo||'';
  document.querySelectorAll('#workTypeGroup input').forEach(i=>{ i.checked=(s.workTypes||[]).includes(i.value); i.parentNode.classList.toggle('checked',i.checked); });
  $('siteNote').value=s.siteNote||''; $('dimensionNote').value=s.dimNote||''; $('photoNote').value=s.photoNote||'';
  ['material','labor','sub'].forEach(t=>{ $(t+'Rows').innerHTML=''; (s[t]||[]).forEach(r=>addRow(t,r)); });
  if(!$('materialRows').children.length) addRow('material');
  if(!$('laborRows').children.length) addRow('labor');
  $('expenseRate').value=s.expenseRate??settings.expense; $('profitRate').value=s.profitRate??settings.profit;
  document.querySelectorAll('#riskTags .risk-tag').forEach(t=>t.classList.toggle('selected',(s.risks||[]).includes(t.textContent)));
  $('riskNote').value=s.riskNote||''; $('duration').value=s.duration||''; $('validity').value=s.validity||''; $('payment').value=s.payment||$('payment').options[0].value; $('excluded').value=s.excluded||'';
  calcTotals();
}
function scheduleSave(){
  clearTimeout(saveTimer);
  $('saveState').textContent='…';
  saveTimer=setTimeout(()=>{ const ok=saveLS(LS_DRAFT,getState()); $('saveState').textContent=ok?'自動保存済':'保存不可'; },400);
}

/* ---------- cases ---------- */
function saveCase(notify){
  const s=getState(); const c=compute();
  if(!currentCaseId) currentCaseId=String(Date.now());
  s.id=currentCaseId; s.quote=c.quote; s.pct=c.pct;
  const cases=loadCases().filter(x=>x.id!==s.id); cases.unshift(s);
  saveLS(LS_CASES,cases.slice(0,200)); saveLS(LS_DRAFT,s);
  learnSuggest(c);
  if(notify) toast('案件を保存しました');
}
function newCase(){
  if(!confirm('新規案件を開始します。現在の案件は保存しますか？\n（OK＝保存して新規／キャンセル＝中止）')) return;
  saveCase(false);
  currentCaseId=null;
  applyState({}); blankCase(); saveLS(LS_DRAFT,getState());
  goStep(0,true); toast('新規案件を開始');
}
function renderCases(){
  const cases=loadCases(); const list=$('caseList'); list.textContent='';
  if(!cases.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='保存済み案件はありません'; list.appendChild(e); return; }
  cases.forEach(c=>{
    const item=document.createElement('div'); item.className='case-item'+(c.id===currentCaseId?' current':'');
    const main=document.createElement('div'); main.className='case-main'; main.dataset.case=c.id;
    const name=document.createElement('div'); name.className='case-name'; name.textContent=c.client||'（施主未記入）';
    if(c.caseNo){ const s=document.createElement('span'); s.style.cssText='color:var(--text3);font-weight:400'; s.textContent=' #'+c.caseNo; name.appendChild(s); }
    if(c.id===currentCaseId){ const s=document.createElement('span'); s.style.cssText='color:var(--accent);font-size:11px'; s.textContent=' 編集中'; name.appendChild(s); }
    const meta=document.createElement('div'); meta.className='case-meta'; meta.textContent=(c.date||'')+'　'+(c.workTypes.join('・')||'種別未選択')+'　税抜 '+fmt(c.quote||0);
    main.append(name,meta);
    const del=document.createElement('button'); del.className='case-del'; del.dataset.del=c.id; del.setAttribute('aria-label','削除'); del.textContent='🗑';
    item.append(main,del); list.appendChild(item);
  });
}
function loadCase(id){
  const c=loadCases().find(x=>x.id===id); if(!c) return;
  if(currentCaseId!==id && hasContent()){ if(!confirm('現在の入力内容を保存してから切り替えますか？\n（OK＝保存して切替／キャンセル＝中止）')) return; saveCase(false); }
  currentCaseId=id; applyState(c); saveLS(LS_DRAFT,getState()); closePanel(); goStep(0,true); toast('読み込みました');
}
function deleteCase(id){
  if(!confirm('この案件を削除しますか？')) return;
  saveLS(LS_CASES,loadCases().filter(x=>x.id!==id));
  if(currentCaseId===id) currentCaseId=null;
  renderCases();
}
function hasContent(){ const s=getState(); return !!(s.client||s.siteNote||compute().base>0); }
function exportAll(){
  const data={exported:new Date().toISOString(),settings,cases:loadCases()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='mitsumori_cases_'+todayLocal()+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
const IMPORT_MAX_BYTES=5*1024*1024;
function importAll(input){
  const f=input.files[0]; if(!f) return;
  if(f.size>IMPORT_MAX_BYTES){ alert('ファイルが大きすぎます（上限 5MB）'); input.value=''; return; }
  const rd=new FileReader();
  rd.onload=()=>{ try{
    const d=JSON.parse(rd.result);
    const inc=(d&&Array.isArray(d.cases)?d.cases:[]).map(c=>sanitizeCase(c,true)).filter(Boolean);
    const cur=loadCases(); const ids=new Set(cur.map(x=>x.id)); let added=0;
    inc.forEach(c=>{ if(!ids.has(c.id)){ cur.push(c); ids.add(c.id); added++; } });
    cur.sort((a,b)=>(b.updated||0)-(a.updated||0)); saveLS(LS_CASES,cur.slice(0,200)); renderCases(); toast(added+'件を取り込みました'+(inc.length-added>0?'（重複 '+(inc.length-added)+'件は除外）':''));
  }catch(e){ alert('読み込みに失敗しました（JSON形式を確認してください）'); } input.value=''; };
  rd.readAsText(f);
}

/* ---------- suggestions (learned from saved cases) ---------- */
function learnSuggest(c){
  const sg=loadJSON(LS_SUGGEST,{material:{},labor:{},sub:{}});
  [['material',c.mat],['labor',c.lab],['sub',c.sub]].forEach(([t,d])=>{ d.items.forEach(i=>{ if(i.name&&i.name!=='（未記入）'&&i.unit_price>0&&i.name.length<=200&&Object.keys(sg[t]).length<2000) sg[t][i.name]={unit:i.unit,unit_price:i.unit_price}; }); });
  saveLS(LS_SUGGEST,sg); refreshDatalists();
}
function findSuggest(type,name){ const sg=loadJSON(LS_SUGGEST,{material:{},labor:{},sub:{}}); return sg[type]&&sg[type][name.trim()]; }
function refreshDatalists(){
  const sg=loadJSON(LS_SUGGEST,{material:{},labor:{},sub:{}});
  [['material','dlMaterial'],['labor','dlLabor'],['sub','dlSub']].forEach(([t,id])=>{ const dl=$(id); dl.textContent=''; Object.keys(sg[t]&&typeof sg[t]==='object'?sg[t]:{}).sort().forEach(n=>{ const o=document.createElement('option'); o.value=n; dl.appendChild(o); }); });
}

/* ---------- panels / settings ---------- */
function openPanel(which){
  $('panelBg').classList.add('open');
  if(which==='cases'){ renderCases(); $('panelCases').classList.add('open'); }
  else { $('sCompany').value=settings.company; $('sArea').value=settings.area; $('sExpense').value=settings.expense; $('sProfit').value=settings.profit; $('sTax').value=settings.tax; $('sWelfare').value=settings.welfare; $('sRound').value=settings.round; $('sWarn').value=settings.warn; $('sTheme').value=settings.theme; $('panelSettings').classList.add('open'); }
}
function closePanel(){ $('panelBg').classList.remove('open'); $('panelCases').classList.remove('open'); $('panelSettings').classList.remove('open'); }
function saveSettings(){
  settings=sanitizeSettings({company:$('sCompany').value.trim(),area:$('sArea').value.trim(),expense:num($('sExpense').value,10),profit:num($('sProfit').value,25),tax:num($('sTax').value,10),welfare:num($('sWelfare').value,0),round:$('sRound').value,warn:num($('sWarn').value,20),theme:$('sTheme').value});
  saveLS(LS_SETTINGS,settings); applyTheme(); calcTotals(); if(currentStep===3) generateOutput(); closePanel(); toast('設定を保存しました');
}

/* ---------- output ---------- */
function generateOutput(){
  const c=compute(); const s=getState();
  const client=s.client||'（未記入）', address=s.address||'（未記入）', date=s.date||todayLocal();
  const wt=s.workTypes.join('・')||'未選択';
  const siteNote=s.siteNote||'（なし）', dimNote=s.dimNote||'（なし）', riskNote=s.riskNote.trim();
  const duration=s.duration||'（未定）', validity=s.validity||'1ヶ月', payment=s.payment, excluded=s.excluded.trim();
  const risks=s.risks, rList=risks.length?risks.join('、'):'なし';
  const company=settings.company||'当社', area=settings.area||(s.address?s.address:'地域未設定（⚙設定で営業地域を登録）');
  const erP=(c.er*100).toFixed(1).replace(/\.0$/,''), prP=(c.pr*100).toFixed(1).replace(/\.0$/,'');
  const year=new Date().getFullYear();
  const pm=i=>i.priceMissing?'（単価要確認）':'';
  const line=i=>`・${i.name}：${i.qty}${i.unit} × ${yen(i.unit_price)} = ${yen(i.amount)}${pm(i)}`;
  const mList=c.mat.items.map(line).join('\n')||'（未入力）';
  const lList=c.lab.items.map(line).join('\n')||'（未入力）';
  const sList=c.sub.items.length?c.sub.items.map(line).join('\n'):'（なし）';
  const riskBlock=(risks.length?risks.map(r=>'・'+r).join('\n'):'・特になし')+(riskNote?'\n・'+riskNote.replace(/\n/g,'\n・'):'');
  const welfareLine=c.wr>0?`■法定福利費（労務費×${settings.welfare}%）：${yen(c.welfare)}\n`:'';
  const warnings=buildWarnings(c);
  renderChecks(c,'outCheck');

  const costBlock=
`■材料費
${mList}
小計：${yen(c.mat.total)}

■労務費（自社手間）
${lList}
小計：${yen(c.lab.total)}

■外注費
${sList}
小計：${yen(c.sub.total)}

${welfareLine}■現場経費（${erP}%）：${yen(c.exp)}
■原価合計：${yen(c.cost)}
■見積金額（税抜）：${yen(c.quote)}
■消費税（${settings.tax}%）：${yen(c.tax)}
■税込合計：${yen(c.gross)}
■粗利：${yen(c.profit)}（実効粗利率 ${c.pct.toFixed(1)}%／目標 ${prP}%）`;

  $('claudePrompt').textContent=
`あなたは地域密着の小規模工務店（${company}）の見積作成を支援するアシスタントです。以下の現場調査データをもとに、施主に提出できる見積書の「たたき台」を作成してください。

【施主情報】
施主名：${client}　現場住所：${address}　調査日：${date}${s.caseNo?'　案件番号：'+s.caseNo:''}

【工事概要】
工事種別：${wt}
工期目安：${duration}
現場状況・施主要望：
${siteNote}
寸法メモ：${dimNote}

【原価明細（概算・社内用）】
${costBlock}

【リスク・注意事項】
${riskBlock}

【見積条件】
有効期限：${validity}　支払条件：${payment}
別途工事・除外事項：${excluded||'（未記入）'}
${warnings.length?'\n【アプリの整合チェックで出た指摘】\n'+warnings.map(w=>'・'+w).join('\n')+'\n':''}
【出力してほしいもの】
1. 施主向け見積書の文面（工事項目ごとに「項目名／数量・単位／金額／備考」。原価・粗利は施主向け文面に載せない。項目の粒度は施主が理解できる工種単位にまとめる）
2. 見積書に添える「工事範囲と別途事項」の一覧（施主支給・除外事項・追加工事が発生し得る条件を明記）
3. この見積で特に注意すべきリスク3点と、契約前に施主へ確認しておくべき質問
4. 施主への説明で強調すべきポイント（値引きに頼らず価値を伝える表現で）

前提：単価の妥当性は別途確認するので、金額は上記をそのまま使ってください。不明点は推測で埋めず「要確認」と記載してください。`;

  $('perplexityPrompt').textContent=
`以下の工事について、${area}周辺の現在（${year}年）の相場単価と関連法規を、出典URL付きで教えてください。

【地域】${area}
【工事種別】${wt}
【現場概要】${siteNote}
【寸法メモ】${dimNote}

【確認したい内容】
1. 次の各項目の${year}年時点の標準的な単価レンジ（材工別・材工込みの別を明記）
${[...c.mat.items,...c.lab.items,...c.sub.items].filter(i=>i.name!=='（未記入）').map(i=>`   - ${i.name}（${i.unit}あたり、入力値 ${yen(i.unit_price)}${pm(i)}）`).join('\n')||'   - （項目未入力）'}
2. この工事に関係する建設業法・建築基準法・その他法令上の注意点（確認申請の要否、アスベスト事前調査、資格要件など）
3. 国・秋田県・市町村レベルで該当し得る補助金・助成金（省エネ改修、耐震、子育て、移住など）と申請時期
4. リスク項目への対処と概算コスト：${rList}

情報は一次情報（官公庁・業界団体・メーカー）を優先し、単価は「出典・年・地域」を明示してください。不確かな場合はその旨を書いてください。`;

  $('chatgptPrompt').textContent=
`あなたは木造住宅リフォーム・修繕の積算の専門家です。以下の現場情報と原価概算を確認し、①見落としている可能性のある工事項目（仮設・養生・撤去・処分・諸経費・設備の付帯工事など）、②各単価の妥当性、③数量と単位の整合性、④合計金額の整合性について指摘してください。

【工事概要】
施主：${client}　現場：${address}（${area}）
工事種別：${wt}
現場状況：${siteNote}
寸法メモ：${dimNote}

【原価概算】
${costBlock}

【リスク要因】${rList}${riskNote?'／'+riskNote:''}
${warnings.length?'\n【アプリの整合チェックで出た指摘】\n'+warnings.map(w=>'・'+w).join('\n')+'\n':''}
追加すべき項目・単価の修正提案を、根拠とともに箇条書きで教えてください。断定できない点は「要確認」として理由を添えてください。`;

  $('notionOutput').textContent=
`# 案件メモ｜${client}${s.caseNo?'（#'+s.caseNo+'）':''}
日付：${date}　現場：${address}
工事種別：${wt}
写真・図面：${s.photoNote||'（未記入）'}

## 現場状況
${siteNote}

## 寸法メモ
${dimNote}

## 原価概算（社内用）
| 項目 | 金額 |
|------|------|
| 材料費 | ${yen(c.mat.total)} |
| 労務費 | ${yen(c.lab.total)} |
| 外注費 | ${yen(c.sub.total)} |
${c.wr>0?`| 法定福利費(${settings.welfare}%) | ${yen(c.welfare)} |\n`:''}| 現場経費(${erP}%) | ${yen(c.exp)} |
| 原価合計 | ${yen(c.cost)} |
| 見積金額(税抜) | ${yen(c.quote)} |
| 消費税(${settings.tax}%) | ${yen(c.tax)} |
| 税込合計 | ${yen(c.gross)} |
| 粗利 | ${yen(c.profit)}（${c.pct.toFixed(1)}%） |

## 明細
${['材料費','労務費','外注費'].map((t,i)=>'### '+t+'\n'+([c.mat,c.lab,c.sub][i].items.map(line).join('\n')||'（なし）')).join('\n')}

## リスク
${risks.length?risks.map(r=>'- '+r).join('\n'):'- なし'}${riskNote?'\n- '+riskNote.replace(/\n/g,'\n- '):''}
${warnings.length?'\n## 整合チェック\n'+warnings.map(w=>'- '+w).join('\n')+'\n':''}
## 見積条件
工期：${duration}　有効期限：${validity}　支払：${payment}
別途・除外：${excluded||'（なし）'}

## ステータス
- [ ] 単価確認（Perplexity）
- [ ] 積算チェック（AI）
- [ ] 見積書作成
- [ ] 施主提出
- [ ] 受注確認`;

  const tsvRows=[['区分','品名','数量','単位','単価','金額','備考']];
  [['材料費',c.mat],['労務費',c.lab],['外注費',c.sub]].forEach(([t,d])=>d.items.forEach(i=>tsvRows.push([t,i.name,i.qty,i.unit,i.unit_price,Math.round(i.amount),i.priceMissing?'単価要確認':''])));
  if(c.wr>0) tsvRows.push(['法定福利費','労務費×'+settings.welfare+'%',1,'式',Math.round(c.welfare),Math.round(c.welfare),'']);
  tsvRows.push(['現場経費','現場経費 '+erP+'%',1,'式',Math.round(c.exp),Math.round(c.exp),'']);
  tsvRows.push(['','原価合計','','','',Math.round(c.cost),'']);
  tsvRows.push(['','見積金額（税抜）','','','',c.quote,'粗利率 '+c.pct.toFixed(1)+'%']);
  tsvRows.push(['','消費税','','','',c.tax,settings.tax+'%']);
  tsvRows.push(['','税込合計','','','',c.gross,'']);
  $('tsvOutput').textContent=tsvRows.map(r=>r.map(v=>String(v).replace(/\t/g,' ')).join('\t')).join('\n');
}

function copyText(id,btn){
  const text=$(id).textContent;
  const done=()=>{ btn.textContent='COPIED ✓'; btn.classList.add('copied'); setTimeout(()=>{ btn.textContent='COPY'; btn.classList.remove('copied'); },2500); };
  if(navigator.clipboard&&window.isSecureContext){ navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done)); }
  else fallbackCopy(text,done);
}
function fallbackCopy(text,done){
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); done(); }catch(e){ alert('コピーできませんでした。長押しで選択してください。'); }
  document.body.removeChild(ta);
}
function shareText(){
  if(!navigator.share) return;
  navigator.share({title:'案件メモ｜'+($('clientName').value||'未記入'),text:$('notionOutput').textContent}).catch(()=>{});
}
