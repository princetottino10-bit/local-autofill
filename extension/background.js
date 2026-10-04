import { fillTab } from './lib/fill-tab.js';

// キーボードショートカット（初期値 Alt+Shift+F / Mac は Option+Shift+F）で入力
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-form' || !tab?.id) return;
  let text = '';
  try {
    const res = await fillTab(tab.id);
    text = res?.error ? '!' : String(res.fields.filter((f) => f.status === 'filled').length);
  } catch {
    text = '×';
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#1f9d6b', tabId: tab.id });
  await chrome.action.setBadgeText({ text, tabId: tab.id });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 4000);
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
