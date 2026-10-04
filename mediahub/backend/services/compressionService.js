const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const archiver = require('archiver');

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

/**
 * Apply heavy FFmpeg compression (H.265/HEVC) for video or lower bitrate for audio.
 */
async function applyHeavyCompression(filePath, fileUuid) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(filePath).toLowerCase();
    const isAudioOnly = ['.mp3', '.m4a', '.wav'].includes(ext);
    
    // We can't really heavily compress images with ffmpeg the same way without knowing if it's an image.
    if (ext === '.jpg' || ext === '.png' || ext === '.webp') {
      return resolve(filePath);
    }

    const compressedFilename = `${fileUuid}_compressed${ext}`;
    const compressedPath = path.join(path.dirname(filePath), compressedFilename);
    const args = ['-i', filePath];
    
    if (isAudioOnly) {
      args.push('-c:a', 'libmp3lame', '-b:a', '32k');
    } else {
      args.push('-c:v', 'libx265', '-crf', '28', '-c:a', 'aac', '-b:a', '64k');
    }
    args.push('-y', compressedPath);
    
    let ffmpegBin = ffmpegLocation ? path.join(ffmpegLocation, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : 'ffmpeg';
    const child = spawn(ffmpegBin, args);
    
    child.on('close', (code) => {
      if (code === 0) {
        fs.unlinkSync(filePath); // delete original
        resolve(compressedPath);
      } else {
        reject(new Error(`FFmpeg compression failed with code ${code}`));
      }
    });
    child.on('error', (err) => reject(err));
  });
}

/**
 * Zip the output file.
 */
async function createZipArchive(filePath, fileUuid) {
  return new Promise((resolve, reject) => {
    const zipFilename = `${fileUuid}.zip`;
    const zipPath = path.join(path.dirname(filePath), zipFilename);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      fs.unlinkSync(filePath); // delete original
      resolve(zipPath);
    });
    archive.on('error', (err) => reject(err));
    
    archive.pipe(output);
    archive.file(filePath, { name: path.basename(filePath) });
    archive.finalize();
  });
}

module.exports = {
  applyHeavyCompression,
  createZipArchive
};
