<script>
  import { onMount, tick } from 'svelte';
  import { writable, get } from 'svelte/store';
  import { Screenplay }   from './screenplay.js';

  /* ───── PUBLIC PROP (two‑way bound) ─────────────────────────────── */
  export let screenplay = null;

  /* ───── INTERNAL STATE ──────────────────────────────────────────── */
  const menuState   = writable({ open:false, sceneIndex:null, paraIndex:null });
  const elementRefs = {};
  const keyToTypeMap = { s:'Scene Heading', a:'Action', c:'Character',
                         p:'Parenthetical', d:'Dialogue', t:'Transition' };

  /* ───── UTILITIES ───────────────────────────────────────────────── */
  const generateId = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  const textOf     = para => (para.text_elements||[]).map(te=>te.text).join('');

  function ensureParagraphIds(){
    screenplay?.scenes?.forEach(sc =>
      sc.paragraphs.forEach(p => (p.id ||= generateId())));
  }
  $: ensureParagraphIds();

  function storeRef(node,{key,para}){
    if(!node) return;
    elementRefs[key]=node;
    if(node.innerText.trim()===''){
      node.innerText = renderText(para); 
    }
    return{destroy(){delete elementRefs[key];}};
  }

  function updateTextById(id,newText){
    for(const sc of screenplay.scenes){
      const para=sc.paragraphs.find(p=>p.id===id);
      if(para && newText!==textOf(para))
        para.text_elements=[{text:newText,style:null}];
    }
  }

  function syncAllVisibleText(){
    document.querySelectorAll('.editable[data-id]').forEach(el=>{
      const id=el.dataset.id, text=el.innerText??'';
      for(const sc of screenplay.scenes){
        const para=sc.paragraphs.find(p=>p.id===id);
        if(para && text!==para.text_elements[0]?.text)
          para.text_elements[0].text=text;
      }
    });
  }

  /* ───── TYPE HELPERS ────────────────────────────────────────────── */
  const defaultAfter = { 'Scene Heading':'Action','Action':'Action',
                         'Dialogue':'Action','Character':'Dialogue',
                         'Parenthetical':'Dialogue','Transition':'Scene Heading' };
  const tabCycleMap  = { 'Scene Heading':'Action','Action':'Character','Character':'Transition',
                         'Transition':'Scene Heading','Dialogue':'Parenthetical','Parenthetical':'Dialogue' };
  const getDefaultType = prev => defaultAfter[prev]??'Action';
  const getTabCycleType = cur => tabCycleMap[cur]??'Action';
  const getTabInsertType = cur => (cur==='Character'?'Parenthetical':getDefaultType(cur));

  /* ───── PARAGRAPH INSERT/REMOVE ─────────────────────────────────── */
  async function insertEmptyParagraph(si,pj){
    syncAllVisibleText();
    const sc=screenplay.scenes[si];
    sc.paragraphs.splice(pj+1,0,{
      id:generateId(), type:getDefaultType(sc.paragraphs[pj].type),
      text_elements:[{text:'',style:null}]
    });
    screenplay=screenplay;
    await tick();
    const newEl = elementRefs[`p-${si}-${pj+1}`];
    if (newEl) placeCaretAtStart(newEl);
  }

  async function insertAtEnd(){
    if(!screenplay?.scenes.length) return;
    syncAllVisibleText();
    const si=screenplay.scenes.length-1, sc=screenplay.scenes[si];
    sc.paragraphs.push({
      id:generateId(), type:getDefaultType(sc.paragraphs.at(-1).type),
      text_elements:[{text:'',style:null}]
    });
    screenplay=screenplay;
    await tick();
    const lastEl = document.getElementById(`p-${si}-${sc.paragraphs.length-1}`)
    if (lastEl) placeCaretAtStart(lastEl);
  }

  /* ───── MENU ────────────────────────────────────────────────────── */
  const toggleMenu=(i,j)=>menuState.update(ms=>
    ms.open&&ms.sceneIndex===i&&ms.paraIndex===j
      ?{open:false,sceneIndex:null,paraIndex:null}
      :{open:true,sceneIndex:i,paraIndex:j});
  function changeType(i,j,newType){
    const para=screenplay.scenes[i].paragraphs[j];
    if(para.type!==newType) para.type=newType;
    menuState.set({open:false,sceneIndex:null,paraIndex:null});
    screenplay=screenplay;
  }

  /* ───── GLOBAL LISTENERS ───────────────────────────────────────── */
  function handleGlobalKeydown(e){
    const mapped=keyToTypeMap[e.key.toLowerCase()];
    if(mapped && get(menuState).open){
      const {sceneIndex,paraIndex}=get(menuState);
      changeType(sceneIndex,paraIndex,mapped); e.preventDefault();
    }
  }
  const handleClickOutside=e=>{
    if(!e.target.closest('.menu')&&!e.target.closest('.type-menu'))
      menuState.set({open:false,sceneIndex:null,paraIndex:null});
  };
  onMount(()=>{
    document.addEventListener('click',handleClickOutside);
    document.addEventListener('keydown',handleGlobalKeydown);
    return()=>{document.removeEventListener('click',handleClickOutside);
               document.removeEventListener('keydown',handleGlobalKeydown);};
  });

  /* ───── PASTE → paragraphsFromLines (unchanged) ────────────────── */
  function paragraphsFromLines(lines){
    const tmp=Screenplay.fromPlain(lines.join('\n'),
      {markdown:true,allowFountain:true,cleanSpacing:false,cleanPaging:false});
    const out=[];
    tmp.scenes.forEach(s=>s.paragraphs.forEach(p=>
      out.push({id:generateId(),type:p.type,
        text_elements:p.text_elements.map(te=>({text:te.text,style:te.style??null}))})));
    return out;
  }
  function handlePaste(e,si,pj,para){
    const pasted=e.clipboardData?.getData('text/plain')??'';
    if(!pasted.includes('\n')) return; e.preventDefault();
    const caret=(()=>{const s=window.getSelection();return s?.anchorOffset??0})();
    const original=para.text_elements[0]?.text??'', before=original.slice(0,caret),
          after=original.slice(caret);
    const lines=pasted.replace(/\r/g,'').split('\n'); const first=lines.shift();
    para.text_elements=[{text:before+first,style:null}];
    elementRefs[`p-${si}-${pj}`].innerText=before+first;
    const newParas=lines.length?paragraphsFromLines(lines.map(l=>l.trimEnd())):[];
    if(after)(newParas.at(-1)??para).text_elements.push({text:after,style:null});
    if(newParas.length){
      screenplay.scenes[si].paragraphs.splice(pj+1,0,...newParas); screenplay=screenplay;
    }
    tick().then(()=>placeCaretAtStart(document.getElementById(`p-${si}-${pj+1}`)));
  }

  /* ───── MAIN EDIT KEYDOWN ──────────────────────────────────────── */
  function handleEditKeydown(e,i,j,para,elOverride=null){
    const el=elOverride||e.currentTarget, full=el.innerText, txt=full.trim();

    /* ENTER */
    if(e.key==='Enter'){
      e.preventDefault();
      const caret=(()=>{const s=window.getSelection();return s?.anchorOffset??full.length})();
      if(txt===''){toggleMenu(i,j);return;}
      if(caret===full.length){insertEmptyParagraph(i,j);return;}
      const before=full.slice(0,caret), after=full.slice(caret);
      syncAllVisibleText();
      screenplay.scenes[i].paragraphs[j].text_elements=[{text:before,style:null}];
      el.innerText=before;
      screenplay.scenes[i].paragraphs.splice(j+1,0,{id:generateId(),
        type:para.type,text_elements:[{text:after,style:null}]});
      screenplay=screenplay;
tick().then(() => {
  const newEl = document.getElementById(`p-${i}-${j + 1}`);
  if (newEl) placeCaretAtStart(newEl);   // caret at start of the new paragraph
});
      return;
    }

/* TAB ---------------------------------------------------------------- */
if (e.key === 'Tab') {
  e.preventDefault();

  if (txt === '') {
    para.type = getTabCycleType(para.type);
    screenplay = screenplay;
  } else {
    syncAllVisibleText();
    screenplay.scenes[i].paragraphs.splice(j + 1, 0, {
      id: generateId(),
      type: getTabInsertType(para.type),
      text_elements: [{ text: '', style: null }]
    });
    screenplay = screenplay;

    tick().then(() => {
      const newEl = document.getElementById(`p-${i}-${j + 1}`);
      if (newEl) placeCaretAtStart(newEl);
    });
  }
  return;
}

/* BACKSPACE at start of non‑empty paragraph → merge with previous */
if (e.key === 'Backspace' && txt !== '') {
  const sel = window.getSelection();
  if (sel && sel.anchorOffset === 0) {
    if (j === 0) return;          // first paragraph in scene
    e.preventDefault();

    syncAllVisibleText();
    const scene = screenplay.scenes[i];
    const prev  = scene.paragraphs[j - 1];
    const cur   = scene.paragraphs[j];

    /* text before merge (to know the split point) */
    const prevPlain = prev.text_elements.map(te => te.text).join('');
    const curPlain  = cur.text_elements.map(te => te.text).join('');
    const splitPos  = prevPlain.length;        // caret goes here later

    /* append cur text to prev paragraph */
    if (prev.text_elements.length &&
        prev.text_elements[prev.text_elements.length - 1].style === null) {
      prev.text_elements[prev.text_elements.length - 1].text += curPlain;
    } else {
      prev.text_elements.push({ text: curPlain, style: null });
    }

    /* update prev DOM */
    const prevEl = elementRefs[`p-${i}-${j - 1}`];
    if (prevEl) {
      prevEl.innerText = renderText(prev);
    }

    /* remove current paragraph */
    scene.paragraphs.splice(j, 1);
    screenplay = screenplay;

    tick().then(() => {
      const prevElAgain = document.getElementById(`p-${i}-${j - 1}`);
      if (prevElAgain) placeCaretAtOffset(prevElAgain, splitPos);
    });
    return;
  }
}


    /* BACKSPACE on empty */
    if(e.key==='Backspace' && txt===''){
      if(j===0) return; e.preventDefault();
      syncAllVisibleText();
      screenplay.scenes[i].paragraphs.splice(j,1); screenplay=screenplay;
      tick().then(()=>placeCaretAtEnd(document.getElementById(`p-${i}-${j-1}`)));
      return;
    }


    /* ARROW UP / DOWN */
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){
      const sel=window.getSelection(); if(!sel.rangeCount) return;
      const rect=sel.getRangeAt(0).getClientRects()[0]; if(!rect) return;
      const box=el.getBoundingClientRect();
      const atFirst=rect.top - box.top <3, atLast=box.bottom - rect.bottom <3;
      const caretX=rect.left;
      const moveCaret=(targetEl,y)=>{
        let pos=null;
        if(document.caretPositionFromPoint){
          const cp=document.caretPositionFromPoint(caretX,y);
          if(cp) pos={node:cp.offsetNode,offset:cp.offset};
        }
        if(!pos&&document.caretRangeFromPoint){
          const cr=document.caretRangeFromPoint(caretX,y);
          if(cr) pos={node:cr.startContainer,offset:cr.startOffset};
        }
        if(!pos) return;
        const r=document.createRange();
        r.setStart(pos.node,pos.offset); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r); targetEl.focus();
      };

      if(e.key==='ArrowUp' && atFirst){
        e.preventDefault();
        const target=j>0
          ? document.getElementById(`p-${i}-${j-1}`)
          : i>0 ? document.getElementById(`p-${i-1}-${screenplay.scenes[i-1].paragraphs.length-1}`) : null;
        if(target) moveCaret(target,target.getBoundingClientRect().bottom-2);
      }
      if(e.key==='ArrowDown' && atLast){
        e.preventDefault();
        const sc=screenplay.scenes[i];
        const target=j<sc.paragraphs.length-1
          ? document.getElementById(`p-${i}-${j+1}`)
          : i<screenplay.scenes.length-1 ? document.getElementById(`p-${i+1}-0`) : null;
        if(target) moveCaret(target,target.getBoundingClientRect().top+2);
      }
    }
  }

  /* ───── PAGE‑LEVEL DELEGATION ──────────────────────────────────── */
  const currentParaEl = () => {
    const sel=window.getSelection();
    const node=(sel.anchorNode instanceof Element? sel.anchorNode : sel.anchorNode?.parentElement);
    return node?.closest?.('.editable[data-id]');
  };
  function delegateKeydown(e){
    const el=currentParaEl(); if(!el) return;
    const [,si,pj]=/p-(\d+)-(\d+)/.exec(el.id)||[]; if(si==null) return;
    handleEditKeydown(e,+si,+pj, screenplay.scenes[+si].paragraphs[+pj], el);
  }
  function delegatePaste(e){
    const el=currentParaEl(); if(!el) return;
    const [,si,pj]=/p-(\d+)-(\d+)/.exec(el.id)||[]; if(si==null) return;
    handlePaste(e,+si,+pj, screenplay.scenes[+si].paragraphs[+pj]);
  }
    /* ─── caret & placeholder helpers ─────────────────────────────── */
    function ensureCaretable(el) {
    if (el.childNodes.length === 0) {            // give the div height/caret
        el.appendChild(document.createElement('br'));
    }
    }
    function placeCaretAtStart(el) {
    ensureCaretable(el);
    const r = document.createRange();
    r.setStart(el.childNodes[0], 0);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    el.focus();
    }
    function placeCaretAtEnd(el) {
    ensureCaretable(el);
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    el.focus();
    }
/* place caret at an absolute character offset inside el */
function placeCaretAtOffset(el, offset) {
  ensureCaretable(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remain = offset;
  while (node) {
    if (remain <= node.length) {
      const r = document.createRange();
      r.setStart(node, remain);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      el.focus();
      return;
    }
    remain -= node.length;
    node = walker.nextNode();
  }
  /* fallback */
  placeCaretAtEnd(el);
}
function renderText(para) {
  const raw = para.text_elements.map(te => te.text).join('');
  return (para.type === 'Scene Heading' || para.type === 'Character')
    ? raw.toUpperCase()
    : raw;
}
function handleInput(e, para) {
  if (para.type === 'Character') {
    // force current text to uppercase in the DOM
    const sel = window.getSelection();      // remember caret
    const offset = sel.anchorOffset;
    e.target.innerText = e.target.innerText.toUpperCase();
    // restore caret (end of text is fine)
    placeCaretAtEnd(e.target);
  }
  updateTextById(para.id, e.target.innerText);
}

</script>

<!-- ───── DESK + PAGE (single editable host) ─────────────────────── -->
<div class="desk">
  <div class="page" contenteditable on:keydown={delegateKeydown} on:paste={delegatePaste}>
    {#if screenplay}
      {#each screenplay.scenes as scene, i}
        <div id={`scene-${i}`} style="margin-bottom:2rem">
          {#each scene.paragraphs as para, j (para.id || (para.id = generateId()))}
            <div>
              <div class="paragraph">
                <!-- menu / type‑picker -->
                <div class="menu-container" contenteditable="false">
                  <span class="menu" on:click={() => toggleMenu(i,j)} contenteditable="false">⋮</span>
                  {#if $menuState.open && $menuState.sceneIndex===i && $menuState.paraIndex===j}
                    <div class="type-menu" contenteditable="false">
                      {#each Object.entries(keyToTypeMap) as [k,label]}
                        <div class="type-option" on:click={() => changeType(i,j,label)} contenteditable="false">
                          [{k.toUpperCase()}] {label}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>

                <!-- editable paragraph -->
                <div id={`p-${i}-${j}`} data-id={para.id}
                     use:storeRef={{key:`p-${i}-${j}`, para}}
                     class={`editable ${para.type.toLowerCase().replace(/\s+/g,'-')}`}
                     on:input={e => handleInput(e, para)}>
                </div>
              </div>

              {#if ['Dialogue','Action','Scene Heading','Transition'].includes(para.type)
                    && !(para.type==='Dialogue' && scene.paragraphs[j+1]?.type==='Parenthetical')}
                <div class="gap"></div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
      <div class="bottom-space" on:click={insertAtEnd}>+ Add element</div>
    {/if}
  </div>
</div>

<style>
  :root { --paper-bg:#fff; --desk-bg:#d83a3a; }
  .desk { width:100%; min-height:100vh; background:var(--desk-bg); }
  .page { width:61ch; padding:6rem 7rem; background:var(--paper-bg);
          border:1px solid #ddd; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
  * { font-family:'Courier New',monospace; line-height:1; }

  .scene-heading{ font-weight:bold; margin-top:1rem; text-align:left; }
  .character    { margin-left:20ch; font-weight:bold; text-transform:uppercase; text-align:left; }
  .parenthetical{ margin-left:14ch; font-style:italic; text-align:left; }
  .dialogue     { margin-left:10ch; text-align:left; }
  .transition   { text-align:right; font-weight:bold; }
  .action       { text-align:left; }

  .paragraph        { display:flex; align-items:flex-start; gap:0.5rem; margin-bottom:0; }
  .paragraph + .gap { margin-bottom:1em; }
  .paragraph:hover  { background:#f0f0f0; cursor:pointer; }

  .menu          { width:1rem; margin-right:0.5rem; cursor:pointer; }
  .menu-container{ position:relative; }

  .type-menu{
    position:absolute; right:100%; top:0; margin-right:0.5rem; background:#fff;
    border:1px solid #ccc; padding:0.3rem; z-index:10; font-size:0.9rem;
    box-shadow:0 0 5px rgba(0,0,0,0.2); white-space:nowrap;
  }
  .type-option     { padding:0.2rem 0.5rem; cursor:pointer; }
  .type-option:hover{ background:#eee; }

  .editable   { width:100%; outline:none; white-space:pre-wrap; }
  .bottom-space{
    height:100px; border-top:1px dashed #ccc; margin-top:2rem;
    text-align:center; cursor:pointer; color:gray;
  }
    .menu,
    .type-menu {
    user-select: none;        /* can’t highlight or copy */
    -webkit-user-select: none;
    }
</style>
