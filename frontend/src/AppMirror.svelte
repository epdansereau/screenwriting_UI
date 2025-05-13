<script>
  import { onMount, tick }       from 'svelte';
  import ScreenplayZone          from './ScreenplayZone.svelte';
  import { Screenplay, Paragraph, TextElement } from './screenplay.js';

  /* ───── helper to start with an empty script ──────────────────── */
  function createEmptyScreenplay () {
    const sp = Screenplay.fromPlain('INT. ', { markdown:true });
    sp.scenes[0].paragraphs[0].text_elements = [ new TextElement('', null) ];
    return sp;
  }

  /* ───── shared screenplay (✅ one object!) ─────────────────────── */
  let screenplay = createEmptyScreenplay();

  /* refs & UI state for each pane (A/B) ‑‑ keeps UI independent  */
  let zoneARef,  zoneBRef;
  let fileInputA, fileInputB;
  let dragA = false, dragB = false;

  /* export dropdown (single – applies to the shared screenplay) */
  let exportOpen = false;
  let exportRef;

  /* ───── FILE HANDLING (upload / drag‑and‑drop) ────────────────── */
  async function parseFile (file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const txt = await file.text();

    try {
      screenplay = ext === 'fdx'
        ? Screenplay.fromFdx(txt)
        : Screenplay.fromPlain(txt, { markdown:true });
    } catch (err) {
      console.error('❌ Parse error:', err);
      return alert('Could not parse screenplay.');
    }
    await tick();                 // wait for both zones to re‑render
    zoneARef?.focusFirstElement(); // put caret in the first pane
  }

  function handleFileSelect (side, e) {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  }
  const handleDragOver  = side => { side==='A'? dragA=true : dragB=true; };
  const handleDragLeave = side => { side==='A'? dragA=false: dragB=false; };
  const handleDrop      = (side,e) => {
    side==='A'? dragA=false : dragB=false;
    const f = e.dataTransfer?.files?.[0];
    if (f) parseFile(f);
  };

  /* ───── EXPORT (shared) ───────────────────────────────────────── */
  function toggleExport ()     { exportOpen = !exportOpen; }
  function clickOutsideExport(e){
    if (exportOpen && !exportRef?.contains(e.target)) exportOpen = false;
  }
  function handleExport (type) {
    if (!screenplay) return alert('Nothing to export!');
    let content='', mime='text/plain', name='';
    switch (type) {
      case 'fdx':        content=screenplay.toFdx();            mime='application/xml';  name='screenplay.fdx'; break;
      case 'txt':        content=screenplay.toText(false,true);                         name='screenplay.txt'; break;
      case 'txt-layout': content=screenplay.toText(true,true);                          name='screenplay_layout.txt'; break;
      case 'json':       content=screenplay.toJson();            mime='application/json';name='screenplay.json'; break;
      default: return alert('Unknown export type');
    }
    const blob=new Blob([content],{type:mime});
    const url =URL.createObjectURL(blob);
    const a   =Object.assign(document.createElement('a'),{href:url,download:name});
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    exportOpen=false;
  }

  /* ───── mount: caret in empty doc, close export on clicks ─────── */
  onMount(async () => {
    document.addEventListener('click', clickOutsideExport);
    await tick(); zoneARef?.focusFirstElement();
    return () => document.removeEventListener('click', clickOutsideExport);
  });
</script>

<!-- ───── TOP BAR (export dropdown) ─────────────────────────────── -->
<div class="top-bar">
  <div class="export-dropdown" bind:this={exportRef}>
    <button class="export-button" on:click={toggleExport}>Export ▾</button>
    {#if exportOpen}
      <div class="export-menu">
        <div class="export-item" on:click={() => handleExport('fdx')}>Export FDX</div>
        <div class="export-item" on:click={() => handleExport('txt')}>Export TXT</div>
        <div class="export-item" on:click={() => handleExport('txt-layout')}>Export TXT (layout)</div>
        <div class="export-item" on:click={() => handleExport('json')}>Export JSON</div>
      </div>
    {/if}
  </div>
  <h3 style="margin:0 0 0 1rem; font-size:1rem;">Mirror Editors</h3>
</div>

<!-- ───── TWO DESKS SIDE‑BY‑SIDE (A & B) ────────────────────────── -->
<div class="desks">
  {#each ['A','B'] as pane}
    <div class="desk">
      <div class="side-header">{pane}</div>

      {#if pane === 'A'}
        <!-- upload wrapper – LEFT pane -->
        <div class="upload-wrapper {dragA ? 'drag-active' : ''}"
             on:click={() => fileInputA.click()}
             on:dragover|preventDefault|stopPropagation={() => handleDragOver('A')}
             on:dragleave={() => handleDragLeave('A')}
             on:drop|preventDefault|stopPropagation={e => handleDrop('A', e)}>

          <input type="file" accept=".fdx,.txt"
                 bind:this={fileInputA}
                 on:change={e => handleFileSelect('A', e)} />

          <p><strong>Drop</strong> a screenplay here<br>
             or <strong>click</strong> to choose</p>
        </div>

        <!-- editor bound to the *shared* screenplay -->
        <ScreenplayZone bind:screenplay bind:this={zoneARef}/>
      {:else}
        <!-- upload wrapper – RIGHT pane -->
        <div class="upload-wrapper {dragB ? 'drag-active' : ''}"
             on:click={() => fileInputB.click()}
             on:dragover|preventDefault|stopPropagation={() => handleDragOver('B')}
             on:dragleave={() => handleDragLeave('B')}
             on:drop|preventDefault|stopPropagation={e => handleDrop('B', e)}>

          <input type="file" accept=".fdx,.txt"
                 bind:this={fileInputB}
                 on:change={e => handleFileSelect('B', e)} />

          <p><strong>Drop</strong> a screenplay here<br>
             or <strong>click</strong> to choose</p>
        </div>

        <!-- editor bound to the *shared* screenplay -->
        <ScreenplayZone bind:screenplay bind:this={zoneBRef}/>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* top bar ------------------------------------------------------- */
  .top-bar {
    position:fixed; top:0; left:0; width:100%; height:2.5rem;
    background:#222; color:#fff; display:flex; align-items:center;
    padding:0 1rem; box-shadow:0 2px 4px rgba(0,0,0,0.25); z-index:1000;
  }

  /* export dropdown ---------------------------------------------- */
  .export-dropdown { position:relative; }
  .export-button   { background:none; border:1px solid #999; padding:0.25rem 0.6rem;
                     font-size:0.9rem; cursor:pointer; }
  .export-menu     { position:absolute; top:1.9rem; left:0; background:#fff; color:#000;
                     border:1px solid #ccc; box-shadow:0 2px 4px rgba(0,0,0,0.2);
                     width:max-content; z-index:999; }
  .export-item     { padding:0.3rem 0.8rem; cursor:pointer; }
  .export-item:hover{ background:#f0f0f0; }

  /* two‑pane layout ---------------------------------------------- */
  .desks {
    margin-top:2.5rem;             /* leave room for top bar */
    display:flex; gap:2rem;
    justify-content:center; align-items:flex-start;
    padding:1.5rem; box-sizing:border-box;
  }
  .desk {
    flex:1 1 0;
    min-width:min(61ch,100%);
    display:flex; flex-direction:column; align-items:center;
  }
  .side-header { font-weight:bold; margin-bottom:0.5rem; }

  /* upload wrapper ----------------------------------------------- */
  .upload-wrapper {
    width:61ch; max-width:100%;
    margin:0 0 1.5rem 0;
    border:2px dashed #888; border-radius:8px;
    padding:1.5rem; text-align:center; color:#555; cursor:pointer;
    box-sizing:border-box;
    transition:background 0.2s, border-color 0.2s;
  }
  .upload-wrapper.drag-active { background:#f0f8ff; border-color:#1e90ff; }
  .upload-wrapper input[type="file"] { display:none; }
</style>
