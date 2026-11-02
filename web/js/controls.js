const $ = (selector) => document.querySelector(selector);

const uploadInput = $("#video-upload");
const videoSelect = $("#video-select");
const uploadStatus = $("#upload-status");
const runButton = $("#run-pipeline");
const statusLabel = $("#pipeline-status");
const progressPanel = $("#pipeline-progress");
const progressFill = $("#progress-fill");
const progressMessage = $("#progress-message");
const progressValue = $("#progress-value");
const logs = $("#pipeline-logs");

let polling = false;

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

async function refreshVideos() {
  const data = await api("/api/results");

  const previous = videoSelect.value;

  videoSelect.innerHTML = "";

  if (!data.videos.length) {
    videoSelect.add(new Option("No videos uploaded", ""));
    return;
  }

  for (const name of data.videos) {
    videoSelect.add(new Option(name, name));
  }

  if (data.videos.includes(previous)) {
    videoSelect.value = previous;
  }
}

uploadInput.addEventListener("change", async () => {
  const file = uploadInput.files?.[0];

  if (!file) return;

  uploadStatus.textContent = `Uploading ${file.name}...`;

  try {
    const form = new FormData();
    form.append("file", file);

    const result = await api("/api/upload", {
      method: "POST",
      body: form,
    });

    await refreshVideos();

    videoSelect.value = result.filename;

    uploadStatus.textContent =
      `${result.filename} · ${(result.size / 1024 / 1024).toFixed(1)} MB`;
  } catch (error) {
    uploadStatus.textContent = error.message;
  } finally {
    uploadInput.value = "";
  }
});

function getSettings() {
  const summary = $("#setting-summary").value;

  return {
    threshold: Number($("#setting-threshold").value),
    min_scene_length: Number($("#setting-min-length").value),
    keyframe_step: Number($("#setting-keyframe-step").value),
    model: $("#setting-model").value,
    tracking_stride: Number($("#setting-stride").value),
    confidence: Number($("#setting-confidence").value),
    summary_length: summary === "auto" ? null : Number(summary),
  };
}

async function pollStatus() {
  if (polling) return;

  polling = true;
  runButton.disabled = true;
  progressPanel.hidden = false;

  try {
    while (true) {
      const job = await api("/api/status");

      statusLabel.textContent = job.stage || "Running";
      progressMessage.textContent = job.message || "Working...";
      progressValue.textContent = `${job.progress || 0}%`;
      progressFill.style.width = `${job.progress || 0}%`;

      logs.textContent = (job.logs || []).join("\n");
      logs.scrollTop = logs.scrollHeight;

      if (job.completed) {
        if (job.success) {
          statusLabel.textContent = "Complete";
          progressMessage.textContent = "Analysis completed.";
          progressFill.style.width = "100%";
          progressValue.textContent = "100%";

          // Reload so main.js reads the newly generated result files.
          setTimeout(() => {
            location.href = "/?r=outputs";
          }, 1000);
        } else {
          statusLabel.textContent = "Failed";
          progressMessage.textContent = job.error || "Pipeline failed.";
          runButton.disabled = false;
        }

        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    statusLabel.textContent = "Connection error";
    progressMessage.textContent = error.message;
    runButton.disabled = false;
  } finally {
    polling = false;
  }
}

runButton.addEventListener("click", async () => {
  const video = videoSelect.value;

  if (!video) {
    statusLabel.textContent = "Choose or upload a video first.";
    return;
  }

  runButton.disabled = true;
  statusLabel.textContent = "Starting...";
  progressPanel.hidden = false;

  try {
    await api("/api/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        video,
        settings: getSettings(),
      }),
    });

    await pollStatus();
  } catch (error) {
    statusLabel.textContent = error.message;
    runButton.disabled = false;
  }
});

async function init() {
  try {
    await refreshVideos();

    const current = await api("/api/status");

    if (current.running) {
      await pollStatus();
    } else if (current.completed && !current.success) {
      statusLabel.textContent = "Previous run failed";
    }
  } catch (error) {
    statusLabel.textContent = error.message;
  }
}

init();