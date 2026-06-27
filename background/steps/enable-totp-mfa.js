(function attachBackgroundEnableTotpMfa(root, factory) {
  root.MultiPageBackgroundEnableTotpMfa = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundEnableTotpMfaModule() {
  const CHATGPT_SOURCE = 'chatgpt-session-reader';
  const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security';
  const DEFAULT_TOTP_API_BASE_URL = 'https://cha.nerver.cc';
  const SESSION_TAB_COMPLETE_TIMEOUT_MS = 60000;
  const TOTP_ENABLE_TIMEOUT_MS = 60000;
  const TOTP_LOOKUP_TIMEOUT_MS = 30000;
  const TOTP_ENABLE_MAX_ATTEMPTS = 3;
  const TOTP_ENABLE_RETRY_DELAYS_MS = Object.freeze([3000, 7000]);
  const SESSION_COOKIE_NAMES = Object.freeze([
    '__Secure-next-auth.session-token',
    'next-auth.session-token',
    '__Secure-authjs.session-token',
    'authjs.session-token',
  ]);

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function normalizeEmail(value = '') {
    const email = normalizeString(value).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  function normalizeTotpSecret(secret = '') {
    return normalizeString(secret).replace(/\s+/g, '').toUpperCase();
  }

  function maskTotpSecret(secret = '') {
    const normalized = normalizeTotpSecret(secret);
    if (!normalized) {
      return '';
    }
    if (normalized.length <= 8) {
      return `${normalized[0]}${'*'.repeat(Math.max(0, normalized.length - 2))}${normalized.slice(-1)}`;
    }
    return `${normalized.slice(0, 4)}${'*'.repeat(Math.max(4, normalized.length - 8))}${normalized.slice(-4)}`;
  }

  function decodeBase32Secret(secret = '') {
    const normalized = normalizeTotpSecret(secret).replace(/=+$/g, '');
    if (!normalized) {
      throw new Error('TOTP secret 为空。');
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const char of normalized) {
      const index = alphabet.indexOf(char);
      if (index < 0) {
        throw new Error('TOTP secret 不是有效的 Base32 字符串。');
      }
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(bytes);
  }

  function buildCounterBytes(counter) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    const safeCounter = Math.max(0, Math.floor(Number(counter) || 0));
    const high = Math.floor(safeCounter / 0x100000000);
    const low = safeCounter >>> 0;
    view.setUint32(0, high, false);
    view.setUint32(4, low, false);
    return new Uint8Array(buffer);
  }

  async function hmacSha1(keyBytes, messageBytes) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle?.importKey && subtle?.sign) {
      const cryptoKey = await subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      );
      return new Uint8Array(await subtle.sign('HMAC', cryptoKey, messageBytes));
    }

    if (typeof require === 'function') {
      const nodeCrypto = require('node:crypto');
      return new Uint8Array(nodeCrypto.createHmac('sha1', Buffer.from(keyBytes)).update(Buffer.from(messageBytes)).digest());
    }
    throw new Error('当前环境不支持生成 TOTP 验证码。');
  }

  async function generateTotpCode(secret = '', options = {}) {
    const keyBytes = decodeBase32Secret(secret);
    const timestampSeconds = Math.floor(Number(options.forTime ?? (Date.now() / 1000)) || 0);
    const counterBytes = buildCounterBytes(Math.floor(timestampSeconds / 30));
    const digest = await hmacSha1(keyBytes, counterBytes);
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24)
      | ((digest[offset + 1] & 0xff) << 16)
      | ((digest[offset + 2] & 0xff) << 8)
      | (digest[offset + 3] & 0xff);
    return String(binary % 1000000).padStart(6, '0');
  }

  function getPayloadError(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return '';
    }
    const nestedError = payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? payload.error
      : null;
    return normalizeString(
      payload.message
      || payload.error_message
      || payload.errorMessage
      || nestedError?.message
      || nestedError?.code
      || (typeof payload.error === 'string' ? payload.error : '')
      || payload.reason
      || payload.code
    );
  }

  function isChatGptUrl(url = '') {
    try {
      const parsed = new URL(String(url || ''));
      return /^https?:$/i.test(parsed.protocol) && /(^|\.)chatgpt\.com$/i.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  function isSupportedSessionUrl(url = '') {
    try {
      const parsed = new URL(String(url || ''));
      if (!/^https?:$/i.test(parsed.protocol)) {
        return false;
      }
      const hostname = normalizeString(parsed.hostname).toLowerCase();
      return /(^|\.)chatgpt\.com$/.test(hostname)
        || hostname === 'chat.openai.com'
        || /(^|\.)openai\.com$/.test(hostname);
    } catch {
      return false;
    }
  }

  function pickPreferredSessionTab(tabs = []) {
    const candidates = (Array.isArray(tabs) ? tabs : [])
      .filter((tab) => Number.isInteger(tab?.id) && isSupportedSessionUrl(tab.url));
    if (!candidates.length) {
      return null;
    }
    return candidates.reduce((best, candidate) => {
      if (!best) {
        return candidate;
      }
      if (isChatGptUrl(candidate.url) !== isChatGptUrl(best.url)) {
        return isChatGptUrl(candidate.url) ? candidate : best;
      }
      const candidateActive = candidate.active ? 0 : 1;
      const bestActive = best.active ? 0 : 1;
      if (candidateActive !== bestActive) {
        return candidateActive < bestActive ? candidate : best;
      }
      const candidateLastAccessed = Number(candidate?.lastAccessed) || 0;
      const bestLastAccessed = Number(best?.lastAccessed) || 0;
      if (candidateLastAccessed !== bestLastAccessed) {
        return candidateLastAccessed > bestLastAccessed ? candidate : best;
      }
      return Number(candidate.id) < Number(best.id) ? candidate : best;
    }, null);
  }

  function normalizeTotpApiBaseUrl(value = '') {
    let normalized = normalizeString(value || DEFAULT_TOTP_API_BASE_URL).replace(/\/+$/g, '');
    try {
      const parsed = new URL(normalized);
      parsed.hash = '';
      parsed.search = '';
      parsed.pathname = parsed.pathname
        .replace(/\/api\/v1\/totp\/(?:enable|lookup|code)$/i, '')
        .replace(/\/api\/v1\/subscription$/i, '')
        .replace(/\/api\/external\/cdkey-redeems\/status$/i, '')
        .replace(/\/api\/external\/cdkey-redeems$/i, '')
        .replace(/\/(?:totp|totp-lookup)$/i, '')
        .replace(/\/api\/?$/i, '')
        .replace(/\/+$/g, '');
      normalized = parsed.toString().replace(/\/+$/g, '');
    } catch {
      normalized = normalized.replace(/[?#].*$/g, '');
    }
    normalized = normalized
      .replace(/\/api\/v1\/totp\/enable$/i, '')
      .replace(/\/api\/v1\/totp\/lookup$/i, '')
      .replace(/\/api\/v1\/totp\/code$/i, '')
      .replace(/\/api\/v1\/subscription$/i, '')
      .replace(/\/api\/external\/cdkey-redeems\/status$/i, '')
      .replace(/\/api\/external\/cdkey-redeems$/i, '')
      .replace(/\/(?:totp|totp-lookup)$/i, '')
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/g, '');
    return normalized || DEFAULT_TOTP_API_BASE_URL;
  }

  function buildTotpEnableApiUrl(state = {}) {
    const baseUrl = normalizeTotpApiBaseUrl(
      state.totpMfaApiBaseUrl
      || DEFAULT_TOTP_API_BASE_URL
    );
    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('TOTP API Base URL 只支持 http/https。');
      }
    } catch (error) {
      throw new Error(`TOTP API Base URL 格式无效：${normalizeString(error?.message || error) || baseUrl}`);
    }
    return `${baseUrl}/api/v1/totp/enable`;
  }

  function buildTotpLookupApiUrl(state = {}) {
    const baseUrl = normalizeTotpApiBaseUrl(
      state.totpMfaLookupApiBaseUrl
      || state.totpMfaApiBaseUrl
      || DEFAULT_TOTP_API_BASE_URL
    );
    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('TOTP Lookup API Base URL 只支持 http/https。');
      }
    } catch (error) {
      throw new Error(`TOTP Lookup API Base URL 格式无效：${normalizeString(error?.message || error) || baseUrl}`);
    }
    return `${baseUrl}/api/v1/totp/lookup`;
  }

  function normalizePlusPaymentMethod(value = '') {
    const normalized = normalizeString(value).toLowerCase();
    return normalized === 'upi' || normalized === 'pix' ? 'upi' : normalized;
  }

  function shouldRequireGptPasswordBeforeTotp(state = {}) {
    const plusModeEnabled = Boolean(state.plusModeEnabled || state.plusMode);
    const paymentMethod = normalizePlusPaymentMethod(state.plusPaymentMethod || state.paymentMethod);
    return plusModeEnabled
      && paymentMethod === 'upi'
      && state.totpMfaAfterProfileEnabled !== false;
  }

  function getTotpApiAuthToken(state = {}) {
    return normalizeString(state.totpMfaApiKey);
  }

  function getTotpLookupKey(state = {}) {
    return normalizeString(
      state.totpMfaLookupKey
      || state.totpLookupKey
      || state.totpMfaApiKey
    );
  }

  function createDeviceId() {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    if (randomUuid) {
      return randomUuid;
    }
    const stamp = Math.max(1, Math.floor(Date.now())).toString(36);
    const randomPart = Math.random().toString(36).slice(2, 12) || 'local';
    return `gujumpgate-${stamp}-${randomPart}`;
  }

  function getCookieChunkValue(cookies = [], baseName = '') {
    const exact = cookies.find((cookie) => cookie?.name === baseName && normalizeString(cookie.value));
    if (exact) {
      return normalizeString(exact.value);
    }
    const chunks = cookies
      .filter((cookie) => String(cookie?.name || '').startsWith(`${baseName}.`) && normalizeString(cookie.value))
      .map((cookie) => {
        const suffix = String(cookie.name).slice(baseName.length + 1);
        const index = Math.max(0, Math.floor(Number(suffix) || 0));
        return { index, value: normalizeString(cookie.value) };
      })
      .sort((left, right) => left.index - right.index);
    return chunks.map((chunk) => chunk.value).join('');
  }

  function pickSessionTokenFromCookies(cookies = []) {
    for (const name of SESSION_COOKIE_NAMES) {
      const value = getCookieChunkValue(cookies, name);
      if (value) {
        return value;
      }
    }
    return '';
  }

  function buildCookieHeaderFromCookies(cookies = []) {
    const seenNames = new Set();
    return (Array.isArray(cookies) ? cookies : [])
      .map((cookie) => {
        const name = normalizeString(cookie?.name);
        const value = normalizeString(cookie?.value);
        if (!name || !value || seenNames.has(name)) {
          return '';
        }
        seenNames.add(name);
        return `${name}=${value}`;
      })
      .filter(Boolean)
      .join('; ');
  }

  async function readResponseBody(response) {
    if (!response) {
      return null;
    }
    if (typeof response.text === 'function') {
      const text = await response.text();
      if (!normalizeString(text)) {
        return null;
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    if (typeof response.json === 'function') {
      return response.json().catch(() => null);
    }
    return null;
  }

  function getResponseContentType(response) {
    try {
      return normalizeString(response?.headers?.get?.('content-type')).toLowerCase();
    } catch {
      return '';
    }
  }

  function isHtmlResponsePayload(response, payload) {
    const contentType = getResponseContentType(response);
    if (contentType.includes('text/html')) {
      return true;
    }
    if (typeof payload !== 'string') {
      return false;
    }
    return /^\s*(?:<!doctype\s+html\b|<html[\s>]|<head[\s>]|<body[\s>])/i.test(payload);
  }

  function createEnableTotpMfaExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      appendAccountRunRecord = null,
      chrome,
      completeNodeFromBackground,
      fetchImpl = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      getState = async () => ({}),
      getTabId,
      isTabAlive,
      markCurrentRegistrationAccountUsed = null,
      now = () => Date.now(),
      registerTab,
      setState = async () => {},
      sleepWithStop = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      throwIfStopped = () => {},
      checkRegistrationUpiTrialEligibility = null,
      upsertUpiAccountCredentialBackup = null,
      waitForTabCompleteUntilStopped = async () => {},
    } = deps;

    function getErrorMessage(error) {
      return normalizeString(error?.message || error);
    }

    function resolveVisibleStep(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : 6;
    }

    function addStepLog(step, message, level = 'info') {
      return rawAddLog(message, level, {
        step,
        stepKey: 'enable-totp-mfa',
      });
    }

    function formatLogPresence(label, value = '') {
      const normalized = normalizeString(value);
      return `${label}=${normalized ? `已读取(${normalized.length})` : '未读取'}`;
    }

    function formatLogField(label, value = '') {
      const normalized = normalizeString(value);
      return normalized ? `${label}=${normalized}` : '';
    }

    function formatLogBooleanField(label, value) {
      if (value === true || value === false) {
        return `${label}=${value ? 'true' : 'false'}`;
      }
      return '';
    }

    function buildTotpEnableRequestLog(apiUrl, details = {}) {
      return [
        `2FA：正在提交到 ${apiUrl}`,
        formatLogPresence('accessToken', details.accessToken),
        formatLogPresence('sessionToken', details.sessionToken),
        formatLogPresence('cookie', details.cookie),
        details.deviceId ? 'deviceId=已设置' : 'deviceId=自动生成',
      ].filter(Boolean).join('，');
    }

    function buildTotpEnableResponseLog(payload = {}) {
      const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      const secret = normalizeTotpSecret(source.secret);
      const factorId = normalizeString(source.factorId || source.factor_id);
      const sessionId = normalizeString(source.sessionId || source.session_id);
      const parts = [
        formatLogBooleanField('ok', typeof source.ok === 'boolean' ? source.ok : undefined),
        formatLogField('reason', source.reason),
        formatLogBooleanField('alreadyEnabled', source.alreadyEnabled),
        secret ? `secret=${maskTotpSecret(secret)}` : 'secret=未返回',
        normalizeString(source.otpauthUrl || source.otpauth_url) ? 'otpauthUrl=已返回' : 'otpauthUrl=未返回',
        formatLogField('factorId', factorId),
        formatLogField('sessionId', sessionId),
        formatLogField('email', source.email),
        formatLogField('account_id', source.account_id || source.accountId),
        formatLogField('plan_type', source.plan_type || source.planType),
        formatLogBooleanField('persisted', source.persisted),
      ].filter(Boolean);
      return `2FA 接口响应：${parts.join('，')}`;
    }

    function isRecoverableTotpEnableError(error) {
      const message = getErrorMessage(error).toLowerCase();
      return /request timeout|timed out|\btimeout\b|mfa_info\s+http\s+5\d\d|http\s*(?:429|500|502|503|504)|fetch-error|server-error|network|abort/i.test(message);
    }

    function resolveTargetAccountEmail(state = {}) {
      return normalizeEmail(
        state.email
        || state.step8VerificationTargetEmail
        || state.boundEmail
        || state.registrationEmailState?.current
        || (normalizeString(state.accountIdentifierType).toLowerCase() === 'email' ? state.accountIdentifier : '')
        || state.accountIdentifier
      );
    }

    function resolveSessionAccountEmail(session = {}) {
      return normalizeEmail(
        session.email
        || session.session?.user?.email
        || session.session?.email
        || session.session?.user_email
        || session.user?.email
        || session.user_email
      );
    }

    function resolveAccountEmail(state = {}, session = {}) {
      const targetEmail = resolveTargetAccountEmail(state);
      const sessionEmail = resolveSessionAccountEmail(session);
      if (targetEmail && sessionEmail && targetEmail !== sessionEmail) {
        throw new Error(`步骤 7：当前 ChatGPT 登录态邮箱 ${sessionEmail} 与本轮目标邮箱 ${targetEmail} 不一致，已停止，避免把 2FA/Free 分组写到错误账号。`);
      }
      return sessionEmail || targetEmail;
    }

    async function getMergedState(state = {}) {
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      return {
        ...(latestState || {}),
        ...(state || {}),
      };
    }

    async function recordStep7AccountCheckpoint({
      runtimeState = {},
      patch = {},
      email = '',
      visibleStep = 7,
      nodeId = 'enable-totp-mfa',
      success = false,
    } = {}) {
      if (typeof appendAccountRunRecord !== 'function') {
        return null;
      }
      const accountEmail = normalizeString(email || runtimeState.email || runtimeState.registrationEmailState?.current).toLowerCase();
      if (!accountEmail) {
        await addStepLog(visibleStep, '已到达第 7 步，但当前邮箱为空，无法写入账号记录。', 'warn');
        return null;
      }

      const checkpointState = await getMergedState({
        ...patch,
        email: accountEmail,
        accountIdentifierType: runtimeState.accountIdentifierType || 'email',
        accountIdentifier: runtimeState.accountIdentifier || accountEmail,
        password: normalizeString(runtimeState.password || runtimeState.customPassword),
        currentNodeId: nodeId || 'enable-totp-mfa',
      });
      const reason = success
        ? `步骤 ${visibleStep}：已到达第 7 步并开通 2FA，账号已记录，可后续查询。`
        : `步骤 ${visibleStep}：已到达第 7 步，账号邮箱已记录，可后续查询。`;
      await appendAccountRunRecord('running', checkpointState, reason);
      await addStepLog(
        visibleStep,
        success
          ? `已更新第 7 步账号记录，后续可按邮箱查询：${accountEmail}`
          : `已记录到达第 7 步账号，后续可按邮箱查询：${accountEmail}`,
        'info'
      );
      return checkpointState;
    }

    async function readSupportedSessionTab(tabId) {
      const numericTabId = Number(tabId) || 0;
      if (!numericTabId || !chrome?.tabs?.get) {
        return null;
      }
      const tab = await chrome.tabs.get(numericTabId).catch(() => null);
      return tab?.id && isSupportedSessionUrl(tab.url) ? tab : null;
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
        ? await getTabId(CHATGPT_SOURCE)
        : null;
      if (registeredTabId && typeof isTabAlive === 'function' && await isTabAlive(CHATGPT_SOURCE)) {
        const registeredTab = await readSupportedSessionTab(registeredTabId);
        if (registeredTab?.id) {
          return registeredTab.id;
        }
      }

      const storedTabId = Number(state?.chatgptSessionReaderTabId) || 0;
      const storedTab = await readSupportedSessionTab(storedTabId);
      if (storedTab?.id) {
        if (typeof registerTab === 'function') {
          await registerTab(CHATGPT_SOURCE, storedTab.id);
        }
        return storedTab.id;
      }

      const fallbackTab = await findFallbackSessionTab();
      if (fallbackTab?.id) {
        if (typeof registerTab === 'function') {
          await registerTab(CHATGPT_SOURCE, fallbackTab.id);
        }
        return fallbackTab.id;
      }

      throw new Error('未找到可开通 2FA 的 ChatGPT 标签页，请先打开已登录的 ChatGPT 页面。');
    }

    async function ensureChatGptSecurityTab(tabId, visibleStep) {
      let tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
      if (!tab?.id) {
        throw new Error(`步骤 ${visibleStep}：ChatGPT 标签页不存在或已关闭，无法开通 2FA。`);
      }
      if (!isChatGptUrl(tab.url)) {
        await addStepLog(visibleStep, '当前标签页不在 chatgpt.com，正在切换到 ChatGPT 安全设置页...', 'info');
        tab = await chrome.tabs.update(tab.id, { url: CHATGPT_SECURITY_URL, active: true }).catch(() => tab);
      } else if (chrome?.tabs?.update) {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      }
      await waitForTabCompleteUntilStopped(tab.id, {
        timeoutMs: SESSION_TAB_COMPLETE_TIMEOUT_MS,
        retryDelayMs: 300,
      });
      await sleepWithStop(500);
      const latestTab = await chrome?.tabs?.get?.(tab.id).catch(() => tab);
      if (!isChatGptUrl(latestTab?.url || tab.url)) {
        throw new Error(`步骤 ${visibleStep}：未能打开 chatgpt.com，无法读取 ChatGPT 会话。`);
      }
      if (typeof registerTab === 'function') {
        await registerTab(CHATGPT_SOURCE, tab.id);
      }
      return latestTab || tab;
    }

    async function executeChatGptFetch(tabId, input = {}) {
      if (!chrome?.scripting?.executeScript) {
        throw new Error('当前浏览器不支持 chrome.scripting.executeScript，无法读取 ChatGPT 会话。');
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (request) => {
          const response = await fetch(request.url, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: {
              accept: 'application/json, text/plain, */*',
            },
          });
          const text = await response.text().catch(() => '');
          let payload = null;
          if (text) {
            try {
              payload = JSON.parse(text);
            } catch {
              payload = { text: text.slice(0, 2000) };
            }
          }
          return {
            ok: response.ok,
            status: response.status,
            payload,
          };
        },
        args: [input],
      }).catch((error) => {
        throw new Error(`ChatGPT 会话读取脚本执行失败：${error?.message || error}`);
      });
      const result = Array.isArray(results) ? results[0]?.result : null;
      if (!result) {
        throw new Error('ChatGPT 会话读取脚本没有返回结果。');
      }
      return result;
    }

    async function readAuthSessionInTab(tabId) {
      const result = await executeChatGptFetch(tabId, {
        url: 'https://chatgpt.com/api/auth/session',
      });
      if (result.ok === false) {
        throw new Error(`/api/auth/session 请求失败（HTTP ${result.status || 0}）。`);
      }
      const payload = result.payload && typeof result.payload === 'object' ? result.payload : {};
      return {
        accessToken: normalizeString(payload.accessToken || payload.access_token),
        sessionToken: normalizeString(payload.sessionToken || payload.session_token),
        email: normalizeString(payload.user?.email || payload.email),
        session: payload,
      };
    }

    async function readSessionCookieDataFromCookies(tab = {}) {
      if (!chrome?.cookies?.getAll) {
        return { sessionToken: '', cookie: '' };
      }
      const urls = [
        isSupportedSessionUrl(tab?.url) ? tab.url : '',
        'https://chatgpt.com/',
        'https://chat.openai.com/',
      ].filter(Boolean);
      const stores = chrome.cookies.getAllCookieStores
        ? await chrome.cookies.getAllCookieStores().catch(() => [{ id: undefined }])
        : [{ id: undefined }];
      const cookies = [];
      const seen = new Set();
      for (const store of stores || [{ id: undefined }]) {
        const storeId = store?.id;
        for (const url of urls) {
          const batch = await chrome.cookies.getAll({
            url,
            ...(storeId ? { storeId } : {}),
          }).catch(() => []);
          for (const cookie of batch || []) {
            const key = [
              cookie.storeId || storeId || '',
              cookie.domain || '',
              cookie.path || '',
              cookie.name || '',
              cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
            ].join('|');
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            cookies.push(cookie);
          }
        }
      }
      return {
        sessionToken: pickSessionTokenFromCookies(cookies),
        cookie: buildCookieHeaderFromCookies(cookies),
      };
    }

    async function readSessionTokenFromCookies(tab = {}) {
      return (await readSessionCookieDataFromCookies(tab)).sessionToken;
    }

    async function postTotpEnable({ apiUrl, apiKey, token, sessionToken, cookie, deviceId }) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法请求 TOTP 2FA 开通接口。');
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), TOTP_ENABLE_TIMEOUT_MS)
        : null;
      try {
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
          headers['X-External-Api-Key'] = apiKey;
        }
        const response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            token,
            ...(sessionToken ? { sessionToken } : {}),
            ...(cookie ? { cookie } : {}),
            ...(deviceId ? { deviceId } : {}),
          }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = await readResponseBody(response);
        if (isHtmlResponsePayload(response, payload)) {
          throw new Error('TOTP 2FA 开通接口返回了 HTML 页面，可能 API Base URL 填错，或后端没有 /api/v1/totp/enable 路由。');
        }
        if (!response?.ok) {
          const payloadError = getPayloadError(payload);
          throw new Error(`TOTP 2FA 开通接口请求失败：POST ${apiUrl} 返回 HTTP ${response?.status || 0}${payloadError ? `：${payloadError}` : ''}`);
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.ok === false) {
          throw new Error(`TOTP 2FA 开通接口返回失败：${getPayloadError(payload) || 'unknown'}`);
        }
        return payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : {};
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('TOTP 2FA 开通接口请求超时。');
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    async function postTotpLookup({ apiUrl, apiKey, email }) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法请求 TOTP 2FA 查询接口。');
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), TOTP_LOOKUP_TIMEOUT_MS)
        : null;
      try {
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
          headers['X-External-Api-Key'] = apiKey;
        }
        const response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            email,
            ...(apiKey ? { key: apiKey } : {}),
          }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = await readResponseBody(response);
        if (isHtmlResponsePayload(response, payload)) {
          throw new Error('TOTP 2FA 查询接口返回了 HTML 页面，可能 API Base URL 填错，或后端没有 /api/v1/totp/lookup 路由。');
        }
        if (!response?.ok) {
          const payloadError = getPayloadError(payload);
          throw new Error(`TOTP 2FA 查询接口请求失败：POST ${apiUrl} 返回 HTTP ${response?.status || 0}${payloadError ? `：${payloadError}` : ''}`);
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.ok === false) {
          throw new Error(`TOTP 2FA 查询接口返回失败：${getPayloadError(payload) || 'unknown'}`);
        }
        return payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : {};
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('TOTP 2FA 查询接口请求超时。');
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    async function executeEnableTotpMfa(state = {}) {
      throwIfStopped();
      const runtimeState = await getMergedState(state);
      const visibleStep = resolveVisibleStep(runtimeState);
      if (shouldRequireGptPasswordBeforeTotp(runtimeState) && !runtimeState.gptPasswordSet) {
        throw new Error(`步骤 ${visibleStep}：UPI 2FA 流程必须先完成“设置 GPT 密码”，已停止当前账号，避免继续开通 2FA 或检测资格。`);
      }
      await setState({
        totpMfaEnabled: false,
        totpMfaSecret: '',
        totpMfaSecretMasked: '',
        totpMfaEnabledAt: '',
        totpMfaAlreadyEnabled: false,
        totpMfaFactorId: '',
        totpMfaOtpauthUrl: '',
        totpMfaApiPersisted: false,
      });

      await addStepLog(visibleStep, '正在通过 Nerver API 开通 ChatGPT TOTP 2FA，成功后检测 UPI 试用资格...', 'info');
      const tabId = await resolveSessionTabId(runtimeState);
      const tab = await ensureChatGptSecurityTab(tabId, visibleStep);
      const authSession = await readAuthSessionInTab(tab.id);
      const accessToken = normalizeString(authSession.accessToken);
      if (!accessToken) {
        throw new Error(`步骤 ${visibleStep}：未读取到 ChatGPT accessToken，请确认当前 ChatGPT 标签页仍处于已登录状态。`);
      }
      const cookieData = await readSessionCookieDataFromCookies(tab);
      const sessionToken = normalizeString(authSession.sessionToken || cookieData.sessionToken);
      const cookieHeader = normalizeString(cookieData.cookie);
      if (!sessionToken && !cookieHeader) {
        await addStepLog(visibleStep, '未读取到 ChatGPT sessionToken/cookie，将只使用 accessToken 调用 TOTP 2FA 开通接口。', 'warn');
      }

      const apiUrl = buildTotpEnableApiUrl(runtimeState);
      const apiKey = getTotpApiAuthToken(runtimeState);
      const deviceId = normalizeString(runtimeState.totpMfaDeviceId) || createDeviceId();
      const accountEmail = resolveAccountEmail(runtimeState, authSession);
      try {
        await recordStep7AccountCheckpoint({
          runtimeState,
          email: accountEmail,
          visibleStep,
          nodeId: state?.nodeId || 'enable-totp-mfa',
        });
      } catch (recordError) {
        await addStepLog(
          visibleStep,
          `已到达第 7 步，但写入账号记录失败：${getErrorMessage(recordError)}`,
          'warn'
        );
      }

      const recoverPersistedTotpSecret = async (reasonLabel = '') => {
        if (!accountEmail) {
          await addStepLog(visibleStep, '2FA：接口异常后无法执行 lookup，因为缺少当前账号邮箱。', 'warn');
          return null;
        }
        const lookupUrl = buildTotpLookupApiUrl(runtimeState);
        await addStepLog(
          visibleStep,
          `2FA：${reasonLabel || 'enable 未返回密钥'}，正在按邮箱 ${accountEmail} 查询已落库 TOTP 密钥...`,
          'warn'
        );
        try {
          const lookupPayload = await postTotpLookup({
            apiUrl: lookupUrl,
            apiKey: getTotpLookupKey(runtimeState),
            email: accountEmail,
          });
          const lookupSecret = normalizeTotpSecret(lookupPayload.secret);
          if (!lookupSecret) {
            await addStepLog(visibleStep, `2FA lookup 未返回 TOTP secret：${getPayloadError(lookupPayload) || lookupPayload.reason || 'empty-secret'}`, 'warn');
            return null;
          }
          await addStepLog(visibleStep, `2FA lookup 已找回已落库密钥：${maskTotpSecret(lookupSecret)}`, 'success');
          return {
            ...lookupPayload,
            secret: lookupSecret,
            reason: normalizeString(lookupPayload.reason) || 'lookup-recovered',
            persisted: lookupPayload.persisted !== false,
          };
        } catch (lookupError) {
          await addStepLog(visibleStep, `2FA lookup 查询失败：${getErrorMessage(lookupError)}`, 'warn');
          return null;
        }
      };

      await addStepLog(visibleStep, buildTotpEnableRequestLog(apiUrl, {
        accessToken,
        sessionToken,
        cookie: cookieHeader,
        deviceId,
      }), 'info');
      let payload = null;
      let lastEnableError = null;
      for (let attempt = 1; attempt <= TOTP_ENABLE_MAX_ATTEMPTS; attempt += 1) {
        try {
          if (attempt > 1) {
            await addStepLog(visibleStep, `2FA：正在第 ${attempt}/${TOTP_ENABLE_MAX_ATTEMPTS} 次重试 enable 接口...`, 'warn');
          }
          payload = await postTotpEnable({
            apiUrl,
            apiKey,
            token: accessToken,
            sessionToken,
            cookie: cookieHeader,
            deviceId,
          });
          break;
        } catch (enableError) {
          lastEnableError = enableError;
          const message = getErrorMessage(enableError);
          const recoverable = isRecoverableTotpEnableError(enableError);
          await addStepLog(visibleStep, `2FA enable 第 ${attempt}/${TOTP_ENABLE_MAX_ATTEMPTS} 次失败：${message}`, recoverable ? 'warn' : 'error');

          if (recoverable) {
            const recoveredPayload = await recoverPersistedTotpSecret(`enable 超时或服务端临时错误（${message}）`);
            if (recoveredPayload) {
              payload = recoveredPayload;
              break;
            }
          }

          if (!recoverable || attempt >= TOTP_ENABLE_MAX_ATTEMPTS) {
            throw enableError;
          }

          const retryDelayMs = TOTP_ENABLE_RETRY_DELAYS_MS[Math.min(attempt - 1, TOTP_ENABLE_RETRY_DELAYS_MS.length - 1)] || 3000;
          await addStepLog(visibleStep, `2FA：${Math.round(retryDelayMs / 1000)} 秒后重试 enable 接口。`, 'warn');
          await sleepWithStop(retryDelayMs);
        }
      }
      if (!payload) {
        throw lastEnableError || new Error('TOTP 2FA 开通接口未返回结果。');
      }

      let reason = normalizeString(payload.reason).toLowerCase();
      let secret = normalizeTotpSecret(payload.secret);
      let factorId = normalizeString(payload.factorId || payload.factor_id);
      await addStepLog(visibleStep, buildTotpEnableResponseLog(payload), secret ? 'info' : 'warn');
      if ((payload.alreadyEnabled || reason === 'already-enabled') && !secret) {
        const recoveredPayload = await recoverPersistedTotpSecret('接口返回账号已开通 2FA 但没有返回密钥');
        if (recoveredPayload) {
          payload = recoveredPayload;
          reason = normalizeString(payload.reason).toLowerCase();
          secret = normalizeTotpSecret(payload.secret);
          factorId = normalizeString(payload.factorId || payload.factor_id);
          await addStepLog(visibleStep, buildTotpEnableResponseLog(payload), 'info');
        }
      }
      if ((payload.alreadyEnabled || reason === 'already-enabled') && !secret) {
        await setState({
          totpMfaEnabled: true,
          totpMfaSecret: '',
          totpMfaSecretMasked: '',
          totpMfaEnabledAt: '',
          totpMfaAlreadyEnabled: true,
          totpMfaFactorId: factorId,
          totpMfaOtpauthUrl: '',
          totpMfaApiPersisted: Boolean(payload.persisted),
        });
        throw new Error('账号已开通 2FA，但接口没有返回 TOTP 密钥，已停止当前账号，避免继续资格检测。');
      }
      if (!secret) {
        throw new Error(`开通 2FA 失败：接口未返回 TOTP secret${reason ? `（reason=${reason}）` : ''}。`);
      }

      const enabledAt = new Date(Math.max(1, Math.floor(Number(now()) || Date.now()))).toISOString();
      const secretMasked = maskTotpSecret(secret);
      const patch = {
        totpMfaEnabled: true,
        totpMfaSecret: secret,
        totpMfaSecretMasked: secretMasked,
        totpMfaEnabledAt: enabledAt,
        totpMfaAlreadyEnabled: false,
        totpMfaFactorId: factorId,
        totpMfaOtpauthUrl: normalizeString(payload.otpauthUrl || payload.otpauth_url),
        totpMfaApiPersisted: Boolean(payload.persisted),
      };
      await setState(patch);
      if (typeof upsertUpiAccountCredentialBackup === 'function') {
        await upsertUpiAccountCredentialBackup({
          email: accountEmail,
          password: normalizeString(runtimeState.password || runtimeState.customPassword),
          ...patch,
          sourceStep: 'enable-totp-mfa',
        });
      }
      try {
        await recordStep7AccountCheckpoint({
          runtimeState,
          patch,
          email: accountEmail,
          visibleStep,
          nodeId: state?.nodeId || 'enable-totp-mfa',
          success: true,
        });
      } catch (recordError) {
        await addStepLog(
          visibleStep,
          `第 7 步账号已开通 2FA，但写入账号记录失败：${getErrorMessage(recordError)}`,
          'warn'
        );
      }
      if (typeof markCurrentRegistrationAccountUsed === 'function') {
        try {
          await markCurrentRegistrationAccountUsed({
            ...runtimeState,
            ...patch,
            email: accountEmail || runtimeState.email,
            accountIdentifierType: runtimeState.accountIdentifierType || 'email',
            accountIdentifier: runtimeState.accountIdentifier || accountEmail || runtimeState.email,
          }, {
            logPrefix: '第 7 步 2FA 已完成',
            level: 'ok',
            preferProvidedState: true,
          });
        } catch (markError) {
          await addStepLog(
            visibleStep,
            `第 7 步 2FA 已完成，但标记当前注册邮箱已用失败：${getErrorMessage(markError)}`,
            'warn'
          );
        }
      }
      if (typeof checkRegistrationUpiTrialEligibility === 'function') {
        await checkRegistrationUpiTrialEligibility({
          state: {
            ...runtimeState,
            email: accountEmail || runtimeState.email,
          },
          patch,
          session: authSession.session || authSession,
          accessToken,
          email: accountEmail,
          visibleStep,
        });
      }
      await addStepLog(visibleStep, `ChatGPT 2FA 已通过 Nerver API 开通，TOTP 密钥：${secretMasked}`, 'success');
      if (state?.suppressNodeCompletion !== true) {
        await completeNodeFromBackground(state?.nodeId || 'enable-totp-mfa', patch);
      }
      return patch;
    }

    return {
      executeEnableTotpMfa,
    };
  }

  return {
    createEnableTotpMfaExecutor,
    generateTotpCode,
    maskTotpSecret,
    normalizeTotpApiBaseUrl,
    normalizeTotpSecret,
  };
});


