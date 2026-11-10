import {
  getDocument,
  GlobalWorkerOptions,
  PermissionFlag,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfPageText, PDF_LIMITS, type PDFTextItem } from "./pdf";
import type { PDFInfo } from "./types";
GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.mjs");
let active:
  | {
      token: string;
      controller: AbortController;
      destroy?: () => Promise<void>;
    }
  | undefined;
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    sender.url?.split("?")[0] !== chrome.runtime.getURL("background.js")
  )
    return;
  if (m?.type === "pdf-cancel") {
    if (active && active.token === m.token) {
      active.controller.abort();
      void active.destroy?.();
    }
    return;
  }
  if (
    m?.type !== "pdf-extract" ||
    typeof m.url !== "string" ||
    !/^https?:\/\//.test(m.url) ||
    typeof m.token !== "string"
  )
    return;
  if (active) {
    reply({ error: "PDF parser busy. Retry shortly." });
    return;
  }
  const job = {
    token: m.token,
    controller: new AbortController(),
    destroy: undefined as (() => Promise<void>) | undefined,
  };
  active = job;
  const timeout = setTimeout(() => {
    job.controller.abort();
    void job.destroy?.();
  }, PDF_LIMITS.ms);
  let canceled = false;
  void (async () => {
    // Never follow a redirect into a host whose permission was not checked.
    const response = await fetch(m.url, {
      signal: job.controller.signal,
      redirect: "error",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok)
      throw Error(`PDF could not be fetched (HTTP ${response.status}).`);
    if (/attachment/i.test(response.headers.get("content-disposition") ?? ""))
      throw Error("Download-only PDFs cannot be searched safely.");
    if (
      !/^(application\/pdf|application\/octet-stream)(?:;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw Error("The server did not return a PDF.");
    if (Number(response.headers.get("content-length")) > PDF_LIMITS.bytes)
      throw Error("PDF exceeds the 12 MB limit.");
    const reader = response.body?.getReader();
    if (!reader) throw Error("Empty PDF response.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > PDF_LIMITS.bytes) {
        await reader.cancel();
        throw Error("PDF exceeds the 12 MB limit.");
      }
      chunks.push(value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    chunks.length = 0;
    if (!new TextDecoder().decode(data.slice(0, 1024)).includes("%PDF-"))
      throw Error("The response is not a valid PDF.");
    const task = getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
      useWasm: false,
      useWorkerFetch: false,
    });
    job.destroy = () => task.destroy();
    const pdf = await task.promise;
    const permissions = await pdf.getPermissions();
    if (permissions && !permissions.has(PermissionFlag.COPY))
      throw Error("This PDF does not allow text extraction.");
    const labels = await pdf.getPageLabels();
    const info: PDFInfo = {
      pages: [],
      total: pdf.numPages,
      searched: 0,
      textPages: 0,
      identity: pdf.fingerprints[0] ?? undefined,
      status: "Indexing PDF…",
    };
    let text = "";
    for (let n = 1; n <= Math.min(pdf.numPages, PDF_LIMITS.pages); n++) {
      if (job.controller.signal.aborted)
        throw Error("PDF indexing canceled or timed out.");
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const pageText = pdfPageText(
        content.items.filter((x): x is PDFTextItem & typeof x => "str" in x),
      );
      if (text.length > PDF_LIMITS.text - 3) break;
      const separator = text ? "\n\f\n" : "";
      const start = text.length + separator.length;
      text +=
        separator + pageText.slice(0, Math.max(0, PDF_LIMITS.text - start));
      if (
        content.items.length > 20_000 ||
        pageText.length >= PDF_LIMITS.text ||
        text.length >= PDF_LIMITS.text
      )
        info.truncated = true;
      info.pages.push({
        page: n,
        label: labels?.[n - 1]?.slice(0, 128),
        start,
        end: text.length,
      });
      info.searched = n;
      if (pageText.trim()) info.textPages++;
      info.status = `Searched ${n} of ${pdf.numPages} pages${info.textPages < n ? ` · ${n - info.textPages} pages without text` : ""}`;
      const committed = await chrome.runtime.sendMessage({
        type: "pdf-progress",
        token: m.token,
        text,
        info,
        done: false,
      });
      if (committed !== true) throw Error("PDF indexing canceled.");
      page.cleanup();
      if (text.length >= PDF_LIMITS.text) break;
    }
    if (info.truncated) info.status += " · text limit reached";
    if (!info.textPages)
      info.status =
        "No searchable text found. Scanned PDFs are not supported yet.";
    await chrome.runtime.sendMessage({
      type: "pdf-progress",
      token: m.token,
      text,
      info,
      done: true,
    });
    return { ok: true };
  })()
    .finally(async () => {
      clearTimeout(timeout);
      canceled = job.controller.signal.aborted;
      job.controller.abort();
      await job.destroy?.().catch(() => {});
      if (active === job) active = undefined;
    })
    .then(reply, (e) =>
      reply({
        error:
          e?.name === "PasswordException"
            ? "Password-protected PDFs are not supported."
            : canceled
              ? "PDF indexing canceled or timed out."
              : e instanceof Error
                ? e.message
                : "PDF extraction failed.",
      }),
    );
  return true;
});
