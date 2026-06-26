(function attachBackgroundPanelBridge(root, factory) {
  root.MultiPageBackgroundPanelBridge = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPanelBridgeModule() {
  function createPanelBridge(deps = {}) {
    const {
      chrome,
      addLog,
      createLocalCliProxyApi = null,
      closeConflictingTabsForSource,
      createAutomationTab = null,
      ensureContentScriptReadyOnTab,
      getPanelMode,
      normalizeCodex2ApiUrl,
      normalizeSub2ApiUrl,
      rememberSourceLastUrl,
      sendToContentScript,
      sendToContentScriptResilient,
      waitForTabUrlFamily,
      DEFAULT_SUB2API_GROUP_NAME,
      SUB2API_STEP1_RESPONSE_TIMEOUT_MS,
    } = deps;

    let sub2ApiApi = null;
    let localCliProxyApi = null;

    function getSub2ApiApi() {
      if (sub2ApiApi) {
        return sub2ApiApi;
      }
      const factory = deps.createSub2ApiApi
        || self.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi;
      if (typeof factory !== 'function') {
        throw new Error('SUB2API 直连接口模块未加载，无法生成 OAuth 链接。');
      }
      sub2ApiApi = factory({
        addLog,
        normalizeSub2ApiUrl,
        DEFAULT_SUB2API_GROUP_NAME,
      });
      return sub2ApiApi;
    }

    function normalizeAdminKey(value = '') {
      return String(value || '').trim();
    }

    function getLocalCliProxyApi() {
      if (localCliProxyApi) {
        return localCliProxyApi;
      }
      const factory = createLocalCliProxyApi
        || self.MultiPageBackgroundLocalCliProxyApi?.createLocalCliProxyApi;
      if (typeof factory !== 'function') {
        throw new Error('本地 CPA JSON 有RT 模块未加载，无法生成 OAuth 链接。');
      }
      localCliProxyApi = factory({
        crypto: globalThis.crypto,
        fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
        sessionToJsonConverter: self.MultiPageSessionToJsonConverter,
      });
      return localCliProxyApi;
    }

    function extractStateFromAuthUrl(authUrl = '') {
      try {
        return new URL(authUrl).searchParams.get('state') || '';
      } catch {
        return '';
      }
    }

    function getCodex2ApiErrorMessage(payload, responseStatus = 500) {
      const candidates = [
        payload?.error,
        payload?.message,
        payload?.detail,
        payload?.reason,
      ];
      const message = candidates
        .map((value) => String(value || '').trim())
        .find(Boolean);
      return message || `Codex2API 请求失败（HTTP ${responseStatus}）。`;
    }

    function deriveCpaManagementOrigin(vpsUrl) {
      const normalizedUrl = String(vpsUrl || '').trim();
      if (!normalizedUrl) {
        throw new Error('尚未配置 CPA 地址，请先在侧边栏填写。');
      }
      let parsed;
      try {
        parsed = new URL(normalizedUrl);
      } catch {
        throw new Error('CPA 地址格式无效，请先在侧边栏检查。');
      }
      return parsed.origin;
    }

    function getCpaApiErrorMessage(payload, responseStatus = 500) {
      const candidates = [
        payload?.error,
        payload?.message,
        payload?.detail,
        payload?.reason,
      ];
      const message = candidates
        .map((value) => String(value || '').trim())
        .find(Boolean);
      return message || `CPA 管理接口请求失败（HTTP ${responseStatus}）。`;
    }

    async function fetchCpaManagementJson(origin, path, options = {}) {
      const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 20000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const managementKey = String(options.managementKey || '').trim();
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (managementKey) {
          headers.Authorization = `Bearer ${managementKey}`;
          headers['X-Management-Key'] = managementKey;
        }

        const response = await fetch(`${origin}${path}`, {
          method: options.method || 'POST',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        let payload = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(getCpaApiErrorMessage(payload, response.status));
        }

        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('CPA 管理接口请求超时，请稍后重试。');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function fetchCodex2ApiJson(origin, path, options = {}) {
      const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 30000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${origin}${path}`, {
          method: options.method || 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Admin-Key': normalizeAdminKey(options.adminKey),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        let payload = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(getCodex2ApiErrorMessage(payload, response.status));
        }

        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('Codex2API 请求超时，请稍后重试。');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function requestOAuthUrlFromPanel(state, options = {}) {
      if (getPanelMode(state) === 'local-cpa-json') {
        return requestLocalCpaJsonOAuthUrl(state, options);
      }
      if (getPanelMode(state) === 'codex2api') {
        return requestCodex2ApiOAuthUrl(state, options);
      }
      if (getPanelMode(state) === 'sub2api') {
        return requestSub2ApiOAuthUrl(state, options);
      }
      return requestCpaOAuthUrl(state, options);
    }

    async function requestCpaOAuthUrl(state, options = {}) {
      const { logLabel = 'OAuth 刷新' } = options;
      if (!state.vpsUrl) {
        throw new Error('尚未配置 CPA 地址，请先在侧边栏填写。');
      }
      const managementKey = String(state.vpsPassword || '').trim();
      if (!managementKey) {
        throw new Error('尚未配置 CPA 管理密钥，请先在侧边栏填写。');
      }

      const origin = deriveCpaManagementOrigin(state.vpsUrl);

      await addLog(`${logLabel}：正在通过 CPA 管理接口获取 OAuth 授权链接...`);
      const result = await fetchCpaManagementJson(origin, '/v0/management/codex-auth-url', {
        method: 'GET',
        managementKey,
      });

      const oauthUrl = String(
        result?.url
        || result?.auth_url
        || result?.authUrl
        || result?.data?.url
        || result?.data?.auth_url
        || result?.data?.authUrl
        || ''
      ).trim();
      const oauthState = String(
        result?.state
        || result?.auth_state
        || result?.authState
        || result?.data?.state
        || result?.data?.auth_state
        || result?.data?.authState
        || ''
      ).trim()
        || extractStateFromAuthUrl(oauthUrl);

      if (!oauthUrl || !oauthUrl.startsWith('http')) {
        throw new Error('CPA 管理接口未返回有效的 auth_url。');
      }

      return {
        oauthUrl,
        cpaOAuthState: oauthState || null,
        cpaManagementOrigin: origin,
      };
    }

    async function requestLocalCpaJsonOAuthUrl(state, options = {}) {
      const { logLabel = 'OAuth 刷新' } = options;
      if (!String(state?.localCpaJsonPluginDir || '').trim()) {
        throw new Error('尚未配置本地插件目录，请先在侧边栏填写。');
      }

      await addLog(`${logLabel}：正在按本地 CPA JSON 有RT 规则生成 OAuth 授权链接...`);
      const api = getLocalCliProxyApi();
      const result = await api.createAuthorizationRequest();

      return {
        oauthUrl: result.oauthUrl,
        localCpaJsonOAuthState: result.oauthState || null,
        localCpaJsonPkceCodes: result.pkceCodes || null,
      };
    }

    async function requestCodex2ApiOAuthUrl(state, options = {}) {
      const { logLabel = 'OAuth 刷新' } = options;
      const codex2apiUrl = normalizeCodex2ApiUrl(state.codex2apiUrl);
      const adminKey = normalizeAdminKey(state.codex2apiAdminKey);

      if (!adminKey) {
        throw new Error('尚未配置 Codex2API 管理密钥，请先在侧边栏填写。');
      }

      const origin = new URL(codex2apiUrl).origin;
      await addLog(`${logLabel}：正在通过 Codex2API 协议生成 OAuth 授权链接...`);

      const result = await fetchCodex2ApiJson(origin, '/api/admin/oauth/generate-auth-url', {
        adminKey,
        method: 'POST',
        body: {},
      });

      const oauthUrl = String(result?.auth_url || result?.authUrl || '').trim();
      const sessionId = String(result?.session_id || result?.sessionId || '').trim();
      const oauthState = extractStateFromAuthUrl(oauthUrl);

      if (!oauthUrl || !sessionId) {
        throw new Error('Codex2API 未返回有效的 auth_url 或 session_id。');
      }

      return {
        oauthUrl,
        codex2apiSessionId: sessionId,
        codex2apiOAuthState: oauthState || null,
      };
    }

    async function requestSub2ApiOAuthUrl(state, options = {}) {
      const { logLabel = 'OAuth 刷新' } = options;
      const sub2apiUrl = normalizeSub2ApiUrl(state.sub2apiUrl);

      if (!sub2apiUrl) {
        throw new Error('SUB2API URL is not configured. Please fill it in the side panel first.');
      }
      if (!state.sub2apiEmail) {
        throw new Error('尚未配置 SUB2API 登录邮箱，请先在侧边栏填写。');
      }
      if (!state.sub2apiPassword) {
        throw new Error('尚未配置 SUB2API 登录密码，请先在侧边栏填写。');
      }

      const api = getSub2ApiApi();
      return api.generateOpenAiAuthUrl({
        ...state,
          sub2apiUrl,
      }, {
        logLabel,
        timeoutMs: SUB2API_STEP1_RESPONSE_TIMEOUT_MS,
      });
    }

    return {
      requestOAuthUrlFromPanel,
      requestLocalCpaJsonOAuthUrl,
      requestCodex2ApiOAuthUrl,
      requestCpaOAuthUrl,
      requestSub2ApiOAuthUrl,
    };
  }

  return {
    createPanelBridge,
  };
});
