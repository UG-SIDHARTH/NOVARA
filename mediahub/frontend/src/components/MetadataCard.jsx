import React, { useState, useEffect } from 'react';
import { Play, Download, Music, Video, Calendar, User, Clock, Loader2, CheckCircle, Image } from 'lucide-react';

// Format selection mappings
const FORMAT_LABELS = {
  'mp4-144': 'MP4 144p (Lowest)',
  'mp4-360': 'MP4 360p (Low)',
  'mp4-720': 'MP4 720p (HD)',
  'mp4-720p60': 'MP4 720p60 (HD)',
  'mp4-1080': 'MP4 1080p (Full HD)',
  'mp4-1080p60': 'MP4 1080p60 (Full HD)',
  'mp4-1440': 'MP4 1440p (2K)',
  'mp4-1440p60': 'MP4 1440p60 (2K)',
  'mp4-4k': 'MP4 4K (Ultra HD)',
  'mp4-4k60': 'MP4 4K60 (Ultra HD)',
  'mp4-best': 'Best Available Video',
  'mp3-64': 'MP3 64 kbps',
  'mp3-128': 'MP3 128 kbps',
  'mp3-320': 'MP3 320 kbps',
  'm4a': 'M4A Standard Audio',
  'photo': 'Original Quality Photo'
};

function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function MetadataCard({ metadata, onDownload, isDownloading, downloadSuccess, onCancelDownload }) {
  const [activeTab, setActiveTab] = useState('video'); // 'video' | 'audio' | 'image'
  const [selectedFormat, setSelectedFormat] = useState('mp4-720'); // default select
  const [heavyCompression, setHeavyCompression] = useState(false);
  const [zipOutput, setZipOutput] = useState(false);

  const url = (metadata.originalUrl || '').toLowerCase();
  
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
  const isGit = url.includes('github.com') || url.includes('gitlab.com') || url.includes('git');
  const isInstagramReel = url.includes('instagram.com/reel') || url.includes('instagram.com/reels');
  const isFacebookReel = url.includes('facebook.com/reel') || url.includes('facebook.com/reels') || url.includes('facebook.com/watch');
  
  const isInstagramPost = url.includes('instagram.com/p/') || url.includes('instagram.com/photo') || url.includes('instagram.com/stories');
  const isFacebookPost = url.includes('facebook.com') && !isFacebookReel;
  const isXPost = url.includes('x.com') || url.includes('twitter.com');
  const isPinterest = url.includes('pinterest.com') || url.includes('pin.it');

  let isPhoto = metadata.isPhoto;
  
  if (isInstagramReel || isFacebookReel || isYoutube || isGit) {
    isPhoto = false;
  } else if (isInstagramPost || isFacebookPost || isXPost || isPinterest) {
    isPhoto = true;
  }

  useEffect(() => {
    if (isPhoto) {
      setSelectedFormat('photo');
      setActiveTab('image');
    } else {
      const available = metadata.availableResolutions || [];
      if (available.length > 0) {
        if (available.some(h => h >= 720)) {
          setSelectedFormat('mp4-720');
        } else {
          setSelectedFormat('mp4-360');
        }
      } else {
        setSelectedFormat('mp4-720');
      }
      setActiveTab('video');
    }
  }, [metadata, isPhoto]);

  const handleTabChange = (tab) => {
    if (isPhoto) return;
    setActiveTab(tab);
    if (tab === 'video') {
      const available = metadata.availableResolutions || [];
      if (available.length > 0 && !available.some(h => h >= 720)) {
        setSelectedFormat('mp4-360');
      } else {
        setSelectedFormat('mp4-720');
      }
    } else if (tab === 'audio') {
      setSelectedFormat('mp3-320');
    } else if (tab === 'image') {
      setSelectedFormat('photo');
    }
  };

  const handleDownloadClick = () => {
    onDownload(selectedFormat, { heavyCompression, zipOutput });
  };

  const availableRes = metadata.availableResolutions || [];
  const videoFormats = ['mp4-144', 'mp4-360'];
  if (availableRes.length === 0) {
    videoFormats.push('mp4-720', 'mp4-720p60', 'mp4-best');
  } else {
    if (availableRes.some(h => h >= 720)) {
      videoFormats.push('mp4-720', 'mp4-720p60');
    }
    if (availableRes.some(h => h >= 1080)) {
      videoFormats.push('mp4-1080', 'mp4-1080p60');
    }
    if (availableRes.some(h => h >= 1440)) {
      videoFormats.push('mp4-1440', 'mp4-1440p60');
    }
    if (availableRes.some(h => h >= 2160)) {
      videoFormats.push('mp4-4k', 'mp4-4k60');
    }
    videoFormats.push('mp4-best');
  }

  const audioFormats = ['mp3-64', 'mp3-128', 'mp3-320', 'm4a'];
  const imageFormats = ['photo'];

  return (
    <div className="w-full max-w-4xl mx-auto glass-panel rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 animate-fade-in border border-white/5">
      <div className="flex flex-col md:flex-row">
        
        {/* Left Side: Thumbnail Preview */}
        <div className="relative md:w-2/5 aspect-video md:aspect-auto min-h-[220px] bg-slate-950 flex items-center justify-center overflow-hidden group">
          {metadata.thumbnail ? (
            <img
              src={metadata.thumbnail}
              alt={metadata.title}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-500">
              <Play className="w-12 h-12 mb-2 animate-pulse text-accent-cyan" />
              <span className="text-sm font-semibold">No Thumbnail Available</span>
            </div>
          )}
          
          {/* Duration overlay badge */}
          {metadata.duration > 0 && (
            <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-md text-xs font-semibold font-orbitron text-accent-cyan border border-accent-cyan/25 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{formatDuration(metadata.duration)}</span>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none md:hidden" />
        </div>

        {/* Right Side: Title & Formatting Controls */}
        <div className="flex-1 p-6 md:p-8 flex flex-col justify-between gap-6">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-slate-100 leading-snug line-clamp-2 hover:line-clamp-none transition-all duration-300">
              {metadata.title}
            </h2>
            
            {/* Publisher / Uploader Meta */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-slate-400">
              <div className="flex items-center gap-1.5">
                <User className="w-4 h-4 text-accent-cyan" />
                <span className="font-semibold text-slate-300 truncate max-w-[180px]">{metadata.uploader}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-accent-pink" />
                <span>{metadata.uploadDate}</span>
              </div>
            </div>
          </div>

          {/* Formats and Segment Selection */}
          {isPhoto ? (
            <div className="space-y-4">
              <div className="text-xs font-bold text-accent-cyan tracking-wider uppercase font-orbitron">
                Format Option
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  disabled={isDownloading}
                  className="py-3 px-4 rounded-xl text-xs font-semibold border border-accent-cyan bg-accent-cyan/5 text-accent-cyan shadow-sm shadow-accent-cyan/10 text-left flex flex-col justify-center"
                >
                  <span className="text-slate-300 font-bold">{FORMAT_LABELS['photo']}</span>
                  <span className="text-[10px] opacity-70 mt-0.5 uppercase">IMAGE FILE</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex bg-slate-950/80 p-1 rounded-xl border border-white/5 w-full max-w-[360px]">
                <button
                  onClick={() => handleTabChange('video')}
                  disabled={isDownloading}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'video'
                      ? 'bg-accent-cyan/10 text-accent-cyan font-bold border border-accent-cyan/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Video className="w-4 h-4" />
                  <span>Video</span>
                </button>
                <button
                  onClick={() => handleTabChange('audio')}
                  disabled={isDownloading}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'audio'
                      ? 'bg-accent-purple/10 text-accent-purple font-bold border border-accent-purple/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Music className="w-4 h-4" />
                  <span>Audio</span>
                </button>
                <button
                  onClick={() => handleTabChange('image')}
                  disabled={isDownloading}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'image'
                      ? 'bg-accent-cyan/10 text-accent-cyan font-bold border border-accent-cyan/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Image className="w-4 h-4" />
                  <span>Image</span>
                </button>
              </div>

              {/* Quality buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(activeTab === 'video' ? videoFormats : activeTab === 'audio' ? audioFormats : imageFormats).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setSelectedFormat(fmt)}
                    disabled={isDownloading}
                    className={`py-3 px-4 rounded-xl text-xs font-semibold border transition-all duration-200 text-left flex flex-col justify-center ${
                      selectedFormat === fmt
                        ? activeTab === 'video' || activeTab === 'image'
                          ? 'border-accent-cyan bg-accent-cyan/5 text-accent-cyan shadow-sm shadow-accent-cyan/10'
                          : 'border-accent-purple bg-accent-purple/5 text-accent-purple shadow-sm shadow-accent-purple/10'
                        : 'border-white/5 bg-slate-900/30 hover:bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-slate-300 font-bold">
                      {fmt === 'photo' && activeTab === 'image' && !isPhoto ? 'Original Quality Thumbnail' : FORMAT_LABELS[fmt]}
                    </span>
                    <span className="text-[10px] opacity-70 mt-0.5 uppercase">
                      {fmt === 'photo' && activeTab === 'image' && !isPhoto ? 'THUMBNAIL FILE' : fmt.replace('-', ' ')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Additional Options */}
          {!isPhoto && (
            <div className="flex flex-col sm:flex-row gap-4 mt-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                <input
                  type="checkbox"
                  checked={heavyCompression}
                  onChange={(e) => setHeavyCompression(e.target.checked)}
                  disabled={isDownloading || activeTab === 'image'}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-accent-cyan focus:ring-accent-cyan/50"
                />
                Heavy Compression (H.265)
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                <input
                  type="checkbox"
                  checked={zipOutput}
                  onChange={(e) => setZipOutput(e.target.checked)}
                  disabled={isDownloading}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-accent-cyan focus:ring-accent-cyan/50"
                />
                Zip Output (.zip)
              </label>
            </div>
          )}

          {/* Action Trigger Button */}
          <div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleDownloadClick}
                disabled={isDownloading}
                className={`flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl font-orbitron font-bold text-base text-black transition-all duration-300 ${
                  isDownloading
                    ? 'bg-slate-800 border border-slate-700 text-slate-400 cursor-not-allowed'
                    : isPhoto || activeTab === 'video' || activeTab === 'image'
                      ? 'neon-button-cyan'
                      : 'neon-button-purple'
                }`}
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="animate-pulse">
                      {isPhoto 
                        ? 'Downloading Photo...' 
                        : activeTab === 'image' 
                          ? 'Downloading Thumbnail...' 
                          : 'Downloading...'}
                    </span>
                  </>
                ) : downloadSuccess ? (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    <span>Download Finished!</span>
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    <span>
                      {isPhoto 
                        ? 'Download Photo' 
                        : activeTab === 'image' 
                          ? 'Download Thumbnail' 
                          : 'Start Download'}
                    </span>
                  </>
                )}
              </button>

              {isDownloading && onCancelDownload && (
                <button
                  onClick={onCancelDownload}
                  className="sm:w-1/3 py-4 rounded-2xl font-orbitron font-bold text-base bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:border-rose-500/50 transition-all duration-200"
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="text-[10px] text-center text-slate-500 mt-2.5">
              {isPhoto 
                ? 'Downloads the original high-resolution photo file directly to your workspace.'
                : activeTab === 'image'
                  ? 'Downloads the original video preview thumbnail directly to your workspace.'
                  : 'Downloaded media streams directly to disk. The server will safely convert audio to MP3 using FFmpeg if requested.'}
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}
