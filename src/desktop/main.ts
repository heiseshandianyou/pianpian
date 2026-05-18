import electron from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow, ipcMain } = electron;
const here = dirname(fileURLToPath(import.meta.url));
const desktopProfilePath = join(process.cwd(), ".pianpian-desktop-profile");

mkdirSync(desktopProfilePath, { recursive: true });
app.setPath("userData", desktopProfilePath);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

type PianpianWindow = InstanceType<typeof BrowserWindow>;

let mainWindow: PianpianWindow | undefined;
let backend: DesktopBackend | undefined;

app.whenReady().then(async () => {
  backend = await startBackend();
  registerIpc();
  mainWindow = createMainWindow();
  await loadMainWindow(mainWindow);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    await loadMainWindow(mainWindow);
  }
});

app.on("before-quit", () => {
  backend?.stop();
});

function createMainWindow(): PianpianWindow {
  return new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    title: "Pianpian",
    backgroundColor: "#f6efe2",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(here, "preload.cjs"),
    },
  });
}

function loadMainWindow(window: PianpianWindow): Promise<void> {
  const htmlPath = join(app.getPath("userData"), "pianpian-desktop.html");
  writeFileSync(htmlPath, renderHtml(), "utf8");
  return window.loadFile(htmlPath);
}

function registerIpc(): void {
  ipcMain.handle("pianpian:step", async (_event, input: unknown) => {
    const text = typeof input === "string" ? input.trim() : "";
    if (!text) {
      throw new Error("Input cannot be empty.");
    }

    return backendRequest("/step", {
      method: "POST",
      body: JSON.stringify({ input: text }),
      headers: {
        "content-type": "application/json",
      },
    });
  });

  ipcMain.handle("pianpian:stats", () => backendRequest("/stats"));
  ipcMain.handle("pianpian:memories", (_event, limit: unknown) => {
    const parsed = typeof limit === "number" && Number.isInteger(limit) ? limit : 12;
    return backendRequest(`/memories?limit=${Math.max(1, Math.min(parsed, 50))}`);
  });
  ipcMain.handle("pianpian:autonomy", () => backendRequest("/autonomy"));
  ipcMain.handle("pianpian:autonomy-start", () => backendRequest("/autonomy/start", { method: "POST" }));
  ipcMain.handle("pianpian:autonomy-stop", () => backendRequest("/autonomy/stop", { method: "POST" }));
  ipcMain.handle("pianpian:autonomy-heartbeat", () => backendRequest("/autonomy/heartbeat", { method: "POST" }));
}

async function backendRequest(path: string, init?: RequestInit): Promise<unknown> {
  if (!backend) {
    throw new Error("Backend is not ready.");
  }

  const response = await fetch(`http://127.0.0.1:${backend.port}${path}`, init);
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Backend request failed with ${response.status}.`);
  }
  return payload;
}

function startBackend(): Promise<DesktopBackend> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const nodePath = process.env.npm_node_execpath ?? "node";
    const child = spawn(nodePath, [join(here, "backend.js")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      windowsHide: true,
    });
    const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error("Desktop backend did not become ready in time."));
    }, 15_000);

    child.stderr.on("data", (chunk) => {
      console.error(`[pianpian-backend] ${String(chunk)}`);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Desktop backend exited before ready with code ${code ?? "unknown"}.`));
    });

    lines.on("line", (line) => {
      try {
        const event = JSON.parse(line) as { event?: string; port?: number };
        if (event.event === "ready" && typeof event.port === "number") {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(new DesktopBackend(child, event.port));
        }
      } catch {
        console.log(`[pianpian-backend] ${line}`);
      }
    });
  });
}

class DesktopBackend {
  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    readonly port: number,
  ) {}

  stop(): void {
    fetch(`http://127.0.0.1:${this.port}/shutdown`, { method: "POST" }).catch(() => {
      this.child.kill();
    });
  }
}

function renderHtml(): string {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pianpian</title>
  <style>
    :root {
      --ink: #211810;
      --muted: #756650;
      --paper: #fff8ea;
      --panel: rgba(255, 250, 239, 0.92);
      --line: rgba(70, 47, 24, 0.16);
      --clay: #b75a38;
      --clay-dark: #8f412a;
      --moss: #426b4f;
      --gold: #d5a143;
      --blue: #2f6478;
      --soft: rgba(66, 107, 79, 0.10);
      --shadow: 0 20px 60px rgba(61, 39, 17, 0.14);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(213, 161, 67, 0.22), transparent 34%),
        radial-gradient(circle at 86% 18%, rgba(66, 107, 79, 0.16), transparent 30%),
        linear-gradient(135deg, #f5e8d2 0%, #fbf4e7 58%, #ead9c0 100%);
      overflow: hidden;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.26;
      background-image:
        linear-gradient(rgba(32, 24, 15, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(32, 24, 15, 0.04) 1px, transparent 1px);
      background-size: 36px 36px;
      mask-image: radial-gradient(circle at 50% 45%, black, transparent 82%);
    }

    .shell {
      position: relative;
      min-height: 100vh;
      padding: 18px;
      display: grid;
      place-items: center;
    }

    .panel {
      width: min(1160px, 100%);
      height: calc(100vh - 36px);
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
      overflow: hidden;
    }

    .app {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .header {
      padding: 18px 22px 14px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(90deg, rgba(184, 90, 56, 0.12), rgba(213, 161, 67, 0.10));
    }

    .title-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: end;
    }

    .eyebrow {
      margin: 0 0 6px;
      color: var(--moss);
      font: 800 11px/1.2 "Trebuchet MS", sans-serif;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(30px, 3vw, 44px);
      line-height: 1;
      letter-spacing: -0.045em;
    }

    .subtitle {
      margin: 8px 0 0;
      color: var(--muted);
      font: 14px/1.45 "Trebuchet MS", sans-serif;
    }

    .nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .nav-button,
    button {
      border: 0;
      border-radius: 999px;
      min-height: 38px;
      padding: 0 16px;
      color: #fffaf0;
      background: linear-gradient(135deg, var(--clay), var(--clay-dark));
      font: 800 13px/1 "Trebuchet MS", sans-serif;
      letter-spacing: 0.04em;
      cursor: pointer;
      box-shadow: 0 12px 26px rgba(184, 90, 56, 0.22);
    }

    .nav-button {
      color: var(--ink);
      background: rgba(255, 255, 255, 0.46);
      border: 1px solid var(--line);
      box-shadow: none;
    }

    .nav-button.active {
      color: #fffaf0;
      background: linear-gradient(135deg, var(--blue), #264f60);
      border-color: transparent;
    }

    button:disabled {
      cursor: wait;
      filter: grayscale(0.35);
      opacity: 0.72;
    }

    .status-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(255,255,255,0.44);
      color: var(--muted);
      font: 700 12px/1 "Trebuchet MS", sans-serif;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--clay);
      box-shadow: 0 0 0 4px rgba(184, 90, 56, 0.16);
    }

    .pages {
      min-height: 0;
      overflow: hidden;
    }

    .page {
      display: none;
      height: 100%;
      min-height: 0;
      padding: 20px;
      overflow: auto;
    }

    .page.active { display: block; }

    .chat-page.active {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      padding: 0;
      overflow: hidden;
    }

    .conversation {
      padding: 22px;
      overflow: auto;
    }

    .message {
      max-width: min(760px, 84%);
      margin: 0 0 14px;
      padding: 15px 17px;
      border-radius: 20px;
      white-space: pre-wrap;
      line-height: 1.48;
      animation: rise 220ms ease-out both;
    }

    .message.user {
      margin-left: auto;
      background: var(--blue);
      color: #fffaf0;
      border-bottom-right-radius: 6px;
      font-family: "Trebuchet MS", sans-serif;
    }

    .message.agent {
      background: #fffaf0;
      border: 1px solid var(--line);
      border-bottom-left-radius: 6px;
    }

    .composer {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 16px 18px 18px;
      border-top: 1px solid var(--line);
      background: rgba(255, 248, 234, 0.84);
    }

    textarea {
      width: 100%;
      min-height: 54px;
      max-height: 150px;
      resize: vertical;
      border: 1px solid rgba(32, 24, 15, 0.18);
      border-radius: 18px;
      padding: 14px 16px;
      background: #fffaf0;
      color: var(--ink);
      outline: none;
      font: 15px/1.4 "Trebuchet MS", sans-serif;
    }

    input[type="search"] {
      width: 100%;
      min-height: 40px;
      border: 1px solid rgba(32, 24, 15, 0.18);
      border-radius: 999px;
      padding: 0 14px;
      background: #fffaf0;
      color: var(--ink);
      outline: none;
      font: 13px/1.4 "Trebuchet MS", sans-serif;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .grid.single { grid-template-columns: 1fr; }

    .card {
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 16px;
      background: rgba(255,250,240,0.74);
    }

    .card.wide { grid-column: 1 / -1; }

    .card h2 {
      margin: 0 0 12px;
      font-size: 19px;
      letter-spacing: -0.02em;
    }

    .hint {
      margin: -4px 0 14px;
      color: var(--muted);
      font: 13px/1.45 "Trebuchet MS", sans-serif;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }

    .stat {
      border-radius: 16px;
      padding: 13px;
      background: var(--soft);
    }

    .stat strong {
      display: block;
      font-size: 25px;
      line-height: 1;
    }

    .stat span {
      color: var(--muted);
      font: 800 11px/1 "Trebuchet MS", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .list {
      display: grid;
      gap: 10px;
    }

    .vault-layout {
      display: grid;
      grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.6fr);
      gap: 14px;
      min-height: 520px;
    }

    .vault-list {
      align-content: start;
      max-height: calc(100vh - 260px);
      overflow: auto;
      padding-right: 4px;
    }

    .vault-file {
      width: 100%;
      min-height: auto;
      border-radius: 16px;
      padding: 12px;
      text-align: left;
      color: var(--ink);
      background: rgba(255,255,255,0.50);
      border: 1px solid var(--line);
      box-shadow: none;
      font: 800 13px/1.35 "Trebuchet MS", sans-serif;
      overflow-wrap: anywhere;
    }

    .vault-file.active {
      color: #fffaf0;
      background: linear-gradient(135deg, var(--blue), #264f60);
      border-color: transparent;
    }

    .vault-file small {
      display: block;
      margin-top: 5px;
      color: inherit;
      opacity: 0.72;
      font: 700 11px/1.2 "Trebuchet MS", sans-serif;
    }

    .vault-reader {
      min-height: 420px;
      max-height: calc(100vh - 260px);
      overflow: auto;
    }

    .vault-editor {
      min-height: 420px;
      max-height: calc(100vh - 260px);
      margin-top: 10px;
      resize: vertical;
      font: 12px/1.45 "Cascadia Code", Consolas, monospace;
    }

    .vault-actions {
      margin-top: 10px;
      align-items: center;
    }

    .memory {
      border-left: 4px solid var(--gold);
      border-radius: 14px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.48);
      font-size: 13px;
      line-height: 1.38;
    }

    .memory small {
      display: block;
      margin-bottom: 5px;
      color: var(--blue);
      font: 800 11px/1 "Trebuchet MS", sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .button-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }

    .field-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      margin-top: 12px;
    }

    .vault-summary {
      margin-top: 12px;
    }

    .small-button.secondary {
      color: var(--ink);
      background: rgba(66, 107, 79, 0.14);
      border: 1px solid var(--line);
      box-shadow: none;
    }

    details {
      margin-top: 10px;
      color: var(--muted);
      font-size: 13px;
    }

    summary {
      cursor: pointer;
      color: var(--ink);
      font: 800 12px/1.2 "Trebuchet MS", sans-serif;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    pre {
      margin: 10px 0 0;
      max-height: 260px;
      overflow: auto;
      border-radius: 14px;
      padding: 12px;
      background: rgba(32, 24, 15, 0.08);
      color: var(--ink);
      white-space: pre-wrap;
      font: 12px/1.45 "Cascadia Code", Consolas, monospace;
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 820px) {
      body { overflow: auto; }
      .shell { min-height: 100vh; padding: 10px; }
      .panel { min-height: calc(100vh - 20px); height: auto; }
      .title-row { grid-template-columns: 1fr; align-items: start; }
      .nav { justify-content: flex-start; }
      .page { padding: 14px; }
      .grid, .stats { grid-template-columns: 1fr; }
      .vault-layout { grid-template-columns: 1fr; min-height: auto; }
      .vault-list, .vault-reader { max-height: none; }
      .message { max-width: 96%; }
      .composer { grid-template-columns: 1fr; }
      button { min-height: 44px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel app">
      <header class="header">
        <div class="title-row">
          <div>
            <p class="eyebrow">Pianpian Desktop Shell</p>
            <h1>&#32793;&#32793;&#37266;&#30528;&#12290;</h1>
            <p class="subtitle">&#23569;&#19968;&#28857;&#26085;&#24535;&#65292;&#22810;&#19968;&#28857;&#30495;&#27491;&#26377;&#29992;&#30340;&#22238;&#24212;&#12290;</p>
          </div>
          <nav class="nav" aria-label="Pages">
            <button class="nav-button active" data-page-target="chat" type="button">&#23545;&#35805;</button>
            <button class="nav-button" data-page-target="memory" type="button">&#26368;&#36817;&#35760;&#24518;</button>
            <button class="nav-button" data-page-target="vault" type="button">Vault/&#35760;&#24518;&#26723;&#26696;</button>
            <button class="nav-button" data-page-target="status" type="button">&#26412;&#36718;&#29366;&#24577;</button>
            <button class="nav-button" data-page-target="autonomy" type="button">&#33258;&#20027;</button>
          </nav>
        </div>
        <div class="status-strip">
          <span class="pill"><span class="dot"></span><span id="route">route: idle</span></span>
          <span class="pill" id="agents">agents: none</span>
        </div>
      </header>

      <main class="pages">
        <section class="page chat-page active" data-page="chat">
          <div class="conversation" id="conversation">
            <div class="message agent">&#25105;&#22312;&#12290;</div>
          </div>
          <form class="composer" id="form">
            <textarea id="input" placeholder="Talk to Pianpian..." autofocus></textarea>
            <button id="send" type="submit">Send</button>
          </form>
        </section>

        <section class="page" data-page="memory">
          <div class="grid single">
            <section class="card">
              <h2>&#35760;&#24518;&#27010;&#35272;</h2>
              <p class="hint">&#36825;&#37324;&#21482;&#26174;&#31034;&#26368;&#36817;&#34987;&#28608;&#27963;&#25110;&#20889;&#20837;&#30340;&#35760;&#24518;&#65292;&#29992;&#26469;&#24555;&#36895;&#21028;&#26029;&#22905;&#27492;&#21051;&#27491;&#35748;&#24471;&#20160;&#20040;&#12290;</p>
              <div class="stats">
                <div class="stat"><strong id="stat-total">0</strong><span>Total</span></div>
                <div class="stat"><strong id="stat-active">0</strong><span>Active</span></div>
                <div class="stat"><strong id="stat-archived">0</strong><span>Archived</span></div>
                <div class="stat"><strong id="stat-pinned">0</strong><span>Pinned</span></div>
              </div>
            </section>
            <section class="card">
              <h2>&#26368;&#36817;&#35760;&#24518;</h2>
              <div id="memories" class="list"></div>
            </section>
          </div>
        </section>

        <section class="page" data-page="vault">
          <div class="vault-layout">
            <section class="card">
              <h2>Vault/&#35760;&#24518;&#26723;&#26696;</h2>
              <p class="hint">&#21015;&#20986; Markdown Memory Vault &#37324;&#30340;&#25991;&#20214;&#65292;&#28857;&#20987;&#21487;&#20197;&#26597;&#30475;&#21407;&#22987;&#20869;&#23481;&#12290;</p>
              <div class="button-row">
                <button class="small-button secondary" id="vault-refresh" type="button">&#21047;&#26032;</button>
                <button class="small-button secondary" id="vault-dry-run" type="button">Dry-run rebuild</button>
                <button class="small-button" id="vault-rebuild" type="button">Rebuild index</button>
              </div>
              <form class="field-row" id="vault-search-form">
                <input id="vault-search" type="search" placeholder="Search vault text..." />
                <button class="small-button" id="vault-search-button" type="submit">Search</button>
              </form>
              <div id="vault-summary" class="vault-summary"><div class="memory"><small>vault</small><div>Read, edit, search, and rebuild Markdown memories. Saves normalize frontmatter before writing.</div></div></div>
              <div id="vault-list" class="list vault-list"><div class="memory"><small>loading</small><div>Loading vault files.</div></div></div>
            </section>
            <section class="card">
              <h2 id="vault-title">&#36873;&#25321;&#19968;&#20010;&#26723;&#26696;</h2>
              <p class="hint" id="vault-meta">&#23578;&#26410;&#25171;&#24320; Markdown &#25991;&#20214;&#12290;</p>
              <div class="button-row vault-actions">
                <button class="small-button secondary" id="vault-edit-toggle" type="button" disabled>Edit</button>
                <button class="small-button" id="vault-save" type="button" disabled>Save</button>
              </div>
              <pre id="vault-content" class="vault-reader">&#20174;&#24038;&#20391;&#21015;&#34920;&#28857;&#20987;&#19968;&#20010; .md &#25991;&#20214;&#12290;</pre>
              <textarea id="vault-editor" class="vault-editor" spellcheck="false" hidden></textarea>
            </section>
          </div>
        </section>

        <section class="page" data-page="status">
          <div class="grid">
            <section class="card">
              <h2>&#36335;&#30001;</h2>
              <div id="status-summary" class="list">
                <div class="memory"><small>route</small><div>idle</div></div>
              </div>
            </section>
            <section class="card">
              <h2>&#24037;&#20855;&#36755;&#20986;</h2>
              <div id="tools" class="list"><div class="memory"><small>idle</small><div>&#26412;&#36718;&#27809;&#26377;&#24037;&#20855;&#36755;&#20986;&#12290;</div></div></div>
            </section>
            <section class="card wide">
              <h2>&#26412;&#36718;&#19978;&#19979;&#25991;</h2>
              <p class="hint">&#27599;&#27425;&#23545;&#35805;&#37117;&#20250;&#37325;&#26032;&#32452;&#32455;&#19968;&#27425;&#19978;&#19979;&#25991;&#65292;&#36825;&#37324;&#26174;&#31034;&#26412;&#36718;&#23454;&#38469;&#25237;&#20837;&#30340;&#20449;&#24687;&#12290;</p>
              <div id="context" class="list"><div class="memory"><small>context</small><div>&#36824;&#27809;&#26377;&#26412;&#36718;&#19978;&#19979;&#25991;&#12290;</div></div></div>
            </section>
          </div>
        </section>

        <section class="page" data-page="autonomy">
          <div class="grid single">
            <section class="card">
              <h2>&#33258;&#20027;&#29366;&#24577;</h2>
              <p class="hint">&#36825;&#37324;&#25511;&#21046;&#22905;&#30340;&#33258;&#20027;&#24515;&#36339;&#65306;&#22312;&#27809;&#26377;&#26032;&#20219;&#21153;&#26102;&#65292;&#22905;&#20063;&#21487;&#20197;&#20570;&#20869;&#37096;&#25972;&#29702;&#21644;&#35760;&#24518;&#24037;&#20316;&#12290;</p>
              <div id="autonomy" class="list"><div class="memory"><small>booting</small><div>Waiting for heartbeat state.</div></div></div>
              <div class="button-row">
                <button class="small-button secondary" id="autonomy-start" type="button">&#24320;&#22987;</button>
                <button class="small-button secondary" id="autonomy-stop" type="button">&#26242;&#20572;</button>
                <button class="small-button" id="autonomy-now" type="button">&#24819;&#19968;&#19979;</button>
              </div>
            </section>
          </div>
        </section>
      </main>
    </section>
  </div>

  <script>
    const backendBase = ${JSON.stringify(backend ? `http://127.0.0.1:${backend.port}` : "")};
    const conversation = document.querySelector("#conversation");
    const form = document.querySelector("#form");
    const input = document.querySelector("#input");
    const send = document.querySelector("#send");
    const route = document.querySelector("#route");
    const agents = document.querySelector("#agents");
    const tools = document.querySelector("#tools");
    const memories = document.querySelector("#memories");
    const contextPanel = document.querySelector("#context");
    const statusSummary = document.querySelector("#status-summary");
    const autonomyPanel = document.querySelector("#autonomy");
    const autonomyStart = document.querySelector("#autonomy-start");
    const autonomyStop = document.querySelector("#autonomy-stop");
    const autonomyNow = document.querySelector("#autonomy-now");
    const vaultList = document.querySelector("#vault-list");
    const vaultRefresh = document.querySelector("#vault-refresh");
    const vaultDryRun = document.querySelector("#vault-dry-run");
    const vaultRebuild = document.querySelector("#vault-rebuild");
    const vaultSearchForm = document.querySelector("#vault-search-form");
    const vaultSearch = document.querySelector("#vault-search");
    const vaultSearchButton = document.querySelector("#vault-search-button");
    const vaultSummary = document.querySelector("#vault-summary");
    const vaultTitle = document.querySelector("#vault-title");
    const vaultMeta = document.querySelector("#vault-meta");
    const vaultContent = document.querySelector("#vault-content");
    const vaultEditor = document.querySelector("#vault-editor");
    const vaultEditToggle = document.querySelector("#vault-edit-toggle");
    const vaultSave = document.querySelector("#vault-save");
    const pageButtons = Array.from(document.querySelectorAll("[data-page-target]"));
    const pages = Array.from(document.querySelectorAll("[data-page]"));
    let vaultLoaded = false;
    let selectedVaultPath = "";
    let selectedVaultMarkdown = "";
    let vaultEditing = false;

    for (const button of pageButtons) {
      button.addEventListener("click", () => showPage(button.dataset.pageTarget));
    }

    function showPage(pageName) {
      for (const page of pages) page.classList.toggle("active", page.dataset.page === pageName);
      for (const button of pageButtons) button.classList.toggle("active", button.dataset.pageTarget === pageName);
      if (pageName === "chat") input.focus();
      if (pageName === "vault" && !vaultLoaded) loadVault();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      showPage("chat");
      appendMessage("user", text);
      input.value = "";
      send.disabled = true;
      try {
        const result = await window.pianpian.step(text);
        updateRoute(result);
        const replies = result.replies.filter(shouldShowReply);
        if (replies.length > 0) {
          for (const reply of replies) appendMessage("agent", reply);
        } else if (result.tools && result.tools.length > 0) {
          appendMessage("agent", summarizeToolsForChat(result.tools));
        }
        renderTools(result.tools || []);
        renderStats(result.stats);
        renderMemories(result.memories || []);
        renderContext(result.context);
        renderAutonomy(await window.pianpian.autonomy());
        if (Array.isArray(result.backgroundJobs) && result.backgroundJobs.length > 0) {
          setTimeout(refresh, 2500);
          setTimeout(refresh, 7000);
        }
      } catch (error) {
        appendMessage("agent", "Something went wrong: " + (error && error.message ? error.message : String(error)));
      } finally {
        send.disabled = false;
        input.focus();
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) form.requestSubmit();
    });

    autonomyStart.addEventListener("click", async () => renderAutonomy(await window.pianpian.startAutonomy()));
    autonomyStop.addEventListener("click", async () => renderAutonomy(await window.pianpian.stopAutonomy()));
    vaultRefresh.addEventListener("click", loadVault);
    vaultDryRun.addEventListener("click", previewVaultRebuild);
    vaultRebuild.addEventListener("click", rebuildVaultIndex);
    vaultSearchForm.addEventListener("submit", searchVault);
    vaultEditToggle.addEventListener("click", () => setVaultEditing(!vaultEditing));
    vaultSave.addEventListener("click", saveVaultFile);
    autonomyNow.addEventListener("click", async () => {
      autonomyNow.disabled = true;
      try {
        const state = await window.pianpian.heartbeat();
        renderAutonomy(state);
        if (state.lastHeartbeat && state.lastHeartbeat.cycle) {
          renderStats(state.lastHeartbeat.cycle.stats);
          renderMemories(state.lastHeartbeat.cycle.memories || []);
          renderContext(state.lastHeartbeat.cycle.context);
        }
      } finally {
        autonomyNow.disabled = false;
      }
    });

    async function refresh() {
      renderStats(await window.pianpian.stats());
      renderMemories(await window.pianpian.memories(12));
      renderAutonomy(await window.pianpian.autonomy());
    }

    async function loadVault() {
      vaultRefresh.disabled = true;
      vaultList.innerHTML = "";
      vaultList.appendChild(memoryNode("loading", "Loading Markdown vault files."));
      renderVaultSummary("vault", "Listing Markdown vault files. Open a file to edit it, or dry-run rebuild before importing.");
      try {
        const items = await vaultRequest("/vault");
        vaultLoaded = true;
        renderVaultList(Array.isArray(items) ? items : []);
      } catch (error) {
        vaultList.innerHTML = "";
        vaultList.appendChild(memoryNode("error", error && error.message ? error.message : String(error)));
      } finally {
        vaultRefresh.disabled = false;
      }
    }

    async function searchVault(event) {
      event.preventDefault();
      const query = vaultSearch.value.trim();
      if (!query) {
        await loadVault();
        return;
      }

      vaultSearchButton.disabled = true;
      vaultList.innerHTML = "";
      vaultList.appendChild(memoryNode("searching", "Searching Markdown vault files."));
      try {
        const payload = await vaultRequest("/vault/search?q=" + encodeURIComponent(query));
        renderVaultSearchResults(payload);
      } catch (error) {
        vaultList.innerHTML = "";
        vaultList.appendChild(memoryNode("error", error && error.message ? error.message : String(error)));
      } finally {
        vaultSearchButton.disabled = false;
      }
    }

    async function previewVaultRebuild() {
      vaultDryRun.disabled = true;
      renderVaultSummary("dry-run", "Scanning vault files and previewing memory imports. This does not write anything.");
      try {
        const payload = await vaultRequest("/vault/rebuild/dry-run", { method: "POST" });
        const warningText = payload.warnings && payload.warnings.length
          ? "\nWarnings:\n" + payload.warnings.slice(0, 6).join("\n")
          : "";
        renderVaultSummary(
          "dry-run complete",
          [
            "Files scanned: " + payload.filesScanned,
            "Files with suggestions: " + payload.filesWithSuggestions,
            "Imported: " + payload.suggestedMemories + " (preview only)",
            "Skipped: " + payload.skipped,
            "Errors: " + payload.errors,
            "Readonly: " + (payload.readonly ? "yes" : "no"),
          ].join(" - ") + warningText,
        );
      } catch (error) {
        renderVaultSummary("dry-run failed", error && error.message ? error.message : String(error));
      } finally {
        vaultDryRun.disabled = false;
      }
    }

    async function rebuildVaultIndex() {
      const requiredText = "REBUILD VAULT";
      const confirmText = window.prompt(
        "This will import Markdown vault memories into MemoryStore. Type " + requiredText + " to continue.",
      );
      if (confirmText === null) {
        renderVaultSummary("rebuild cancelled", "No changes were written.");
        return;
      }
      if (confirmText.trim() !== requiredText) {
        renderVaultSummary("rebuild blocked", "Confirmation text did not match. No changes were written.");
        return;
      }

      vaultRebuild.disabled = true;
      vaultDryRun.disabled = true;
      renderVaultSummary("rebuild", "Rebuilding Markdown vault index and writing imported memories.");
      try {
        const payload = await vaultRequest("/vault/rebuild", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmText: requiredText }),
        });
        renderVaultSummary("rebuild complete", formatRebuildSummary(payload));
        if (payload.stats) renderStats(payload.stats);
        if (Array.isArray(payload.memories)) renderMemories(payload.memories);
      } catch (error) {
        renderVaultSummary("rebuild failed", error && error.message ? error.message : String(error));
      } finally {
        vaultRebuild.disabled = false;
        vaultDryRun.disabled = false;
      }
    }

    async function readVaultFile(path) {
      if (!confirmVaultEditorNavigation()) return;
      selectedVaultPath = path;
      selectedVaultMarkdown = "";
      setVaultEditing(false);
      vaultEditToggle.disabled = true;
      vaultSave.disabled = true;
      renderVaultSelection();
      vaultTitle.textContent = path;
      vaultMeta.textContent = "Loading...";
      vaultContent.textContent = "";
      vaultEditor.value = "";
      try {
        const entry = await vaultRequest("/vault/read?path=" + encodeURIComponent(path));
        selectedVaultMarkdown = entry.markdown || entry.body || "";
        vaultTitle.textContent = entry.path || path;
        vaultMeta.textContent = [
          entry.updatedAt ? "updated " + new Date(entry.updatedAt).toLocaleString() : "",
          entry.createdAt ? "created " + entry.createdAt : "",
        ].filter(Boolean).join(" - ") || "Markdown vault file";
        vaultContent.textContent = selectedVaultMarkdown;
        vaultEditor.value = selectedVaultMarkdown;
        vaultEditToggle.disabled = false;
      } catch (error) {
        vaultMeta.textContent = "Read failed.";
        vaultContent.textContent = error && error.message ? error.message : String(error);
      }
    }

    function confirmVaultEditorNavigation() {
      if (!vaultEditing || vaultEditor.value === selectedVaultMarkdown) return true;
      return window.confirm("You have unsaved vault edits. Discard them and open another file?");
    }

    function setVaultEditing(enabled) {
      vaultEditing = Boolean(enabled && selectedVaultPath);
      vaultContent.hidden = vaultEditing;
      vaultEditor.hidden = !vaultEditing;
      vaultEditToggle.textContent = vaultEditing ? "Cancel" : "Edit";
      vaultSave.disabled = !vaultEditing;
      if (vaultEditing) {
        vaultEditor.focus();
      } else {
        vaultEditor.value = selectedVaultMarkdown;
      }
    }

    async function saveVaultFile() {
      if (!selectedVaultPath || !vaultEditing) return;
      vaultSave.disabled = true;
      vaultEditToggle.disabled = true;
      renderVaultSummary("saving", "Writing Markdown vault file.");
      try {
        const entry = await vaultRequest("/vault/write", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: selectedVaultPath,
            markdown: vaultEditor.value,
          }),
        });
        selectedVaultPath = entry.path || selectedVaultPath;
        selectedVaultMarkdown = entry.markdown || entry.body || vaultEditor.value;
        vaultTitle.textContent = selectedVaultPath;
        vaultMeta.textContent = [
          entry.updatedAt ? "updated " + new Date(entry.updatedAt).toLocaleString() : "",
          entry.createdAt ? "created " + entry.createdAt : "",
        ].filter(Boolean).join(" - ") || "Markdown vault file saved";
        vaultContent.textContent = selectedVaultMarkdown;
        setVaultEditing(false);
        renderVaultSummary("saved", selectedVaultPath);
        if (vaultSearch.value.trim()) {
          await searchVault(new Event("submit"));
        } else {
          await loadVault();
        }
        renderVaultSummary("saved", selectedVaultPath);
        renderVaultSelection();
      } catch (error) {
        renderVaultSummary("save failed", error && error.message ? error.message : String(error));
      } finally {
        vaultEditToggle.disabled = !selectedVaultPath;
        vaultSave.disabled = !vaultEditing;
      }
    }

    async function vaultRequest(path, init) {
      if (!backendBase) throw new Error("Backend is not ready.");
      const response = await fetch(backendBase + path, init);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Vault request failed with " + response.status + ".");
      return payload;
    }

    function renderVaultSummary(label, text) {
      vaultSummary.innerHTML = "";
      vaultSummary.appendChild(memoryNode(label, text));
    }

    function formatRebuildSummary(payload) {
      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      const errorText = errors.length ? "\nErrors:\n" + errors.slice(0, 6).join("\n") : "";
      return [
        "Files scanned: " + (payload.filesScanned || 0),
        "Imported: " + (payload.imported || 0),
        "Skipped: " + (payload.skipped || 0),
        "Errors: " + errors.length,
      ].join(" - ") + errorText;
    }

    function renderVaultList(items) {
      vaultList.innerHTML = "";
      if (!items.length) {
        vaultList.appendChild(memoryNode("empty", "\u8fd8\u6ca1\u6709 Markdown Vault \u6587\u4ef6\u3002"));
        return;
      }
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "vault-file";
        button.dataset.vaultPath = item.path;
        button.textContent = item.path;
        const meta = document.createElement("small");
        meta.textContent = formatBytes(item.sizeBytes) + " - " + new Date(item.updatedAt).toLocaleString();
        button.appendChild(meta);
        button.addEventListener("click", () => readVaultFile(item.path));
        vaultList.appendChild(button);
      }
      renderVaultSelection();
    }

    function renderVaultSearchResults(payload) {
      const results = Array.isArray(payload.results) ? payload.results : [];
      vaultList.innerHTML = "";
      renderVaultSummary(
        "search",
        '"' + (payload.query || "") + '" matched ' + (payload.totalMatches || 0) + " line(s) in " + (payload.totalFiles || 0) + " file(s).",
      );
      if (!results.length) {
        vaultList.appendChild(memoryNode("no matches", "No vault files matched this search."));
        return;
      }
      for (const item of results) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "vault-file";
        button.dataset.vaultPath = item.path;
        button.textContent = item.path;
        const meta = document.createElement("small");
        const matches = Array.isArray(item.matches) ? item.matches : [];
        const preview = matches
          .slice(0, 3)
          .map((match) => "L" + match.line + ": " + String(match.text || "").trim())
          .join(" | ");
        meta.textContent = matches.length + " shown" + (item.omittedMatches ? ", +" + item.omittedMatches + " more" : "") + (preview ? " - " + preview : "");
        button.appendChild(meta);
        button.addEventListener("click", () => readVaultFile(item.path));
        vaultList.appendChild(button);
      }
      renderVaultSelection();
    }

    function renderVaultSelection() {
      for (const button of vaultList.querySelectorAll(".vault-file")) {
        button.classList.toggle("active", button.dataset.vaultPath === selectedVaultPath);
      }
    }

    function updateRoute(result) {
      const timing = typeof result.durationMs === "number" ? " - " + (result.durationMs / 1000).toFixed(1) + "s" : "";
      const routeText = "route: " + result.route.mode + " (" + result.route.confidence.toFixed(2) + ")" + timing;
      const background = Array.isArray(result.backgroundJobs) && result.backgroundJobs.length > 0
        ? " - bg: " + result.backgroundJobs.map((job) => job.agentId).join(", ")
        : "";
      const agentsText = "agents: " + compactAgents(result.route.selectedAgentIds) + background;
      route.textContent = routeText;
      agents.textContent = agentsText;
      statusSummary.innerHTML = "";
      statusSummary.appendChild(memoryNode("route", routeText));
      statusSummary.appendChild(memoryNode("agents", agentsText));
    }

    function appendMessage(kind, text) {
      const node = document.createElement("div");
      node.className = "message " + kind;
      node.textContent = text;
      conversation.appendChild(node);
      conversation.scrollTop = conversation.scrollHeight;
    }

    function renderStats(stats) {
      document.querySelector("#stat-total").textContent = stats.total;
      document.querySelector("#stat-active").textContent = stats.active;
      document.querySelector("#stat-archived").textContent = stats.archived;
      document.querySelector("#stat-pinned").textContent = stats.pinned;
    }

    function renderTools(items) {
      tools.innerHTML = "";
      if (!items.length) {
        tools.appendChild(memoryNode("idle", "\u672c\u8f6e\u6ca1\u6709\u5de5\u5177\u8f93\u51fa\u3002"));
        return;
      }
      for (const item of items.slice(0, 5)) tools.appendChild(memoryNode(item.toolName + " - " + item.status, compactToolOutput(item)));
    }

    function renderMemories(items) {
      memories.innerHTML = "";
      if (!items.length) {
        memories.appendChild(memoryNode("empty", "\u8fd8\u6ca1\u6709\u8bb0\u5fc6\u3002"));
        return;
      }
      for (const item of items.slice(0, 12)) memories.appendChild(memoryNode(item.kind + " - " + item.status, item.text));
    }

    function renderAutonomy(state) {
      autonomyPanel.innerHTML = "";
      const status = state && state.status ? state.status : {};
      const drive = status.lastDrive ? status.lastDrive.name : "none yet";
      const last = status.lastCompletedAt ? new Date(status.lastCompletedAt).toLocaleTimeString() : "not yet";
      const line = [
        status.running ? "running" : "paused",
        status.inFlight ? "thinking" : "idle",
        "heartbeat " + Math.round((status.heartbeatMs || 0) / 1000) + "s",
        "total " + (status.totalHeartbeats || 0),
        "drive " + drive,
        "last " + last,
      ].join(" - ");
      autonomyPanel.appendChild(memoryNode(status.lastError ? "error" : "state", line));
      if (state && state.lastHeartbeat) {
        const cycle = state.lastHeartbeat.cycle;
        const innerThought = cycle && Array.isArray(cycle.proposals)
          ? cycle.proposals.find((proposal) => proposal.agentId === "proactive-scheduler") ||
            cycle.proposals.find((proposal) => proposal.agentId === "proactive-intent") ||
            cycle.proposals.find((proposal) => proposal.agentId === "desire-habit") ||
            cycle.proposals.find((proposal) => proposal.agentId === "inner-life")
          : undefined;
        const reply = innerThought && innerThought.content
          ? innerThought.content
          : cycle && Array.isArray(cycle.replies) && cycle.replies.length > 0
          ? cycle.replies.join("\n")
          : "\u6ca1\u6709\u5bf9\u5916\u56de\u590d\uff0c\u53ea\u66f4\u65b0\u4e86\u5185\u90e8\u8bb0\u5fc6\u3002";
        autonomyPanel.appendChild(memoryNode("last thought", reply));
      }
    }

    function renderContext(context) {
      contextPanel.innerHTML = "";
      if (!context) {
        contextPanel.appendChild(memoryNode("empty", "\u8fd8\u6ca1\u6709\u672c\u8f6e\u4e0a\u4e0b\u6587\u3002"));
        return;
      }

      const sections = [
        ["\u4efb\u52a1", context.currentTask],
        ["\u5de5\u4f5c\u8bb0\u5fc6", context.workingMemory],
        ["\u8eab\u4efd/\u5173\u7cfb", [context.selfModel, context.relevantEntities].filter(Boolean).join("\n")],
        ["\u7126\u70b9\u8bb0\u5fc6", context.focus],
        ["\u66f4\u591a\u4e0a\u4e0b\u6587", [
          "Goals:\n" + context.goals,
          "Preferences:\n" + context.preferences,
          "Long-term:\n" + context.longTermMemory,
          "Evidence:\n" + context.recentEvidence,
          "Trace:\n" + formatJson(context.trace),
        ].join("\n\n")],
      ];

      for (const [label, text] of sections) contextPanel.appendChild(detailNode(label, text || "None."));
    }

    function detailNode(label, text) {
      const node = document.createElement("details");
      if (["\u4efb\u52a1", "\u8eab\u4efd/\u5173\u7cfb", "\u7126\u70b9\u8bb0\u5fc6"].includes(label)) node.open = true;
      const summary = document.createElement("summary");
      summary.textContent = label;
      const pre = document.createElement("pre");
      pre.textContent = String(text);
      node.appendChild(summary);
      node.appendChild(pre);
      return node;
    }

    function formatJson(value) {
      return JSON.stringify(value, null, 2);
    }

    function formatBytes(value) {
      const bytes = Number(value) || 0;
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / 1024 / 1024).toFixed(1) + " MB";
    }

    function memoryNode(label, text) {
      const node = document.createElement("div");
      node.className = "memory";
      const small = document.createElement("small");
      small.textContent = label;
      const body = document.createElement("div");
      const bodyText = String(text || "");
      body.textContent = bodyText.length > 620 ? bodyText.slice(0, 617) + "..." : bodyText;
      node.appendChild(small);
      node.appendChild(body);
      return node;
    }

    function shouldShowReply(reply) {
      const text = String(reply || "").trim();
      if (!text) return false;
      return ![
        "\u5f53\u524d\u610f\u56fe\u6a21\u5f0f",
        "\u6211\u5df2\u7ecf\u4ece\u957f\u671f\u8bb0\u5fc6\u91cc\u505a\u4e86\u4e00\u6b21\u4e0a\u4e0b\u6587\u53ec\u56de",
        "\u6682\u65f6\u6ca1\u6709\u8db3\u591f\u7684\u7126\u70b9\u8bb0\u5fc6",
        "Current intent mode",
        "I recalled long-term memory",
      ].some((marker) => text.includes(marker));
    }

    function compactAgents(agentIds) {
      const visible = (agentIds || []).filter((agent) => !["memory-curator", "tool-reflector", "learning-evaluator"].includes(agent));
      if (!visible.length) return "none";
      return visible.slice(0, 4).join(", ") + (visible.length > 4 ? " +" + (visible.length - 4) : "");
    }

    function summarizeToolsForChat(items) {
      const failed = items.filter((item) => item.status !== "executed");
      if (failed.length > 0) return "\u5de5\u5177\u6709\u5931\u8d25\uff1a" + failed.map((item) => item.toolName).join(", ") + "\u3002\u6211\u5df2\u7ecf\u628a\u7ed3\u679c\u8bb0\u4e0b\u6765\u4e86\u3002";
      return "\u68c0\u67e5\u5b8c\u6210\uff1a" + items.map((item) => item.toolName).join(", ") + "\u3002";
    }

    function compactToolOutput(item) {
      if (item.error) return item.error;
      const text = String(item.output || "");
      if (item.status === "executed" && item.toolName === "workspace.search") {
        const lines = text.split("\n").filter(Boolean);
        return lines.length + " \u6761\u5339\u914d\u3002" + (lines.length ? "\n" + lines.slice(0, 4).join("\n") : "");
      }
      return text;
    }

    refresh();
    setInterval(refresh, 15000);
  </script>
</body>
</html>`;
}
