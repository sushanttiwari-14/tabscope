import { acceptPDFMessages } from "./pdf-messages";
import { safeEnd } from "./analysis";
import { t } from "./i18n";
import {
  getDocument,
  GlobalWorkerOptions,
  PermissionFlag,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfPageTextResult, PDF_LIMITS, type PDFTextItem } from "./pdf";
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
  acceptPDFMessages(m.messages);
  if (active) {
    reply({ error: t("pdf_parser_busy_retry_shortly") });
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
      throw Error(t("pdf_could_not_be_fetched_http", [response.status]));
    if (/attachment/i.test(response.headers.get("content-disposition") ?? ""))
      throw Error(t("download_only_pdfs_cannot_be_searched_safely"));
    if (
      !/^(application\/pdf|application\/octet-stream)(?:;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw Error(t("the_server_did_not_return_a_pdf"));
    if (Number(response.headers.get("content-length")) > PDF_LIMITS.bytes)
      throw Error(t("pdf_exceeds_the_12_mb_limit"));
    const reader = response.body?.getReader();
    if (!reader) throw Error(t("empty_pdf_response"));
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > PDF_LIMITS.bytes) {
        await reader.cancel();
        throw Error(t("pdf_exceeds_the_12_mb_limit"));
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
      throw Error(t("the_response_is_not_a_valid_pdf"));
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
      throw Error(t("this_pdf_does_not_allow_text_extraction"));
    const labels = await pdf.getPageLabels();
    const info: PDFInfo = {
      pages: [],
      total: pdf.numPages,
      searched: 0,
      textPages: 0,
      identity: pdf.fingerprints[0] ?? undefined,
      status: t("indexing_pdf"),
    };
    let text = "";
    for (let n = 1; n <= Math.min(pdf.numPages, PDF_LIMITS.pages); n++) {
      if (job.controller.signal.aborted)
        throw Error(t("pdf_indexing_canceled_or_timed_out"));
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const extracted = pdfPageTextResult(
        content.items.filter((x): x is PDFTextItem & typeof x => "str" in x),
      );
      const pageText = extracted.text;
      if (/[\ufffd\ud800-\udfff]/u.test(pageText))
        info.replacementCharacters = true;
      if (text.length > PDF_LIMITS.text - 3) break;
      const separator = text ? "\n\f\n" : "";
      const start = text.length + separator.length;
      const selected = safeEnd(pageText, Math.max(0, PDF_LIMITS.text - start));
      text += separator + selected;
      if (
        extracted.truncated ||
        selected.length < pageText.length ||
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
      info.status = t(
        info.textPages < n ? "pdf_progress_missing" : "pdf_progress",
        [n, pdf.numPages, n - info.textPages],
      );
      const committed = await chrome.runtime.sendMessage({
        type: "pdf-progress",
        token: m.token,
        text,
        info,
        done: false,
      });
      if (committed !== true) throw Error(t("pdf_indexing_canceled"));
      page.cleanup();
      if (text.length >= PDF_LIMITS.text) break;
    }
    if (info.truncated)
      info.status = t("pdf_progress_limited", [
        info.searched,
        info.total,
        info.searched - info.textPages,
      ]);
    if (!info.textPages)
      info.status = t(
        "no_searchable_text_found_scanned_pdfs_are_not_supported",
      );
    if (info.replacementCharacters)
      info.status = t("pdf_replacement_characters", [
        info.searched,
        info.total,
      ]);
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
            ? t("password_protected_pdfs_are_not_supported")
            : canceled
              ? t("pdf_indexing_canceled_or_timed_out")
              : e instanceof Error
                ? e.message
                : t("pdf_extraction_failed"),
      }),
    );
  return true;
});
