// Shared state, data loading and the boot sequence.
// Feature modules (timeline, overview, scenes, ...) are loaded one by one;
// a module whose file does not exist yet is skipped silently.

const $ = (s, r = document) => r.querySelector(s);

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows
    .filter((r) => r.length === head.length)
    .map((r) => {
      const o = {};
      head.forEach((h, i) => {
        const v = r[i];
        o[h] = v !== "" && !isNaN(v) ? Number(v) : v;
      });
      return o;
    });
}

async function getCSV(url) {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    return r.ok ? parseCSV(await r.text()) : null;
  } catch {
    return null;
  }
}

const exists = (url) => fetch(url, { method: "HEAD" }).then((r) => r.ok).catch(() => false);

export function fmtTime(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

const listeners = { time: new Set(), meta: new Set() };

export const VA = {
  state: {},
  base: "",
  video: null,
  videoName: null,
  fmt: { time: fmtTime },
  csv: getCSV,
  exists,
  on(ev, fn) { listeners[ev].add(fn); },
  emit(ev, ...args) { listeners[ev].forEach((fn) => fn(...args)); },
  time() { return this.video ? this.video.currentTime : 0; },
  duration() {
    const v = this.video;
    if (v && isFinite(v.duration) && v.duration > 0) return v.duration;
    const s = this.state.scenes;
    return s && s.length ? s[s.length - 1].end_sec : 0;
  },
  seek(t, play = false) {
    const v = this.video;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, t), this.duration() || t);
    this.emit("time", v.currentTime);
    if (play) v.play();
  },
  section(id) {
    const root = document.getElementById(id);
    root.hidden = false;
    return { root, body: root.querySelector(".sec-body") };
  },
};
if (typeof window !== "undefined") window.VA = VA;

function fatal(html) {
  $("main").innerHTML = `<div class="notice">${html}</div>`;
}

function setupVideo(api, res) {
  const v = $("#video");
  VA.video = v;
  VA.videoName = res.source && api.videos.includes(res.source) ? res.source : api.videos[0] || null;
  const urls = {
    original: VA.videoName ? `/data/uploads/${encodeURIComponent(VA.videoName)}` : null,
    tracked: `${VA.base}/tracking/tracked_h264.mp4`,
  };
  const seg = $("#source-seg");

  function use(kind) {
    if (!urls[kind]) return;
    const t = v.currentTime || 0, wasPlaying = !v.paused;
    v.src = urls[kind];
    v.addEventListener("loadedmetadata", () => {
      v.currentTime = Math.min(t, v.duration || t);
      if (wasPlaying) v.play();
    }, { once: true });
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.src === kind));
  }
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b && !b.disabled) use(b.dataset.src);
  });

  const trackedBtn = seg.querySelector('[data-src="tracked"]');
  exists(urls.tracked).then((ok) => {
    trackedBtn.disabled = !ok;
    if (!ok) trackedBtn.title = "Run:  python -m tools.prep_web";
  });

  let raf = 0;
  const loop = () => {
    VA.emit("time", v.currentTime);
    raf = v.paused ? 0 : requestAnimationFrame(loop);
  };
  v.addEventListener("play", () => { if (!raf) raf = requestAnimationFrame(loop); });
  ["seeking", "seeked", "timeupdate", "pause", "loadedmetadata"].forEach((ev) =>
    v.addEventListener(ev, () => VA.emit("time", v.currentTime)));
  v.addEventListener("loadedmetadata", () => {
    $("#player-meta").textContent = `${VA.videoName || ""}  ·  ${v.videoWidth}×${v.videoHeight}`;
    VA.emit("meta");
  });
  use("original");
}

async function load(api, res) {
  const base = `/${res.name}`;
  const [scenes, kfs, motion, tsum, uniq, clips] = await Promise.all([
    getCSV(`${base}/scenes/scenes.csv`),
    getCSV(`${base}/keyframes/keyframes.csv`),
    getCSV(`${base}/motion/motion_series.csv`),
    getCSV(`${base}/tracking/track_summary.csv`),
    getCSV(`${base}/tracking/unique_objects.csv`),
    getCSV(`${base}/summaries/summary_clips.csv`),
  ]);
  VA.base = base;
  VA.state = { name: res.name, scenes, kfs, motion, tsum, uniq, clips, tracks: null };
  let pending = null;   // tracks.csv can be large, so it is loaded on demand
  VA.loadTracks = () => (pending ??= getCSV(`${base}/tracking/tracks.csv`).then((t) => (VA.state.tracks = t)));
  setupVideo(api, res);
}

function buildNav() {
  const secs = [...document.querySelectorAll("section.block:not([hidden])")].filter((s) => s.querySelector("h2"));
  const nav = $("#nav");
  nav.innerHTML = secs.map((s) => `<a href="#${s.id}">${s.querySelector("h2").textContent}</a>`).join("");
  const links = new Map([...nav.querySelectorAll("a")].map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.remove("on"));
      links.get(e.target.id)?.classList.add("on");
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  secs.forEach((s) => io.observe(s));
}

const MODULES = ["timeline", "overview", "scenes", "keyframes", "motion", "tracking", "summary"];

async function boot() {
  let api;
  try {
    api = await (await fetch("/api/results")).json();
  } catch {
    return fatal("Could not reach the local server. Start it from the project folder with <code>python serve.py</code> and open <code>http://localhost:8000</code>.");
  }
  if (!api.results.length) {
    $("#stage").hidden = true;
    $("#empty-state").hidden = false;
    $("#foot-meta").textContent = "No analysis results yet";
    return;
  }

  $("#stage").hidden = false;
  $("#empty-state").hidden = true;

  const wanted = new URLSearchParams(location.search).get("r") || localStorage.getItem("va.results");
  const pick = api.results.find((r) => r.name === wanted)
    || api.results.find((r) => r.name === "outputs_30min")
    || api.results[0];

  const sel = $("#results-select");
  sel.innerHTML = api.results
    .map((r) => `<option value="${r.name}">${r.name}${r.source ? " · " + r.source : ""}</option>`).join("");
  sel.value = pick.name;
  sel.addEventListener("change", () => {
    localStorage.setItem("va.results", sel.value);
    location.search = "?r=" + sel.value;
  });

  await load(api, pick);

  for (const name of MODULES) {
    let mod;
    try {
      mod = await import(`./${name}.js`);
    } catch (e) {
      if (!(e instanceof TypeError)) console.error(`[${name}]`, e);   // TypeError = file not there yet
      continue;
    }
    try {
      await mod.default(VA);
    } catch (e) {
      console.error(`[${name}]`, e);
    }
  }

  buildNav();
  $("#foot-meta").textContent = `Results: ${pick.name}  ·  Video: ${VA.videoName || "n/a"}`;
}

if (typeof document !== "undefined") boot();