<script>
  import { Screenplay } from './screenplay.js';
  import ScreenplayZone   from './ScreenplayZone.svelte';

  /*  UI state  */
  let file;
  let screenplay = null;

  /*  EXPORT MENU ------------------------------------------------------ */
  let exportMenuOpen = false;
  let exportRef;

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
        content = screenplay.toText(false, true);
        name    = 'screenplay.txt';
        break;
      case 'txt-layout':
        content = screenplay.toText(true, true);
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

    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    exportMenuOpen = false;
  }

  function handleClickOutsideExport(e) {
    if (exportMenuOpen && !exportRef?.contains(e.target)) exportMenuOpen = false;
  }

  /*  FILE‑UPLOAD ------------------------------------------------------ */
  async function upload() {
    if (!file) return alert('Choose a file first!');
    const ext  = file.name.split('.').pop().toLowerCase();
    const text = await file.text();

    try {
      screenplay = ext === 'fdx'
        ? Screenplay.fromFdx(text)
        : Screenplay.fromPlain(text, { markdown: true });
    } catch (err) {
      console.error('❌ Parse error:', err);
      alert('Could not parse screenplay.');
    }
  }

  /*  TOC SCROLL ------------------------------------------------------- */
  function scrollToScene(i) {
    const target = document.getElementById(`scene-${i}`);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  }

  /*  GLOBAL LISTENER ONLY FOR EXPORT DROPDOWN ------------------------ */
  import { onMount } from 'svelte';
  onMount(() => {
    document.addEventListener('click', handleClickOutsideExport);
    return () => document.removeEventListener('click', handleClickOutsideExport);
  });
</script>

<!-- ───── FIXED TOP BAR ─────────────────────────────────────────────── -->
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

<!-- ───── TABLE OF CONTENTS ─────────────────────────────────────────── -->
<div class="toc">
  <h4>Scenes</h4>
  {#if screenplay}
    {#each screenplay.scenes as _, i}
      <div on:click={() => scrollToScene(i)}>Scene {i + 1}</div>
    {/each}
  {/if}
</div>

<!-- ───── UPLOAD CONTROLS ───────────────────────────────────────────── -->
<div class="upload-wrapper">
  <input type="file" on:change={e => (file = e.target.files[0])} />
  <button on:click={upload}>Upload</button>
</div>

<!-- ───── SCREENPLAY EDITOR ZONE ────────────────────────────────────── -->
<div class="screenplay-area">
  <ScreenplayZone bind:screenplay />
</div>

<style>
  /* ── layout helpers (keep minimal—everything else is in the component) */
  .upload-wrapper,
  .screenplay-area { margin-left: 12rem; }   /* width reserved for the TOC */
  .upload-wrapper  { margin-top: 3rem; }     /* height of the fixed bar   */

  /* ── top bar + export UI ------------------------------------------- */
  .top-bar {
    position: fixed; top: 0; left: 0; width: 100%; height: 2.5rem;
    background: #222; color: #fff; display: flex; align-items: center;
    padding: 0 1rem; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }
  .export-dropdown { position: relative; margin-right: 1rem; }
  .export-button   { background:none; border:none; color:#fff; font-weight:bold; cursor:pointer; }
  .export-menu     { position:absolute; top:2.5rem; left:0; background:#fff; color:#000;
                     border:1px solid #ccc; box-shadow:0 2px 4px rgba(0,0,0,0.2); width:max-content; }
  .export-item     { padding:0.5rem 1rem; cursor:pointer; }
  .export-item:hover { background:#f0f0f0; }

  /* ── TOC ------------------------------------------------------------ */
  .toc {
    position: fixed; top: 1rem; left: 1rem;
    background: #eee; padding: 1rem; border-radius: 8px;
  }

    /* overwrite the old rule */
    .screenplay-area {
    margin-left: 12rem;           /* leaves room for the TOC           */
    width: calc(100% - 12rem);    /* stretch the “desk” to the edge    */
    }
</style>
