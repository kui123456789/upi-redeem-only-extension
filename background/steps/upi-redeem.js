(function attachBackgroundUpiRedeem(root, factory) {
  root.MultiPageBackgroundUpiRedeem = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundUpiRedeemModule() {
  const CHATGPT_SOURCE = 'chatgpt-session-reader';
  const CHATGPT_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/chatgpt-session-reader.js'];
  const SESSION_TAB_COMPLETE_TIMEOUT_MS = 60000;
  const SESSION_CONTENT_READY_TIMEOUT_MS = 45000;
  const SESSION_READ_MESSAGE_TIMEOUT_MS = 30000;
  const SESSION_READ_RESPONSE_TIMEOUT_MS = 15000;
    const UPI_REDEEM_TIMEOUT_MS = 45000;
    const UPI_ACCOUNT_INELIGIBLE_ERROR_PREFIX = 'UPI_ACCOUNT_INELIGIBLE::';
    const UPI_REDEEM_BACKEND_FAILED_ERROR_PREFIX = 'UPI_REDEEM_BACKEND_FAILED::';
    const UPI_REDEEM_AUTH_ERROR_PREFIX = 'UPI_REDEEM_AUTH_ERROR::';
    const UPI_REDEEM_DUPLICATE_CDK_ERROR_PREFIX = 'UPI_REDEEM_DUPLICATE_CDK::';
    const UPI_REDEEM_NOT_ACCEPTED_ERROR_PREFIX = 'UPI_REDEEM_NOT_ACCEPTED::';
    const UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX = 'UPI_ACCESS_TOKEN_EXPIRED::';
    const CHATGPT_SESSION_API_URL = 'https://chatgpt.com/api/auth/session';
    const DEFAULT_UPI_REDEEM_API_BASE_URL = 'https://chong.nerver.cc';
    const DEFAULT_UPI_SUBSCRIPTION_API_BASE_URL = 'https://cha.nerver.cc';

  function createUpiRedeemExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      appendAccountRunRecord = null,
      chrome,
      completeNodeFromBackground,
      deleteUpiCredentialMembershipCredentials = null,
      ensureContentScriptReadyOnTabUntilStopped = async () => {},
      fetchImpl = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      getState = async () => ({}),
      getTabId,
      isTabAlive,
      markCurrentRegistrationAccountUsed = null,
      now = () => Date.now(),
      registerTab,
      sendTabMessageUntilStopped,
      setPersistentSettings = async () => {},
      setState = async () => {},
      broadcastDataUpdate = null,
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
      upsertTrialEligibleFreeCredential = null,
      waitForTabCompleteUntilStopped = async () => {},
    } = deps;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function maskAccessToken(token = '') {
      const text = normalizeString(token);
      if (!text) {
        return '';
      }
      if (text.length <= 12) {
        return `${text.slice(0, 3)}***`;
      }
      return `${text.slice(0, 6)}...${text.slice(-4)}`;
    }

    function decodeBase64UrlJson(value = '') {
      const text = normalizeString(value);
      if (!text) {
        return null;
      }
      try {
        const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
        const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
        const decoded = typeof atob === 'function'
          ? atob(padded)
          : '';
        if (!decoded) {
          return null;
        }
        const jsonText = decodeURIComponent(
          Array.from(decoded)
            .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
            .join('')
        );
        return JSON.parse(jsonText);
      } catch {
        return null;
      }
    }

    function getAccessTokenExpiryMs(token = '') {
      const parts = normalizeString(token).split('.');
      if (parts.length < 2) {
        return 0;
      }
      const payload = decodeBase64UrlJson(parts[1]);
      const expSeconds = Math.floor(Number(payload?.exp) || 0);
      return expSeconds > 0 ? expSeconds * 1000 : 0;
    }

    function isAccessTokenExpiredOrNearExpiry(token = '', skewMs = 60000) {
      const expiresAt = getAccessTokenExpiryMs(token);
      if (!expiresAt) {
        return false;
      }
      return expiresAt <= Math.max(1, Math.floor(Number(now()) || Date.now())) + Math.max(0, skewMs);
    }

    function getAccessTokenExpiryDescription(token = '') {
      const expiresAt = getAccessTokenExpiryMs(token);
      if (!expiresAt) {
        return '';
      }
      const expiresAtText = new Date(expiresAt).toISOString();
      const remainingSeconds = Math.floor((expiresAt - Math.max(1, Math.floor(Number(now()) || Date.now()))) / 1000);
      return `exp=${expiresAtText}，剩余 ${remainingSeconds} 秒`;
    }

    function maskExternalApiKey(key = '') {
      const text = normalizeString(key);
      if (!text) {
        return 'empty';
      }
      if (text.length <= 14) {
        return `${text.slice(0, 4)}***${text.slice(-3)}`;
      }
      return `${text.slice(0, 10)}...${text.slice(-6)}`;
    }

    function toIsoTimestamp(value = now()) {
      const timestamp = Math.max(1, Math.floor(Number(value) || Date.now()));
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    }

    function getUpiRedeemStateValue(state = {}, key = '') {
      const normalizedKey = normalizeString(key);
      if (!normalizedKey) {
        return undefined;
      }
      if (state?.[normalizedKey] !== undefined) {
        return state[normalizedKey];
      }
      const legacyKey = normalizedKey.replace(/^upiRedeem/, 'pixRedeem');
      return legacyKey === normalizedKey ? undefined : state?.[legacyKey];
    }

    function hasOwnStateKey(state = {}, key = '') {
      return Boolean(state && typeof state === 'object' && !Array.isArray(state)
        && Object.prototype.hasOwnProperty.call(state, key));
    }

    function preferLatestUpiRedeemDynamicState(merged = {}, latestState = {}) {
      const dynamicKeys = [
        'upiRedeemCdkeyPoolText',
        'pixRedeemCdkeyPoolText',
        'upiRedeemCdkeyUsage',
        'pixRedeemCdkeyUsage',
      ];
      dynamicKeys.forEach((key) => {
        if (hasOwnStateKey(latestState, key)) {
          merged[key] = latestState[key];
        }
      });
      return merged;
    }

    function getErrorMessage(error) {
      return normalizeString(error?.message || error)
        .replace(new RegExp(`^(?:${UPI_ACCOUNT_INELIGIBLE_ERROR_PREFIX}|${UPI_REDEEM_BACKEND_FAILED_ERROR_PREFIX}|${UPI_REDEEM_AUTH_ERROR_PREFIX}|${UPI_REDEEM_DUPLICATE_CDK_ERROR_PREFIX}|${UPI_REDEEM_NOT_ACCEPTED_ERROR_PREFIX}|${UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX}|PIX_ACCOUNT_INELIGIBLE::)`, 'i'), '');
    }

    function addStepLog(step, message, level = 'info') {
      return rawAddLog(message, level, {
        step,
        stepKey: 'upi-redeem',
      });
    }

    function resolveVisibleStep(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : 6;
    }

    function shouldMarkRegistrationAccountUsedAfterRedeem(state = {}) {
      return getUpiRedeemStateValue(state, 'upiRedeemContinueAfterRedeem') !== true;
    }

    async function getMergedState(state = {}) {
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      return preferLatestUpiRedeemDynamicState({
        ...(latestState || {}),
        ...(state || {}),
      }, latestState);
    }

    function normalizeUpiRedeemApiBaseUrl(value = '') {
      let normalized = normalizeString(value || DEFAULT_UPI_REDEEM_API_BASE_URL)
        .replace(/#.*$/g, '')
        .replace(/\/+$/g, '');
      normalized = normalized
        .replace(/\/api\/external\/cdkey-redeems\/status$/i, '')
        .replace(/\/api\/external\/cdkey-redeems$/i, '')
        .replace(/\/api\/v1\/subscription$/i, '')
        .replace(/\/api\/v1\/check$/i, '')
        .replace(/\/api\/v1\/totp\/(?:enable|lookup)$/i, '')
        .replace(/\/api\/?$/i, '')
        .replace(/\/+$/g, '');
      return normalized || DEFAULT_UPI_REDEEM_API_BASE_URL;
    }

    function getUpiRedeemApiBaseUrl(state = {}) {
      return normalizeUpiRedeemApiBaseUrl(DEFAULT_UPI_REDEEM_API_BASE_URL);
    }

    function buildUpiRedeemApiUrl(state = {}) {
      return `${getUpiRedeemApiBaseUrl(state)}/api/external/cdkey-redeems`;
    }

    function buildUPIAccessTokenCheckApiUrl(state = {}) {
      return `${getUpiSubscriptionApiBaseUrl(state)}/api/v1/check`;
    }

    function buildUpiRedeemStatusApiUrl(state = {}) {
      return `${getUpiRedeemApiBaseUrl(state)}/api/external/cdkey-redeems/status`;
    }

    function normalizeUpiSubscriptionApiBaseUrl(value = '') {
      let normalized = normalizeString(value || DEFAULT_UPI_SUBSCRIPTION_API_BASE_URL).replace(/#.*$/g, '').replace(/\/+$/g, '');
      normalized = normalized.replace(/\/api\/v1\/subscription$/i, '');
      normalized = normalized.replace(/\/api\/v1\/check$/i, '');
      normalized = normalized.replace(/\/api\/v1\/totp\/(?:enable|lookup)$/i, '');
      normalized = normalized.replace(/\/api$/i, '');
      return normalized.replace(/\/+$/g, '') || DEFAULT_UPI_SUBSCRIPTION_API_BASE_URL;
    }

    function getUpiSubscriptionApiBaseUrl(state = {}) {
      return normalizeUpiSubscriptionApiBaseUrl(
        getUpiRedeemStateValue(state, 'upiSubscriptionApiBaseUrl')
        || state?.totpMfaApiBaseUrl
        || state?.totpMfaLookupApiBaseUrl
        || DEFAULT_UPI_SUBSCRIPTION_API_BASE_URL
      );
    }

    function buildUpiSubscriptionApiUrl(value = '') {
      const baseUrl = normalizeUpiSubscriptionApiBaseUrl(value);
      if (!baseUrl) {
        throw new Error('UPI 订阅查询 API 未配置，请先在侧边栏填写订阅 API 地址。');
      }
      return `${baseUrl}/api/v1/subscription`;
    }

    function createUpiRedeemClientId() {
      const stamp = Math.max(1, Math.floor(Number(now()) || Date.now())).toString(36);
      const randomPart = Math.random().toString(36).slice(2, 10) || 'local';
      return `gujumpgate-${stamp}-${randomPart}`;
    }

    async function resolveUpiRedeemClientId(state = {}) {
      const existing = normalizeString(getUpiRedeemStateValue(state, 'upiRedeemClientId'));
      if (existing) {
        return existing;
      }
      const generated = createUpiRedeemClientId();
      await setState({ upiRedeemClientId: generated });
      return generated;
    }

    function parseCdkeyPoolText(value = '') {
      const seen = new Set();
      return String(value || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => normalizeString(line))
        .filter((line) => {
          if (!line || seen.has(line)) {
            return false;
          }
          seen.add(line);
          return true;
        });
    }

    function splitPoolEntrySource(value = []) {
      return Array.isArray(value)
        ? value
        : String(value || '').split(/[\r\n,，;；]+/);
    }

    function parsePoolEntryEmail(value = '') {
      const rawValue = normalizeString(value);
      if (!rawValue) {
        return '';
      }
      const separatorIndex = rawValue.indexOf('----');
      const email = normalizeString(separatorIndex >= 0 ? rawValue.slice(0, separatorIndex) : rawValue).toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
    }

    function resolveCurrentRedeemEmail(state = {}, sessionState = {}) {
      const candidates = [
        sessionState.email,
        sessionState.session?.user?.email,
        sessionState.session?.user_email,
        sessionState.session?.email,
        state.email,
        state.currentEmail,
        state.accountEmail,
        state.accountIdentifierType === 'email' ? state.accountIdentifier : '',
        state.accountIdentifier,
        state.selectedCustomEmailPoolEmail,
      ];
      for (const candidate of candidates) {
        const email = parsePoolEntryEmail(candidate);
        if (email) {
          return email;
        }
      }
      return '';
    }

    function resolveSessionAccountEmail(sessionState = {}) {
      return parsePoolEntryEmail(
        sessionState.email
        || sessionState.session?.user?.email
        || sessionState.session?.email
        || sessionState.session?.user_email
        || sessionState.user?.email
        || sessionState.user_email
      );
    }

    function resolveTargetRedeemEmail(state = {}) {
      return parsePoolEntryEmail(
        state.email
        || state.currentEmail
        || state.accountEmail
        || (normalizeString(state.accountIdentifierType).toLowerCase() === 'email' ? state.accountIdentifier : '')
        || state.accountIdentifier
        || state.selectedCustomEmailPoolEmail
      );
    }

    function assertSessionMatchesTargetEmail({ targetEmail = '', sessionEmail = '', visibleStep = 7 } = {}) {
      const normalizedTargetEmail = parsePoolEntryEmail(targetEmail);
      const normalizedSessionEmail = parsePoolEntryEmail(sessionEmail);
      if (normalizedTargetEmail && normalizedSessionEmail && normalizedTargetEmail !== normalizedSessionEmail) {
        throw new Error(`步骤 ${visibleStep}：当前 ChatGPT 登录态邮箱 ${normalizedSessionEmail} 与本轮目标邮箱 ${normalizedTargetEmail} 不一致，已停止，避免把 AT/Free 分组写到错误账号。`);
      }
      return normalizedSessionEmail || normalizedTargetEmail;
    }

    function normalizeChatGptSessionPayload(value = {}) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
      }
      const nestedSession = value.session;
      if (nestedSession && typeof nestedSession === 'object' && !Array.isArray(nestedSession)) {
        return nestedSession;
      }
      return value;
    }

    function getChatGptSessionAccessToken(value = {}) {
      const session = normalizeChatGptSessionPayload(value);
      return normalizeString(session.accessToken || session.access_token || value?.accessToken || value?.access_token);
    }

    function getChatGptSessionFieldCount(value = {}) {
      const session = normalizeChatGptSessionPayload(value);
      return session && typeof session === 'object' && !Array.isArray(session)
        ? Object.keys(session).length
        : 0;
    }

    function hasChatGptSessionPayload(value = {}) {
      return getChatGptSessionFieldCount(value) > 0;
    }

    function buildUpiRedeemSessionItem({ cdkey = '', session = {}, accessToken = '' } = {}) {
      const normalizedSession = normalizeChatGptSessionPayload(session);
      if (!Object.keys(normalizedSession).length) {
        throw new Error('缺少完整 ChatGPT session，无法提交 UPI 兑换请求。');
      }
      const normalizedAccessToken = getChatGptSessionAccessToken(normalizedSession) || normalizeString(accessToken);
      if (!normalizedAccessToken) {
        throw new Error(`${UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX}ChatGPT session 内缺少 access_token，无法提交 UPI 兑换请求。`);
      }
      return {
        cdkey,
        access_token: normalizedAccessToken,
        accessToken: normalizedAccessToken,
        session: normalizedSession,
      };
    }

    function normalizeTotpSecret(value = '') {
      return normalizeString(value).replace(/\s+/g, '').toUpperCase();
    }

    function buildCurrentUpiCredentialForMembership(state = {}, email = '') {
      return {
        email: parsePoolEntryEmail(email) || resolveCurrentRedeemEmail(state, {}),
        password: normalizeString(
          state.password
          || state.gptPassword
          || state.chatGptPassword
          || state.openAiPassword
          || state.accountPassword
          || state.customPassword
          || ''
        ),
        totpMfaSecret: normalizeTotpSecret(
          state.totpMfaSecret
          || state.totpSecret
          || state.twoFactorSecret
          || state.twoFaSecret
          || ''
        ),
      };
    }

    function normalizeEmailPoolValues(value = []) {
      const seen = new Set();
      const entries = [];
      for (const item of splitPoolEntrySource(value)) {
        const rawValue = item && typeof item === 'object'
          ? (item.credential || item.email || '')
          : item;
        const email = parsePoolEntryEmail(rawValue);
        if (!email || seen.has(email)) {
          continue;
        }
        seen.add(email);
        entries.push(email);
      }
      return entries;
    }

    function normalizeCustomEmailPoolEntryObjectsForCleanup(value = []) {
      const seen = new Set();
      const entries = [];
      for (const rawEntry of splitPoolEntrySource(value)) {
        const source = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
          ? rawEntry
          : { email: rawEntry };
        const email = parsePoolEntryEmail(source.credential || source.email || '');
        if (!email || seen.has(email)) {
          continue;
        }
        seen.add(email);
        entries.push({
          ...source,
          email,
          enabled: source.enabled !== undefined ? Boolean(source.enabled) : true,
          used: Boolean(source.used),
        });
      }
      return entries;
    }

    function removeCdkeyFromPoolText(value = '', cdkey = '') {
      const target = normalizeString(cdkey);
      return parseCdkeyPoolText(value)
        .filter((item) => item !== target)
        .join('\n');
    }

    function removeEmailFromPoolValues(value = [], email = '') {
      const target = normalizeString(email).toLowerCase();
      const seen = new Set();
      const entries = [];
      for (const item of splitPoolEntrySource(value)) {
        const rawValue = item && typeof item === 'object'
          ? (item.credential || item.email || '')
          : item;
        const entryText = normalizeString(rawValue);
        const entryEmail = parsePoolEntryEmail(entryText);
        if (!entryEmail || seen.has(entryEmail) || (target && entryEmail === target)) {
          continue;
        }
        seen.add(entryEmail);
        entries.push(entryText);
      }
      return entries;
    }

    function buildSuccessfulRedeemCleanupUpdates(state = {}, cdkey = '', email = '') {
      const updates = {};
      const normalizedEmail = normalizeString(email).toLowerCase();

      if (normalizedEmail) {
        const nextCustomMailProviderPool = removeEmailFromPoolValues(state.customMailProviderPool, normalizedEmail);
        if (normalizeEmailPoolValues(nextCustomMailProviderPool).join('\n') !== normalizeEmailPoolValues(state.customMailProviderPool).join('\n')) {
          updates.customMailProviderPool = nextCustomMailProviderPool;
        }

        const currentStructuredEntries = normalizeCustomEmailPoolEntryObjectsForCleanup(state.customEmailPoolEntries);
        if (currentStructuredEntries.length) {
          const nextStructuredEntries = currentStructuredEntries.filter((entry) => entry.email !== normalizedEmail);
          if (nextStructuredEntries.length !== currentStructuredEntries.length) {
            updates.customEmailPoolEntries = nextStructuredEntries;
            updates.customEmailPool = nextStructuredEntries
              .filter((entry) => entry.enabled && !entry.used)
              .map((entry) => entry.email);
          }
        } else {
          const nextCustomEmailPool = removeEmailFromPoolValues(state.customEmailPool, normalizedEmail);
          if (normalizeEmailPoolValues(nextCustomEmailPool).join('\n') !== normalizeEmailPoolValues(state.customEmailPool).join('\n')) {
            updates.customEmailPool = nextCustomEmailPool;
          }
        }

        if (normalizeString(state.selectedCustomEmailPoolEmail).toLowerCase() === normalizedEmail) {
          updates.selectedCustomEmailPoolEmail = '';
        }
      }

      return updates;
    }

    function normalizeUpiRedeemCdkeyUsage(rawUsage = {}) {
      const usage = (rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage))
        ? rawUsage
        : {};
      const result = {};
      Object.entries(usage).forEach(([rawCdkey, rawEntry]) => {
        const cdkey = normalizeString(rawCdkey);
        if (!cdkey) {
          return;
        }
        const entry = (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry))
          ? rawEntry
          : {};
        const normalizedEntry = {
          usedAt: Math.max(0, Math.floor(Number(entry.usedAt) || 0)),
          lastAttemptAt: Math.max(0, Math.floor(Number(entry.lastAttemptAt) || 0)),
          lastError: normalizeString(entry.lastError),
          enabled: entry.enabled !== false,
          email: normalizeString(entry.email || entry.accountEmail || entry.credentialEmail).toLowerCase(),
          accessToken: normalizeString(entry.accessToken || entry.access_token || entry.upiRedeemAccessToken),
          accessTokenMasked: normalizeString(entry.accessTokenMasked),
          accessTokenUpdatedAt: Math.max(0, Math.floor(Number(entry.accessTokenUpdatedAt) || Number(entry.tokenUpdatedAt) || 0)),
          lastFailedEmail: normalizeString(entry.lastFailedEmail).toLowerCase(),
          lastFailedAt: Math.max(0, Math.floor(Number(entry.lastFailedAt) || 0)),
          lastFailedReason: normalizeString(entry.lastFailedReason),
          releasedEmail: normalizeString(entry.releasedEmail || entry.approveBlockedEmail).toLowerCase(),
          releaseReason: normalizeString(entry.releaseReason),
          releasedAt: Math.max(0, Math.floor(Number(entry.releasedAt) || 0)),
          remoteStatus: normalizeString(entry.remoteStatus),
          remoteMessage: normalizeString(entry.remoteMessage),
          remoteCheckedAt: Math.max(0, Math.floor(Number(entry.remoteCheckedAt) || 0)),
          retryCount: Math.max(0, Math.floor(Number(entry.retryCount) || 0)),
          lastRetryAt: Math.max(0, Math.floor(Number(entry.lastRetryAt) || 0)),
          retrying: entry.retrying === true,
          retryError: normalizeString(entry.retryError),
        };
        if (entry.subscriptionActive === true || entry.subscriptionActive === false) {
          normalizedEntry.subscriptionActive = Boolean(entry.subscriptionActive);
        }
        const subscriptionPlanType = normalizeSubscriptionPlanType(entry.subscriptionPlanType || entry.subscription_plan_type);
        if (subscriptionPlanType) {
          normalizedEntry.subscriptionPlanType = subscriptionPlanType;
        }
        const subscriptionCheckedAt = Math.max(0, Math.floor(Number(entry.subscriptionCheckedAt) || 0));
        if (subscriptionCheckedAt) {
          normalizedEntry.subscriptionCheckedAt = subscriptionCheckedAt;
        }
        const subscriptionReason = normalizeString(entry.subscriptionReason);
        if (subscriptionReason) {
          normalizedEntry.subscriptionReason = subscriptionReason;
        }
        result[cdkey] = normalizedEntry;
      });
      return result;
    }

    function isActiveRemoteStatus(status = '') {
      return [
	        'pending',
	        'pending_token',
	        'pending_dispatch',
	        'dispatched',
        'dispatching',
        'running',
        'redeeming',
        'processing',
        'in_progress',
        'queued',
        'accepted',
        'submitted',
      ].includes(normalizeUpiRedeemRemoteStatus(status));
    }

    function isCdkeyRedeemInFlight(entry = {}) {
      const pendingDispatch = normalizeUpiRedeemRemoteStatus(entry?.remoteStatus) === 'pending_dispatch'
        || normalizeUpiRedeemRemoteStatus(entry?.remoteMessage) === 'pending_dispatch';
      return entry?.retrying === true
        || (pendingDispatch && Boolean(normalizeString(entry?.email || entry?.accessToken)))
        || isActiveRemoteStatus(entry?.remoteStatus)
        || isActiveRemoteStatus(entry?.remoteMessage);
    }

    function isCdkeySelectableForRedeem(entry = {}) {
      if (entry?.enabled === false) {
        return false;
      }
      const remoteStatus = normalizeUpiRedeemRemoteStatus(entry?.remoteStatus);
      const remoteMessageStatus = normalizeUpiRedeemRemoteStatus(entry?.remoteMessage);
      const canceledRemote = remoteStatus === 'canceled' || remoteMessageStatus === 'canceled';
      if (entry?.subscriptionActive === true || (entry?.subscriptionActive === false && !canceledRemote)) {
        return false;
      }
      if (isSuccessfulRemoteStatus(entry?.remoteStatus)
        || isCdkeyRedeemInFlight(entry)) {
        return false;
      }
      if (
        isUpiRedeemDuplicateCdkeyMessage(entry?.remoteStatus)
        || isUpiRedeemDuplicateCdkeyMessage(entry?.remoteMessage)
        || isUpiRedeemDuplicateCdkeyMessage(entry?.lastError)
      ) {
        return false;
      }
      return true;
    }

    function pickFirstUnusedCdkey(cdkeys = [], usage = {}) {
      return cdkeys.find((cdkey) => {
        const entry = usage?.[cdkey] || {};
        return isCdkeySelectableForRedeem(entry);
      }) || '';
    }

    async function updateCdkeyUsage(cdkey, updater) {
      const state = await getMergedState({});
      const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(state, 'upiRedeemCdkeyUsage') || {});
      const currentEntry = usage[cdkey] || { usedAt: 0, lastAttemptAt: 0, lastError: '', enabled: true };
      const nextEntry = {
        ...currentEntry,
        ...(updater(currentEntry) || {}),
      };
      const storedEmail = normalizeString(nextEntry.email || nextEntry.accountEmail || nextEntry.credentialEmail).toLowerCase();
      const storedAccessToken = normalizeString(nextEntry.accessToken || nextEntry.access_token || nextEntry.upiRedeemAccessToken);
      const storedEntry = {
        usedAt: Math.max(0, Math.floor(Number(nextEntry.usedAt) || 0)),
        lastAttemptAt: Math.max(0, Math.floor(Number(nextEntry.lastAttemptAt) || 0)),
        lastError: normalizeString(nextEntry.lastError),
        enabled: nextEntry.enabled !== false,
        email: storedEmail,
        releasedEmail: storedEmail ? '' : normalizeString(nextEntry.releasedEmail || nextEntry.approveBlockedEmail).toLowerCase(),
        releaseReason: storedEmail ? '' : normalizeString(nextEntry.releaseReason),
        releasedAt: storedEmail ? 0 : Math.max(0, Math.floor(Number(nextEntry.releasedAt) || 0)),
        lastFailedEmail: normalizeString(nextEntry.lastFailedEmail).toLowerCase(),
        lastFailedAt: Math.max(0, Math.floor(Number(nextEntry.lastFailedAt) || 0)),
        lastFailedReason: normalizeString(nextEntry.lastFailedReason),
        remoteStatus: normalizeString(nextEntry.remoteStatus),
        remoteMessage: normalizeString(nextEntry.remoteMessage),
        remoteCheckedAt: Math.max(0, Math.floor(Number(nextEntry.remoteCheckedAt) || 0)),
        retryCount: Math.max(0, Math.floor(Number(nextEntry.retryCount) || 0)),
        lastRetryAt: Math.max(0, Math.floor(Number(nextEntry.lastRetryAt) || 0)),
        retrying: nextEntry.retrying === true,
        retryError: normalizeString(nextEntry.retryError),
      };
      if (storedAccessToken) {
        storedEntry.accessToken = storedAccessToken;
        storedEntry.accessTokenMasked = normalizeString(nextEntry.accessTokenMasked) || maskAccessToken(storedAccessToken);
        storedEntry.accessTokenUpdatedAt = Math.max(
          0,
          Math.floor(
            Number(nextEntry.accessTokenUpdatedAt)
            || Number(nextEntry.tokenUpdatedAt)
            || Number(nextEntry.lastAttemptAt)
            || Number(now())
            || Date.now()
          )
        );
      }
      if (nextEntry.subscriptionActive === true || nextEntry.subscriptionActive === false) {
        storedEntry.subscriptionActive = Boolean(nextEntry.subscriptionActive);
      }
      const subscriptionPlanType = normalizeSubscriptionPlanType(nextEntry.subscriptionPlanType || nextEntry.subscription_plan_type);
      if (subscriptionPlanType) {
        storedEntry.subscriptionPlanType = subscriptionPlanType;
      }
      const subscriptionCheckedAt = Math.max(0, Math.floor(Number(nextEntry.subscriptionCheckedAt) || 0));
      if (subscriptionCheckedAt) {
        storedEntry.subscriptionCheckedAt = subscriptionCheckedAt;
      }
      const subscriptionReason = normalizeString(nextEntry.subscriptionReason);
      if (subscriptionReason) {
        storedEntry.subscriptionReason = subscriptionReason;
      }
      await setState({
        upiRedeemCdkeyUsage: {
          ...usage,
          [cdkey]: storedEntry,
        },
      });
    }

    async function reserveCdkeyForRedeemSubmission({
      cdkey = '',
      email = '',
      accessToken = '',
      attemptAt = 0,
      message = '',
    } = {}) {
      const normalizedCdkey = normalizeString(cdkey);
      if (!normalizedCdkey) {
        return;
      }
      const timestamp = Math.max(1, Math.floor(Number(attemptAt) || Number(now()) || Date.now()));
      await updateCdkeyUsage(normalizedCdkey, (entry) => ({
        ...entry,
        email: normalizeString(email || entry.email || entry.accountEmail || entry.credentialEmail).toLowerCase(),
        accessToken: normalizeString(accessToken || entry.accessToken || entry.access_token || entry.upiRedeemAccessToken),
        accessTokenMasked: normalizeString(accessToken) ? maskAccessToken(accessToken) : normalizeString(entry.accessTokenMasked),
        accessTokenUpdatedAt: timestamp,
        usedAt: 0,
        lastAttemptAt: timestamp,
        lastError: '',
        remoteStatus: 'dispatching',
        remoteMessage: normalizeString(message) || '正在提交到兑换后端，等待远端接收',
        remoteCheckedAt: timestamp,
        retrying: false,
        retryError: '',
      }));
    }

    async function releaseCdkeyForUnacceptedSubmission({
      cdkey = '',
      reason = '',
      attemptAt = 0,
    } = {}) {
      const normalizedCdkey = normalizeString(cdkey);
      if (!normalizedCdkey) {
        return;
      }
      const timestamp = Math.max(1, Math.floor(Number(attemptAt) || Number(now()) || Date.now()));
      const releaseReason = normalizeString(reason) || '兑换接口未确认接收当前卡密，后端没有兑换记录。';
      await updateCdkeyUsage(normalizedCdkey, (entry) => ({
        ...entry,
        usedAt: 0,
        lastAttemptAt: timestamp,
        lastError: '',
        enabled: entry.enabled !== false,
        email: '',
        accessToken: '',
        accessTokenMasked: '',
        accessTokenUpdatedAt: 0,
        releasedEmail: '',
        releaseReason: '',
        releasedAt: 0,
        remoteStatus: 'not_found',
        remoteMessage: `${releaseReason} 卡密已释放，可重新提交。`,
        remoteCheckedAt: timestamp,
        retrying: false,
        retryError: '',
      }));
    }

    function normalizeBoolean(value) {
      if (value === true) {
        return true;
      }
      if (value === false || value === null || value === undefined) {
        return false;
      }
      const normalized = normalizeString(value).toLowerCase();
      return ['1', 'true', 'yes', 'y', 'ok', 'active', 'success'].includes(normalized);
    }

    function normalizeSubscriptionPlanType(value = '') {
      const normalized = normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
      if (!normalized) {
        return '';
      }
      if (normalized.includes('team')) {
        return 'team';
      }
      if (normalized.includes('pro')) {
        return 'pro';
      }
      if (normalized.includes('plus')) {
        return 'plus';
      }
      if (normalized.includes('free')) {
        return 'free';
      }
      return normalized;
    }

    function isPaidSubscriptionPlan(value = '') {
      return ['plus', 'pro', 'team'].includes(normalizeSubscriptionPlanType(value));
    }

    function getPaidSubscriptionPlanLabel(value = '') {
      const planType = normalizeSubscriptionPlanType(value);
      if (planType === 'pro') {
        return 'Pro';
      }
      if (planType === 'team') {
        return 'Team';
      }
      return 'Plus';
    }

    function hasOwnValue(source = {}, key = '') {
      return source && Object.prototype.hasOwnProperty.call(source, key);
    }

    function isSubscriptionPayloadOk(payload = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
      }
      if (payload.ok === false || payload.success === false) {
        return false;
      }
      const okText = normalizeString(payload.ok || payload.reason || payload.status).toLowerCase();
      if (okText && !['ok', 'true', 'success', 'active'].includes(okText)) {
        return false;
      }
      return true;
    }

    function getSubscriptionPayloadPlanType(payload = {}) {
      return normalizeSubscriptionPlanType(
        payload?.plan_type
        || payload?.planType
        || payload?.subscription_plan
        || payload?.subscriptionPlan
        || ''
      );
    }

    function isActivePlusSubscriptionPayload(payload = {}) {
      if (!isSubscriptionPayloadOk(payload)) {
        return false;
      }
      const planType = getSubscriptionPayloadPlanType(payload);
      if (!isPaidSubscriptionPlan(planType)) {
        return false;
      }
      const hasActiveSignal = hasOwnValue(payload, 'has_active_subscription')
        || hasOwnValue(payload, 'hasActiveSubscription')
        || hasOwnValue(payload, 'subscription_active')
        || hasOwnValue(payload, 'subscriptionActive');
      if (!hasActiveSignal) {
        return true;
      }
      return normalizeBoolean(
        payload.has_active_subscription
        ?? payload.hasActiveSubscription
        ?? payload.subscription_active
        ?? payload.subscriptionActive
      );
    }

    function isSupportedChatGptSessionUrl(url = '') {
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

    function getSessionTabHostPriority(url = '') {
      try {
        const hostname = normalizeString(new URL(String(url || '')).hostname).toLowerCase();
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
      return tab?.id && isSupportedChatGptSessionUrl(tab.url) ? tab : null;
    }

    async function findFallbackSessionTab() {
      if (!chrome?.tabs?.query) {
        return null;
      }
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const activeMatch = pickPreferredSessionTab(activeTabs);
      if (activeMatch?.id) {
        return activeMatch;
      }
      const allTabs = await chrome.tabs.query({}).catch(() => []);
      return pickPreferredSessionTab(allTabs);
    }

    async function resolveSessionTabId(state = {}) {
      const activeTab = await findFallbackSessionTab();
      if (activeTab?.id && getSessionTabActivityPriority(activeTab) === 0) {
        if (typeof registerTab === 'function') {
          await registerTab(CHATGPT_SOURCE, activeTab.id);
        }
        return activeTab.id;
      }

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

      const fallbackTab = activeTab || await findFallbackSessionTab();
      if (fallbackTab?.id) {
        if (typeof registerTab === 'function') {
          await registerTab(CHATGPT_SOURCE, fallbackTab.id);
        }
        return fallbackTab.id;
      }

      throw new Error('未找到可读取 ChatGPT session 的标签页，请先打开已登录的 ChatGPT / OpenAI 页面。');
    }

    async function getResolvedSessionTab(tabId, visibleStep) {
      const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
      if (!tab?.id) {
        throw new Error(`步骤 ${visibleStep}：ChatGPT session 标签页不存在或已关闭，无法执行 UPI 卡密兑换。`);
      }
      if (!isSupportedChatGptSessionUrl(tab.url)) {
        throw new Error(`步骤 ${visibleStep}：当前标签页不在 ChatGPT / OpenAI 页面，无法读取 ChatGPT session。`);
      }
      return tab;
    }

    async function readSessionWithContentMessage(tabId) {
      if (typeof sendTabMessageUntilStopped !== 'function') {
        return null;
      }
      const sessionResult = await sendTabMessageUntilStopped(tabId, CHATGPT_SOURCE, {
        type: 'READ_CHATGPT_SESSION',
        source: 'background',
        payload: {
          includeSession: true,
          includeAccessToken: true,
          forceRefresh: true,
          sessionApiUrl: CHATGPT_SESSION_API_URL,
        },
      }, {
        timeoutMs: SESSION_READ_MESSAGE_TIMEOUT_MS,
        responseTimeoutMs: SESSION_READ_RESPONSE_TIMEOUT_MS,
        retryDelayMs: 300,
      });
      if (sessionResult?.error) {
        throw new Error(sessionResult.error);
      }
      return sessionResult || null;
    }

    async function readSessionWithScripting(tabId) {
      if (!chrome?.scripting?.executeScript) {
        return null;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (sessionApiUrl) => {
          const response = await fetch(sessionApiUrl, {
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
          };
        },
        args: [CHATGPT_SESSION_API_URL],
      }).catch((error) => {
        throw new Error(`读取 ${CHATGPT_SESSION_API_URL} 失败：${error?.message || error}`);
      });
      const firstResult = Array.isArray(results) ? results[0]?.result : null;
      if (!firstResult) {
        return null;
      }
      if (firstResult.ok === false) {
        throw new Error(`${CHATGPT_SESSION_API_URL} 请求失败（HTTP ${firstResult.status || 0}）。`);
      }
      return firstResult;
    }

    function extractSessionState(sessionResult) {
      const session = sessionResult?.session && typeof sessionResult.session === 'object' && !Array.isArray(sessionResult.session)
        ? sessionResult.session
        : null;
      const accessToken = normalizeString(
        sessionResult?.accessToken
        || sessionResult?.access_token
        || session?.accessToken
        || session?.access_token
      );
      const email = parsePoolEntryEmail(
        sessionResult?.email
        || sessionResult?.user?.email
        || sessionResult?.user_email
        || session?.user?.email
        || session?.user_email
        || session?.email
      );
      return {
        session,
        accessToken,
        email,
      };
    }

    async function readCurrentChatGptSession(tabId, visibleStep) {
      await waitForTabCompleteUntilStopped(tabId, {
        timeoutMs: SESSION_TAB_COMPLETE_TIMEOUT_MS,
        retryDelayMs: 300,
      });
      await sleepWithStop(500);
      let contentError = null;
      try {
        await ensureContentScriptReadyOnTabUntilStopped(CHATGPT_SOURCE, tabId, {
          inject: CHATGPT_INJECT_FILES,
          injectSource: CHATGPT_SOURCE,
          timeoutMs: SESSION_CONTENT_READY_TIMEOUT_MS,
          retryDelayMs: 700,
          logMessage: `步骤 ${visibleStep}：正在等待 ChatGPT 会话页完成加载，再继续读取 UPI 兑换 ChatGPT session...`,
        });
        const contentState = extractSessionState(await readSessionWithContentMessage(tabId));
        if (hasChatGptSessionPayload(contentState)) {
          if (isAccessTokenExpiredOrNearExpiry(contentState.accessToken)) {
            await addStepLog(
              visibleStep,
              `内容脚本返回的 session 内 token 已过期或即将过期（${getAccessTokenExpiryDescription(contentState.accessToken) || '无法读取过期时间'}），仍会按完整 session 提交给 UPI 后端判断。`,
              'warn'
            );
          }
          return contentState;
        } else {
          contentError = new Error('内容脚本没有返回 ChatGPT session。');
        }
      } catch (error) {
        contentError = error;
        await addStepLog(visibleStep, `内容脚本读取 UPI ChatGPT session 失败，改用 ${CHATGPT_SESSION_API_URL} 读取：${getErrorMessage(error) || '未知错误'}`, 'warn');
      }

      let scriptingError = null;
      try {
        const scriptingState = extractSessionState(await readSessionWithScripting(tabId));
        if (hasChatGptSessionPayload(scriptingState)) {
          if (isAccessTokenExpiredOrNearExpiry(scriptingState.accessToken)) {
            await addStepLog(
              visibleStep,
              `${CHATGPT_SESSION_API_URL} 返回的 session 内 token 已过期或即将过期（${getAccessTokenExpiryDescription(scriptingState.accessToken) || '无法读取过期时间'}），仍会按完整 session 提交给 UPI 后端判断。`,
              'warn'
            );
          }
          return scriptingState;
        }
      } catch (error) {
        scriptingError = error;
      }

      if (contentError || scriptingError) {
        const parts = [];
        if (contentError) {
          parts.push(`内容脚本：${getErrorMessage(contentError) || '未知错误'}`);
        }
        if (scriptingError) {
          parts.push(`${CHATGPT_SESSION_API_URL}：${getErrorMessage(scriptingError) || '未知错误'}`);
        }
        throw new Error(`步骤 ${visibleStep}：未读取到有效 ChatGPT session，请确认当前 ChatGPT / OpenAI 标签页仍处于已登录状态。${parts.length ? `（${parts.join('；')}）` : ''}`);
      }

      throw new Error(`步骤 ${visibleStep}：未读取到有效 ChatGPT session，请确认当前 ChatGPT / OpenAI 标签页仍处于已登录状态。`);
    }

    async function refreshCurrentChatGptSessionAndReadToken(tabId, visibleStep, reason = '') {
      await addStepLog(
        visibleStep,
        `UPI 后端判定 ChatGPT session 失效，正在刷新当前 ChatGPT 页面并重新读取完整 session${reason ? `：${reason}` : '。'}`,
        'warn'
      );
      if (chrome?.tabs?.reload) {
        await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
      }
      await waitForTabCompleteUntilStopped(tabId, {
        timeoutMs: SESSION_TAB_COMPLETE_TIMEOUT_MS,
        retryDelayMs: 300,
      });
      await sleepWithStop(1500);
      const freshSessionState = await readCurrentChatGptSession(tabId, visibleStep);
      const freshEmailForLog = resolveCurrentRedeemEmail({}, freshSessionState) || 'unknown';
      await addStepLog(
        visibleStep,
        `已重新读取 UPI 兑换 ChatGPT session：${freshEmailForLog} -> session字段 ${getChatGptSessionFieldCount(freshSessionState)}。`,
        'ok'
      );
      return freshSessionState;
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

    function getPayloadError(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return '';
      }
      if (payload.ok === false || payload.success === false) {
        return normalizeString(payload.error || payload.message || 'UPI 兑换接口返回失败。');
      }
      if (payload.error) {
        return typeof payload.error === 'string'
          ? normalizeString(payload.error)
          : JSON.stringify(payload.error);
      }
      if (Array.isArray(payload.errors) && payload.errors.length) {
        return JSON.stringify(payload.errors);
      }
      const status = normalizeString(payload.status).toLowerCase();
      if (['error', 'failed', 'failure'].includes(status)) {
        return normalizeString(payload.message || payload.status);
      }
      return '';
    }

    function getPayloadErrorDetails(payload) {
      const payloadError = getPayloadError(payload);
      if (payloadError) {
        return payloadError;
      }
      if (typeof payload === 'string') {
        return normalizeString(payload).replace(/\s+/g, ' ').slice(0, 500);
      }
      if (payload && typeof payload === 'object') {
        try {
          return JSON.stringify(payload).slice(0, 500);
        } catch {
          return '';
        }
      }
      return '';
    }

    function isUpiAccessTokenExpiredPayload(payload = {}, statusCode = 0) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
      }
      const code = normalizeString(payload.code || payload.error_code || payload.errorCode);
      const message = normalizeString(payload.message || payload.error || payload.reason);
      return (Number(statusCode) === 401 && code === '10002')
        || /未登录|会话已过期|重新登录|session\s*expired|not\s*logged\s*in|login\s*required|unauthenticated/i.test(message);
    }

    function isUpiAccessTokenExpiredError(error) {
      return normalizeString(error?.message || error).startsWith(UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX)
        || /access[_-]?token[\s\S]*(?:过期|失效|expired|invalid)|(?:未登录|会话已过期|重新登录|session\s*expired)[\s\S]*(?:access[_-]?token|会话|登录)/i.test(getErrorMessage(error));
    }

    async function recordAccessTokenExpiredCdkeyAttempt({
      cdkey = '',
      email = '',
      attemptAt = 0,
      message = '',
    } = {}) {
      const normalizedCdkey = normalizeString(cdkey);
      if (!normalizedCdkey) {
        return;
      }
      await updateCdkeyUsage(normalizedCdkey, (entry) => ({
        ...entry,
        email: normalizeString(email || entry.email || entry.accountEmail || entry.credentialEmail).toLowerCase(),
        accessToken: '',
        accessTokenMasked: '',
        accessTokenUpdatedAt: 0,
        lastAttemptAt: Math.max(0, Math.floor(Number(attemptAt) || 0)),
        lastError: normalizeString(message) || 'ChatGPT session 已过期或当前会话失效。',
        remoteStatus: 'unused',
        remoteMessage: 'ChatGPT session 已过期或当前会话失效，未进入兑换处理，卡密已释放。',
        remoteCheckedAt: Math.max(0, Math.floor(Number(attemptAt) || 0)),
        retrying: false,
        retryError: '',
      }));
    }

    function getPayloadItems(payload) {
      if (Array.isArray(payload?.data?.items)) {
        return payload.data.items;
      }
      if (Array.isArray(payload?.items)) {
        return payload.items;
      }
      if (Array.isArray(payload?.data)) {
        return payload.data;
      }
      return [];
    }

    function isEligibilityResultPayload(value = {}) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
      }
      return value.token_ok !== undefined
        || value.tokenOk !== undefined
        || value.eligible !== undefined
        || value.upi_eligible !== undefined
        || value.upiEligible !== undefined
        || normalizeString(value.reason);
    }

    function getEligibilityItem(payload, cdkey) {
      const target = normalizeString(cdkey).toLowerCase();
      const matchedItem = getPayloadItems(payload).find((item) => {
        const itemCdkey = normalizeString(item?.cdkey || item?.cdk).toLowerCase();
        return itemCdkey && itemCdkey === target;
      });
      if (matchedItem) {
        return matchedItem;
      }
      if (isEligibilityResultPayload(payload)) {
        return payload;
      }
      if (isEligibilityResultPayload(payload?.data)) {
        return payload.data;
      }
      return null;
    }

    function getEligibilityFailureMessage(item) {
      if (!item) {
        return 'UPI 资格检查未返回当前卡密结果。';
      }
      const tokenOk = normalizeBoolean(item.token_ok ?? item.tokenOk ?? item.ok);
      if (!tokenOk) {
        return normalizeString(item.message || item.error || item.reason || 'access_token 无效或已过期');
      }
      if (!normalizeBoolean(item.eligible)) {
        return normalizeString(item.message || item.reason || '账号无优惠资格');
      }
      const upiEligibleValue = item.upi_eligible ?? item.upiEligible;
      if (upiEligibleValue !== undefined && !normalizeBoolean(upiEligibleValue)) {
        return normalizeString(item.message || item.upi_eligible_reason || item.upiEligibleReason || item.reason || '账号不满足 UPI 兑换资格');
      }
      return '';
    }

    function isEligibilityTokenInvalidItem(item = {}) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      if (normalizeBoolean(item.token_ok ?? item.tokenOk ?? item.ok)) {
        return false;
      }
      const reason = normalizeString(item.reason || item.error || item.message).toLowerCase();
      return /token|jwt|session|登录|会话|过期|expired|invalid|401|unauthorized/.test(reason)
        || item.token_ok === false
        || item.tokenOk === false;
    }

    function isEligibilityAccountIneligibleItem(item = {}) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      if (!normalizeBoolean(item.token_ok ?? item.tokenOk ?? item.ok)) {
        return false;
      }
      const eligible = normalizeBoolean(item.eligible);
      const upiEligibleValue = item.upi_eligible ?? item.upiEligible;
      const upiEligible = upiEligibleValue === undefined ? true : normalizeBoolean(upiEligibleValue);
      return !eligible || !upiEligible;
    }

    function isFailureStatus(status) {
      return ['failed', 'failure', 'timeout', 'rejected', 'cancelled', 'canceled', 'error'].includes(
        normalizeString(status).toLowerCase()
      );
    }

    function normalizeUpiRedeemRemoteStatus(status = '') {
      const normalized = normalizeString(status).toLowerCase().replace(/[\s-]+/g, '_');
      if (normalized === 'approve_blocked') {
        return 'approve_blocked';
      }
      if (/兑换成功|成功|已兑换|已使用|已用/.test(normalized)) {
        return 'success';
      }
      if (/提交失败|兑换失败|充值失败|失败|超时|拒绝|已拒绝|取消|已取消/.test(normalized)) {
        if (/超时/.test(normalized)) return 'timeout';
        if (/拒绝/.test(normalized)) return 'rejected';
        if (/取消/.test(normalized)) return 'canceled';
        return 'failed';
      }
      if (/未找到|不存在/.test(normalized)) {
        return 'not_found';
      }
      if (/无效|不可用/.test(normalized)) {
        return 'invalid';
      }
	      if (/未使用|未兑换|可用/.test(normalized)) {
	        return 'unused';
	      }
	      if (/waiting|queue|br_recharge|进入兑换队列|兑换队列|等待系统处理|等待.*接单|任务.*等待/.test(normalized)) {
	        return 'queued';
	      }
	      if (/等待处理|待处理|待兑换|待派发/.test(normalized)) {
	        return 'pending_dispatch';
	      }
      if (/派发中|正在派发/.test(normalized)) {
        return 'dispatching';
      }
      if (/已派发/.test(normalized)) {
        return 'dispatched';
      }
      if (/兑换中|处理中|进行中|正在兑换/.test(normalized)) {
        return 'processing';
      }
      if (/已提交|已接收|排队/.test(normalized)) {
        return 'submitted';
      }
      if (normalized === 'succeeded' || normalized === 'redeemed' || normalized === 'used') {
        return 'success';
      }
      if (normalized === 'failure' || normalized === 'error') {
        return 'failed';
      }
      if (normalized === 'cancelled') {
        return 'canceled';
      }
      if (normalized === 'notused' || normalized === 'not_used' || normalized === 'unredeemed') {
        return 'unused';
      }
      return normalized;
    }

    function normalizeApproveBlockedToken(value = '') {
      return normalizeString(value).toLowerCase().replace(/[\s_]+/g, '-');
    }

    function isApproveBlockedRemoteResult(item = {}, status = '', message = '') {
      const values = [
        status,
        message,
        item?.status,
        item?.state,
        item?.result,
        item?.code,
        item?.error_code,
        item?.errorCode,
        item?.message,
        item?.error,
        item?.reason,
      ];
      return values.some((value) => /(^|[^a-z0-9])approve-blocked([^a-z0-9]|$)/i.test(normalizeApproveBlockedToken(value)));
    }

    function isApproveBlockedError(error) {
      return isApproveBlockedRemoteResult({}, '', getErrorMessage(error) || normalizeString(error?.message || error));
    }

    function getRemoteResultEmail(item = {}, fallback = '') {
      return parsePoolEntryEmail(
        item?.email
        || item?.account_email
        || item?.accountEmail
        || item?.credential_email
        || item?.credentialEmail
        || item?.target_email
        || item?.targetEmail
        || fallback
      );
    }

    function isSuccessfulRemoteStatus(status = '') {
      return normalizeUpiRedeemRemoteStatus(status) === 'success';
    }

    function isUnusedRemoteStatus(status = '') {
      return [
        'unused',
        'available',
        'new',
        'ready',
        'failed',
        'timeout',
        'rejected',
        'approve_blocked',
        'not_found',
        'invalid',
      ].includes(normalizeUpiRedeemRemoteStatus(status));
    }

    function isRetryableRemoteStatus(status = '') {
      return ['failed', 'timeout', 'rejected', 'approve_blocked'].includes(normalizeUpiRedeemRemoteStatus(status));
    }

    function isRecoverableCdkeyUsageEntry(entry = {}) {
      if (!entry || entry.enabled === false) {
        return false;
      }
      const remoteStatus = normalizeUpiRedeemRemoteStatus(entry.remoteStatus);
      const remoteMessageStatus = normalizeUpiRedeemRemoteStatus(entry.remoteMessage);
      if (entry.subscriptionActive === true || isSuccessfulRemoteStatus(entry.remoteStatus)) {
        return false;
      }
      if (isCdkeyRedeemInFlight(entry)) {
        return false;
      }
      return isRetryableRemoteStatus(entry.remoteStatus)
        || remoteStatus === 'canceled'
        || remoteMessageStatus === 'canceled'
        || entry.subscriptionActive === false
        || Boolean(normalizeString(entry.lastError || entry.subscriptionReason));
    }

    function mergeCdkeysWithRecoverableUsage(cdkeys = [], usage = {}) {
      const seen = new Set();
      const merged = [];
      for (const cdkey of cdkeys) {
        const normalizedCdkey = normalizeString(cdkey);
        if (!normalizedCdkey || seen.has(normalizedCdkey)) {
          continue;
        }
        seen.add(normalizedCdkey);
        merged.push(normalizedCdkey);
      }
      return merged;
    }

    function isUpiRedeemBackendFailureMessage(error) {
      const message = getErrorMessage(error);
      return /(?:UPI\s*)?(?:卡密|兑换|redeem|cdkey|cdk)[\s\S]*(?:失败|failed|failure|timeout|超时)|(?:失败|failed|failure|timeout|超时)[\s\S]*(?:UPI\s*)?(?:卡密|兑换|redeem|cdkey|cdk)/i.test(message);
    }

    function isUpiRedeemDuplicateCdkeyMessage(message = '') {
      const text = normalizeString(message);
      return /(?:CDK|CDKEY|卡密)[\s\S]*(?:不可重复提交|重复提交|已提交|already\s+submitted|duplicate\s+submit|duplicate\s+submission|already\s+redeemed|already\s+used)|(?:不可重复提交|重复提交|已提交|already\s+submitted|duplicate\s+submit|duplicate\s+submission|already\s+redeemed|already\s+used)[\s\S]*(?:CDK|CDKEY|卡密)/i.test(text);
    }

    function isUpiRedeemDuplicateCdkeyError(error) {
      const rawMessage = normalizeString(error?.message || error);
      return rawMessage.startsWith(UPI_REDEEM_DUPLICATE_CDK_ERROR_PREFIX)
        || isUpiRedeemDuplicateCdkeyMessage(getErrorMessage(error));
    }

    function isUpiRedeemNotAcceptedError(error) {
      return normalizeString(error?.message || error).startsWith(UPI_REDEEM_NOT_ACCEPTED_ERROR_PREFIX);
    }

    function isUpiRedeemApiAuthError(error) {
      const rawMessage = normalizeString(error?.message || error);
      const message = getErrorMessage(error);
      return rawMessage.startsWith(UPI_REDEEM_AUTH_ERROR_PREFIX)
        || /UPI[\s\S]*(?:HTTP\s*40[13]|API\s*Key|ApiKey|External API Key|认证失败|权限不足|无权限|forbidden|unauthorized)/i.test(message)
        || /(?:HTTP\s*40[13]|API\s*Key|ApiKey|External API Key|认证失败|权限不足|无权限|forbidden|unauthorized)[\s\S]*UPI/i.test(message);
    }

    function isUpiAccountIneligibleError(error) {
      return normalizeString(error?.message || error).startsWith(UPI_ACCOUNT_INELIGIBLE_ERROR_PREFIX);
    }

    function getRemoteStatusMessage(item = {}, status = '') {
      return normalizeString(
        item?.message
        || item?.error
        || item?.error_message
        || item?.errorMessage
        || item?.reason
        || status
      );
    }

    function getRemoteStatusTimestamp(item = {}, fallback = 0) {
      const rawTimestamp = item?.usedAt
        ?? item?.used_at
        ?? item?.redeemedAt
        ?? item?.redeemed_at
        ?? item?.completedAt
        ?? item?.completed_at
        ?? item?.updatedAt
        ?? item?.updated_at
        ?? 0;
      if (typeof rawTimestamp === 'string') {
        const parsed = Date.parse(rawTimestamp);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      const numeric = Number(rawTimestamp) || 0;
      return Math.max(0, Math.floor(numeric || fallback || 0));
    }

    function chunkArray(items = [], size = 100) {
      const chunkSize = Math.max(1, Math.floor(Number(size) || 100));
      const chunks = [];
      for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
      }
      return chunks;
    }

    function getRedeemItemFailureMessage(payload, cdkey) {
      const item = getEligibilityItem(payload, cdkey);
      if (!item) {
        return '';
      }
      const status = item.status || item.state || item.result || item.external_status || item.externalStatus;
      if (isApproveBlockedRemoteResult(item, status, getRemoteStatusMessage(item, status))) {
        return getRemoteStatusMessage(item, status) || status || 'approve-blocked';
      }
      if (!isFailureStatus(status) && !item.error && !item.error_code && !item.errorCode) {
        return '';
      }
      return normalizeString(
        item.message
        || item.error
        || item.error_message
        || item.errorMessage
        || item.error_code
        || item.errorCode
        || status
        || 'UPI 兑换接口返回失败。'
      );
    }

    function getPayloadCdkeyItem(payload, cdkey = '') {
      const target = normalizeString(cdkey).toLowerCase();
      if (!target) {
        return null;
      }
      const items = getPayloadItems(payload);
      const matchedItem = items.find((item) => {
        const itemCdkey = normalizeString(item?.cdkey || item?.cdk).toLowerCase();
        return itemCdkey && itemCdkey === target;
      });
      if (matchedItem) {
        return matchedItem;
      }
      const directCdkey = normalizeString(payload?.cdkey || payload?.cdk || payload?.data?.cdkey || payload?.data?.cdk).toLowerCase();
      if (directCdkey && directCdkey === target) {
        return payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? payload.data
          : payload;
      }
      return null;
    }

    function isRedeemAcceptedStatus(status = '') {
      const normalized = normalizeUpiRedeemRemoteStatus(status);
      if (!normalized) {
        return true;
      }
      return !['not_found', 'unused', 'available', 'new', 'ready', 'invalid'].includes(normalized)
        && !isFailureStatus(normalized);
    }

    function isRedeemPayloadItemAccepted(item = {}) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      const status = item.status || item.state || item.result || item.external_status || item.externalStatus;
      if (isApproveBlockedRemoteResult(item, status, getRemoteStatusMessage(item, status))) {
        return false;
      }
      if (item.error || item.error_code || item.errorCode) {
        return false;
      }
      return isRedeemAcceptedStatus(status);
    }

    function getPositiveRedeemAcceptedCount(payload = {}) {
      const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      const data = source.data && typeof source.data === 'object' && !Array.isArray(source.data) ? source.data : {};
      const candidates = [
        source.accepted,
        source.acceptedCount,
        source.accepted_count,
        source.submitted,
        source.submittedCount,
        source.submitted_count,
        source.created,
        source.createdCount,
        source.created_count,
        source.queued,
        source.queuedCount,
        source.queued_count,
        data.accepted,
        data.acceptedCount,
        data.accepted_count,
        data.submitted,
        data.submittedCount,
        data.submitted_count,
        data.created,
        data.createdCount,
        data.created_count,
        data.queued,
        data.queuedCount,
        data.queued_count,
      ];
      return candidates.reduce((maxCount, value) => Math.max(maxCount, Math.floor(Number(value) || 0)), 0);
    }

    async function confirmUpiRedeemSubmissionAccepted({ payload = null, externalApiKey = '', clientId = '', cdkey = '', state = {} } = {}) {
      const responseItem = getPayloadCdkeyItem(payload, cdkey);
      if (responseItem && isRedeemPayloadItemAccepted(responseItem)) {
        return { confirmed: true, source: 'redeem-response', item: responseItem };
      }
      const positiveAcceptedCount = getPositiveRedeemAcceptedCount(payload);
      const statusUrl = buildUpiRedeemStatusApiUrl(state);
      let lastReason = responseItem
        ? '兑换接口响应包含当前卡密，但状态不是已接收。'
        : '兑换接口响应没有返回当前卡密。';
      for (const delayMs of [1000, 2000, 3000]) {
        await sleepWithStop(delayMs);
        let statusPayload = null;
        try {
          statusPayload = await postUPIJson({
            apiUrl: statusUrl,
            externalApiKey,
            clientId,
            body: { cdkeys: [cdkey] },
          });
        } catch (error) {
          lastReason = `状态确认请求失败：${getErrorMessage(error) || error}`;
          continue;
        }
        const statusItem = getPayloadCdkeyItem(statusPayload, cdkey);
        if (statusItem) {
          const remoteStatus = normalizeUpiRedeemRemoteStatus(statusItem.status || statusItem.state || statusItem.result);
          const remoteMessage = getRemoteStatusMessage(statusItem, remoteStatus);
          if (isRedeemAcceptedStatus(remoteStatus)) {
            return { confirmed: true, source: 'status', item: statusItem };
          }
          lastReason = remoteMessage || `状态查询返回 ${remoteStatus || 'unknown'}`;
        } else {
          lastReason = '状态查询未找到当前卡密记录。';
        }
      }
      return {
        confirmed: false,
        reason: positiveAcceptedCount > 0
          ? `${lastReason} 兑换接口只返回汇总数量 ${positiveAcceptedCount}，但状态接口未确认落库。`
          : lastReason,
      };
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

    async function postUPIJson({ apiUrl, externalApiKey, clientId, body }) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法请求 UPI 兑换接口。');
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), UPI_REDEEM_TIMEOUT_MS)
        : null;
      try {
        const response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: {
            'X-External-Api-Key': externalApiKey,
            'X-Client-Id': clientId,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(body),
          ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = await readResponseBody(response);
        if (!response?.ok) {
          const payloadError = getPayloadErrorDetails(payload);
          const statusCode = Number(response?.status) || 0;
          if (isUpiAccessTokenExpiredPayload(payload, statusCode)) {
            throw new Error(`${UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX}ChatGPT session 已过期或当前会话失效：${payloadError || '请刷新当前 ChatGPT 页面后重新读取完整 session。'}`);
          }
          if (statusCode === 401 || statusCode === 403) {
            throw new Error(`${UPI_REDEEM_AUTH_ERROR_PREFIX}UPI 远端接口拒绝请求（HTTP ${statusCode}）：请求：${apiUrl}。当前发送 Key：${maskExternalApiKey(externalApiKey)}。${payloadError ? `后端：${payloadError}` : '没有返回明确原因。'}`);
          }
          throw new Error(`UPI 兑换接口请求失败（HTTP ${response?.status || 0}）${payloadError ? `：${payloadError}` : ''}`);
        }
        const payloadError = getPayloadError(payload);
        if (payloadError) {
          throw new Error(`UPI 兑换接口返回错误：${payloadError}`);
        }
        if (isHtmlResponsePayload(response, payload)) {
          throw new Error(`UPI 兑换接口返回了 HTML 页面，请检查远端兑换服务地址是否正确：${apiUrl}`);
        }
        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('UPI 兑换接口请求超时。');
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    async function postSubscriptionJson({ apiUrl, token }) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法查询 UPI 会员状态。');
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), UPI_REDEEM_TIMEOUT_MS)
        : null;
      try {
        const response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = await readResponseBody(response);
        if (!response?.ok) {
          const payloadError = getPayloadError(payload);
          throw new Error(`UPI 会员状态接口请求失败（HTTP ${response?.status || 0}）${payloadError ? `：${payloadError}` : ''}`);
        }
        if (isHtmlResponsePayload(response, payload)) {
          throw new Error('UPI 会员状态接口返回了 HTML 页面，可能订阅 API 地址填错，或后端没有 /api/v1/subscription 路由。');
        }
        return payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : { ok: false, reason: 'invalid-response' };
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('UPI 会员状态接口请求超时。');
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    async function postEligibilityCheckJson({ apiUrl, token, promoId = '' }) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法请求 UPI 优惠资格验证接口。');
      }
      const normalizedToken = normalizeString(token);
      if (!normalizedToken) {
        throw new Error(`${UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX}缺少 ChatGPT accessToken，无法调用优惠资格验证。`);
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), UPI_REDEEM_TIMEOUT_MS)
        : null;
      try {
        const body = { token: normalizedToken };
        const normalizedPromoId = normalizeString(promoId);
        if (normalizedPromoId) {
          body.promoId = normalizedPromoId;
        }
        const response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          ...(controller ? { signal: controller.signal } : {}),
        });
        const payload = await readResponseBody(response);
        if (!response?.ok) {
          if (isEligibilityResultPayload(payload) || isEligibilityResultPayload(payload?.data)) {
            return payload && typeof payload === 'object' && !Array.isArray(payload)
              ? payload
              : { ok: false, reason: 'invalid-response' };
          }
          const payloadError = getPayloadErrorDetails(payload) || getPayloadError(payload);
          const statusCode = Number(response?.status) || 0;
          if (isUpiAccessTokenExpiredPayload(payload, statusCode)) {
            throw new Error(`${UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX}ChatGPT accessToken 优惠资格验证失败：${payloadError || `HTTP ${statusCode}`}`);
          }
          throw new Error(`UPI 优惠资格验证接口请求失败（HTTP ${statusCode}）${payloadError ? `：${payloadError}` : ''}`);
        }
        if (isHtmlResponsePayload(response, payload)) {
          throw new Error('UPI 优惠资格验证接口返回了 HTML 页面，可能订阅 API 地址填错，或后端没有 /api/v1/check 路由。');
        }
        return payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : { ok: false, reason: 'invalid-response' };
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('UPI 优惠资格验证接口请求超时。');
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    async function checkUPIAccessTokenEligibility({ checkUrl, externalApiKey, clientId, cdkey, session, accessToken }) {
      const payload = await postEligibilityCheckJson({
        apiUrl: checkUrl,
        token: accessToken || getChatGptSessionAccessToken(session),
      });
      const item = getEligibilityItem(payload, cdkey);
      const failureMessage = getEligibilityFailureMessage(item);
      if (failureMessage) {
        const accountIneligible = isEligibilityAccountIneligibleItem(item);
        const tokenInvalid = isEligibilityTokenInvalidItem(item);
        const prefix = accountIneligible
          ? UPI_ACCOUNT_INELIGIBLE_ERROR_PREFIX
          : (tokenInvalid ? UPI_ACCESS_TOKEN_EXPIRED_ERROR_PREFIX : '');
        throw new Error(`${prefix}UPI 资格检查失败：${failureMessage}`);
      }
      return item;
    }

    async function postUpiRedeem({ apiUrl, externalApiKey, clientId, cdkey, session, accessToken, state = {} }) {
      let payload = null;
      try {
        payload = await postUPIJson({
          apiUrl,
          externalApiKey,
          clientId,
          body: {
            items: [buildUpiRedeemSessionItem({ cdkey, session, accessToken })],
          },
        });
      } catch (error) {
        if (isUpiRedeemApiAuthError(error)) {
          throw error;
        }
        if (isUpiRedeemDuplicateCdkeyError(error)) {
          throw new Error(`${UPI_REDEEM_DUPLICATE_CDK_ERROR_PREFIX}${getErrorMessage(error) || 'UPI 卡密已提交过，等待远端状态刷新。'}`);
        }
        if (isUpiRedeemBackendFailureMessage(error)) {
          throw new Error(`${UPI_REDEEM_BACKEND_FAILED_ERROR_PREFIX}${getErrorMessage(error) || 'UPI 卡密兑换失败。'}`);
        }
        throw error;
      }
      const itemFailure = getRedeemItemFailureMessage(payload, cdkey);
      if (itemFailure) {
        if (isUpiRedeemDuplicateCdkeyMessage(itemFailure)) {
          throw new Error(`${UPI_REDEEM_DUPLICATE_CDK_ERROR_PREFIX}UPI 兑换接口返回重复提交：${itemFailure}`);
        }
        throw new Error(`${UPI_REDEEM_BACKEND_FAILED_ERROR_PREFIX}UPI 兑换接口返回错误：${itemFailure}`);
      }
      const acceptance = await confirmUpiRedeemSubmissionAccepted({
        payload,
        externalApiKey,
        clientId,
        cdkey,
        state,
      });
      if (!acceptance.confirmed) {
        throw new Error(`${UPI_REDEEM_NOT_ACCEPTED_ERROR_PREFIX}UPI 兑换接口未确认接收当前卡密，后端没有兑换记录：${acceptance.reason || '状态接口未找到记录'}`);
      }
      return payload;
    }

    async function releaseCdkeyForApproveBlocked({ cdkey = '', email = '', reason = '', attemptAt = 0, visibleStep = 0, state = {} } = {}) {
      const normalizedCdkey = normalizeString(cdkey);
      const normalizedEmail = parsePoolEntryEmail(email) || resolveCurrentRedeemEmail(state, {});
      const releasedAt = Math.max(1, Math.floor(Number(attemptAt) || Number(now()) || Date.now()));
      const releaseReason = normalizeString(reason) || 'approve-blocked';
      if (!normalizedCdkey) {
        return;
      }
      await updateCdkeyUsage(normalizedCdkey, (entry) => ({
        ...entry,
        usedAt: 0,
        lastAttemptAt: releasedAt,
        lastError: '',
        email: '',
        accessToken: '',
        accessTokenMasked: '',
        accessTokenUpdatedAt: 0,
        releasedEmail: normalizedEmail || normalizeString(entry.email).toLowerCase(),
        releaseReason,
        releasedAt,
        remoteStatus: 'approve_blocked',
        remoteMessage: `${releaseReason}；提交被阻塞，已释放卡密`,
        remoteCheckedAt: releasedAt,
        retryCount: 0,
        lastRetryAt: 0,
        retrying: false,
        retryError: '',
        subscriptionActive: undefined,
        subscriptionPlanType: '',
        subscriptionCheckedAt: 0,
        subscriptionReason: '',
      }));
      if (!normalizedEmail) {
        await addStepLog(visibleStep, `后端返回 approve-blocked，已释放卡密 ${normalizedCdkey}，但未能解析邮箱。`, 'warn');
      }
      await addStepLog(
        visibleStep,
        `后端返回 approve-blocked：${normalizedEmail || 'unknown'} 提交被阻塞，已释放卡密 ${normalizedCdkey}，账号保留在 Free 等待重新匹配。`,
        'warn'
      );
    }

    async function refreshUpiRedeemCdkeyStatuses(inputState = {}) {
      const runtimeState = await getMergedState(inputState);
      const statusUrl = buildUpiRedeemStatusApiUrl(runtimeState);
      const externalApiKey = normalizeString(getUpiRedeemStateValue(runtimeState, 'upiRedeemExternalApiKey'));
      if (!externalApiKey) {
        throw new Error('UPI External API Key 未配置，请先在侧边栏填写 UPI 外部 API Key。');
      }
      const clientId = await resolveUpiRedeemClientId(runtimeState);
      const rawCdkeys = Array.isArray(inputState?.cdkeys)
        ? inputState.cdkeys
        : parseCdkeyPoolText(getUpiRedeemStateValue(runtimeState, 'upiRedeemCdkeyPoolText'));
      const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(runtimeState, 'upiRedeemCdkeyUsage') || {});
      const cdkeys = mergeCdkeysWithRecoverableUsage(parseCdkeyPoolText(rawCdkeys.join('\n')), usage);
      if (!cdkeys.length) {
        throw new Error('没有可查询的 UPI 卡密，请先导入卡密。');
      }

      const checkedAt = Math.max(1, Math.floor(Number(now()) || Date.now()));
      const items = [];
      for (const chunk of chunkArray(cdkeys, 100)) {
        const payload = await postUPIJson({
          apiUrl: statusUrl,
          externalApiKey,
          clientId,
          body: { cdkeys: chunk },
        });
        items.push(...getPayloadItems(payload));
      }

      const nextUsage = { ...usage };
      items.forEach((item) => {
        const cdkey = normalizeString(item?.cdkey || item?.cdk);
        if (!cdkey) {
          return;
        }
        const currentEntry = nextUsage[cdkey] || { usedAt: 0, lastAttemptAt: 0, lastError: '', enabled: true };
        const remoteStatus = normalizeUpiRedeemRemoteStatus(item?.status || item?.state || item?.result);
        const remoteMessage = getRemoteStatusMessage(item, remoteStatus);
        const approveBlocked = isApproveBlockedRemoteResult(item, remoteStatus, remoteMessage);
        if (approveBlocked) {
          const releasedEmail = getRemoteResultEmail(item, currentEntry.email);
          const releaseReason = remoteMessage || 'approve-blocked';
          nextUsage[cdkey] = {
            usedAt: 0,
            lastAttemptAt: Math.max(0, Math.floor(Number(currentEntry.lastAttemptAt) || 0)),
            lastError: '',
            enabled: currentEntry.enabled !== false,
            email: '',
            releasedEmail,
            releaseReason,
            releasedAt: checkedAt,
            remoteStatus: 'unused',
            remoteMessage: `${releaseReason}；邮箱不可用，已释放卡密`,
            remoteCheckedAt: checkedAt,
            retryCount: 0,
            lastRetryAt: 0,
            retrying: false,
            retryError: '',
          };
          return;
        }
        if (remoteStatus === 'not_found') {
          const releaseMessage = remoteMessage || '后端无兑换记录';
          nextUsage[cdkey] = {
            usedAt: 0,
            lastAttemptAt: Math.max(0, Math.floor(Number(currentEntry.lastAttemptAt) || 0)),
            lastError: '',
            enabled: currentEntry.enabled !== false,
            email: '',
            releasedEmail: '',
            releaseReason: '',
            releasedAt: 0,
            remoteStatus: 'not_found',
            remoteMessage: `${releaseMessage}；后端无兑换记录，卡密可重新提交`,
            remoteCheckedAt: checkedAt,
            retryCount: Math.max(0, Math.floor(Number(currentEntry.retryCount) || 0)),
            lastRetryAt: Math.max(0, Math.floor(Number(currentEntry.lastRetryAt) || 0)),
            retrying: false,
            retryError: '',
          };
          return;
        }
        const success = isSuccessfulRemoteStatus(remoteStatus);
        const unused = isUnusedRemoteStatus(remoteStatus);
        const failed = isFailureStatus(remoteStatus);
        if (remoteStatus === 'canceled') {
          nextUsage[cdkey] = {
            ...currentEntry,
            usedAt: 0,
            lastError: remoteMessage || '后端已手动取消兑换',
            enabled: currentEntry.enabled !== false,
            email: '',
            accessToken: '',
            accessTokenMasked: '',
            accessTokenUpdatedAt: 0,
            releasedEmail: '',
            releaseReason: '',
            releasedAt: 0,
            lastFailedEmail: '',
            lastFailedAt: 0,
            lastFailedReason: '',
            remoteStatus: 'unused',
            remoteMessage: `${remoteMessage || '后端已手动取消兑换'}；后端已取消，卡密已回到可用池`,
            remoteCheckedAt: checkedAt,
            retrying: false,
            retryError: '',
          };
          delete nextUsage[cdkey].subscriptionActive;
          delete nextUsage[cdkey].subscriptionPlanType;
          delete nextUsage[cdkey].subscriptionCheckedAt;
          delete nextUsage[cdkey].subscriptionReason;
          return;
        }
        if (failed) {
          const failedEmail = normalizeString(currentEntry.email || getRemoteResultEmail(item, '')).toLowerCase();
          nextUsage[cdkey] = {
            ...currentEntry,
            usedAt: 0,
            lastError: remoteMessage,
            enabled: currentEntry.enabled !== false,
            email: '',
            accessToken: '',
            accessTokenMasked: '',
            accessTokenUpdatedAt: 0,
            releasedEmail: '',
            releaseReason: '',
            releasedAt: 0,
            lastFailedEmail: failedEmail,
            lastFailedAt: checkedAt,
            lastFailedReason: remoteMessage || '远端确认兑换失败',
            remoteStatus,
            remoteMessage: `${remoteMessage || '远端确认兑换失败'}；卡密已回到可用池，等待其他账号匹配`,
            remoteCheckedAt: checkedAt,
            retrying: false,
            retryError: '',
          };
          delete nextUsage[cdkey].subscriptionActive;
          delete nextUsage[cdkey].subscriptionPlanType;
          delete nextUsage[cdkey].subscriptionCheckedAt;
          delete nextUsage[cdkey].subscriptionReason;
          return;
        }
        const preserveReleaseInfo = !currentEntry.email && ['unused', 'available', 'new', 'ready'].includes(remoteStatus);
        nextUsage[cdkey] = {
          ...currentEntry,
          usedAt: success
            ? getRemoteStatusTimestamp(item, currentEntry.usedAt || checkedAt)
            : (unused ? 0 : Math.max(0, Math.floor(Number(currentEntry.usedAt) || 0))),
          lastError: success || ['unused', 'available', 'new', 'ready'].includes(remoteStatus)
            ? ''
            : isFailureStatus(remoteStatus) || remoteStatus === 'not_found' || remoteStatus === 'invalid' ? remoteMessage : '',
          enabled: currentEntry.enabled !== false,
          releasedEmail: preserveReleaseInfo ? normalizeString(currentEntry.releasedEmail) : '',
          releaseReason: preserveReleaseInfo ? normalizeString(currentEntry.releaseReason) : '',
          releasedAt: preserveReleaseInfo ? Math.max(0, Math.floor(Number(currentEntry.releasedAt) || 0)) : 0,
          remoteStatus,
          remoteMessage,
          remoteCheckedAt: checkedAt,
          retrying: false,
          retryError: success ? '' : normalizeString(currentEntry.retryError),
        };
        if (!success && !isActiveRemoteStatus(remoteStatus)) {
          delete nextUsage[cdkey].subscriptionActive;
          delete nextUsage[cdkey].subscriptionPlanType;
          delete nextUsage[cdkey].subscriptionCheckedAt;
          delete nextUsage[cdkey].subscriptionReason;
        }
      });

      const updates = { upiRedeemCdkeyUsage: nextUsage };
      await setState(updates);
      return {
        statusUrl,
        checkedAt,
        checkedCount: cdkeys.length,
        items,
        updates,
      };
    }

    async function checkUpiRedeemSubscriptionStatuses(inputState = {}) {
      const runtimeState = await getMergedState(inputState);
      const subscriptionUrl = buildUpiSubscriptionApiUrl(getUpiSubscriptionApiBaseUrl(runtimeState));
      const rawItems = Array.isArray(inputState?.items) ? inputState.items : [];
      const items = rawItems
        .map((item, index) => ({
          id: normalizeString(item?.id || item?.recordId || item?.email || `item-${index}`),
          email: normalizeString(item?.email),
          cdkey: normalizeString(item?.cdkey),
          token: normalizeString(item?.token || item?.accessToken || item?.access_token),
        }))
        .filter((item) => item.id && item.token);
      if (!items.length) {
        return {
          subscriptionUrl,
          checkedCount: 0,
          items: [],
        };
      }

      const results = [];
      for (const item of items) {
        const payload = await postSubscriptionJson({
          apiUrl: subscriptionUrl,
          token: item.token,
        });
        const planType = getSubscriptionPayloadPlanType(payload);
        results.push({
          id: item.id,
          email: item.email,
          cdkey: item.cdkey,
          active: isActivePlusSubscriptionPayload(payload),
          planType,
          hasActiveSubscription: normalizeBoolean(
            payload?.has_active_subscription
            ?? payload?.hasActiveSubscription
            ?? payload?.subscription_active
            ?? payload?.subscriptionActive
          ),
          reason: normalizeString(payload?.reason || payload?.ok || payload?.message || ''),
          payload,
        });
      }
      return {
        subscriptionUrl,
        checkedCount: results.length,
        items: results,
      };
    }

    async function confirmCurrentRedeemPaidSubscription({ state = {}, email = '', cdkey = '', accessToken = '' } = {}) {
      const normalizedEmail = normalizeString(email).toLowerCase();
      const normalizedCdkey = normalizeString(cdkey);
      const token = normalizeString(accessToken);
      const checkedAt = Math.max(1, Math.floor(Number(now()) || Date.now()));
      if (!token) {
        return {
          active: false,
          planType: '',
          checkedAt,
          reason: '缺少 accessToken，无法确认会员状态。',
        };
      }

      try {
        const response = await checkUpiRedeemSubscriptionStatuses({
          ...state,
          items: [{
            id: normalizedEmail || normalizedCdkey || 'current-upi-redeem',
            email: normalizedEmail,
            cdkey: normalizedCdkey,
            token,
          }],
        });
        const item = Array.isArray(response?.items) ? response.items[0] : null;
        const planType = normalizeSubscriptionPlanType(item?.planType || item?.plan_type || '');
        const active = Boolean(item?.active) && isPaidSubscriptionPlan(planType);
        return {
          active,
          planType,
          checkedAt,
          reason: normalizeString(item?.reason || item?.message || ''),
          item,
        };
      } catch (error) {
        return {
          active: false,
          planType: '',
          checkedAt,
          reason: getErrorMessage(error) || '会员状态查询失败。',
          error,
        };
      }
    }

    function getSubscriptionConfirmationReason(subscriptionResult = {}, planType = '') {
      const rawReason = normalizeString(subscriptionResult.reason);
      const normalizedReason = rawReason.toLowerCase();
      const reason = rawReason && !['true', 'ok', 'success'].includes(normalizedReason)
        ? rawReason
        : '';
      return reason
        || (planType ? `当前套餐：${planType}` : '会员状态未激活或未返回 paid plan。');
    }

    async function recordCdkeySubscriptionConfirmation({
      cdkey = '',
      email = '',
      attemptAt = 0,
      subscriptionResult = {},
      subscriptionPlanType = '',
    } = {}) {
      const normalizedCdkey = normalizeString(cdkey);
      if (!normalizedCdkey) {
        return '';
      }
      const checkedAt = Math.max(0, Math.floor(Number(subscriptionResult.checkedAt) || 0));
      const active = Boolean(subscriptionResult.active);
      const reason = getSubscriptionConfirmationReason(subscriptionResult, subscriptionPlanType);
      const attemptTimestamp = Math.max(0, Math.floor(Number(attemptAt) || 0));
      await updateCdkeyUsage(normalizedCdkey, (entry) => {
        const previousUsedAt = Math.max(0, Math.floor(Number(entry.usedAt) || 0));
        const previousRemoteStatus = normalizeUpiRedeemRemoteStatus(entry.remoteStatus);
        const inactiveRemoteStatus = isSuccessfulRemoteStatus(previousRemoteStatus)
          ? 'success'
          : (isActiveRemoteStatus(previousRemoteStatus) ? previousRemoteStatus : 'submitted');
        return {
          ...entry,
          email: normalizeString(email || entry.email || entry.accountEmail || entry.credentialEmail).toLowerCase(),
          usedAt: active ? Math.max(previousUsedAt, attemptTimestamp) : 0,
          lastAttemptAt: Math.max(
            Math.max(0, Math.floor(Number(entry.lastAttemptAt) || 0)),
            attemptTimestamp
          ),
          lastError: '',
          remoteStatus: active ? 'success' : inactiveRemoteStatus,
          remoteMessage: reason,
          remoteCheckedAt: checkedAt || attemptTimestamp,
          subscriptionActive: active,
          subscriptionPlanType,
          subscriptionCheckedAt: checkedAt,
          subscriptionReason: reason,
          retrying: false,
          retryError: '',
        };
      });
      return reason;
    }

    async function checkUpiRedeemAccessTokenEligibility(input = {}) {
      throwIfStopped();
      const runtimeState = await getMergedState(input.state || input.settings || {});
      const chatGptSession = normalizeChatGptSessionPayload(input.session || input.chatGptSession || input.chatgptSession || {});
      const accessToken = getChatGptSessionAccessToken(chatGptSession)
        || normalizeString(input.accessToken || input.token || input.access_token);
      if (!hasChatGptSessionPayload(chatGptSession) && !accessToken) {
        throw new Error('缺少 ChatGPT accessToken，无法检查 UPI 试用资格。');
      }
      const checkUrl = buildUPIAccessTokenCheckApiUrl(runtimeState);
      const forcedCdkey = normalizeString(input.cdkey || input.forceCdkey);
      const item = await checkUPIAccessTokenEligibility({
        checkUrl,
        cdkey: forcedCdkey,
        session: chatGptSession,
        accessToken,
      });
      return {
        cdkey: forcedCdkey,
        eligible: true,
        item,
      };
    }

    async function applyPaidSubscriptionCleanup({ state = {}, cdkey = '', email = '', visibleStep = 0 } = {}) {
      const cleanupUpdates = buildSuccessfulRedeemCleanupUpdates(state, cdkey, email);
      if (!Object.keys(cleanupUpdates).length) {
        return cleanupUpdates;
      }

      await setState(cleanupUpdates);
      try {
        await setPersistentSettings(cleanupUpdates);
      } catch (error) {
        await addStepLog(
          visibleStep,
          `已确认 Plus/Pro/Team，但保存邮箱/卡密列表清理结果失败：${getErrorMessage(error) || error}`,
          'warn'
        );
      }
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate({
          ...cleanupUpdates,
          upiRedeemForceCdkeyPoolRefresh: true,
        });
      }
      return cleanupUpdates;
    }

    async function applyIneligibleAccountCleanup({ state = {}, email = '', visibleStep = 0, reason = '' } = {}) {
      const normalizedEmail = parsePoolEntryEmail(email) || resolveCurrentRedeemEmail(state, {});
      if (!normalizedEmail) {
        await addStepLog(visibleStep, 'UPI 资格检查无资格，但未能解析当前账号邮箱，无法自动删除账号记录。', 'warn');
        return {};
      }

      if (typeof deleteUpiCredentialMembershipCredentials === 'function') {
        try {
          const result = await deleteUpiCredentialMembershipCredentials({
            email: normalizedEmail,
            deleteBackups: true,
          });
          const deletedCount = Math.max(0, Math.floor(Number(result?.deletedCount) || 0));
          await addStepLog(
            visibleStep,
            deletedCount
              ? `UPI 账号无资格：已从 Free/备份账号池删除 ${normalizedEmail}。`
              : `UPI 账号无资格：Free/备份账号池中未找到 ${normalizedEmail}，继续清理注册邮箱池。`,
            'warn'
          );
        } catch (error) {
          await addStepLog(
            visibleStep,
            `UPI 账号无资格：删除 Free/备份账号 ${normalizedEmail} 失败：${getErrorMessage(error) || error}`,
            'warn'
          );
        }
      }

      if (typeof markCurrentRegistrationAccountUsed === 'function') {
        try {
          await markCurrentRegistrationAccountUsed({
            ...state,
            email: normalizedEmail,
            accountIdentifierType: state.accountIdentifierType || 'email',
            accountIdentifier: state.accountIdentifier || normalizedEmail,
          }, {
            logPrefix: 'UPI 资格检查无资格',
            level: 'warn',
          });
        } catch (error) {
          await addStepLog(
            visibleStep,
            `UPI 账号无资格：标记当前注册邮箱已用失败：${getErrorMessage(error) || error}`,
            'warn'
          );
        }
      }

      const cleanupUpdates = buildSuccessfulRedeemCleanupUpdates(state, '', normalizedEmail);
      if (Object.keys(cleanupUpdates).length) {
        await setState(cleanupUpdates);
        try {
          await setPersistentSettings(cleanupUpdates);
        } catch (error) {
          await addStepLog(
            visibleStep,
            `UPI 账号无资格：保存邮箱池删除结果失败：${getErrorMessage(error) || error}`,
            'warn'
          );
        }
        if (typeof broadcastDataUpdate === 'function') {
          broadcastDataUpdate(cleanupUpdates);
        }
      }

      await addStepLog(
        visibleStep,
        `UPI 账号无资格：${normalizedEmail} 已删除/标记已用，后续不会再次拿它注册。${reason ? `原因：${reason}` : ''}`,
        'warn'
      );
      return cleanupUpdates;
    }

    async function checkRegistrationUpiTrialEligibility(input = {}) {
      throwIfStopped();
      const runtimeState = await getMergedState(input.state || {});
      const patch = input.patch && typeof input.patch === 'object' && !Array.isArray(input.patch)
        ? input.patch
        : {};
      const visibleStep = Math.floor(Number(input.visibleStep || runtimeState.visibleStep) || 0)
        || resolveVisibleStep(runtimeState);
      const chatGptSession = normalizeChatGptSessionPayload(input.session || input.chatGptSession || input.chatgptSession || {});
      const accessToken = getChatGptSessionAccessToken(chatGptSession)
        || normalizeString(input.accessToken || input.token || input.access_token);
      const targetEmail = parsePoolEntryEmail(input.email)
        || resolveTargetRedeemEmail({
          ...runtimeState,
          ...patch,
        });
      const sessionEmail = resolveSessionAccountEmail(chatGptSession);
      const email = assertSessionMatchesTargetEmail({ targetEmail, sessionEmail, visibleStep });
      const checkedAt = toIsoTimestamp();

      await addStepLog(
        visibleStep,
        `UPI 注册后试用资格检查：正在检测 ${email || 'unknown'}，通过后才进入 Free 分组。`,
        'info'
      );

      try {
        const eligibility = await checkUpiRedeemAccessTokenEligibility({
          state: runtimeState,
          session: chatGptSession,
          accessToken,
        });
        const reason = normalizeString(eligibility?.item?.message || eligibility?.item?.reason)
          || '账号有试用资格，已进入 Free 分组';
        if (typeof upsertTrialEligibleFreeCredential === 'function') {
          await upsertTrialEligibleFreeCredential({
            source: 'registration-upi-eligibility',
            email,
            credential: buildCurrentUpiCredentialForMembership({
              ...runtimeState,
              ...patch,
              email,
            }, email),
            accessToken,
            accessTokenMasked: maskAccessToken(accessToken),
            reason,
            checkedAt,
          });
        }
        await addStepLog(
          visibleStep,
          `UPI 注册后试用资格检查通过，已进入 Free 分组：${email || 'unknown'}。`,
          'ok'
        );
        return {
          eligible: true,
          email,
          reason,
          checkedAt,
        };
      } catch (error) {
        const message = getErrorMessage(error) || 'UPI 试用资格检测失败。';
        if (isUpiAccountIneligibleError(error)) {
          await addStepLog(
            visibleStep,
            `UPI 注册后试用资格检查确认无资格，正在删除账号：${email || 'unknown'}：${message}`,
            'warn'
          );
          await applyIneligibleAccountCleanup({
            state: {
              ...runtimeState,
              ...patch,
              email,
            },
            email,
            visibleStep,
            reason: message,
          });
          throw error;
        }
        await addStepLog(
          visibleStep,
          `UPI 注册后试用资格检查失败，账号未进入 Free 分组：${email || 'unknown'}：${message}`,
          'error'
        );
        throw error;
      }
    }

    async function redeemUpiCredentialWithAccessToken(input = {}) {
      throwIfStopped();
      const runtimeState = await getMergedState(input.state || {});
      const visibleStep = resolveVisibleStep(runtimeState);
      const chatGptSession = normalizeChatGptSessionPayload(input.session || input.chatGptSession || input.chatgptSession || {});
      const accessToken = getChatGptSessionAccessToken(chatGptSession)
        || normalizeString(input.accessToken || input.token || input.access_token);
      if (!hasChatGptSessionPayload(chatGptSession) && !accessToken) {
        throw new Error('缺少 ChatGPT accessToken，无法兑换 UPI 卡密。');
      }
      const credential = input.credential && typeof input.credential === 'object' && !Array.isArray(input.credential)
        ? input.credential
        : {};
      const email = parsePoolEntryEmail(credential.email || input.email || runtimeState.email);
      const apiUrl = buildUpiRedeemApiUrl(runtimeState);
      const checkUrl = buildUPIAccessTokenCheckApiUrl(runtimeState);
      const externalApiKey = normalizeString(getUpiRedeemStateValue(runtimeState, 'upiRedeemExternalApiKey'));
      if (!externalApiKey) {
        throw new Error('UPI External API Key 未配置，请先在侧边栏填写 UPI 外部 API Key。');
      }
      const clientId = await resolveUpiRedeemClientId(runtimeState);
      const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(runtimeState, 'upiRedeemCdkeyUsage') || {});
      const cdkeys = mergeCdkeysWithRecoverableUsage(
        parseCdkeyPoolText(getUpiRedeemStateValue(runtimeState, 'upiRedeemCdkeyPoolText')),
        usage
      );
      const forceCdkey = normalizeString(input.forceCdkey);
      let cdkey = forceCdkey || pickFirstUnusedCdkey(cdkeys, usage);
      if (!cdkey) {
        throw new Error(forceCdkey
          ? '指定的 UPI 卡密为空，无法重试。'
          : '没有可用的 UPI 卡密，请在侧边栏导入可用卡密。');
      }
      if (forceCdkey) {
        const forcedUsage = usage?.[forceCdkey] || {};
        if (!cdkeys.includes(forceCdkey)) {
          throw new Error(`指定 UPI 卡密不在当前卡密池中，已停止重试：${forceCdkey}`);
        }
        if (forcedUsage.enabled === false) {
          throw new Error(`指定 UPI 卡密已停用，已停止重试：${forceCdkey}`);
        }
        if (!isCdkeySelectableForRedeem(forcedUsage)) {
          throw new Error(`指定 UPI 卡密已兑换、处理中或已确认不可再次提交，已停止：${forceCdkey}`);
        }
        cdkey = forceCdkey;
      }
      const selectedUsage = usage?.[cdkey] || {};

      const skipEligibilityCheck = input.skipEligibilityCheck === true;
      const attemptAt = Math.max(1, Math.floor(Number(now()) || Date.now()));
      await addStepLog(
        visibleStep,
        `UPI Free 分组卡密兑换：准备提交 ChatGPT AT + 卡密：${email || 'unknown'} -> session字段 ${getChatGptSessionFieldCount(chatGptSession)} -> ${cdkey}`,
        'info'
      );
      if (isRetryableRemoteStatus(selectedUsage.remoteStatus)) {
        await addStepLog(
          visibleStep,
          `UPI Free 分组卡密兑换：卡密 ${cdkey} 上次状态为 ${normalizeUpiRedeemRemoteStatus(selectedUsage.remoteStatus)}，但未标记已用，将继续重试。`,
          'warn'
        );
      }
      if (skipEligibilityCheck) {
        await addStepLog(
          visibleStep,
          `UPI Free 分组卡密兑换：已跳过本地资格预检，直接提交兑换后端：${email || 'unknown'} -> ${cdkey} -> ${apiUrl}`,
          'warn'
        );
      } else {
        await addStepLog(visibleStep, `UPI Free 分组卡密兑换：正在检查 ChatGPT session 资格：${email || 'unknown'} -> ${cdkey} -> ${checkUrl}`, 'info');
        try {
          await checkUPIAccessTokenEligibility({
            checkUrl,
            externalApiKey,
            clientId,
            cdkey,
            session: chatGptSession,
            accessToken,
          });
        } catch (error) {
          const message = getErrorMessage(error) || 'UPI 资格检查失败。';
          if (isUpiAccessTokenExpiredError(error)) {
            await addStepLog(
              visibleStep,
              `UPI Free 分组卡密兑换：资格预检接口提示 ChatGPT session 失效，将按 lala 逻辑继续提交兑换后端 ${apiUrl}：${message}`,
              'warn'
            );
            await updateCdkeyUsage(cdkey, (entry) => ({
              ...entry,
              email,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              accessTokenUpdatedAt: attemptAt,
              lastAttemptAt: attemptAt,
              lastError: message,
            }));
          } else {
            if (isApproveBlockedError(error)) {
              await releaseCdkeyForApproveBlocked({
                cdkey,
                email,
                reason: message,
                attemptAt,
                visibleStep,
                state: runtimeState,
              });
              throw error;
            }
            await updateCdkeyUsage(cdkey, (entry) => ({
              ...entry,
              email,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              accessTokenUpdatedAt: attemptAt,
              lastAttemptAt: attemptAt,
              lastError: message,
            }));
            if (isUpiAccountIneligibleError(error)) {
              await addStepLog(
                visibleStep,
                `UPI Free 分组卡密兑换：资格检查确认账号无资格，未提交到兑换后端 ${apiUrl}：${message}`,
                'error'
              );
              throw error;
            }
            await addStepLog(
              visibleStep,
              `UPI Free 分组卡密兑换：资格检查接口失败，将继续提交兑换后端 ${apiUrl} 留痕：${message}`,
              'warn'
            );
          }
        }
      }

      await addStepLog(visibleStep, `UPI Free 分组卡密兑换：正在提交 ChatGPT AT+卡密到兑换接口：${email || 'unknown'} -> session字段 ${getChatGptSessionFieldCount(chatGptSession)} -> ${cdkey} -> ${apiUrl}`, 'info');
      await reserveCdkeyForRedeemSubmission({
        cdkey,
        email,
        accessToken,
        attemptAt,
        message: `正在提交兑换：${email || 'unknown'}`,
      });
      try {
        await postUpiRedeem({
          apiUrl,
          externalApiKey,
          clientId,
          cdkey,
          session: chatGptSession,
          accessToken,
          state: runtimeState,
        });
        await addStepLog(visibleStep, `UPI Free 分组卡密兑换：兑换接口已接收 ChatGPT AT+卡密：${email || 'unknown'} -> ${cdkey}`, 'ok');
        await updateCdkeyUsage(cdkey, (entry) => ({
          ...entry,
          email,
          accessToken,
          accessTokenMasked: maskAccessToken(accessToken),
          accessTokenUpdatedAt: attemptAt,
          usedAt: 0,
          lastAttemptAt: attemptAt,
          lastError: '',
          remoteStatus: 'submitted',
          remoteMessage: '已提交到兑换后端，等待确认会员',
          remoteCheckedAt: attemptAt,
          retrying: false,
          retryError: '',
        }));
        await addStepLog(visibleStep, `UPI 卡密已提交到兑换后端，暂不从本地卡密池移除，等待确认会员成功后再清理：${cdkey}`, 'info');
      } catch (error) {
        const message = getErrorMessage(error) || 'UPI 卡密兑换失败。';
        if (isUpiAccessTokenExpiredError(error)) {
          await addStepLog(
            visibleStep,
            `UPI Free 分组卡密兑换：兑换后端提示 ChatGPT session 失效，已停止当前账号，卡密不记失败：${email || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await recordAccessTokenExpiredCdkeyAttempt({
            cdkey,
            email,
            attemptAt,
            message,
          });
          throw error;
        }
        if (isApproveBlockedError(error)) {
          await addStepLog(
            visibleStep,
            `UPI Free 分组卡密兑换：后端返回 approve-blocked，立即释放卡密并保留账号：${email || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await releaseCdkeyForApproveBlocked({
            cdkey,
            email,
            reason: message,
            attemptAt,
            visibleStep,
            state: runtimeState,
          });
          throw error;
        }
        if (isUpiRedeemNotAcceptedError(error)) {
          await addStepLog(
            visibleStep,
            `UPI Free 分组卡密兑换：兑换接口未确认接收，后端没有兑换记录，已释放卡密：${email || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await releaseCdkeyForUnacceptedSubmission({
            cdkey,
            reason: message,
            attemptAt,
          });
          throw error;
        }
        if (isUpiRedeemDuplicateCdkeyError(error)) {
          const pendingReason = `${message || '后端提示卡密已提交过'}；这张卡密已被占用，当前账号未提交成功，本账号本轮结束。`;
          await addStepLog(
            visibleStep,
            `UPI Free 分组卡密兑换：后端提示卡密重复提交，当前账号未提交成功，将回到 Free 可换卡：${email || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await updateCdkeyUsage(cdkey, (entry) => ({
            ...entry,
            email: '',
            accessToken: '',
            accessTokenMasked: '',
            accessTokenUpdatedAt: 0,
            usedAt: 0,
            lastAttemptAt: attemptAt,
            lastError: '',
            remoteStatus: 'submitted',
            remoteMessage: pendingReason,
            remoteCheckedAt: attemptAt,
            retrying: false,
            retryError: '',
          }));
          return {
            cdkey,
            accessToken,
            active: false,
            planType: '',
            pendingRemoteConfirmation: false,
            duplicateCdkeyRejected: true,
            subscriptionCheckedAt: '',
            reason: pendingReason,
            subscription: {
              active: false,
              pendingRemoteConfirmation: false,
              duplicateCdkeyRejected: true,
              reason: pendingReason,
            },
          };
        }
        await addStepLog(
          visibleStep,
          `UPI Free 分组卡密兑换：AT+卡密提交失败：${email || 'unknown'} -> ${cdkey}：${message}`,
          'error'
        );
        await updateCdkeyUsage(cdkey, (entry) => ({
          ...entry,
          email: '',
          accessToken: '',
          accessTokenMasked: '',
          accessTokenUpdatedAt: 0,
          usedAt: 0,
          lastAttemptAt: attemptAt,
          lastError: message,
          lastFailedEmail: email,
          lastFailedAt: attemptAt,
          lastFailedReason: message,
          remoteStatus: 'failed',
          remoteMessage: `${message}；卡密已回到可用池，等待其他账号匹配`,
          remoteCheckedAt: attemptAt,
          retrying: false,
          retryError: message,
        }));
        throw error;
      }

      if (input.deferSubscriptionConfirmation === true) {
        await addStepLog(
          visibleStep,
          `UPI Free 分组卡密兑换：已提交 ChatGPT AT+卡密，等待远端系统返回最终结果后再判定账号成功或失败：${email || 'unknown'} -> ${cdkey}`,
          'info'
        );
        return {
          cdkey,
          accessToken,
          active: false,
          planType: '',
          pendingRemoteConfirmation: true,
          subscriptionCheckedAt: '',
          reason: '已提交到兑换后端，等待远端系统返回最终结果',
          subscription: {
            active: false,
            pendingRemoteConfirmation: true,
            reason: '已提交到兑换后端，等待远端系统返回最终结果',
          },
        };
      }

      const latestForSubscription = await getMergedState({});
      const subscriptionResult = await confirmCurrentRedeemPaidSubscription({
        state: latestForSubscription,
        email,
        cdkey,
        accessToken,
      });
      const subscriptionPlanType = normalizeSubscriptionPlanType(subscriptionResult.planType);
      const subscriptionReason = await recordCdkeySubscriptionConfirmation({
        cdkey,
        email,
        attemptAt,
        subscriptionResult,
        subscriptionPlanType,
      });
      if (subscriptionResult.active) {
        const cleanupState = await getMergedState({
          email,
          upiRedeemSuccess: true,
          upiRedeemCdkey: cdkey,
          upiRedeemAccessToken: accessToken,
          upiRedeemSubscriptionActive: true,
          upiRedeemSubscriptionPlanType: subscriptionPlanType,
          upiRedeemSubscriptionCheckedAt: toIsoTimestamp(subscriptionResult.checkedAt),
        });
        await applyPaidSubscriptionCleanup({
          state: cleanupState,
          cdkey,
          email,
          visibleStep,
        });
      }

      return {
        cdkey,
        accessToken,
        active: Boolean(subscriptionResult.active),
        planType: subscriptionPlanType,
        subscriptionCheckedAt: toIsoTimestamp(subscriptionResult.checkedAt),
        reason: subscriptionReason,
        subscription: subscriptionResult,
      };
    }

    async function executeUpiRedeem(state = {}) {
      throwIfStopped();
      const runtimeState = await getMergedState(state);
      await setState({
        upiRedeemSuccess: false,
        upiRedeemCdkey: '',
        upiRedeemAccessToken: '',
        upiRedeemSubscriptionActive: false,
        upiRedeemSubscriptionPlanType: '',
        upiRedeemSubscriptionCheckedAt: '',
        upiRedeemSubscriptionReason: '',
      });
      const visibleStep = resolveVisibleStep(runtimeState);
      const apiUrl = buildUpiRedeemApiUrl(runtimeState);
      const checkUrl = buildUPIAccessTokenCheckApiUrl(runtimeState);
      const externalApiKey = normalizeString(getUpiRedeemStateValue(runtimeState, 'upiRedeemExternalApiKey'));
      if (!externalApiKey) {
        throw new Error('UPI External API Key 未配置，请先在侧边栏填写 UPI 外部 API Key。');
      }
      const clientId = await resolveUpiRedeemClientId(runtimeState);
      const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(runtimeState, 'upiRedeemCdkeyUsage') || {});
      const cdkeys = mergeCdkeysWithRecoverableUsage(
        parseCdkeyPoolText(getUpiRedeemStateValue(runtimeState, 'upiRedeemCdkeyPoolText')),
        usage
      );
      const cdkey = pickFirstUnusedCdkey(cdkeys, usage);
      if (!cdkey) {
        throw new Error('没有可用的 UPI 卡密，请在侧边栏导入可用卡密。');
      }
      const selectedUsage = usage?.[cdkey] || {};

      await addStepLog(visibleStep, '正在读取当前 ChatGPT session，用于 UPI 卡密兑换...', 'info');
      if (isRetryableRemoteStatus(selectedUsage.remoteStatus)) {
        await addStepLog(
          visibleStep,
          `UPI 卡密 ${cdkey} 上次状态为 ${normalizeUpiRedeemRemoteStatus(selectedUsage.remoteStatus)}，但未标记已用，将继续重试。`,
          'warn'
        );
      }
      const tabId = await resolveSessionTabId(runtimeState);
      const tab = await getResolvedSessionTab(tabId, visibleStep);
      if (chrome?.tabs?.update) {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      }
      await addStepLog(visibleStep, `UPI 兑换步骤读取当前账号 ChatGPT session：已选中标签页 ${tab.id}（${tab.url || 'unknown'}），session API：${CHATGPT_SESSION_API_URL}`, 'info');
      let sessionState = await readCurrentChatGptSession(tab.id, visibleStep);
      throwIfStopped();
      const sessionEmailForLog = resolveCurrentRedeemEmail({}, sessionState) || 'unknown';
      await addStepLog(
        visibleStep,
        `已读取 UPI 兑换 ChatGPT session：${sessionEmailForLog} -> session字段 ${getChatGptSessionFieldCount(sessionState)}。`,
        'ok'
      );

      const attemptAt = Math.max(1, Math.floor(Number(now()) || Date.now()));
      const latestForSubscription = await getMergedState({});
      let duplicateCdkeyPending = false;
      let redeemBackendAccepted = false;
      let currentEmail = resolveCurrentRedeemEmail({
        ...runtimeState,
        ...latestForSubscription,
      }, sessionState);
      const recordTrialEligibleFreeCredential = async (eligibility = {}) => {
        await addStepLog(visibleStep, `UPI 资格检查通过，正在写入 Free 分组：${currentEmail || 'unknown'} -> ${cdkey}`, 'ok');
        if (typeof upsertTrialEligibleFreeCredential === 'function') {
          try {
            await upsertTrialEligibleFreeCredential({
              source: 'registration-upi-eligibility',
              email: currentEmail,
              credential: buildCurrentUpiCredentialForMembership({
                ...runtimeState,
                ...latestForSubscription,
              }, currentEmail),
              cdkey,
              accessToken: sessionState.accessToken,
              accessTokenMasked: maskAccessToken(sessionState.accessToken),
              reason: normalizeString(eligibility?.item?.message || eligibility?.item?.reason) || '账号有试用资格，可进行 UPI 卡密兑换',
              checkedAt: toIsoTimestamp(attemptAt),
            });
            await addStepLog(visibleStep, `已加入 Free 分组并标记“有试用资格”：${currentEmail || 'unknown'}`, 'ok');
          } catch (freeGroupError) {
            await addStepLog(visibleStep, `资格已通过，但写入 Free 分组失败：${getErrorMessage(freeGroupError) || freeGroupError}`, 'warn');
          }
        }
      };
      await addStepLog(visibleStep, `正在检查 UPI ChatGPT session 资格：${cdkey} -> ${checkUrl}`, 'info');
      try {
        const eligibility = await checkUPIAccessTokenEligibility({
          checkUrl,
          externalApiKey,
          clientId,
          cdkey,
          session: sessionState,
          accessToken: sessionState.accessToken,
        });
        await recordTrialEligibleFreeCredential(eligibility);
      } catch (error) {
        const message = getErrorMessage(error) || 'UPI 资格检查失败。';
        if (isUpiAccessTokenExpiredError(error)) {
          sessionState = await refreshCurrentChatGptSessionAndReadToken(tab.id, visibleStep, message);
          currentEmail = resolveCurrentRedeemEmail({
            ...runtimeState,
            ...latestForSubscription,
          }, sessionState);
          await addStepLog(visibleStep, `正在使用刷新后的 UPI ChatGPT session 重试资格检查：${cdkey} -> ${checkUrl}`, 'info');
          try {
            const retryEligibility = await checkUPIAccessTokenEligibility({
              checkUrl,
              externalApiKey,
              clientId,
              cdkey,
              session: sessionState,
              accessToken: sessionState.accessToken,
            });
            await recordTrialEligibleFreeCredential(retryEligibility);
            await addStepLog(visibleStep, 'UPI ChatGPT session 刷新后资格检查通过，继续兑换。', 'ok');
          } catch (retryError) {
            const retryMessage = getErrorMessage(retryError) || 'UPI 资格检查失败。';
            if (isApproveBlockedError(retryError)) {
              await releaseCdkeyForApproveBlocked({
                cdkey,
                email: currentEmail,
                reason: retryMessage,
                attemptAt,
                visibleStep,
                state: {
                  ...runtimeState,
                  ...latestForSubscription,
                  email: currentEmail || latestForSubscription.email || runtimeState.email,
                },
              });
              throw retryError;
            }
            await updateCdkeyUsage(cdkey, (entry) => ({
              ...entry,
              email: currentEmail,
              accessToken: sessionState.accessToken,
              accessTokenMasked: maskAccessToken(sessionState.accessToken),
              accessTokenUpdatedAt: attemptAt,
              lastAttemptAt: attemptAt,
              lastError: retryMessage,
            }));
            if (isUpiAccountIneligibleError(retryError)) {
              await addStepLog(visibleStep, `刷新 ChatGPT 页面后 UPI 资格检查确认账号无资格，未提交到兑换后端 ${apiUrl}：${retryMessage}`, 'error');
              await applyIneligibleAccountCleanup({
                state: {
                  ...runtimeState,
                  ...latestForSubscription,
                  email: currentEmail || latestForSubscription.email || runtimeState.email,
                },
                email: currentEmail,
                visibleStep,
                reason: retryMessage,
              });
              throw retryError;
            }
            if (isUpiAccessTokenExpiredError(retryError)) {
              await recordAccessTokenExpiredCdkeyAttempt({
                cdkey,
                email: currentEmail,
                attemptAt,
                message: retryMessage,
              });
              await addStepLog(visibleStep, `刷新 ChatGPT 页面后优惠资格验证仍提示 token/session 失效，将按完整 session 继续提交兑换后端 ${apiUrl}：${retryMessage}`, 'warn');
            } else {
              await addStepLog(visibleStep, `刷新 ChatGPT 页面后 UPI 资格检查仍失败，将继续提交兑换后端 ${apiUrl} 留痕：${retryMessage}`, 'warn');
            }
          }
        } else {
          if (isApproveBlockedError(error)) {
            await releaseCdkeyForApproveBlocked({
              cdkey,
              email: currentEmail,
              reason: message,
              attemptAt,
              visibleStep,
              state: {
                ...runtimeState,
                ...latestForSubscription,
                email: currentEmail || latestForSubscription.email || runtimeState.email,
              },
            });
            throw error;
          }
          await addStepLog(visibleStep, `UPI 资格检查失败，将继续提交兑换后端 ${apiUrl} 留痕：${message}`, 'warn');
          await updateCdkeyUsage(cdkey, (entry) => ({
            ...entry,
            email: currentEmail,
            accessToken: sessionState.accessToken,
            accessTokenMasked: maskAccessToken(sessionState.accessToken),
            accessTokenUpdatedAt: attemptAt,
            lastAttemptAt: attemptAt,
            lastError: message,
          }));
          if (isUpiAccountIneligibleError(error)) {
            await addStepLog(visibleStep, `UPI 资格检查确认账号无资格，未提交到兑换后端 ${apiUrl}：${message}`, 'error');
            await applyIneligibleAccountCleanup({
              state: {
                ...runtimeState,
                ...latestForSubscription,
                email: currentEmail || latestForSubscription.email || runtimeState.email,
              },
              email: currentEmail,
              visibleStep,
              reason: message,
            });
            throw error;
          }
          await addStepLog(visibleStep, `UPI 资格检查接口失败，将继续提交兑换后端 ${apiUrl} 留痕：${message}`, 'warn');
        }
      }

      await addStepLog(visibleStep, `正在提交 ChatGPT session+卡密到 UPI 兑换接口：${currentEmail || 'unknown'} -> session字段 ${getChatGptSessionFieldCount(sessionState)} -> ${cdkey} -> ${apiUrl}`, 'info');
      await reserveCdkeyForRedeemSubmission({
        cdkey,
        email: currentEmail,
        accessToken: sessionState.accessToken,
        attemptAt,
        message: `正在提交兑换：${currentEmail || 'unknown'}`,
      });
      try {
        await postUpiRedeem({
          apiUrl,
          externalApiKey,
          clientId,
          cdkey,
          session: sessionState,
          accessToken: sessionState.accessToken,
          state: runtimeState,
        });
        redeemBackendAccepted = true;
        await addStepLog(visibleStep, `UPI 兑换接口已接收 ChatGPT session+卡密：${currentEmail || 'unknown'} -> ${cdkey}`, 'ok');
        await updateCdkeyUsage(cdkey, (entry) => ({
          ...entry,
          email: currentEmail,
          accessToken: sessionState.accessToken,
          accessTokenMasked: maskAccessToken(sessionState.accessToken),
          accessTokenUpdatedAt: attemptAt,
          usedAt: 0,
          lastAttemptAt: attemptAt,
          lastError: '',
          remoteStatus: 'submitted',
          remoteMessage: '已提交到兑换后端，等待确认会员',
          remoteCheckedAt: attemptAt,
          retrying: false,
          retryError: '',
        }));
        await addStepLog(visibleStep, `UPI 卡密已提交到兑换后端，暂不从本地卡密池移除，等待确认会员成功后再清理：${cdkey}`, 'info');
        const subscriptionResult = await confirmCurrentRedeemPaidSubscription({
          state: latestForSubscription,
          email: currentEmail,
          cdkey,
          accessToken: sessionState.accessToken,
        });
        const subscriptionPlanType = normalizeSubscriptionPlanType(subscriptionResult.planType);
        const subscriptionReason = await recordCdkeySubscriptionConfirmation({
          cdkey,
          email: currentEmail,
          attemptAt,
          subscriptionResult,
          subscriptionPlanType,
        });
        const subscriptionUpdates = {
          upiRedeemSubscriptionActive: Boolean(subscriptionResult.active),
          upiRedeemSubscriptionPlanType: subscriptionPlanType,
          upiRedeemSubscriptionCheckedAt: toIsoTimestamp(subscriptionResult.checkedAt),
          upiRedeemSubscriptionReason: subscriptionReason,
        };
        const successStateUpdates = {
          upiRedeemSuccess: true,
          upiRedeemCdkey: cdkey,
          upiRedeemAccessToken: sessionState.accessToken,
          ...subscriptionUpdates,
        };
        try {
          await setState(successStateUpdates);
        } catch (stateError) {
          await addStepLog(
            visibleStep,
            `UPI 卡密已兑换成功，但记录兑换成功标志失败：${getErrorMessage(stateError) || stateError}`,
            'warn'
          );
        }
        if (subscriptionResult.active) {
          const planLabel = getPaidSubscriptionPlanLabel(subscriptionPlanType);
          try {
            const cleanupState = await getMergedState({
              ...successStateUpdates,
              email: currentEmail || latestForSubscription.email,
            });
            const cleanupUpdates = await applyPaidSubscriptionCleanup({
              state: cleanupState,
              cdkey,
              email: currentEmail,
              visibleStep,
            });
            const cleanupParts = [];
            if (cleanupUpdates.upiRedeemCdkeyPoolText !== undefined) {
              cleanupParts.push('UPI 卡密列表');
            }
            if (
              cleanupUpdates.customMailProviderPool !== undefined
              || cleanupUpdates.customEmailPoolEntries !== undefined
              || cleanupUpdates.customEmailPool !== undefined
            ) {
              cleanupParts.push('邮箱列表');
            }
            await addStepLog(
              visibleStep,
              cleanupParts.length
                ? `已确认账号开通 ${planLabel} 会员，已清理可用池：${cleanupParts.join('、')}。`
                : `已确认账号开通 ${planLabel} 会员。`,
              'success'
            );
          } catch (cleanupError) {
            await addStepLog(
              visibleStep,
              `已确认账号开通 ${planLabel} 会员，但清理邮箱/卡密列表失败：${getErrorMessage(cleanupError) || cleanupError}`,
              'warn'
            );
          }
        } else {
          await addStepLog(
            visibleStep,
            `UPI 卡密已提交成功，但会员状态待确认，暂不删除邮箱和卡密：${subscriptionReason}`,
            'warn'
          );
        }
        if (
          !shouldMarkRegistrationAccountUsedAfterRedeem(runtimeState)
          && typeof appendAccountRunRecord === 'function'
        ) {
          try {
            const latestState = await getMergedState(successStateUpdates);
            await appendAccountRunRecord('success', {
              ...latestState,
              ...successStateUpdates,
            }, 'UPI 卡密兑换成功');
          } catch (recordError) {
            await addStepLog(
              visibleStep,
              `UPI 卡密已兑换成功，但记录兑换成功邮箱失败：${getErrorMessage(recordError) || recordError}`,
              'warn'
            );
          }
        }
      } catch (error) {
        const message = getErrorMessage(error) || 'UPI 卡密兑换失败。';
        if (isUpiAccessTokenExpiredError(error)) {
          await addStepLog(
            visibleStep,
            `UPI 兑换后端提示 ChatGPT session 失效，已停止当前兑换步骤，卡密不记失败：${currentEmail || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await recordAccessTokenExpiredCdkeyAttempt({
            cdkey,
            email: currentEmail,
            attemptAt,
            message,
          });
          throw error;
        }
        if (isApproveBlockedError(error)) {
          await addStepLog(
            visibleStep,
            `UPI 后端返回 approve-blocked，立即释放卡密并保留账号：${currentEmail || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await releaseCdkeyForApproveBlocked({
            cdkey,
            email: currentEmail,
            reason: message,
            attemptAt,
            visibleStep,
            state: {
              ...runtimeState,
              ...latestForSubscription,
              email: currentEmail || latestForSubscription.email || runtimeState.email,
            },
          });
          throw error;
        }
        if (isUpiRedeemNotAcceptedError(error)) {
          await addStepLog(
            visibleStep,
            `UPI 兑换接口未确认接收，后端没有兑换记录，已释放卡密：${currentEmail || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await releaseCdkeyForUnacceptedSubmission({
            cdkey,
            reason: message,
            attemptAt,
          });
          await setState({
            upiRedeemSuccess: false,
            upiRedeemCdkey: '',
            upiRedeemAccessToken: '',
            upiRedeemSubscriptionActive: false,
            upiRedeemSubscriptionPlanType: '',
            upiRedeemSubscriptionCheckedAt: '',
            upiRedeemSubscriptionReason: message,
          }).catch(() => {});
          throw error;
        }
        if (isUpiRedeemDuplicateCdkeyError(error)) {
          const pendingReason = `${message || '后端提示卡密已提交过'}；这张卡密已被占用，当前账号未提交成功，本账号本轮结束。`;
          await addStepLog(
            visibleStep,
            `UPI 后端提示卡密重复提交，当前账号未提交成功，本账号本轮结束：${currentEmail || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await updateCdkeyUsage(cdkey, (entry) => ({
            ...entry,
            email: '',
            accessToken: '',
            accessTokenMasked: '',
            accessTokenUpdatedAt: 0,
            usedAt: 0,
            lastAttemptAt: attemptAt,
            lastError: '',
            remoteStatus: 'submitted',
            remoteMessage: pendingReason,
            remoteCheckedAt: attemptAt,
            retrying: false,
            retryError: '',
          }));
          await setState({
            upiRedeemSuccess: false,
            upiRedeemCdkey: '',
            upiRedeemAccessToken: '',
            upiRedeemSubscriptionActive: false,
            upiRedeemSubscriptionPlanType: '',
            upiRedeemSubscriptionCheckedAt: '',
            upiRedeemSubscriptionReason: pendingReason,
          }).catch(() => {});
          throw new Error(`${UPI_REDEEM_DUPLICATE_CDK_ERROR_PREFIX}${pendingReason}`);
        } else if (redeemBackendAccepted) {
          duplicateCdkeyPending = true;
          const pendingReason = `卡密已提交到兑换后端，但本地会员确认失败：${message}；已保持处理中，等待远端状态刷新`;
          await addStepLog(
            visibleStep,
            `UPI 卡密已被兑换接口接收，本地确认会员失败，已按处理中记录：${currentEmail || 'unknown'} -> ${cdkey}：${message}`,
            'warn'
          );
          await updateCdkeyUsage(cdkey, (entry) => ({
            ...entry,
            email: currentEmail,
            accessToken: sessionState.accessToken,
            accessTokenMasked: maskAccessToken(sessionState.accessToken),
            accessTokenUpdatedAt: attemptAt,
            usedAt: 0,
            lastAttemptAt: attemptAt,
            lastError: '',
            remoteStatus: 'submitted',
            remoteMessage: pendingReason,
            remoteCheckedAt: attemptAt,
            retrying: false,
            retryError: '',
          }));
          await setState({
            upiRedeemSuccess: false,
            upiRedeemCdkey: cdkey,
            upiRedeemAccessToken: sessionState.accessToken,
            upiRedeemSubscriptionActive: false,
            upiRedeemSubscriptionPlanType: '',
            upiRedeemSubscriptionCheckedAt: '',
            upiRedeemSubscriptionReason: pendingReason,
          }).catch(() => {});
        } else {
          await addStepLog(
            visibleStep,
            `UPI ChatGPT session+卡密提交失败：${currentEmail || 'unknown'} -> ${cdkey}：${message}`,
            'error'
          );
          await addStepLog(visibleStep, `UPI 卡密兑换失败：${message}`, 'error');
          await updateCdkeyUsage(cdkey, (entry) => ({
            ...entry,
            email: '',
            accessToken: '',
            accessTokenMasked: '',
            accessTokenUpdatedAt: 0,
            usedAt: 0,
            lastAttemptAt: attemptAt,
            lastError: message,
            lastFailedEmail: currentEmail,
            lastFailedAt: attemptAt,
            lastFailedReason: message,
            remoteStatus: 'failed',
            remoteMessage: `${message}；卡密已回到可用池，等待其他账号匹配`,
            remoteCheckedAt: attemptAt,
            retrying: false,
            retryError: message,
          }));
          throw error;
        }
      }

      if (
        !duplicateCdkeyPending
        &&
        shouldMarkRegistrationAccountUsedAfterRedeem(runtimeState)
        && typeof markCurrentRegistrationAccountUsed === 'function'
      ) {
        try {
          const latestState = await getMergedState({
            upiRedeemSuccess: true,
            upiRedeemCdkey: cdkey,
            upiRedeemAccessToken: sessionState.accessToken,
          });
          await markCurrentRegistrationAccountUsed(latestState, {
            logPrefix: 'UPI 卡密兑换成功',
            level: 'ok',
          });
        } catch (error) {
          await addStepLog(
            visibleStep,
            `UPI 卡密已兑换成功，但标记当前账号已用失败：${getErrorMessage(error) || error}`,
            'warn'
          );
        }
      }

      const successMessage = duplicateCdkeyPending
        ? 'UPI 卡密已提交到兑换后端，已等待远端状态刷新，暂不判定账号成功或失败。'
        : shouldMarkRegistrationAccountUsedAfterRedeem(runtimeState)
        ? 'UPI 卡密兑换成功，已停止后续 OAuth 后链。'
        : 'UPI 卡密兑换成功，继续 OAuth 后链。';
      await addStepLog(visibleStep, successMessage, duplicateCdkeyPending ? 'warn' : 'success');
      const completionLatestState = await getMergedState({});
      await completeNodeFromBackground(state?.nodeId || 'upi-redeem', {
        cdkey,
        accessToken: sessionState.accessToken,
        upiRedeemAccessToken: sessionState.accessToken,
        upiRedeemSubscriptionActive: Boolean(completionLatestState?.upiRedeemSubscriptionActive),
        upiRedeemSubscriptionPlanType: normalizeSubscriptionPlanType(completionLatestState?.upiRedeemSubscriptionPlanType),
        upiRedeemSubscriptionCheckedAt: normalizeString(completionLatestState?.upiRedeemSubscriptionCheckedAt),
      });
    }

    return {
      buildUpiRedeemStatusApiUrl,
      buildUpiSubscriptionApiUrl,
      normalizeUpiSubscriptionApiBaseUrl,
      checkUpiRedeemSubscriptionStatuses,
      checkUpiRedeemAccessTokenEligibility,
      checkRegistrationUpiTrialEligibility,
      buildUpiRedeemApiUrl,
      executeUpiRedeem,
      isSupportedChatGptSessionUrl,
      normalizeUpiRedeemCdkeyUsage,
      parseCdkeyPoolText,
      redeemUpiCredentialWithAccessToken,
      refreshUpiRedeemCdkeyStatuses,
    };
  }

  return {
    createUpiRedeemExecutor,
  };
});



