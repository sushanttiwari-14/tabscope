const EXPLAINED_KEY = "contentAccessExplained";
const ALL_WEBSITES = ["http://*/*", "https://*/*"];

export async function shouldExplainAccess(): Promise<boolean> {
  const [saved, granted] = await Promise.all([
    chrome.storage.local.get(EXPLAINED_KEY),
    chrome.permissions.contains({ origins: ALL_WEBSITES }),
  ]);
  return saved[EXPLAINED_KEY] !== true && !granted;
}

export async function dismissAccessExplanation(): Promise<void> {
  await chrome.storage.local.set({ [EXPLAINED_KEY]: true });
}

export async function allowAllWebsites(): Promise<boolean> {
  // Call before any await: Chrome must see the original button's user gesture.
  const granted = await chrome.permissions.request({ origins: ALL_WEBSITES });
  await dismissAccessExplanation();
  return granted;
}
