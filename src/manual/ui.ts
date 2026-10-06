import type { Language } from "../i18n";
import type { SceneSnapshot } from "./plan";
import "./manual.css";

const labels = {
  en: {
    download: "Download manual",
    preparing: "Preparing your manual…",
    pages: "Rendering page",
    of: "of",
    cancel: "Cancel",
    close: "Close",
    ready: "Your building manual is ready.",
    again: "Download PDF",
    empty: "Add some bricks before downloading a manual.",
    error: "Could not create the PDF. Please try again.",
    snapshot: "Your manual uses the scene as it was when you clicked Download.",
  },
  tr: {
    download: "Manual’i indir",
    preparing: "Yapım kılavuzu hazırlanıyor…",
    pages: "Sayfa hazırlanıyor",
    of: "/",
    cancel: "İptal",
    close: "Kapat",
    ready: "Yapım kılavuzun hazır.",
    again: "PDF’i indir",
    empty: "Kılavuz indirmek için önce birkaç parça ekle.",
    error: "PDF oluşturulamadı. Lütfen tekrar dene.",
    snapshot: "Kılavuz, indir düğmesine bastığın andaki sahneyi kullanır.",
  },
};

/** Export a detached snapshot; physics, selection and camera remain interactive. */
export function setupManual(options: {
  snapshot(): SceneSnapshot;
  language(): Language;
  toast(message: string): void;
}) {
  const button = document.createElement("button");
  button.id = "manual";
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h6"/></svg><span class="manual-label"></span><span class="manual-short" aria-hidden="true">PDF</span>';
  document.querySelector("#save")!.before(button);
  const panel = document.createElement("aside");
  panel.id = "manual-progress";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "manual-status");
  panel.innerHTML =
    '<strong id="manual-status" role="status" aria-live="polite"></strong><progress id="manual-bar" max="1" value="0"></progress><p id="manual-note"></p><div class="manual-actions"><button id="manual-cancel"></button><a id="manual-download" download="my-bricks-manual.pdf" hidden></a><button id="manual-close" hidden></button></div>';
  document.body.append(panel);
  const status = panel.querySelector<HTMLElement>("#manual-status")!;
  const bar = panel.querySelector<HTMLProgressElement>("#manual-bar")!;
  const cancel = panel.querySelector<HTMLButtonElement>("#manual-cancel")!;
  const close = panel.querySelector<HTMLButtonElement>("#manual-close")!;
  const link = panel.querySelector<HTMLAnchorElement>("#manual-download")!;
  let controller: AbortController | undefined;
  let downloadUrl: string | undefined;
  let progress: { completed: number; total: number } | undefined;
  let restoreFocus = false;
  const text = () => labels[options.language()];

  // Preserve native button/link keyboard activation instead of letting the
  // workspace's Space/Delete/Q/E shortcuts handle a focused export control.
  // Keyup still reaches the workspace to release any previously held keys.
  button.addEventListener("keydown", (event) => event.stopPropagation());
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  });

  function translate() {
    const t = text();
    button.querySelector(".manual-label")!.textContent = t.download;
    button.setAttribute("aria-label", t.download);
    button.title = t.download;
    cancel.textContent = t.cancel;
    close.textContent = t.close;
    link.textContent = t.again;
    bar.setAttribute("aria-label", t.preparing);
    panel.querySelector("#manual-note")!.textContent = t.snapshot;
    status.textContent = controller
      ? progress
        ? `${t.pages} ${progress.completed} ${t.of} ${progress.total}`
        : t.preparing
      : t.ready;
  }

  function releaseDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
    link.removeAttribute("href");
  }
  function dismiss() {
    restoreFocus = true;
    controller?.abort();
    panel.hidden = true;
    releaseDownload();
    if (!controller) {
      button.focus({ preventScroll: true });
      restoreFocus = false;
    }
  }
  cancel.onclick = dismiss;
  close.onclick = dismiss;
  window.addEventListener("pagehide", () => {
    controller?.abort();
    releaseDownload();
  });

  button.onclick = async (event) => {
    if (controller) return;
    const snapshot = options.snapshot();
    if (!snapshot.bricks.length) return options.toast(text().empty);
    releaseDownload();
    const job = new AbortController();
    controller = job;
    progress = undefined;
    restoreFocus = false;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    panel.hidden = false;
    bar.hidden = false;
    bar.value = 0;
    cancel.hidden = false;
    close.hidden = true;
    link.hidden = true;
    translate();
    if (event.detail === 0) cancel.focus({ preventScroll: true });
    try {
      // Code, fonts and document rendering load only when the feature is used.
      const { generateManual } = await import("./pdf");
      job.signal.throwIfAborted();
      const blob = await generateManual(snapshot, {
        language: options.language(),
        signal: job.signal,
        onProgress(value) {
          if (job.signal.aborted) return;
          progress = value;
          bar.max = value.total;
          bar.value = value.completed;
          translate();
        },
      });
      job.signal.throwIfAborted();
      downloadUrl = URL.createObjectURL(blob);
      link.href = downloadUrl;
      link.hidden = false;
      close.hidden = false;
      bar.hidden = true;
      // Keep the same usable link in the panel for browsers requiring a fresh
      // user gesture after async rendering, and for an intentional second download.
      link.click();
    } catch (error) {
      restoreFocus ||= document.activeElement === cancel;
      panel.hidden = true;
      if (!job.signal.aborted) {
        console.error("Manual export failed", error);
        options.toast(text().error);
      }
    } finally {
      const cancelFocused = document.activeElement === cancel;
      controller = undefined;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      cancel.hidden = true;
      translate();
      if (restoreFocus) {
        button.focus({ preventScroll: true });
        restoreFocus = false;
      } else if (cancelFocused && !panel.hidden) {
        link.focus({ preventScroll: true });
      }
    }
  };
  translate();
  return { translate };
}
