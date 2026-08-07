/**
 * Renders chat message materials (images, videos, PDFs, and other files).
 */

function dataUrlToBlobUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1).replace(/\s/g, "");
  const mimeMatch = /^data:([^;,]+)/i.exec(header);
  const mime = mimeMatch?.[1]?.trim() || "application/octet-stream";
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function openDataUrlInNewTab(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return false;
  const blobUrl = dataUrlToBlobUrl(dataUrl);
  if (blobUrl) {
    try {
      const win = window.open(blobUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(blobUrl), win ? 120000 : 5000);
      if (win) return true;
    } catch {
      URL.revokeObjectURL(blobUrl);
    }
  }
  try {
    const win = window.open(dataUrl, "_blank", "noopener,noreferrer");
    return Boolean(win);
  } catch {
    return false;
  }
}

function openPdfFromDataUrl(dataUrl, filename = "document.pdf") {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return false;
  const blobUrl = dataUrlToBlobUrl(dataUrl);
  if (!blobUrl) return false;
  try {
    const win = window.open(blobUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      const safeName = /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = safeName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } else {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    }
    return true;
  } catch {
    URL.revokeObjectURL(blobUrl);
    return false;
  }
}

function openFileFromDataUrl(dataUrl, filename = "file") {
  if (openDataUrlInNewTab(dataUrl)) return true;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return false;
  try {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

function OpenInNewTabButton({ onClick, className, label = "Open in new tab" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      title={label}
    >
      {label}
    </button>
  );
}

const VARIANT_STYLES = {
  default: {
    wrap: "mt-2 space-y-2 border-t border-[#EEE8FF] pt-2",
    label: "text-slate-400",
    figure: "border-slate-200/90 bg-slate-50",
    caption: "border-slate-200/80 bg-white text-slate-600",
    fileBox: "border-slate-200/90 bg-slate-50",
    fileTitle: "text-slate-600",
    link: "text-violet-700 decoration-violet-300 hover:text-violet-900",
    imageButton: "hover:opacity-95",
    expiredBox: "border-dashed border-slate-300/90 bg-slate-100/80",
    expiredText: "text-slate-500",
  },
  embed: {
    wrap: "mt-2 space-y-2 border-t border-slate-200/80 pt-2",
    label: "text-slate-400",
    figure: "border-slate-200/90 bg-slate-50",
    caption: "border-slate-200/80 bg-white text-slate-600",
    fileBox: "border-slate-200/90 bg-slate-50",
    fileTitle: "text-slate-600",
    link: "text-violet-700 decoration-violet-300 hover:text-violet-900",
    imageButton: "hover:opacity-95",
    expiredBox: "border-dashed border-slate-300/90 bg-slate-100/80",
    expiredText: "text-slate-500",
  },
  customer: {
    wrap: "mt-2 space-y-2 border-t border-white/25 pt-2",
    label: "text-white/70",
    figure: "border-white/30 bg-white/10",
    caption: "border-white/20 bg-white/15 text-white/90",
    fileBox: "border-white/30 bg-white/10",
    fileTitle: "text-white/90",
    link: "text-white underline decoration-white/50 hover:text-white",
    imageButton: "hover:opacity-90",
    expiredBox: "border-dashed border-white/40 bg-white/10",
    expiredText: "text-white/70",
  },
};

function ExpiredMediaNotice({ label, styles }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${styles.expiredBox}`}>
      <p className={`text-[11px] font-medium ${styles.expiredText}`}>
        {label} — removed after 14 days
      </p>
    </div>
  );
}

export function AssistantAttachments({ attachments, variant = "default" }) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.default;

  return (
    <div className={styles.wrap}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${styles.label}`}>
        Media
      </p>
      <div className="flex flex-col gap-2">
        {attachments.map((a, i) => {
          const key = `${a.kind}-${i}-${a.imageName || a.pdfName || a.videoName || a.fileName || ""}-${a.expired ? "expired" : "active"}`;
          if (a.expired) {
            const expiredLabel =
              a.kind === "image"
                ? a.imageName || "Image"
                : a.kind === "video"
                ? a.videoName || "Video"
                : a.kind === "pdf"
                ? a.pdfName || "PDF"
                : a.fileName || "File";
            return <ExpiredMediaNotice key={key} label={expiredLabel} styles={styles} />;
          }
          if (a.kind === "image" && typeof a.imageData === "string" && a.imageData.startsWith("data:image/")) {
            const label = a.imageName || "Image";
            return (
              <figure key={key} className={`overflow-hidden rounded-lg border ${styles.figure}`}>
                {a.productTitle ? (
                  <figcaption
                    className={`truncate border-b px-2 py-1 text-[11px] font-medium ${styles.caption}`}
                  >
                    {a.productTitle}
                  </figcaption>
                ) : null}
                <button
                  type="button"
                  onClick={() => openDataUrlInNewTab(a.imageData)}
                  className={`block w-full cursor-zoom-in ${styles.imageButton}`}
                  title={`Open ${label} in new tab`}
                >
                  <img
                    src={a.imageData}
                    alt={label}
                    className="max-h-52 w-full object-contain"
                    loading="lazy"
                  />
                </button>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  {a.imageName ? (
                    <p className={`truncate text-[10px] ${styles.fileTitle}`}>{a.imageName}</p>
                  ) : (
                    <span />
                  )}
                  <OpenInNewTabButton
                    onClick={() => openDataUrlInNewTab(a.imageData)}
                    className={`shrink-0 text-[11px] font-semibold underline underline-offset-2 ${styles.link}`}
                  />
                </div>
              </figure>
            );
          }
          if (
            a.kind === "video" &&
            typeof a.videoData === "string" &&
            a.videoData.startsWith("data:video/")
          ) {
            return (
              <figure key={key} className={`overflow-hidden rounded-lg border ${styles.figure}`}>
                <video
                  src={a.videoData}
                  controls
                  className="max-h-52 w-full bg-black object-contain"
                  preload="metadata"
                >
                  <track kind="captions" />
                </video>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <p className={`truncate text-[10px] ${styles.fileTitle}`}>{a.videoName || "Video"}</p>
                  <OpenInNewTabButton
                    onClick={() => openDataUrlInNewTab(a.videoData)}
                    className={`shrink-0 text-[11px] font-semibold underline underline-offset-2 ${styles.link}`}
                  />
                </div>
              </figure>
            );
          }
          if (a.kind === "pdf" && typeof a.pdfData === "string" && /^data:application\/(pdf|x-pdf)/i.test(a.pdfData)) {
            const label = a.pdfName || "PDF";
            return (
              <div key={key} className={`rounded-lg border px-2 py-2 ${styles.fileBox}`}>
                {a.productTitle ? (
                  <p className={`mb-1 truncate text-[11px] font-medium ${styles.fileTitle}`}>
                    {a.productTitle}
                  </p>
                ) : null}
                <OpenInNewTabButton
                  onClick={() => openPdfFromDataUrl(a.pdfData, label)}
                  className={`text-left text-sm font-semibold underline underline-offset-2 ${styles.link}`}
                  label={`Open ${label} in new tab`}
                />
              </div>
            );
          }
          if (a.kind === "file" && typeof a.fileData === "string" && a.fileData.startsWith("data:")) {
            const label = a.fileName || "File";
            return (
              <div key={key} className={`rounded-lg border px-2 py-2 ${styles.fileBox}`}>
                <OpenInNewTabButton
                  onClick={() => openFileFromDataUrl(a.fileData, label)}
                  className={`text-left text-sm font-semibold underline underline-offset-2 ${styles.link}`}
                  label={`Open ${label} in new tab`}
                />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
