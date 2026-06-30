const themeName = document.body.dataset.themeName || "Vivi theme concept";
const themeThesis = document.body.dataset.themeThesis || "A quiet local review workspace theme.";

document.title = `${themeName} - Vivi theme exploration`;

document.body.innerHTML = `
  <div class="app">
    <header class="topbar">
      <div class="brand"><span class="logo"></span><span>vivi</span></div>
      <div class="pathbar">~/work/agent-output/docs-site</div>
      <div class="top-actions">
        <span class="pill"><span class="dot"></span>watching</span>
        <span class="pill">18 files</span>
        <span class="pill"><span class="kbd">Cmd</span><span class="kbd">K</span></span>
      </div>
    </header>

    <main class="workbench">
      <aside class="sidebar">
        <div class="panel-head"><span>Files</span><span>3 changed</span></div>
        <input class="search" value="read" aria-label="Filter files" />
        <div class="tree">
          <div class="node"><span class="twisty">v</span><span class="icon">D</span><span class="name">docs-site</span></div>
          <div class="indent">
            <div class="node active changed"><span class="twisty"></span><span class="icon">M</span><span class="name">README.md</span><span class="badge">2</span></div>
            <div class="node"><span class="twisty">v</span><span class="icon">D</span><span class="name">docs</span></div>
            <div class="indent">
              <div class="node changed"><span class="twisty"></span><span class="icon">M</span><span class="name">plan.md</span><span class="badge">1</span></div>
              <div class="node"><span class="twisty"></span><span class="icon">H</span><span class="name">preview.html</span></div>
              <div class="node"><span class="twisty"></span><span class="icon">J</span><span class="name">data.json</span></div>
            </div>
            <div class="node"><span class="twisty">v</span><span class="icon">D</span><span class="name">src</span></div>
            <div class="indent">
              <div class="node changed"><span class="twisty"></span><span class="icon">T</span><span class="name">App.tsx</span></div>
              <div class="node"><span class="twisty"></span><span class="icon">C</span><span class="name">styles.css</span></div>
            </div>
            <div class="node"><span class="twisty"></span><span class="icon">P</span><span class="name">screenshot.png</span></div>
          </div>
        </div>
      </aside>

      <section class="main">
        <div class="tabs">
          <div class="tab active changed">README.md <span class="x">x</span></div>
          <div class="tab changed">docs/plan.md <span class="x">x</span></div>
          <div class="tab">preview.html <span class="x">x</span></div>
          <div class="tab">App.tsx <span class="x">x</span></div>
        </div>
        <div class="viewer-toolbar">
          <span>README.md refreshed 12s ago</span>
          <span class="segmented"><span class="active">Rendered</span><span>Source</span><span>Diff</span></span>
        </div>
        <div class="viewer">
          <article class="reader">
            <div class="reader-head">
              <span>${themeName}</span>
              <span>${themeThesis}</span>
            </div>
            <div class="reader-body">
              <h1>Local review surface for generated workspaces</h1>
              <p>Vivi opens a read-only browser workspace for inspecting mixed local artifacts without leaving the directory tree. The active file stays central while review work, outline navigation, and recent file events remain visible.</p>
              <div class="callout">Current state: README.md has two open review threads, one unseen agent reply, and a watcher refresh from an external save.</div>
              <h2>Review loop</h2>
              <p>The right inspector prioritizes files that need attention, then falls back to headings and file details for the selected Markdown document.</p>
              <ul>
                <li>Live tree updates preserve spatial context.</li>
                <li>Tabs keep several artifacts open across Markdown, HTML, code, images, and structured files.</li>
                <li>HTML previews stay sandboxed unless script execution is explicitly enabled.</li>
              </ul>
              <h2>Safe preview defaults</h2>
              <p>The UI should make safety and freshness legible without becoming an IDE or a staging client.</p>
              <pre><code>vivi ./docs-site --host 127.0.0.1
GET /api/files/README.md?version=sha256:7a91...</code></pre>
            </div>
          </article>
        </div>
      </section>

      <aside class="inspector">
        <div class="panel-head"><span>Inspector</span><span>seen 4/7</span></div>
        <div class="inspector-scroll">
          <section class="section">
            <div class="section-title"><span>Review queue</span><span>3</span></div>
            <div class="queue-item active">
              <span class="path">README.md</span><span class="count">2</span>
              <span class="activity">unseen agent reply - 3 min ago</span>
            </div>
            <div class="queue-item">
              <span class="path">docs/plan.md</span><span class="count">1</span>
              <span class="activity">human draft comment - 9 min ago</span>
            </div>
            <div class="queue-item">
              <span class="path">src/App.tsx</span><span class="count">0</span>
              <span class="activity">changed +42 -11 against HEAD</span>
            </div>
          </section>

          <section class="section">
            <div class="section-title"><span>In this file</span><span>H1/H2</span></div>
            <div class="outline-item active"><span>Local review surface</span><span>1</span></div>
            <div class="outline-item h2"><span>Review loop</span><span>8</span></div>
            <div class="outline-item h2"><span>Safe preview defaults</span><span>17</span></div>
          </section>

          <section class="section">
            <div class="section-title"><span>Metadata</span></div>
            <div class="meta-row"><span>Kind</span><span>Markdown</span></div>
            <div class="meta-row"><span>Size</span><span>12.4 KB</span></div>
            <div class="meta-row"><span>Version</span><span>sha256:7a91</span></div>
            <div class="meta-row"><span>Sandbox</span><span>n/a</span></div>
          </section>

          <section class="section">
            <div class="section-title"><span>Recent events</span></div>
            <div class="event-item"><span class="event-kind">change</span><span>README.md refreshed</span></div>
            <div class="event-item"><span class="event-kind">add</span><span>docs/data.json</span></div>
            <div class="event-item"><span class="event-kind">unlink</span><span>tmp/report.html</span></div>
          </section>
        </div>
      </aside>
    </main>

    <footer class="statusbar">
      <span>127.0.0.1:4173</span>
      <span>4 tabs open</span>
      <span>watcher connected</span>
      <span>HTML scripts blocked by default</span>
    </footer>
  </div>

  <div class="overlay" aria-label="Command palette mock">
    <div class="palette">
      <input value="read" aria-label="Quick open" />
      <div class="result active"><span class="title">README.md</span><span class="state">open</span><span class="detail">Markdown - 2 open threads - refreshed 12s ago</span></div>
      <div class="result"><span class="title">docs/plan.md</span><span class="state">changed</span><span class="detail">Markdown - human draft comment</span></div>
      <div class="result"><span class="title">Open shortcut reference</span><span class="state">action</span><span class="detail">Search, diff, review queue, and tab shortcuts</span></div>
    </div>
  </div>
`;
