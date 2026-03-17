/**
 * chrome.storage 래퍼
 */

export async function getAnalysisHistory() {
  const data = await chrome.storage.local.get('analysisHistory');
  return data.analysisHistory || [];
}

export async function clearAnalysisHistory() {
  await chrome.storage.local.set({ analysisHistory: [] });
}

export async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || { autoAnalysis: true, showSafe: false };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
