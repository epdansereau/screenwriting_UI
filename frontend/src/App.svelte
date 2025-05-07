<script>
  import { Screenplay }   from './screenplay.js';
  import ScreenplayZone   from './ScreenplayZone.svelte';
  import { onMount, tick } from 'svelte';

  /*  UI state  */
  let file;                        // the file currently being parsed
  let fileInput;                   // <input type="file" > reference
  let dragActive = false;          // highlight drop zone
  let zoneRef;                     // <ScreenplayZone> reference

  /* a blank screenplay with ONE empty Scene Heading --------------- */
  let screenplay = createEmptyScreenplay();
  function createEmptyScreenplay () {
    const sp = Screenplay.fromPlain('INT. ', { markdown:true });
    // clear heading text so it’s an empty line
    sp.scenes[0].paragraphs[0].text_elements = [{ text:'', style:null }];
    return sp;
  }

  /*  EXPORT MENU ---------------------------------------------------- */
  let exportMenuOpen = false;
  let exportRef;
  function toggleExportMenu () { exportMenuOpen = !exportMenuOpen; }

  async function handleExport (type) {
    if (!screenplay) return alert('Upload or create a screenplay first!');
    let content = '', mime = 'text/plain', name = '';
    switch (type) {
      case 'fdx':        content = screenplay.toFdx();   mime='application/xml';  name='screenplay.fdx'; break;
      case 'txt':        content = screenplay.toText(false,true); name='screenplay.txt'; break;
      case 'txt-layout': content = screenplay.toText(true,true);  name='screenplay_layout.txt'; break;
      case 'json':       content = screenplay.toJson();  mime='application/json'; name='screenplay.json'; break;
      default: return alert('Unknown export type');
    }
    const blob = new Blob([content], { type:mime });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href:url, download:name });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    exportMenuOpen = false;
  }
  function handleClickOutsideExport (e) {
    if (exportMenuOpen && !exportRef?.contains(e.target)) exportMenuOpen = false;
  }

  /*  UPLOAD HANDLERS ----------------------------------------------- */
  async function parseFile (f) {
    if (!f) return;
    const ext  = f.name.split('.').pop().toLowerCase();
    const text = await f.text();
    try {
      screenplay = ext === 'fdx'
        ? Screenplay.fromFdx(text)
        : Screenplay.fromPlain(text, { markdown:true });
    } catch (err) {
      console.error('❌ Parse error:', err);
      return alert('Could not parse screenplay.');
    }
    await tick();               // wait for ScreenplayZone render
    zoneRef?.focusFirstElement();
    fileInput.value = '';       // reset so the same file can be chosen again
  }

  function handleFileSelect (e) {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  }

  function handleDragOver (e)  { dragActive = true; }
  function handleDragLeave ()  { dragActive = false; }
  function handleDrop (e) {
    dragActive = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) parseFile(f);
  }

  /*  TOC SCROLL ----------------------------------------------------- */
  function scrollToScene(i) {
    const t = document.getElementById(`scene-${i}`);
    if (t) t.scrollIntoView({ behavior:'smooth' });
  }

  /*  GLOBAL LISTENER (for export dropdown only) -------------------- */
  onMount(async () => {
    document.addEventListener('click', handleClickOutsideExport);
    await tick();
    zoneRef?.focusFirstElement();        // caret in blank doc
    return () => document.removeEventListener('click', handleClickOutsideExport);
  });
</script>

<!-- ───── FIXED TOP BAR ──────────────────────────────────────────── -->
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

<!-- ───── TABLE OF CONTENTS ───────────────────────────────────────── -->
<div class="toc">
  <h4>Scenes</h4>
  {#if screenplay}
    {#each screenplay.scenes as _, i}
      <div on:click={() => scrollToScene(i)}>Scene {i + 1}</div>
    {/each}
  {/if}
</div>

<!-- ───── DRAG‑AND‑DROP / CLICK UPLOAD ZONE ───────────────────────── -->
<div class="upload-wrapper {dragActive ? 'drag-active' : ''}"
     on:click={() => fileInput.click()}
     on:dragover|preventDefault|stopPropagation={handleDragOver}
     on:dragleave={handleDragLeave}
     on:drop|preventDefault|stopPropagation={handleDrop}>

  <input  type="file"
          accept=".fdx,.txt"
          bind:this={fileInput}
          on:change={handleFileSelect} />

  <p><strong>Drop</strong> a <code>.fdx</code> or <code>.txt</code> screenplay here<br>
     or <strong>click</strong> to choose a file</p>
</div>

<!-- ───── SCREENPLAY EDITOR ZONE ──────────────────────────────────── -->
<div class="screenplay-area">
  <ScreenplayZone bind:screenplay bind:this={zoneRef} />
</div>

<style>
  /* layout helpers ----------------------------------------------- */
  .upload-wrapper,
  .screenplay-area { margin-left: 12rem; }
  .upload-wrapper  { margin-top: 3rem; }

  /* top bar + export --------------------------------------------- */
  .top-bar {
    position: fixed; top:0; left:0; width:100%; height:2.5rem;
    background:#222; color:#fff; display:flex; align-items:center;
    padding:0 1rem; z-index:1000; box-shadow:0 2px 4px rgba(0,0,0,0.2);
  }
  .export-dropdown { position:relative; margin-right:1rem; }
  .export-button   { background:none; border:none; color:#fff; font-weight:bold; cursor:pointer; }
  .export-menu     { position:absolute; top:2.5rem; left:0; background:#fff; color:#000;
                     border:1px solid #ccc; box-shadow:0 2px 4px rgba(0,0,0,0.2); width:max-content; }
  .export-item     { padding:0.5rem 1rem; cursor:pointer; }
  .export-item:hover{ background:#f0f0f0; }

  /* TOC ----------------------------------------------------------- */
  .toc {
    position: fixed; top:1rem; left:1rem;
    background:#eee; padding:1rem; border-radius:8px;
  }

  /* drag‑and‑drop upload area ------------------------------------ */
  .upload-wrapper {
    border:2px dashed #888; border-radius:8px;
    padding:2rem; text-align:center; color:#555; cursor:pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .upload-wrapper.drag-active {
    background:#f0f8ff; border-color:#1e90ff;
  }
  .upload-wrapper input[type="file"] { display:none; }

  /* screenplay desk area ----------------------------------------- */
  .screenplay-area {
    margin-left:12rem;
    width:calc(100% - 12rem);
  }
</style>
