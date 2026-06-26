(function attachUpiCredentialMembershipChecker(root, factory) {
  root.MultiPageBackgroundUpiCredentialMembershipChecker = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createUpiCredentialMembershipCheckerModule() {
  const BACKUP_STORAGE_KEY = 'upiAccountCredentialBackups';
  const RESULTS_STORAGE_KEY = 'upiCredentialMembershipCheckResults';
  const DEFAULT_TOTP_API_BASE_URL = 'https://cha.nerver.cc';
  const TOTP_LOOKUP_TIMEOUT_MS = 20000;
  const LOGIN_TOTP_SUBMIT_SESSION_RACE_MS = 12000;
  const UPI_REDEEM_AUTO_RETRY_LIMIT = 3;
  const UPI_CREDENTIAL_MEMBERSHIP_REDEEM_FAILURE_LIMIT = 3;
  const CHATGPT_ENTRY_URL = 'https://chatgpt.com/';
  const CHATGPT_LOGIN_URL = 'https://chatgpt.com/auth/login';
  const AUTH_SOURCE = 'openai-auth';
  const MEMBERSHIP_STOP_ERROR_CODE = 'UPI_CREDENTIAL_MEMBERSHIP_STOPPED';
  const SESSION_ACCOUNT_MISMATCH_ERROR_CODE = 'UPI_CREDENTIAL_SESSION_ACCOUNT_MISMATCH';
  const PAID_PLANS = new Set(['plus', 'pro', 'team']);
  const FLOW_STAGE_KEYS = new Set([
    'import',
    'open-chatgpt',
    'login',
    'totp',
    'token',
    'subscription-check',
    'upi-redeem-plus',
    'confirm-plus',
  ]);
  const COOKIE_CLEAR_DOMAINS = [
    'chatgpt.com',
    'chat.openai.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
  ];
  const COOKIE_CLEAR_ORIGINS = [
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://openai.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://accounts.openai.com',
  ];

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function normalizeFlowStage(value = '') {
    const stage = normalizeString(value).toLowerCase();
    return FLOW_STAGE_KEYS.has(stage) ? stage : '';
  }

  function normalizeEmail(value = '') {
    return normalizeString(value).toLowerCase();
  }

  function normalizeTotpSecret(value = '') {
    return normalizeString(value).replace(/\s+/g, '').toUpperCase();
  }

  function normalizePlanType(value = '') {
    const normalized = normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized.includes('team')) return 'team';
    if (normalized.includes('pro')) return 'pro';
    if (normalized.includes('plus')) return 'plus';
    if (normalized.includes('free')) return 'free';
    return normalized;
  }

  function normalizeVerificationKind(value = '') {
    const normalized = normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
    if (['totp', 'mfa', '2fa', 'two_factor', 'authenticator'].includes(normalized)) return 'totp';
    if (normalized.includes('phone')) return 'phone';
    if (normalized.includes('email') || normalized.includes('mail')) return 'email';
    return normalized || 'unknown';
  }

  function isPaidPlanType(value = '') {
    return PAID_PLANS.has(normalizePlanType(value));
  }

  function normalizeTotpApiBaseUrl(value = '') {
    return normalizeString(value || DEFAULT_TOTP_API_BASE_URL)
      .replace(/#.*$/g, '')
      .replace(/\/+$/g, '')
      .replace(/\/api\/v1\/totp\/(?:enable|lookup|code)$/i, '')
      .replace(/\/api$/i, '')
      .replace(/\/+$/g, '')
      || DEFAULT_TOTP_API_BASE_URL;
  }

  function getUpiRedeemStateValue(state = {}, key = '') {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) return undefined;
    if (state?.[normalizedKey] !== undefined) return state[normalizedKey];
    const legacyKey = normalizedKey.replace(/^upiRedeem/, 'pixRedeem');
    return legacyKey === normalizedKey ? undefined : state?.[legacyKey];
  }

  function parseUpiRedeemCdkeyPoolText(value = '') {
    const seen = new Set();
    return String(value || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => normalizeString(line))
      .filter((line) => {
        if (!line || seen.has(line)) return false;
        seen.add(line);
        return true;
      });
  }

  function normalizeUpiRedeemCdkeyUsage(rawUsage = {}) {
    return rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
      ? rawUsage
      : {};
  }

  function isActiveUpiRedeemRemoteStatus(status = '') {
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
    ].includes(normalizeString(status).toLowerCase().replace(/[\s-]+/g, '_'));
  }

  function normalizeUpiRedeemRemoteStatus(status = '') {
    const normalized = normalizeString(status).toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'succeeded' || normalized === 'redeemed' || normalized === 'used') return 'success';
    if (normalized === 'failure' || normalized === 'error') return 'failed';
    if (normalized === 'cancelled') return 'canceled';
    return normalized;
  }

  function isSuccessfulUpiRedeemRemoteStatus(status = '') {
    return normalizeUpiRedeemRemoteStatus(status) === 'success';
  }

  function isRetryableUpiRedeemRemoteStatus(status = '') {
    return ['failed', 'timeout', 'rejected', 'canceled'].includes(normalizeUpiRedeemRemoteStatus(status));
  }

  function isSelectableUpiRedeemCdkeyUsageEntry(entry = {}) {
    if (!entry || entry.enabled === false) return false;
    if (entry.subscriptionActive === true || entry.subscriptionActive === false) return false;
    if (isSuccessfulUpiRedeemRemoteStatus(entry.remoteStatus)) return false;
    if (isActiveUpiRedeemRemoteStatus(entry.remoteStatus)) return false;
    return true;
  }

  function isRecoverableUpiRedeemCdkeyUsageEntry(entry = {}) {
    if (!entry || entry.enabled === false) return false;
    if (entry.subscriptionActive === true || isSuccessfulUpiRedeemRemoteStatus(entry.remoteStatus)) return false;
    if (isActiveUpiRedeemRemoteStatus(entry.remoteStatus)) return false;
    return isRetryableUpiRedeemRemoteStatus(entry.remoteStatus)
      || entry.subscriptionActive === false
      || Boolean(normalizeString(entry.lastError || entry.subscriptionReason));
  }

  function mergeUpiRedeemCdkeysWithRecoverableUsage(cdkeys = [], usage = {}) {
    const seen = new Set();
    const merged = [];
    for (const cdkey of cdkeys) {
      const normalizedCdkey = normalizeString(cdkey);
      if (!normalizedCdkey || seen.has(normalizedCdkey)) continue;
      seen.add(normalizedCdkey);
      merged.push(normalizedCdkey);
    }
    Object.entries(usage || {}).forEach(([rawCdkey, entry]) => {
      const cdkey = normalizeString(rawCdkey);
      if (!cdkey || seen.has(cdkey) || !isRecoverableUpiRedeemCdkeyUsageEntry(entry)) return;
      seen.add(cdkey);
      merged.push(cdkey);
    });
    return merged;
  }

  function countAvailableUpiRedeemCdkeys(state = {}) {
    const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(state, 'upiRedeemCdkeyUsage') || {});
      const cdkeys = mergeUpiRedeemCdkeysWithRecoverableUsage(
        parseUpiRedeemCdkeyPoolText(getUpiRedeemStateValue(state, 'upiRedeemCdkeyPoolText')),
        usage
      );
      return cdkeys.filter((cdkey) => {
        const entry = usage?.[cdkey] || {};
        return isSelectableUpiRedeemCdkeyUsageEntry(entry);
      }).length;
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
    const period = Math.max(1, Math.floor(Number(options.period) || 30));
    const digits = Math.max(1, Math.floor(Number(options.digits) || 6));
    const keyBytes = decodeBase32Secret(secret);
    const timestampSeconds = Math.floor(Number(options.forTime ?? (Date.now() / 1000)) || 0);
    const counterBytes = buildCounterBytes(Math.floor(timestampSeconds / period));
    const digest = await hmacSha1(keyBytes, counterBytes);
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24)
      | ((digest[offset + 1] & 0xff) << 16)
      | ((digest[offset + 2] & 0xff) << 8)
      | (digest[offset + 3] & 0xff);
    const modulo = 10 ** digits;
    return String(binary % modulo).padStart(digits, '0');
  }

  function getTotpSecondsRemaining(options = {}) {
    const period = Math.max(1, Math.floor(Number(options.period) || 30));
    const timestampSeconds = Math.floor(Number(options.forTime ?? (Date.now() / 1000)) || 0);
    const remainder = timestampSeconds % period;
    return remainder === 0 ? period : period - remainder;
  }

  function buildTimestampedFileName(prefix = 'upi-credential-membership') {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;
  }

  function maskAccessToken(token = '') {
    const text = normalizeString(token);
    if (!text) return '';
    if (text.length <= 12) return `${text.slice(0, 3)}***`;
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
  }

  function parseCredentialBackupText(text = '') {
    const seen = new Set();
    return String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line, index) => {
        const rawLine = line.trim();
        if (!rawLine || rawLine.startsWith('#')) return null;
        const parts = rawLine.split(/---+/).map((part) => part.trim());
        const email = normalizeEmail(parts[0] || '');
        const password = normalizeString(parts[1] || '');
        const totpMfaSecret = normalizeTotpSecret(parts.slice(2).join('---'));
        if (!email) {
          return {
            email: '',
            password,
            totpMfaSecret,
            status: 'failed',
            reason: `第 ${index + 1} 行缺少邮箱`,
          };
        }
        if (seen.has(email)) return null;
        seen.add(email);
        return {
          email,
          password,
          totpMfaSecret,
        };
      })
      .filter(Boolean);
  }

  function normalizeCredentialBackupMap(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const records = {};
    Object.entries(value).forEach(([key, rawRecord]) => {
      const record = rawRecord && typeof rawRecord === 'object' && !Array.isArray(rawRecord)
        ? rawRecord
        : {};
      const email = normalizeEmail(record.email || key);
      if (!email) return;
      records[email] = {
        ...record,
        email,
        password: normalizeString(record.password || record.gptPassword || ''),
        totpMfaSecret: normalizeTotpSecret(record.totpMfaSecret || record.totpSecret || ''),
        updatedAt: normalizeString(record.updatedAt || ''),
      };
    });
    return records;
  }

  function buildCredentialRowsFromBackupMap(backups = {}) {
    const seen = new Set();
    return Object.values(normalizeCredentialBackupMap(backups))
      .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''))
      .map((record) => {
        const email = normalizeEmail(record.email);
        if (!email || seen.has(email)) return null;
        seen.add(email);
        return {
          email,
          password: normalizeString(record.password),
          totpMfaSecret: normalizeTotpSecret(record.totpMfaSecret),
        };
      })
      .filter(Boolean);
  }

  function normalizeResultItem(item = {}) {
    const email = normalizeEmail(item.email);
    const status = ['paid', 'free', 'failed'].includes(normalizeString(item.status))
      ? normalizeString(item.status)
      : 'failed';
    return {
      email,
      password: normalizeString(item.password),
      totpMfaSecret: normalizeTotpSecret(item.totpMfaSecret),
      status,
      planType: normalizePlanType(item.planType),
      checkedAt: normalizeString(item.checkedAt),
      reason: normalizeString(item.reason),
      trialEligibilityStatus: normalizeString(item.trialEligibilityStatus),
      trialEligibilityReason: normalizeString(item.trialEligibilityReason),
      trialEligibilityCheckedAt: normalizeString(item.trialEligibilityCheckedAt),
      accessTokenMasked: normalizeString(item.accessTokenMasked),
      redeemStatus: normalizeString(item.redeemStatus),
      redeemReason: normalizeString(item.redeemReason),
      redeemFailureCount: Math.max(0, Math.floor(Number(item.redeemFailureCount) || 0)),
      redeemLastFailedAt: normalizeString(item.redeemLastFailedAt),
      upiRedeemCdkey: normalizeString(item.upiRedeemCdkey || item.cdkey),
      upiRedeemSubscriptionCheckedAt: normalizeString(item.upiRedeemSubscriptionCheckedAt),
      membershipOverrideStatus: normalizeString(item.membershipOverrideStatus),
      membershipOverrideCheckedAt: normalizeString(item.membershipOverrideCheckedAt),
    };
  }

  function dedupeResultItemsByEmail(items = []) {
    const byEmail = {};
    (Array.isArray(items) ? items : []).forEach((item) => {
      const normalized = normalizeResultItem(item);
      if (!normalized.email) return;
      byEmail[normalized.email] = normalized;
    });
    return Object.values(byEmail);
  }

  function normalizeTrialEligibilitySummaryItem(item = {}) {
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    return {
      email: normalizeEmail(source.email),
      reason: normalizeString(source.reason),
    };
  }

  function normalizeTrialEligibilitySummary(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const kept = Array.isArray(source.kept) ? source.kept.map(normalizeTrialEligibilitySummaryItem).filter((item) => item.email) : [];
    const skipped = Array.isArray(source.skipped) ? source.skipped.map(normalizeTrialEligibilitySummaryItem).filter((item) => item.email) : [];
    const failed = Array.isArray(source.failed) ? source.failed.map(normalizeTrialEligibilitySummaryItem).filter((item) => item.email) : [];
    const deletedEmails = Array.isArray(source.deletedEmails)
      ? source.deletedEmails.map(normalizeEmail).filter(Boolean)
      : [];
    return {
      checkedAt: normalizeString(source.checkedAt),
      kept,
      skipped,
      failed,
      deletedEmails,
      eligibleCount: Math.max(0, Math.floor(Number(source.eligibleCount) || kept.length || 0)),
      skippedCount: Math.max(0, Math.floor(Number(source.skippedCount) || skipped.length || 0)),
      failedCount: Math.max(0, Math.floor(Number(source.failedCount) || failed.length || 0)),
      deletedCount: Math.max(0, Math.floor(Number(source.deletedCount) || deletedEmails.length || 0)),
    };
  }

  function normalizeResultsPayload(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const items = dedupeResultItemsByEmail(source.items);
    const trialEligibilitySummary = normalizeTrialEligibilitySummary(source.trialEligibilitySummary);
    const redeemAutoDeletedEmails = Array.isArray(source.redeemAutoDeletedEmails)
      ? source.redeemAutoDeletedEmails.map(normalizeEmail).filter(Boolean)
      : [];
    return {
      items,
      running: source.running === true,
      redeeming: source.redeeming === true,
      startedAt: normalizeString(source.startedAt),
      updatedAt: normalizeString(source.updatedAt),
      finishedAt: normalizeString(source.finishedAt),
      stoppedAt: normalizeString(source.stoppedAt),
      redeemStartedAt: normalizeString(source.redeemStartedAt),
      redeemUpdatedAt: normalizeString(source.redeemUpdatedAt),
      redeemFinishedAt: normalizeString(source.redeemFinishedAt),
      redeemStoppedAt: normalizeString(source.redeemStoppedAt),
      flowStage: normalizeFlowStage(source.flowStage),
      flowStageEmail: normalizeEmail(source.flowStageEmail),
      source: normalizeString(source.source),
      total: Math.max(0, Math.floor(Number(source.total) || items.length || 0)),
      completed: Math.max(0, Math.floor(Number(source.completed) || items.length || 0)),
      redeemTotal: Math.max(0, Math.floor(Number(source.redeemTotal) || 0)),
      redeemCompleted: Math.max(0, Math.floor(Number(source.redeemCompleted) || 0)),
      paidCount: items.filter((item) => item.status === 'paid').length,
      freeCount: items.filter((item) => item.status === 'free').length,
      failedCount: items.filter((item) => item.status === 'failed').length,
      trialEligibilitySummary,
      redeemAutoDeletedEmails,
      redeemAutoDeletedCount: Math.max(0, Math.floor(Number(source.redeemAutoDeletedCount) || redeemAutoDeletedEmails.length || 0)),
    };
  }

  function buildResultExportRows(results = {}, status = 'paid') {
    const normalizedStatus = normalizeString(status);
    return normalizeResultsPayload(results).items
      .filter((item) => item.status === normalizedStatus)
      .map((item) => {
        if (normalizedStatus === 'failed') {
          return `${item.email}---${item.reason || '核验失败'}`;
        }
        if (!item.email || !item.password || !item.totpMfaSecret) return '';
        return `${item.email}---${item.password}---${item.totpMfaSecret}`;
      })
      .filter(Boolean);
  }

  function classifySubscriptionResult(subscriptionItem = {}) {
    const planType = normalizePlanType(
      subscriptionItem.planType
      || subscriptionItem.plan_type
      || subscriptionItem.plan
      || subscriptionItem.subscription_plan
      || subscriptionItem.subscriptionPlan
      || subscriptionItem.payload?.planType
      || subscriptionItem.payload?.plan_type
      || subscriptionItem.payload?.plan
      || subscriptionItem.payload?.subscription_plan
      || subscriptionItem.payload?.subscriptionPlan
      || ''
    );
    const active = subscriptionItem.active === true
      || subscriptionItem.hasActiveSubscription === true
      || subscriptionItem.has_active_subscription === true
      || subscriptionItem.subscription_active === true
      || subscriptionItem.subscriptionActive === true
      || subscriptionItem.payload?.has_active_subscription === true
      || subscriptionItem.payload?.hasActiveSubscription === true
      || subscriptionItem.payload?.subscription_active === true
      || subscriptionItem.payload?.subscriptionActive === true;
    if (active && isPaidPlanType(planType)) {
      return { status: 'paid', planType, reason: `已开通 ${planType}` };
    }
    return {
      status: 'free',
      planType: planType || 'free',
      reason: normalizeString(subscriptionItem.reason) || '未查询到 Plus/Pro/Team 会员',
    };
  }

  function getErrorMessage(error) {
    return error?.message || String(error || '未知错误');
  }

  function isApproveBlockedError(error) {
    return /(^|[^a-z0-9])approve-blocked([^a-z0-9]|$)/i.test(
      normalizeString(getErrorMessage(error)).toLowerCase().replace(/[\s_]+/g, '-')
    );
  }

  function isUpiRedeemApiAuthError(error) {
    const message = normalizeString(getErrorMessage(error));
    return /^UPI_REDEEM_AUTH_ERROR::/i.test(normalizeString(error?.message || error))
      || /UPI[\s\S]*(?:HTTP\s*40[13]|API\s*Key|ApiKey|External API Key|认证失败|权限不足|无权限|forbidden|unauthorized)/i.test(message)
      || /(?:HTTP\s*40[13]|API\s*Key|ApiKey|External API Key|认证失败|权限不足|无权限|forbidden|unauthorized)[\s\S]*UPI/i.test(message);
  }

  function createMembershipStopError(kind = 'check') {
    const error = new Error(kind === 'redeem' ? 'UPI 无会员账号补兑已停止' : 'UPI 备份账号会员核验已停止');
    error.code = MEMBERSHIP_STOP_ERROR_CODE;
    error.isUpiCredentialMembershipStopped = true;
    return error;
  }

  function isMembershipStopError(error) {
    return Boolean(error?.isUpiCredentialMembershipStopped || error?.code === MEMBERSHIP_STOP_ERROR_CODE);
  }

  function createSessionAccountMismatchError(message, details = {}) {
    const error = new Error(message);
    error.code = SESSION_ACCOUNT_MISMATCH_ERROR_CODE;
    error.isUpiCredentialSessionAccountMismatch = true;
    error.sessionEmail = details.sessionEmail || '';
    error.targetEmail = details.targetEmail || '';
    return error;
  }

  function isSessionAccountMismatchError(error) {
    return Boolean(
      error?.isUpiCredentialSessionAccountMismatch
      || error?.code === SESSION_ACCOUNT_MISMATCH_ERROR_CODE
    );
  }

  function createUpiCredentialMembershipChecker(deps = {}) {
    const {
      addLog = async () => {},
      broadcastDataUpdate = () => {},
      checkUpiRedeemSubscriptionStatuses = null,
      checkUpiRedeemAccessTokenEligibility = null,
      chrome: chromeApi = globalThis.chrome,
      ensureContentScriptReadyOnTabUntilStopped = null,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getState = async () => ({}),
      isTabAlive = async () => true,
      registerTab = async () => {},
      redeemUpiCredentialWithAccessToken = null,
      reuseOrCreateTab = null,
      sendTabMessageUntilStopped = null,
      setState = null,
      SIGNUP_PAGE_INJECT_FILES = [],
      sleepWithStop = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      throwIfStopped = () => {},
    } = deps;

    let batchStopRequested = false;
    let batchRunning = false;
    let redeemStopRequested = false;
    let redeemRunning = false;
    let cdkeyRetryRunning = false;

    function throwIfMembershipStopRequested(kind = 'check') {
      throwIfStopped();
      if (kind === 'redeem' ? redeemStopRequested : batchStopRequested) {
        throw createMembershipStopError(kind);
      }
    }

    function resolveStopChecker(options = {}, kind = 'check') {
      return typeof options.throwIfStopRequested === 'function'
        ? options.throwIfStopRequested
        : () => throwIfMembershipStopRequested(kind);
    }

    async function assertUpiRedeemSettingsReadyForMembershipRedeem(credentials = [], settings = {}) {
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      const runtimeState = {
        ...(latestState || {}),
        ...(settings || {}),
      };
      const missing = [];
      if (!normalizeString(getUpiRedeemStateValue(runtimeState, 'upiRedeemExternalApiKey'))) {
        missing.push('UPI 外部 API Key');
      }
      const availableCdkeyCount = countAvailableUpiRedeemCdkeys(runtimeState);
      if (availableCdkeyCount <= 0) {
        missing.push('可用 UPI 卡密');
      }
      if (missing.length) {
        throw new Error(`第 7 步 UPI 卡密兑换 Plus 未配置：缺少 ${missing.join('、')}。`);
      }
      const credentialCount = Array.isArray(credentials) ? credentials.length : 0;
      if (credentialCount > availableCdkeyCount) {
        await addLog(
          `UPI 无会员补兑：第 7 步可用卡密 ${availableCdkeyCount} 个，待补兑账号 ${credentialCount} 个；卡密用完后会自动停止，等待补卡后继续。`,
          'warn'
        );
      }
    }

    async function getStoredResults() {
      const stored = await chromeApi.storage.local.get([RESULTS_STORAGE_KEY]).catch(() => ({}));
      return normalizeResultsPayload(stored?.[RESULTS_STORAGE_KEY]);
    }

    async function saveResults(results = {}) {
      const payload = normalizeResultsPayload(results);
      await chromeApi.storage.local.set({ [RESULTS_STORAGE_KEY]: payload });
      if (typeof setState === 'function') {
        await setState({ [RESULTS_STORAGE_KEY]: payload }).catch(() => {});
      }
      broadcastDataUpdate({ [RESULTS_STORAGE_KEY]: payload });
      return payload;
    }

    function normalizeRetryCount(value = 0) {
      return Math.max(0, Math.floor(Number(value) || 0));
    }

    async function updateUpiRedeemCdkeyRetryUsage(cdkey = '', updater = () => ({})) {
      const normalizedCdkey = normalizeString(cdkey);
      if (!normalizedCdkey) {
        return { usage: {}, entry: {} };
      }
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(latestState, 'upiRedeemCdkeyUsage') || {});
      const currentEntry = usage?.[normalizedCdkey] && typeof usage[normalizedCdkey] === 'object' && !Array.isArray(usage[normalizedCdkey])
        ? usage[normalizedCdkey]
        : {};
      const nextEntry = {
        ...currentEntry,
        ...(typeof updater === 'function' ? (updater(currentEntry) || {}) : {}),
      };
      const storedEntry = {
        ...nextEntry,
        usedAt: Math.max(0, Math.floor(Number(nextEntry.usedAt) || 0)),
        lastAttemptAt: Math.max(0, Math.floor(Number(nextEntry.lastAttemptAt) || 0)),
        lastError: normalizeString(nextEntry.lastError),
        enabled: nextEntry.enabled !== false,
        email: normalizeEmail(nextEntry.email || nextEntry.accountEmail || nextEntry.credentialEmail),
        remoteStatus: normalizeString(nextEntry.remoteStatus),
        remoteMessage: normalizeString(nextEntry.remoteMessage),
        remoteCheckedAt: Math.max(0, Math.floor(Number(nextEntry.remoteCheckedAt) || 0)),
        retryCount: normalizeRetryCount(nextEntry.retryCount),
        lastRetryAt: Math.max(0, Math.floor(Number(nextEntry.lastRetryAt) || 0)),
        retrying: nextEntry.retrying === true,
        retryError: normalizeString(nextEntry.retryError),
      };
      const nextUsage = {
        ...usage,
        [normalizedCdkey]: storedEntry,
      };
      if (typeof setState === 'function') {
        await setState({ upiRedeemCdkeyUsage: nextUsage }).catch(() => {});
      }
      broadcastDataUpdate({ upiRedeemCdkeyUsage: nextUsage });
      return { usage: nextUsage, entry: storedEntry };
    }

    function buildRetryUpdatesPayload(results = null, usage = null) {
      const updates = {};
      if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
        updates.upiRedeemCdkeyUsage = usage;
      }
      if (results && typeof results === 'object' && !Array.isArray(results)) {
        updates[RESULTS_STORAGE_KEY] = results;
      }
      return updates;
    }

    function isNonRetryableUpiRedeemRetryError(message = '') {
      const text = normalizeString(message);
      return /缺少\s*GPT\s*密码|缺少\s*2FA|登录需要手机验证码|登录需要邮箱一次性验证码|登录后需要手机|登录后需要邮箱|邮箱一次性验证码|手机号验证码|手机验证码|验证码页面|登录密码未通过|密码未通过|2FA\s*动态码被页面拒绝|账号登录态不一致|accessToken\s*属于|未读取到\s*accessToken|未进入\s*ChatGPT\s*已登录态|账号无资格|access[_-]?token\s*无效|access[_-]?token[\s\S]*(?:过期|失效|expired|invalid)|无效或已过期|未登录|会话已过期|重新登录|session\s*expired/i.test(text);
    }

    function isPreSubmitUpiRedeemBlockedReason(message = '') {
      const text = normalizeString(message);
      return isNonRetryableUpiRedeemRetryError(text)
        || /提交密码后|未进入登录验证码页|登录未进入验证码页|登录或读取\s*accessToken\s*未完成|读取\s*accessToken\s*未完成|verify your identity|one-time password|one-time code/i.test(text);
    }

    function isPreSubmitUpiRedeemBlockedResultItem(item = {}) {
      const redeemStatus = normalizeString(item?.redeemStatus).toLowerCase();
      const cdkey = normalizeString(item?.upiRedeemCdkey || item?.cdkey);
      const reason = normalizeString(item?.redeemReason || item?.reason);
      return redeemStatus === 'failed' && !cdkey && isPreSubmitUpiRedeemBlockedReason(reason);
    }

    function isUpiTrialIneligibleError(error) {
      const message = getErrorMessage(error);
      return /^UPI_ACCOUNT_INELIGIBLE::/i.test(normalizeString(error?.message || error))
        || /账号无资格|无试用资格|没有试用资格|无资格|not eligible|ineligible/i.test(message);
    }

    async function getBackupCredentialsFromLocalStorage() {
      const stored = await chromeApi.storage.local.get([BACKUP_STORAGE_KEY]).catch(() => ({}));
      return buildCredentialRowsFromBackupMap(stored?.[BACKUP_STORAGE_KEY] || {});
    }

    async function getUpiCredentialMembershipCredentialPool() {
      const stored = await chromeApi.storage.local.get([BACKUP_STORAGE_KEY]).catch(() => ({}));
      const backups = normalizeCredentialBackupMap(stored?.[BACKUP_STORAGE_KEY] || {});
      const items = Object.values(backups)
        .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''))
        .map((record) => ({
          email: normalizeEmail(record.email),
          password: normalizeString(record.password),
          totpMfaSecret: normalizeTotpSecret(record.totpMfaSecret),
          updatedAt: normalizeString(record.updatedAt),
          source: 'local',
        }))
        .filter((item) => item.email);
      return {
        items,
        total: items.length,
        updatedAt: new Date().toISOString(),
      };
    }

    async function deleteUpiCredentialMembershipCredentials(input = {}) {
      const emails = (Array.isArray(input.emails) ? input.emails : [input.email])
        .map(normalizeEmail)
        .filter(Boolean);
      const emailSet = new Set(emails);
      if (!emailSet.size) {
        return {
          deletedCount: 0,
          pool: await getUpiCredentialMembershipCredentialPool(),
          results: await getStoredResults(),
        };
      }

      const currentResults = await getStoredResults();
      if (currentResults.running) {
        throw new Error('UPI 备份账号会员核验正在运行，请先停止后再删除。');
      }

      let deletedCount = 0;
      if (input.deleteBackups !== false) {
        const stored = await chromeApi.storage.local.get([BACKUP_STORAGE_KEY]).catch(() => ({}));
        const backups = normalizeCredentialBackupMap(stored?.[BACKUP_STORAGE_KEY] || {});
        for (const email of emailSet) {
          if (Object.prototype.hasOwnProperty.call(backups, email)) {
            delete backups[email];
            deletedCount += 1;
          }
        }
        await chromeApi.storage.local.set({ [BACKUP_STORAGE_KEY]: backups });
      }

      const nextItems = currentResults.items.filter((item) => !emailSet.has(normalizeEmail(item.email)));
      const nextResults = await saveResults({
        ...currentResults,
        items: nextItems,
        total: nextItems.length,
        completed: Math.min(currentResults.completed, nextItems.length),
        updatedAt: new Date().toISOString(),
      });
      const pool = await getUpiCredentialMembershipCredentialPool();
      return {
        deletedCount: input.deleteBackups === false ? emailSet.size : deletedCount,
        pool,
        results: nextResults,
      };
    }

    async function deleteUpiCredentialMembershipCheckResults(input = {}) {
      const status = normalizeString(input.status || 'paid') || 'paid';
      const emails = (Array.isArray(input.emails) ? input.emails : [])
        .map(normalizeEmail)
        .filter(Boolean);
      const emailSet = new Set(emails);
      const currentResults = await getStoredResults();
      if (currentResults.running || currentResults.redeeming) {
        throw new Error('UPI 备份账号核验/补兑正在运行，请先停止后再删除分组结果。');
      }

      const targetItems = currentResults.items.filter((item) => (
        item.status === status
        && (!emailSet.size || emailSet.has(normalizeEmail(item.email)))
      ));
      if (!targetItems.length) {
        return {
          status,
          deletedCount: 0,
          results: currentResults,
        };
      }

      const nextItems = emailSet.size
        ? currentResults.items.filter((item) => !(
          item.status === status
          && emailSet.has(normalizeEmail(item.email))
        ))
        : currentResults.items.filter((item) => item.status !== status);
      const nextResults = await saveResults({
        ...currentResults,
        items: nextItems,
        total: nextItems.length,
        completed: Math.min(currentResults.completed, nextItems.length),
        updatedAt: new Date().toISOString(),
      });
      return {
        status,
        deletedCount: targetItems.length,
        results: nextResults,
      };
    }

    function resolveInputCredentials(input = {}) {
      const textCredentials = parseCredentialBackupText(input.text || input.fileContent || '');
      const directCredentials = Array.isArray(input.credentials)
        ? input.credentials.map((item) => ({
            email: normalizeEmail(item.email),
            password: normalizeString(item.password),
            totpMfaSecret: normalizeTotpSecret(item.totpMfaSecret || item.totpSecret),
          })).filter((item) => item.email)
        : [];
      const all = [...directCredentials, ...textCredentials];
      const seen = new Set();
      return all.filter((item) => {
        if (!item.email || seen.has(item.email)) return false;
        seen.add(item.email);
        return true;
      });
    }

    function upsertResultItem(items = [], nextItem = {}) {
      const normalized = normalizeResultItem(nextItem);
      if (!normalized.email) return items;
      let replaced = false;
      const nextItems = (Array.isArray(items) ? items : []).map((item) => {
        if (normalizeEmail(item?.email) !== normalized.email) return item;
        replaced = true;
        return normalized;
      });
      if (!replaced) {
        nextItems.push(normalized);
      }
      return nextItems;
    }

    async function upsertTrialEligibleFreeCredential(input = {}) {
      const credential = input.credential && typeof input.credential === 'object' && !Array.isArray(input.credential)
        ? input.credential
        : {};
      const email = normalizeEmail(input.email || credential.email);
      if (!email) {
        throw new Error('缺少要写入 Free 分组的账号邮箱。');
      }
      const checkedAt = normalizeString(input.checkedAt) || new Date().toISOString();
      const currentResults = await getStoredResults();
      const existingItem = currentResults.items.find((item) => normalizeEmail(item?.email) === email) || {};
      let backupCredential = {};
      try {
        const pool = await getUpiCredentialMembershipCredentialPool();
        backupCredential = (pool.items || []).find((item) => normalizeEmail(item?.email) === email) || {};
      } catch {
        backupCredential = {};
      }
      const reason = normalizeString(input.reason || input.message || credential.reason) || '账号有试用资格，可进行 UPI 卡密兑换';
      const nextItems = upsertResultItem(currentResults.items, {
        ...existingItem,
        ...backupCredential,
        ...credential,
        email,
        password: normalizeString(credential.password || input.password || backupCredential.password || existingItem.password),
        totpMfaSecret: normalizeTotpSecret(credential.totpMfaSecret || credential.totpSecret || input.totpMfaSecret || input.totpSecret || backupCredential.totpMfaSecret || existingItem.totpMfaSecret),
        status: 'free',
        planType: 'free',
        checkedAt,
        reason,
        accessTokenMasked: normalizeString(input.accessTokenMasked || existingItem.accessTokenMasked),
        trialEligibilityStatus: 'eligible',
        trialEligibilityReason: reason,
        trialEligibilityCheckedAt: checkedAt,
        redeemStatus: existingItem.redeemStatus === 'success' ? existingItem.redeemStatus : normalizeString(existingItem.redeemStatus),
        redeemReason: existingItem.redeemReason,
        redeemFailureCount: existingItem.redeemStatus === 'success' ? 0 : existingItem.redeemFailureCount,
        redeemLastFailedAt: existingItem.redeemStatus === 'success' ? '' : existingItem.redeemLastFailedAt,
        upiRedeemCdkey: normalizeString(input.cdkey || existingItem.upiRedeemCdkey),
      });
      return saveResults({
        ...currentResults,
        items: nextItems,
        updatedAt: checkedAt,
        source: normalizeString(input.source || currentResults.source || 'registration-upi-eligibility'),
        total: Math.max(currentResults.total || 0, nextItems.length),
        completed: Math.max(currentResults.completed || 0, nextItems.length),
      });
    }

    function mergeCredentialsIntoResultItems(items = [], credentials = []) {
      let nextItems = Array.isArray(items) ? [...items] : [];
      credentials.forEach((credential) => {
        const email = normalizeEmail(credential.email);
        if (!email || nextItems.some((item) => normalizeEmail(item?.email) === email)) {
          return;
        }
        nextItems.push(normalizeResultItem({
          ...credential,
          status: 'free',
          planType: 'free',
          reason: '待补兑',
        }));
      });
      return nextItems;
    }

  function isRedeemTerminalResultItem(item = {}) {
    const redeemStatus = normalizeString(item.redeemStatus).toLowerCase();
    const status = normalizeString(item.status).toLowerCase();
    const redeemFailureCount = normalizeRetryCount(item.redeemFailureCount) || (redeemStatus === 'failed' ? 1 : 0);
    return status === 'paid'
        || (status !== 'free' && ['success', 'skipped'].includes(redeemStatus))
        || ['running', 'submitted', 'pending', 'processing', 'accepted'].includes(redeemStatus)
        || (
          redeemStatus === 'failed'
          && redeemFailureCount >= UPI_CREDENTIAL_MEMBERSHIP_REDEEM_FAILURE_LIMIT
        );
    }

    function filterRedeemableCredentialsForCurrentResults(credentials = [], results = {}) {
      const lookup = {};
      (Array.isArray(results.items) ? results.items : []).forEach((item) => {
        const email = normalizeEmail(item?.email);
        if (email) {
          lookup[email] = item;
        }
      });
      return (Array.isArray(credentials) ? credentials : []).filter((credential) => {
        const email = normalizeEmail(credential?.email);
        if (!email) {
          return false;
        }
        return !isRedeemTerminalResultItem(lookup[email] || {});
      });
    }

    function isCdkeyExhaustedError(error) {
      const message = getErrorMessage(error);
      return /(?:没有可用的\s*UPI\s*卡密|UPI\s*卡密不足|导入未使用卡密)/i.test(message);
    }

    function getRedeemResultSubscriptionCheckedAt(result = {}) {
      const raw = result.upiRedeemSubscriptionCheckedAt
        || result.subscriptionCheckedAt
        || result.subscription?.checkedAt
        || '';
      if (typeof raw === 'number') {
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString();
      }
      return normalizeString(raw);
    }

    function classifyRedeemResult(result = {}) {
      const planType = normalizePlanType(
        result.planType
        || result.upiRedeemSubscriptionPlanType
        || result.subscription?.planType
        || result.subscription?.plan_type
        || ''
      );
      const active = result.active === true
        || result.upiRedeemSubscriptionActive === true
        || result.subscription?.active === true
        || result.subscription?.hasActiveSubscription === true;
      return {
        active,
        planType,
        reason: normalizeString(result.reason || result.subscription?.reason || ''),
      };
    }

    async function checkCredentialPaidSubscription({ state = {}, credential = {}, accessToken = '', throwIfStopRequested = null } = {}) {
      if (typeof throwIfStopRequested === 'function') throwIfStopRequested();
      if (typeof checkUpiRedeemSubscriptionStatuses !== 'function') {
        throw new Error('UPI 会员状态查询能力尚未接入。');
      }
      const subscription = await checkUpiRedeemSubscriptionStatuses({
        ...state,
        items: [{
          id: credential.email,
          email: credential.email,
          token: accessToken,
          }],
      });
      if (typeof throwIfStopRequested === 'function') throwIfStopRequested();
      return classifySubscriptionResult(subscription?.items?.[0] || {});
    }

    async function removeOpenAiCookie(cookie) {
      const host = normalizeString(cookie?.domain).replace(/^\.+/, '');
      if (!host) return false;
      const path = normalizeString(cookie?.path || '/').startsWith('/')
        ? normalizeString(cookie?.path || '/')
        : `/${normalizeString(cookie?.path || '/')}`;
      const details = {
        url: `https://${host}${path}`,
        name: cookie.name,
      };
      if (cookie.storeId) details.storeId = cookie.storeId;
      if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
      try {
        return Boolean(await chromeApi.cookies.remove(details));
      } catch {
        return false;
      }
    }

    function shouldClearCookie(cookie) {
      const domain = normalizeString(cookie?.domain).replace(/^\.+/, '').toLowerCase();
      return Boolean(domain) && COOKIE_CLEAR_DOMAINS.some((target) => domain === target || domain.endsWith(`.${target}`));
    }

    async function clearOpenAiCookies() {
      if (!chromeApi?.cookies?.getAll || !chromeApi.cookies?.remove) return { removedCount: 0, candidateCount: 0 };
      const stores = chromeApi.cookies.getAllCookieStores
        ? await chromeApi.cookies.getAllCookieStores()
        : [{ id: undefined }];
      const cookies = [];
      const seen = new Set();
      for (const store of stores || []) {
        const batch = await chromeApi.cookies.getAll(store?.id ? { storeId: store.id } : {});
        for (const cookie of batch || []) {
          if (!shouldClearCookie(cookie)) continue;
          const key = [cookie.storeId || store?.id || '', cookie.domain || '', cookie.path || '', cookie.name || ''].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          cookies.push(cookie);
        }
      }
      let removedCount = 0;
      for (const cookie of cookies) {
        if (await removeOpenAiCookie(cookie)) removedCount += 1;
      }
      if (chromeApi.browsingData?.removeCookies) {
        await chromeApi.browsingData.removeCookies({ since: 0, origins: COOKIE_CLEAR_ORIGINS }).catch(() => null);
      }
      return { removedCount, candidateCount: cookies.length };
    }

    async function fetchJson(url, options = {}) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境不支持 fetch，无法调用远端接口。');
      }
      const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || TOTP_LOOKUP_TIMEOUT_MS));
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
      const requestOptions = { ...options };
      delete requestOptions.timeoutMs;
      if (controller) {
        requestOptions.signal = controller.signal;
      }
      let response;
      try {
        response = await fetchImpl(url, requestOptions);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error(`POST ${url} 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`);
        }
        throw error;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      const text = await response.text().catch(() => '');
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      if (!response.ok) {
        const reason = normalizeString(payload?.reason || payload?.detail || payload?.message || text);
        throw new Error(`POST ${url} 返回 HTTP ${response.status}${reason ? `：${reason}` : ''}`);
      }
      return payload;
    }

    async function requestTotpCodeBySecret({ secret }) {
      const code = await generateTotpCode(secret);
      return {
        code,
        secondsRemaining: getTotpSecondsRemaining(),
        source: 'local',
      };
    }

    async function requestTotpCodeByLookup({ baseUrl, email, key }) {
      const requestBody = { email };
      if (normalizeString(key)) requestBody.key = normalizeString(key);
        const payload = await fetchJson(`${normalizeTotpApiBaseUrl(baseUrl)}/api/v1/totp/lookup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestBody),
          timeoutMs: TOTP_LOOKUP_TIMEOUT_MS,
        });
      const ok = payload?.ok !== false;
      const reason = normalizeString(payload?.reason || payload?.message);
      if (!ok || (reason && reason !== 'ok')) {
        throw new Error(`TOTP lookup 返回失败：${reason || 'unknown'}`);
      }
      const code = normalizeString(payload?.code).replace(/[^\d]/g, '');
      if (!code) {
        throw new Error(`TOTP lookup 未返回 6 位动态码：${reason || JSON.stringify(payload).slice(0, 180)}`);
      }
      return {
        code,
        secondsRemaining: Math.floor(Number(payload?.secondsRemaining ?? payload?.seconds_remaining) || 0),
        payload,
        source: 'lookup',
      };
    }

    async function getTotpCodeForCredential({ state, credential, throwIfStopRequested = null }) {
      const baseUrl = normalizeTotpApiBaseUrl(state?.upiCredentialMembershipCheckTotpApiBaseUrl);
      const lookupKey = normalizeString(state?.upiCredentialMembershipCheckTotpLookupKey);
      const attempts = [];
      async function withFreshWindow(getter, label) {
        if (typeof throwIfStopRequested === 'function') throwIfStopRequested();
        let result = await getter();
        if (typeof throwIfStopRequested === 'function') throwIfStopRequested();
        if (result.secondsRemaining > 0 && result.secondsRemaining < 8) {
          await addLog(`UPI 备份核验：${credential.email} 的 ${label} 动态码剩余 ${result.secondsRemaining} 秒，等待下一周期后重新获取。`, 'info');
          await sleepWithStop(Math.min(35, result.secondsRemaining + 1) * 1000);
          if (typeof throwIfStopRequested === 'function') throwIfStopRequested();
          result = await getter();
          if (typeof throwIfStopRequested === 'function') throwIfStopRequested();
        }
        return result;
      }

      if (credential.totpMfaSecret) {
        try {
          return await withFreshWindow(
            () => requestTotpCodeBySecret({ secret: credential.totpMfaSecret }),
            '本地 TOTP'
          );
        } catch (error) {
          if (isMembershipStopError(error)) throw error;
          attempts.push(`本地 TOTP: ${getErrorMessage(error)}`);
        }
      }

      try {
        return await withFreshWindow(
          () => requestTotpCodeByLookup({ baseUrl, email: credential.email, key: lookupKey }),
          '/totp/lookup'
        );
      } catch (error) {
        if (isMembershipStopError(error)) throw error;
        attempts.push(`/totp/lookup: ${getErrorMessage(error)}`);
      }
      throw new Error(`TOTP 取码失败：${attempts.join('；')}`);
    }

    async function openFreshLoginTab(email) {
      if (typeof reuseOrCreateTab === 'function') {
        return reuseOrCreateTab(AUTH_SOURCE, CHATGPT_LOGIN_URL, {
          active: true,
          forceNew: true,
          inject: SIGNUP_PAGE_INJECT_FILES,
          injectSource: AUTH_SOURCE,
        });
      }
      const tab = await chromeApi.tabs.create({ url: CHATGPT_LOGIN_URL, active: true });
      await registerTab(AUTH_SOURCE, tab.id);
      return tab.id;
    }

    async function openFreshChatGptSessionTab() {
      if (typeof reuseOrCreateTab === 'function') {
        return reuseOrCreateTab(AUTH_SOURCE, CHATGPT_ENTRY_URL, {
          active: true,
          forceNew: true,
          inject: SIGNUP_PAGE_INJECT_FILES,
          injectSource: AUTH_SOURCE,
        });
      }
      const tab = await chromeApi.tabs.create({ url: CHATGPT_ENTRY_URL, active: true });
      await registerTab(AUTH_SOURCE, tab.id);
      return tab.id;
    }

    async function isBrowserTabAlive(tabId) {
      if (!Number.isInteger(tabId)) {
        return false;
      }
      if (chromeApi?.tabs?.get) {
        try {
          await chromeApi.tabs.get(tabId);
          return true;
        } catch {
          return false;
        }
      }
      return isTabAlive(tabId);
    }

    async function ensureAuthContentScript(tabId, timeoutMs = 30000, options = {}) {
      if (typeof ensureContentScriptReadyOnTabUntilStopped !== 'function') return;
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
      await ensureContentScriptReadyOnTabUntilStopped(AUTH_SOURCE, tabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: AUTH_SOURCE,
        timeoutMs,
      });
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
    }

    async function sendAuthMessage(tabId, message, options = {}) {
      if (typeof sendTabMessageUntilStopped !== 'function') {
        throw new Error('内容脚本通信能力尚未接入。');
      }
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
      await ensureAuthContentScript(tabId, options.readyTimeoutMs || 30000, {
        throwIfStopRequested: options.throwIfStopRequested,
      });
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
      const result = await sendTabMessageUntilStopped(tabId, AUTH_SOURCE, message, {
        timeoutMs: options.timeoutMs || 45000,
        responseTimeoutMs: options.responseTimeoutMs || 45000,
      });
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function getLoginAuthState(tabId, options = {}) {
      return sendAuthMessage(tabId, {
        type: 'GET_LOGIN_AUTH_STATE',
        payload: {},
      }, {
        timeoutMs: 15000,
        responseTimeoutMs: 15000,
        throwIfStopRequested: options.throwIfStopRequested,
      }).catch((error) => {
        if (isMembershipStopError(error)) throw error;
        return null;
      });
    }

    function isLoginEntryOpenStalledResult(result = {}) {
      return result?.step6Outcome === 'recoverable'
        && (
          normalizeString(result.reason) === 'login_entry_open_stalled'
          || /点击登录入口后仍未进入/.test(normalizeString(result.message))
        );
    }

    async function navigateLoginTabToDirectLogin(tabId, options = {}) {
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
      if (!chromeApi?.tabs?.update) {
        return false;
      }
      await chromeApi.tabs.update(tabId, { url: CHATGPT_LOGIN_URL, active: true });
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
      await sleepWithStop(1500);
      if (typeof options.throwIfStopRequested === 'function') options.throwIfStopRequested();
      await ensureAuthContentScript(tabId, 45000, {
        throwIfStopRequested: options.throwIfStopRequested,
      });
      return true;
    }

    function mergeLoginChallengeState(loginResult = {}, authState = {}) {
      const resultState = loginResult && typeof loginResult === 'object' ? loginResult : {};
      const pageState = authState && typeof authState === 'object' ? authState : {};
      const liveState = normalizeString(pageState.state || resultState.state);
      const pageStateHasFreshState = Boolean(normalizeString(pageState.state));
      const pageStateIndicatesVerification = pageStateHasFreshState && Boolean(
        pageState.verificationReady
        || pageState.loginVerificationRequestedAt
        || pageState.verificationVisible
        || pageState.hasVerificationTarget
        || liveState === 'verification_page'
        || liveState === 'phone_verification_page'
      );
      const shouldDiscardStaleVerificationFlags = pageStateHasFreshState && !pageStateIndicatesVerification;
      return {
        ...resultState,
        ...pageState,
        ...(shouldDiscardStaleVerificationFlags ? {
          verificationReady: false,
          loginVerificationRequestedAt: null,
          verificationVisible: false,
          hasVerificationTarget: false,
        } : {}),
        state: liveState,
        url: normalizeString(pageState.url || resultState.url),
        verificationKind: normalizeVerificationKind(pageState.verificationKind || resultState.verificationKind),
        displayedEmail: shouldDiscardStaleVerificationFlags
          ? normalizeString(pageState.displayedEmail)
          : normalizeString(pageState.displayedEmail || resultState.displayedEmail),
      };
    }

    function hasLoginVerificationChallenge(snapshot = {}) {
      const state = normalizeString(snapshot.state);
      return Boolean(
        snapshot.verificationReady
        || snapshot.loginVerificationRequestedAt
        || snapshot.verificationVisible
        || snapshot.hasVerificationTarget
        || state === 'verification_page'
        || state === 'phone_verification_page'
      );
    }

    function isEmailVerificationChallenge(snapshot = {}) {
      const kind = normalizeVerificationKind(snapshot.verificationKind);
      const pathAndUrl = `${normalizeString(snapshot.path)} ${normalizeString(snapshot.url)}`;
      return kind === 'email'
        || Boolean(snapshot.displayedEmail)
        || /\/email-verification(?:[/?#]|$)/i.test(pathAndUrl);
    }

    function isPhoneVerificationChallenge(snapshot = {}) {
      const kind = normalizeVerificationKind(snapshot.verificationKind);
      const state = normalizeString(snapshot.state);
      return kind === 'phone'
        || state === 'phone_verification_page'
        || Boolean(snapshot.phoneVerificationPage);
    }

    function isTotpVerificationChallenge(snapshot = {}) {
      const kind = normalizeVerificationKind(snapshot.verificationKind);
      const pathAndUrl = `${normalizeString(snapshot.path)} ${normalizeString(snapshot.url)}`;
      return kind === 'totp' || /\/(?:mfa|totp|2fa|two-factor)(?:[/?#]|$)/i.test(pathAndUrl);
    }

    function isChatGptUrl(url = '') {
      try {
        const parsed = new URL(normalizeString(url));
        const hostname = parsed.hostname.toLowerCase();
        if (!['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(hostname)) {
          return false;
        }
        return !/^\/auth(?:[/?#]|$)/i.test(parsed.pathname || '');
      } catch {
        return false;
      }
    }

    async function getTabUrl(tabId) {
      if (!chromeApi?.tabs?.get) return '';
      try {
        const tab = await chromeApi.tabs.get(tabId);
        return normalizeString(tab?.url);
      } catch {
        return '';
      }
    }

    async function getExistingChatGptSessionTabIds() {
      if (!chromeApi?.tabs?.query) return [];
      let tabs = [];
      try {
        tabs = await chromeApi.tabs.query({
          url: [
            'https://chatgpt.com/*',
            'https://www.chatgpt.com/*',
            'https://chat.openai.com/*',
          ],
        });
      } catch {
        try {
          tabs = await chromeApi.tabs.query({});
        } catch {
          tabs = [];
        }
      }
      return (Array.isArray(tabs) ? tabs : [])
        .filter((tab) => Number.isInteger(tab?.id) && isChatGptUrl(tab.url))
        .map((tab) => tab.id);
    }

    async function ensureChatGptSessionTab(tabId) {
      const currentUrl = await getTabUrl(tabId);
      if (isChatGptUrl(currentUrl)) return false;
      if (!chromeApi?.tabs?.update) return false;
      await chromeApi.tabs.update(tabId, { url: CHATGPT_ENTRY_URL, active: true });
      return true;
    }

    function buildLoginFailureReason(snapshot = {}, fallback = '') {
      const state = normalizeString(snapshot.state);
      if (state === 'phone_verification_page' || snapshot.phoneVerificationPage) return '登录后需要手机号验证码';
      if (state === 'add_phone_page' || snapshot.addPhonePage) return '登录后需要添加/验证手机号';
      if (state === 'verification_page' || snapshot.verificationVisible) {
        if (isEmailVerificationChallenge(snapshot)) return '登录后需要邮箱一次性验证码';
        if (isTotpVerificationChallenge(snapshot)) return '登录后仍停留在 2FA 验证码页面';
        return fallback || '登录后仍停留在验证码页面';
      }
      if (state === 'password_page') return '登录密码未通过或仍停留在密码页';
      if (state === 'login_timeout_error_page') return '认证页登录超时或触发重试/风控';
      if (state === 'email_page') return '登录后仍停留在邮箱输入页';
      return fallback || `未进入 ChatGPT 已登录态${state ? `（${state}）` : ''}`;
    }

    function isRecoverableCodeSubmitStateError(error) {
      const message = getErrorMessage(error);
      return /当前未进入登录验证码页面/i.test(message)
        || /消息发送超时/i.test(message)
        || /消息响应超时/i.test(message)
        || /Could not establish connection/i.test(message)
        || /Receiving end does not exist/i.test(message)
        || /message channel is closed/i.test(message)
        || /Extension context invalidated/i.test(message);
    }

    function getChatGptSessionEmail(result = {}) {
      return normalizeEmail(
        result?.email
        || result?.session?.user?.email
        || result?.session?.email
        || result?.user?.email
        || ''
      );
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

    function getChatGptSessionFieldCount(value = {}) {
      const session = normalizeChatGptSessionPayload(value);
      return session && typeof session === 'object' && !Array.isArray(session)
        ? Object.keys(session).length
        : 0;
    }

    function hasChatGptSessionPayload(value = {}) {
      return getChatGptSessionFieldCount(value) > 0;
    }

    function getChatGptSessionAccessToken(value = {}) {
      const session = normalizeChatGptSessionPayload(value);
      return normalizeString(value?.accessToken || value?.access_token || session.accessToken || session.access_token);
    }

    function getCredentialSessionMatch(result = {}, credential = {}) {
      const sessionEmail = getChatGptSessionEmail(result);
      const targetEmail = normalizeEmail(credential.email);
      return {
        sessionEmail,
        targetEmail,
        matches: Boolean(sessionEmail && targetEmail && sessionEmail === targetEmail),
      };
    }

    async function tryReadCredentialSessionFromTab(tabId, credential = {}, options = {}) {
      const throwIfStopRequested = resolveStopChecker(options, 'check');
      throwIfStopRequested();
      const currentUrl = await getTabUrl(tabId);
      throwIfStopRequested();
      if (!isChatGptUrl(currentUrl)) {
        return null;
      }
      try {
        await ensureAuthContentScript(tabId, 8000, { throwIfStopRequested });
        const result = await sendAuthMessage(tabId, {
          type: 'READ_CHATGPT_SESSION_EXPORT_DATA',
          payload: {},
        }, {
          timeoutMs: 10000,
          responseTimeoutMs: 10000,
          readyTimeoutMs: 8000,
          throwIfStopRequested,
        });
        throwIfStopRequested();
        if (!hasChatGptSessionPayload(result)) {
          return null;
        }
        const accessToken = getChatGptSessionAccessToken(result);
        const { sessionEmail, targetEmail, matches } = getCredentialSessionMatch(result, credential);
        if (!matches) {
          if (targetEmail) {
            await addLog(
              `UPI 备份核验：检测到已登录账号 ${sessionEmail || '未知账号'}，与目标 ${targetEmail} 不一致，继续重新登录。`,
              'warn'
            );
          }
          return null;
        }
        await addLog(
          options.message || `UPI 备份核验：检测到 ${targetEmail} 已在 ChatGPT 登录，跳过登录和 2FA。`,
          'ok'
        );
        return {
          tabId,
          accessToken,
          session: result,
        };
      } catch (error) {
        if (isMembershipStopError(error)) throw error;
        return null;
      }
    }

    async function tryReadExistingCredentialSession(credential = {}, options = {}) {
      const throwIfStopRequested = resolveStopChecker(options, 'check');
      const tabIds = await getExistingChatGptSessionTabIds();
      for (const tabId of tabIds) {
        throwIfStopRequested();
        const session = await tryReadCredentialSessionFromTab(tabId, credential, { throwIfStopRequested });
        if (hasChatGptSessionPayload(session?.session || session)) {
          return session;
        }
      }
      return null;
    }

    async function readChatGptSession(tabId, options = {}) {
      const throwIfStopRequested = resolveStopChecker(options, 'check');
      let activeTabId = tabId;
      const startedAt = Date.now();
      let lastError = null;
      let triedChatGptNavigation = false;
      let reopenedAfterClose = false;
      await addLog('UPI 备份核验：第 5 步开始读取 ChatGPT session。', 'info');
      while (Date.now() - startedAt < 45000) {
        throwIfStopRequested();
        if (!(await isBrowserTabAlive(activeTabId))) {
          throwIfStopRequested();
          if (reopenedAfterClose) {
            throw new Error('登录标签页已关闭，重新打开 ChatGPT 后仍无法读取 session。');
          }
          reopenedAfterClose = true;
          activeTabId = await openFreshChatGptSessionTab();
          throwIfStopRequested();
          triedChatGptNavigation = false;
          await addLog('UPI 备份核验：登录标签页已关闭，正在重新打开 ChatGPT 读取 session。', 'warn');
          continue;
        }
        try {
          if (!triedChatGptNavigation) {
            triedChatGptNavigation = true;
            if (await ensureChatGptSessionTab(activeTabId)) {
              await addLog('UPI 备份核验：登录后正在切回 ChatGPT 读取 session。', 'info');
            }
          }
          throwIfStopRequested();
          await ensureAuthContentScript(activeTabId, 15000, { throwIfStopRequested });
          const result = await sendAuthMessage(activeTabId, {
            type: 'READ_CHATGPT_SESSION_EXPORT_DATA',
            payload: {},
          }, {
            timeoutMs: 20000,
            responseTimeoutMs: 20000,
            throwIfStopRequested,
          });
          throwIfStopRequested();
          if (hasChatGptSessionPayload(result)) {
            const accessToken = getChatGptSessionAccessToken(result);
            await addLog(
              `UPI 备份核验：第 5 步已读取 ChatGPT session：session字段 ${getChatGptSessionFieldCount(result)}${accessToken ? `（token 摘要 ${maskAccessToken(accessToken)}）` : ''}。`,
              'ok'
            );
            return {
              ...result,
              accessToken,
            };
          }
          await addLog('UPI 备份核验：第 5 步本次读取未返回 ChatGPT session，1 秒后重试。', 'info');
        } catch (error) {
          if (isMembershipStopError(error)) throw error;
          lastError = error;
          await addLog(`UPI 备份核验：第 5 步读取 ChatGPT session 失败，将重试：${getErrorMessage(error)}`, 'warn');
        }
        await sleepWithStop(1000);
        throwIfStopRequested();
      }
      const snapshot = await getLoginAuthState(activeTabId, { throwIfStopRequested });
      throw new Error(buildLoginFailureReason(snapshot, getErrorMessage(lastError) || '未读取到 ChatGPT session'));
    }

    async function submitLoginTotpOrYieldToSessionRead(tabId, totpCode, credential, options = {}) {
      const throwIfStopRequested = resolveStopChecker(options, 'check');
      const submitPromise = sendAuthMessage(tabId, {
        type: 'FILL_CODE',
        step: 8,
        payload: {
          code: totpCode,
          visibleStep: 8,
          purpose: 'login',
          loginIdentifierType: 'email',
        },
      }, {
        timeoutMs: 45000,
        responseTimeoutMs: 45000,
        throwIfStopRequested,
      });

      const submitOutcome = submitPromise.then(
        (result) => ({ type: 'submit', result }),
        (error) => ({ type: 'submit-error', error })
      );
      const earlySessionCheck = sleepWithStop(LOGIN_TOTP_SUBMIT_SESSION_RACE_MS)
        .then(() => ({ type: 'session-check' }));
      const firstOutcome = await Promise.race([submitOutcome, earlySessionCheck]);
      throwIfStopRequested();

      if (firstOutcome.type === 'submit') {
        const codeResult = firstOutcome.result;
        if (codeResult?.invalidCode) {
          throw new Error(`2FA 动态码被页面拒绝：${codeResult.errorText || 'Incorrect code'}`);
        }
        if (codeResult?.addPhonePage) {
          throw new Error('登录后需要添加/验证手机号');
        }
        return null;
      }

      if (firstOutcome.type === 'submit-error') {
        if (isMembershipStopError(firstOutcome.error)) throw firstOutcome.error;
        if (!isRecoverableCodeSubmitStateError(firstOutcome.error)) {
          throw firstOutcome.error;
        }
        await addLog(
          `UPI 备份核验：${credential.email} 提交 2FA 时认证页状态已变化（${getErrorMessage(firstOutcome.error)}），尝试直接读取 ChatGPT 登录态。`,
          'warn'
        );
        return null;
      }

      await addLog(
        `UPI 备份核验：${credential.email} 提交 2FA 后页面仍在等待，先进入 ChatGPT session 读取步骤。`,
        'info'
      );
      return null;
    }

    async function loginAndReadAccessToken(credential, state, options = {}) {
      const throwIfStopRequested = resolveStopChecker(options, 'check');
      const allowSessionMismatchRetry = options.sessionMismatchRetry !== false;
      const reportStage = async (stage) => {
        throwIfStopRequested();
        if (typeof options.onStage === 'function') {
          await options.onStage(normalizeFlowStage(stage) || stage);
        }
        throwIfStopRequested();
      };
      await reportStage('open-chatgpt');
      const existingSession = await tryReadExistingCredentialSession(credential, { throwIfStopRequested });
      if (hasChatGptSessionPayload(existingSession?.session || existingSession)) {
        await reportStage('token');
        await addLog(
          `UPI 备份核验：${credential.email} 第 5 步复用现有 ChatGPT session：session字段 ${getChatGptSessionFieldCount(existingSession?.session || existingSession)}。`,
          'ok'
        );
        return existingSession;
      }
      throwIfStopRequested();
      await clearOpenAiCookies();
      throwIfStopRequested();
      const tabId = await openFreshLoginTab(credential.email);
      throwIfStopRequested();
      await ensureAuthContentScript(tabId, 45000, { throwIfStopRequested });
      await addLog(`UPI 备份核验：正在登录 ${credential.email}...`, 'info');
      await reportStage('login');
      const loginPayload = {
        visibleStep: 7,
        email: credential.email,
        password: credential.password,
        loginIdentifierType: 'email',
      };
      const executeLoginNode = () => sendAuthMessage(tabId, {
        type: 'EXECUTE_NODE',
        nodeId: 'oauth-login',
        payload: loginPayload,
      }, {
        timeoutMs: 120000,
        responseTimeoutMs: 120000,
        throwIfStopRequested,
      });
      let loginResult = await executeLoginNode();
      throwIfStopRequested();
      if (isLoginEntryOpenStalledResult(loginResult) && await navigateLoginTabToDirectLogin(tabId, { throwIfStopRequested })) {
        await addLog(
          `UPI 备份核验：${credential.email} 点击登录入口后未进入登录表单，已改用 /auth/login 直达登录页重试。`,
          'warn'
        );
        loginResult = await executeLoginNode();
        throwIfStopRequested();
      }

      const liveAuthState = await getLoginAuthState(tabId, { throwIfStopRequested });
      throwIfStopRequested();
      const loginChallenge = mergeLoginChallengeState(loginResult, liveAuthState);
      const loginNeedsCode = hasLoginVerificationChallenge(loginChallenge);
      if (
        loginResult?.step6Outcome === 'recoverable'
        && !loginNeedsCode
      ) {
        throw new Error(loginResult.message || buildLoginFailureReason(loginChallenge, '登录未进入验证码页'));
      }
      if (loginNeedsCode) {
        const currentSession = await tryReadCredentialSessionFromTab(tabId, credential, {
          message: `UPI 备份核验：${credential.email} 已进入 ChatGPT 登录态，跳过提交 2FA。`,
          throwIfStopRequested,
        });
        if (hasChatGptSessionPayload(currentSession?.session || currentSession)) {
          await reportStage('token');
          await addLog(
            `UPI 备份核验：${credential.email} 第 5 步已从当前登录态读取 ChatGPT session：session字段 ${getChatGptSessionFieldCount(currentSession?.session || currentSession)}。`,
            'ok'
          );
          return currentSession;
        }
        if (isPhoneVerificationChallenge(loginChallenge)) {
          throw new Error('登录需要手机验证码，备份会员核验暂不处理手机号验证。');
        }
        if (isEmailVerificationChallenge(loginChallenge)) {
          throw new Error('登录需要邮箱一次性验证码，不能使用 2FA 动态码；请先在网页完成登录验证或换用不触发邮箱验证码的环境后重试。');
        }
        if (!isTotpVerificationChallenge(loginChallenge)) {
          await addLog(
            `UPI 备份核验：${credential.email} 的登录验证码页类型未明确识别，尝试按 2FA/TOTP 动态码处理。`,
            'warn'
          );
        }
        await reportStage('totp');
        const totp = await getTotpCodeForCredential({ state, credential, throwIfStopRequested });
        await addLog(
          `UPI 备份核验：已通过${totp.source === 'lookup' ? 'TOTP lookup 兜底接口' : '本地 TOTP'}获取 ${credential.email} 的 6 位码。`,
          'ok'
        );
        throwIfStopRequested();
        const latestAuthState = await getLoginAuthState(tabId, { throwIfStopRequested });
        throwIfStopRequested();
        const latestChallenge = mergeLoginChallengeState(loginChallenge, latestAuthState);
        if (!hasLoginVerificationChallenge(latestChallenge)) {
          await addLog(
            `UPI 备份核验：${credential.email} 的认证页已离开 2FA 输入页，尝试直接读取 ChatGPT 登录态。`,
            'warn'
          );
        } else {
          if (isPhoneVerificationChallenge(latestChallenge)) {
            throw new Error('登录需要手机验证码，备份会员核验暂不处理手机号验证。');
          }
          if (isEmailVerificationChallenge(latestChallenge)) {
            throw new Error('登录需要邮箱一次性验证码，不能使用 2FA 动态码；请先在网页完成登录验证或换用不触发邮箱验证码的环境后重试。');
          }
          await submitLoginTotpOrYieldToSessionRead(tabId, totp.code, credential, { throwIfStopRequested });
        }
      }

      await reportStage('token');
      const session = await readChatGptSession(tabId, { throwIfStopRequested });
      throwIfStopRequested();
      const { sessionEmail, targetEmail, matches } = getCredentialSessionMatch(session, credential);
      if (!matches) {
        const mismatchMessage = `UPI 备份核验：${credential.email} 第 5 步读取到的 ChatGPT session 属于 ${sessionEmail || '未知账号'}，不是当前目标 ${targetEmail || credential.email}`;
        if (allowSessionMismatchRetry) {
          await addLog(`${mismatchMessage}，将清理登录态后重新登录当前账号。`, 'warn');
          throwIfStopRequested();
          await clearOpenAiCookies();
          throwIfStopRequested();
          return loginAndReadAccessToken(credential, state, {
            ...options,
            sessionMismatchRetry: false,
          });
        }
        throw createSessionAccountMismatchError(`${mismatchMessage}，已停止提交卡密。`, {
          sessionEmail,
          targetEmail,
        });
      }
      await addLog(
        `UPI 备份核验：${credential.email} 第 5 步 ChatGPT session 读取完成：session字段 ${getChatGptSessionFieldCount(session)}（账号已确认：${sessionEmail}）。`,
        'ok'
      );
      return {
        tabId,
        accessToken: getChatGptSessionAccessToken(session),
        session,
      };
    }

    async function checkOneCredential(credential, state, options = {}) {
      const throwIfStopRequested = resolveStopChecker(options, 'check');
      const reportStage = async (stage) => {
        throwIfStopRequested();
        if (typeof options.onStage === 'function') {
          await options.onStage(stage);
        }
        throwIfStopRequested();
      };
      const checkedAt = new Date().toISOString();
      if (!credential.email) {
        return normalizeResultItem({ ...credential, status: 'failed', checkedAt, reason: '缺少邮箱' });
      }
      if (!credential.password) {
        return normalizeResultItem({ ...credential, status: 'failed', checkedAt, reason: '缺少 GPT 密码' });
      }
      try {
        const session = await loginAndReadAccessToken(credential, state, {
          onStage: reportStage,
          throwIfStopRequested,
        });
        throwIfStopRequested();
        if (!session.accessToken) {
          throw new Error('未读取到 accessToken');
        }
        if (typeof checkUpiRedeemSubscriptionStatuses !== 'function') {
          throw new Error('UPI 会员状态查询能力尚未接入。');
        }
        await reportStage('subscription-check');
        const subscription = await checkUpiRedeemSubscriptionStatuses({
          ...state,
          items: [{
            id: credential.email,
            email: credential.email,
            token: session.accessToken,
          }],
        });
        throwIfStopRequested();
        const item = subscription?.items?.[0] || {};
        const classification = classifySubscriptionResult(item);
        return normalizeResultItem({
          ...credential,
          status: classification.status,
          planType: classification.planType,
          checkedAt,
          reason: classification.reason,
          accessTokenMasked: maskAccessToken(session.accessToken),
        });
      } catch (error) {
        if (isMembershipStopError(error)) throw error;
        return normalizeResultItem({
          ...credential,
          status: 'failed',
          checkedAt,
          reason: getErrorMessage(error),
        });
      }
    }

    async function checkUpiCredentialMembershipOne(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning) {
        throw new Error('UPI 无会员账号补兑正在运行，请等待完成或先停止。');
      }
      const inputCredential = input.credential && typeof input.credential === 'object' && !Array.isArray(input.credential)
        ? input.credential
        : {};
      const targetEmail = normalizeEmail(input.email || inputCredential.email);
      if (!targetEmail) {
        throw new Error('缺少要检测的账号邮箱。');
      }

      batchRunning = true;
      batchStopRequested = false;
      const startedAt = new Date().toISOString();
      const runtimeState = {
        ...(await getState()),
        ...(input.settings || {}),
      };
      let currentResults = await getStoredResults();
      let items = Array.isArray(currentResults.items) ? [...currentResults.items] : [];
      const existingItem = items.find((item) => normalizeEmail(item?.email) === targetEmail) || {};
      let backupCredential = {};
      try {
        const pool = await getUpiCredentialMembershipCredentialPool();
        backupCredential = (pool.items || []).find((item) => normalizeEmail(item?.email) === targetEmail) || {};
      } catch {
        backupCredential = {};
      }
      const credential = normalizeResultItem({
        ...existingItem,
        ...backupCredential,
        ...inputCredential,
        email: targetEmail,
      });

      const updateSingleStage = async (stage, reason = '') => {
        throwIfMembershipStopRequested('check');
        if (reason) {
          const existingStatus = ['paid', 'free', 'failed'].includes(normalizeString(existingItem.status))
            ? normalizeString(existingItem.status)
            : 'free';
          items = upsertResultItem(items, {
            ...(existingItem || {}),
            ...credential,
            status: existingStatus,
            reason,
            checkedAt: startedAt,
          });
        }
        currentResults = await saveResults({
          ...currentResults,
          items,
          running: true,
          updatedAt: new Date().toISOString(),
          flowStage: stage,
          flowStageEmail: targetEmail,
          source: normalizeString(input.source || currentResults.source || runtimeState.source || credential.source || 'single'),
          total: Math.max(currentResults.total || 0, items.length || 1),
          completed: Math.max(currentResults.completed || 0, 0),
        });
        throwIfMembershipStopRequested('check');
      };

      try {
        await addLog(`UPI 单账号会员检测：开始检测 ${targetEmail} 是否已开通 Plus/Pro/Team。`, 'info');
        await updateSingleStage('open-chatgpt', '正在单独检测会员状态');
        const resultItem = await checkOneCredential(credential, {
          ...runtimeState,
          ...currentResults,
        }, {
          onStage: async (stage) => updateSingleStage(stage, getUpiCredentialMembershipFlowStageReason(stage)),
          throwIfStopRequested: () => throwIfMembershipStopRequested('check'),
        });
        const resultStatus = normalizeString(resultItem.status).toLowerCase();
        const existingRedeemStatus = normalizeString(existingItem.redeemStatus).toLowerCase();
        const shouldClearRedeemSuccess = resultStatus === 'free' && ['success', 'skipped'].includes(existingRedeemStatus);
        items = upsertResultItem(items, {
          ...existingItem,
          ...credential,
          ...resultItem,
          redeemStatus: shouldClearRedeemSuccess ? '' : (existingItem.redeemStatus || resultItem.redeemStatus),
          redeemReason: shouldClearRedeemSuccess ? '' : (existingItem.redeemReason || resultItem.redeemReason),
          upiRedeemCdkey: existingItem.upiRedeemCdkey || resultItem.upiRedeemCdkey,
          upiRedeemSubscriptionCheckedAt: resultItem.checkedAt || existingItem.upiRedeemSubscriptionCheckedAt,
          membershipOverrideStatus: resultStatus === 'free'
            ? 'free'
            : resultStatus === 'paid'
              ? ''
              : existingItem.membershipOverrideStatus,
          membershipOverrideCheckedAt: resultStatus === 'free'
            ? (resultItem.checkedAt || startedAt)
            : resultStatus === 'paid'
              ? ''
              : existingItem.membershipOverrideCheckedAt,
        });
        const finishedAt = new Date().toISOString();
        currentResults = await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: finishedAt,
          flowStage: '',
          flowStageEmail: '',
          total: Math.max(currentResults.total || 0, items.length),
          completed: Math.max(currentResults.completed || 0, items.length),
        });
        await addLog(
          `UPI 单账号会员检测：${targetEmail} -> ${resultItem.status === 'paid' ? `有会员 ${resultItem.planType || ''}` : resultItem.status === 'free' ? '无会员' : `失败：${resultItem.reason || ''}`}`,
          resultItem.status === 'paid' ? 'ok' : resultItem.status === 'free' ? 'warn' : 'error'
        );
        return {
          item: resultItem,
          results: currentResults,
        };
      } finally {
        batchRunning = false;
      }
    }

    function getUpiCredentialMembershipFlowStageReason(stage = '') {
      switch (normalizeFlowStage(stage)) {
        case 'open-chatgpt': return '正在打开 ChatGPT 官网';
        case 'login': return '正在登录邮箱密码';
        case 'totp': return '正在提交 2FA 验证';
        case 'token': return '正在读取 ChatGPT session';
        case 'subscription-check': return '正在查询会员资格';
        default: return '正在单独检测会员状态';
      }
    }

    async function checkUpiCredentialMembershipBatch(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning) {
        throw new Error('UPI 无会员账号补兑正在运行，请等待完成或先停止。');
      }
      batchRunning = true;
      batchStopRequested = false;
      const startedAt = new Date().toISOString();
      try {
        const runtimeState = {
          ...(await getState()),
          ...(input.settings || {}),
        };
        const source = normalizeString(input.source || (input.text || input.fileContent ? 'txt' : 'local'));
        const credentials = source === 'local'
          ? await getBackupCredentialsFromLocalStorage()
          : resolveInputCredentials(input);
        let currentResults = await saveResults({
          items: [],
          running: true,
          startedAt,
          updatedAt: startedAt,
          flowStage: 'import',
          flowStageEmail: '',
          source,
          total: credentials.length,
          completed: 0,
        });
        if (!credentials.length) {
          return await saveResults({
            ...currentResults,
            running: false,
            finishedAt: new Date().toISOString(),
            flowStage: '',
            flowStageEmail: '',
          });
        }

        await addLog(`UPI 备份账号会员核验：开始核验 ${credentials.length} 个账号。`, 'info');
        const items = [];
        for (const credential of credentials) {
          throwIfStopped();
          if (batchStopRequested) break;
          const throwIfStopRequested = () => throwIfMembershipStopRequested('check');
          const reportStage = async (stage) => {
            throwIfStopRequested();
            currentResults = await saveResults({
              ...currentResults,
              items,
              running: true,
              updatedAt: new Date().toISOString(),
              source,
              total: credentials.length,
              completed: items.length,
              flowStage: stage,
              flowStageEmail: credential.email,
            });
            throwIfStopRequested();
          };
          let result;
          try {
            result = await checkOneCredential(credential, runtimeState, {
              onStage: reportStage,
              throwIfStopRequested,
            });
          } catch (error) {
            if (isMembershipStopError(error)) {
              batchStopRequested = true;
              await addLog('UPI 备份账号会员核验：已停止，当前账号不会继续查会员。', 'warn');
              break;
            }
            throw error;
          }
          items.push(result);
          currentResults = await saveResults({
            ...currentResults,
            items,
            running: true,
            startedAt,
            updatedAt: new Date().toISOString(),
            source,
            total: credentials.length,
            completed: items.length,
          });
          const label = result.status === 'paid' ? `有会员 ${result.planType || ''}` : result.status === 'free' ? '无会员' : `失败：${result.reason}`;
          await addLog(`UPI 备份账号会员核验：${credential.email} -> ${label}`, result.status === 'failed' ? 'warn' : 'ok');
        }
        const finishedAt = new Date().toISOString();
        const finalResults = await saveResults({
          items,
          running: false,
          startedAt,
          updatedAt: finishedAt,
          finishedAt: batchStopRequested ? '' : finishedAt,
          stoppedAt: batchStopRequested ? finishedAt : '',
          flowStage: batchStopRequested ? currentResults.flowStage : '',
          flowStageEmail: batchStopRequested ? currentResults.flowStageEmail : '',
          source,
          total: credentials.length,
          completed: items.length,
        });
        if (batchStopRequested) {
          await addLog(`UPI 备份账号会员核验：已停止，已完成 ${finalResults.completed}/${finalResults.total}。`, 'warn');
        } else {
          await addLog(`UPI 备份账号会员核验：完成 ${finalResults.completed}/${finalResults.total}，有会员 ${finalResults.paidCount}，无会员 ${finalResults.freeCount}，失败 ${finalResults.failedCount}。`, 'ok');
        }
        return finalResults;
      } finally {
        batchRunning = false;
      }
    }

    async function redeemUpiCredentialMembershipFree(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning) {
        throw new Error('UPI 无会员账号补兑正在运行，请等待完成或先停止。');
      }
      if (typeof redeemUpiCredentialWithAccessToken !== 'function') {
        throw new Error('UPI 无会员账号补兑能力尚未接入。');
      }

      redeemRunning = true;
      redeemStopRequested = false;
      const startedAt = new Date().toISOString();
      let redeemCompleted = 0;
      let currentResults = await getStoredResults();
      const requestedCredentials = resolveInputCredentials(input)
        .filter((credential) => credential.email);
      let items = mergeCredentialsIntoResultItems(currentResults.items, requestedCredentials);
      const source = normalizeString(input.source || currentResults.source || 'free-selected');
      const deleteBackups = input.deleteBackups !== false;
      const redeemAutoDeletedEmails = [];
      const credentials = filterRedeemableCredentialsForCurrentResults(requestedCredentials, {
        ...currentResults,
        items,
      });
      const skippedCompletedCount = Math.max(0, requestedCredentials.length - credentials.length);
      const runtimeSettings = input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
        ? input.settings
        : {};

      try {
        if (skippedCompletedCount) {
          await addLog(`UPI 无会员补兑：已跳过 ${skippedCompletedCount} 个重载前已处理账号，只继续未完成账号。`, 'info');
        }
        if (credentials.length) {
          if (typeof setState === 'function' && Object.keys(runtimeSettings).length) {
            await setState(runtimeSettings).catch(() => {});
          }
          await assertUpiRedeemSettingsReadyForMembershipRedeem(credentials, runtimeSettings);
        }

        currentResults = await saveResults({
          ...currentResults,
          items,
          redeeming: true,
          redeemStartedAt: startedAt,
          redeemUpdatedAt: startedAt,
          redeemFinishedAt: '',
          redeemStoppedAt: '',
          flowStage: 'import',
          flowStageEmail: '',
          redeemTotal: credentials.length,
          redeemCompleted: 0,
          source,
          redeemAutoDeletedEmails,
          redeemAutoDeletedCount: 0,
        });

        if (!credentials.length) {
          const finishedAt = new Date().toISOString();
          return await saveResults({
            ...currentResults,
            redeeming: false,
            redeemUpdatedAt: finishedAt,
            redeemFinishedAt: finishedAt,
            redeemTotal: 0,
            redeemCompleted: 0,
            flowStage: '',
            flowStageEmail: '',
            redeemAutoDeletedEmails,
            redeemAutoDeletedCount: 0,
          });
        }

        await addLog(`UPI 无会员补兑：开始处理 ${credentials.length} 个账号。`, 'info');
        for (let index = 0; index < credentials.length; index += 1) {
          throwIfStopped();
          if (redeemStopRequested) break;

          const credential = credentials[index];
          const throwIfStopRequested = () => throwIfMembershipStopRequested('redeem');
          const checkedAt = new Date().toISOString();
          const existingItem = items.find((item) => normalizeEmail(item?.email) === normalizeEmail(credential.email)) || {};
          const resetPreSubmitBlockedFailure = isPreSubmitUpiRedeemBlockedResultItem(existingItem);
          const baseItem = {
            ...existingItem,
            ...credential,
            status: 'free',
            planType: 'free',
            checkedAt,
            ...(resetPreSubmitBlockedFailure ? {
              reason: 'Free 分组账号，可提交卡密兑换',
              redeemStatus: '',
              redeemReason: '',
              redeemFailureCount: 0,
              redeemLastFailedAt: '',
              upiRedeemCdkey: '',
            } : {}),
          };
          const updateRedeemStage = async (stage, reason = '') => {
            throwIfStopRequested();
            if (reason) {
              items = upsertResultItem(items, {
                ...baseItem,
                redeemStatus: 'running',
                redeemReason: reason,
              });
            }
            currentResults = await saveResults({
              ...currentResults,
              items,
              redeeming: true,
              redeemUpdatedAt: new Date().toISOString(),
              redeemTotal: credentials.length,
              redeemCompleted,
              source,
              flowStage: stage,
              flowStageEmail: credential.email,
            });
            throwIfStopRequested();
          };

          items = upsertResultItem(items, {
            ...baseItem,
            redeemStatus: 'running',
            redeemReason: '正在登录并准备兑换',
          });
          currentResults = await saveResults({
            ...currentResults,
            items,
            redeeming: true,
            redeemUpdatedAt: checkedAt,
            redeemTotal: credentials.length,
            redeemCompleted,
            source,
            flowStage: 'open-chatgpt',
            flowStageEmail: credential.email,
          });

          let attemptedUpiRedeemCdkey = '';
          try {
            throwIfStopRequested();
            if (!credential.password) {
              throw new Error('缺少 GPT 密码');
            }
            if (!credential.totpMfaSecret) {
              throw new Error('缺少 2FA 密钥');
            }
            const session = await loginAndReadAccessToken(credential, currentResults, {
              onStage: async (stage) => updateRedeemStage(stage, {
                'open-chatgpt': '正在打开 ChatGPT 官网',
                login: '正在登录邮箱密码',
                totp: '正在提交 2FA 验证',
                token: '正在读取 ChatGPT session',
              }[stage] || '正在登录并准备兑换'),
              throwIfStopRequested,
            });
            throwIfStopRequested();
            if (!hasChatGptSessionPayload(session.session || session)) {
              throw new Error('未读取到 ChatGPT session');
            }

            if (session.accessToken) {
              await updateRedeemStage('subscription-check', '正在查询会员资格');
              const currentSubscription = await checkCredentialPaidSubscription({
                state: currentResults,
                credential,
                accessToken: session.accessToken,
                throwIfStopRequested,
              });
              throwIfStopRequested();
              if (currentSubscription.status === 'paid') {
                await updateRedeemStage('confirm-plus', '正在确认 Plus/Pro/Team 会员');
                redeemCompleted += 1;
                items = upsertResultItem(items, {
                  ...baseItem,
                  status: 'paid',
                  planType: currentSubscription.planType,
                  reason: currentSubscription.reason || `已开通 ${currentSubscription.planType}`,
                  accessTokenMasked: maskAccessToken(session.accessToken),
                  redeemStatus: 'skipped',
                  redeemReason: '重新核验已是会员，未消耗卡密',
                  redeemFailureCount: 0,
                  redeemLastFailedAt: '',
                  upiRedeemCdkey: '',
                  upiRedeemSubscriptionCheckedAt: new Date().toISOString(),
                });
                currentResults = await saveResults({
                  ...currentResults,
                  items,
                  redeeming: true,
                  redeemUpdatedAt: new Date().toISOString(),
                  redeemTotal: credentials.length,
                  redeemCompleted,
                  source,
                });
                await addLog(`UPI 无会员补兑：${credential.email} 重新核验已是会员，跳过卡密兑换。`, 'ok');
                continue;
              }
            } else {
              await addLog(`UPI 无会员补兑：${credential.email} 已读取完整 ChatGPT session，但没有 token 摘要，跳过本地会员预核验，直接提交远端兑换。`, 'warn');
            }

            await updateRedeemStage('upi-redeem-plus', '正在使用 UPI 卡密兑换 Plus');
            throwIfStopRequested();
            const redeemResult = await redeemUpiCredentialWithAccessToken({
              state: {
                ...currentResults,
                visibleStep: 7,
              },
              credential,
              session: session.session || session,
              accessToken: session.accessToken,
              skipEligibilityCheck: true,
              deferSubscriptionConfirmation: true,
            });
            attemptedUpiRedeemCdkey = normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey);
            throwIfStopRequested();
            await updateRedeemStage('confirm-plus', '正在确认 Plus/Pro/Team 会员');
            const redeemedSubscription = classifyRedeemResult(redeemResult);
            if (redeemResult.pendingRemoteConfirmation === true) {
              redeemCompleted += 1;
              const pendingReason = redeemResult.reason || '卡密已提交，等待远端系统返回最终结果';
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: pendingReason,
                accessTokenMasked: maskAccessToken(session.accessToken),
                redeemStatus: 'submitted',
                redeemReason: pendingReason,
                redeemFailureCount: normalizeRetryCount(baseItem.redeemFailureCount),
                redeemLastFailedAt: baseItem.redeemLastFailedAt,
                upiRedeemCdkey: normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey),
                upiRedeemSubscriptionCheckedAt: '',
              });
              currentResults = await saveResults({
                ...currentResults,
                items,
                redeeming: true,
                redeemUpdatedAt: new Date().toISOString(),
                redeemTotal: credentials.length,
                redeemCompleted,
                source,
              });
              await addLog(`UPI 无会员补兑：${credential.email} 已提交卡密，等待远端系统返回最终结果，不计入账号失败次数。`, 'info');
              continue;
            }
            if (!redeemedSubscription.active || !isPaidPlanType(redeemedSubscription.planType)) {
              throw new Error(redeemedSubscription.reason || 'UPI 卡密已提交，但未确认 Plus/Pro/Team 会员。');
            }
            redeemCompleted += 1;
            items = upsertResultItem(items, {
              ...baseItem,
              status: 'paid',
              planType: redeemedSubscription.planType,
              reason: redeemedSubscription.reason || `已开通 ${redeemedSubscription.planType}`,
              accessTokenMasked: maskAccessToken(session.accessToken),
              redeemStatus: 'success',
              redeemReason: 'UPI 卡密兑换成功并已确认会员',
              redeemFailureCount: 0,
              redeemLastFailedAt: '',
              upiRedeemCdkey: normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey),
              upiRedeemSubscriptionCheckedAt: getRedeemResultSubscriptionCheckedAt(redeemResult) || new Date().toISOString(),
            });
            currentResults = await saveResults({
              ...currentResults,
              items,
              redeeming: true,
              redeemUpdatedAt: new Date().toISOString(),
              redeemTotal: credentials.length,
              redeemCompleted,
              source,
            });
            await addLog(`UPI 无会员补兑：${credential.email} 已兑换并确认 ${redeemedSubscription.planType}。`, 'ok');
          } catch (error) {
            if (isMembershipStopError(error)) {
              redeemStopRequested = true;
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: '已停止，未消耗卡密',
                redeemStatus: 'stopped',
                redeemReason: '已停止，未消耗卡密',
              });
              currentResults = await saveResults({
                ...currentResults,
                items,
                redeeming: false,
                redeemUpdatedAt: new Date().toISOString(),
                redeemTotal: credentials.length,
                redeemCompleted,
                source,
                flowStage: currentResults.flowStage,
                flowStageEmail: currentResults.flowStageEmail || credential.email,
              });
              await addLog(`UPI 无会员补兑：已停止，${credential.email} 未继续兑换。`, 'warn');
              break;
            }
            if (isSessionAccountMismatchError(error)) {
              redeemStopRequested = true;
              const reason = getErrorMessage(error) || '账号登录态不一致，补兑已停止';
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: '账号登录态不一致，补兑已停止',
                redeemStatus: 'stopped',
                redeemReason: `${reason}，未消耗卡密，后续账号不会继续处理。`,
              });
              currentResults = await saveResults({
                ...currentResults,
                items,
                redeeming: false,
                redeemUpdatedAt: new Date().toISOString(),
                redeemTotal: credentials.length,
                redeemCompleted,
                source,
                flowStage: currentResults.flowStage || 'token',
                flowStageEmail: credential.email,
              });
              await addLog(`UPI 无会员补兑：账号登录态不一致，已停止在 ${credential.email}，后续账号不会继续处理：${reason}`, 'warn');
              break;
            }
            if (isUpiRedeemApiAuthError(error)) {
              redeemStopRequested = true;
              const reason = getErrorMessage(error) || 'UPI 远端接口认证失败，请检查 UPI 外部 API Key。';
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: 'UPI 远端接口拒绝请求，补兑已停止',
                redeemStatus: 'stopped',
                redeemReason: `${reason}；未判定账号失败，未释放或消耗卡密。`,
                upiRedeemCdkey: attemptedUpiRedeemCdkey,
              });
              currentResults = await saveResults({
                ...currentResults,
                items,
                redeeming: false,
                redeemUpdatedAt: new Date().toISOString(),
                redeemTotal: credentials.length,
                redeemCompleted,
                source,
                flowStage: currentResults.flowStage || 'upi-redeem-plus',
                flowStageEmail: credential.email,
              });
              await addLog(`UPI 无会员补兑：远端接口拒绝请求，已停止在 ${credential.email}，请根据后端返回原因检查 API Key、卡密或 ChatGPT session：${reason}`, 'error');
              break;
            }
            if (isApproveBlockedError(error)) {
              redeemCompleted += 1;
              const reason = getErrorMessage(error) || 'approve-blocked';
              const normalizedEmail = normalizeEmail(credential.email);
              if (normalizedEmail && !redeemAutoDeletedEmails.includes(normalizedEmail)) {
                redeemAutoDeletedEmails.push(normalizedEmail);
              }
              items = items.filter((item) => normalizeEmail(item?.email) !== normalizedEmail);
              if (deleteBackups && normalizedEmail) {
                try {
                  const stored = await chromeApi.storage.local.get([BACKUP_STORAGE_KEY]).catch(() => ({}));
                  const backups = normalizeCredentialBackupMap(stored?.[BACKUP_STORAGE_KEY] || {});
                  if (Object.prototype.hasOwnProperty.call(backups, normalizedEmail)) {
                    delete backups[normalizedEmail];
                    await chromeApi.storage.local.set({ [BACKUP_STORAGE_KEY]: backups });
                  }
                } catch (backupError) {
                  await addLog(
                    `UPI 无会员补兑：${credential.email} -> approve-blocked，删除本地备份失败：${getErrorMessage(backupError)}`,
                    'warn'
                  );
                }
              }
              currentResults = await saveResults({
                ...currentResults,
                items,
                redeeming: true,
                redeemUpdatedAt: new Date().toISOString(),
                redeemTotal: credentials.length,
                redeemCompleted,
                source,
                flowStage: currentResults.flowStage,
                flowStageEmail: credential.email,
                redeemAutoDeletedEmails,
                redeemAutoDeletedCount: redeemAutoDeletedEmails.length,
              });
              await addLog(
                attemptedUpiRedeemCdkey
                  ? `UPI 无会员补兑：${credential.email} -> 后端返回 approve-blocked，邮箱不可用，已释放卡密 ${attemptedUpiRedeemCdkey} 并删除账号：${reason}`
                  : `UPI 无会员补兑：${credential.email} -> 后端返回 approve-blocked，邮箱不可用，已释放对应卡密并删除账号：${reason}`,
                'warn'
              );
              continue;
            }
            const shortage = isCdkeyExhaustedError(error);
            const reason = shortage ? 'UPI 卡密不足' : getErrorMessage(error);
            if (shortage) {
              redeemStopRequested = true;
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: 'UPI 卡密不足，补兑已停止',
                redeemStatus: 'stopped',
                redeemReason: 'UPI 卡密不足，补兑已停止，未消耗卡密',
              });
              currentResults = await saveResults({
                ...currentResults,
                items,
                redeeming: false,
                redeemUpdatedAt: new Date().toISOString(),
                redeemTotal: credentials.length,
                redeemCompleted,
                source,
                flowStage: currentResults.flowStage || 'upi-redeem-plus',
                flowStageEmail: credential.email,
              });
              await addLog(`UPI 无会员补兑：卡密不足，已停止在 ${credential.email}，后续账号不会继续处理。`, 'warn');
              break;
            }
            if (!attemptedUpiRedeemCdkey) {
              redeemCompleted += 1;
              const blockedReason = reason || '登录或读取 ChatGPT session 未完成';
              const previousRedeemFailureCount = isPreSubmitUpiRedeemBlockedResultItem(baseItem)
                ? 0
                : normalizeRetryCount(baseItem.redeemFailureCount);
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: `${blockedReason}；未提交卡密，不计入兑换失败次数。`,
                redeemStatus: 'blocked',
                redeemReason: `${blockedReason}；未提交卡密，不计入兑换失败次数。`,
                redeemFailureCount: previousRedeemFailureCount,
                redeemLastFailedAt: baseItem.redeemLastFailedAt,
                upiRedeemCdkey: '',
              });
              currentResults = await saveResults({
                ...currentResults,
                items,
                redeeming: true,
                redeemUpdatedAt: new Date().toISOString(),
                redeemTotal: credentials.length,
                redeemCompleted,
                source,
                flowStage: currentResults.flowStage,
                flowStageEmail: credential.email,
                redeemAutoDeletedEmails,
                redeemAutoDeletedCount: redeemAutoDeletedEmails.length,
              });
              await addLog(
                `UPI 无会员补兑：${credential.email} -> 登录/AT 阻塞，尚未提交卡密，不计入兑换失败次数：${blockedReason}`,
                'warn'
              );
              continue;
            }
            redeemCompleted += 1;
            const redeemFailedAt = new Date().toISOString();
            const existingRedeemFailureCount = normalizeRetryCount(baseItem.redeemFailureCount)
              || (normalizeString(baseItem.redeemStatus).toLowerCase() === 'failed' ? 1 : 0);
            const redeemFailureCount = existingRedeemFailureCount + 1;
            const shouldAutoDelete = redeemFailureCount >= UPI_CREDENTIAL_MEMBERSHIP_REDEEM_FAILURE_LIMIT;
            if (shouldAutoDelete) {
              redeemAutoDeletedEmails.push(normalizeEmail(credential.email));
              items = items.filter((item) => normalizeEmail(item?.email) !== normalizeEmail(credential.email));
            } else {
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: `${reason || '补兑失败'}（兑换失败 ${redeemFailureCount}/${UPI_CREDENTIAL_MEMBERSHIP_REDEEM_FAILURE_LIMIT}）`,
                redeemStatus: 'failed',
                redeemReason: reason || '补兑失败',
                redeemFailureCount,
                redeemLastFailedAt: redeemFailedAt,
                upiRedeemCdkey: attemptedUpiRedeemCdkey,
              });
            }
            currentResults = await saveResults({
              ...currentResults,
              items,
              redeeming: true,
              redeemUpdatedAt: new Date().toISOString(),
              redeemTotal: credentials.length,
              redeemCompleted,
              source,
              flowStage: currentResults.flowStage,
              flowStageEmail: credential.email,
              redeemAutoDeletedEmails,
              redeemAutoDeletedCount: redeemAutoDeletedEmails.length,
            });
            await addLog(
              shouldAutoDelete
                ? `UPI 无会员补兑：${credential.email} -> 失败 ${redeemFailureCount}/${UPI_CREDENTIAL_MEMBERSHIP_REDEEM_FAILURE_LIMIT}，已自动删除账号：${reason}`
                : `UPI 无会员补兑：${credential.email} -> 失败 ${redeemFailureCount}/${UPI_CREDENTIAL_MEMBERSHIP_REDEEM_FAILURE_LIMIT}，保留账号可重试：${reason}`,
              'warn'
            );
          }
        }

        const finishedAt = new Date().toISOString();
        if (deleteBackups && redeemAutoDeletedEmails.length) {
          const stored = await chromeApi.storage.local.get([BACKUP_STORAGE_KEY]).catch(() => ({}));
          const backups = normalizeCredentialBackupMap(stored?.[BACKUP_STORAGE_KEY] || {});
          redeemAutoDeletedEmails.forEach((email) => {
            delete backups[email];
          });
          await chromeApi.storage.local.set({ [BACKUP_STORAGE_KEY]: backups });
        }
        const finalResults = await saveResults({
          ...currentResults,
          items,
          redeeming: false,
          redeemUpdatedAt: finishedAt,
          redeemFinishedAt: redeemStopRequested ? '' : finishedAt,
          redeemStoppedAt: redeemStopRequested ? finishedAt : '',
          redeemTotal: credentials.length,
          redeemCompleted,
          flowStage: redeemStopRequested ? currentResults.flowStage : '',
          flowStageEmail: redeemStopRequested ? currentResults.flowStageEmail : '',
          source,
          redeemAutoDeletedEmails,
          redeemAutoDeletedCount: redeemAutoDeletedEmails.length,
        });
        if (redeemStopRequested) {
          await addLog(`UPI 无会员补兑：已停止，已处理 ${finalResults.redeemCompleted}/${finalResults.redeemTotal}。`, 'warn');
        } else {
          await addLog(`UPI 无会员补兑：完成 ${finalResults.redeemCompleted}/${finalResults.redeemTotal}，有会员 ${finalResults.paidCount}，无会员 ${finalResults.freeCount}，失败 ${finalResults.failedCount}。`, 'ok');
        }
        return finalResults;
      } finally {
        redeemRunning = false;
      }
    }

    async function retryFailedUpiRedeemCdkey(input = {}) {
      const cdkey = normalizeString(input.cdkey || input.forceCdkey);
      const inputCredential = input.credential && typeof input.credential === 'object' && !Array.isArray(input.credential)
        ? input.credential
        : {};
      const targetEmail = normalizeEmail(input.email || input.accountEmail || inputCredential.email);
      return {
        ok: false,
        skipped: true,
        cdkey,
        email: targetEmail,
        reason: '卡密不做自动重试；失败次数只按账号统计。',
        updates: {},
      };
      if (!cdkey) {
        return { ok: false, skipped: true, reason: '缺少要重试的 UPI 卡密。', updates: {} };
      }
      if (!targetEmail) {
        const reason = '卡密缺少对应邮箱，无法自动重新登录重试。';
        const usageUpdate = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
          ...entry,
          retrying: false,
          retryError: reason,
          retryCount: Math.max(normalizeRetryCount(entry.retryCount), UPI_REDEEM_AUTO_RETRY_LIMIT),
        }));
        await addLog(`UPI 卡密自动重试：${cdkey} -> 跳过：${reason}`, 'warn');
        return {
          ok: false,
          skipped: true,
          cdkey,
          email: '',
          reason,
          updates: buildRetryUpdatesPayload(null, usageUpdate.usage),
        };
      }
      if (batchRunning || redeemRunning || cdkeyRetryRunning) {
        const reason = 'UPI 备份账号核验/补兑正在运行，暂不自动重试。';
        await addLog(`UPI 卡密自动重试：${targetEmail} -> ${cdkey} -> 跳过：${reason}`, 'warn');
        return {
          ok: false,
          skipped: true,
          cdkey,
          email: targetEmail,
          reason,
          updates: {},
        };
      }
      if (typeof redeemUpiCredentialWithAccessToken !== 'function') {
        throw new Error('UPI 卡密自动重试能力尚未接入。');
      }

      redeemRunning = true;
      redeemStopRequested = false;
      cdkeyRetryRunning = true;

      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      let latestUsage = null;
      let currentResults = await getStoredResults();
      let items = Array.isArray(currentResults.items) ? [...currentResults.items] : [];
      let activeCredential = normalizeResultItem({
        ...inputCredential,
        email: targetEmail,
        status: 'free',
        planType: 'free',
        checkedAt: startedAt,
      });
      let outcome = {
        ok: false,
        retried: false,
        cdkey,
        email: targetEmail,
        reason: '',
      };

      const upsertRetryResult = async (patch = {}) => {
        items = upsertResultItem(items, {
          ...activeCredential,
          status: 'free',
          planType: 'free',
          checkedAt: startedAt,
          upiRedeemCdkey: cdkey,
          ...patch,
        });
        currentResults = await saveResults({
          ...currentResults,
          items,
          redeeming: true,
          redeemUpdatedAt: new Date().toISOString(),
          redeemTotal: Math.max(1, Math.floor(Number(currentResults.redeemTotal) || 0)),
          redeemCompleted: Math.max(0, Math.floor(Number(currentResults.redeemCompleted) || 0)),
          flowStage: patch.flowStage || currentResults.flowStage,
          flowStageEmail: targetEmail,
          source: normalizeString(input.source || currentResults.source || 'upi-cdkey-auto-retry'),
        });
      };

      const updateRetryStage = async (stage, reason = '') => {
        throwIfMembershipStopRequested('redeem');
        await upsertRetryResult({
          redeemStatus: 'running',
          redeemReason: reason || getUpiCredentialMembershipFlowStageReason(stage),
          flowStage: stage,
        });
        throwIfMembershipStopRequested('redeem');
      };

      try {
        const runtimeState = {
          ...(typeof getState === 'function' ? await getState().catch(() => ({})) : {}),
          ...(input.settings || {}),
        };
        const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(runtimeState, 'upiRedeemCdkeyUsage') || {});
        const currentEntry = usage?.[cdkey] && typeof usage[cdkey] === 'object' && !Array.isArray(usage[cdkey])
          ? usage[cdkey]
          : {};
        const currentRetryCount = normalizeRetryCount(currentEntry.retryCount);
        const remoteStatus = normalizeUpiRedeemRemoteStatus(currentEntry.remoteStatus);

        if (currentEntry.subscriptionActive === true || isSuccessfulUpiRedeemRemoteStatus(remoteStatus)) {
          const reason = '卡密已确认兑换成功，不再自动重试。';
          const usageUpdate = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
            ...entry,
            email: targetEmail,
            retrying: false,
            retryError: '',
          }));
          latestUsage = usageUpdate.usage;
          outcome = { ok: true, skipped: true, cdkey, email: targetEmail, reason };
        } else if (isActiveUpiRedeemRemoteStatus(remoteStatus)) {
          const reason = `卡密后端状态仍在处理中：${remoteStatus || 'active'}，等待下次刷新。`;
          const usageUpdate = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
            ...entry,
            email: targetEmail,
            retrying: false,
            retryError: '',
          }));
          latestUsage = usageUpdate.usage;
          outcome = { ok: false, skipped: true, cdkey, email: targetEmail, reason };
        } else if (currentRetryCount >= UPI_REDEEM_AUTO_RETRY_LIMIT) {
          const reason = `已达到自动重试上限 ${UPI_REDEEM_AUTO_RETRY_LIMIT} 次。`;
          const usageUpdate = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
            ...entry,
            email: targetEmail,
            retrying: false,
            retryError: entry.retryError || reason,
          }));
          latestUsage = usageUpdate.usage;
          outcome = { ok: false, skipped: true, cdkey, email: targetEmail, reason };
        } else {
          const pool = await getUpiCredentialMembershipCredentialPool();
          const backupCredential = (pool.items || []).find((item) => normalizeEmail(item?.email) === targetEmail) || {};
          const existingItem = items.find((item) => normalizeEmail(item?.email) === targetEmail) || {};
          activeCredential = normalizeResultItem({
            ...existingItem,
            ...backupCredential,
            ...inputCredential,
            email: targetEmail,
            status: 'free',
            planType: 'free',
            checkedAt: startedAt,
          });

          const missingCredentialReason = !backupCredential.email
            ? '备份账号列表中未找到该邮箱，无法自动重试'
            : !activeCredential.password
              ? '缺少 GPT 密码，无法自动重试'
              : !activeCredential.totpMfaSecret
                ? '缺少 2FA 密钥，无法自动重试'
                : '';
          if (missingCredentialReason) {
            const usageUpdate = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
              ...entry,
              email: targetEmail,
              retrying: false,
              retryError: missingCredentialReason,
              retryCount: Math.max(normalizeRetryCount(entry.retryCount), UPI_REDEEM_AUTO_RETRY_LIMIT),
            }));
            latestUsage = usageUpdate.usage;
            await upsertRetryResult({
              status: 'free',
              planType: 'free',
              reason: missingCredentialReason,
              redeemStatus: 'failed',
              redeemReason: missingCredentialReason,
              upiRedeemCdkey: cdkey,
            });
            await addLog(`UPI 卡密自动重试：${targetEmail} -> ${cdkey} -> 跳过：${missingCredentialReason}`, 'warn');
            outcome = { ok: false, skipped: true, cdkey, email: targetEmail, reason: missingCredentialReason };
          } else {
            const nextRetryCount = currentRetryCount + 1;
            const usageUpdate = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
              ...entry,
              email: targetEmail,
              retryCount: nextRetryCount,
              lastRetryAt: startedAtMs,
              retrying: true,
              retryError: '',
            }));
            latestUsage = usageUpdate.usage;
            await addLog(
              `UPI 卡密自动重试：${targetEmail} -> ${cdkey}，第 ${nextRetryCount}/${UPI_REDEEM_AUTO_RETRY_LIMIT} 次，正在重新登录读取 ChatGPT session。`,
              'info'
            );
            await updateRetryStage('open-chatgpt', `卡密失败自动重试 ${nextRetryCount}/${UPI_REDEEM_AUTO_RETRY_LIMIT}：正在打开 ChatGPT`);
            const session = await loginAndReadAccessToken(activeCredential, {
              ...runtimeState,
              ...currentResults,
            }, {
              onStage: async (stage) => updateRetryStage(stage, {
                'open-chatgpt': `卡密失败自动重试 ${nextRetryCount}/${UPI_REDEEM_AUTO_RETRY_LIMIT}：正在打开 ChatGPT`,
                login: `卡密失败自动重试 ${nextRetryCount}/${UPI_REDEEM_AUTO_RETRY_LIMIT}：正在登录当前邮箱`,
                totp: `卡密失败自动重试 ${nextRetryCount}/${UPI_REDEEM_AUTO_RETRY_LIMIT}：正在提交 2FA`,
                token: `卡密失败自动重试 ${nextRetryCount}/${UPI_REDEEM_AUTO_RETRY_LIMIT}：正在读取 ChatGPT session`,
              }[stage] || '卡密失败自动重试：正在重新登录'),
              throwIfStopRequested: () => throwIfMembershipStopRequested('redeem'),
            });
            throwIfMembershipStopRequested('redeem');
            if (!hasChatGptSessionPayload(session.session || session)) {
              throw new Error('未读取到 ChatGPT session');
            }

            await updateRetryStage('upi-redeem-plus', `卡密失败自动重试 ${nextRetryCount}/${UPI_REDEEM_AUTO_RETRY_LIMIT}：正在提交同一卡密`);
            const redeemResult = await redeemUpiCredentialWithAccessToken({
              state: {
                ...runtimeState,
                ...currentResults,
                visibleStep: 7,
              },
              credential: activeCredential,
              session: session.session || session,
              accessToken: session.accessToken,
              forceCdkey: cdkey,
              skipEligibilityCheck: true,
            });
            throwIfMembershipStopRequested('redeem');
            const redeemedSubscription = classifyRedeemResult(redeemResult);
            if (redeemedSubscription.active && isPaidPlanType(redeemedSubscription.planType)) {
              const usageDone = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
                ...entry,
                email: targetEmail,
                retrying: false,
                retryError: '',
              }));
              latestUsage = usageDone.usage;
              await upsertRetryResult({
                status: 'paid',
                planType: redeemedSubscription.planType,
                reason: redeemedSubscription.reason || `已开通 ${redeemedSubscription.planType}`,
                accessTokenMasked: maskAccessToken(session.accessToken),
                redeemStatus: 'success',
                redeemReason: 'UPI 卡密自动重试成功并已确认会员',
                upiRedeemCdkey: normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey || cdkey),
                upiRedeemSubscriptionCheckedAt: getRedeemResultSubscriptionCheckedAt(redeemResult) || new Date().toISOString(),
                flowStage: 'confirm-plus',
              });
              await addLog(`UPI 卡密自动重试：${targetEmail} -> ${cdkey} 已确认 ${redeemedSubscription.planType}。`, 'ok');
              outcome = {
                ok: true,
                retried: true,
                cdkey,
                email: targetEmail,
                planType: redeemedSubscription.planType,
                result: redeemResult,
              };
            } else {
              const reason = redeemedSubscription.reason || 'UPI 卡密已重新提交，但未确认 Plus/Pro/Team 会员。';
              const usageDone = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
                ...entry,
                email: targetEmail,
                retrying: false,
                retryError: reason,
              }));
              latestUsage = usageDone.usage;
              await upsertRetryResult({
                status: 'free',
                planType: 'free',
                reason,
                accessTokenMasked: maskAccessToken(session.accessToken),
                redeemStatus: 'failed',
                redeemReason: reason,
                upiRedeemCdkey: normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey || cdkey),
                upiRedeemSubscriptionCheckedAt: getRedeemResultSubscriptionCheckedAt(redeemResult) || new Date().toISOString(),
                flowStage: 'confirm-plus',
              });
              await addLog(`UPI 卡密自动重试：${targetEmail} -> ${cdkey} 未确认会员：${reason}`, 'warn');
              outcome = {
                ok: false,
                retried: true,
                cdkey,
                email: targetEmail,
                reason,
                result: redeemResult,
              };
            }
          }
        }
      } catch (error) {
        const reason = getErrorMessage(error) || 'UPI 卡密自动重试失败。';
        const nonRetryable = isMembershipStopError(error)
          || isSessionAccountMismatchError(error)
          || isNonRetryableUpiRedeemRetryError(reason);
        const usageDone = await updateUpiRedeemCdkeyRetryUsage(cdkey, (entry) => ({
          ...entry,
          email: targetEmail,
          retrying: false,
          retryError: reason,
          retryCount: nonRetryable
            ? Math.max(normalizeRetryCount(entry.retryCount), UPI_REDEEM_AUTO_RETRY_LIMIT)
            : normalizeRetryCount(entry.retryCount),
        }));
        latestUsage = usageDone.usage;
        await upsertRetryResult({
          status: 'free',
          planType: 'free',
          reason: nonRetryable ? reason : (reason || '自动重试失败'),
          redeemStatus: isMembershipStopError(error) ? 'stopped' : 'failed',
          redeemReason: isMembershipStopError(error) ? `${reason}，未继续自动重试` : reason,
          upiRedeemCdkey: cdkey,
        });
        await addLog(
          `UPI 卡密自动重试：${targetEmail} -> ${cdkey} -> 失败：${reason}`,
          nonRetryable ? 'warn' : 'error'
        );
        outcome = {
          ok: false,
          retried: true,
          stopped: isMembershipStopError(error),
          retryable: !nonRetryable,
          cdkey,
          email: targetEmail,
          reason,
        };
      } finally {
        const finishedAt = new Date().toISOString();
        currentResults = await saveResults({
          ...currentResults,
          items,
          redeeming: false,
          redeemUpdatedAt: finishedAt,
          redeemFinishedAt: outcome.stopped ? '' : finishedAt,
          redeemStoppedAt: outcome.stopped ? finishedAt : currentResults.redeemStoppedAt,
          flowStage: outcome.stopped ? currentResults.flowStage : '',
          flowStageEmail: outcome.stopped ? targetEmail : '',
        });
        redeemRunning = false;
        cdkeyRetryRunning = false;
      }

      return {
        ...outcome,
        results: currentResults,
        updates: buildRetryUpdatesPayload(currentResults, latestUsage),
      };
    }

    async function pruneIneligibleFreeUpiCredentialMembership(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning || cdkeyRetryRunning) {
        throw new Error('UPI 无会员账号补兑/卡密重试正在运行，请等待完成或先停止。');
      }
      if (typeof checkUpiRedeemAccessTokenEligibility !== 'function') {
        throw new Error('UPI 试用资格检查能力尚未接入。');
      }

      const requestedCredentials = resolveInputCredentials(input)
        .filter((credential) => credential.email);
      const source = normalizeString(input.source || 'free-trial-eligibility');
      const deleteBackups = input.deleteBackups !== false;
      batchRunning = true;
      batchStopRequested = false;
      const startedAt = new Date().toISOString();
      let currentResults = await getStoredResults();
      let items = mergeCredentialsIntoResultItems(currentResults.items, requestedCredentials);
      const deletedEmails = [];
      const kept = [];
      const skipped = [];
      const failed = [];

      const saveProgress = async (stage = 'token', email = '') => {
        currentResults = await saveResults({
          ...currentResults,
          items,
          running: true,
          updatedAt: new Date().toISOString(),
          flowStage: stage,
          flowStageEmail: normalizeEmail(email),
          source: source || currentResults.source,
          total: requestedCredentials.length,
          completed: kept.length + skipped.length + failed.length + deletedEmails.length,
        });
      };

      try {
        if (!requestedCredentials.length) {
          return await saveResults({
            ...currentResults,
            items,
            running: false,
            updatedAt: startedAt,
            finishedAt: startedAt,
            flowStage: '',
            flowStageEmail: '',
          });
        }

        await addLog(`UPI Free 分组试用资格检测：开始检测 ${requestedCredentials.length} 个账号，无资格会自动删除。`, 'info');
        const runtimeState = {
          ...(await getState()),
          ...(input.settings || {}),
        };

        for (const credential of requestedCredentials) {
          throwIfMembershipStopRequested('check');
          const email = normalizeEmail(credential.email);
          const checkedAt = new Date().toISOString();
          if (!email) {
            continue;
          }
          const existingItem = items.find((item) => normalizeEmail(item?.email) === email) || {};
          const activeCredential = normalizeResultItem({
            ...existingItem,
            ...credential,
            email,
            status: 'free',
            planType: 'free',
            checkedAt,
          });

          if (!activeCredential.password || !activeCredential.totpMfaSecret) {
            const reason = !activeCredential.password ? '缺少 GPT 密码，无法检测试用资格' : '缺少 2FA 密钥，无法检测试用资格';
            skipped.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'free',
              planType: 'free',
              reason,
              trialEligibilityStatus: 'skipped',
              trialEligibilityReason: reason,
              trialEligibilityCheckedAt: checkedAt,
            });
            await saveProgress('token', email);
            await addLog(`UPI Free 分组试用资格检测：${email} -> 跳过：${reason}`, 'warn');
            continue;
          }

          try {
            await saveProgress('login', email);
            const session = await loginAndReadAccessToken(activeCredential, {
              ...runtimeState,
              ...currentResults,
            }, {
              onStage: async (stage) => saveProgress(stage, email),
              throwIfStopRequested: () => throwIfMembershipStopRequested('check'),
            });
            throwIfMembershipStopRequested('check');
            if (!hasChatGptSessionPayload(session.session || session)) {
              throw new Error('未读取到 ChatGPT session');
            }
            await saveProgress('subscription-check', email);
            const eligibility = await checkUpiRedeemAccessTokenEligibility({
              state: {
                ...runtimeState,
                ...currentResults,
              },
              credential: activeCredential,
              session: session.session || session,
              accessToken: session.accessToken,
              cdkey: input.cdkey,
            });
            const reason = eligibility?.item?.message || eligibility?.item?.reason || '账号有试用资格';
            kept.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'free',
              planType: 'free',
              reason,
              accessTokenMasked: maskAccessToken(session.accessToken),
              trialEligibilityStatus: 'eligible',
              trialEligibilityReason: reason,
              trialEligibilityCheckedAt: checkedAt,
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Free 分组试用资格检测：${email} -> 有试用资格。`, 'ok');
          } catch (error) {
            const reason = getErrorMessage(error) || '试用资格检测失败';
            if (isUpiTrialIneligibleError(error)) {
              deletedEmails.push(email);
              items = items.filter((item) => normalizeEmail(item?.email) !== email);
              await saveProgress('subscription-check', email);
              await addLog(`UPI Free 分组试用资格检测：${email} -> 无试用资格，已自动删除。原因：${reason}`, 'warn');
              continue;
            }
            failed.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'free',
              planType: 'free',
              reason,
              trialEligibilityStatus: 'failed',
              trialEligibilityReason: reason,
              trialEligibilityCheckedAt: checkedAt,
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Free 分组试用资格检测：${email} -> 检测失败，保留账号：${reason}`, 'warn');
          }
        }

        if (deleteBackups && deletedEmails.length) {
          const stored = await chromeApi.storage.local.get([BACKUP_STORAGE_KEY]).catch(() => ({}));
          const backups = normalizeCredentialBackupMap(stored?.[BACKUP_STORAGE_KEY] || {});
          deletedEmails.forEach((email) => {
            delete backups[email];
          });
          await chromeApi.storage.local.set({ [BACKUP_STORAGE_KEY]: backups });
        }

        const finishedAt = new Date().toISOString();
        const finalResults = await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: finishedAt,
          finishedAt,
          flowStage: '',
          flowStageEmail: '',
          source: source || currentResults.source,
          total: items.length,
          completed: items.length,
          trialEligibilitySummary: {
            checkedAt: finishedAt,
            kept,
            skipped,
            failed,
            deletedEmails,
            eligibleCount: kept.length,
            skippedCount: skipped.length,
            failedCount: failed.length,
            deletedCount: deletedEmails.length,
          },
        });
        await addLog(
          `UPI Free 分组试用资格检测：完成，有资格 ${kept.length}，自动删除无资格 ${deletedEmails.length}，跳过 ${skipped.length}，失败 ${failed.length}。`,
          'ok'
        );
        return {
          results: finalResults,
          deletedEmails,
          kept,
          skipped,
          failed,
          deleteBackups,
        };
      } catch (error) {
        const stoppedAt = new Date().toISOString();
        await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: stoppedAt,
          stoppedAt,
          flowStage: currentResults.flowStage,
          flowStageEmail: currentResults.flowStageEmail,
          source: source || currentResults.source,
        }).catch(() => null);
        throw error;
      } finally {
        batchRunning = false;
      }
    }

    async function importUpiCredentialMembershipFreeResults(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning) {
        throw new Error('UPI 无会员账号补兑正在运行，请等待完成或先停止。');
      }
      const credentials = resolveInputCredentials(input).filter((credential) => credential.email);
      const now = new Date().toISOString();
      const currentResults = await getStoredResults();
      const importedEmails = new Set(credentials.map((credential) => normalizeEmail(credential.email)).filter(Boolean));
      const existingItems = (Array.isArray(currentResults.items) ? currentResults.items : [])
        .filter((item) => {
          const email = normalizeEmail(item?.email);
          return email && !importedEmails.has(email);
        });
      const importedItems = credentials.map((credential) => normalizeResultItem({
        ...credential,
        status: 'free',
        planType: 'free',
        checkedAt: now,
        reason: '待补兑',
        redeemStatus: '',
        redeemReason: '',
        redeemFailureCount: 0,
        redeemLastFailedAt: '',
        membershipOverrideStatus: 'free',
        membershipOverrideCheckedAt: now,
      }));
      const items = [...existingItems, ...importedItems];
      return saveResults({
        ...currentResults,
        items,
        running: false,
        redeeming: false,
        startedAt: '',
        updatedAt: now,
        finishedAt: now,
        stoppedAt: '',
        redeemStartedAt: '',
        redeemUpdatedAt: '',
        redeemFinishedAt: '',
        redeemStoppedAt: '',
        flowStage: '',
        flowStageEmail: '',
        source: normalizeString(input.source || currentResults.source || 'txt-free'),
        total: items.length,
        completed: items.length,
        redeemTotal: 0,
        redeemCompleted: 0,
      });
    }

    async function stopUpiCredentialMembershipRedeem() {
      redeemStopRequested = true;
      const current = await getStoredResults();
      return saveResults({
        ...current,
        redeeming: false,
        redeemStoppedAt: new Date().toISOString(),
        flowStage: current.flowStage,
        flowStageEmail: current.flowStageEmail,
      });
    }

    async function stopUpiCredentialMembershipCheck() {
      batchStopRequested = true;
      const current = await getStoredResults();
      const next = await saveResults({
        ...current,
        running: false,
        stoppedAt: new Date().toISOString(),
        flowStage: current.flowStage,
        flowStageEmail: current.flowStageEmail,
      });
      return next;
    }

    async function exportUpiCredentialMembershipCheckResults(input = {}) {
      const status = normalizeString(input.status || 'paid');
      const results = await getStoredResults();
      const removeAfterExport = input.removeAfterExport === true || input.clearAfterExport === true;
      if (removeAfterExport && (results.running || results.redeeming)) {
        throw new Error('UPI 备份账号核验/补兑正在运行，请先停止后再导出并清空当前批次。');
      }
      const rows = buildResultExportRows(results, status);
      const exportedEmails = normalizeResultsPayload(results).items
        .filter((item) => {
          if (item.status !== status) return false;
          if (status === 'failed') return Boolean(item.email);
          return Boolean(item.email && item.password && item.totpMfaSecret);
        })
        .map((item) => item.email);
      const nameMap = {
        paid: 'upi-membership-paid-password-2fa',
        free: 'upi-membership-free-password-2fa',
        failed: 'upi-membership-check-failed',
      };
      const deleteResult = rows.length && removeAfterExport
        ? await deleteUpiCredentialMembershipCheckResults({ status, emails: exportedEmails })
        : null;
      return {
        status,
        count: rows.length,
        fileName: rows.length ? buildTimestampedFileName(nameMap[status] || 'upi-membership-check') : '',
        fileContent: rows.length ? `${rows.join('\n')}\n` : '',
        removedCount: Math.max(0, Number(deleteResult?.deletedCount) || 0),
        results: deleteResult?.results,
      };
    }

    return {
      checkUpiCredentialMembershipBatch,
      checkUpiCredentialMembershipOne,
      deleteUpiCredentialMembershipCredentials,
      deleteUpiCredentialMembershipCheckResults,
      exportUpiCredentialMembershipCheckResults,
      getUpiCredentialMembershipCredentialPool,
      getUpiCredentialMembershipCheckResults: getStoredResults,
      importUpiCredentialMembershipFreeResults,
      pruneIneligibleFreeUpiCredentialMembership,
      redeemUpiCredentialMembershipFree,
      retryFailedUpiRedeemCdkey,
      stopUpiCredentialMembershipCheck,
      stopUpiCredentialMembershipRedeem,
      upsertTrialEligibleFreeCredential,
    };
  }

  return {
    BACKUP_STORAGE_KEY,
    DEFAULT_TOTP_API_BASE_URL,
    RESULTS_STORAGE_KEY,
    buildCredentialRowsFromBackupMap,
    buildResultExportRows,
    classifySubscriptionResult,
    createUpiCredentialMembershipChecker,
    generateTotpCode,
    normalizeResultsPayload,
    normalizeTotpApiBaseUrl,
    parseCredentialBackupText,
  };
});
