<script>
  import { onMount, tick } from 'svelte';
  import { writable, get } from 'svelte/store';
  import { Screenplay }   from './screenplay.js';

  /* Two‑way bound screenplay from parent */
  export let screenplay = null;

  /* ───── INTERNAL STATE ───────────────────────────────────────────── */
  const menuState   = writable({ open: false, sceneIndex: null, paraIndex: null });
  const elementRefs = {};

  const keyToTypeMap = {
    s: 'Scene Heading', a: 'Action', c: 'Character',
    p: 'Parenthetical', d: 'Dialogue', t: 'Transition'
  };

  /* ───── UTILITIES ────────────────────────────────────────────────── */
  const generateId = () =>
    crypto.randomUUID?.() || Math.random().toString(36).slice(2);

  function ensureParagraphIds() {
    screenplay?.scenes?.forEach(scene =>
      scene.paragraphs.forEach(p => (p.id ||= generateId())));
  }
  $: screenplay && ensureParagraphIds();   // run whenever screenplay changes

  function textOf(para) {
    return (para.text_elements || []).map(te => te.text).join('');
  }

  function storeRef(node, { key, para }) {
    if (!node) return;
    elementRefs[key] = node;

    if (node.innerText.trim() === '') {
      const full = textOf(para);
      node.innerText = para.type === 'Scene Heading' ? full.toUpperCase() : full;
    }
    return { destroy() { delete elementRefs[key]; } };
  }

  function updateTextById(id, newText) {
    for (const scene of screenplay.scenes) {
      const para = scene.paragraphs.find(p => p.id === id);
      if (para && newText !== textOf(para))
        para.text_elements = [{ text: newText, style: null }];
    }
  }

  function syncAllVisibleText() {
    document.querySelectorAll('.editable[data-id]').forEach(el => {
      const id   = el.dataset.id;
      const text = el.innerText ?? '';
      for (const scene of screenplay.scenes) {
        const para = scene.paragraphs.find(p => p.id === id);
        if (para && text !== para.text_elements[0]?.text)
          para.text_elements[0].text = text;
      }
    });
  }

  /* ───── TYPE HELPERS ─────────────────────────────────────────────── */
  const defaultAfter = { 'Scene Heading':'Action', 'Action':'Action',
                         'Dialogue':'Action', 'Character':'Dialogue',
                         'Parenthetical':'Dialogue', 'Transition':'Scene Heading' };
  function getDefaultType(prev) { return defaultAfter[prev] ?? 'Action'; }

  const tabCycleMap = { 'Scene Heading':'Action', 'Action':'Character', 'Character':'Transition',
                        'Transition':'Scene Heading', 'Dialogue':'Parenthetical', 'Parenthetical':'Dialogue' };
  const getTabCycleType  = cur => tabCycleMap[cur] ?? 'Action';
  const getTabInsertType = cur => (cur === 'Character' ? 'Parenthetical' : getDefaultType(cur));

  /* ───── INSERT / REMOVE PARAGRAPHS ───────────────────────────────── */
  async function insertEmptyParagraph(si, pj) {
    syncAllVisibleText();
    const scene     = screenplay.scenes[si];
    const prevPara  = scene.paragraphs[pj];
    const newPara   = { id: generateId(), type: getDefaultType(prevPara.type),
                        text_elements:[{ text:'', style:null }] };
    scene.paragraphs.splice(pj + 1, 0, newPara);
    screenplay = screenplay;   // trigger reactivity
    await tick();
    elementRefs[`p-${si}-${pj+1}`]?.focus();
  }

  async function insertAtEnd() {
    if (!screenplay?.scenes.length) return;
    syncAllVisibleText();
    const si        = screenplay.scenes.length - 1;
    const scene     = screenplay.scenes[si];
    const lastPara  = scene.paragraphs.at(-1);
    scene.paragraphs.push({ id: generateId(), type: getDefaultType(lastPara.type),
                            text_elements:[{ text:'', style:null }] });
    screenplay = screenplay;
    await tick();
    document.getElementById(`p-${si}-${scene.paragraphs.length-1}`)?.focus();
  }

  /* ───── MENU & KEY HANDLING ──────────────────────────────────────── */
  function toggleMenu(i, j) {
    menuState.update(cs =>
      cs.open && cs.sceneIndex === i && cs.paraIndex === j
        ? { open:false, sceneIndex:null, paraIndex:null }
        : { open:true,  sceneIndex:i,  paraIndex:j   });
  }

  function changeType(i, j, newType) {
    const para = screenplay.scenes[i].paragraphs[j];
    if (para.type !== newType) para.type = newType;
    menuState.set({ open:false, sceneIndex:null, paraIndex:null });
    screenplay = screenplay;
  }

  function handleClickOutside(e) {
    if (!e.target.closest('.menu') && !e.target.closest('.type-menu'))
      menuState.set({ open:false, sceneIndex:null, paraIndex:null });
  }

  function handleKeydown(e) {
    const k = e.key.toLowerCase();
    const t = keyToTypeMap[k];
    if (t && get(menuState).open) {
      const { sceneIndex, paraIndex } = get(menuState);
      changeType(sceneIndex, paraIndex, t);
      e.preventDefault();
    }    
  }
function handlePaste(e, sceneIdx, paraIdx, para) {
  const pasted = e.clipboardData?.getData('text/plain') ?? '';
  if (!pasted.includes('\n')) return;                // single line → native paste
  e.preventDefault();

  /* ── split the current paragraph at the caret ──────────────────── */
  const sel   = window.getSelection();
  const caret = sel && sel.anchorOffset != null ? sel.anchorOffset : 0;
  const original = para.text_elements[0]?.text ?? '';
  const before   = original.slice(0, caret);
  const after    = original.slice(caret);

  /* ── first pasted line stays in current paragraph ──────────────── */
  const allLines  = pasted.replace(/\r/g, '').split('\n');
  const firstLine = allLines.shift();

  const newCurrent = before + firstLine;
  para.text_elements = [{ text: newCurrent, style: null }];
  elementRefs[`p-${sceneIdx}-${paraIdx}`].innerText = newCurrent;

  /* ── EACH remaining line becomes its own parsed paragraph(s) ───── */
  const remainingLines = allLines.map(l => l.trimEnd());
  const newParas = remainingLines.length
    ? paragraphsFromLines(remainingLines)   // ← parses character / dialogue correctly
    : [];

  /* ── append any text that was after the caret ──────────────────── */
  if (after) {
    if (newParas.length) {
      newParas[newParas.length - 1].text_elements.push({ text: after, style: null });
    } else {
      newParas.push({
        id: generateId(),
        type: para.type,
        text_elements: [{ text: after, style: null }]
      });
    }
  }

  /* ── insert the new paragraphs right after the current one ─────── */
  if (newParas.length) {
    const scene = screenplay.scenes[sceneIdx];
    scene.paragraphs.splice(paraIdx + 1, 0, ...newParas);
    screenplay = screenplay;
  }

  /* ── place caret at start of the first newly inserted paragraph ── */
  tick().then(() => {
    const targetEl = document.getElementById(`p-${sceneIdx}-${paraIdx + 1}`);
    if (targetEl) {
      const range = document.createRange();
      range.setStart(targetEl.childNodes[0] || targetEl, 0);
      range.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      targetEl.focus();
    }
  });
}


  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
    };
  });

/* turn raw lines into plain‑object paragraphs using screenplay.js */
function paragraphsFromLines(lines) {
  /* keep each pasted line separate → cleanSpacing:false */
  const temp = Screenplay.fromPlain(
    lines.join('\n'),
    { markdown: true, allowFountain: true, cleanSpacing: false, cleanPaging: false }
  );

  const out = [];
  temp.scenes.forEach(s =>
    s.paragraphs.forEach(p =>
      out.push({
        id:            generateId(),
        type:          p.type,
        text_elements: p.text_elements.map(te => ({ text: te.text, style: te.style ?? null }))
      })
    )
  );
  return out;
}


</script>

<!-- ───── DESK + PAGE WRAPPER (no assumptions about layout) ─────────── -->
<div class="desk">
  <div class="page">
    {#if screenplay}
      {#each screenplay.scenes as scene, i}
        <div id={`scene-${i}`} style="margin-bottom: 2rem">
          {#each scene.paragraphs as para, j (para.id)}
            <div>
              <div class="paragraph">
                <div class="menu-container">
                  <span class="menu" on:click={() => toggleMenu(i, j)}>⋮</span>
                  {#if $menuState.open && $menuState.sceneIndex === i && $menuState.paraIndex === j}
                    <div class="type-menu">
                      {#each Object.entries(keyToTypeMap) as [k, label]}
                        <div class="type-option" on:click={() => changeType(i, j, label)}>
                          [{k.toUpperCase()}] {label}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>

                <div
                  id={`p-${i}-${j}`}
                  data-id={para.id}
                  use:storeRef={{ key:`p-${i}-${j}`, para }}
                  class={`editable ${para.type.toLowerCase().replace(/\s+/g, '-')}`}
                  contenteditable
                  on:input={(e) => updateTextById(para.id, e.target.innerText)}

on:keydown={(e) => {
  const el   = e.currentTarget;
  const full = el.innerText;          /* raw text including spaces     */
  const txt  = full.trim();           /* quick “is this blank?” check  */

  /* ──────────────────────────  ENTER  ────────────────────────────── */
  if (e.key === 'Enter') {
    e.preventDefault();

    const sel   = window.getSelection();
    const caret = sel && sel.anchorOffset != null ? sel.anchorOffset : full.length;

    /* (1) empty element → open type menu */
    if (txt === '') {
      toggleMenu(i, j);
      return;
    }

    /* (2) caret at end → insert blank paragraph (default‑after rules) */
    if (caret === full.length) {
      insertEmptyParagraph(i, j);
      return;
    }

    /* (3) caret mid‑text → split paragraph, keep SAME type ---------- */
    const before = full.slice(0, caret);
    const after  = full.slice(caret);

    syncAllVisibleText();
    const scene = screenplay.scenes[i];

    /* update current paragraph */
    scene.paragraphs[j].text_elements = [{ text: before, style: null }];
    el.innerText = before;                         /* update DOM now    */

    /* new paragraph with identical type */
    scene.paragraphs.splice(j + 1, 0, {
      id: generateId(),
      type: para.type,
      text_elements: [{ text: after, style: null }]
    });
    screenplay = screenplay;

    tick().then(() => {
      const newEl = document.getElementById(`p-${i}-${j + 1}`);
      if (newEl) {
        const r = document.createRange();
        r.setStart(newEl.childNodes[0] || newEl, 0);  /* caret at start */
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        newEl.focus();
      }
    });
  }

  /* ───────────────────────────  TAB  ─────────────────────────────── */
  else if (e.key === 'Tab') {
    e.preventDefault();

    if (txt === '') {
      /* cycle current paragraph type */
      para.type = getTabCycleType(para.type);
      screenplay = screenplay;
    } else {
      /* insert paragraph using tab‑insert rules */
      syncAllVisibleText();
      const scene = screenplay.scenes[i];
      scene.paragraphs.splice(j + 1, 0, {
        id: generateId(),
        type: getTabInsertType(para.type),
        text_elements: [{ text: '', style: null }]
      });
      screenplay = screenplay;
      tick().then(() => document.getElementById(`p-${i}-${j + 1}`)?.focus());
    }
  }

  /* ──────────────────────  BACKSPACE on empty  ───────────────────── */
  else if (e.key === 'Backspace' && txt === '') {
    if (j === 0) return;               /* never delete 1st para in scene */
    e.preventDefault();

    syncAllVisibleText();
    screenplay.scenes[i].paragraphs.splice(j, 1);
    screenplay = screenplay;

    tick().then(() => {
      const prev = document.getElementById(`p-${i}-${j - 1}`);
      if (prev) {
        const r = document.createRange();
        r.selectNodeContents(prev);
        r.collapse(false);             /* caret at end of previous para  */
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        prev.focus();
      }
    });
  }

  /* ────────────────────────  ARROW UP / DOWN  ────────────────────── */
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    /* helper: caret rectangle & line position */
    function caretInfo() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      const range     = sel.getRangeAt(0).cloneRange();
      const rects     = range.getClientRects();
      const caretRect = rects[0];                 /* first rect of caret */
      if (!caretRect) return null;
      const elRect = el.getBoundingClientRect();
      return {
        caretX: caretRect.left,
        atFirst: Math.abs(caretRect.top - elRect.top) < 2,
        atLast:  Math.abs(caretRect.bottom - elRect.bottom) < 2
      };
    }

    const info = caretInfo();
    if (!info) return;  /* fallback to native behaviour */

    /* util: move caret to a given (x, y) inside targetEl */
    function placeCaretAt(targetEl, x, y) {
      const pos = document.caretPositionFromPoint
        ? document.caretPositionFromPoint(x, y)
        : document.caretRangeFromPoint
          ? document.caretRangeFromPoint(x, y)
          : null;

      if (pos) {
        const r = document.createRange();
        if ('offsetNode' in pos) {          /* CaretPosition */
          r.setStart(pos.offsetNode, pos.offset);
        } else {                            /* Range from caretRangeFromPoint */
          r.setStart(pos.startContainer, pos.startOffset);
        }
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
      targetEl.focus();
    }

    /* move UP if caret on first line */
    if (e.key === 'ArrowUp' && info.atFirst) {
      e.preventDefault();
      let targetEl = null;

      if (j > 0) {
        targetEl = document.getElementById(`p-${i}-${j - 1}`);
      } else if (i > 0) {
        const prevScene = screenplay.scenes[i - 1];
        const prevIdx   = prevScene.paragraphs.length - 1;
        targetEl = document.getElementById(`p-${i - 1}-${prevIdx}`);
      }

      if (targetEl) {
        const trgRect = targetEl.getBoundingClientRect();
        placeCaretAt(targetEl, info.caretX, trgRect.bottom - 2);  /* near end line */
      }
    }

    /* move DOWN if caret on last line */
    if (e.key === 'ArrowDown' && info.atLast) {
      e.preventDefault();
      let targetEl = null;

      const scene = screenplay.scenes[i];
      if (j < scene.paragraphs.length - 1) {
        targetEl = document.getElementById(`p-${i}-${j + 1}`);
      } else if (i < screenplay.scenes.length - 1) {
        targetEl = document.getElementById(`p-${i + 1}-0`);
      }

      if (targetEl) {
        const trgRect = targetEl.getBoundingClientRect();
        placeCaretAt(targetEl, info.caretX, trgRect.top + 2);     /* near first line */
      }
    }
  }
}}

                on:paste={e => handlePaste(e, i, j, para)}  




                ></div>
              </div>

              {#if (['Dialogue','Action','Scene Heading','Transition'].includes(para.type)
                    && !(para.type === 'Dialogue'
                         && scene.paragraphs[j+1]?.type === 'Parenthetical'))}
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
  :root {
    --paper-bg:#fff;
    --desk-bg: #d83a3a;
  }

  /* ── DESK + “PAGE” -------------------------------------------------- */
  .desk { width:100%; min-height:100vh; background:var(--desk-bg); }
  .page { width:61ch; margin:0; padding:6rem 7rem; background:var(--paper-bg);
          border:1px solid #ddd; box-shadow:0 2px 8px rgba(0,0,0,0.15); }

  /* ── GLOBAL TEXT STYLE --------------------------------------------- */
  * { font-family:'Courier New',monospace; line-height:1; }

  /* ── PARAGRAPH‑TYPE STYLES ----------------------------------------- */
    .scene-heading {
    /* font-size:1.2rem;               ← remove the enlargement  */
    font-weight: bold;
    margin-top: 1rem;
    text-align: left;
    }
  .character     { margin-left:20ch; font-weight:bold; text-transform:uppercase; text-align:left; }
  .parenthetical { margin-left:14ch; font-style:italic; text-align:left; }
  .dialogue      { margin-left:10ch; text-align:left; }
  .transition    { text-align:right; font-weight:bold; }

  /* ── STRUCTURE & INTERACTION --------------------------------------- */
  .paragraph        { display:flex; align-items:flex-start; gap:0.5rem; margin-bottom:0; }
  .paragraph + .gap { margin-bottom:1em; }
  .paragraph:hover  { background:#f0f0f0; cursor:pointer; }

  .menu           { width:1rem; margin-right:0.5rem; line-height:1; cursor:pointer; }
  .menu-container { position:relative; }

  .type-menu {
    position:absolute; right:100%; top:0; margin-right:0.5rem; background:#fff;
    border:1px solid #ccc; padding:0.3rem; z-index:10; font-size:0.9rem;
    box-shadow:0 0 5px rgba(0,0,0,0.2); white-space:nowrap;
  }
  .type-option      { padding:0.2rem 0.5rem; cursor:pointer; }
  .type-option:hover{ background:#eee; }

  .editable { width:100%; outline:none; white-space:pre-wrap; }

  .bottom-space {
    height:100px; border-top:1px dashed #ccc; margin-top:2rem;
    text-align:center; cursor:pointer; color:gray;
  }

  .action { text-align: left; }   /*‑ keeps ACTION paragraphs flush left */

</style>
