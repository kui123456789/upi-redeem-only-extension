// content/chatgpt-session-reader.js — UPI-only ChatGPT session reader

(() => {
  window.__MULTIPAGE_SOURCE = window.__MULTIPAGE_SOURCE || 'chatgpt-session-reader';
  window.__MULTIPAGE_CHATGPT_SESSION_READER_READY__ = true;

  const DEFAULT_SESSION_API_URL = 'https://chatgpt.com/api/auth/session';

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  async function readChatGptSession(sessionApiUrl = DEFAULT_SESSION_API_URL) {
    const apiUrl = normalizeString(sessionApiUrl) || DEFAULT_SESSION_API_URL;
    const response = await fetch(apiUrl, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    const session = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      session,
      accessToken: session?.accessToken || session?.access_token || '',
      email: session?.user?.email || session?.email || '',
      user: session?.user || null,
    };
  }

  if (!window.__MULTIPAGE_CHATGPT_SESSION_READER_LISTENER_READY__) {
    window.__MULTIPAGE_CHATGPT_SESSION_READER_LISTENER_READY__ = true;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === 'PING') {
        sendResponse({
          ok: true,
          source: window.__MULTIPAGE_SOURCE || 'chatgpt-session-reader',
          chatgptSessionReaderReady: true,
        });
        return;
      }

      if (message?.type !== 'READ_CHATGPT_SESSION') {
        return;
      }

      readChatGptSession(message?.payload?.sessionApiUrl)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({
          ok: false,
          error: error?.message || String(error || '读取 ChatGPT session 失败'),
        }));
      return true;
    });
  }
})();
