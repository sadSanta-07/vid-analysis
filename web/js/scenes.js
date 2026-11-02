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
  const { body } = VA.section("scenes");
  const scenes = VA.state.scenes || [];

  if (!scenes.length) {
    body.innerHTML = `<p class="empty-note">No scene data available.</p>`;
    return;
  }

  body.innerHTML = `
    <div class="analysis-grid">
      <article class="analysis-card">
        <div class="card-heading">
          <h3>Scene timeline</h3>
          <span class="mono">${scenes.length} scenes</span>
        </div>
        <img
          class="analysis-image"
          src="${VA.base}/scenes/scene_timeline.png"
          alt="Scene detection timeline"
          loading="lazy"
        >
      </article>

      <article class="analysis-card">
        <div class="card-heading">
          <h3>Frame explorer</h3>
          <span class="mono" id="frame-time">${time(0)}</span>
        </div>
        <canvas id="scene-frame" class="frame-canvas"></canvas>
        <input
          id="frame-slider"
          class="analysis-slider"
          type="range"
          min="0"
          max="${Math.max(VA.duration(), 0.1)}"
          step="0.1"
          value="0"
        >
        <p class="muted-copy">Move the slider to inspect a frame from the original video.</p>
      </article>
    </div>

    <article class="analysis-card table-card">
      <div class="card-heading">
        <h3>Detected scenes</h3>
        <span class="mono">Click a row to jump to that scene</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Scene</th>
              <th>Start</th>
              <th>End</th>
              <th>Duration</th>
              <th>Start frame</th>
              <th>End frame</th>
            </tr>
          </thead>
          <tbody>
            ${scenes.map((s) => `
              <tr class="clickable-row" data-seek="${Number(s.start_sec) || 0}">
                <td>#${esc(s.scene_id)}</td>
                <td>${esc(s.start_time || time(s.start_sec))}</td>
                <td>${esc(s.end_time || time(s.end_sec))}</td>
                <td>${Number(s.duration_sec || 0).toFixed(2)} s</td>
                <td>${esc(s.start_frame)}</td>
                <td>${esc(s.end_frame)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;

  const slider = body.querySelector("#frame-slider");
  const canvas = body.querySelector("#scene-frame");
  const ctx = canvas.getContext("2d");
  const timeLabel = body.querySelector("#frame-time");

  canvas.width = 960;
  canvas.height = 540;

  function drawFrame() {
    const video = VA.video;

    if (!video || video.readyState < 2) return;

    const ratio = video.videoWidth / video.videoHeight || 16 / 9;
    canvas.width = 960;
    canvas.height = Math.round(960 / ratio);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  slider.addEventListener("input", () => {
    const t = Number(slider.value);
    VA.seek(t);
    timeLabel.textContent = time(t);
  });

  VA.video.addEventListener("seeked", drawFrame);
  VA.video.addEventListener("loadeddata", drawFrame);

  body.querySelectorAll("[data-seek]").forEach((row) => {
    row.addEventListener("click", () => {
      const t = Number(row.dataset.seek);
      slider.value = t;
      timeLabel.textContent = time(t);
      VA.seek(t, true);
    });
  });

  drawFrame();
}