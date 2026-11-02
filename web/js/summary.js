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
  const { body } = VA.section("summary");
  const clips = VA.state.clips || [];

  if (!clips.length) {
    body.innerHTML = `<p class="empty-note">No summary clips available.</p>`;
    return;
  }

  const total = clips.reduce(
    (sum, clip) => sum + Number(clip.t1 - clip.t0 || 0),
    0
  );

  const duration = VA.duration();

  body.innerHTML = `
    <div class="metrics">
      <div class="metric">
        <div class="n">${clips.length}</div>
        <div class="l">Selected clips</div>
        <div class="s">Included in the generated summary</div>
      </div>

      <div class="metric">
        <div class="n">${total.toFixed(1)}s</div>
        <div class="l">Summary duration</div>
        <div class="s">Combined clip duration</div>
      </div>

      <div class="metric">
        <div class="n">${duration > 0 ? (100 * total / duration).toFixed(1) : "–"}%</div>
        <div class="l">Original video retained</div>
        <div class="s">Based on selected clip durations</div>
      </div>
    </div>

    <article class="analysis-card">
      <div class="card-heading">
        <h3>Generated summary</h3>
        <span class="mono">${total.toFixed(1)} seconds</span>
      </div>

      <video
        class="summary-video"
        controls
        preload="metadata"
        playsinline
        src="${VA.base}/summaries/summary.mp4"
      ></video>

      <p class="muted-copy">
        This video is assembled from the selected source intervals.
        Its timestamps refer to the original video.
      </p>
    </article>

    <article class="analysis-card">
      <div class="card-heading">
        <h3>Clip selection</h3>
      </div>

      <img
        class="analysis-image"
        src="${VA.base}/summaries/summary_selection.png"
        alt="Summary clip selection graph"
        loading="lazy"
      >
    </article>

    <article class="analysis-card table-card">
      <div class="card-heading">
        <h3>Selected clips</h3>
        <span class="mono">${clips.length} clips</span>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Scene</th>
              <th>Start</th>
              <th>End</th>
              <th>Duration</th>
              <th>Motion</th>
              <th>Objects</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            ${clips.map((clip) => `
              <tr class="clickable-row" data-seek="${Number(clip.t0) || 0}">
                <td>#${esc(clip.scene_id)}</td>
                <td>${esc(clip.start || time(clip.t0))}</td>
                <td>${esc(clip.end || time(clip.t1))}</td>
                <td>${(Number(clip.t1) - Number(clip.t0)).toFixed(2)} s</td>
                <td>${Number(clip.motion || 0).toFixed(2)}</td>
                <td>${Number(clip.objects || 0).toFixed(3)}</td>
                <td>${Number(clip.score || 0).toFixed(3)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <p class="muted-copy">
        Click a clip to jump to its starting position in the original video.
      </p>
    </article>
  `;

  body.querySelectorAll("[data-seek]").forEach((row) => {
    row.addEventListener("click", () => {
      VA.seek(Number(row.dataset.seek), true);
      document.getElementById("stage").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  });
}