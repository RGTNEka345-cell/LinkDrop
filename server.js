import express from "express";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "32kb" }));
app.use(express.static("public"));

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function runYtDlp(args, onStart) {
  const configuredPath = process.env.YTDLP_PATH;
  const command = configuredPath || (process.platform === "win32" ? "py" : "yt-dlp");
  const extraArgs = ["--force-ipv4"];
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const packages = join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
    try {
      const packageName = readdirSync(packages).find(name => name.startsWith("Gyan.FFmpeg_"));
      const packageDir = packageName && join(packages, packageName);
      const buildName = packageDir && readdirSync(packageDir).find(name => name.startsWith("ffmpeg-") && name.endsWith("full_build"));
      const ffmpeg = buildName && join(packageDir, buildName, "bin", "ffmpeg.exe");
      if (ffmpeg && existsSync(ffmpeg)) extraArgs.push("--ffmpeg-location", ffmpeg);
    } catch {
      // yt-dlp will use PATH or report a clear merge error if FFmpeg is unavailable.
    }
  }
  const ytDlpArgs = [...extraArgs, ...args];
  const commandArgs = !configuredPath && process.platform === "win32" ? ["-m", "yt_dlp", ...ytDlpArgs] : ytDlpArgs;
  const child = spawn(command, commandArgs, { windowsHide: true });
  onStart?.(child);
  return child;
}

app.post("/api/analyze", (req, res) => {
  const { url } = req.body;
  if (!validHttpUrl(url)) return res.status(400).json({ error: "Please enter a valid public URL." });

  let output = "";
  let errors = "";
  const child = runYtDlp([
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout", "15",
    "--retries", "1",
    "--extractor-retries", "1",
    url
  ]);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 45000);

  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { errors += chunk; });
  child.on("error", error => {
    clearTimeout(timeout);
    const missing = error.code === "ENOENT";
    if (!res.headersSent) {
      res.status(500).json({ error: missing ? "yt-dlp is not installed on this server." : "Could not start the media analyzer." });
    }
  });
  child.on("close", code => {
    clearTimeout(timeout);
    if (res.headersSent) return;
    if (timedOut) return res.status(504).json({ error: "This platform took too long to respond. Check that the link is public and try again." });
    if (code !== 0) return res.status(422).json({ error: errors.trim().split("\n").at(-1) || "This link could not be analyzed." });
    try {
      const data = JSON.parse(output);
      const formats = (data.formats || [])
        .filter(item => item.format_id && item.vcodec !== "none" && item.ext)
        .map(item => ({
          id: item.format_id,
          label: item.format_note || (item.height ? `${item.height}p` : item.format),
          height: item.height || 0,
          ext: item.ext,
          fps: item.fps || null,
          size: item.filesize || item.filesize_approx || null,
          hasAudio: item.acodec !== "none"
        }))
        .sort((a, b) => b.height - a.height)
        .filter((item, index, all) => index === all.findIndex(other => other.height === item.height && other.ext === item.ext));

      res.json({
        title: data.title || "Untitled media",
        creator: data.uploader || data.channel || data.extractor_key || "Social media",
        thumbnail: data.thumbnail || null,
        duration: data.duration || null,
        formats: formats.slice(0, 18)
      });
    } catch {
      res.status(500).json({ error: "The platform returned an unreadable response." });
    }
  });

  res.on("close", () => {
    if (!child.killed && !res.writableEnded) child.kill();
  });
});

app.get("/api/download", async (req, res) => {
  const { url, format } = req.query;
  if (!validHttpUrl(url) || !format || !/^[\w+\-/.:[\]]+$/.test(format)) {
    return res.status(400).json({ error: "Invalid download request." });
  }

  const workDir = await mkdtemp(join(tmpdir(), "linkdrop-"));
  const output = join(workDir, "download.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--socket-timeout", "20",
    "--retries", "2",
    "--fragment-retries", "2",
    "-f", `${format}+bestaudio/best[format_id=${format}]/best`,
    "--merge-output-format", "mp4",
    "-o", output,
    url
  ];
  const child = runYtDlp(args);
  let errors = "";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 10 * 60 * 1000);

  // Drain process output so a full pipe buffer cannot freeze long downloads.
  child.stdout.resume();
  child.stderr.on("data", chunk => {
    errors = `${errors}${chunk}`.slice(-8000);
  });
  child.on("error", () => {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ error: "Download service is unavailable." });
    rm(workDir, { recursive: true, force: true });
  });
  child.on("close", async code => {
    clearTimeout(timeout);
    if (res.headersSent) return;
    if (code !== 0) {
      await rm(workDir, { recursive: true, force: true });
      const detail = errors.trim().split("\n").at(-1);
      return res.status(timedOut ? 504 : 422).json({
        error: timedOut
          ? "The download took too long and was stopped. Try a smaller quality."
          : detail || "The selected quality could not be downloaded."
      });
    }
    const files = await readdir(workDir);
    const file = files.find(name => !name.endsWith(".part") && !name.endsWith(".ytdl"));
    if (!file) {
      await rm(workDir, { recursive: true, force: true });
      return res.status(500).json({ error: "No completed download file was created." });
    }
    res.download(join(workDir, file), file, async error => {
      await rm(workDir, { recursive: true, force: true });
      if (error && !res.headersSent) res.status(500).json({ error: "Could not send the completed file." });
    });
  });

  res.on("close", () => {
    if (!child.killed && !res.writableEnded) child.kill();
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(port, "0.0.0.0", () => console.log(`LinkDrop running on port ${port}`));
