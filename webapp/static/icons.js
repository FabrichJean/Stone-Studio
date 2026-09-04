const ICONS = {
  headphones: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9V8a6 6 0 0 1 12 0v1"/><rect x="1.5" y="9" width="3" height="4" rx="1"/><rect x="11.5" y="9" width="3" height="4" rx="1"/></svg>`,
  scissors: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="1.6"/><circle cx="4" cy="12" r="1.6"/><path d="M5.3 5L14 14M5.3 11L14 2"/></svg>`,
  upload: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5V4.5M4.5 7.5L8 4l3.5 3.5"/><path d="M3 13.5h10"/></svg>`,
  download: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5"/><path d="M3 13.5h10"/></svg>`,
  play: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M4.5 2.7v10.6a.5.5 0 0 0 .77.42l8.4-5.3a.5.5 0 0 0 0-.84l-8.4-5.3a.5.5 0 0 0-.77.42z"/></svg>`,
  plus: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>`,
  close: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  folder: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.2 1.5h5.2A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7z"/></svg>`,
  speed: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l5 4-5 4"/><path d="M9 4l5 4-5 4"/></svg>`,
  pause: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>`,
  noise: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h2l2-4v8l2-4h2l2 3v-6l2 3"/></svg>`,
  record: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 14h4M8 11v3"/><circle cx="8" cy="7" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  orientation: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="8.5" rx="1.3"/><path d="M6 13.5h4M8 11v2.5"/></svg>`,
  compress: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v3a1 1 0 0 1-1 1H2M10 2v3a1 1 0 0 0 1 1h3M6 14v-3a1 1 0 0 0-1-1H2M10 14v-3a1 1 0 0 1 1-1h3"/></svg>`,
};

function iconHtml(name, extraClass = "") {
  return `<span class="icon${extraClass ? " " + extraClass : ""}">${ICONS[name] || ""}</span>`;
}

const TOOL_ICONS = {
  extract_audio: ICONS.headphones,
  trim_media: ICONS.scissors,
  speed_media: ICONS.speed,
  orientation: ICONS.orientation,
  screen_record: ICONS.record,
  noise_removal: ICONS.noise,
  compress_media: ICONS.compress,
  upload: ICONS.upload,
};

const TOOL_DESTINATIONS = [
  { key: "extract_audio", path: "/", label: "Extraction audio", icon: "headphones" },
  { key: "trim_media", path: "/trim", label: "Trim media", icon: "scissors" },
  { key: "speed_media", path: "/speed", label: "Speed", icon: "speed" },
  { key: "orientation", path: "/orientation", label: "Orientation", icon: "orientation" },
  { key: "compress_media", path: "/compress", label: "Compression vidéo", icon: "compress" },
  { key: "noise_removal", path: "/noise-removal", label: "Suppression bruit", icon: "noise" },
];
