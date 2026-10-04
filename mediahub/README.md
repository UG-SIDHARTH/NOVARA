# MediaHub Downloader ⚡

A lightweight, clean, and production-ready self-hosted media downloader. It allows you to query metadata and download video or audio streams from YouTube, X (Twitter), Facebook, TikTok, Instagram, and any other platform supported by `yt-dlp`. 

Optimized to run on low-resource virtual private servers (VPS), e.g., Debian VPS with 2 CPU cores and 2 GB RAM.

---

## Key Features

- 🌌 **Premium UI/UX**: Futuristic dark theme with animated radial gradient background blobs, glowing buttons, and full responsive support for mobile screens.
- ⚡ **Platform Auto-Detection**: Enter any URL and let the backend automatically resolve metadata details (uploader, duration, upload date, and thumbnail).
- 💿 **Format Quality Selection**:
  - **Video**: MP4 144p to 4K (Ultra HD), including 60fps variants (e.g. 720p60, 1080p60, 1440p60, 4K60).
  - **Audio**: MP3 64 kbps, MP3 128 kbps, MP3 320 kbps, or M4A (processes conversion automatically via FFmpeg).
- 🗜️ **Advanced Processing**:
  - **Heavy Compression**: Toggle H.265/HEVC encoding via FFmpeg to drastically reduce file sizes.
  - **Zip Output**: Package downloads into `.zip` archives on-the-fly.
- 🔒 **Sandbox Security**:
  - Helmet security headers and CORS enabled.
  - Rate limiting to block brute force or Denial-of-Service attempts.
  - Shell command injection protection (uses `spawn` argument vector execution instead of raw shell parsing).
  - Directory traversal prevention using strict UUID string filename verification.
- 🗃️ **Downloads History**: Persists metadata history to `history.json` and lists previous downloads on an integrated dashboard.
- 🛡️ **Cookies & Login Support**: Place your platform authorization files in `cookies/cookies.txt` and they will automatically load into `yt-dlp`.
- 📦 **Docker Compose Powered**: Run the entire web suite (React compilation, Express server, and Nginx proxy) with a single command.

---

## Directory Structure

```text
mediahub/
├── docker-compose.yml         # Container coordinator
├── backend/
│   ├── Dockerfile            # Python, FFmpeg, and Node.js setup
│   ├── server.js             # Express app setup and safe filename serving
│   ├── controllers/          # Media download and history controllers
│   ├── routes/               # API Router
│   ├── services/             # yt-dlp/FFmpeg and history integrations
│   ├── utils/                # Queue, sanitization, and validator helpers
│   ├── downloads/            # Local storage for completed media files
│   ├── temp/                 # Work folder for video/audio assembly streams
│   └── cookies/              # Folder for optional cookies.txt files
├── frontend/
│   ├── Dockerfile            # React static compiler and Nginx web server
│   ├── nginx.conf            # Reverse proxy configuration
│   ├── package.json
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.jsx          # Bootstrap hook
│   │   ├── App.jsx           # Coordinate state and API fetch logic
│   │   ├── index.css         # Glassmorphic stylings and animations
│   │   └── components/       # UrlInput, MetadataCard, HistoryList, and Toast UI
```

---

## Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Installation & Launch

1. Clone or copy this repository to your Debian VPS or local machine.
2. Navigate into the project folder:
   ```bash
   cd mediahub
   ```
3. Boot the environment in detached mode:
   ```bash
   docker compose up -d --build
   ```
4. Access the web interface:
   - **Frontend UI**: Browse to `http://localhost` (or server IP on port 80).
   - **Backend API**: Running internally or via port `http://localhost:5000` (proxied by Nginx).

---

## Authentication & Cookies Setup

YouTube and other platforms frequently impose rate-limits or bot blocks. To bypass these limitations:

1. Export your browser cookies in Netscape format (e.g., using extensions like "Get cookies.txt LOCALLY").
2. Create or write to the file `mediahub/backend/cookies/cookies.txt` (or update it on your host).
3. If using Docker Compose, the `mediahub_cookies` volume is mapped to `/app/cookies`. You can place the file directly in your mapped host files or update the volume mount in `docker-compose.yml` to map a relative folder:
   ```yaml
   volumes:
     - ./backend/cookies:/app/cookies
   ```
   *Note: Our default `docker-compose.yml` uses named volumes for maximum reliability.*

---

## Technical Security Operations

### Prevention of Command Injection
We *never* execute user URLs in shell commands. URLs are sent directly to the process execution vector (`spawn` in Node.js) as independent array parameters:
```javascript
const child = spawn('yt-dlp', ['--dump-json', url]);
```
The OS executes `yt-dlp` directly without invoking shell parsing engines (such as `/bin/sh` or `powershell`), rendering command sequence separators (like `;`, `&&`, `|`) completely inert.

### Safe Filenames
All saved downloads on disk use generated UUIDs (e.g., `45d67e89-1234-5678-abcd-ef1234567890.mp4`). Traversal requests are blocked via rigid regex filename tests on the file routing request:
```javascript
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(filename)) {
  return res.status(400).json({ error: 'Invalid reference.' });
}
```

---

## Troubleshooting

### 1. "Sign in to confirm your age" or "This content requires authentication"
- **Solution**: The platform has restricted access. Export a valid Netscape `cookies.txt` file and place it in the `cookies` directory.

### 2. Slow Downloads or VPS Freezing
- **Cause**: Dual stream video/audio merging uses CPU.
- **Solution**: The backend uses an in-memory task queue which limits downloads to a maximum of 2 concurrent jobs to protect your server.

### 3. Port 80 is Already in Use
- **Solution**: Open `docker-compose.yml` and modify the frontend port mapping, e.g. `"8080:80"`.
