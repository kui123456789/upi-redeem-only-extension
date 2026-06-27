(function attachBackgroundStep6(root, factory) {
  root.MultiPageBackgroundStep6 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep6Module() {
  const DEFAULT_REGISTRATION_SUCCESS_WAIT_MS = 4000;
  const LOCAL_CPA_JSON_NO_RT_PANEL_MODE = 'local-cpa-json-no-rt';
  const LOCAL_CPA_JSON_EXPORT_NODE_ID = 'local-cpa-json-export';
  const CHATGPT_SESSION_EXPORT_URL = 'https://chatgpt.com/';
  const STEP6_COOKIE_CLEAR_DOMAINS = [
    'chatgpt.com',
    'chat.openai.com',
    'pay.openai.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
    'legacyWallet.com',
    'stripe.com',
    'checkout.stripe.com',
    'meiguodizhi.com',
    'mail-api.yuecheng.shop',
    'yuecheng.shop',
  ];
  const STEP6_COOKIE_CLEAR_ORIGINS = [
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://pay.openai.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://accounts.openai.com',
    'https://openai.com',
    'https://www.legacyWallet.com',
    'https://legacyWallet.com',
    'https://checkout.stripe.com',
    'https://www.meiguodizhi.com',
    'https://meiguodizhi.com',
    'https://mail-api.yuecheng.shop',
  ];

  function normalizeStep6CookieDomain(domain) {
    return String(domain || '').trim().replace(/^\.+/, '').toLowerCase();
  }

  function shouldClearStep6Cookie(cookie) {
    const domain = normalizeStep6CookieDomain(cookie?.domain);
    if (!domain) return false;
    return STEP6_COOKIE_CLEAR_DOMAINS.some((target) => (
      domain === target || domain.endsWith(`.${target}`)
    ));
  }

  function buildStep6CookieRemovalUrl(cookie) {
    const host = normalizeStep6CookieDomain(cookie?.domain);
    const rawPath = String(cookie?.path || '/');
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `https://${host}${path}`;
  }

  async function collectStep6Cookies(chromeApi) {
    if (!chromeApi.cookies?.getAll) {
      return [];
    }

    const stores = chromeApi.cookies.getAllCookieStores
      ? await chromeApi.cookies.getAllCookieStores()
      : [{ id: undefined }];
    const cookies = [];
    const seen = new Set();

    for (const store of stores) {
      const storeId = store?.id;
      const batch = await chromeApi.cookies.getAll(storeId ? { storeId } : {});
      for (const cookie of batch || []) {
        if (!shouldClearStep6Cookie(cookie)) continue;
        const key = [
          cookie.storeId || storeId || '',
          cookie.domain || '',
          cookie.path || '',
          cookie.name || '',
          cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        cookies.push(cookie);
      }
    }

    return cookies;
  }

  async function removeStep6Cookie(chromeApi, cookie, getErrorMessage) {
    const details = {
      url: buildStep6CookieRemovalUrl(cookie),
      name: cookie.name,
    };
    if (cookie.storeId) {
      details.storeId = cookie.storeId;
    }
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }

    try {
      const result = await chromeApi.cookies.remove(details);
      return Boolean(result);
    } catch (error) {
      console.warn('[MultiPage:step6] remove cookie failed', {
        domain: cookie?.domain,
        name: cookie?.name,
        message: getErrorMessage(error),
      });
      return false;
    }
  }

  function createStep6Executor(deps = {}) {
    const {
      addLog = async () => {},
      buildLocalHelperEndpoint = null,
      chrome: chromeApi = globalThis.chrome,
      completeNodeFromBackground,
      createAutomationTab = null,
      createLocalCliProxyApi = null,
      ensureContentScriptReadyOnTab = async () => {},
      getErrorMessage = (error) => error?.message || String(error || '未知错误'),
      getPanelMode = (state = {}) => String(state?.panelMode || '').trim() || 'cpa',
      getTabId = async () => null,
      normalizeHotmailLocalBaseUrl = (value) => String(value || '').trim(),
      registrationSuccessWaitMs = DEFAULT_REGISTRATION_SUCCESS_WAIT_MS,
      sessionExportInjectFiles = ['content/utils.js', 'content/operation-delay.js', 'content/chatgpt-session-reader.js'],
      sendToContentScriptResilient = null,
      sleepWithStop = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
    } = deps;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function isLocalCpaJsonNoRtMode(state = {}) {
      return normalizeString(getPanelMode(state)) === LOCAL_CPA_JSON_NO_RT_PANEL_MODE;
    }

    function getLocalCliProxyApi() {
      const factory = createLocalCliProxyApi
        || globalThis.MultiPageBackgroundLocalCliProxyApi?.createLocalCliProxyApi
        || null;
      if (typeof factory !== 'function') {
        throw new Error('本地 CPA JSON 无RT 模块未加载，无法导出认证文件。');
      }
      return factory({
        crypto: globalThis.crypto,
        fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
        sessionToJsonConverter: globalThis.MultiPageSessionToJsonConverter,
      });
    }

    function formatLocalHelperFetchError(endpoint, helperBaseUrl, error) {
      const originalMessage = normalizeString(error?.message) || 'Failed to fetch';
      return `本地 helper 请求失败：无法连接 ${endpoint}。请检查本地 hotmail-helper 是否启动（运行 start-hotmail-helper.bat），并确认侧边栏“本地助手地址”为 ${helperBaseUrl}。原始错误：${originalMessage}`;
    }

    async function saveLocalCpaJsonArtifactViaHelper(helperBaseUrl, artifact) {
      const endpoint = typeof buildLocalHelperEndpoint === 'function'
        ? buildLocalHelperEndpoint(helperBaseUrl, '/save-auth-json')
        : new URL('/save-auth-json', `${helperBaseUrl.replace(/\/+$/, '')}/`).toString();
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filePath: artifact.filePath,
            directoryPath: artifact.directoryPath,
            content: artifact.jsonText,
          }),
        });
      } catch (error) {
        throw new Error(formatLocalHelperFetchError(endpoint, helperBaseUrl, error));
      }

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok || payload?.ok === false) {
        const helperError = normalizeString(payload?.error);
        if (/Missing email\/clientId\/refreshToken/i.test(helperError)) {
          throw new Error('本地 helper 未识别 /save-auth-json，当前运行的 hotmail_helper.py 版本过旧或不是当前项目目录。请停止旧 helper，并从当前 FlowPilot-FlowPilot1.0.2 目录重新启动本地助手。');
        }
        throw new Error(helperError || `本地 helper 写入失败（HTTP ${response.status}）。`);
      }

      return {
        ...artifact,
        filePath: normalizeString(payload?.filePath) || artifact.filePath,
      };
    }

    async function openChatGptSessionExportTab(state = {}) {
      const createSessionExportTab = typeof createAutomationTab === 'function'
        ? createAutomationTab
        : chromeApi?.tabs?.create?.bind(chromeApi.tabs);

      if (createSessionExportTab) {
        const tab = await createSessionExportTab({
          url: CHATGPT_SESSION_EXPORT_URL,
          active: false,
        });
        const tabId = Number(tab?.id);
        if (Number.isInteger(tabId) && tabId > 0) {
          return {
            source: 'chatgpt-session-reader',
            tabId,
            temporary: true,
          };
        }
      }

      const fallbackTabId = Number(state?.chatgptSessionReaderTabId || await getTabId('chatgpt-session-reader') || await getTabId('signup-page'));
      if (!Number.isInteger(fallbackTabId) || fallbackTabId <= 0) {
        throw new Error('未找到可读取 ChatGPT 会话的标签页，无法导出本地 CPA JSON 无RT。');
      }
      return {
        source: 'chatgpt-session-reader',
        tabId: fallbackTabId,
        temporary: false,
      };
    }

    async function closeTemporarySessionExportTab(tabInfo = {}) {
      if (!tabInfo?.temporary || !Number.isInteger(Number(tabInfo?.tabId)) || !chromeApi?.tabs?.remove) {
        return;
      }
      await chromeApi.tabs.remove(Number(tabInfo.tabId)).catch(() => {});
    }

    async function readChatGptSessionForExport(state = {}, visibleStep = 7) {
      if (typeof sendToContentScriptResilient !== 'function') {
        throw new Error('当前环境缺少 ChatGPT 会话读取通道，无法导出本地 CPA JSON 无RT。');
      }

      const tabInfo = await openChatGptSessionExportTab(state);
      try {
        await ensureContentScriptReadyOnTab(tabInfo.source, tabInfo.tabId, {
          inject: sessionExportInjectFiles,
          injectSource: tabInfo.source,
          timeoutMs: 30000,
          retryDelayMs: 800,
          logMessage: `步骤 ${visibleStep}：正在连接 ChatGPT 页面，准备读取当前会话并导出 JSON...`,
          logStep: visibleStep,
          logStepKey: LOCAL_CPA_JSON_EXPORT_NODE_ID,
        });

        const sessionResult = await sendToContentScriptResilient(tabInfo.source, {
          type: 'READ_CHATGPT_SESSION',
          step: visibleStep,
          source: 'background',
          payload: {
            includeSession: true,
            includeAccessToken: true,
          },
        }, {
          timeoutMs: 15000,
          retryDelayMs: 500,
          logMessage: `步骤 ${visibleStep}：正在等待 ChatGPT 页面返回当前登录会话...`,
          logStep: visibleStep,
          logStepKey: LOCAL_CPA_JSON_EXPORT_NODE_ID,
        });

        if (sessionResult?.error) {
          throw new Error(sessionResult.error);
        }
        return sessionResult;
      } finally {
        await closeTemporarySessionExportTab(tabInfo);
      }
    }

    async function exportLocalCpaJsonNoRt(state = {}, options = {}) {
      const visibleStep = Math.max(1, Math.floor(Number(options.visibleStep) || 7));
      const helperBaseUrl = normalizeHotmailLocalBaseUrl(state.hotmailLocalBaseUrl);
      const pluginDir = normalizeString(state.localCpaJsonPluginDir);
      if (!helperBaseUrl) {
        throw new Error('尚未配置 Hotmail 本地助手地址，请先在侧边栏填写。');
      }
      if (!pluginDir) {
        throw new Error('尚未配置本地插件目录，请先在侧边栏填写。');
      }

      const sessionResult = await readChatGptSessionForExport(state, visibleStep);
      const api = getLocalCliProxyApi();
      const artifact = await api.buildAuthJsonArtifact({
        pluginDir,
        relativeAuthDir: state.localCpaJsonRelativeAuthDir,
        session: sessionResult?.session,
        accessToken: sessionResult?.accessToken,
        sessionToken: sessionResult?.session?.sessionToken,
        email: sessionResult?.email || sessionResult?.session?.user?.email || state?.email,
        expiresAt: sessionResult?.expiresAt || sessionResult?.session?.expires,
        accountId: sessionResult?.session?.account?.id,
        userId: sessionResult?.session?.user?.id,
        planType: sessionResult?.session?.account?.planType,
        lastRefresh: '',
        sourceName: 'SessionToJson Local No RT',
      });

      for (const warning of Array.isArray(artifact.warnings) ? artifact.warnings : []) {
        await addLog(`步骤 ${visibleStep}：${warning}`, 'warn');
      }

      const saved = await saveLocalCpaJsonArtifactViaHelper(helperBaseUrl, artifact);
      const verifiedStatus = `本地CPA JSON 无RT 已导出：${saved.filePath}`;
      await addLog(`步骤 ${visibleStep}：${verifiedStatus}`, 'ok');
      return {
        verifiedStatus,
        localCpaJsonFilePath: saved.filePath,
      };
    }

    async function clearCookiesIfEnabled(state = {}) {
      if (!state?.step6CookieCleanupEnabled) {
        return;
      }
      if (!chromeApi?.cookies?.getAll || !chromeApi.cookies?.remove) {
        await addLog('步骤 6：当前浏览器不支持 cookies API，跳过第六步 Cookies 清理。', 'warn');
        return;
      }

      try {
        await addLog('步骤 6：已开启 Cookies 清理，正在清理 ChatGPT / OpenAI cookies...', 'info');
        const cookies = await collectStep6Cookies(chromeApi);
        let removedCount = 0;
        for (const cookie of cookies) {
          if (await removeStep6Cookie(chromeApi, cookie, getErrorMessage)) {
            removedCount += 1;
          }
        }

        if (chromeApi.browsingData?.removeCookies) {
          try {
            await chromeApi.browsingData.removeCookies({
              since: 0,
              origins: STEP6_COOKIE_CLEAR_ORIGINS,
            });
          } catch (error) {
            await addLog(`步骤 6：browsingData 补扫 cookies 失败：${getErrorMessage(error)}`, 'warn');
          }
        }

        await addLog(`步骤 6：已清理 ${removedCount} 个 ChatGPT / OpenAI cookies。`, 'ok');
      } catch (error) {
        await addLog(`步骤 6：Cookies 清理失败，已跳过并继续后续流程：${getErrorMessage(error)}`, 'warn');
      }
    }

    async function executeStep6(state = {}) {
      const baseWaitMs = Math.max(0, Math.floor(Number(registrationSuccessWaitMs) || 0));
      const waitMs = baseWaitMs;
      if (waitMs > 0) {
        await addLog(`步骤 6：等待 ${Math.round(waitMs / 1000)} 秒，确认注册成功并让页面稳定...`, 'info');
        await sleepWithStop(waitMs);
      }
      await clearCookiesIfEnabled(state);
      await addLog('步骤 6：注册成功等待完成，注册阶段已结束。', 'ok');
      await completeNodeFromBackground('wait-registration-success', {});
    }

    async function executeLocalCpaJsonNoRtExport(state = {}) {
      if (!isLocalCpaJsonNoRtMode(state)) {
        throw new Error('当前不是本地CPA JSON 无RT 模式，不能执行无RT导出节点。');
      }
      await addLog('步骤 7：ChatGPT 会话已就绪，等待 5 秒后导出本地 CPA JSON 无RT...', 'info');
      await sleepWithStop(5000);
      const completionPayload = await exportLocalCpaJsonNoRt(state, { visibleStep: 7 });
      await completeNodeFromBackground(LOCAL_CPA_JSON_EXPORT_NODE_ID, completionPayload);
    }

    return {
      executeLocalCpaJsonNoRtExport,
      executeStep6,
    };
  }

  return { createStep6Executor };
});



