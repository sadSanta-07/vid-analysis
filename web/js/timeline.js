// The linked timeline: scenes, motion, tracked objects and summary clips on one time axis,
// synchronised with the video (click or drag to seek).

const LANES = [
  { id: "scenes", label: "Scenes", h: 34 },
  { id: "motion", label: "Motion", h: 72 },
  { id: "objects", label: "Objects", h: 48 },
  { id: "summary", label: "Summary", h: 20 },
];
const GAP = 8;
const TOTAL_H = LANES.reduce((s, l) => s + l.h, 0) + GAP * (LANES.length - 1);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Largest value per pixel column, then a short moving average over the non-empty columns.
export function series(rows, tKey, vKey, W, dur) {
  const mx = new Float32Array(W), has = new Uint8Array(W);
  for (const r of rows) {
    const i = Math.min(W - 1, Math.max(0, Math.floor((r[tKey] / dur) * W)));
    const v = r[vKey];
    if (!has[i] || v > mx[i]) { mx[i] = v; has[i] = 1; }
  }
  const k = Math.max(1, Math.round((W / dur) * 0.4));
  const out = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(W - 1, i + k); j++) if (has[j]) { s += mx[j]; n++; }
    out[i] = n ? s / n : 0;
  }
  return out;
}

function nearest(rows, t) {
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].time_sec < t) lo = mid + 1; else hi = mid;
  }
  const a = rows[lo], b = rows[Math.max(0, lo - 1)];
  return Math.abs(a.time_sec - t) < Math.abs(b.time_sec - t) ? a : b;
}

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function mount(VA) {
  const host = document.getElementById("timeline");
  const { scenes, motion, clips } = VA.state;
  if (!scenes || !scenes.length) return;

  host.innerHTML = `
    <div class="tl">
      <div class="tl-labels">${LANES.map((l) => `<div style="height:${l.h}px">${l.label}</div>`).join("")}</div>
      <div class="tl-plot" style="height:${TOTAL_H}px">
        <canvas class="tl-base"></canvas><canvas class="tl-top"></canvas><div class="tl-tip" hidden></div>
      </div>
    </div>
    <div class="tl-axis"></div>`;
  const plot = host.querySelector(".tl-plot");
  const base = host.querySelector(".tl-base");
  const overlay = host.querySelector(".tl-top");
  const tip = host.querySelector(".tl-tip");
  const axis = host.querySelector(".tl-axis");

  const C = {
    clay: css("--clay"), sky: css("--sky"), ink: css("--ink"), muted: css("--muted"),
    lane: css("--paper"), oat1: css("--oat"), oat2: css("--oat-deep"), mono: css("--mono"),
  };
  let W = 0, dpr = 1, objects;            // objects: undefined = loading, null = no data
  let hoverT = null, dragging = false;

  const dur = () => VA.duration() || 1;
  const X = (t) => (t / dur()) * W;
  const T = (px) => Math.min(dur(), Math.max(0, (px / W) * dur()));
  const sceneAt = (t) => scenes.find((s) => t >= s.start_sec && t < s.end_sec) || scenes[scenes.length - 1];

  function note(g, y, h, text) {
    g.fillStyle = C.muted;
    g.font = `400 11px ${C.mono}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, 10, y + h / 2);
  }

  function laneScenes(g, y, h) {
    scenes.forEach((s, i) => {
      const x0 = X(s.start_sec), x1 = X(s.end_sec);
      g.fillStyle = i % 2 ? C.oat2 : C.oat1;
      g.fillRect(x0, y, x1 - x0, h);
      if (x1 - x0 > 20) {
        g.fillStyle = C.muted;
        g.font = `500 11px ${C.mono}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(s.scene_id), (x0 + x1) / 2, y + h / 2 + 0.5);
      }
    });
    g.fillStyle = "#fff";
    scenes.slice(1).forEach((s) => g.fillRect(X(s.start_sec) - 0.75, y, 1.5, h));
  }

  function laneMotion(g, y, h) {
    if (!motion || !motion.length) return note(g, y, h, "no motion data");
    const d = dur();
    const obj = series(motion, "time_sec", "object_motion", W, d);
    const cam = series(motion, "time_sec", "camera_motion", W, d);
    const sorted = motion.map((r) => r.object_motion).sort((a, b) => a - b);
    const ymax = (sorted[Math.floor(sorted.length * 0.97)] || 1) * 1.1 || 1;
    const trace = (arr) => {
      g.beginPath();
      for (let i = 0; i < W; i++) {
        const yy = y + h - Math.min(1, arr[i] / ymax) * (h - 4) - 1;
        if (i) g.lineTo(i + 0.5, yy); else g.moveTo(i + 0.5, yy);
      }
    };
    trace(cam);
    g.strokeStyle = C.muted; g.globalAlpha = 0.55; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
    trace(obj);
    g.strokeStyle = C.clay; g.lineWidth = 1.6; g.stroke();
    g.lineTo(W, y + h); g.lineTo(0, y + h); g.closePath();
    g.globalAlpha = 0.18; g.fillStyle = C.clay; g.fill(); g.globalAlpha = 1;
  }

  function laneObjects(g, y, h) {
    if (objects === undefined) return note(g, y, h, "loading tracking data…");
    if (!objects || !objects.length) return note(g, y, h, "no tracking data");
    const arr = series(objects, "t", "v", W, dur());
    const mx = Math.max(...arr, 1);
    g.beginPath();
    g.moveTo(0, y + h);
    for (let i = 0; i < W; i++) g.lineTo(i + 0.5, y + h - (arr[i] / mx) * (h - 4));
    g.lineTo(W, y + h);
    g.closePath();
    g.globalAlpha = 0.55; g.fillStyle = C.sky; g.fill(); g.globalAlpha = 1;
    g.fillStyle = C.muted; g.font = `400 10px ${C.mono}`; g.textAlign = "left"; g.textBaseline = "top";
    g.fillText(`up to ${Math.round(mx)} in frame`, 8, y + 4);
  }

  function laneSummary(g, y, h) {
    if (!clips || !clips.length) return note(g, y, h, "no summary data");
    g.fillStyle = C.clay;
    clips.forEach((c) => {
      const x0 = X(c.t0);
      rr(g, x0, y + 3, Math.max(2, X(c.t1) - x0), h - 6, 3);
      g.fill();
    });
  }

  const drawLane = { scenes: laneScenes, motion: laneMotion, objects: laneObjects, summary: laneSummary };

  function drawAxis() {
    const d = dur();
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
    const step = steps.find((s) => (s / d) * W >= 90) || steps[steps.length - 1];
    let html = "";
    for (let t = 0; t <= d + 1e-6; t += step) html += `<span style="left:${(t / d) * 100}%">${mmss(t)}</span>`;
    axis.innerHTML = html;
  }

  function drawTop() {
    const g = overlay.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, TOTAL_H);
    const t = VA.time();
    const s = sceneAt(t);
    g.strokeStyle = C.clay; g.lineWidth = 2;
    rr(g, X(s.start_sec) + 1, 1, Math.max(4, X(s.end_sec) - X(s.start_sec) - 2), LANES[0].h - 2, 7);
    g.stroke();
    if (hoverT != null) {
      g.strokeStyle = C.ink; g.globalAlpha = 0.35; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(X(hoverT), 0); g.lineTo(X(hoverT), TOTAL_H); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
    }
    const px = X(t);
    g.strokeStyle = C.clay; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, TOTAL_H); g.stroke();
    g.fillStyle = C.clay;
    g.beginPath(); g.arc(px, 0, 4.5, 0, Math.PI * 2); g.fill();
  }

  function drawBase() {
    W = Math.max(100, Math.floor(plot.clientWidth));
    dpr = window.devicePixelRatio || 1;
    for (const c of [base, overlay]) {
      c.width = W * dpr; c.height = TOTAL_H * dpr;
      c.style.width = `${W}px`; c.style.height = `${TOTAL_H}px`;
    }
    const g = base.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, TOTAL_H);
    let y = 0;
    for (const l of LANES) {
      g.save();
      rr(g, 0, y, W, l.h, 8);
      g.clip();
      g.fillStyle = C.lane;
      g.fillRect(0, y, W, l.h);
      drawLane[l.id](g, y, l.h);
      g.restore();
      y += l.h + GAP;
    }
    drawAxis();
    drawTop();
  }

  function showTip(e) {
    const t = hoverT, s = sceneAt(t);
    const m = motion && motion.length ? nearest(motion, t) : null;
    const inSummary = clips && clips.some((c) => t >= c.t0 && t <= c.t1);
    tip.innerHTML = `${VA.fmt.time(t)} · scene ${s.scene_id}`
      + (m ? `<br>motion ${m.object_motion.toFixed(1)} px/s` : "")
      + (inSummary ? `<br><span style="color:${C.clay}">in the summary</span>` : "");
    tip.hidden = false;
    const r = plot.getBoundingClientRect();
    let left = e.clientX - r.left + 14;
    if (left + tip.offsetWidth > r.width) left = e.clientX - r.left - tip.offsetWidth - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${e.clientY - r.top + 14}px`;
  }

  const posT = (e) => T(e.clientX - plot.getBoundingClientRect().left);
  plot.addEventListener("pointerdown", (e) => {
    dragging = true;
    plot.setPointerCapture(e.pointerId);
    VA.seek(posT(e));
  });
  plot.addEventListener("pointermove", (e) => {
    hoverT = posT(e);
    if (dragging) VA.seek(hoverT);
    showTip(e);
    drawTop();
  });
  plot.addEventListener("pointerup", () => { dragging = false; });
  plot.addEventListener("pointerleave", () => { hoverT = null; tip.hidden = true; drawTop(); });

  VA.on("time", drawTop);
  VA.on("meta", drawBase);
  new ResizeObserver(drawBase).observe(plot);
  if (document.fonts) document.fonts.ready.then(drawBase);
  drawBase();

  VA.loadTracks().then((rows) => {
    if (rows) {
      const perFrame = new Map();
      for (const r of rows) {
        const e = perFrame.get(r.frame);
        if (e) e.v++; else perFrame.set(r.frame, { t: r.time_sec, v: 1 });
      }
      objects = [...perFrame.values()];
    } else {
      objects = null;
    }
    drawBase();
  }).catch(() => { objects = null; drawBase(); });
}