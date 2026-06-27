(function attachBackgroundSub2ApiSessionImport(root, factory) {
  root.MultiPageBackgroundSub2ApiSessionImport = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSub2ApiSessionImportModule() {
  const CHATGPT_SESSION_SOURCE = 'chatgpt-session-reader';
  const CHATGPT_SESSION_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/chatgpt-session-reader.js'];
  const SESSION_IMPORT_MAX_ATTEMPTS = 3;
  const SESSION_IMPORT_RETRY_DELAYS_MS = [3000, 7000];
  const SESSION_TAB_COMPLETE_TIMEOUT_MS = 60000;
  const SESSION_CONTENT_READY_TIMEOUT_MS = 45000;
  const SESSION_READ_MESSAGE_TIMEOUT_MS = 30000;
  const SESSION_READ_RESPONSE_TIMEOUT_MS = 15000;
  const SESSION_IMPORT_TIMEOUT_MS = 120000;

  function createSub2ApiSessionImportExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      chrome,
      completeNodeFromBackground,
      ensureContentScriptReadyOnTabUntilStopped,
      getTabId,
      isTabAlive,
      normalizeSub2ApiUrl = (value) => value,
      registerTab,
      sendTabMessageUntilStopped,
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
      waitForTabCompleteUntilStopped = async () => {},
      DEFAULT_SUB2API_GROUP_NAME = 'codex',
    } = deps;

    let sub2ApiApi = null;

    function addStepLog(step, message, level = 'info') {
      return rawAddLog(message, level, {
        step,
        stepKey: 'sub2api-session-import',
      });
    }

    function getSub2ApiApi() {
      if (sub2ApiApi) {
        return sub2ApiApi;
      }
      const factory = deps.createSub2ApiApi
        || self.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi;
      if (typeof factory !== 'function') {
        throw new Error('SUB2API 接口模块未加载，无法导入当前 ChatGPT 会话。');
      }
      sub2ApiApi = factory({
        addLog: rawAddLog,
        normalizeSub2ApiUrl,
        DEFAULT_SUB2API_GROUP_NAME,
      });
      return sub2ApiApi;
    }

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function resolveVisibleStep(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : 10;
    }

    function getErrorMessage(error) {
      return normalizeString(error?.message || error);
    }

    function isRetryableSessionImportError(error) {
      const message = getErrorMessage(error);
      if (!message) {
        return true;
      }
      if (/内容脚本文件加载失败|SUB2API URL is not configured|尚未配置|未配置|格式无效|登录邮箱|登录密码|账号优先级|未找到以下 openai 分组|默认代理.*(?:不存在|匹配到多个)|存在多个可用代理|没有可用代理|返回缺少 access_token|目标分组 ID 无效/i.test(message)) {
        return false;
      }
      return /超时|timeout|timed out|Failed to fetch|NetworkError|Load failed|fetch failed|HTTP 5\d\d|请求失败（HTTP 5\d\d）|Receiving end does not exist|Could not establish connection|message port closed|内容脚本|未就绪|未读取到有效|目标标签页已关闭|页面加载完成/i.test(message);
    }

    async function runSessionImportWithRetries(action, visibleStep) {
      let lastError = null;
      for (let attempt = 1; attempt <= SESSION_IMPORT_MAX_ATTEMPTS; attempt += 1) {
        throwIfStopped();
        try {
          return await action(attempt);
        } catch (error) {
          lastError = error;
          if (attempt >= SESSION_IMPORT_MAX_ATTEMPTS || !isRetryableSessionImportError(error)) {
            throw error;
          }
          const delayMs = SESSION_IMPORT_RETRY_DELAYS_MS[attempt - 1] || SESSION_IMPORT_RETRY_DELAYS_MS[SESSION_IMPORT_RETRY_DELAYS_MS.length - 1];
          await addStepLog(
            visibleStep,
            `SESSION JSON 导入第 ${attempt} 次尝试失败：${getErrorMessage(error) || '未知错误'}。${Math.round(delayMs / 1000)} 秒后自动重试...`,
            'warn'
          );
          await sleepWithStop(delayMs);
        }
      }
      throw lastError || new Error('SESSION JSON 导入重试失败。');
    }

    function isSupportedChatGptSessionUrl(url = '') {
      try {
        const parsed = new URL(String(url || ''));
        if (!/^https?:$/i.test(parsed.protocol)) {
          return false;
        }
        const hostname = String(parsed.hostname || '').trim().toLowerCase();
        return /(^|\.)chatgpt\.com$/.test(hostname)
          || hostname === 'chat.openai.com'
          || /(^|\.)openai\.com$/.test(hostname);
      } catch {
        return false;
      }
    }

    function getSessionTabHostPriority(url = '') {
      try {
        const hostname = String(new URL(String(url || '')).hostname || '').trim().toLowerCase();
        if (/(^|\.)chatgpt\.com$/.test(hostname)) {
          return 0;
        }
        if (hostname === 'chat.openai.com') {
          return 1;
        }
        if (/(^|\.)openai\.com$/.test(hostname)) {
          return 2;
        }
      } catch {
        return Number.POSITIVE_INFINITY;
      }
      return Number.POSITIVE_INFINITY;
    }

    function getSessionTabActivityPriority(tab = {}) {
      if (tab?.active && tab?.currentWindow) {
        return 0;
      }
      if (tab?.active) {
        return 1;
      }
      return 2;
    }

    function pickPreferredSessionTab(tabs = []) {
      const candidates = (Array.isArray(tabs) ? tabs : [])
        .filter((tab) => Number.isInteger(tab?.id) && isSupportedChatGptSessionUrl(tab.url));
      if (!candidates.length) {
        return null;
      }

      return candidates.reduce((best, candidate) => {
        if (!best) {
          return candidate;
        }

        const candidateHostPriority = getSessionTabHostPriority(candidate.url);
        const bestHostPriority = getSessionTabHostPriority(best.url);
        if (candidateHostPriority !== bestHostPriority) {
          return candidateHostPriority < bestHostPriority ? candidate : best;
        }

        const candidateActivityPriority = getSessionTabActivityPriority(candidate);
        const bestActivityPriority = getSessionTabActivityPriority(best);
        if (candidateActivityPriority !== bestActivityPriority) {
          return candidateActivityPriority < bestActivityPriority ? candidate : best;
        }

        const candidateLastAccessed = Number(candidate?.lastAccessed) || 0;
        const bestLastAccessed = Number(best?.lastAccessed) || 0;
        if (candidateLastAccessed !== bestLastAccessed) {
          return candidateLastAccessed > bestLastAccessed ? candidate : best;
        }

        return Number(candidate.id) < Number(best.id) ? candidate : best;
      }, null);
    }

    async function readSupportedSessionTab(tabId) {
      const numericTabId = Number(tabId) || 0;
      if (!numericTabId || !chrome?.tabs?.get) {
        return null;
      }

      const tab = await chrome.tabs.get(numericTabId).catch(() => null);
      return tab?.id && isSupportedChatGptSessionUrl(tab.url)
        ? tab
        : null;
    }

    async function findFallbackSessionTab() {
      if (!chrome?.tabs?.query) {
        return null;
      }

      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const activeMatch = pickPreferredSessionTab(activeTabs);
      const allTabs = await chrome.tabs.query({}).catch(() => []);
      const globalMatch = pickPreferredSessionTab(allTabs);
      return pickPreferredSessionTab([activeMatch, globalMatch]);
    }

    async function resolveSessionTabId(state = {}) {
      const registeredTabId = typeof getTabId === 'function'
        ? await getTabId(CHATGPT_SESSION_SOURCE)
        : null;
      if (registeredTabId && typeof isTabAlive === 'function' && await isTabAlive(CHATGPT_SESSION_SOURCE)) {
        const registeredTab = await readSupportedSessionTab(registeredTabId);
        if (registeredTab?.id) {
          return registeredTab.id;
        }
      }

      const storedTabId = Number(state?.chatgptSessionReaderTabId) || 0;
      const storedTab = await readSupportedSessionTab(storedTabId);
      if (storedTab?.id) {
        if (typeof registerTab === 'function') {
          await registerTab(CHATGPT_SESSION_SOURCE, storedTab.id);
        }
        return storedTab.id;
      }

      const fallbackTab = await findFallbackSessionTab();
      if (fallbackTab?.id) {
        if (typeof registerTab === 'function') {
          await registerTab(CHATGPT_SESSION_SOURCE, fallbackTab.id);
        }
        return fallbackTab.id;
      }

      throw new Error('未找到可读取 ChatGPT 会话的标签页，请先打开一个已登录的 ChatGPT / OpenAI 页面，或完成当前 Plus 支付链路。');
    }

    async function getResolvedSessionTab(tabId, visibleStep) {
      const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
      if (!tab?.id) {
        throw new Error(`步骤 ${visibleStep}：ChatGPT 会话标签页不存在或已关闭，无法继续导入 SUB2API。`);
      }
      if (!isSupportedChatGptSessionUrl(tab.url)) {
        throw new Error(`步骤 ${visibleStep}：当前标签页不在 ChatGPT / OpenAI 页面，无法读取当前登录会话。`);
      }
      return tab;
    }

    async function readCurrentChatGptSession(tabId, visibleStep) {
      await waitForTabCompleteUntilStopped(tabId, {
        timeoutMs: SESSION_TAB_COMPLETE_TIMEOUT_MS,
        retryDelayMs: 300,
      });
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(CHATGPT_SESSION_SOURCE, tabId, {
        inject: CHATGPT_SESSION_INJECT_FILES,
        injectSource: CHATGPT_SESSION_SOURCE,
        timeoutMs: SESSION_CONTENT_READY_TIMEOUT_MS,
        retryDelayMs: 700,
        logMessage: `步骤 ${visibleStep}：正在等待 ChatGPT 会话页完成加载，再继续读取当前登录会话...`,
      });

      const sessionResult = await sendTabMessageUntilStopped(tabId, CHATGPT_SESSION_SOURCE, {
        type: 'READ_CHATGPT_SESSION',
        source: 'background',
        payload: {
          includeSession: true,
          includeAccessToken: true,
        },
      }, {
        timeoutMs: SESSION_READ_MESSAGE_TIMEOUT_MS,
        responseTimeoutMs: SESSION_READ_RESPONSE_TIMEOUT_MS,
        retryDelayMs: 300,
      });
      if (sessionResult?.error) {
        throw new Error(sessionResult.error);
      }

      const session = sessionResult?.session && typeof sessionResult.session === 'object' && !Array.isArray(sessionResult.session)
        ? sessionResult.session
        : null;
      const accessToken = normalizeString(
        sessionResult?.accessToken
        || session?.accessToken
      );
      if (!session && !accessToken) {
        throw new Error(`步骤 ${visibleStep}：未读取到有效的 ChatGPT 会话或 accessToken，请确认当前标签页仍处于已登录状态。`);
      }

      return {
        session,
        accessToken,
      };
    }

    async function executeSub2ApiSessionImport(state = {}) {
      throwIfStopped();
      const visibleStep = resolveVisibleStep(state);
      const api = getSub2ApiApi();

      const result = await runSessionImportWithRetries(async (attempt) => {
        const attemptSuffix = attempt > 1 ? `（第 ${attempt}/${SESSION_IMPORT_MAX_ATTEMPTS} 次尝试）` : '';
        await addStepLog(visibleStep, `正在定位当前 ChatGPT 会话页并准备导入 SUB2API${attemptSuffix}...`, 'info');
        const tabId = await resolveSessionTabId(state);
        const tab = await getResolvedSessionTab(tabId, visibleStep);
        if (chrome?.tabs?.update) {
          await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        }

        await addStepLog(visibleStep, `正在读取当前 ChatGPT 登录会话${attemptSuffix}...`, 'info');
        const sessionState = await readCurrentChatGptSession(tab.id, visibleStep);
        throwIfStopped();

        return api.importCurrentChatGptSession({
          ...state,
          session: sessionState.session,
          accessToken: sessionState.accessToken,
        }, {
          visibleStep,
          logLabel: `步骤 ${visibleStep}`,
          logOptions: { step: visibleStep, stepKey: 'sub2api-session-import' },
          timeoutMs: SESSION_IMPORT_TIMEOUT_MS,
          importTimeoutMs: SESSION_IMPORT_TIMEOUT_MS,
        });
      }, visibleStep);

      await completeNodeFromBackground(state?.nodeId || 'sub2api-session-import', result);
    }

    return {
      executeSub2ApiSessionImport,
      isSupportedChatGptSessionUrl,
    };
  }

  return {
    createSub2ApiSessionImportExecutor,
  };
});



