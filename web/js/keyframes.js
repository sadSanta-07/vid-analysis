const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const time = (v) => {
  const s = Math.max(0, Number(v) || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
};

export default function mount(VA) {
  const { body } = VA.section("keyframes");
  const frames = VA.state.kfs || [];

  if (!frames.length) {
    body.innerHTML = `<p class="empty-note">No keyframes available.</p>`;
    return;
  }

  body.innerHTML = `
    <div class="analysis-grid">
      <article class="analysis-card">
        <div class="card-heading">
          <h3>Keyframe contact sheet</h3>
          <span class="mono">${frames.length} selected frames</span>
        </div>
        <img
          class="analysis-image"
          src="${VA.base}/keyframes/contact_sheet.jpg"
          alt="Keyframe contact sheet"
          loading="lazy"
        >
      </article>

      <article class="analysis-card">
        <div class="card-heading">
          <h3>Selection overview</h3>
        </div>
        <div class="stat-list">
          <div>
            <span>Selected frames</span>
            <strong>${frames.length}</strong>
          </div>
          <div>
            <span>Scenes represented</span>
            <strong>${new Set(frames.map((f) => f.scene_id)).size}</strong>
          </div>
          <div>
            <span>Average sharpness</span>
            <strong>${(
              frames.reduce((sum, f) => sum + Number(f.sharpness || 0), 0)
              / frames.length
            ).toFixed(1)}</strong>
          </div>
          <div>
            <span>Average selection score</span>
            <strong>${(
              frames.reduce((sum, f) => sum + Number(f.score || 0), 0)
              / frames.length
            ).toFixed(3)}</strong>
          </div>
        </div>
      </article>
    </div>

    <div class="card-heading gallery-heading">
      <h3>Individual keyframes</h3>
      <span class="mono">Select a frame to seek the video</span>
    </div>

    <div class="keyframe-gallery">
      ${frames.map((f) => `
        <button
          class="keyframe-card"
          type="button"
          data-seek="${Number(f.time_sec) || 0}"
        >
          <img
            src="${VA.base}/keyframes/${encodeURIComponent(f.file)}"
            alt="Scene ${esc(f.scene_id)} keyframe"
            loading="lazy"
          >
          <span class="keyframe-caption">
            <strong>Scene ${esc(f.scene_id)} · #${esc(f.keyframe)}</strong>
            <span>${time(f.time_sec)}</span>
          </span>
          <span class="keyframe-meta">
            Sharpness ${Number(f.sharpness || 0).toFixed(1)}
            · Score ${Number(f.score || 0).toFixed(3)}
          </span>
        </button>
      `).join("")}
    </div>
  `;

  body.querySelectorAll("[data-seek]").forEach((card) => {
    card.addEventListener("click", () => {
      VA.seek(Number(card.dataset.seek), true);
      document.getElementById("stage").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  });
}