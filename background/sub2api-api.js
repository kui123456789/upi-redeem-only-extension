(function attachBackgroundSub2ApiApi(root, factory) {
  root.MultiPageBackgroundSub2ApiApi = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSub2ApiApiModule() {
  function createSub2ApiApi(deps = {}) {
    const {
      addLog = async () => {},
      normalizeSub2ApiUrl = (value) => value,
      DEFAULT_SUB2API_GROUP_NAME = 'codex',
      fetchImpl = (...args) => fetch(...args),
    } = deps;

    const DEFAULT_REDIRECT_URI = 'http://localhost:1455/auth/callback';
    const DEFAULT_PROXY_NAME = '';
    const DEFAULT_CONCURRENCY = 10;
    const DEFAULT_PRIORITY = 1;
    const DEFAULT_RATE_MULTIPLIER = 1;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function extractStateFromAuthUrl(authUrl = '') {
      try {
        return new URL(authUrl).searchParams.get('state') || '';
      } catch {
        return '';
      }
    }

    function normalizeRedirectUri(input = DEFAULT_REDIRECT_URI) {
      const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}`;
      const parsed = new URL(withProtocol);
      if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/auth/callback';
      }
      if (parsed.pathname !== '/auth/callback') {
        throw new Error('SUB2API 回调地址必须是 /auth/callback，例如 http://localhost:1455/auth/callback');
      }
      return parsed.toString();
    }

    function getSub2ApiOrigin(rawUrl = '') {
      const sub2apiUrl = normalizeSub2ApiUrl(rawUrl);
      if (!sub2apiUrl) {
        throw new Error('SUB2API URL is not configured. Please fill it in the side panel first.');
      }
      try {
        return new URL(sub2apiUrl).origin;
      } catch {
        throw new Error('SUB2API URL 格式无效，请先在侧边栏检查。');
      }
    }

    function getSub2ApiErrorMessage(payload, responseStatus = 500, path = '') {
      const candidates = [
        payload?.message,
        payload?.detail,
        payload?.error,
        payload?.reason,
      ];
      const message = candidates.map(normalizeString).find(Boolean);
      return message || `SUB2API 请求失败（HTTP ${responseStatus}）：${path}`;
    }

    async function requestJson(origin, path, options = {}) {
      const controller = new AbortController();
      const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 30000));
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const token = normalizeString(options.token);
        const response = await fetchImpl(`${origin}${path}`, {
          method: options.method || 'GET',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }

        if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'code')) {
          if (Number(payload.code) === 0) {
            return payload.data;
          }
          throw new Error(getSub2ApiErrorMessage(payload, response.status, path));
        }

        if (!response.ok) {
          throw new Error(getSub2ApiErrorMessage(payload, response.status, path));
        }

        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error(`SUB2API 请求超时：${path}`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function loginSub2Api(state = {}, options = {}) {
      const email = normalizeString(state.sub2apiEmail);
      const password = String(state.sub2apiPassword || '');
      const origin = getSub2ApiOrigin(state.sub2apiUrl);

      if (!email) {
        throw new Error('尚未配置 SUB2API 登录邮箱，请先在侧边栏填写。');
      }
      if (!password) {
        throw new Error('尚未配置 SUB2API 登录密码，请先在侧边栏填写。');
      }

      const loginData = await requestJson(origin, '/api/v1/auth/login', {
        method: 'POST',
        timeoutMs: options.timeoutMs,
        body: { email, password },
      });

      const token = normalizeString(loginData?.access_token || loginData?.accessToken);
      if (!token) {
        throw new Error('SUB2API 登录返回缺少 access_token。');
      }

      return {
        origin,
        token,
        user: loginData?.user || null,
      };
    }

    function normalizeSub2ApiGroupNames(value) {
      const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[\r\n,，;；]+/);
      const seen = new Set();
      const names = [];
      for (const item of source) {
        const name = normalizeString(item);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
      return names.length ? names : [DEFAULT_SUB2API_GROUP_NAME];
    }

    async function getGroupsByNames(origin, token, groupNames, options = {}) {
      const targetNames = normalizeSub2ApiGroupNames(groupNames);
      const groups = await requestJson(origin, '/api/v1/admin/groups/all', {
        method: 'GET',
        token,
        timeoutMs: options.timeoutMs,
      });
      const matched = [];
      const missing = [];

      for (const targetName of targetNames) {
        const normalized = targetName.toLowerCase();
        const group = (Array.isArray(groups) ? groups : []).find((item) => {
          const itemName = normalizeString(item?.name).toLowerCase();
          if (!itemName || itemName !== normalized) return false;
          return !item.platform || item.platform === 'openai';
        });
        if (group) {
          matched.push(group);
        } else {
          missing.push(targetName);
        }
      }

      if (missing.length) {
        throw new Error(`SUB2API 中未找到以下 openai 分组：${missing.join('、')}。`);
      }

      return matched;
    }

    function normalizeSub2ApiProxyPreference(value) {
      return normalizeString(value);
    }

    function resolveSub2ApiProxyPreference(state = {}) {
      if (state.sub2apiDefaultProxyName !== undefined) {
        return normalizeSub2ApiProxyPreference(state.sub2apiDefaultProxyName);
      }
      return DEFAULT_PROXY_NAME;
    }

    function resolveSub2ApiAccountPriority(state = {}) {
      const rawValue = normalizeString(state.sub2apiAccountPriority);
      if (!rawValue) {
        return DEFAULT_PRIORITY;
      }
      const numeric = Number(rawValue);
      if (!Number.isSafeInteger(numeric) || numeric < 1) {
        throw new Error('SUB2API 账号优先级必须是大于等于 1 的整数。');
      }
      return numeric;
    }

    function normalizeProxyId(value) {
      if (value === undefined || value === null || value === '') {
        return null;
      }
      const normalized = Number(value);
      if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        return null;
      }
      return normalized;
    }

    function buildProxyDisplayName(proxy = {}) {
      const id = normalizeProxyId(proxy.id);
      const name = normalizeString(proxy.name);
      const protocol = normalizeString(proxy.protocol);
      const host = normalizeString(proxy.host);
      const port = proxy.port === undefined || proxy.port === null ? '' : normalizeString(proxy.port);
      const address = protocol && host && port ? `${protocol}://${host}:${port}` : '';
      return [
        name || '(未命名代理)',
        id ? `#${id}` : '',
        address,
      ].filter(Boolean).join(' ');
    }

    function buildProxySearchText(proxy = {}) {
      return [
        proxy.id,
        proxy.name,
        proxy.protocol,
        proxy.host,
        proxy.port,
        buildProxyDisplayName(proxy),
      ]
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => normalizeString(value).toLowerCase())
        .filter(Boolean)
        .join(' ');
    }

    function isActiveProxy(proxy = {}) {
      const status = normalizeString(proxy.status).toLowerCase();
      return !status || status === 'active';
    }

    function findSub2ApiProxy(proxies = [], preference = '') {
      const activeProxies = (Array.isArray(proxies) ? proxies : [])
        .filter(isActiveProxy)
        .filter((proxy) => normalizeProxyId(proxy.id));
      const normalizedPreference = normalizeSub2ApiProxyPreference(preference).toLowerCase();
      const preferredId = normalizeProxyId(normalizedPreference);

      if (preferredId) {
        const matchedById = activeProxies.find((proxy) => normalizeProxyId(proxy.id) === preferredId);
        return {
          proxy: matchedById || null,
          reason: matchedById ? 'id' : 'missing-id',
          candidates: activeProxies,
        };
      }

      if (normalizedPreference) {
        const exactMatches = activeProxies.filter((proxy) => normalizeString(proxy.name).toLowerCase() === normalizedPreference);
        if (exactMatches.length === 1) {
          return { proxy: exactMatches[0], reason: 'name', candidates: activeProxies };
        }
        if (exactMatches.length > 1) {
          return { proxy: null, reason: 'ambiguous-name', candidates: exactMatches };
        }

        const fuzzyMatches = activeProxies.filter((proxy) => buildProxySearchText(proxy).includes(normalizedPreference));
        if (fuzzyMatches.length === 1) {
          return { proxy: fuzzyMatches[0], reason: 'fuzzy', candidates: activeProxies };
        }
        if (fuzzyMatches.length > 1) {
          return { proxy: null, reason: 'ambiguous-fuzzy', candidates: fuzzyMatches };
        }

        return { proxy: null, reason: 'missing-name', candidates: activeProxies };
      }

      if (activeProxies.length === 1) {
        return { proxy: activeProxies[0], reason: 'single-active', candidates: activeProxies };
      }
      return {
        proxy: null,
        reason: activeProxies.length ? 'no-preference' : 'none-active',
        candidates: activeProxies,
      };
    }

    async function resolveSub2ApiProxy(origin, token, preference = '', options = {}) {
      const proxies = await requestJson(origin, '/api/v1/admin/proxies/all?with_count=true', {
        method: 'GET',
        token,
        timeoutMs: options.timeoutMs,
      });
      if (!Array.isArray(proxies)) {
        throw new Error('SUB2API 代理列表返回格式异常，无法自动选择代理。');
      }

      const { proxy, reason, candidates } = findSub2ApiProxy(proxies, preference);
      if (proxy) {
        return proxy;
      }

      const configured = normalizeSub2ApiProxyPreference(preference) || '(未配置)';
      const available = (candidates || [])
        .slice(0, 8)
        .map(buildProxyDisplayName)
        .join('；') || '无可用代理';
      if (reason === 'ambiguous-name' || reason === 'ambiguous-fuzzy') {
        throw new Error(`SUB2API 默认代理“${configured}”匹配到多个代理，请改填代理 ID。候选：${available}`);
      }
      if (reason === 'missing-id') {
        throw new Error(`SUB2API 默认代理 ID “${configured}”不存在或未启用。可用代理：${available}`);
      }
      if (reason === 'missing-name') {
        throw new Error(`SUB2API 默认代理“${configured}”不存在或未启用。可用代理：${available}`);
      }
      if (reason === 'no-preference') {
        throw new Error(`SUB2API 存在多个可用代理，请在侧边栏填写默认代理名称或 ID；留空则不使用代理。可用代理：${available}`);
      }
      throw new Error('SUB2API 没有可用代理；请检查默认代理配置，或将其留空以禁用代理。');
    }

    function buildDraftAccountName(groupName) {
      const prefix = normalizeString(groupName || DEFAULT_SUB2API_GROUP_NAME)
        .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
        .replace(/^-+|-+$/g, '') || DEFAULT_SUB2API_GROUP_NAME;
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
      const random = Math.floor(Math.random() * 9000 + 1000);
      return `${prefix}-${stamp}-${random}`;
    }

    function normalizeCodexSessionObject(value) {
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }

    function normalizeEmailValue(value = '') {
      const email = normalizeString(value);
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
    }

    function decodeCodexBase64UrlSegment(segment = '') {
      const normalized = normalizeString(segment)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      if (!normalized) {
        return '';
      }
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      try {
        if (typeof Buffer !== 'undefined') {
          return Buffer.from(padded, 'base64').toString('utf8');
        }
        if (typeof atob === 'function') {
          const binary = atob(padded);
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder().decode(bytes);
          }
          return binary;
        }
      } catch {
        return '';
      }
      return '';
    }

    function parseCodexAccessTokenClaims(accessToken = '') {
      const token = normalizeString(accessToken);
      if (!token) {
        return null;
      }
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }
      try {
        return JSON.parse(decodeCodexBase64UrlSegment(parts[1]));
      } catch {
        return null;
      }
    }

    function normalizeTimestamp(value) {
      if (value === undefined || value === null || value === '') {
        return undefined;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date((value > 1e11 ? value : value * 1000));
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
      }
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    function epochSecondsFromValue(value) {
      if (value === undefined || value === null || value === '') {
        return undefined;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value > 1e11 ? value / 1000 : value);
      }
      const parsed = Date.parse(String(value));
      return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : undefined;
    }

    function secondsUntil(expiresAt, now = new Date()) {
      const expiresTime = Date.parse(String(expiresAt || ''));
      const nowTime = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
      if (!Number.isFinite(expiresTime)) {
        return undefined;
      }
      return Math.max(0, Math.floor((expiresTime - nowTime) / 1000));
    }

    function stripUnavailable(value) {
      if (Array.isArray(value)) {
        return value.map(stripUnavailable);
      }
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== '')
            .map(([key, entryValue]) => [key, stripUnavailable(entryValue)])
        );
      }
      return value;
    }

    function resolveCodexSessionImportAccountName(state = {}, session = null, accessToken = '') {
      const sessionObject = normalizeCodexSessionObject(session);
      const claims = parseCodexAccessTokenClaims(accessToken || sessionObject?.accessToken);
      const accountIdentifierType = normalizeString(state?.accountIdentifierType).toLowerCase();
      const accountIdentifierEmail = accountIdentifierType === 'email'
        ? normalizeEmailValue(state?.accountIdentifier)
        : '';

      return normalizeEmailValue(sessionObject?.user?.email)
        || normalizeEmailValue(sessionObject?.email)
        || normalizeEmailValue(claims?.email)
        || normalizeEmailValue(state?.email)
        || accountIdentifierEmail;
    }

    function buildSub2ApiAccountDocument(session, accessToken = '', state = {}, options = {}) {
      const sessionObject = normalizeCodexSessionObject(session);
      const normalizedAccessToken = normalizeString(accessToken || sessionObject?.accessToken);
      if (!normalizedAccessToken) {
        throw new Error('未读取到可导入的 ChatGPT accessToken。');
      }

      const claims = parseCodexAccessTokenClaims(normalizedAccessToken) || {};
      const authClaims = claims['https://api.openai.com/auth'] || {};
      const expiresAt = normalizeTimestamp(
        sessionObject?.expires
        || sessionObject?.expiresAt
        || sessionObject?.expires_at
      );
      const accessTokenExpiresAt = normalizeTimestamp(claims.exp);
      const accountExpiresAt = epochSecondsFromValue(claims.exp)
        || epochSecondsFromValue(expiresAt);
      const email = resolveCodexSessionImportAccountName(state, sessionObject, normalizedAccessToken);
      const accountId = normalizeString(
        sessionObject?.account?.id
        || sessionObject?.account_id
        || sessionObject?.chatgptAccountId
        || sessionObject?.chatgpt_account_id
        || authClaims.chatgpt_account_id
      );
      const userId = normalizeString(
        sessionObject?.user?.id
        || sessionObject?.user_id
        || sessionObject?.chatgptUserId
        || sessionObject?.chatgpt_user_id
        || authClaims.chatgpt_user_id
        || authClaims.user_id
      );
      const planType = normalizeString(
        sessionObject?.account?.planType
        || sessionObject?.account?.plan_type
        || sessionObject?.planType
        || sessionObject?.plan_type
        || authClaims.chatgpt_plan_type
      );
      const name = email || normalizeString(options.sourceName) || 'ChatGPT Account';
      const exportedAt = normalizeTimestamp(options.now || new Date());

      return stripUnavailable({
        name,
        platform: 'openai',
        type: 'oauth',
        expires_at: accountExpiresAt,
        auto_pause_on_expired: true,
        concurrency: DEFAULT_CONCURRENCY,
        priority: resolveSub2ApiAccountPriority(state),
        credentials: {
          access_token: normalizedAccessToken,
          chatgpt_account_id: accountId,
          chatgpt_user_id: userId,
          email,
          expires_at: expiresAt || accessTokenExpiresAt,
          expires_in: secondsUntil(expiresAt || accessTokenExpiresAt, options.now || new Date()),
          plan_type: planType,
          session_token: sessionObject?.sessionToken || sessionObject?.session_token,
        },
        extra: {
          email,
          name,
          source: 'chatgpt_web_session',
          last_refresh: exportedAt,
        },
      });
    }

    function buildCodexSessionImportContent(session, accessToken = '') {
      const normalizedAccessToken = normalizeString(accessToken);
      const sessionObject = normalizeCodexSessionObject(session);

      if (sessionObject) {
        const contentObject = normalizedAccessToken
          ? {
            ...sessionObject,
            accessToken: normalizedAccessToken,
          }
          : sessionObject;
        return JSON.stringify(contentObject);
      }

      if (normalizedAccessToken) {
        return normalizedAccessToken;
      }

      throw new Error('未读取到可导入的 ChatGPT 会话或 accessToken。');
    }

    function buildCodexSessionImportBasePayload(state = {}, session = null, accessToken = '') {
      const normalizedAccessToken = normalizeString(accessToken || session?.accessToken);
      const importContent = buildCodexSessionImportContent(session, normalizedAccessToken);
      const importExpiresAt = resolveCodexSessionImportExpiresAt(session);
      const preferredAccountName = resolveCodexSessionImportAccountName(state, session, normalizedAccessToken);
      const accountPriority = resolveSub2ApiAccountPriority(state);
      const payload = {
        content: importContent,
        group_ids: [],
        ...(preferredAccountName ? { name: preferredAccountName } : {}),
        priority: accountPriority,
        auto_pause_on_expired: true,
        update_existing: true,
      };

      if (importExpiresAt) {
        payload.expires_at = importExpiresAt;
      }

      return {
        payload,
        importContent,
        importExpiresAt,
        preferredAccountName,
        accountPriority,
      };
    }

    function resolveCodexSessionImportExpiresAt(session) {
      const sessionObject = normalizeCodexSessionObject(session);
      const expiresValue = normalizeString(sessionObject?.expires);
      if (!expiresValue) {
        return null;
      }
      const expiresAtMs = Date.parse(expiresValue);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
        return null;
      }
      return Math.floor(expiresAtMs / 1000);
    }

    function hasSub2ApiLoginConfig(state = {}) {
      return Boolean(
        normalizeString(state.sub2apiUrl)
        && normalizeString(state.sub2apiEmail)
        && String(state.sub2apiPassword || '')
      );
    }

    async function buildCodexSessionImportPayloadForExport(state = {}, options = {}) {
      const session = normalizeCodexSessionObject(state?.session);
      const accessToken = normalizeString(
        state?.accessToken
        || session?.accessToken
      );
      const account = buildSub2ApiAccountDocument(session, accessToken, state, options);
      const document = {
        exported_at: normalizeTimestamp(options.now || new Date()),
        proxies: [],
        accounts: [account],
      };
      const warnings = [];
      const groupNames = state.sub2apiGroupName || DEFAULT_SUB2API_GROUP_NAME;
      const proxyPreference = resolveSub2ApiProxyPreference(state);
      const shouldResolveRemote = options.resolveRemote !== false && hasSub2ApiLoginConfig(state);

      if (shouldResolveRemote) {
        try {
          const { origin, token } = await loginSub2Api(state, options);
          const groups = await getGroupsByNames(origin, token, groupNames, options);
          account.group_ids = groups
            .map((group) => Number(group?.id))
            .filter((id) => Number.isFinite(id) && id > 0);
          if (!account.group_ids.length) {
            throw new Error('SUB2API 返回的目标分组 ID 无效。');
          }

          if (proxyPreference) {
            const proxy = await resolveSub2ApiProxy(origin, token, proxyPreference, options);
            const proxyId = normalizeProxyId(proxy?.id);
            if (proxyId) {
              account.proxy_id = proxyId;
            }
          }

          return {
            payload: document,
            warnings,
            resolvedRemote: true,
          };
        } catch (error) {
          warnings.push(`解析 SUB2API 分组 / 代理失败：${error?.message || String(error || '')}。已导出本地模板字段，请手动补全 group_ids / proxy_id 后再提交。`);
        }
      } else {
        warnings.push('未配置完整 SUB2API URL / 邮箱 / 密码，已导出本地模板字段，请手动补全 group_ids / proxy_id 后再提交。');
      }

      account.group_names = normalizeSub2ApiGroupNames(groupNames);
      if (proxyPreference) {
        account.proxy_name = proxyPreference;
      }

      return {
        payload: document,
        warnings,
        resolvedRemote: false,
      };
    }

    function normalizeCodexSessionImportMessages(messages) {
      return (Array.isArray(messages) ? messages : [])
        .map((item, index) => ({
          index: Number(item?.index) || index + 1,
          name: normalizeString(item?.name),
          message: normalizeString(item?.message),
        }))
        .filter((item) => item.message);
    }

    function normalizeCodexSessionImportResult(result) {
      return {
        total: Math.max(0, Number(result?.total) || 0),
        created: Math.max(0, Number(result?.created) || 0),
        updated: Math.max(0, Number(result?.updated) || 0),
        skipped: Math.max(0, Number(result?.skipped) || 0),
        failed: Math.max(0, Number(result?.failed) || 0),
        items: Array.isArray(result?.items) ? result.items : [],
        warnings: normalizeCodexSessionImportMessages(result?.warnings),
        errors: normalizeCodexSessionImportMessages(result?.errors),
      };
    }

    function buildCodexSessionImportSummary(result) {
      const normalized = normalizeCodexSessionImportResult(result);
      return `SUB2API 会话导入完成：新建 ${normalized.created}，更新 ${normalized.updated}，跳过 ${normalized.skipped}，失败 ${normalized.failed}`;
    }

    function getCodexSessionImportFailureMessage(result) {
      const normalized = normalizeCodexSessionImportResult(result);
      const detail = normalized.errors.map((item) => item.message).find(Boolean)
        || normalized.warnings.map((item) => item.message).find(Boolean)
        || normalized.items
          .map((item) => normalizeString(item?.message))
          .find(Boolean)
        || buildCodexSessionImportSummary(normalized);
      return detail || 'SUB2API 会话导入失败。';
    }

    function parseLocalhostCallback(rawUrl, visibleStep = 10) {
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new Error(`步骤 ${visibleStep} 捕获到的 localhost OAuth 回调地址格式无效。`);
      }

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('回调 URL 协议不正确。');
      }
      if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        throw new Error(`步骤 ${visibleStep} 只接受 localhost / 127.0.0.1 回调地址。`);
      }
      if (parsed.pathname !== '/auth/callback') {
        throw new Error('回调 URL 路径必须是 /auth/callback。');
      }

      const code = normalizeString(parsed.searchParams.get('code'));
      const oauthState = normalizeString(parsed.searchParams.get('state'));
      if (!code || !oauthState) {
        throw new Error('回调 URL 中缺少 code 或 state。');
      }

      return {
        url: parsed.toString(),
        code,
        state: oauthState,
      };
    }

    function buildOpenAiCredentials(exchangeData) {
      const credentials = {};
      const allowedKeys = [
        'access_token',
        'refresh_token',
        'id_token',
        'expires_at',
        'email',
        'chatgpt_account_id',
        'chatgpt_user_id',
        'organization_id',
        'plan_type',
        'client_id',
      ];

      for (const key of allowedKeys) {
        if (exchangeData?.[key] !== undefined && exchangeData?.[key] !== null && exchangeData?.[key] !== '') {
          credentials[key] = exchangeData[key];
        }
      }

      if (!credentials.access_token) {
        throw new Error('SUB2API 交换授权码后未返回 access_token。');
      }

      return credentials;
    }

    function buildOpenAiExtra(exchangeData) {
      const extra = {};
      const allowedKeys = ['email', 'name', 'privacy_mode'];

      for (const key of allowedKeys) {
        if (exchangeData?.[key] !== undefined && exchangeData?.[key] !== null && exchangeData?.[key] !== '') {
          extra[key] = exchangeData[key];
        }
      }

      return Object.keys(extra).length ? extra : undefined;
    }

    async function logWithOptions(message, level = 'info', options = {}) {
      await addLog(message, level, options.logOptions || {});
    }

    async function generateOpenAiAuthUrl(state = {}, options = {}) {
      const logLabel = normalizeString(options.logLabel) || 'OAuth 刷新';
      const redirectUri = normalizeRedirectUri(options.redirectUri || DEFAULT_REDIRECT_URI);
      const groupNames = normalizeSub2ApiGroupNames(state.sub2apiGroupName || DEFAULT_SUB2API_GROUP_NAME);
      const groupName = groupNames[0] || DEFAULT_SUB2API_GROUP_NAME;

      await logWithOptions(`${logLabel}：正在通过 SUB2API 管理接口登录并生成 OpenAI Auth 链接...`, 'info', options);
      const { origin, token } = await loginSub2Api(state, options);
      const groups = await getGroupsByNames(origin, token, groupNames, options);
      const group = groups[0];
      const proxyPreference = resolveSub2ApiProxyPreference(state);
      const proxy = proxyPreference ? await resolveSub2ApiProxy(origin, token, proxyPreference, options) : null;
      const proxyId = normalizeProxyId(proxy?.id);
      const draftName = buildDraftAccountName(group.name || groupName);
      const groupLabel = groups.map((item) => `${item.name}（#${item.id}）`).join('、');

      await logWithOptions(`${logLabel}：已登录 SUB2API，使用分组 ${groupLabel}。`, 'info', options);
      if (proxy) {
        await logWithOptions(`${logLabel}：已选择 SUB2API 默认代理 ${buildProxyDisplayName(proxy)}。`, 'info', options);
      } else {
        await logWithOptions(`${logLabel}：未配置 SUB2API 默认代理，本次将不使用代理。`, 'info', options);
      }

      const authRequestBody = { redirect_uri: redirectUri };
      if (proxyId) {
        authRequestBody.proxy_id = proxyId;
      }

      const authData = await requestJson(origin, '/api/v1/admin/openai/generate-auth-url', {
        method: 'POST',
        token,
        timeoutMs: options.timeoutMs,
        body: authRequestBody,
      });

      const oauthUrl = normalizeString(authData?.auth_url || authData?.authUrl);
      const sessionId = normalizeString(authData?.session_id || authData?.sessionId);
      const oauthState = normalizeString(authData?.state || extractStateFromAuthUrl(oauthUrl));

      if (!oauthUrl || !sessionId) {
        throw new Error('SUB2API 未返回完整的 auth_url / session_id。');
      }

      await logWithOptions(`${logLabel}：已获取 SUB2API OAuth 链接：${oauthUrl.slice(0, 96)}...`, 'ok', options);
      return {
        oauthUrl,
        sub2apiSessionId: sessionId,
        sub2apiOAuthState: oauthState,
        sub2apiGroupId: group.id,
        sub2apiGroupIds: groups.map((item) => item.id),
        sub2apiDraftName: draftName,
        sub2apiProxyId: proxyId,
      };
    }

    async function submitOpenAiCallback(state = {}, options = {}) {
      const visibleStep = Number(options.visibleStep || state.visibleStep) || 10;
      const callback = parseLocalhostCallback(state.localhostUrl || '', visibleStep);
      const flowEmail = normalizeString(state.email);
      const sessionId = normalizeString(state.sub2apiSessionId);
      const expectedState = normalizeString(state.sub2apiOAuthState);
      const logLabel = normalizeString(options.logLabel) || `步骤 ${visibleStep}`;

      if (!sessionId) {
        throw new Error('缺少 SUB2API session_id，请重新执行步骤 1。');
      }
      if (expectedState && expectedState !== callback.state) {
        throw new Error('本次 localhost 回调中的 state 与步骤 1 生成的 state 不一致，请重新执行步骤 1。');
      }

      const { origin, token } = await loginSub2Api(state, options);
      const proxyPreference = resolveSub2ApiProxyPreference(state);
      const preferredProxyId = normalizeProxyId(state.sub2apiProxyId);
      const proxySelector = preferredProxyId || proxyPreference;
      const proxy = proxySelector ? await resolveSub2ApiProxy(origin, token, proxySelector, options) : null;
      const proxyId = normalizeProxyId(proxy?.id);
      const accountPriority = resolveSub2ApiAccountPriority(state);
      const storedGroupIds = Array.isArray(state.sub2apiGroupIds) ? state.sub2apiGroupIds : [];
      const groupIdsFromState = storedGroupIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
      const groups = groupIdsFromState.length
        ? groupIdsFromState.map((id) => ({ id }))
        : (state.sub2apiGroupId
          ? [{ id: state.sub2apiGroupId, name: state.sub2apiGroupName || DEFAULT_SUB2API_GROUP_NAME }]
          : await getGroupsByNames(origin, token, state.sub2apiGroupName || DEFAULT_SUB2API_GROUP_NAME, options));

      await logWithOptions(`${logLabel}：正在通过 SUB2API 管理接口交换 OpenAI 授权码...`, 'info', options);
      if (proxy) {
        await logWithOptions(`${logLabel}：使用 SUB2API 默认代理 ${buildProxyDisplayName(proxy)}。`, 'info', options);
      } else {
        await logWithOptions(`${logLabel}：未配置 SUB2API 默认代理，本次将不使用代理。`, 'info', options);
      }

      const exchangeRequestBody = {
        session_id: sessionId,
        code: callback.code,
        state: callback.state,
      };
      if (proxyId) {
        exchangeRequestBody.proxy_id = proxyId;
      }

      const exchangeData = await requestJson(origin, '/api/v1/admin/openai/exchange-code', {
        method: 'POST',
        token,
        timeoutMs: options.timeoutMs,
        body: exchangeRequestBody,
      });

      const credentials = buildOpenAiCredentials(exchangeData);
      const extra = buildOpenAiExtra(exchangeData);
      const resolvedEmail = normalizeString(exchangeData?.email || credentials?.email);
      const groupIds = groups
        .map((group) => Number(group.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (!groupIds.length) {
        throw new Error('SUB2API 返回的目标分组 ID 无效。');
      }

      const accountName = resolvedEmail
        || flowEmail
        || normalizeString(state.sub2apiDraftName)
        || buildDraftAccountName(state.sub2apiGroupName || DEFAULT_SUB2API_GROUP_NAME);
      const createPayload = {
        name: accountName,
        notes: '',
        platform: 'openai',
        type: 'oauth',
        credentials,
        concurrency: DEFAULT_CONCURRENCY,
        priority: accountPriority,
        rate_multiplier: DEFAULT_RATE_MULTIPLIER,
        group_ids: groupIds,
        auto_pause_on_expired: true,
      };
      if (proxyId) {
        createPayload.proxy_id = proxyId;
      }
      if (extra) {
        createPayload.extra = extra;
      }

      await logWithOptions(`${logLabel}：授权码交换成功，正在创建 SUB2API 账号（名称：${accountName}）...`, 'info', options);
      const createdAccount = await requestJson(origin, '/api/v1/admin/accounts', {
        method: 'POST',
        token,
        timeoutMs: options.createTimeoutMs,
        body: createPayload,
      });

      const verifiedStatus = `SUB2API 已创建账号 #${createdAccount?.id || 'unknown'}`;
      await logWithOptions(verifiedStatus, 'ok', options);
      return {
        localhostUrl: callback.url,
        verifiedStatus,
      };
    }

    async function importCurrentChatGptSession(state = {}, options = {}) {
      const logLabel = normalizeString(options.logLabel) || 'SUB2API 会话导入';
      const session = normalizeCodexSessionObject(state?.session);
      const accessToken = normalizeString(
        state?.accessToken
        || session?.accessToken
      );
      const { payload: importPayload } = buildCodexSessionImportBasePayload(state, session, accessToken);

      await logWithOptions(`${logLabel}：正在通过 SUB2API 管理接口登录并准备导入当前 ChatGPT 会话...`, 'info', options);
      const { origin, token } = await loginSub2Api(state, options);
      const groupNames = state.sub2apiGroupName || DEFAULT_SUB2API_GROUP_NAME;
      const groups = await getGroupsByNames(origin, token, groupNames, options);
      const groupLabel = groups.map((item) => `${item.name}（${item.id}）`).join('、');
      const proxyPreference = resolveSub2ApiProxyPreference(state);
      const proxy = proxyPreference ? await resolveSub2ApiProxy(origin, token, proxyPreference, options) : null;
      const proxyId = normalizeProxyId(proxy?.id);

      await logWithOptions(`${logLabel}：已登录 SUB2API，使用分组 ${groupLabel}。`, 'info', options);
      if (proxy) {
        await logWithOptions(`${logLabel}：已选择 SUB2API 默认代理 ${buildProxyDisplayName(proxy)}。`, 'info', options);
      } else {
        await logWithOptions(`${logLabel}：未配置 SUB2API 默认代理，本次将不使用代理。`, 'info', options);
      }

      importPayload.group_ids = groups
        .map((group) => Number(group?.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (!importPayload.group_ids.length) {
        throw new Error('SUB2API 返回的目标分组 ID 无效。');
      }
      if (proxyId) {
        importPayload.proxy_id = proxyId;
      }

      await logWithOptions(`${logLabel}：正在导入当前 ChatGPT 会话到 SUB2API...`, 'info', options);
      const importResult = normalizeCodexSessionImportResult(await requestJson(origin, '/api/v1/admin/accounts/import/codex-session', {
        method: 'POST',
        token,
        timeoutMs: options.importTimeoutMs || options.timeoutMs,
        body: importPayload,
      }));

      for (const warning of importResult.warnings) {
        await logWithOptions(`${logLabel}：${warning.message}`, 'warn', options);
      }

      if (importResult.failed > 0) {
        throw new Error(getCodexSessionImportFailureMessage(importResult));
      }
      if (importResult.created <= 0 && importResult.updated <= 0) {
        throw new Error(getCodexSessionImportFailureMessage(importResult));
      }

      const verifiedStatus = buildCodexSessionImportSummary(importResult);
      await logWithOptions(verifiedStatus, 'ok', options);
      return {
        verifiedStatus,
        sub2apiImportTotal: importResult.total,
        sub2apiImportCreated: importResult.created,
        sub2apiImportUpdated: importResult.updated,
        sub2apiImportSkipped: importResult.skipped,
        sub2apiImportFailed: importResult.failed,
      };
    }

    return {
      buildDraftAccountName,
      buildCodexSessionImportContent,
      buildCodexSessionImportPayloadForExport,
      buildOpenAiCredentials,
      buildOpenAiExtra,
      buildProxyDisplayName,
      extractStateFromAuthUrl,
      generateOpenAiAuthUrl,
      getGroupsByNames,
      importCurrentChatGptSession,
      loginSub2Api,
      normalizeProxyId,
      normalizeRedirectUri,
      normalizeSub2ApiGroupNames,
      parseLocalhostCallback,
      requestJson,
      resolveSub2ApiAccountPriority,
      resolveSub2ApiProxy,
      submitOpenAiCallback,
    };
  }

  return {
    createSub2ApiApi,
  };
});
