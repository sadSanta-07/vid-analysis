// "At a glance": headline numbers computed from the result files.

export default function mount(VA) {
  const { root } = VA.section("overview");
  const el = root.querySelector("#metrics");
  const { scenes, kfs, motion, tsum, uniq, clips } = VA.state;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function items() {
    const dur = VA.duration();
    const v = VA.video;
    const peak = motion && motion.length
      ? motion.reduce((a, r) => (r.object_motion > a.object_motion ? r : a)) : null;
    const total = clips ? clips.reduce((s, c) => s + (c.t1 - c.t0), 0) : null;
    const nObjects = uniq ? uniq.length : tsum ? tsum.length : null;
    const longest = scenes && scenes.length
      ? scenes.reduce((a, s) => (s.duration_sec > a.duration_sec ? s : a)) : null;
    return [
      { l: "Duration", v: VA.fmt.time(dur), s: v && v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : "" },
      { l: "Scenes", v: scenes ? scenes.length : "–", s: longest ? `longest ${longest.duration_sec.toFixed(1)} s` : "" },
      { l: "Key frames", v: kfs ? kfs.length : "–", s: kfs ? `across ${new Set(kfs.map((k) => k.scene_id)).size} scenes` : "" },
      {
        l: "Peak motion", v: peak ? Math.round(peak.object_motion) : "–",
        s: peak ? `px/s · <a href="#" data-seek="${peak.time_sec}">jump to ${VA.fmt.time(peak.time_sec)}</a>` : "",
      },
      {
        l: uniq ? "Unique objects" : "Tracked objects", v: nObjects ?? "–",
        s: uniq && tsum ? `from ${tsum.length} raw track IDs` : "track IDs, not individuals",
      },
      { l: "Summary", v: total != null ? total.toFixed(1) : "–", s: total != null && dur ? `seconds · ${Math.round((100 * total) / dur)}% of the video` : "" },
    ];
  }

  function render(animate) {
    el.innerHTML = items().map((c) => {
      const num = typeof c.v === "number" || (c.l === "Summary" && c.v !== "–");
      return `<div class="metric"><div class="n" ${num ? `data-to="${c.v}"` : ""}>${c.v}</div>`
        + `<div class="l">${c.l}</div><div class="s">${c.s || ""}</div></div>`;
    }).join("");
    el.querySelectorAll("[data-to]").forEach((n) => {
      const to = parseFloat(n.dataset.to);
      const dec = String(n.dataset.to).includes(".") ? 1 : 0;
      if (!animate || reduce) return;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 900);
        n.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dec);
        if (p < 1) requestAnimationFrame(step);
      };
      n.textContent = (0).toFixed(dec);
      requestAnimationFrame(step);
    });
  }

  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-seek]");
    if (!a) return;
    e.preventDefault();
    VA.seek(parseFloat(a.dataset.seek), true);
    document.getElementById("stage").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  render(true);
  VA.on("meta", () => render(false));
}