const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ultraigdl = require('ultra-igdl').default;

const cookiesPath = path.resolve(__dirname, '..', 'cookies', 'cookies.txt');
const tempDir = path.resolve(__dirname, '..', 'temp');
const downloadsDir = path.resolve(__dirname, '..', 'downloads');

// Track active download child processes and abort controllers
const activeDownloads = new Map(); // fileUuid -> { process, abortController }

function parseNetscapeCookies(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const cookiePairs = [];
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        const name = parts[5];
        const value = parts[6];
        cookiePairs.push(`${name}=${value}`);
      }
    }
    return cookiePairs.join('; ');
  } catch (err) {
    console.error('Failed to parse Netscape cookies:', err);
    return '';
  }
}


// Local binary fallbacks to make local testing robust on Windows/Linux without editing PATH
const localYtDlpWin = path.resolve(__dirname, '..', 'yt-dlp.exe');
const localYtDlpUnix = path.resolve(__dirname, '..', 'yt-dlp');
let ytDlpBinary = 'yt-dlp';

if (process.platform === 'win32' && fs.existsSync(localYtDlpWin)) {
  ytDlpBinary = localYtDlpWin;
} else if (process.platform !== 'win32' && fs.existsSync(localYtDlpUnix)) {
  ytDlpBinary = localYtDlpUnix;
}

// Local ffmpeg path checking
const localFfmpegWin = path.resolve(__dirname, '..', 'ffmpeg.exe');
const localFfmpegUnix = path.resolve(__dirname, '..', 'ffmpeg');
const localFfmpegFolder = path.resolve(__dirname, '..', 'ffmpeg');
let ffmpegLocation = null;

if (process.platform === 'win32' && fs.existsSync(localFfmpegWin)) {
  ffmpegLocation = path.dirname(localFfmpegWin);
} else if (process.platform !== 'win32' && fs.existsSync(localFfmpegUnix)) {
  ffmpegLocation = path.dirname(localFfmpegUnix);
} else if (fs.existsSync(localFfmpegFolder)) {
  ffmpegLocation = localFfmpegFolder;
}


// Ensure folders exist
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

// In-memory cache for metadata: url -> { data, expiresAt }
const metadataCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Checks if a string contains authentication indicators from yt-dlp stderr.
 * @param {string} errorStr - stderr output from yt-dlp
 * @returns {boolean}
 */
function isAuthRequiredError(errorStr) {
  const lower = errorStr.toLowerCase();
  return (
    lower.includes('confirm your age') ||
    lower.includes('sign in') ||
    lower.includes('login required') ||
    lower.includes('private video') ||
    lower.includes('forbidden') ||
    lower.includes('unauthorized') ||
    lower.includes('cookies') ||
    lower.includes('members-only') ||
    lower.includes('join this channel')
  );
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
}

function extractMetaTag(html, propertyName) {
  const regex1 = new RegExp(`<meta[^>]+(?:property|name)=["']${propertyName}["'][^>]+content=["']([^"']+)["']`, 'i');
  const regex2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${propertyName}["']`, 'i');
  const match1 = html.match(regex1);
  if (match1) return decodeHtmlEntities(match1[1]);
  const match2 = html.match(regex2);
  if (match2) return decodeHtmlEntities(match2[1]);
  return null;
}

async function fetchPhotoMetadataFallback(url, platformName) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${platformName} page (${response.status})`);
    }

    const html = await response.text();
    const imageUrl = extractMetaTag(html, 'og:image');
    if (!imageUrl) {
      throw new Error(`No image URL found in ${platformName} metadata.`);
    }

    const title = extractMetaTag(html, 'og:title') || `${platformName} Photo`;

    const metadata = {
      title: title.trim(),
      thumbnail: imageUrl,
      duration: 0,
      uploader: platformName,
      uploadDate: 'Unknown',
      originalUrl: url,
      isPhoto: true
    };

    return metadata;
  } catch (error) {
    console.error(`${platformName} photo extraction failed:`, error);
    throw new Error(error.message || `Failed to extract ${platformName} photo details.`);
  }
}

/**
 * Helper to execute yt-dlp safely via spawn.
 * @param {string[]} args - CLI arguments
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function executeYtDlp(args, fileUuid) {
  return new Promise((resolve, reject) => {
    const defaultArgs = ['--no-warnings', '--no-playlist', '--js-runtimes', 'node'];
    
    // Add cookies option if cookies file exists
    if (fs.existsSync(cookiesPath)) {
      defaultArgs.push('--cookies', cookiesPath);
    }
    
    // Add local ffmpeg location if present
    if (ffmpegLocation) {
      defaultArgs.push('--ffmpeg-location', ffmpegLocation);
    }
    
    const child = spawn(ytDlpBinary, [...defaultArgs, ...args]);
    if (fileUuid && activeDownloads.has(fileUuid)) {
      activeDownloads.get(fileUuid).process = child;
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Fetches and caches metadata using yt-dlp --dump-json.
 * @param {string} url - Target URL
 * @returns {Promise<Object>} Formatted metadata object
 */
async function fetchMetadata(url) {
  // Check Cache
  const cached = metadataCache.get(url);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const isPinterest = url.includes('pinterest.com/pin/') || url.includes('pin.it/');
  const isTwitter = url.includes('twitter.com/') || url.includes('x.com/');
  const isFacebook = url.includes('facebook.com/');
  const isInstagram = url.includes('instagram.com/');

  let platformName = null;
  if (isPinterest) platformName = 'Pinterest';
  else if (isTwitter) platformName = 'Twitter';
  else if (isFacebook) platformName = 'Facebook';
  else if (isInstagram) platformName = 'Instagram';

  // Instagram ultra-igdl strategy
  if (isInstagram) {
    try {
      console.log('Attempting Instagram metadata extraction via ultra-igdl...');
      const cookieStr = parseNetscapeCookies(cookiesPath);
      const igdl = new ultraigdl({
        cookies: cookieStr || undefined,
        timeoutMs: 15000
      });
      const result = await igdl.download(url);
      if (result && result.code === 200 && result.media && result.media.length > 0) {
        const formatted = {
          title: result.caption || 'Instagram Post',
          thumbnail: result.media[0].thumbnail || result.media[0].url || '',
          duration: result.media[0].duration || 0,
          uploader: result.username || 'Instagram User',
          uploadDate: 'Unknown',
          originalUrl: url,
          availableResolutions: [360, 720, 1080]
        };
        metadataCache.set(url, {
          data: formatted,
          expiresAt: Date.now() + CACHE_TTL
        });
        return formatted;
      } else {
        throw new Error(result.message || 'Failed to extract media data via ultra-igdl');
      }
    } catch (igError) {
      console.warn('Instagram ultra-igdl extraction failed, falling back to local yt-dlp:', igError.message);
    }
  }

  // Local yt-dlp dump-json strategy
  try {
    const result = await executeYtDlp(['--dump-json', url]);

    if (result.code !== 0) {
      if (platformName) {
        const photoMetadata = await fetchPhotoMetadataFallback(url, platformName);
        metadataCache.set(url, {
          data: photoMetadata,
          expiresAt: Date.now() + CACHE_TTL
        });
        return photoMetadata;
      }
      if (isAuthRequiredError(result.stderr)) {
        throw new Error('This content requires authentication or cookies.');
      }
      throw new Error(result.stderr || 'Failed to fetch metadata from URL');
    }

    const rawData = JSON.parse(result.stdout);

    // Extract available resolution heights from format list
    const heights = [];
    if (rawData.formats && Array.isArray(rawData.formats)) {
      for (const f of rawData.formats) {
        if (f.height && !heights.includes(f.height)) {
          heights.push(f.height);
        }
      }
    }

    // Format upload date nicely: YYYYMMDD -> YYYY-MM-DD
    let formattedDate = 'Unknown';
    if (rawData.upload_date && rawData.upload_date.length === 8) {
      formattedDate = `${rawData.upload_date.substring(0, 4)}-${rawData.upload_date.substring(4, 6)}-${rawData.upload_date.substring(6, 8)}`;
    }

    const metadata = {
      title: rawData.title || 'Untitled Video',
      thumbnail: rawData.thumbnail || rawData.thumbnails?.[0]?.url || '',
      duration: rawData.duration || 0,
      uploader: rawData.uploader || rawData.channel || 'Unknown',
      uploadDate: formattedDate,
      originalUrl: url,
      availableResolutions: heights
    };

    // Cache the result
    metadataCache.set(url, {
      data: metadata,
      expiresAt: Date.now() + CACHE_TTL
    });

    return metadata;
  } catch (error) {
    if (platformName) {
      try {
        const photoMetadata = await fetchPhotoMetadataFallback(url, platformName);
        metadataCache.set(url, {
          data: photoMetadata,
          expiresAt: Date.now() + CACHE_TTL
        });
        return photoMetadata;
      } catch (fallbackError) {
        // Fall back to original error
      }
    }
    if (error.message.includes('authentication or cookies')) {
      throw error;
    }
    console.error('yt-dlp metadata extraction failed:', error);
    throw new Error(error.message || 'Error occurred while calling media engine.');
  }
}

/**
 * Downloads a video/audio using yt-dlp, and returns path/size.
 * @param {string} url - Target URL
 * @param {string} format - Format selection
 * @param {string} fileUuid - UUID generated for filename
 * @returns {Promise<{filePath: string, filename: string, size: number}>}
 */
async function downloadMedia(url, format, fileUuid) {
  activeDownloads.set(fileUuid, { abortController: new AbortController() });
  try {
    if (format === 'photo') {
    try {
      const cached = metadataCache.get(url);
      if (!cached) {
        throw new Error('Photo metadata not found in cache.');
      }
      const imageUrl = cached.data.thumbnail;
      let referer = 'https://www.google.com/';
      try {
        const parsedImg = new URL(imageUrl);
        if (parsedImg.hostname.includes('cdninstagram.com') || parsedImg.hostname.includes('instagram.com')) {
          referer = 'https://www.instagram.com/';
        } else if (parsedImg.hostname.includes('twimg.com') || parsedImg.hostname.includes('twitter.com') || parsedImg.hostname.includes('x.com')) {
          referer = 'https://x.com/';
        } else if (parsedImg.hostname.includes('fbcdn.net') || parsedImg.hostname.includes('fbsbx.com') || parsedImg.hostname.includes('facebook.com')) {
          referer = 'https://www.facebook.com/';
        } else if (parsedImg.hostname.includes('pinimg.com') || parsedImg.hostname.includes('pinterest.com')) {
          referer = 'https://www.pinterest.com/';
        }
      } catch (e) { }

      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': referer,
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site'
        },
        signal: activeDownloads.get(fileUuid)?.abortController?.signal
      });

      if (!response.ok) {
        throw new Error(`Failed to download image file: HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      let ext = 'jpg';
      const lowercaseUrl = imageUrl.toLowerCase();
      if (lowercaseUrl.includes('.png')) ext = 'png';
      else if (lowercaseUrl.includes('.webp')) ext = 'webp';
      else if (lowercaseUrl.includes('.gif')) ext = 'gif';

      const finalFilename = `${fileUuid}.${ext}`;
      const finalFilePath = path.join(downloadsDir, finalFilename);

      fs.writeFileSync(finalFilePath, buffer);

      const stats = fs.statSync(finalFilePath);

      return {
        filePath: finalFilePath,
        filename: finalFilename,
        size: stats.size
      };
    } catch (error) {
      console.error('Pinterest photo download failed:', error);
      throw error;
    }
  }

  const isInstagram = url.includes('instagram.com/');

  // Instagram ultra-igdl strategy
  if (isInstagram) {
    try {
      console.log('Attempting Instagram media download via ultra-igdl...');
      const cookieStr = parseNetscapeCookies(cookiesPath);
      const igdl = new ultraigdl({
        cookies: cookieStr || undefined,
        timeoutMs: 25000
      });
      const result = await igdl.download(url);
      if (result && result.code === 200 && result.media && result.media.length > 0) {
        const mediaItem = result.media[0];
        const mediaUrl = mediaItem.url;

        console.log(`Downloading Instagram media from CDN URL: ${mediaUrl}`);
        const fileRes = await fetch(mediaUrl, { signal: activeDownloads.get(fileUuid)?.abortController?.signal });
        if (!fileRes.ok) {
          throw new Error(`Failed to fetch Instagram media file: HTTP ${fileRes.status}`);
        }

        const buffer = Buffer.from(await fileRes.arrayBuffer());
        let ext = 'mp4';
        if (mediaItem.type === 'image') {
          ext = 'jpg';
        } else {
          try {
            const parsedUrl = new URL(mediaUrl);
            const pathParts = parsedUrl.pathname.split('.');
            if (pathParts.length > 1) {
              const possibleExt = pathParts[pathParts.length - 1].toLowerCase();
              if (['mp4', 'jpg', 'jpeg', 'png', 'webp', 'gif'].includes(possibleExt)) {
                ext = possibleExt;
              }
            }
          } catch (e) { }
        }

        const finalFilename = `${fileUuid}.${ext}`;
        const finalFilePath = path.join(downloadsDir, finalFilename);
        fs.writeFileSync(finalFilePath, buffer);

        const stats = fs.statSync(finalFilePath);
        return {
          filePath: finalFilePath,
          filename: finalFilename,
          size: stats.size
        };
      } else {
        throw new Error(result.message || 'ultra-igdl did not return any media');
      }
    } catch (igError) {
      console.warn('Instagram ultra-igdl download failed, falling back to local yt-dlp:', igError.message);
    }
  } else {
    // Non-Instagram Cobalt strategy
    // Skip Cobalt for formats >= 1080p or 60fps because public Cobalt instances limit resolution and framerate
    const isHighQuality = ['1080', '1440', '4k', 'p60', 'k60'].some(key => format.includes(key));

    if (!isHighQuality) {
      const COBALT_APIS = [
        'https://cobaltapi.kittycat.boo/',
        'https://cobaltapi.cjs.nz/'
      ];

      // Construct cobalt options
      const cobaltOptions = {
        url: url,
        filenameStyle: 'basic'
      };

      if (format === 'mp4-144') {
        cobaltOptions.videoQuality = '144';
      } else if (format === 'mp4-360') {
        cobaltOptions.videoQuality = '360';
      } else if (format === 'mp4-720') {
        cobaltOptions.videoQuality = '720';
      } else if (format === 'mp4-best') {
        cobaltOptions.videoQuality = 'max';
      } else if (format === 'mp3-64') {
        cobaltOptions.downloadMode = 'audio';
        cobaltOptions.audioFormat = 'mp3';
        cobaltOptions.audioBitrate = '64';
      } else if (format === 'mp3-128') {
        cobaltOptions.downloadMode = 'audio';
        cobaltOptions.audioFormat = 'mp3';
        cobaltOptions.audioBitrate = '128';
      } else if (format === 'mp3-320') {
        cobaltOptions.downloadMode = 'audio';
        cobaltOptions.audioFormat = 'mp3';
        cobaltOptions.audioBitrate = '320';
      } else if (format === 'm4a') {
        cobaltOptions.downloadMode = 'audio';
        cobaltOptions.audioFormat = 'best';
      }

      for (const api of COBALT_APIS) {
        try {
          console.log(`Attempting Cobalt download on instance: ${api}`);
          const res = await fetch(api, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(cobaltOptions),
            signal: activeDownloads.get(fileUuid)?.abortController?.signal
          });

          if (res.ok) {
            const data = await res.json();
            if (data.status === 'tunnel' || data.status === 'redirect') {
              const downloadUrl = data.url;
              console.log(`Downloading media from Cobalt tunnel: ${downloadUrl}`);
              const fileRes = await fetch(downloadUrl, { signal: activeDownloads.get(fileUuid)?.abortController?.signal });
              if (!fileRes.ok) {
                throw new Error(`Failed to fetch media file: HTTP ${fileRes.status}`);
              }

              let ext = 'mp4';
              if (data.filename) {
                const parts = data.filename.split('.');
                if (parts.length > 1) {
                  ext = parts[parts.length - 1].toLowerCase();
                }
              } else if (format.includes('mp3')) {
                ext = 'mp3';
              } else if (format === 'm4a') {
                ext = 'm4a';
              }

              const finalFilename = `${fileUuid}.${ext}`;
              const finalFilePath = path.join(downloadsDir, finalFilename);

              // Stream response body directly to disk instead of buffering in memory
              const { finished } = require('stream/promises');
              const { Readable } = require('stream');
              const fileStream = fs.createWriteStream(finalFilePath);
              await finished(Readable.fromWeb(fileRes.body).pipe(fileStream));

              const stats = fs.statSync(finalFilePath);
              return {
                filePath: finalFilePath,
                filename: finalFilename,
                size: stats.size
              };
            } else if (data.status === 'error') {
              throw new Error(data.error.code || 'Cobalt returned error status');
            }
          } else {
            throw new Error(`HTTP status ${res.status}`);
          }
        } catch (err) {
          console.warn(`Cobalt API ${api} failed:`, err.message);
        }
      }
    }
  }

  // Fallback to local yt-dlp execution
  console.log('Bypassing/Failed primary download service. Falling back to local yt-dlp execution...');
  const args = [
    url,
    '-o', path.join(tempDir, `${fileUuid}.%(ext)s`)
  ];

  let ext = 'mp4';

  if (format === 'mp4-144') {
    args.push('-f', 'bestvideo[height<=144]+bestaudio/best[height<=144]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-360') {
    args.push('-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-720') {
    args.push('-f', 'bestvideo[height<=720][fps<=30]+bestaudio/bestvideo[height<=720]+bestaudio/best[height<=720]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-720p60') {
    args.push('-f', 'bestvideo[height<=720][fps>30]+bestaudio/bestvideo[height<=720]+bestaudio/best[height<=720]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-1080') {
    args.push('-f', 'bestvideo[height<=1080][fps<=30]+bestaudio/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-1080p60') {
    args.push('-f', 'bestvideo[height<=1080][fps>30]+bestaudio/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-1440') {
    args.push('-f', 'bestvideo[height<=1440][fps<=30]+bestaudio/bestvideo[height<=1440]+bestaudio/best[height<=1440]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-1440p60') {
    args.push('-f', 'bestvideo[height<=1440][fps>30]+bestaudio/bestvideo[height<=1440]+bestaudio/best[height<=1440]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-4k') {
    args.push('-f', 'bestvideo[height<=2160][fps<=30]+bestaudio/bestvideo[height<=2160]+bestaudio/best[height<=2160]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-4k60') {
    args.push('-f', 'bestvideo[height<=2160][fps>30]+bestaudio/bestvideo[height<=2160]+bestaudio/best[height<=2160]/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp4-best') {
    args.push('-f', 'bestvideo+bestaudio/best');
    args.push('--merge-output-format', 'mp4');
    ext = 'mp4';
  } else if (format === 'mp3-64') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '64K');
    ext = 'mp3';
  } else if (format === 'mp3-128') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '128K');
    ext = 'mp3';
  } else if (format === 'mp3-320') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '320K');
    ext = 'mp3';
  } else if (format === 'm4a') {
    args.push('-x', '--audio-format', 'm4a');
    ext = 'm4a';
  }

  try {
    const result = await executeYtDlp(args, fileUuid);

    if (result.code !== 0) {
      if (isAuthRequiredError(result.stderr)) {
        throw new Error('This content requires authentication or cookies.');
      }
      throw new Error(result.stderr || 'Media download failed.');
    }

    // Now find the downloaded file in the temp directory.
    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(f => f.startsWith(fileUuid));

    if (!downloadedFile) {
      throw new Error('Could not find completed download file in temp workspace.');
    }

    const tempFilePath = path.join(tempDir, downloadedFile);
    const finalFilename = `${fileUuid}${path.extname(downloadedFile)}`;
    const finalFilePath = path.join(downloadsDir, finalFilename);

    // Stream download directly to disk by copying and deleting the temp file (avoiding cross-device link EXDEV errors)
    fs.copyFileSync(tempFilePath, finalFilePath);
    fs.unlinkSync(tempFilePath);

    // Get final file details
    const stats = fs.statSync(finalFilePath);

    return {
      filePath: finalFilePath,
      filename: finalFilename,
      size: stats.size
    };
  } catch (error) {
    // Attempt cleaning up files starting with fileUuid in temp
    try {
      const files = fs.readdirSync(tempDir);
      for (const f of files) {
        if (f.startsWith(fileUuid)) {
          fs.unlinkSync(path.join(tempDir, f));
        }
      }
    } catch (cleanupErr) {
      console.error('Failed to clean up temp files:', cleanupErr);
    }

    throw error;
  }
  } finally {
    activeDownloads.delete(fileUuid);
  }
}

/**
 * Cancels an active download process or fetch request by download ID.
 * @param {string} fileUuid - The UUID of the download
 * @returns {boolean} True if found and cancelled, false otherwise
 */
function cancelDownload(fileUuid) {
  const active = activeDownloads.get(fileUuid);
  if (active) {
    console.log(`[ytDlpService] Cancelling active download: ${fileUuid}`);
    if (active.process) {
      try {
        active.process.kill('SIGKILL');
        console.log(`[ytDlpService] Successfully killed yt-dlp child process for ${fileUuid}`);
      } catch (err) {
        console.error(`Failed to kill process for ${fileUuid}:`, err);
      }
    }
    if (active.abortController) {
      try {
        active.abortController.abort();
        console.log(`[ytDlpService] Successfully aborted fetch request for ${fileUuid}`);
      } catch (err) {
        console.error(`Failed to abort fetch for ${fileUuid}:`, err);
      }
    }
    activeDownloads.delete(fileUuid);
    return true;
  }
  return false;
}

module.exports = {
  fetchMetadata,
  downloadMedia,
  cancelDownload
};
