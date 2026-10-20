# LinkDrop

A clean social-media download interface backed by `yt-dlp`. Paste a public media URL, inspect the available resolutions, and download a selected quality.

## Requirements

- Node.js 20+
- `yt-dlp` available on `PATH` (or set `YTDLP_PATH`)
- FFmpeg available on `PATH` for merging high-resolution video with audio

## Run locally

```powershell
npm install
npm start
```

Open `http://localhost:3000`.

## Publish with Render

This repository includes a production `Dockerfile` with Node.js, `yt-dlp`, and FFmpeg, plus a `render.yaml` Blueprint.

1. Push the project to a GitHub repository.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the GitHub repository and deploy the detected `render.yaml`.
4. When the health check passes, open the generated `onrender.com` URL.

The free Render service sleeps after inactivity and has limited CPU/RAM. Large or concurrent video downloads work more reliably on a paid instance or a small VPS. Temporary download files are deleted after each response.

Only download media you own, media in the public domain, or media you have permission to save. Platform support depends on `yt-dlp` and may change as social sites update.
