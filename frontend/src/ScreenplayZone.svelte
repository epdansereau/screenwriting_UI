<script>
  import { onMount, tick } from 'svelte';
  import { writable, get } from 'svelte/store';
  import { Screenplay, Paragraph, TextElement } from './screenplay.js';

  /* ───── PUBLIC PROP (two‑way bound) ─────────────────────────────── */
  export let screenplay = null;
  export let paddingTop = '3rem';
  export let paddingBottom = '3rem';

  /* ───── UTILITIES ───────────────────────────────────────────────── */
  const generateId = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2);

  /*  Every ScreenplayZone instance gets its own prefix so *nothing*
      collides when several are on the same page.                       */
  const compId   = generateId();

  /* elementRefs maps <paragraph‑id string> → DOM element */
  const elementRefs = {};
  const elOf = id => elementRefs[id] ||
                     document.querySelector(`.editable[data-id="${id}"]`);

  /* make the first paragraph focusable from the parent */
  export function focusFirstElement () {
    tick().then(() => {
      const firstId = screenplay?.scenes?.[0]?.paragraphs?.[0]?.id;
      if (!firstId) return;
      const el = elOf(firstId);
      if (el) placeCaretAtStart(el);
    });
  }

  /* push new text to every element that represents the same paragraph id */
  function mirrorTextToTwins(id, newText, originEl) {
    document.querySelectorAll(`.editable[data-id="${id}"]`).forEach(el => {
      if (el !== originEl && el.innerText !== newText) el.innerText = newText;
    });
  }

  const makeEmptyPara = (type='Action') =>
    new Paragraph(type, [new TextElement('', null)]);

  /* ───── INTERNAL STATE ──────────────────────────────────────────── */
  const menuState = writable({ open:false, sceneIndex:null, paraIndex:null });
  const keyToTypeMap = {
    s:'Scene Heading', a:'Action', c:'Character',
    p:'Parenthetical', d:'Dialogue', t:'Transition'
  };

  /* ensure every paragraph carries a UUID (once per reactive cycle) */
  function ensureParagraphIds () {
    screenplay?.scenes?.forEach(sc =>
      sc.paragraphs.forEach(p => (p.id ||= generateId())));
  }
  $: ensureParagraphIds();

  /* ───── DOM <-> model helpers ───────────────────────────────────── */
  function storeRef (node, para) {
    if (!node) return;
    elementRefs[para.id] = node;
    if (node.innerText.trim() === '') node.innerText = renderText(para);
    return { destroy () { delete elementRefs[para.id]; } };
  }

  const textOf = para => (para.text_elements ?? [])
                         .map(te => te.text).join('');

function updateTextById(id, newText, originEl = null) {
  let changed = false;
  for (const sc of screenplay.scenes) {
    const para = sc.paragraphs.find(p => p.id === id);
    if (para && newText !== textOf(para)) {
      para.text_elements = [new TextElement(newText, null)];
      changed = true;
      break;
    }
  }
  if (changed) {
    /* update the twins right away */
    mirrorTextToTwins(id, newText, originEl);

    /* notify parent so every bound component re‑runs its reactive blocks */
    screenplay = screenplay;
  }
}

  function syncAllVisibleText () {
    document.querySelectorAll('.editable[data-id]').forEach(el => {
      updateTextById(el.dataset.id, el.innerText ?? '');
    });
  }

  /* ───── TYPE helpers (unchanged) ───────────────────────────────── */
  const defaultAfter = {
    'Scene Heading':'Action', 'Action':'Action', 'Dialogue':'Action',
    'Character':'Dialogue',  'Parenthetical':'Dialogue', 'Transition':'Scene Heading'
  };
  const tabCycleMap = {
    'Scene Heading':'Action','Action':'Character','Character':'Transition',
    'Transition':'Scene Heading','Dialogue':'Parenthetical','Parenthetical':'Dialogue'
  };
  const getDefaultType  = prev => defaultAfter[prev] ?? 'Action';
  const getTabCycleType = cur  => tabCycleMap[cur] ?? 'Action';
  const getTabInsertType = cur =>
        cur === 'Character' ? 'Parenthetical' : getDefaultType(cur);

  /* ───── PARAGRAPH INSERT/REMOVE ─────────────────────────────────── */
  async function insertEmptyParagraph (si, pj) {
    syncAllVisibleText();
    const sc   = screenplay.scenes[si];
    const newP = makeEmptyPara(getDefaultType(sc.paragraphs[pj].type));
    newP.id    = generateId();
    sc.paragraphs.splice(pj + 1, 0, newP);
    screenplay  = screenplay;
    await tick();
    placeCaretAtStart(elOf(newP.id));
  }

  /* ───── MENU ───────────────────────────────────────────────────── */
  const toggleMenu = (i, j) => menuState.update(ms =>
    (ms.open && ms.sceneIndex === i && ms.paraIndex === j)
      ? { open:false, sceneIndex:null, paraIndex:null }
      : { open:true,  sceneIndex:i,    paraIndex:j   });

  function changeType (i, j, newType) {
    const para = screenplay.scenes[i].paragraphs[j];
    if (para.type !== newType) para.type = newType;
    menuState.set({ open:false, sceneIndex:null, paraIndex:null });
    screenplay = screenplay;
  }

  /* ───── GLOBAL LISTENERS ───────────────────────────────────────── */
  function handleGlobalKeydown (e) {
    const mapped = keyToTypeMap[e.key.toLowerCase()];
    if (mapped && get(menuState).open) {
      const { sceneIndex, paraIndex } = get(menuState);
      changeType(sceneIndex, paraIndex, mapped);
      e.preventDefault();
    }
  }
  const handleClickOutside = e => {
    if (!e.target.closest('.menu') && !e.target.closest('.type-menu'))
      menuState.set({ open:false, sceneIndex:null, paraIndex:null });
  };

  onMount(() => {
    document.addEventListener('click',  handleClickOutside);
    document.addEventListener('keydown', handleGlobalKeydown);
    focusFirstElement();

    return () => {
      document.removeEventListener('click',  handleClickOutside);
      document.removeEventListener('keydown', handleGlobalKeydown);
    };
  });

  /* ───── PASTE helper ───────────────────────────────────────────── */
  function paragraphsFromLines (lines) {
    const tmp = Screenplay.fromPlain(
      lines.join('\n'),
      { markdown:true, allowFountain:true,
        cleanSpacing:false, cleanPaging:false }
    );
    const out = [];
    tmp.scenes.forEach(scene =>
      scene.paragraphs.forEach(p => {
        const copy = new Paragraph(
          p.type,
          p.text_elements.map(te => new TextElement(te.text, te.style ?? null))
        );
        copy.id = generateId();
        out.push(copy);
      }));
    return out;
  }
  /* ───── PASTE handler (now mirrors first‑line edits) ────────────── */
  function handlePaste(e, si, pj, para) {
    const pasted = e.clipboardData?.getData('text/plain') ?? '';
    if (!pasted.includes('\n')) return;            // let simple paste pass through
    e.preventDefault();

    /* split original paragraph around the caret                       */
    const caret = (() => {
      const s = window.getSelection();
      return s?.anchorOffset ?? 0;
    })();
    const original = para.text_elements[0]?.text ?? '';
    const before   = original.slice(0, caret);
    const after    = original.slice(caret);

    /* first line stays in this paragraph ─ others become new Paras    */
    const lines = pasted.replace(/\r/g, '').split('\n');
    const first = lines.shift();

    const newFirstText = before + first;
    para.text_elements = [ new TextElement(newFirstText, null) ];

    /* update DOM in *both* panes immediately                          */
    const originEl = elOf(para.id);
    if (originEl) originEl.innerText = newFirstText;
    mirrorTextToTwins(para.id, newFirstText, originEl);

    /* turn the remaining lines into fresh Paragraph objects           */
    const newParas = lines.length
        ? paragraphsFromLines(lines.map(l => l.trimEnd()))
        : [];

    /* append the tail (after‑caret) to the last new paragraph (or this one) */
    if (after)
      (newParas.at(-1) ?? para)
        .text_elements.push(new TextElement(after, null));

    /* splice the new paragraphs into the screenplay model             */
    if (newParas.length)
      screenplay.scenes[si].paragraphs.splice(pj + 1, 0, ...newParas);

    /* 🔔 fire Svelte reactivity so every bound component updates      */
    screenplay = screenplay;

    /* place caret at the start of the first newly‑created paragraph   */
    tick().then(() => {
      const nextPara = screenplay.scenes[si].paragraphs[pj + 1];
      if (nextPara) placeCaretAtStart(elOf(nextPara.id));
    });
  }


  /* ───── MAIN EDIT KEYDOWN (id‑independent) ─────────────────────── */
  function handleEditKeydown (e, i, j, para, elOverride = null) {
    const el   = elOverride || e.currentTarget;
    const full = el.innerText;
    const txt  = full.trim();

    /* ——— ENTER ——————————————————————————— */
    if (e.key === 'Enter') {
      e.preventDefault();
      const caret = (() => {
        const s = window.getSelection();
        return s?.anchorOffset ?? full.length;
      })();

      if (txt === '')                 { toggleMenu(i, j); return; }
      if (caret === full.length)      { insertEmptyParagraph(i, j); return; }

      const before = full.slice(0, caret);
      const after  = full.slice(caret);

      syncAllVisibleText();

      screenplay.scenes[i].paragraphs[j]
        .text_elements = [ new TextElement(before, null) ];
      el.innerText = before;

      const splitPara = new Paragraph(para.type, [ new TextElement(after, null) ]);
      splitPara.id    = generateId();
      screenplay.scenes[i].paragraphs.splice(j + 1, 0, splitPara);
      screenplay = screenplay;

      tick().then(() => placeCaretAtStart(elOf(splitPara.id)));
      return;
    }

    /* ——— TAB ———————————————————————————— */
    if (e.key === 'Tab') {
      e.preventDefault();

      if (txt === '') {
        para.type  = getTabCycleType(para.type);
        screenplay = screenplay;
      } else {
        syncAllVisibleText();
        const newPara = makeEmptyPara(getTabInsertType(para.type));
        newPara.id    = generateId();
        screenplay.scenes[i].paragraphs.splice(j + 1, 0, newPara);
        screenplay = screenplay;

        tick().then(() => placeCaretAtStart(elOf(newPara.id)));
      }
      return;
    }

    /* ——— BACKSPACE @ start of non‑empty para → merge up ——— */
    if (e.key === 'Backspace' && txt !== '') {
      const sel = window.getSelection();
      if (sel && sel.anchorOffset === 0) {
        if (j === 0) return;                         // top of scene

        e.preventDefault();
        syncAllVisibleText();

        const scene = screenplay.scenes[i];
        const prev  = scene.paragraphs[j - 1];
        const cur   = scene.paragraphs[j];

        const splitPos = textOf(prev).length;
        prev.text_elements.push(...cur.text_elements);
        const prevEl = elOf(prev.id);
        if (prevEl) prevEl.innerText = renderText(prev);

        scene.paragraphs.splice(j, 1);               // drop current
        screenplay = screenplay;

        tick().then(() => {
          const prevElAgain = elOf(prev.id);
          if (prevElAgain) placeCaretAtOffset(prevElAgain, splitPos);
        });
        return;
      }
    }

    /* ——— BACKSPACE on completely empty para ——— */
    if (e.key === 'Backspace' && txt === '') {
      e.preventDefault();
      if (j === 0) return;

      syncAllVisibleText();
      screenplay.scenes[i].paragraphs.splice(j, 1);
      screenplay = screenplay;

      tick().then(() => {
        const prevPara = screenplay.scenes[i].paragraphs[j - 1];
        if (prevPara) placeCaretAtEnd(elOf(prevPara.id));
      });
      return;
    }

    /* ——— ARROW navigation ——— */
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const sel  = window.getSelection(); if (!sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getClientRects()[0]; if (!rect) return;
      const box  = el.getBoundingClientRect();

      const atFirst = rect.top    - box.top    < 3;
      const atLast  = box.bottom  - rect.bottom < 3;
      const caretX  = rect.left;

      const moveCaret = (targetEl, y) => {
        let pos = null;
        if (document.caretPositionFromPoint) {
          const cp = document.caretPositionFromPoint(caretX, y);
          if (cp) pos = { node:cp.offsetNode, offset:cp.offset };
        } else if (document.caretRangeFromPoint) {
          const cr = document.caretRangeFromPoint(caretX, y);
          if (cr) pos = { node:cr.startContainer, offset:cr.startOffset };
        }
        if (!pos) return;

        const r = document.createRange();
        r.setStart(pos.node, pos.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        targetEl.focus();
      };

      const scene = screenplay.scenes[i];

      if (e.key === 'ArrowUp' && atFirst) {
        e.preventDefault();
        const targetPara = j > 0
          ? scene.paragraphs[j - 1]
          : i > 0 ? screenplay.scenes[i - 1].paragraphs.at(-1) : null;
        if (targetPara)
          moveCaret(elOf(targetPara.id),
                    elOf(targetPara.id).getBoundingClientRect().bottom - 2);
      }
      if (e.key === 'ArrowDown' && atLast) {
        e.preventDefault();
        const targetPara = j < scene.paragraphs.length - 1
          ? scene.paragraphs[j + 1]
          : i < screenplay.scenes.length - 1 ? screenplay.scenes[i + 1].paragraphs[0] : null;
        if (targetPara)
          moveCaret(elOf(targetPara.id),
                    elOf(targetPara.id).getBoundingClientRect().top + 2);
      }
    }
  }

  /* ───── PAGE‑LEVEL DELEGATION (dataset‑driven) ─────────────────── */
  const currentParaEl = () => {
    const sel  = window.getSelection();
    const node = sel.anchorNode instanceof Element
               ? sel.anchorNode
               : sel.anchorNode?.parentElement;
    return node?.closest?.('.editable[data-id]');
  };

  function delegateKeydown (e) {
    const el = currentParaEl();  if (!el) return;
    const si = +el.dataset.si,   pj = +el.dataset.pj;
    handleEditKeydown(e, si, pj, screenplay.scenes[si].paragraphs[pj], el);
  }
  function delegatePaste (e)  {
    const el = currentParaEl();  if (!el) return;
    const si = +el.dataset.si,   pj = +el.dataset.pj;
    handlePaste(e, si, pj, screenplay.scenes[si].paragraphs[pj]);
  }
  function delegateInput (e) {
    const el = currentParaEl();          if (!el) return;
    updateTextById(el.dataset.id, el.innerText, el);
  }

/* ─── caret helpers ─────────────────────────────────────────────── */
function ensureCaretable(el) {
  if (el.childNodes.length === 0) el.appendChild(document.createElement('br'));
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
/* absolute character offset inside <el> → move caret there */
function placeCaretAtOffset(el, offset) {
  ensureCaretable(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode(), remain = offset;
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

/* ─── render helper ─────────────────────────────────────────────── */
function renderText(para) {
  const raw = para.text_elements.map(te => te.text).join('');
  return (para.type === 'Scene Heading' || para.type === 'Character')
    ? raw.toUpperCase()
    : raw;
}

/* ─── multi‑paragraph selection helpers ─────────────────────────── */
/* absolute offset of (node,offset) inside its paragraph <el> */
function caretOffsetIn(el, node, offset) {
  const r = document.createRange();
  r.setStart(el, 0);
  try { r.setEnd(node, offset); }            // up to the caret
  catch { r.selectNodeContents(el); r.collapse(false); }
  return r.toString().length;
}

/* returns info when selection spans ≥2 .editable blocks, else null */
function multiParaSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range   = sel.getRangeAt(0);
  const startEl = (range.startContainer instanceof Element
                   ? range.startContainer
                   : range.startContainer.parentElement)?.closest('.editable[data-id]');
  const endEl   = (range.endContainer   instanceof Element
                   ? range.endContainer
                   : range.endContainer.parentElement)?.closest('.editable[data-id]');
  if (!startEl || !endEl || startEl === endEl) return null;

  return {
    startEl, endEl,
    si1: +startEl.dataset.si, pj1: +startEl.dataset.pj,
    si2: +endEl.dataset.si,   pj2: +endEl.dataset.pj,
    startOffset: caretOffsetIn(startEl, range.startContainer, range.startOffset),
    endOffset  : caretOffsetIn(endEl,   range.endContainer,   range.endOffset )
  };
}

/* merge / replace text across a multi‑para selection */
function handleMultiParaEdit(e, s) {
  e.preventDefault();          // keep DOM intact
  syncAllVisibleText();        // model ← DOM

  const {si1, pj1, si2, pj2, startOffset, endOffset} = s;
  const startPara = screenplay.scenes[si1].paragraphs[pj1];
  const endPara   = screenplay.scenes[si2].paragraphs[pj2];

  const before = textOf(startPara).slice(0, startOffset);
  const after  = textOf(endPara  ).slice(endOffset);

  const inserted = (e.key === 'Backspace' || e.key === 'Delete')
                   ? ''
                   : (e.key.length === 1 ? e.key : '');

  /* 1️⃣ update first paragraph’s text */
  startPara.text_elements = [ new TextElement(before + inserted + after, null) ];
  elOf(startPara.id).innerText = before + inserted + after;

  /* 2️⃣ delete everything between start+1 … end (inclusive) */
  for (let si = si2; si >= si1; si--) {
    const scene = screenplay.scenes[si];
    if (si === si1 && si === si2) {                      // same scene
      scene.paragraphs.splice(pj1 + 1, pj2 - pj1);
    } else if (si === si1) {                             // first scene tail
      scene.paragraphs.splice(pj1 + 1);
    } else if (si === si2) {                             // last scene head
      scene.paragraphs.splice(0, pj2 + 1);
    } else {                                             // whole scene removed
      scene.paragraphs.splice(0);
    }
  }

  /* 3️⃣ re‑render, then restore caret */
  screenplay = screenplay;
  tick().then(() =>
    placeCaretAtOffset(elOf(startPara.id), (before + inserted).length));
}
</script>


<!-- ───── DESK + PAGE (single editable host) ─────────────────────── -->
<div class="desk" style="padding-top: {paddingTop}; padding-bottom: {paddingBottom};">
  <div class="page" contenteditable on:keydown={delegateKeydown} on:paste={delegatePaste} on:input={delegateInput}>
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
                <div
                  id={`p-${compId}-${para.id}`}
                  data-id={para.id}
                  data-si={i}
                  data-pj={j}
                  use:storeRef={para}
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
    {/if}
  </div>
</div>

<style>
  :root { --paper-bg:#fff; --desk-bg:#ccc; }
    .desk {
    width: 100%;
    min-height: 100vh;
    background: var(--desk-bg);
    padding-left: 6rem;
    padding-right: 6rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
    }
    .page {
    width: 61ch;
    padding: 6rem 7rem;
    background: var(--paper-bg);
    border: 1px solid #ddd;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    min-height: calc(1em * 51 + 12rem);
    }
  * { font-family:'Courier New',monospace; line-height:1; }

  /* paragraph type styles (unchanged) */
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
    .menu,
     .type-menu {
     user-select: none;        /* can’t highlight or copy */
     -webkit-user-select: none;
     }
</style>
