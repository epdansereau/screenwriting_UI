<script>
  import { onMount, tick } from 'svelte';
  import { writable, get } from 'svelte/store';
  import { Screenplay }   from './screenplay.js';

  /* ───── PUBLIC PROP ─────────────────────────────────────────────── */
  export let screenplay = null;        // two‑way bound from the parent

  /* ───── INTERNAL STATE ──────────────────────────────────────────── */
  const menuState   = writable({ open: false, sceneIndex: null, paraIndex: null });
  const elementRefs = {};

  const keyToTypeMap = {
    s: 'Scene Heading', a: 'Action', c: 'Character',
    p: 'Parenthetical', d: 'Dialogue', t: 'Transition'
  };

  /* ───── UTILITIES ───────────────────────────────────────────────── */
  const generateId = () =>
    crypto.randomUUID?.() || Math.random().toString(36).slice(2);

  function ensureParagraphIds() {
    screenplay?.scenes?.forEach(scene =>
      scene.paragraphs.forEach(p => (p.id ||= generateId())));
  }
  $: screenplay && ensureParagraphIds();

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
  const getDefaultType = prev => defaultAfter[prev] ?? 'Action';

  const tabCycleMap = { 'Scene Heading':'Action', 'Action':'Character', 'Character':'Transition',
                        'Transition':'Scene Heading', 'Dialogue':'Parenthetical', 'Parenthetical':'Dialogue' };
  const getTabCycleType  = cur => tabCycleMap[cur] ?? 'Action';
  const getTabInsertType = cur => (cur === 'Character' ? 'Parenthetical' : getDefaultType(cur));

  /* ───── INSERT / REMOVE PARAGRAPHS ───────────────────────────────── */
  async function insertEmptyParagraph(si, pj) {
    syncAllVisibleText();
    const scene = screenplay.scenes[si];
    const newPara = {
      id: generateId(),
      type: getDefaultType(scene.paragraphs[pj].type),
      text_elements:[{ text:'', style:null }]
    };
    scene.paragraphs.splice(pj + 1, 0, newPara);
    screenplay = screenplay;
    await tick();
    elementRefs[`p-${si}-${pj+1}`]?.focus();
  }

  async function insertAtEnd() {
    if (!screenplay?.scenes.length) return;
    syncAllVisibleText();
    const si    = screenplay.scenes.length - 1;
    const scene = screenplay.scenes[si];
    scene.paragraphs.push({
      id: generateId(),
      type: getDefaultType(scene.paragraphs.at(-1).type),
      text_elements:[{ text:'', style:null }]
    });
    screenplay = screenplay;
    await tick();
    document.getElementById(`p-${si}-${scene.paragraphs.length-1}`)?.focus();
  }

  /* ───── MENU & GLOBAL HOTKEYS ────────────────────────────────────── */
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

  function handleGlobalKeydown(e) {
    const mapped = keyToTypeMap[e.key.toLowerCase()];
    if (mapped && get(menuState).open) {
      const { sceneIndex, paraIndex } = get(menuState);
      changeType(sceneIndex, paraIndex, mapped);
      e.preventDefault();
    }
  }

  function handleClickOutside(e) {
    if (!e.target.closest('.menu') && !e.target.closest('.type-menu'))
      menuState.set({ open:false, sceneIndex:null, paraIndex:null });
  }

  /* ───── HELPER: build paragraphs from raw lines (paste) ──────────── */
  function paragraphsFromLines(lines) {
    const tmp = Screenplay.fromPlain(
      lines.join('\n'),
      { markdown:true, allowFountain:true, cleanSpacing:false, cleanPaging:false }
    );
    const out = [];
    tmp.scenes.forEach(s =>
      s.paragraphs.forEach(p =>
        out.push({
          id: generateId(),
          type: p.type,
          text_elements: p.text_elements.map(te => ({ text:te.text, style:te.style ?? null }))
        })
      )
    );
    return out;
  }

  /* ───── PASTE HANDLER (unchanged) ───────────────────────────────── */
  function handlePaste(e, sceneIdx, paraIdx, para) {
    const pasted = e.clipboardData?.getData('text/plain') ?? '';
    if (!pasted.includes('\n')) return;           // single‑line → native
    e.preventDefault();

    const sel   = window.getSelection();
    const caret = sel && sel.anchorOffset != null ? sel.anchorOffset : 0;
    const original = para.text_elements[0]?.text ?? '';
    const before   = original.slice(0, caret);
    const after    = original.slice(caret);

    const lines = pasted.replace(/\r/g, '').split('\n');
    const firstLine = lines.shift();

    para.text_elements = [{ text: before + firstLine, style: null }];
    elementRefs[`p-${sceneIdx}-${paraIdx}`].innerText = before + firstLine;

    const newParas = lines.length ? paragraphsFromLines(lines.map(l => l.trimEnd())) : [];

    if (after) {
      (newParas.at(-1) ?? para).text_elements.push({ text: after, style:null });
    }

    if (newParas.length) {
      screenplay.scenes[sceneIdx].paragraphs.splice(paraIdx + 1, 0, ...newParas);
      screenplay = screenplay;
    }

    tick().then(() => {
      const el = document.getElementById(`p-${sceneIdx}-${paraIdx + 1}`);
      if (el) {
        const r = document.createRange();
        r.setStart(el.childNodes[0] || el, 0);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        el.focus();
      }
    });
  }

  /* ───── MAIN EDIT‑KEYDOWN HANDLER (was inline) ───────────────────── */
  function handleEditKeydown(e, i, j, para) {
    const el   = e.currentTarget;
    const full = el.innerText;
    const txt  = full.trim();

    /* ---------- ENTER ---------- */
    if (e.key === 'Enter') {
      e.preventDefault();
      const sel = window.getSelection();
      const caret = sel && sel.anchorOffset != null ? sel.anchorOffset : full.length;

      if (txt === '') { toggleMenu(i, j); return; }
      if (caret === full.length) { insertEmptyParagraph(i, j); return; }

      const before = full.slice(0, caret);
      const after  = full.slice(caret);

      syncAllVisibleText();
      const scene = screenplay.scenes[i];
      scene.paragraphs[j].text_elements = [{ text: before, style: null }];
      el.innerText = before;

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
          r.setStart(newEl.childNodes[0] || newEl, 0);
          r.collapse(true);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          newEl.focus();
        }
      });
      return;
    }

    /* ---------- TAB ---------- */
    if (e.key === 'Tab') {
      e.preventDefault();
      if (txt === '') {
        para.type = getTabCycleType(para.type);
        screenplay = screenplay;
      } else {
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
      return;
    }

    /* ---------- BACKSPACE on empty ---------- */
    if (e.key === 'Backspace' && txt === '') {
      if (j === 0) return;
      e.preventDefault();

      syncAllVisibleText();
      screenplay.scenes[i].paragraphs.splice(j, 1);
      screenplay = screenplay;

      tick().then(() => {
        const prev = document.getElementById(`p-${i}-${j - 1}`);
        if (prev) {
          const r = document.createRange();
          r.selectNodeContents(prev);
          r.collapse(false);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          prev.focus();
        }
      });
      return;
    }

    /* ---------- ARROW UP / DOWN ---------- */
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    /* robust caret metrics (clone + rect list) */
    function caretInfo() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        const clone = sel.getRangeAt(0).cloneRange();
        const rect  = clone.getClientRects()[0] || clone.getBoundingClientRect();
        if (!rect) return null;

        const elRect = el.getBoundingClientRect();
        return {
        caretX:  rect.left,
        atFirst: rect.top - elRect.top < 3,        // ≤ 3 px from top
        atLast:  elRect.bottom - rect.bottom < 3   // ≤ 3 px from bottom
        };
    }

    const info = caretInfo();
    if (!info) return;           // couldn’t measure → fall back to native

    /* helper: drop the caret at (x,y) inside targetEl */
    function pointToCaret(targetEl, x, y) {
    let pos = null;

    /* modern API */
    if (typeof document.caretPositionFromPoint === 'function') {
        pos = document.caretPositionFromPoint(x, y);
        if (pos) pos = { node: pos.offsetNode, offset: pos.offset };
    }

    /* fallback: WebKit / old Blink */
    if (!pos && typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(x, y);
        if (range) pos = { node: range.startContainer, offset: range.startOffset };
    }

    if (!pos) return;                        // couldn’t resolve point → bail

    const rng = document.createRange();
    rng.setStart(pos.node, pos.offset);
    rng.collapse(true);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rng);

    targetEl.focus();
    }

    /* ─── move UP ─── */
    if (e.key === 'ArrowUp' && info.atFirst) {
        e.preventDefault();
        const target =
        j > 0
            ? document.getElementById(`p-${i}-${j - 1}`)
            : i > 0
                ? document.getElementById(
                    `p-${i - 1}-${screenplay.scenes[i - 1].paragraphs.length - 1}`
                )
                : null;
        if (target) {
        const r = target.getBoundingClientRect();
        pointToCaret(target, info.caretX, r.bottom - 2); // end of last line
        }
    }

    /* ─── move DOWN ─── */
    if (e.key === 'ArrowDown' && info.atLast) {
        e.preventDefault();
        const scene = screenplay.scenes[i];
        const target =
        j < scene.paragraphs.length - 1
            ? document.getElementById(`p-${i}-${j + 1}`)
            : i < screenplay.scenes.length - 1
                ? document.getElementById(`p-${i + 1}-0`)
                : null;
        if (target) {
        const r = target.getBoundingClientRect();
        pointToCaret(target, info.caretX, r.top + 2);    // start of first line
        }
    }
    }

  }

  /* ───── LIFECYCLE HOOKS ─────────────────────────────────────────── */
  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleGlobalKeydown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleGlobalKeydown);
    };
  });
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
                  on:keydown={e => handleEditKeydown(e, i, j, para)}
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
