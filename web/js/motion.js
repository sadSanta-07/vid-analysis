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
  const { body } = VA.section("motion");
  const rows = VA.state.motion || [];

  if (!rows.length) {
    body.innerHTML = `<p class="empty-note">No motion data available.</p>`;
    return;
  }

  const peak = rows.reduce(
    (best, row) =>
      Number(row.object_motion) > Number(best.object_motion) ? row : best,
    rows[0]
  );

  const meanObject =
    rows.reduce((sum, row) => sum + Number(row.object_motion || 0), 0)
    / rows.length;

  const meanCamera =
    rows.reduce((sum, row) => sum + Number(row.camera_motion || 0), 0)
    / rows.length;

  const meanMoving =
    rows.reduce((sum, row) => sum + Number(row.moving_pct || 0), 0)
    / rows.length;

  body.innerHTML = `
    <div class="metrics motion-metrics">
      <div class="metric">
        <div class="n">${meanObject.toFixed(1)}</div>
        <div class="l">Mean object motion</div>
        <div class="s">Pixels per second</div>
      </div>
      <div class="metric">
        <div class="n">${meanCamera.toFixed(1)}</div>
        <div class="l">Mean camera motion</div>
        <div class="s">Pixels per second</div>
      </div>
      <div class="metric">
        <div class="n">${Number(peak.object_motion).toFixed(1)}</div>
        <div class="l">Peak object motion</div>
        <div class="s">
          At <a href="#" id="peak-motion-jump">${time(peak.time_sec)}</a>
        </div>
      </div>
      <div class="metric">
        <div class="n">${meanMoving.toFixed(1)}%</div>
        <div class="l">Average moving area</div>
        <div class="s">Pixels above the motion threshold</div>
      </div>
    </div>

    <div class="analysis-grid">
      <article class="analysis-card">
        <div class="card-heading">
          <h3>Motion intensity over time</h3>
        </div>
        <img
          class="analysis-image"
          src="${VA.base}/motion/motion_timeline.png"
          alt="Motion intensity timeline"
          loading="lazy"
        >
      </article>

      <article class="analysis-card">
        <div class="card-heading">
          <h3>Motion heatmap</h3>
        </div>
        <img
          class="analysis-image"
          src="${VA.base}/motion/motion_heatmap.png"
          alt="Motion heatmap"
          loading="lazy"
        >
      </article>
    </div>

    <article class="analysis-card">
      <div class="card-heading">
        <h3>Peak optical flow</h3>
        <span class="mono">${time(peak.time_sec)}</span>
      </div>
      <img
        class="analysis-image"
        src="${VA.base}/motion/peak_flow.png"
        alt="Frame and optical flow at peak object motion"
        loading="lazy"
      >
      <p class="muted-copy">
        The motion analysis subtracts estimated camera movement from optical
        flow to estimate object movement.
      </p>
    </article>

    <article class="analysis-card table-card">
      <div class="card-heading">
        <h3>Highest motion samples</h3>
        <span class="mono">Top 15 samples</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Object motion</th>
              <th>Camera motion</th>
              <th>Moving area</th>
            </tr>
          </thead>
          <tbody>
            ${[...rows]
              .sort((a, b) => Number(b.object_motion) - Number(a.object_motion))
              .slice(0, 15)
              .map((r) => `
                <tr class="clickable-row" data-seek="${Number(r.time_sec) || 0}">
                  <td>${time(r.time_sec)}</td>
                  <td>${Number(r.object_motion || 0).toFixed(2)} px/s</td>
                  <td>${Number(r.camera_motion || 0).toFixed(2)} px/s</td>
                  <td>${Number(r.moving_pct || 0).toFixed(2)}%</td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;

  body.querySelector("#peak-motion-jump").addEventListener("click", (e) => {
    e.preventDefault();
    VA.seek(Number(peak.time_sec), true);
  });

  body.querySelectorAll("[data-seek]").forEach((row) => {
    row.addEventListener("click", () => {
      VA.seek(Number(row.dataset.seek), true);
    });
  });
}