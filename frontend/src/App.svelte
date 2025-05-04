<script>
  import { onMount, tick } from 'svelte';
  import { writable, get } from 'svelte/store';
  import { Screenplay } from './screenplay.js';

  let screenplay = null;
  let file;
  let currentScene = 0;
  let elementRefs = {};
  let exportMenuOpen = false;
  let exportRef;

  const menuState = writable({ open: false, sceneIndex: null, paraIndex: null });

  const keyToTypeMap = {
    s: "Scene Heading",
    a: "Action",
    c: "Character",
    p: "Parenthetical",
    d: "Dialogue",
    t: "Transition"
  };

  function toggleExportMenu() {
    exportMenuOpen = !exportMenuOpen;
  }

  function handleExport(type) {
    if (!screenplay) return alert('Upload or create a screenplay first!');

    let content = '';
    let mime    = 'text/plain';
    let name    = '';

    switch (type) {
      case 'fdx':
        content = screenplay.toFdx();
        mime    = 'application/xml';
        name    = 'screenplay.fdx';
        break;
      case 'txt':
        content = screenplay.toText(false, true);         // no layout
        name    = 'screenplay.txt';
        break;
      case 'txt-layout':
        content = screenplay.toText(true, true);          // with layout
        name    = 'screenplay_layout.txt';
        break;
      case 'json':
        content = screenplay.toJson();
        mime    = 'application/json';
        name    = 'screenplay.json';
        break;
      default:
        return alert('Unknown export type');
    }

    // Trigger download
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    exportMenuOpen = false;
  }

  function handleClickOutsideExport(event) {
    if (exportMenuOpen && !exportRef?.contains(event.target)) {
      exportMenuOpen = false;
    }
  }

  function generateId() {
    return crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  }

  function ensureParagraphIds() {
    screenplay?.scenes?.forEach(scene => {
      scene.paragraphs.forEach(p => {
        if (!p.id) {
          p.id = generateId();
        }
      });
    });
  }

  // Markdown display is not supported yet
  function textOf(para) {
    return (para.text_elements || []).map(te => te.text).join('');
  }

  function storeRef(node, { key, para }) {
    if (!node) return;
    elementRefs[key] = node;

    // Populate initial text if empty
    if (node.innerText.trim() === '') {
      const full = textOf(para);
      node.innerText = para.type === 'Scene Heading' ? full.toUpperCase() : full;
    }

    return {
      destroy() { delete elementRefs[key]; }
    };
  }

  function updateTextById(id, newText) {
    for (const scene of screenplay.scenes) {
      const para = scene.paragraphs.find(p => p.id === id);
      if (para) {
        if (newText !== textOf(para)) {
          // Replace the whole array with a single plain TextElement
          para.text_elements = [{ text: newText, style: null }];
        }
        return;
      }
    }
  }

  function syncAllVisibleText() {
    const nodes = document.querySelectorAll('.editable[data-id]');
    nodes.forEach(el => {
      const id = el.dataset.id;
      const text = el.innerText ?? '';
      for (const scene of screenplay.scenes) {
        const para = scene.paragraphs.find(p => p.id === id);
        if (para) {
          const original = para.text_elements[0]?.text ?? '';
          if (text !== original) {
            para.text_elements[0].text = text;
          }
        }
      }
    });
  }

  async function upload() {
    if (!file) return alert('Choose a file first!');
    const ext = file.name.split('.').pop().toLowerCase();
    const text = await file.text();                 // FileReader under the hood

    try {
      if (ext === 'fdx') {
        screenplay = Screenplay.fromFdx(text);
      } else {
        screenplay = Screenplay.fromPlain(text, { markdown: true });
      }
      ensureParagraphIds();
    } catch (err) {
      console.error('❌ Parse error:', err);
      alert('Could not parse screenplay.');
    }
  }

  function scrollToScene(index) {
    currentScene = index;
    document.getElementById(`scene-${index}`).scrollIntoView({ behavior: 'smooth' });
  }

  function getDefaultType(prevType) {
    if (["Scene Heading", "Action", "Dialogue"].includes(prevType)) return "Action";
    if (["Character", "Parenthetical"].includes(prevType)) return "Dialogue";
    if (prevType === "Transition") return "Scene Heading";
    return "Action";
  }

  function getTabCycleType(currentType) {
    const cycleMap = {
      "Scene Heading": "Action",
      "Action": "Character",
      "Character": "Transition",
      "Transition": "Scene Heading",
      "Dialogue": "Parenthetical",
      "Parenthetical": "Dialogue"
    };
    return cycleMap[currentType] ?? "Action";
  }

  function getTabInsertType(currentType) {
    return currentType === "Character" ? "Parenthetical" : getDefaultType(currentType);
  }

  async function insertEmptyParagraph(sceneIndex, afterIndex) {
    syncAllVisibleText();
    const scene = screenplay.scenes[sceneIndex];
    const prevPara = scene.paragraphs[afterIndex];
    const newType = getDefaultType(prevPara.type);
    const newParagraph = {
      id: generateId(),
      type: newType,
      text_elements: [{ text: "", style: null }]
    };
    scene.paragraphs.splice(afterIndex + 1, 0, newParagraph);
    screenplay = screenplay; // trigger reactivity
    await tick();
    const key = `p-${sceneIndex}-${afterIndex + 1}`;
    const el = elementRefs[key];
    if (el) {
      el.innerText = '';
      el.focus();
    }
  }

  async function insertAtEnd() {
    if (!screenplay || screenplay.scenes.length === 0) return;
    syncAllVisibleText();
    const lastSceneIndex = screenplay.scenes.length - 1;
    const lastScene = screenplay.scenes[lastSceneIndex];
    const lastIndex = lastScene.paragraphs.length - 1;
    const lastPara = lastScene.paragraphs[lastIndex];
    const newType = getDefaultType(lastPara.type);
    lastScene.paragraphs.push({
      id: generateId(),
      type: newType,
      text_elements: [{ text: "", style: null }]
    });
    screenplay = screenplay;
    await tick();
    const el = document.getElementById(`p-${lastSceneIndex}-${lastScene.paragraphs.length - 1}`);
    if (el) el.focus();
  }

  function toggleMenu(i, j) {
    menuState.update(current => {
      if (current.open && current.sceneIndex === i && current.paraIndex === j) {
        return { open: false, sceneIndex: null, paraIndex: null };
      }
      return { open: true, sceneIndex: i, paraIndex: j };
    });
  }

  function changeType(i, j, newType) {
    const para = screenplay.scenes[i].paragraphs[j];
    if (para && para.type !== newType) {
      para.type = newType;
      screenplay = screenplay;
    }
    menuState.set({ open: false, sceneIndex: null, paraIndex: null });
  }

  function handleClickOutside(event) {
    if (!event.target.closest('.menu') && !event.target.closest('.type-menu')) {
      menuState.set({ open: false, sceneIndex: null, paraIndex: null });
    }

    handleClickOutsideExport(event);
  }

  function handleKeydown(event) {
    const key = event.key.toLowerCase();
    const type = keyToTypeMap[key];
    if (type && get(menuState).open) {
      const { sceneIndex, paraIndex } = get(menuState);
      changeType(sceneIndex, paraIndex, type);
      event.preventDefault();
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<style>
  * {
    font-family: 'Courier New', monospace;
    line-height: 1;
  }
  .scene-heading { font-size: 1.2rem; font-weight: bold; margin-top: 1rem; text-align: left; }
  .character { margin-left: 20ch; font-weight: bold; text-transform: uppercase; text-align: left; }
  .parenthetical { margin-left: 14ch; font-style: italic; text-align: left; }
  .dialogue { margin-left: 10ch; text-align: left; }
  .transition { text-align: right; font-weight: bold; }
  .paragraph { display: flex; align-items: flex-start; gap: 0.5rem; margin-bottom: 0; }
  .paragraph + .gap { margin-bottom: 1em; }
  .paragraph:hover { background-color: #f0f0f0; cursor: pointer; }
  .menu { width: 1rem; margin-right: 0.5rem; line-height: 1; cursor: pointer; }
  .toc { position: fixed; top: 1rem; left: 1rem; background: #eee; padding: 1rem; border-radius: 8px; }
  .content-wrapper { margin-left: 12rem; max-width: 61ch; text-align: left; }
  .editable { outline: none; white-space: pre-wrap; width: 100%; }
  .bottom-space { height: 100px; border-top: 1px dashed #ccc; margin-top: 2rem; text-align: center; cursor: pointer; color: gray; }

  .type-menu {
    position: absolute;
    right: 100%;
    top: 0;
    margin-right: 0.5rem;
    background: white;
    border: 1px solid #ccc;
    padding: 0.3rem;
    z-index: 10;
    font-size: 0.9rem;
    box-shadow: 0 0 5px rgba(0, 0, 0, 0.2);
    white-space: nowrap;
  }
  .type-option {
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }
  .type-option:hover {
    background: #eee;
  }
  .menu-container {
    position: relative;
  }
  .top-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 2.5rem;
  background-color: #222;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  z-index: 1000;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }

  .export-dropdown {
    position: relative;
    margin-right: 1rem;
  }

  .export-button {
    background: none;
    border: none;
    color: white;
    font-weight: bold;
    cursor: pointer;
  }

  .export-menu {
    position: absolute;
    top: 2.5rem;
    left: 0;
    background: white;
    color: black;
    border: 1px solid #ccc;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    z-index: 1001;
    width: max-content;
  }

  .export-item {
    padding: 0.5rem 1rem;
    cursor: pointer;
  }

  .export-item:hover {
    background-color: #f0f0f0;
  }

  .content-wrapper {
    margin-top: 3rem; /* account for top bar */
  }
</style>

<div class="top-bar">
  <div class="export-dropdown" bind:this={exportRef}>
    <button class="export-button" on:click={toggleExportMenu}>Export ▾</button>
    {#if exportMenuOpen}
      <div class="export-menu">
        <div class="export-item" on:click={() => handleExport('fdx')}>Export as FDX</div>
        <div class="export-item" on:click={() => handleExport('txt')}>Export as TXT</div>
        <div class="export-item" on:click={() => handleExport('txt-layout')}>Export as TXT with layout</div>
        <div class="export-item" on:click={() => handleExport('json')}>Export as JSON</div>
      </div>
    {/if}
  </div>
</div>

<div class="toc">
  <h4>Scenes</h4>
  {#if screenplay}
    {#each screenplay.scenes as scene, i}
      <div on:click={() => scrollToScene(i)}>Scene {i + 1}</div>
    {/each}
  {/if}
</div>

<div class="content-wrapper">
  <input type="file" on:change={e => file = e.target.files[0]}>
  <button on:click={upload}>Upload</button>
</div>

{#if screenplay}
  <div class="content-wrapper">
    {#each screenplay.scenes as scene, i}
      <div id={`scene-${i}`} style="margin-bottom: 2rem">
        {#each scene.paragraphs as para, j (para.id)}
          <div>
            <div class="paragraph">
              <div class="menu-container">
                <span class="menu" on:click={() => toggleMenu(i, j)}>⋮</span>
                {#if $menuState.open && $menuState.sceneIndex === i && $menuState.paraIndex === j}
                  <div class="type-menu">
                    {#each Object.entries(keyToTypeMap) as [key, label]}
                      <div class="type-option" on:click={() => changeType(i, j, label)}>
                        [{key.toUpperCase()}] {label}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
              {#if para.type}
                <div
                  id={`p-${i}-${j}`}
                  data-id={para.id}
                  use:storeRef={{ key: `p-${i}-${j}`, para }}
                  class={`editable ${para.type.toLowerCase()}`}
                  contenteditable
                  on:input={(e) => updateTextById(para.id, e.target.innerText)}
                  on:keydown={(e) => {
                    const content = e.currentTarget.innerText.trim();
                  
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (content === '') {
                        toggleMenu(i, j);
                      } else {
                        insertEmptyParagraph(i, j);
                      }
                    }
                  
                    else if (e.key === 'Tab') {
                      e.preventDefault();
                      if (content === '') {
                        // cycle current type
                        const currentType = para.type;
                        const nextType = getTabCycleType(currentType);
                        para.type = nextType;
                        screenplay = screenplay;
                      } else {
                        // insert next element with custom rule
                        syncAllVisibleText();
                        const scene = screenplay.scenes[i];
                        const nextType = getTabInsertType(para.type);
                        const newParagraph = {
                          id: generateId(),
                          type: nextType,
                          text_elements: [{ text: "", style: null }]
                        };
                        scene.paragraphs.splice(j + 1, 0, newParagraph);
                        screenplay = screenplay;
                        tick().then(() => {
                          const nextEl = document.getElementById(`p-${i}-${j + 1}`);
                          if (nextEl) {
                            nextEl.focus();
                          }
                        });
                      }
                    }
                  
                    else if (e.key === 'Backspace') {
                      const el = e.currentTarget;
                      if (el.innerText.trim() === '') {
                        e.preventDefault();
                        if (j === 0) return;
                  
                        syncAllVisibleText();
                        const scene = screenplay.scenes[i];
                        scene.paragraphs.splice(j, 1);
                        screenplay = screenplay;
                  
                        tick().then(() => {
                          const prevEl = document.getElementById(`p-${i}-${j - 1}`);
                          if (prevEl) {
                            const range = document.createRange();
                            const sel = window.getSelection();
                            range.selectNodeContents(prevEl);
                            range.collapse(false);
                            sel.removeAllRanges();
                            sel.addRange(range);
                            prevEl.focus();
                          }
                        });
                      }
                    }
                  }}
                  ></div>
              {/if}
            </div>
            {#if (
              ['Dialogue', 'Action', 'Scene Heading', 'Transition'].includes(para.type)
              && !(para.type === 'Dialogue' && scene.paragraphs[j + 1]?.type === 'Parenthetical')
            )}
              <div class="gap"></div>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
    <div class="bottom-space" on:click={insertAtEnd}>+ Add element</div>
  </div>
{/if}