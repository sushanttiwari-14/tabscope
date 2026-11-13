import { t, setMessages, type MessageKey } from "./i18n";
// Offscreen documents expose only chrome.runtime. The trusted worker supplies
// this bounded set of Chrome-localized templates; no browsing content is involved.
const keys = [
  "pdf_replacement_characters",
  "download_only_pdfs_cannot_be_searched_safely",
  "empty_pdf_response",
  "indexing_pdf",
  "no_searchable_text_found_scanned_pdfs_are_not_supported",
  "password_protected_pdfs_are_not_supported",
  "pdf_could_not_be_fetched_http",
  "pdf_exceeds_the_12_mb_limit",
  "pdf_extraction_failed",
  "pdf_indexing_canceled",
  "pdf_indexing_canceled_or_timed_out",
  "pdf_parser_busy_retry_shortly",
  "pdf_progress",
  "pdf_progress_limited",
  "pdf_progress_missing",
  "the_response_is_not_a_valid_pdf",
  "the_server_did_not_return_a_pdf",
  "this_pdf_does_not_allow_text_extraction",
] as const satisfies readonly MessageKey[];
export function pdfMessages(): [MessageKey, string][] {
  return keys.map((key) => [
    key,
    t(key, [
      "__TABSCOPE_VALUE_1__",
      "__TABSCOPE_VALUE_2__",
      "__TABSCOPE_VALUE_3__",
    ]),
  ]);
}
export function acceptPDFMessages(value: unknown) {
  if (!Array.isArray(value) || value.length > keys.length) return;
  const accepted: [MessageKey, string][] = [];
  for (const pair of value) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !keys.includes(pair[0]) ||
      typeof pair[1] !== "string" ||
      pair[1].length > 2000
    )
      return;
    accepted.push([pair[0], pair[1]]);
  }
  setMessages(accepted);
}
