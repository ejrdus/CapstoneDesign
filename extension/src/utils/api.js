/**
 * 백엔드 서버 API 통신 유틸리티
 */

const DEFAULT_SERVER_URL = 'http://localhost:3000';

export async function getServerUrl() {
  const data = await chrome.storage.local.get('serverUrl');
  return data.serverUrl || DEFAULT_SERVER_URL;
}

export async function setServerUrl(url) {
  await chrome.storage.local.set({ serverUrl: url });
}
