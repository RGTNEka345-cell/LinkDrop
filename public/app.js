const form = document.querySelector("#analyze-form");
const button = document.querySelector("#analyze-btn");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const formatSelect = document.querySelector("#format");
let activeUrl = "";

const formatSize = bytes => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "Size varies";
const formatTime = seconds => seconds ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,"0")}` : "";

form.addEventListener("submit", async event => {
  event.preventDefault();
  activeUrl = document.querySelector("#url").value.trim();
  status.textContent = "Finding the best available qualities…";
  status.style.color = "#368968";
  button.disabled = true;
  button.innerHTML = "Analyzing…";
  result.classList.add("hidden");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);
    const response = await fetch("/api/analyze", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ url: activeUrl }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not analyze this link.");
    if (!data.formats.length) throw new Error("No downloadable video qualities were found.");

    document.querySelector("#title").textContent = data.title;
    document.querySelector("#meta").textContent = [data.creator, formatTime(data.duration)].filter(Boolean).join(" · ");
    const thumb = document.querySelector("#thumb");
    thumb.src = data.thumbnail || "";
    thumb.hidden = !data.thumbnail;
    formatSelect.innerHTML = data.formats.map((item, index) => `<option value="${item.id}">${index === 0 ? "Best · " : ""}${item.label} · ${item.ext.toUpperCase()} · ${formatSize(item.size)}${item.hasAudio ? " · Audio" : ""}</option>`).join("");
    result.classList.remove("hidden");
    status.textContent = "";
    result.scrollIntoView({ behavior:"smooth", block:"center" });
  } catch (error) {
    status.style.color = "#bd4747";
    status.textContent = error.name === "AbortError"
      ? "The platform took too long to respond. Check that the link is public and try again."
      : error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = "Get video <span>→</span>";
  }
});

document.querySelector("#download-btn").addEventListener("click", event => {
  const downloadButton = event.currentTarget;
  const originalContent = downloadButton.innerHTML;
  const params = new URLSearchParams({ url: activeUrl, format: formatSelect.value });

  downloadButton.disabled = true;
  downloadButton.textContent = "Preparing download…";
  status.style.color = "#368968";
  status.textContent = "Preparing the file on the server. Your browser download will start automatically…";

  // Navigate a hidden frame directly to the attachment response. This lets the
  // browser stream large files to disk instead of holding the whole video in RAM.
  let frame = document.querySelector("#download-frame");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "download-frame";
    frame.name = "download-frame";
    frame.hidden = true;
    document.body.appendChild(frame);
  }
  frame.src = `/api/download?${params}`;

  setTimeout(() => {
    downloadButton.disabled = false;
    downloadButton.innerHTML = originalContent;
    status.textContent = "The server is processing your video. Large qualities may take a few minutes.";
  }, 3000);
});
