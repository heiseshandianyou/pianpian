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
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pianpian</title>
  <style>
    :root {
      --ink: #20180f;
      --muted: #77644c;
      --paper: #fff8ea;
      --panel: rgba(255, 250, 240, 0.9);
      --line: rgba(70, 47, 24, 0.18);
      --clay: #b85c38;
      --moss: #426b4f;
      --gold: #d9a441;
      --blue: #2f5f73;
      --shadow: 0 18px 55px rgba(61, 39, 17, 0.13);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      background:
        radial-gradient(circle at 18% 10%, rgba(217, 164, 65, 0.18), transparent 32%),
        radial-gradient(circle at 82% 18%, rgba(66, 107, 79, 0.14), transparent 30%),
        linear-gradient(135deg, #f5e8d2 0%, #fbf4e7 58%, #ead9c0 100%);
      overflow: hidden;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.33;
      background-image:
        linear-gradient(rgba(32, 24, 15, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(32, 24, 15, 0.04) 1px, transparent 1px);
      background-size: 34px 34px;
      mask-image: radial-gradient(circle at 50% 50%, black, transparent 82%);
    }

    .shell {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
      gap: 20px;
      height: 100vh;
      padding: 18px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
      overflow: hidden;
    }

    .main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
    }

    .header {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(90deg, rgba(184, 92, 56, 0.12), rgba(217, 164, 65, 0.10));
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--moss);
      font: 700 12px/1.2 "Trebuchet MS", sans-serif;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      max-width: 780px;
      font-size: clamp(32px, 3.2vw, 48px);
      line-height: 1;
      letter-spacing: -0.045em;
    }

    .subtitle {
      margin: 10px 0 0;
      color: var(--muted);
      font: 14px/1.45 "Trebuchet MS", sans-serif;
    }

    .route-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(255,255,255,0.42);
      color: var(--muted);
      font: 700 12px/1 "Trebuchet MS", sans-serif;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--clay);
      box-shadow: 0 0 0 4px rgba(184, 92, 56, 0.16);
    }

    .conversation {
      padding: 22px;
      overflow: auto;
    }

    .message {
      max-width: 82%;
      margin: 0 0 16px;
      padding: 16px 18px;
      border-radius: 20px;
      white-space: pre-wrap;
      line-height: 1.48;
      animation: rise 240ms ease-out both;
    }

    .message.user {
      margin-left: auto;
      background: #2f5f73;
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
      padding: 18px;
      border-top: 1px solid var(--line);
      background: rgba(255, 248, 234, 0.8);
    }

    textarea {
      width: 100%;
      min-height: 56px;
      max-height: 160px;
      resize: vertical;
      border: 1px solid rgba(32, 24, 15, 0.18);
      border-radius: 18px;
      padding: 14px 16px;
      background: #fffaf0;
      color: var(--ink);
      outline: none;
      font: 15px/1.4 "Trebuchet MS", sans-serif;
    }

    button {
      border: 0;
      border-radius: 18px;
      padding: 0 22px;
      color: #fffaf0;
      background: linear-gradient(135deg, var(--clay), #8f422b);
      font: 800 14px/1 "Trebuchet MS", sans-serif;
      letter-spacing: 0.04em;
      cursor: pointer;
      box-shadow: 0 14px 30px rgba(184, 92, 56, 0.25);
    }

    button:disabled {
      cursor: wait;
      filter: grayscale(0.35);
      opacity: 0.72;
    }

    .button-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 12px;
    }

    .small-button {
      min-height: 36px;
      border-radius: 12px;
      padding: 0 10px;
      font-size: 11px;
      box-shadow: none;
    }

    .small-button.secondary {
      color: var(--ink);
      background: rgba(66, 107, 79, 0.14);
      border: 1px solid var(--line);
    }

    .side {
      display: grid;
      grid-template-rows: auto auto minmax(140px, 1fr) minmax(180px, 1.1fr);
      gap: 12px;
      padding: 14px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 16px;
      background: rgba(255,250,240,0.78);
    }

    .card h2 {
      margin: 0 0 12px;
      font-size: 18px;
      letter-spacing: -0.02em;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .stat {
      border-radius: 16px;
      padding: 12px;
      background: rgba(66, 107, 79, 0.10);
    }

    .stat strong {
      display: block;
      font-size: 24px;
      line-height: 1;
    }

    .stat span {
      color: var(--muted);
      font: 700 11px/1 "Trebuchet MS", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .list {
      display: grid;
      gap: 10px;
      overflow: auto;
      max-height: 100%;
      padding-right: 4px;
    }

    .context-list {
      overflow: auto;
      max-height: 100%;
      padding-right: 4px;
    }

    .memory {
      border-left: 4px solid var(--gold);
      border-radius: 14px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.45);
      font-size: 13px;
      line-height: 1.35;
    }

    .memory small {
      display: block;
      margin-bottom: 5px;
      color: var(--blue);
      font: 800 11px/1 "Trebuchet MS", sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
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
      max-height: 240px;
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

    @media (max-width: 900px) {
      body { overflow: auto; }
      .shell {
        grid-template-columns: 1fr;
        height: auto;
        min-height: 100vh;
      }
      .main { min-height: 72vh; }
      .message { max-width: 96%; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel main">
      <header class="header">
        <p class="eyebrow">Pianpian</p>
        <h1>翩翩醒着。</h1>
        <p class="subtitle">少一点日志，多一点真正有用的回应。</p>
        <div class="route-row">
          <span class="pill"><span class="dot"></span><span id="route">route: idle</span></span>
          <span class="pill" id="agents">agents: none</span>
        </div>
      </header>
      <main class="conversation" id="conversation">
        <div class="message agent">我在。</div>
      </main>
      <form class="composer" id="form">
        <textarea id="input" placeholder="Talk to Pianpian..." autofocus></textarea>
        <button id="send" type="submit">Send</button>
      </form>
    </section>

    <aside class="panel side">
      <section class="card">
        <h2>记忆</h2>
        <div class="stats">
          <div class="stat"><strong id="stat-total">0</strong><span>Total</span></div>
          <div class="stat"><strong id="stat-active">0</strong><span>Active</span></div>
          <div class="stat"><strong id="stat-archived">0</strong><span>Archived</span></div>
          <div class="stat"><strong id="stat-pinned">0</strong><span>Pinned</span></div>
        </div>
      </section>
      <section class="card">
        <h2>自主</h2>
        <div id="autonomy" class="list"><div class="memory"><small>booting</small>Waiting for heartbeat state.</div></div>
        <div class="button-row">
          <button class="small-button secondary" id="autonomy-start" type="button">开始</button>
          <button class="small-button secondary" id="autonomy-stop" type="button">暂停</button>
          <button class="small-button" id="autonomy-now" type="button">想一下</button>
        </div>
      </section>
      <section class="card">
        <h2>最近记忆</h2>
        <div id="memories" class="list"></div>
      </section>
      <section class="card">
        <h2>本轮状态</h2>
        <div id="context" class="context-list">
          <div id="tools" class="list"><div class="memory"><small>idle</small>本轮没有工具输出。</div></div>
          <div class="memory"><small>context</small>还没有本轮上下文。</div>
        </div>
      </section>
    </aside>
  </div>

  <script>
    const conversation = document.querySelector("#conversation");
    const form = document.querySelector("#form");
    const input = document.querySelector("#input");
    const send = document.querySelector("#send");
    const route = document.querySelector("#route");
    const agents = document.querySelector("#agents");
    const tools = document.querySelector("#tools");
    const memories = document.querySelector("#memories");
    const contextPanel = document.querySelector("#context");
    const autonomyPanel = document.querySelector("#autonomy");
    const autonomyStart = document.querySelector("#autonomy-start");
    const autonomyStop = document.querySelector("#autonomy-stop");
    const autonomyNow = document.querySelector("#autonomy-now");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      appendMessage("user", text);
      input.value = "";
      send.disabled = true;
      try {
        const result = await window.pianpian.step(text);
        const timing = typeof result.durationMs === "number" ? " · " + (result.durationMs / 1000).toFixed(1) + "s" : "";
        route.textContent = "route: " + result.route.mode + " (" + result.route.confidence.toFixed(2) + ")" + timing;
        const background = Array.isArray(result.backgroundJobs) && result.backgroundJobs.length > 0
          ? " · bg: " + result.backgroundJobs.map((job) => job.agentId).join(", ")
          : "";
        agents.textContent = "agents: " + compactAgents(result.route.selectedAgentIds) + background;
        const replies = result.replies.filter(shouldShowReply);
        if (replies.length > 0) {
          for (const reply of replies) appendMessage("agent", reply);
        } else if (result.tools && result.tools.length > 0) {
          appendMessage("agent", summarizeToolsForChat(result.tools));
        }
        renderTools(result.tools);
        renderStats(result.stats);
        renderMemories(result.memories);
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
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        form.requestSubmit();
      }
    });

    autonomyStart.addEventListener("click", async () => {
      renderAutonomy(await window.pianpian.startAutonomy());
    });

    autonomyStop.addEventListener("click", async () => {
      renderAutonomy(await window.pianpian.stopAutonomy());
    });

    autonomyNow.addEventListener("click", async () => {
      autonomyNow.disabled = true;
      try {
        const state = await window.pianpian.heartbeat();
        renderAutonomy(state);
        if (state.lastHeartbeat && state.lastHeartbeat.cycle) {
          renderStats(state.lastHeartbeat.cycle.stats);
          renderMemories(state.lastHeartbeat.cycle.memories);
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
      for (const item of items.slice(0, 4)) {
        const node = memoryNode(item.toolName + " - " + item.status, compactToolOutput(item));
        tools.appendChild(node);
      }
    }

    function renderMemories(items) {
      memories.innerHTML = "";
      if (!items.length) {
        memories.appendChild(memoryNode("empty", "\u8fd8\u6ca1\u6709\u8bb0\u5fc6\u3002"));
        return;
      }
      for (const item of items.slice(0, 8)) {
        memories.appendChild(memoryNode(item.kind + " - " + item.status, item.text));
      }
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
          ? cycle.replies.join("\\n")
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
        ["任务", context.currentTask],
        ["工作记忆", context.workingMemory],
        ["身份/关系", [context.selfModel, context.relevantEntities].filter(Boolean).join("\\n")],
        ["焦点记忆", context.focus],
        ["更多上下文", [
          "Goals:\\n" + context.goals,
          "Preferences:\\n" + context.preferences,
          "Long-term:\\n" + context.longTermMemory,
          "Evidence:\\n" + context.recentEvidence,
          "Trace:\\n" + formatJson(context.trace),
        ].join("\\n\\n")],
      ];

      for (const [label, text] of sections) {
        contextPanel.appendChild(detailNode(label, text || "None."));
      }
    }

    function detailNode(label, text) {
      const node = document.createElement("details");
      if (label === "任务" || label === "身份/关系" || label === "焦点记忆") {
        node.open = true;
      }
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

    function memoryNode(label, text) {
      const node = document.createElement("div");
      node.className = "memory";
      const small = document.createElement("small");
      small.textContent = label;
      const body = document.createElement("div");
      body.textContent = text.length > 520 ? text.slice(0, 517) + "..." : text;
      node.appendChild(small);
      node.appendChild(body);
      return node;
    }

    function shouldShowReply(reply) {
      const text = String(reply || "").trim();
      if (!text) return false;
      return ![
        "当前意图模式",
        "我已经从长期记忆里做了一次上下文召回",
        "暂时没有足够的焦点记忆",
        "Current intent mode",
        "I recalled long-term memory",
      ].some((marker) => text.includes(marker));
    }

    function compactAgents(agentIds) {
      const visible = (agentIds || []).filter((agent) => !["memory-curator", "tool-reflector", "learning-evaluator"].includes(agent));
      return visible.slice(0, 4).join(", ") + (visible.length > 4 ? " +" + (visible.length - 4) : "");
    }

    function summarizeToolsForChat(items) {
      const failed = items.filter((item) => item.status !== "executed");
      if (failed.length > 0) {
        return "工具有失败：" + failed.map((item) => item.toolName).join(", ") + "。我已经把结果记下来了。";
      }
      return "检查完成：" + items.map((item) => item.toolName).join(", ") + "。";
    }

    function compactToolOutput(item) {
      if (item.error) return item.error;
      const text = String(item.output || "");
      if (item.status === "executed" && item.toolName === "workspace.search") {
        const lines = text.split("\\n").filter(Boolean);
        return lines.length + " 条匹配。" + (lines.length ? "\\n" + lines.slice(0, 3).join("\\n") : "");
      }
      return text;
    }

    refresh();
    setInterval(refresh, 15000);
  </script>
</body>
</html>`;
}
