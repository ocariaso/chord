export function DownloadTrayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M12 3v11" strokeLinecap="round" />
      <path d="M7.5 10.5 12 15l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" strokeLinecap="round" />
    </svg>
  );
}

export function UploadTrayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M12 20V9" strokeLinecap="round" />
      <path d="M7.5 13.5 12 9l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 4h14" strokeLinecap="round" />
    </svg>
  );
}
