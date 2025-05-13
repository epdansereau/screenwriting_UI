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

/* ─── drag‑move / copy of ANY selection ─────────────────────────── */

/* ─── caret position at x,y  (cross‑browser) ────────────────────── */
function getCaretPosFromXY(x, y) {
  if (document.caretPositionFromPoint) {
    const cp = document.caretPositionFromPoint(x, y);
    return cp ? { node: cp.offsetNode, offset: cp.offset } : null;
  }
  if (document.caretRangeFromPoint) {               /* Safari / old Chrome */
    const cr = document.caretRangeFromPoint(x, y);
    return cr ? { node: cr.startContainer, offset: cr.startOffset } : null;
  }
  return null;                                      /* unsupported browser */
}

let dragInfo = null;   // holds full details of the selection being dragged
let dragCopy = false;  // true when Ctrl/⌘ held at drag‑start

function buildDragInfo() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range   = sel.getRangeAt(0);
  const startEl = (range.startContainer instanceof Element
                   ? range.startContainer
                   : range.startContainer.parentElement)?.closest('.editable[data-id]');
  const endEl   = (range.endContainer   instanceof Element
                   ? range.endContainer
                   : range.endContainer.parentElement)?.closest('.editable[data-id]');
  if (!startEl || !endEl) return null;

  /* paragraph coordinates */
  const si1 = +startEl.dataset.si, pj1 = +startEl.dataset.pj;
  const si2 = +endEl.dataset.si,   pj2 = +endEl.dataset.pj;

  return {
    si1, pj1, si2, pj2,
    startOffset: caretOffsetIn(startEl, range.startContainer, range.startOffset),
    endOffset  : caretOffsetIn(endEl,   range.endContainer,   range.endOffset ),
    startEl,
    endEl,
    text: sel.toString()
  };
}

/* ——— DRAG START ——————————————————————————————— */
function handleDragStartText(e) {
  dragInfo = buildDragInfo();
  if (!dragInfo) {              // nothing we control → let browser be
    dragInfo = null;
    return;
  }
  dragCopy  = e.ctrlKey || e.metaKey;
  e.dataTransfer.effectAllowed = dragCopy ? 'copyMove' : 'move';
  /* put text on the clipboard for external drops */
  e.dataTransfer.setData('text/plain', dragInfo.text);
}

/* ——— DRAG OVER ——————————————————————————————— */
function handleDragOverText(e) {
  if (!dragInfo) return;        // browser handles its own drags
  e.preventDefault();           // allow drop
  e.dataTransfer.dropEffect = dragCopy ? 'copy' : 'move';
}
/* ─── DROP — works for any selection size, keeps indices correct ── */
function handleDropText(e) {
  if (!dragInfo) return;          // not our drag
  e.preventDefault();

  /* ── locate drop site before we mutate the model ─────────────── */
  const tgtEl = e.target.closest('.editable[data-id]');
  if (!tgtEl) { dragInfo = null; return; }

  const tgtParaId  = tgtEl.dataset.id;         // stable reference!
  const caretPos   = getCaretPosFromXY(e.clientX, e.clientY);
  if (!caretPos) { dragInfo = null; return; }
  let dropOffset = caretOffsetIn(tgtEl, caretPos.node, caretPos.offset);

  /* abort if move‑into‑own‑selection */
  if (!dragCopy &&
      tgtParaId === dragInfo.startEl.dataset.id &&
      dropOffset >= dragInfo.startOffset && dropOffset <= dragInfo.endOffset) {
    dragInfo = null; return;
  }

  /* ── collect dragged lines exactly as before ─────────────────── */
  const lines = [];
  const push  = txt => { if (txt) lines.push(txt); };

  const firstPara = screenplay.scenes[dragInfo.si1].paragraphs[dragInfo.pj1];
  const lastPara  = screenplay.scenes[dragInfo.si2].paragraphs[dragInfo.pj2];

  push(textOf(firstPara).slice(dragInfo.startOffset,
        dragInfo.si1 === dragInfo.si2 && dragInfo.pj1 === dragInfo.pj2
          ? dragInfo.endOffset : undefined));

  for (let si = dragInfo.si1; si <= dragInfo.si2; si++) {
    const scene = screenplay.scenes[si];
    const s = si === dragInfo.si1 ? dragInfo.pj1 + 1 : 0;
    const e = si === dragInfo.si2 ? dragInfo.pj2 - 1 : scene.paragraphs.length - 1;
    for (let pj = s; pj <= e; pj++) push(textOf(scene.paragraphs[pj]));
  }

  if (!(dragInfo.si1 === dragInfo.si2 && dragInfo.pj1 === dragInfo.pj2))
    push(textOf(lastPara).slice(0, dragInfo.endOffset));

  const draggedLen = lines.join('').length;

  /* ── delete original selection if move ───────────────────────── */
  if (!dragCopy) {
    if (dragInfo.si1 === dragInfo.si2 && dragInfo.pj1 === dragInfo.pj2) {
      const para   = firstPara;
      const raw    = textOf(para);
      const before = raw.slice(0, dragInfo.startOffset);
      const after  = raw.slice(dragInfo.endOffset);
      para.text_elements = [new TextElement(before + after, null)];
      mirrorTextToTwins(para.id, before + after, null);

      /* if we deleted earlier text in same paragraph, adjust offset */
      if (tgtParaId === para.id && dropOffset > dragInfo.startOffset)
        dropOffset -= draggedLen;
    } else {
      handleMultiParaEdit({ preventDefault() {}, key:'Delete' }, dragInfo);
    }
  }

  /* ── (re)locate target paragraph after possible deletions ────── */
  const tgtScene = screenplay.scenes
                   .find(sc => sc.paragraphs.some(p => p.id === tgtParaId));
  const tgtParaIdx = tgtScene.paragraphs.findIndex(p => p.id === tgtParaId);
  const tgtPara    = tgtScene.paragraphs[tgtParaIdx];

  const rawTgt   = textOf(tgtPara);
  const beforeT  = rawTgt.slice(0, dropOffset);
  const afterT   = rawTgt.slice(dropOffset);

  /* ── insert dragged text ─────────────────────────────────────── */
  tgtPara.text_elements = [ new TextElement(beforeT + lines[0], null) ];

  /* if only one line, add tail in same paragraph */
  if (lines.length === 1) {
    tgtPara.text_elements.push(new TextElement(afterT, null));
  }

  mirrorTextToTwins(tgtPara.id, textOf(tgtPara), null);  // full text now

  /* extra lines → new paragraphs inserted right after target para */
  if (lines.length > 1) {
    const newParas = lines.slice(1).map(txt => {
      const p = new Paragraph(tgtPara.type, [ new TextElement(txt, null) ]);
      p.id = generateId();
      return p;
    });
    newParas.at(-1).text_elements.push(new TextElement(afterT, null));

    tgtScene.paragraphs.splice(tgtParaIdx + 1, 0, ...newParas);
  }

  /* ── reactive update + caret placement ───────────────────────── */
  screenplay = screenplay;    // 🔔 mirror pane updates

  tick().then(() => {
    const caretParaId = lines.length > 1
        ? tgtScene.paragraphs[tgtParaIdx + lines.length - 1].id
        : tgtPara.id;
    placeCaretAtOffset(elOf(caretParaId),
      lines.length > 1 ? lines.at(-1).length
                       : (beforeT + lines[0]).length);
  });

  dragInfo = null;
}


/* ───── MAIN EDIT KEYDOWN (id‑independent) ─────────────────────── */
async function handleEditKeydown (e, i, j, para, elOverride = null) {

  const el = elOverride || e.currentTarget;
  const full = el.innerText; // full text content of the current paragraph element

  /* ——— ENTER ——————————————————————————— */
  if (e.key === 'Enter') {
    // ... (Enter key logic remains unchanged from your original/working version)
    e.preventDefault();
    const caret = (() => {
      const s = window.getSelection();
      return s?.anchorOffset ?? full.length;
    })();
    const txtTrimmed = full.trim(); // Use a different variable name to avoid conflict

    if (txtTrimmed === '') { toggleMenu(i, j); return; }
    if (caret === full.length) { insertEmptyParagraph(i, j); return; }

    const before = full.slice(0, caret);
    const after = full.slice(caret);

    syncAllVisibleText();

    screenplay.scenes[i].paragraphs[j]
      .text_elements = [ new TextElement(before, null) ];
    // DOM update for the current element. The reactive update below will handle twins.
    if (el) el.innerText = before;


    const splitPara = new Paragraph(para.type, [ new TextElement(after, null) ]);
    splitPara.id = generateId();
    screenplay.scenes[i].paragraphs.splice(j + 1, 0, splitPara);
    screenplay = screenplay;

    tick().then(() => placeCaretAtStart(elOf(splitPara.id)));
    return;
  }

  /* ——— TAB ———————————————————————————— */
  if (e.key === 'Tab') {
    // ... (Tab key logic remains unchanged from your original/working version)
    e.preventDefault();
    const txtTrimmed = full.trim(); // Use a different variable name

    if (txtTrimmed === '') {
      para.type = getTabCycleType(para.type);
      screenplay = screenplay;
    } else {
      syncAllVisibleText();
      const newPara = makeEmptyPara(getTabInsertType(para.type));
      newPara.id = generateId();
      screenplay.scenes[i].paragraphs.splice(j + 1, 0, newPara);
      screenplay = screenplay;

      tick().then(() => placeCaretAtStart(elOf(newPara.id)));
    }
    return;
  }

  // ─────────────────── REVISED BACKSPACE LOGIC ───────────────────────
  if (e.key === 'Backspace') {
    const currentMultiParaSelection = multiParaSelection();

    if (currentMultiParaSelection) {
      // If a multi-paragraph selection exists, let delegateBeforeInput handle the deletion.
      // delegateBeforeInput will call e.preventDefault() and manage the model update.
      // We simply return here to prevent this handler from interfering.
      return;
    }

    // If not a multi-paragraph selection, proceed with single-paragraph Backspace logic.
    // This includes collapsed caret at boundaries or range selection within a single paragraph.
    const txtTrimmed = full.trim(); // Trimmed text for logic checks
    const sel = window.getSelection();

    // CASE 1: Backspace at the start of a non-empty paragraph (collapsed caret) -> Merge with previous
    // This restores the original behavior.
    if (txtTrimmed !== '' && sel && sel.isCollapsed && sel.anchorOffset === 0) {
      if (j === 0) { // Original condition: if it's the first paragraph of the current scene, do not merge.
        return;
      }

      e.preventDefault();
      syncAllVisibleText(); // Sync model before changes

      const scene = screenplay.scenes[i];
      const prevPara = scene.paragraphs[j - 1]; // Previous paragraph in the same scene
      const currentPara = scene.paragraphs[j];  // The paragraph where backspace was pressed

      if (!prevPara) return; // Safety check, though j > 0 should ensure prevPara exists.

      const caretPositionInPrev = textOf(prevPara).length;

      // Append text elements from current to previous. Create new TextElement instances for safety.
      prevPara.text_elements.push(...currentPara.text_elements.map(te => new TextElement(te.text, te.style)));
      
      // Update the DOM of the merged-to paragraph directly for immediate visual feedback.
      // The reactive update screenplay = screenplay will handle other views/twins.
      const prevParaEl = elOf(prevPara.id);
      if (prevParaEl) prevParaEl.innerText = renderText(prevPara);

      scene.paragraphs.splice(j, 1); // Remove the current paragraph from the model
      screenplay = screenplay; // Trigger Svelte reactivity

      tick().then(() => {
        const focusedEl = elOf(prevPara.id); // Re-fetch element
        if (focusedEl) placeCaretAtOffset(focusedEl, caretPositionInPrev);
      });
      return; // Action handled
    }

    // CASE 2: Backspace in a completely empty paragraph (collapsed caret) -> Delete this paragraph
    // This restores the original behavior.
    if (txtTrimmed === '' && sel && sel.isCollapsed) { // Caret is implicitly at offset 0 in an empty paragraph
      if (j === 0) { // Original condition: if it's the first paragraph of the current scene, do not delete.
        return;
      }
      
      e.preventDefault();
      syncAllVisibleText(); // Sync model before changes

      const scene = screenplay.scenes[i];
      const prevParaToFocus = (j > 0) ? scene.paragraphs[j - 1] : null; // Paragraph to focus after deletion

      scene.paragraphs.splice(j, 1); // Delete the empty paragraph
      screenplay = screenplay; // Trigger Svelte reactivity

      tick().then(() => {
        if (prevParaToFocus) {
          const focusEl = elOf(prevParaToFocus.id);
          if (focusEl) placeCaretAtEnd(focusEl);
        }
        // If prevParaToFocus is null (e.g., j was 0, which is guarded against), caret remains where browser puts it or at start.
      });
      return; // Action handled
    }

  }
  // ───────────────── END OF REVISED BACKSPACE LOGIC ───────────────────


  /* ——— ARROW navigation ——— */
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    // ... (Arrow navigation logic remains unchanged) ...
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    // Ensure getClientRects()[0] exists, especially for empty elements or at init
    const rect = range.getClientRects().length > 0 ? range.getClientRects()[0] : el.getBoundingClientRect(); // Fallback to el's rect
    if (!rect) return; // Still possible no rect is found
    const box = el.getBoundingClientRect();

    // Check if el has actual content/size for meaningful top/bottom calculations
    const elHasSize = box.height > 0 && box.width > 0;

    const atFirst = elHasSize ? (rect.top - box.top < 3) : true; // If no size, assume at edge
    const atLast = elHasSize ? (box.bottom - rect.bottom < 3) : true; // If no size, assume at edge
    const caretX = rect.left;

    const moveCaret = (targetEl, yPositionToTry) => {
      let pos = null;
      if (document.caretPositionFromPoint) { // Standard
        const cp = document.caretPositionFromPoint(caretX, yPositionToTry);
        if (cp) pos = { node: cp.offsetNode, offset: cp.offset };
      } else if (document.caretRangeFromPoint) { // Safari / old Chrome
        const cr = document.caretRangeFromPoint(caretX, yPositionToTry);
        if (cr) pos = { node: cr.startContainer, offset: cr.startOffset };
      }

      if (pos) {
        // Check if the resolved node is actually within the targetEl, or a child of it
        if (!targetEl.contains(pos.node)) {
            pos = null; // Resolved position is outside the target, fallback
        }
      }
      
      if (!pos) { // Fallback if caretPositionFromPoint fails or resolves outside target
        if (e.key === 'ArrowUp') placeCaretAtEnd(targetEl); // Move to end of previous line
        else placeCaretAtStart(targetEl); // Move to start of next line
        targetEl.focus(); // Ensure focus is set
        return;
      }

      const r = document.createRange();
      r.setStart(pos.node, pos.offset);
      r.collapse(true);
      const currentSel = window.getSelection(); // Use a different variable name for selection
      currentSel.removeAllRanges();
      currentSel.addRange(r);
      targetEl.focus(); // Ensure focus is set
    };

    const scene = screenplay.scenes[i];

    if (e.key === 'ArrowUp' && atFirst) {
      e.preventDefault();
      const targetPara = j > 0
        ? scene.paragraphs[j - 1]
        : i > 0 ? screenplay.scenes[i - 1].paragraphs.at(-1) : null;
      if (targetPara) {
        const targetParaEl = elOf(targetPara.id);
        if (targetParaEl) moveCaret(targetParaEl, targetParaEl.getBoundingClientRect().bottom - 2);
      }
    }
    if (e.key === 'ArrowDown' && atLast) {
      e.preventDefault();
      const targetPara = j < scene.paragraphs.length - 1
        ? scene.paragraphs[j + 1]
        : i < screenplay.scenes.length - 1 ? screenplay.scenes[i + 1].paragraphs[0] : null;
      if (targetPara) {
        const targetParaEl = elOf(targetPara.id);
        if (targetParaEl) moveCaret(targetParaEl, targetParaEl.getBoundingClientRect().top + 2);
      }
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

/* intercept native editing on multi‑para selection */
function delegateBeforeInput(e) {
  const selInfo = multiParaSelection();
  if (!selInfo) return;                        // single paragraph – keep native

  const delTypes = ['deleteContentBackward', 'deleteContentForward',
                    'deleteByCut', 'deleteByDrag'];
  const insertTypes = ['insertText', 'insertCompositionText'];

  /* Deletion ----------------------------------------------------- */
  if (delTypes.includes(e.inputType)) {
    e.preventDefault();                        // cancel browser action
    handleMultiParaEdit({ key: 'Delete', preventDefault() {} }, selInfo);
    return;
  }

  /* Typing (replace selection) ---------------------------------- */
  if (insertTypes.includes(e.inputType) && e.data?.length === 1) {
    e.preventDefault();
    /* fake event with the typed character in e.key                */
    handleMultiParaEdit({ key: e.data, preventDefault() {} }, selInfo);
    return;
  }

  /* Anything else (insert line break, paste, etc.) handled elsewhere */
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
/* merge/delete selection that spans several paragraphs */
function handleMultiParaEdit(e, selInfo) {
  e.preventDefault();                 // stop browser from mangling the DOM
  syncAllVisibleText();               // model ← DOM (pre‑edit)

  const {si1, pj1, si2, pj2, startOffset, endOffset} = selInfo;
  const startPara = screenplay.scenes[si1].paragraphs[pj1];
  const endPara   = screenplay.scenes[si2].paragraphs[pj2];

  const before = textOf(startPara).slice(0, startOffset);
  const after  = textOf(endPara  ).slice(endOffset);

  /* what gets inserted instead of the deleted block */
  const inserted = (e.key === 'Backspace' || e.key === 'Delete')
                   ? ''
                   : (e.key.length === 1 ? e.key
                                         : (e.data?.length === 1 ? e.data : ''));

  const newText = before + inserted + after;

  /* 1️⃣ Keep only the start paragraph, update its text             */
  startPara.text_elements = [ new TextElement(newText, null) ];

  const startEl = elOf(startPara.id);          // helper that finds ANY pane
  if (startEl) startEl.innerText = newText;    // update active editor
  mirrorTextToTwins(startPara.id, newText, startEl); // 🔔 mirror pane too

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
  <div
    class="page"
    contenteditable
    on:keydown={delegateKeydown}
    on:beforeinput={delegateBeforeInput}
    on:paste={delegatePaste}
    on:input={delegateInput}
    on:dragstart={handleDragStartText}
    on:dragover|preventDefault={handleDragOverText}
    on:drop={handleDropText}>
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
