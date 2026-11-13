import english from "../_locales/en/messages.json";
declare const __TABSCOPE_PRODUCTION__: boolean;
export type MessageKey = keyof typeof english;
const fallback =
  typeof __TABSCOPE_PRODUCTION__ === "undefined" || !__TABSCOPE_PRODUCTION__
    ? english
    : undefined;
const supplied = new Map<MessageKey, string>();
export function setMessages(messages: [MessageKey, string][]) {
  supplied.clear();
  for (const [key, template] of messages) supplied.set(key, template);
}
// Chrome supplies the shipped English catalog. The fallback also makes unit tests deterministic.
export function t(key: MessageKey, values: unknown[] = []): string {
  const args = values.map(String);
  const translated =
    typeof chrome !== "undefined"
      ? chrome.i18n?.getMessage(key, args)
      : undefined;
  if (translated) return translated;
  const template = supplied.get(key);
  if (template)
    return template.replace(
      /__TABSCOPE_VALUE_(\d+)__/g,
      (_, n: string) => args[Number(n) - 1] ?? "",
    );
  // The English fallback is test-only and tree-shaken from Chrome bundles.
  const entry = fallback?.[key];
  return (
    entry?.message.replace(
      /\$value(\d+)\$/g,
      (_, n: string) => args[Number(n) - 1] ?? "",
    ) ?? key
  );
}
