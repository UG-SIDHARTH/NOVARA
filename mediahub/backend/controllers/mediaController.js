const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { isValidUrl } = require('../utils/validator');
const { generateUuidFilename } = require('../utils/filename');
const { downloadQueue } = require('../utils/queue');
const ytDlpService = require('../services/ytDlpService');
const historyService = require('../services/historyService');
const compressionService = require('../services/compressionService');

// Valid formats array
const VALID_FORMATS = ['mp4-144', 'mp4-360', 'mp4-720', 'mp4-720p60', 'mp4-1080', 'mp4-1080p60', 'mp4-1440', 'mp4-1440p60', 'mp4-4k', 'mp4-4k60', 'mp4-best', 'mp3-64', 'mp3-128', 'mp3-320', 'm4a', 'photo'];

/**
 * Handles GET /health
 */
function healthCheck(req, res) {
  return res.json({ status: 'ok' });
}

/**
 * Handles POST /api/info
 */
async function getInfo(req, res) {
  const { url } = req.body;

  if (!isValidUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or unsupported URL. Please enter a valid HTTP/HTTPS link.'
    });
  }

  try {
    const metadata = await ytDlpService.fetchMetadata(url);
    return res.json({
      success: true,
      metadata
    });
  } catch (error) {
    console.error('Info fetching error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve media metadata.'
    });
  }
}

/**
 * Handles POST /api/download
 */
async function download(req, res) {
  // Set request and response timeouts to 10 minutes for this long-running media download
  req.setTimeout(10 * 60 * 1000);
  res.setTimeout(10 * 60 * 1000);

  const { url, format, heavyCompression, zipOutput } = req.body;

  if (!isValidUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or unsupported URL.'
    });
  }

  if (!format || !VALID_FORMATS.includes(format)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid download format requested.'
    });
  }

  // Create temporary unique ID for tracking
  const downloadId = uuidv4();
  let isFinished = false;

  res.on('close', () => {
    if (!isFinished) {
      console.log(`[Media Controller] Client disconnected for download ${downloadId}. Aborting.`);
      const cancelledInQueue = downloadQueue.cancel(downloadId);
      if (cancelledInQueue) {
        console.log(`[Media Controller] Successfully removed download ${downloadId} from queue.`);
      } else {
        ytDlpService.cancelDownload(downloadId);
      }
    }
  });

  try {
    // Queue the download to respect concurrency limits
    const result = await downloadQueue.run(async () => {
      // If client already aborted while waiting in the queue
      if (res.destroyed) {
        throw new Error('Connection closed before task started execution.');
      }

      // 1. Fetch metadata first to get video details (Title, Thumbnail, etc.)
      const metadata = await ytDlpService.fetchMetadata(url);

      // 2. Perform the download & convert via ytDlpService
      let downloadResult = await ytDlpService.downloadMedia(url, format, downloadId);
      
      let finalFilePath = downloadResult.filePath;
      
      // 3. Apply post-processing if requested
      if (heavyCompression) {
        finalFilePath = await compressionService.applyHeavyCompression(finalFilePath, downloadId);
      }
      
      if (zipOutput) {
        finalFilePath = await compressionService.createZipArchive(finalFilePath, downloadId);
      }
      
      const finalFilename = path.basename(finalFilePath);
      const finalStats = fs.statSync(finalFilePath);

      // 4. Add record to download history
      const historyItem = historyService.addToHistory({
        id: downloadId,
        url,
        title: metadata.title,
        uploader: metadata.uploader,
        duration: metadata.duration,
        thumbnail: metadata.thumbnail,
        format,
        filename: finalFilename,
        status: 'completed',
        size: finalStats.size
      });

      return {
        downloadUrl: `/downloads/${finalFilename}`,
        filename: finalFilename
      };
    }, downloadId);

    isFinished = true;
    return res.json({
      success: true,
      downloadUrl: result.downloadUrl
    });

  } catch (error) {
    isFinished = true;
    console.error('Download error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Media download processing failed.'
    });
  }
}

/**
 * Handles GET /api/history
 */
function getHistoryList(req, res) {
  try {
    const history = historyService.getHistory();
    return res.json({
      success: true,
      history
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve download history.'
    });
  }
}

module.exports = {
  healthCheck,
  getInfo,
  download,
  getHistoryList
};
