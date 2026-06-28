(function attachUpiCredentialMembershipChecker(root, factory) {
  root.MultiPageBackgroundUpiCredentialMembershipChecker = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createUpiCredentialMembershipCheckerModule() {
  const BACKUP_STORAGE_KEY = 'upiAccountCredentialBackups';
  const RESULTS_STORAGE_KEY = 'upiCredentialMembershipCheckResults';
  const DEFAULT_TOTP_API_BASE_URL = 'https://cha.nerver.cc';
  const TOTP_LOOKUP_TIMEOUT_MS = 20000;
  const DEFAULT_UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT = 3;
  const UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT_MAX = 20;
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
    const usage = rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
      ? rawUsage
      : {};
    return Object.fromEntries(Object.entries(usage).map(([rawCdkey, rawEntry]) => {
      const cdkey = normalizeString(rawCdkey);
      const entry = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
        ? rawEntry
        : {};
      return [cdkey, {
        ...entry,
        email: normalizeEmail(entry.email || entry.accountEmail || entry.credentialEmail),
        accessToken: normalizeString(entry.accessToken || entry.access_token || entry.upiRedeemAccessToken),
        accessTokenMasked: normalizeString(entry.accessTokenMasked),
        accessTokenUpdatedAt: Math.max(0, Math.floor(Number(entry.accessTokenUpdatedAt) || Number(entry.tokenUpdatedAt) || 0)),
        lastFailedEmail: normalizeEmail(entry.lastFailedEmail),
        lastFailedAt: Math.max(0, Math.floor(Number(entry.lastFailedAt) || 0)),
        lastFailedReason: normalizeString(entry.lastFailedReason),
      }];
    }).filter(([cdkey]) => Boolean(cdkey)));
  }

  function getUpiRedeemCdkeyUsageEntryEmail(entry = {}) {
    return normalizeEmail(entry.email || entry.accountEmail || entry.credentialEmail || entry.targetEmail);
  }

  function isSuccessfulUpiRedeemCdkeyUsageEntry(entry = {}) {
    return entry?.subscriptionActive === true
      || isSuccessfulUpiRedeemRemoteStatus(entry?.remoteStatus)
      || isSuccessfulUpiRedeemRemoteStatus(entry?.remoteMessage);
  }

  function clearUpiRedeemCdkeyUsageAccountBindings(usage = {}, emailSet = new Set()) {
    const source = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {};
    const targets = emailSet instanceof Set ? emailSet : new Set();
    let changed = false;
    const nextUsage = {};
    Object.entries(source).forEach(([cdkey, rawEntry]) => {
      const entry = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
        ? { ...rawEntry }
        : {};
      const email = getUpiRedeemCdkeyUsageEntryEmail(entry);
      if (email && targets.has(email) && isSuccessfulUpiRedeemCdkeyUsageEntry(entry)) {
        delete entry.email;
        delete entry.accountEmail;
        delete entry.credentialEmail;
        delete entry.targetEmail;
        delete entry.accessToken;
        delete entry.access_token;
        delete entry.upiRedeemAccessToken;
        delete entry.accessTokenMasked;
        delete entry.accessTokenUpdatedAt;
        changed = true;
      }
      nextUsage[cdkey] = entry;
    });
    return { usage: nextUsage, changed };
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
    ].includes(normalizeUpiRedeemRemoteStatus(status));
  }

  function normalizeUpiRedeemRemoteStatus(status = '') {
    const normalized = normalizeString(status).toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'approve_blocked') return 'approve_blocked';
    if (/兑换成功|成功|已兑换|已使用|已用/.test(normalized)) return 'success';
    if (/提交失败|兑换失败|充值失败|失败|超时|拒绝|已拒绝|取消|已取消/.test(normalized)) {
      if (/超时/.test(normalized)) return 'timeout';
      if (/拒绝/.test(normalized)) return 'rejected';
      if (/取消/.test(normalized)) return 'canceled';
      return 'failed';
    }
    if (/未找到|不存在/.test(normalized)) return 'not_found';
    if (/无效|不可用/.test(normalized)) return 'invalid';
    if (/未使用|未兑换|可用/.test(normalized)) return 'unused';
    if (/waiting|queue|br_recharge|进入兑换队列|兑换队列|等待系统处理|等待.*接单|任务.*等待/.test(normalized)) return 'queued';
    if (/等待处理|待处理|待兑换|待派发/.test(normalized)) return 'pending_dispatch';
    if (/派发中|正在派发/.test(normalized)) return 'dispatching';
    if (/已派发/.test(normalized)) return 'dispatched';
    if (/兑换中|处理中|进行中|正在兑换/.test(normalized)) return 'processing';
    if (/已提交|已接收|排队/.test(normalized)) return 'submitted';
    if (normalized === 'succeeded' || normalized === 'redeemed' || normalized === 'used') return 'success';
    if (normalized === 'failure' || normalized === 'error') return 'failed';
    if (normalized === 'cancelled') return 'canceled';
    if (normalized === 'notused' || normalized === 'not_used' || normalized === 'unredeemed') return 'unused';
    return normalized;
  }

  function isSuccessfulUpiRedeemRemoteStatus(status = '') {
    return normalizeUpiRedeemRemoteStatus(status) === 'success';
  }

  function isRetryableUpiRedeemRemoteStatus(status = '') {
    return ['failed', 'timeout', 'rejected', 'approve_blocked'].includes(normalizeUpiRedeemRemoteStatus(status));
  }

  function isSelectableUpiRedeemCdkeyUsageEntry(entry = {}) {
    if (!entry || entry.enabled === false) return false;
    const remoteStatus = normalizeUpiRedeemRemoteStatus(entry.remoteStatus);
    const remoteMessageStatus = normalizeUpiRedeemRemoteStatus(entry.remoteMessage);
    const canceledRemote = remoteStatus === 'canceled' || remoteMessageStatus === 'canceled';
    if (entry.subscriptionActive === true || (entry.subscriptionActive === false && !canceledRemote)) return false;
    if (isSuccessfulUpiRedeemRemoteStatus(entry.remoteStatus)) return false;
    if (
      (
        remoteStatus === 'pending_dispatch'
        || remoteMessageStatus === 'pending_dispatch'
      )
      && (normalizeEmail(entry.email) || normalizeString(entry.accessToken))
    ) return false;
    if (isActiveUpiRedeemRemoteStatus(entry.remoteStatus) || isActiveUpiRedeemRemoteStatus(entry.remoteMessage) || entry.retrying === true) return false;
    return true;
  }

  function isRecoverableUpiRedeemCdkeyUsageEntry(entry = {}) {
    if (!entry || entry.enabled === false) return false;
    const remoteStatus = normalizeUpiRedeemRemoteStatus(entry.remoteStatus);
    const remoteMessageStatus = normalizeUpiRedeemRemoteStatus(entry.remoteMessage);
    if (entry.subscriptionActive === true || isSuccessfulUpiRedeemRemoteStatus(entry.remoteStatus)) return false;
    if (
      (
        remoteStatus === 'pending_dispatch'
        || remoteMessageStatus === 'pending_dispatch'
      )
      && (normalizeEmail(entry.email) || normalizeString(entry.accessToken))
    ) return false;
    if (isActiveUpiRedeemRemoteStatus(entry.remoteStatus) || isActiveUpiRedeemRemoteStatus(entry.remoteMessage) || entry.retrying === true) return false;
    return isRetryableUpiRedeemRemoteStatus(entry.remoteStatus)
      || remoteStatus === 'canceled'
      || remoteMessageStatus === 'canceled'
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

  function normalizeFailedAccountRetryLimit(value, fallback = DEFAULT_UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT) {
    const fallbackNumber = Math.floor(Number(fallback));
    const fallbackValue = Number.isFinite(fallbackNumber)
      ? Math.max(0, Math.min(UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT_MAX, fallbackNumber))
      : DEFAULT_UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT;
    const rawValue = String(value ?? '').trim();
    if (!rawValue) {
      return fallbackValue;
    }
    const numeric = Math.floor(Number(rawValue));
    if (!Number.isFinite(numeric)) {
      return fallbackValue;
    }
    return Math.max(0, Math.min(UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT_MAX, numeric));
  }

  function normalizeRedeemAdditionalRoundCount(value, fallback = DEFAULT_UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT) {
    return normalizeFailedAccountRetryLimit(value, fallback);
  }

  function getRedeemTotalRoundLimit(additionalRoundCount = 0) {
    return 1 + Math.max(0, Math.min(
      UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT_MAX,
      Math.floor(Number(additionalRoundCount) || 0)
    ));
  }

  function getRedeemRoundLabel(roundNumber = 1, totalRoundLimit = 1) {
    return `兑换轮 ${Math.max(1, Math.floor(Number(roundNumber) || 1))}/${Math.max(1, Math.floor(Number(totalRoundLimit) || 1))}`;
  }

  function getAvailableUpiRedeemCdkeys(state = {}) {
    const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(state, 'upiRedeemCdkeyUsage') || {});
    return mergeUpiRedeemCdkeysWithRecoverableUsage(
      parseUpiRedeemCdkeyPoolText(getUpiRedeemStateValue(state, 'upiRedeemCdkeyPoolText')),
      usage
    ).filter((cdkey) => isSelectableUpiRedeemCdkeyUsageEntry(usage?.[cdkey] || {}));
  }

  function pickRandomUpiRedeemCdkey(cdkeys = []) {
    const candidates = (Array.isArray(cdkeys) ? cdkeys : [])
      .map((cdkey) => normalizeString(cdkey))
      .filter(Boolean);
    if (!candidates.length) {
      return '';
    }
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[Math.max(0, Math.min(candidates.length - 1, index))] || '';
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
        const totpMfaSecret = normalizeTotpSecret(parts[2] || '');
        const accessToken = normalizeString(parts[3] || '');
        const accessTokenUpdatedAt = normalizeString(parts[4] || '');
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
          accessToken,
          accessTokenUpdatedAt,
          checkedAt: accessTokenUpdatedAt,
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
          accessToken: normalizeString(record.accessToken || record.token || record.access_token),
          accessTokenUpdatedAt: normalizeString(record.accessTokenUpdatedAt || record.updatedAt),
        };
      })
      .filter(Boolean);
  }

  function normalizeResultItem(item = {}) {
    const email = normalizeEmail(item.email);
    const accessToken = normalizeString(item.accessToken || item.token || item.access_token || item.upiRedeemAccessToken);
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
      accessToken,
      accessTokenMasked: normalizeString(item.accessTokenMasked) || maskAccessToken(accessToken),
      accessTokenUpdatedAt: normalizeString(item.accessTokenUpdatedAt || item.tokenUpdatedAt),
      redeemStatus: normalizeString(item.redeemStatus),
      redeemReason: normalizeString(item.redeemReason),
      redeemFailureCount: Math.max(0, Math.floor(Number(item.redeemFailureCount) || 0)),
      redeemFailureLimit: Math.max(0, Math.floor(Number(item.redeemFailureLimit) || 0)),
      redeemLastFailedAt: normalizeString(item.redeemLastFailedAt),
      redeemAttemptedAt: normalizeString(item.redeemAttemptedAt),
      redeemSuccessAt: normalizeString(item.redeemSuccessAt),
      upiRedeemCdkey: normalizeString(item.upiRedeemCdkey || item.cdkey),
      lastFailedUpiRedeemCdkey: normalizeString(item.lastFailedUpiRedeemCdkey || item.failedUpiRedeemCdkey),
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
      .filter((item) => (
        normalizedStatus === 'free'
          ? item.status === 'free' || item.status === 'failed'
          : item.status === normalizedStatus
      ))
      .map((item) => {
        if (normalizedStatus === 'failed') {
          return `${item.email}---${item.reason || '核验失败'}`;
        }
        if (!item.email || !item.password || !item.totpMfaSecret) return '';
        if (normalizedStatus === 'free') {
          const timestamp = item.trialEligibilityCheckedAt || item.checkedAt || item.accessTokenUpdatedAt || '';
          return `${item.email}---${item.password}---${item.totpMfaSecret}---${item.accessToken || ''}---${timestamp}`;
        }
        const timestamp = item.redeemSuccessAt || item.upiRedeemSubscriptionCheckedAt || item.checkedAt || '';
        return `${item.email}----${item.password}---${item.totpMfaSecret}---${timestamp}`;
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
    const error = new Error(kind === 'redeem' ? 'UPI Free 账号兑换已停止' : 'UPI 备份账号会员核验已停止');
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
          `UPI Free 兑换：第 7 步可用卡密 ${availableCdkeyCount} 个，待兑换账号 ${credentialCount} 个；卡密用完后会自动停止，等待补卡后继续。`,
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

    function sanitizeUpiRedeemRuntimeSettings(settings = {}) {
      const source = settings && typeof settings === 'object' && !Array.isArray(settings)
        ? settings
        : {};
      const sanitized = { ...source };
      delete sanitized.upiRedeemCdkeyUsage;
      delete sanitized.pixRedeemCdkeyUsage;
      return sanitized;
    }

    function hasUpiRedeemCdkeyUsageState(state = {}) {
      return Boolean(state && typeof state === 'object' && !Array.isArray(state) && (
        Object.prototype.hasOwnProperty.call(state, 'upiRedeemCdkeyUsage')
        || Object.prototype.hasOwnProperty.call(state, 'pixRedeemCdkeyUsage')
      ));
    }

    function preferLatestUpiRedeemCdkeyPoolState(state = {}, latestState = {}) {
      ['upiRedeemCdkeyPoolText', 'pixRedeemCdkeyPoolText'].forEach((key) => {
        if (latestState && typeof latestState === 'object' && !Array.isArray(latestState)
          && Object.prototype.hasOwnProperty.call(latestState, key)) {
          state[key] = latestState[key];
        }
      });
      return state;
    }

    async function getFreshUpiRedeemRuntimeState(input = {}) {
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      const settings = input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
        ? input.settings
        : {};
      const sanitizedInput = sanitizeUpiRedeemRuntimeSettings(input);
      delete sanitizedInput.settings;
      const state = {
        ...(latestState || {}),
        ...sanitizeUpiRedeemRuntimeSettings(settings),
        ...sanitizedInput,
      };
      preferLatestUpiRedeemCdkeyPoolState(state, latestState);
      if (hasUpiRedeemCdkeyUsageState(latestState)) {
        state.upiRedeemCdkeyUsage = getUpiRedeemStateValue(latestState, 'upiRedeemCdkeyUsage') || {};
      } else if (hasUpiRedeemCdkeyUsageState(settings)) {
        state.upiRedeemCdkeyUsage = getUpiRedeemStateValue(settings, 'upiRedeemCdkeyUsage') || {};
      } else if (hasUpiRedeemCdkeyUsageState(input)) {
        state.upiRedeemCdkeyUsage = getUpiRedeemStateValue(input, 'upiRedeemCdkeyUsage') || {};
      }
      return state;
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

    function isRetryableUpiRedeemRoundResultItem(item = {}, totalRoundLimit = 1) {
      const status = normalizeString(item?.status).toLowerCase();
      const redeemStatus = normalizeString(item?.redeemStatus).toLowerCase();
      if (status !== 'free' || redeemStatus !== 'failed') return false;
      if (!normalizeString(item?.accessToken)) return false;
      if (isPreSubmitUpiRedeemBlockedResultItem(item)) return false;
      if (isNonRetryableUpiRedeemRetryError(item?.redeemReason || item?.reason)) return false;
      return normalizeRetryCount(item?.redeemFailureCount) < Math.max(1, Math.floor(Number(totalRoundLimit) || 1));
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

    async function findBackupCredentialByEmail(email = '') {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        return {};
      }
      try {
        const pool = await getUpiCredentialMembershipCredentialPool();
        return (pool.items || []).find((item) => normalizeEmail(item?.email) === normalizedEmail) || {};
      } catch {
        return {};
      }
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

      const isTargetStatusItem = (item = {}) => (
        item.status === status
        || (status === 'paid' && emailSet.has(normalizeEmail(item.email)))
      );
      const targetItems = currentResults.items.filter((item) => (
        isTargetStatusItem(item)
        && (!emailSet.size || emailSet.has(normalizeEmail(item.email)))
      ));
      const deletedEmailSet = new Set([
        ...emails,
        ...targetItems.map((item) => normalizeEmail(item.email)).filter(Boolean),
      ]);
      const nextRedeemAutoDeletedEmails = deletedEmailSet.size
        ? Array.from(new Set([
          ...(Array.isArray(currentResults.redeemAutoDeletedEmails) ? currentResults.redeemAutoDeletedEmails : []),
          ...deletedEmailSet,
        ].map(normalizeEmail).filter(Boolean)))
        : currentResults.redeemAutoDeletedEmails;
      let updates = {};

      if (deletedEmailSet.size) {
        const latestState = typeof getState === 'function'
          ? await getState().catch(() => ({}))
          : {};
        const usage = normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(latestState, 'upiRedeemCdkeyUsage') || {});
        const usageCleanup = clearUpiRedeemCdkeyUsageAccountBindings(usage, deletedEmailSet);
        if (usageCleanup.changed) {
          updates = { upiRedeemCdkeyUsage: usageCleanup.usage };
        }
      }

      if (!targetItems.length) {
        const nextResults = deletedEmailSet.size
          ? await saveResults({
            ...currentResults,
            redeemAutoDeletedEmails: nextRedeemAutoDeletedEmails,
            redeemAutoDeletedCount: nextRedeemAutoDeletedEmails.length,
            updatedAt: new Date().toISOString(),
          })
          : currentResults;
        if (Object.keys(updates).length && typeof setState === 'function') {
          await setState(updates).catch(() => {});
          broadcastDataUpdate(updates);
        }
        return {
          status,
          deletedCount: deletedEmailSet.size,
          results: nextResults,
          updates,
        };
      }

      const nextItems = emailSet.size
        ? currentResults.items.filter((item) => !(
          isTargetStatusItem(item)
          && emailSet.has(normalizeEmail(item.email))
        ))
        : currentResults.items.filter((item) => item.status !== status);
      const nextResults = await saveResults({
        ...currentResults,
        items: nextItems,
        redeemAutoDeletedEmails: nextRedeemAutoDeletedEmails,
        redeemAutoDeletedCount: Array.isArray(nextRedeemAutoDeletedEmails) ? nextRedeemAutoDeletedEmails.length : currentResults.redeemAutoDeletedCount,
        total: nextItems.length,
        completed: Math.min(currentResults.completed, nextItems.length),
        updatedAt: new Date().toISOString(),
      });
      if (Object.keys(updates).length && typeof setState === 'function') {
        await setState(updates).catch(() => {});
        broadcastDataUpdate(updates);
      }
      return {
        status,
        deletedCount: Math.max(targetItems.length, deletedEmailSet.size),
        results: nextResults,
        updates,
      };
    }

    function resolveInputCredentials(input = {}) {
      const textCredentials = parseCredentialBackupText(input.text || input.fileContent || '');
      const directCredentials = Array.isArray(input.credentials)
        ? input.credentials.map((item) => ({
            email: normalizeEmail(item.email),
            password: normalizeString(item.password),
            totpMfaSecret: normalizeTotpSecret(item.totpMfaSecret || item.totpSecret),
            accessToken: normalizeString(item.accessToken || item.token || item.access_token || item.upiRedeemAccessToken),
            accessTokenUpdatedAt: normalizeString(item.accessTokenUpdatedAt || item.checkedAt || item.trialEligibilityCheckedAt),
            checkedAt: normalizeString(item.checkedAt || item.trialEligibilityCheckedAt || item.accessTokenUpdatedAt),
            status: normalizeString(item.status),
            planType: normalizePlanType(item.planType),
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
      const accessToken = normalizeString(input.accessToken || input.token || input.access_token || credential.accessToken || existingItem.accessToken);
      const accessTokenUpdatedAt = accessToken
        ? normalizeString(input.accessTokenUpdatedAt || credential.accessTokenUpdatedAt || checkedAt)
        : normalizeString(existingItem.accessTokenUpdatedAt);
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
        accessToken,
        accessTokenMasked: normalizeString(input.accessTokenMasked || credential.accessTokenMasked || existingItem.accessTokenMasked) || maskAccessToken(accessToken),
        accessTokenUpdatedAt,
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
          reason: '待兑换',
        }));
      });
      return nextItems;
    }

	  function isRedeemTerminalResultItem(item = {}) {
	    const redeemStatus = normalizeUpiRedeemRemoteStatus(item.redeemStatus);
	    const status = normalizeString(item.status).toLowerCase();
    return status === 'paid'
        || (status !== 'free' && ['success', 'skipped'].includes(redeemStatus))
        || ['running', 'submitted', 'pending', 'processing', 'accepted'].includes(redeemStatus);
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

    function normalizeSubscriptionRuntimeState(state = {}) {
      const subscriptionApiBaseUrl = normalizeString(
        state?.upiSubscriptionApiBaseUrl
        || state?.upiCredentialMembershipCheckTotpApiBaseUrl
        || state?.totpMfaApiBaseUrl
        || state?.totpMfaLookupApiBaseUrl
        || ''
      );
      return subscriptionApiBaseUrl
        ? {
            ...state,
            upiSubscriptionApiBaseUrl: subscriptionApiBaseUrl,
          }
        : state;
    }

    async function checkCredentialPaidSubscription({ state = {}, credential = {}, accessToken = '', throwIfStopRequested = null } = {}) {
      if (typeof throwIfStopRequested === 'function') throwIfStopRequested();
      if (typeof checkUpiRedeemSubscriptionStatuses !== 'function') {
        throw new Error('UPI 会员状态查询能力尚未接入。');
      }
      const subscription = await checkUpiRedeemSubscriptionStatuses({
        ...normalizeSubscriptionRuntimeState(state),
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
      try {
        const codeResult = await sendAuthMessage(tabId, {
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
        throwIfStopRequested();
        if (codeResult?.invalidCode) {
          throw new Error(`2FA 动态码被页面拒绝：${codeResult.errorText || 'Incorrect code'}`);
        }
        if (codeResult?.addPhonePage) {
          throw new Error('登录后需要添加/验证手机号');
        }
        return null;
      } catch (error) {
        if (isMembershipStopError(error)) throw error;
        if (!isRecoverableCodeSubmitStateError(error)) {
          throw error;
        }
        await addLog(
          `UPI 备份核验：${credential.email} 提交 2FA 时认证页状态已变化（${getErrorMessage(error)}），尝试直接读取 ChatGPT 登录态。`,
          'warn'
        );
        return null;
      }
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

    async function loginUpiCredentialMembershipAccount(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning || cdkeyRetryRunning) {
        throw new Error('UPI Free 账号兑换/卡密重试正在运行，请等待完成或先停止。');
      }

      batchRunning = true;
      batchStopRequested = false;
      const startedAt = new Date().toISOString();
      let currentResults = await getStoredResults();
      let items = Array.isArray(currentResults.items) ? [...currentResults.items] : [];
      const rawCredential = input.credential && typeof input.credential === 'object' && !Array.isArray(input.credential)
        ? input.credential
        : input;
      const directCredential = resolveInputCredentials({ credentials: [rawCredential] })[0] || {};
      const email = normalizeEmail(input.email || rawCredential.email || directCredential.email);
      if (!email) {
        batchRunning = false;
        throw new Error('缺少要登录的账号邮箱。');
      }

      const existingItem = items.find((item) => normalizeEmail(item?.email) === email) || {};
      const backupCredential = await findBackupCredentialByEmail(email);
      const rawStatus = normalizeString(existingItem.status || directCredential.status || rawCredential.status).toLowerCase();
      const status = ['paid', 'free', 'failed'].includes(rawStatus) ? rawStatus : 'free';
      const planType = status === 'paid'
        ? (normalizePlanType(existingItem.planType || directCredential.planType || rawCredential.planType || 'plus') || 'plus')
        : (normalizePlanType(existingItem.planType || directCredential.planType || rawCredential.planType || 'free') || 'free');
      const baseItem = normalizeResultItem({
        ...backupCredential,
        ...existingItem,
        ...rawCredential,
        ...directCredential,
        email,
        status,
        planType,
        password: normalizeString(directCredential.password || rawCredential.password || backupCredential.password || existingItem.password),
        totpMfaSecret: normalizeTotpSecret(directCredential.totpMfaSecret || rawCredential.totpMfaSecret || rawCredential.totpSecret || backupCredential.totpMfaSecret || existingItem.totpMfaSecret),
      });
      if (!baseItem.password) {
        batchRunning = false;
        throw new Error(`${email} 缺少 GPT 密码，无法登录。`);
      }
      if (!baseItem.totpMfaSecret) {
        batchRunning = false;
        throw new Error(`${email} 缺少 2FA，无法登录。`);
      }

      const source = normalizeString(input.source || currentResults.source || 'row-login');
      const saveLoginProgress = async (stage = 'login', reason = '') => {
        items = upsertResultItem(items, {
          ...baseItem,
          reason: reason || baseItem.reason || '正在登录',
        });
        currentResults = await saveResults({
          ...currentResults,
          items,
          running: true,
          updatedAt: new Date().toISOString(),
          startedAt: currentResults.startedAt || startedAt,
          finishedAt: '',
          stoppedAt: '',
          flowStage: stage,
          flowStageEmail: email,
          source,
          total: Math.max(currentResults.total || 0, items.length),
          completed: Math.max(currentResults.completed || 0, items.length),
        });
      };

      try {
        const latestState = typeof getState === 'function'
          ? await getState().catch(() => ({}))
          : {};
        const runtimeState = {
          ...(latestState || {}),
          ...(input.settings || {}),
          visibleStep: 7,
        };
        const session = await loginAndReadAccessToken(baseItem, runtimeState, {
          onStage: async (stage) => {
            const reasonMap = {
              'open-chatgpt': '正在打开 ChatGPT 官网',
              login: '正在登录邮箱密码',
              totp: '正在提交 2FA 验证',
              token: '正在读取 accessToken',
            };
            await saveLoginProgress(stage, reasonMap[stage] || '正在登录');
          },
          throwIfStopRequested: () => throwIfMembershipStopRequested('check'),
        });
        const accessToken = normalizeString(session.accessToken || getChatGptSessionAccessToken(session.session || session));
        const finishedAt = new Date().toISOString();
        items = upsertResultItem(items, {
          ...baseItem,
          accessToken,
          accessTokenMasked: maskAccessToken(accessToken),
          accessTokenUpdatedAt: finishedAt,
          reason: '网页登录完成，已刷新 AT',
        });
        const results = await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: finishedAt,
          finishedAt,
          stoppedAt: '',
          flowStage: '',
          flowStageEmail: '',
          source,
          total: Math.max(currentResults.total || 0, items.length),
          completed: Math.max(currentResults.completed || 0, items.length),
        });
        await addLog(`UPI 账号登录：${email} 已登录并刷新 AT。`, 'ok');
        return {
          item: results.items.find((item) => normalizeEmail(item?.email) === email) || null,
          results,
        };
      } catch (error) {
        const failedAt = new Date().toISOString();
        const reason = getErrorMessage(error) || '登录失败';
        items = upsertResultItem(items, {
          ...baseItem,
          reason: `登录失败：${reason}`,
        });
        await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: failedAt,
          stoppedAt: isMembershipStopError(error) ? failedAt : currentResults.stoppedAt,
          flowStage: '',
          flowStageEmail: '',
          source,
          total: Math.max(currentResults.total || 0, items.length),
          completed: Math.max(currentResults.completed || 0, items.length),
        }).catch(() => null);
        throw error;
      } finally {
        batchRunning = false;
      }
    }

    async function moveUpiCredentialMembershipAccountGroup(input = {}) {
      if (batchRunning || redeemRunning || cdkeyRetryRunning) {
        throw new Error('UPI 备份账号核验/兑换正在运行，请先停止后再移动分组。');
      }
      const rawCredential = input.credential && typeof input.credential === 'object' && !Array.isArray(input.credential)
        ? input.credential
        : input;
      const directCredential = resolveInputCredentials({ credentials: [rawCredential] })[0] || {};
      const email = normalizeEmail(input.email || rawCredential.email || directCredential.email);
      if (!email) {
        throw new Error('缺少要移动分组的账号邮箱。');
      }
      const targetStatus = normalizeString(input.targetStatus || input.status || input.group).toLowerCase() === 'paid'
        ? 'paid'
        : 'free';
      const now = new Date().toISOString();
      const currentResults = await getStoredResults();
      const backupCredential = await findBackupCredentialByEmail(email);
      const existingItem = currentResults.items.find((item) => normalizeEmail(item?.email) === email) || {};
      const baseItem = normalizeResultItem({
        ...backupCredential,
        ...existingItem,
        ...rawCredential,
        ...directCredential,
        email,
        status: existingItem.status || directCredential.status || (targetStatus === 'paid' ? 'free' : 'paid'),
        planType: existingItem.planType || directCredential.planType || (targetStatus === 'paid' ? 'plus' : 'free'),
        password: normalizeString(directCredential.password || rawCredential.password || backupCredential.password || existingItem.password),
        totpMfaSecret: normalizeTotpSecret(directCredential.totpMfaSecret || rawCredential.totpMfaSecret || rawCredential.totpSecret || backupCredential.totpMfaSecret || existingItem.totpMfaSecret),
      });
      const targetPlanType = targetStatus === 'paid'
        ? (normalizePlanType(input.planType || rawCredential.planType || baseItem.planType || 'plus') || 'plus')
        : 'free';
      const movedItem = normalizeResultItem({
        ...baseItem,
        status: targetStatus,
        planType: targetPlanType,
        checkedAt: now,
        reason: targetStatus === 'paid' ? '手动移入 Plus 组' : '手动移入 Free 组',
        membershipOverrideStatus: targetStatus === 'free' ? 'free' : '',
        membershipOverrideCheckedAt: targetStatus === 'free' ? now : '',
        redeemStatus: targetStatus === 'paid' && baseItem.redeemStatus === 'success' ? 'success' : '',
        redeemReason: targetStatus === 'paid' && baseItem.redeemStatus === 'success' ? baseItem.redeemReason : '',
      });
      const items = upsertResultItem(currentResults.items, movedItem);
      const results = await saveResults({
        ...currentResults,
        items,
        updatedAt: now,
        total: Math.max(currentResults.total || 0, items.length),
        completed: Math.max(currentResults.completed || 0, items.length),
      });
      await addLog(`UPI 分组移动：${email} 已手动移入 ${targetStatus === 'paid' ? 'Plus' : 'Free'} 组。`, 'ok');
      return {
        item: results.items.find((item) => normalizeEmail(item?.email) === email) || movedItem,
        results,
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
          accessToken: session.accessToken,
          accessTokenMasked: maskAccessToken(session.accessToken),
          accessTokenUpdatedAt: checkedAt,
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

    async function redeemUpiCredentialMembershipFreeLegacy(input = {}) {
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
      const runtimeSettings = sanitizeUpiRedeemRuntimeSettings(input.settings);
      const redeemFailureLimit = normalizeFailedAccountRetryLimit(
        getUpiRedeemStateValue(runtimeSettings, 'upiRedeemFailedAccountRetryLimit'),
        DEFAULT_UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT
      );
      const credentials = filterRedeemableCredentialsForCurrentResults(requestedCredentials, {
        ...currentResults,
        items,
      });
      const skippedCompletedCount = Math.max(0, requestedCredentials.length - credentials.length);

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
                const redeemSuccessAt = new Date().toISOString();
                redeemCompleted += 1;
                items = upsertResultItem(items, {
                  ...baseItem,
                  status: 'paid',
                  planType: currentSubscription.planType,
                  reason: currentSubscription.reason || `已开通 ${currentSubscription.planType}`,
                  checkedAt: redeemSuccessAt,
                  accessToken: session.accessToken,
                  accessTokenMasked: maskAccessToken(session.accessToken),
                  redeemStatus: 'skipped',
                  redeemReason: '重新核验已是会员，未消耗卡密',
                  redeemFailureCount: 0,
                  redeemLastFailedAt: '',
                  upiRedeemCdkey: '',
                  redeemSuccessAt,
                  upiRedeemSubscriptionCheckedAt: redeemSuccessAt,
                  membershipOverrideStatus: '',
                  membershipOverrideCheckedAt: '',
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

            const runtimeStateForCdkey = await getFreshUpiRedeemRuntimeState({
              ...input,
              settings: runtimeSettings,
            });
            attemptedUpiRedeemCdkey = pickRandomUpiRedeemCdkey(getAvailableUpiRedeemCdkeys(runtimeStateForCdkey));
            if (!attemptedUpiRedeemCdkey) {
              throw new Error('UPI 卡密不足');
            }
            await updateRedeemStage('upi-redeem-plus', `正在使用 UPI 卡密兑换 Plus：${attemptedUpiRedeemCdkey}`);
            throwIfStopRequested();
            const redeemResult = await redeemUpiCredentialWithAccessToken({
              state: {
                ...currentResults,
                ...runtimeSettings,
                visibleStep: 7,
              },
              credential,
              session: session.session || session,
              accessToken: session.accessToken,
              forceCdkey: attemptedUpiRedeemCdkey,
              skipEligibilityCheck: true,
              deferSubscriptionConfirmation: true,
            });
            attemptedUpiRedeemCdkey = normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey || attemptedUpiRedeemCdkey);
            throwIfStopRequested();
            if (redeemResult?.duplicateCdkeyRejected === true) {
              redeemCompleted += 1;
              const duplicateReason = redeemResult.reason || '卡密已重复提交，当前账号未提交成功；本账号本轮结束，切换下一个账号。';
              const duplicateFailedAt = new Date().toISOString();
              const duplicateFailureCount = normalizeRetryCount(baseItem.redeemFailureCount) + 1;
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: duplicateReason,
                accessToken: session.accessToken,
                accessTokenMasked: maskAccessToken(session.accessToken),
                redeemStatus: 'failed',
                redeemReason: duplicateReason,
                redeemFailureCount: duplicateFailureCount,
                redeemFailureLimit,
                redeemLastFailedAt: duplicateFailedAt,
                lastFailedUpiRedeemCdkey: attemptedUpiRedeemCdkey,
                upiRedeemCdkey: '',
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
              await addLog(`UPI 无会员补兑：${credential.email} -> 重复卡密未提交当前账号，本账号本轮结束，切换下一个账号。`, 'warn');
              continue;
            }
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
                accessToken: session.accessToken,
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
              await addLog(`UPI 无会员补兑：${credential.email} 已提交卡密，等待远端系统返回最终结果，不计入账号失败轮次。`, 'info');
              continue;
            }
            if (!redeemedSubscription.active || !isPaidPlanType(redeemedSubscription.planType)) {
              throw new Error(redeemedSubscription.reason || 'UPI 卡密已提交，但未确认 Plus/Pro/Team 会员。');
            }
            const redeemSuccessAt = getRedeemResultSubscriptionCheckedAt(redeemResult) || new Date().toISOString();
            redeemCompleted += 1;
            items = upsertResultItem(items, {
              ...baseItem,
              status: 'paid',
              planType: redeemedSubscription.planType,
              reason: redeemedSubscription.reason || `已开通 ${redeemedSubscription.planType}`,
              checkedAt: redeemSuccessAt,
              accessToken: session.accessToken,
              accessTokenMasked: maskAccessToken(session.accessToken),
              redeemStatus: 'success',
              redeemReason: 'UPI 卡密兑换成功并已确认会员',
              redeemFailureCount: 0,
              redeemLastFailedAt: '',
              upiRedeemCdkey: normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey),
              redeemSuccessAt,
              upiRedeemSubscriptionCheckedAt: redeemSuccessAt,
              membershipOverrideStatus: '',
              membershipOverrideCheckedAt: '',
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
              const failedAt = new Date().toISOString();
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: `${reason}（兑换失败，账号保留在 Free 等待重新匹配卡密）`,
                redeemStatus: 'failed',
                redeemReason: reason,
                redeemFailureCount: normalizeRetryCount(baseItem.redeemFailureCount) + 1,
                redeemFailureLimit,
                redeemLastFailedAt: failedAt,
                redeemAttemptedAt,
                lastFailedUpiRedeemCdkey: attemptedUpiRedeemCdkey,
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
                attemptedUpiRedeemCdkey
                  ? `UPI 无会员补兑：${credential.email} -> 后端返回 approve-blocked，旧卡 ${attemptedUpiRedeemCdkey} 已释放，账号保留在 Free 等待重新匹配：${reason}`
                  : `UPI 无会员补兑：${credential.email} -> 后端返回 approve-blocked，账号保留在 Free 等待重新匹配：${reason}`,
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
                reason: `${blockedReason}；未提交卡密，不计入兑换失败轮次。`,
                redeemStatus: 'blocked',
                redeemReason: `${blockedReason}；未提交卡密，不计入兑换失败轮次。`,
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
                `UPI 无会员补兑：${credential.email} -> 登录/AT 阻塞，尚未提交卡密，不计入兑换失败轮次：${blockedReason}`,
                'warn'
              );
              continue;
            }
            redeemCompleted += 1;
            const redeemFailedAt = new Date().toISOString();
            const existingRedeemFailureCount = normalizeRetryCount(baseItem.redeemFailureCount)
              || (normalizeString(baseItem.redeemStatus).toLowerCase() === 'failed' ? 1 : 0);
            const redeemFailureCount = existingRedeemFailureCount + 1;
            const failureLabel = getRedeemRoundLabel(redeemFailureCount, redeemFailureLimit || getRedeemTotalRoundLimit(0));
            items = upsertResultItem(items, {
              ...baseItem,
              status: 'free',
              planType: 'free',
              reason: `${reason || '兑换失败'}（${failureLabel}）`,
              redeemStatus: 'failed',
              redeemReason: reason || '兑换失败',
              redeemFailureCount,
              redeemFailureLimit,
              redeemLastFailedAt: redeemFailedAt,
              lastFailedUpiRedeemCdkey: attemptedUpiRedeemCdkey,
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
              `UPI 无会员补兑：${credential.email} -> ${failureLabel}，账号保留在 Free：${reason}`,
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

    async function fillUpiCredentialMembershipFreeAccessTokens(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning || cdkeyRetryRunning) {
        throw new Error('UPI Free 账号兑换/卡密重试正在运行，请等待完成或先停止。');
      }

      batchRunning = true;
      batchStopRequested = false;
      const startedAt = new Date().toISOString();
      let currentResults = await getStoredResults();
      const requestedCredentials = resolveInputCredentials(input).filter((credential) => credential.email);
      let items = mergeCredentialsIntoResultItems(currentResults.items, requestedCredentials);
      const lookup = {};
      items.forEach((item) => {
        const email = normalizeEmail(item?.email);
        if (email) lookup[email] = item;
      });
      const rawCandidates = requestedCredentials.length
        ? requestedCredentials.map((credential) => ({ ...(lookup[normalizeEmail(credential.email)] || {}), ...credential }))
        : items;
      const credentials = rawCandidates
        .map((credential) => normalizeResultItem({ ...credential, status: credential.status || 'free' }))
        .filter((credential) => credential.email && credential.status === 'free' && !credential.accessToken);
      const runtimeState = {
        ...(await getState()),
        ...(input.settings || {}),
      };
      const filled = [];
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
          source: normalizeString(input.source || currentResults.source || 'free-fill-at'),
          total: credentials.length,
          completed: filled.length + skipped.length + failed.length,
        });
      };

      try {
        if (!credentials.length) {
          return {
            results: await saveResults({
              ...currentResults,
              items,
              running: false,
              updatedAt: startedAt,
              finishedAt: startedAt,
              flowStage: '',
              flowStageEmail: '',
            }),
            filled,
            skipped,
            failed,
          };
        }

        await addLog(`UPI Free 分组补充 AT：开始处理 ${credentials.length} 个缺 AT 账号。`, 'info');
        for (const credential of credentials) {
          throwIfMembershipStopRequested('check');
          const email = normalizeEmail(credential.email);
          const existingItem = items.find((item) => normalizeEmail(item?.email) === email) || {};
          const activeCredential = normalizeResultItem({
            ...existingItem,
            ...credential,
            email,
            status: 'free',
            planType: 'free',
          });
          if (!activeCredential.password || !activeCredential.totpMfaSecret) {
            const reason = !activeCredential.password ? '缺少 GPT 密码，无法补充 AT' : '缺少 2FA 密钥，无法补充 AT';
            skipped.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              reason,
            });
            await saveProgress('token', email);
            await addLog(`UPI Free 分组补充 AT：${email} -> 跳过：${reason}`, 'warn');
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
            const accessToken = normalizeString(session.accessToken || getChatGptSessionAccessToken(session.session || session));
            if (!accessToken) {
              throw new Error('未读取到 accessToken');
            }
            const updatedAt = new Date().toISOString();
            filled.push({ email, accessTokenMasked: maskAccessToken(accessToken), updatedAt });
            items = upsertResultItem(items, {
              ...activeCredential,
              reason: activeCredential.reason || '已补充 AT',
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              accessTokenUpdatedAt: updatedAt,
              checkedAt: activeCredential.checkedAt || updatedAt,
            });
            await saveProgress('token', email);
            await addLog(`UPI Free 分组补充 AT：${email} -> 已保存 AT。`, 'ok');
          } catch (error) {
            const reason = getErrorMessage(error) || '补充 AT 失败';
            failed.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              reason,
            });
            await saveProgress('token', email);
            await addLog(`UPI Free 分组补充 AT：${email} -> 失败：${reason}`, 'warn');
          }
        }

        const finishedAt = new Date().toISOString();
        const results = await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: finishedAt,
          finishedAt,
          flowStage: '',
          flowStageEmail: '',
          total: items.length,
          completed: items.length,
        });
        await addLog(`UPI Free 分组补充 AT：完成，成功 ${filled.length}，跳过 ${skipped.length}，失败 ${failed.length}。`, 'ok');
        return { results, filled, skipped, failed };
      } finally {
        batchRunning = false;
      }
    }

    async function redeemUpiCredentialMembershipFree(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning) {
        throw new Error('UPI Free 账号兑换正在运行，请等待完成或先停止。');
      }
      if (typeof redeemUpiCredentialWithAccessToken !== 'function') {
        throw new Error('UPI Free 账号兑换能力尚未接入。');
      }

      redeemRunning = true;
      redeemStopRequested = false;
      const startedAt = new Date().toISOString();
      let redeemCompleted = 0;
      let currentResults = await getStoredResults();
      const requestedCredentials = resolveInputCredentials(input).filter((credential) => credential.email);
      let items = mergeCredentialsIntoResultItems(currentResults.items, requestedCredentials);
      const source = normalizeString(input.source || currentResults.source || 'free-selected');
      const runtimeSettings = sanitizeUpiRedeemRuntimeSettings(input.settings);
      const additionalRoundCount = normalizeRedeemAdditionalRoundCount(
        getUpiRedeemStateValue(runtimeSettings, 'upiRedeemFailedAccountRetryLimit'),
        DEFAULT_UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT
      );
      const totalRoundLimit = getRedeemTotalRoundLimit(additionalRoundCount);
      const lookup = {};
      items.forEach((item) => {
        const email = normalizeEmail(item?.email);
        if (email) lookup[email] = item;
      });
      const rawCandidates = requestedCredentials.length
        ? requestedCredentials.map((credential) => ({ ...(lookup[normalizeEmail(credential.email)] || {}), ...credential }))
        : items.filter((item) => normalizeString(item?.status).toLowerCase() === 'free');
      const freeCandidates = rawCandidates
        .map((credential) => normalizeResultItem({ ...credential, status: credential.status || 'free' }))
        .filter((credential) => credential.email && credential.status === 'free');
      const credentials = filterRedeemableCredentialsForCurrentResults(freeCandidates, {
        ...currentResults,
        items,
      }).map((credential) => normalizeResultItem({ ...credential, status: credential.status || 'free' }));
      const stats = {
        attempted: 0,
        submitted: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      };

      const getLatestItem = (email = '') => (
        items.find((item) => normalizeEmail(item?.email) === normalizeEmail(email)) || {}
      );

      const saveRedeemProgress = async (patch = {}) => {
        currentResults = await saveResults({
          ...currentResults,
          items,
          redeeming: patch.redeeming !== false,
          redeemUpdatedAt: new Date().toISOString(),
          redeemTotal: Math.max(0, Math.floor(Number(patch.redeemTotal ?? currentResults.redeemTotal ?? credentials.length) || 0)),
          redeemCompleted,
          source,
          flowStage: normalizeFlowStage(patch.flowStage ?? currentResults.flowStage),
          flowStageEmail: normalizeEmail(patch.email ?? currentResults.flowStageEmail),
        });
      };

      try {
        if (credentials.length) {
          if (typeof setState === 'function' && Object.keys(runtimeSettings).length) {
            await setState(runtimeSettings).catch(() => {});
          }
          const latestRuntimeState = await getFreshUpiRedeemRuntimeState({
            ...input,
            settings: runtimeSettings,
          });
          if (!normalizeString(getUpiRedeemStateValue(latestRuntimeState, 'upiRedeemExternalApiKey'))) {
            throw new Error('第 7 步 UPI 卡密兑换 Plus 未配置：缺少 UPI 外部 API Key。');
          }
          const availableCdkeys = getAvailableUpiRedeemCdkeys(latestRuntimeState);
          if (availableCdkeys.length > 0 && credentials.length > availableCdkeys.length) {
            await addLog(
              `UPI Free 分组卡密兑换：当前可用卡密 ${availableCdkeys.length} 个，待兑换账号 ${credentials.length} 个；本轮按 ${availableCdkeys.length} 个卡密槽位处理，失败释放槽位并补后续账号。`,
              'warn'
            );
          }
          if (!availableCdkeys.length) {
            await addLog('UPI Free 分组卡密兑换：没有可用 UPI 卡密，本批未开始；账号保持待兑换。', 'warn');
          }
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
          });
        }

        let roundQueue = credentials;
        await addLog(
          `UPI Free 分组卡密兑换：开始处理 ${credentials.length} 个账号；失败账号后续轮数 ${additionalRoundCount}，总轮数 ${totalRoundLimit}。`,
          'info'
        );

        for (let roundNumber = 1; roundNumber <= totalRoundLimit && roundQueue.length; roundNumber += 1) {
          throwIfMembershipStopRequested('redeem');
          const roundState = await getFreshUpiRedeemRuntimeState({
            ...input,
            settings: runtimeSettings,
          });
          const roundCdkeys = getAvailableUpiRedeemCdkeys(roundState);
          if (!roundCdkeys.length) {
            await addLog(
              `UPI Free 分组卡密兑换：第 ${roundNumber}/${totalRoundLimit} 轮没有可用 UPI 卡密，剩余账号保持待兑换。`,
              'warn'
            );
            break;
          }

          const roundCdkeySet = new Set(roundCdkeys.map(normalizeString).filter(Boolean));
          const failedEmailsThisRound = [];
          const roundTotal = roundQueue.length;
          let roundAttempted = 0;
          await addLog(
            `UPI Free 分组卡密兑换：开始第 ${roundNumber}/${totalRoundLimit} 轮，账号 ${roundTotal} 个，卡密槽位 ${roundCdkeys.length} 个。`,
            'info'
          );
          await saveRedeemProgress({ flowStage: 'upi-redeem-plus', email: '', redeemTotal: roundTotal });

          for (const credential of roundQueue) {
            throwIfMembershipStopRequested('redeem');
            const email = normalizeEmail(credential.email);
            const existingItem = getLatestItem(email);
            const baseItem = normalizeResultItem({
              ...existingItem,
              ...credential,
              email,
              status: 'free',
              planType: 'free',
            });
            const accessToken = normalizeString(baseItem.accessToken);
            if (!accessToken) {
              const reason = '缺少 AT，请先点击“一键补充 AT”。';
              stats.skipped += 1;
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason,
                redeemStatus: 'blocked',
                redeemReason: reason,
                redeemFailureLimit: totalRoundLimit,
                upiRedeemCdkey: '',
              });
              await saveRedeemProgress({ flowStage: 'upi-redeem-plus', email, redeemTotal: roundTotal });
              await addLog(`UPI Free 分组卡密兑换：${email} -> 跳过：${reason}`, 'warn');
              continue;
            }

            const runtimeStateForCdkey = await getFreshUpiRedeemRuntimeState({
              ...input,
              settings: runtimeSettings,
            });
            const availableCdkeys = getAvailableUpiRedeemCdkeys(runtimeStateForCdkey)
              .filter((cdkey) => roundCdkeySet.has(normalizeString(cdkey)));
            const attemptedUpiRedeemCdkey = pickRandomUpiRedeemCdkey(availableCdkeys);
            if (!attemptedUpiRedeemCdkey) {
              await addLog(
                `UPI Free 分组卡密兑换：第 ${roundNumber}/${totalRoundLimit} 轮卡密槽位已被成功/等待中的账号占满，剩余账号保持待兑换。`,
                'warn'
              );
              break;
            }

            const redeemAttemptedAt = new Date().toISOString();
            const roundLabel = getRedeemRoundLabel(roundNumber, totalRoundLimit);
            items = upsertResultItem(items, {
              ...baseItem,
              status: 'free',
              planType: 'free',
              reason: `${roundLabel}：已绑定卡密，正在提交`,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              redeemStatus: 'running',
              redeemReason: `${roundLabel}：${attemptedUpiRedeemCdkey}`,
              redeemAttemptedAt,
              redeemFailureLimit: totalRoundLimit,
              upiRedeemCdkey: attemptedUpiRedeemCdkey,
            });
            await saveRedeemProgress({ flowStage: 'upi-redeem-plus', email, redeemTotal: roundTotal });
            await addLog(`UPI Free 分组卡密兑换：${email} -> ${roundLabel} 随机选择卡密 ${attemptedUpiRedeemCdkey}。`, 'info');

            let attemptCounted = false;
            try {
              const redeemResult = await redeemUpiCredentialWithAccessToken({
                state: {
                  ...currentResults,
                  ...runtimeSettings,
                  visibleStep: 7,
                },
                credential: baseItem,
                session: { accessToken },
                accessToken,
                forceCdkey: attemptedUpiRedeemCdkey,
                skipEligibilityCheck: true,
                deferSubscriptionConfirmation: true,
              });
              const submittedCdkey = normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey || attemptedUpiRedeemCdkey);
              if (redeemResult?.duplicateCdkeyRejected === true) {
                throw new Error(redeemResult.reason || '卡密重复提交，当前账号本轮未提交成功。');
              }
              roundAttempted += 1;
              redeemCompleted += 1;
              stats.attempted += 1;
              attemptCounted = true;
              if (redeemResult.pendingRemoteConfirmation === true) {
                const pendingReason = normalizeString(redeemResult.reason)
                  || '卡密已提交，等待远端系统返回最终结果';
                stats.submitted += 1;
                items = upsertResultItem(items, {
                  ...baseItem,
                  status: 'free',
                  planType: 'free',
                  reason: pendingReason,
                  accessToken,
                  accessTokenMasked: maskAccessToken(accessToken),
                  redeemStatus: 'submitted',
                  redeemReason: pendingReason,
                  redeemFailureLimit: totalRoundLimit,
                  redeemAttemptedAt,
                  upiRedeemCdkey: submittedCdkey,
                });
                await saveRedeemProgress({ flowStage: 'upi-redeem-plus', email, redeemTotal: roundTotal });
                await addLog(`UPI Free 分组卡密兑换：${email} -> ${submittedCdkey} 已提交到远端，等待最终会员结果。`, 'ok');
                continue;
              }

              await saveRedeemProgress({ flowStage: 'confirm-plus', email, redeemTotal: roundTotal });
              const redeemedSubscription = classifyRedeemResult(redeemResult);
              if (!redeemedSubscription.active || !isPaidPlanType(redeemedSubscription.planType)) {
                throw new Error(redeemedSubscription.reason || 'UPI 卡密已提交，但未确认 Plus/Pro/Team 会员。');
              }
              const redeemSuccessAt = getRedeemResultSubscriptionCheckedAt(redeemResult) || new Date().toISOString();
              stats.succeeded += 1;
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'paid',
                planType: redeemedSubscription.planType,
                reason: redeemedSubscription.reason || `已开通 ${redeemedSubscription.planType}`,
                checkedAt: redeemSuccessAt,
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                redeemStatus: 'success',
                redeemReason: 'UPI 卡密兑换成功并已确认会员',
                redeemFailureCount: 0,
                redeemFailureLimit: totalRoundLimit,
                redeemLastFailedAt: '',
                redeemAttemptedAt,
                redeemSuccessAt,
                upiRedeemCdkey: submittedCdkey,
                upiRedeemSubscriptionCheckedAt: redeemSuccessAt,
                membershipOverrideStatus: '',
                membershipOverrideCheckedAt: '',
              });
              await saveRedeemProgress({ flowStage: 'confirm-plus', email, redeemTotal: roundTotal });
              await addLog(`UPI Free 分组卡密兑换：${email} -> ${submittedCdkey} 已兑换并确认 ${redeemedSubscription.planType}。`, 'ok');
            } catch (error) {
              if (isMembershipStopError(error)) {
                redeemStopRequested = true;
                items = upsertResultItem(items, {
                  ...baseItem,
                  status: 'free',
                  planType: 'free',
                  reason: '已停止，未继续兑换',
                  redeemStatus: 'stopped',
                  redeemReason: '已停止，未继续兑换',
                  redeemAttemptedAt,
                  upiRedeemCdkey: attemptedUpiRedeemCdkey,
                });
                break;
              }
              const authError = isUpiRedeemApiAuthError(error);
              const reason = getErrorMessage(error) || '兑换失败';
              const redeemFailedAt = new Date().toISOString();
              if (!attemptCounted) {
                roundAttempted += 1;
                redeemCompleted += 1;
                stats.attempted += 1;
              }
              if (authError) {
                redeemStopRequested = true;
              } else {
                stats.failed += 1;
                failedEmailsThisRound.push(email);
              }
              items = upsertResultItem(items, {
                ...baseItem,
                status: 'free',
                planType: 'free',
                reason: authError ? 'UPI 远端接口拒绝请求，已停止整批兑换' : `${reason}（${roundLabel}）`,
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                redeemStatus: authError ? 'stopped' : 'failed',
                redeemReason: reason,
                redeemFailureCount: authError ? normalizeRetryCount(baseItem.redeemFailureCount) : roundNumber,
                redeemFailureLimit: totalRoundLimit,
                redeemLastFailedAt: authError ? baseItem.redeemLastFailedAt : redeemFailedAt,
                redeemAttemptedAt,
                lastFailedUpiRedeemCdkey: authError ? baseItem.lastFailedUpiRedeemCdkey : attemptedUpiRedeemCdkey,
                upiRedeemCdkey: authError ? attemptedUpiRedeemCdkey : '',
              });
              await saveRedeemProgress({
                flowStage: 'upi-redeem-plus',
                email,
                redeemTotal: roundTotal,
                redeeming: !redeemStopRequested,
              });
              await addLog(
                authError
                  ? `UPI Free 分组卡密兑换：远端接口拒绝请求，已停止在 ${email}；请检查 UPI Key 或后端外部兑换接口 CSRF/API Key 配置：${reason}`
                  : `UPI Free 分组卡密兑换：${email} -> ${attemptedUpiRedeemCdkey} 失败，释放卡密并切换下一个账号：${reason}`,
                authError ? 'error' : 'warn'
              );
              if (redeemStopRequested) {
                break;
              }
            }
          }

          await addLog(
            `UPI Free 分组卡密兑换：第 ${roundNumber}/${totalRoundLimit} 轮结束，尝试 ${roundAttempted}/${roundTotal} 个账号。`,
            'info'
          );
          if (redeemStopRequested || roundNumber >= totalRoundLimit) {
            break;
          }
          roundQueue = failedEmailsThisRound
            .map((email) => normalizeResultItem(getLatestItem(email)))
            .filter((item) => isRetryableUpiRedeemRoundResultItem(item, totalRoundLimit));
          if (!roundQueue.length) {
            break;
          }
          await addLog(
            `UPI Free 分组卡密兑换：准备第 ${roundNumber + 1}/${totalRoundLimit} 轮，仅处理上一轮失败账号 ${roundQueue.length} 个。`,
            'info'
          );
        }

        const finishedAt = new Date().toISOString();
        const finalResults = await saveResults({
          ...currentResults,
          items,
          redeeming: false,
          redeemUpdatedAt: finishedAt,
          redeemFinishedAt: redeemStopRequested ? '' : finishedAt,
          redeemStoppedAt: redeemStopRequested ? finishedAt : '',
          redeemTotal: Math.max(redeemCompleted, credentials.length),
          redeemCompleted,
          flowStage: redeemStopRequested ? currentResults.flowStage : '',
          flowStageEmail: redeemStopRequested ? currentResults.flowStageEmail : '',
          source,
        });
        await addLog(
          redeemStopRequested
            ? `UPI Free 分组卡密兑换：已停止，已尝试 ${stats.attempted} 次，等待 ${stats.submitted}，成功 ${stats.succeeded}，失败 ${stats.failed}。`
            : `UPI Free 分组卡密兑换：完成，已尝试 ${stats.attempted} 次，等待 ${stats.submitted}，成功 ${stats.succeeded}，失败 ${stats.failed}，跳过 ${stats.skipped}。`,
          redeemStopRequested ? 'warn' : 'ok'
        );
        return finalResults;
      } finally {
        redeemRunning = false;
      }
    }

    async function identifyUpiCredentialMembershipFreePlus(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning || cdkeyRetryRunning) {
        throw new Error('UPI Free 账号兑换/卡密重试正在运行，请等待完成或先停止。');
      }
      if (typeof checkUpiRedeemSubscriptionStatuses !== 'function') {
        throw new Error('UPI 会员状态查询能力尚未接入。');
      }

      batchRunning = true;
      batchStopRequested = false;
      const startedAt = new Date().toISOString();
      let currentResults = await getStoredResults();
      const requestedCredentials = resolveInputCredentials(input).filter((credential) => credential.email);
      let items = mergeCredentialsIntoResultItems(currentResults.items, requestedCredentials);
      const lookup = {};
      items.forEach((item) => {
        const email = normalizeEmail(item?.email);
        if (email) lookup[email] = item;
      });
      const rawCandidates = requestedCredentials.length
        ? requestedCredentials.map((credential) => ({ ...(lookup[normalizeEmail(credential.email)] || {}), ...credential }))
        : items;
      const credentials = rawCandidates
        .map((credential) => normalizeResultItem({ ...credential, status: credential.status || 'free' }))
        .filter((credential) => credential.email && credential.status === 'free' && credential.accessToken);
      const paid = [];
      const free = [];
      const failed = [];
      const skipped = [];
      const source = normalizeString(input.source || currentResults.source || 'free-identify-plus');

      const saveProgress = async (stage = 'subscription-check', email = '') => {
        currentResults = await saveResults({
          ...currentResults,
          items,
          running: true,
          updatedAt: new Date().toISOString(),
          flowStage: stage,
          flowStageEmail: normalizeEmail(email),
          source,
          total: credentials.length,
          completed: paid.length + free.length + failed.length + skipped.length,
        });
      };

      try {
        if (!credentials.length) {
          const finishedAt = new Date().toISOString();
          return {
            results: await saveResults({
              ...currentResults,
              items,
              running: false,
              updatedAt: finishedAt,
              finishedAt,
              flowStage: '',
              flowStageEmail: '',
              source,
            }),
            paid,
            free,
            failed,
            skipped,
          };
        }

        const runtimeState = normalizeSubscriptionRuntimeState({
          ...(typeof getState === 'function' ? await getState().catch(() => ({})) : {}),
          ...(input.settings || {}),
        });
        await addLog(`UPI Free 分组识别 Plus：开始用已保存 AT 查询 ${credentials.length} 个账号。`, 'info');

        for (const credential of credentials) {
          throwIfMembershipStopRequested('check');
          const email = normalizeEmail(credential.email);
          const existingItem = items.find((item) => normalizeEmail(item?.email) === email) || {};
          const activeCredential = normalizeResultItem({
            ...existingItem,
            ...credential,
            email,
            status: 'free',
            planType: 'free',
          });
          const accessToken = normalizeString(activeCredential.accessToken);
          const checkedAt = new Date().toISOString();
          if (!accessToken) {
            const reason = '缺少 AT，请先点击“一键补充 AT”。';
            skipped.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'free',
              planType: 'free',
              reason,
              upiRedeemSubscriptionCheckedAt: checkedAt,
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Free 分组识别 Plus：${email} -> 跳过：${reason}`, 'warn');
            continue;
          }

          try {
            await saveProgress('subscription-check', email);
            const subscription = await checkCredentialPaidSubscription({
              state: {
                ...runtimeState,
                ...currentResults,
              },
              credential: activeCredential,
              accessToken,
              throwIfStopRequested: () => throwIfMembershipStopRequested('check'),
            });
            const reason = subscription.reason || '订阅 API 已返回会员状态';
            if (subscription.status === 'paid' && isPaidPlanType(subscription.planType)) {
              const shouldMarkRedeemSuccess = Boolean(
                normalizeString(activeCredential.upiRedeemCdkey)
                || normalizeString(activeCredential.redeemAttemptedAt)
                || normalizeString(activeCredential.redeemStatus).toLowerCase() === 'submitted'
              );
              paid.push({ email, planType: subscription.planType, reason });
              items = upsertResultItem(items, {
                ...activeCredential,
                status: 'paid',
                planType: subscription.planType,
                reason,
                checkedAt,
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                accessTokenUpdatedAt: activeCredential.accessTokenUpdatedAt || checkedAt,
                upiRedeemSubscriptionCheckedAt: checkedAt,
                redeemStatus: shouldMarkRedeemSuccess ? 'success' : '',
                redeemReason: shouldMarkRedeemSuccess ? '订阅 API 已确认会员' : '',
                redeemFailureCount: 0,
                redeemLastFailedAt: '',
                redeemSuccessAt: shouldMarkRedeemSuccess ? checkedAt : activeCredential.redeemSuccessAt,
                membershipOverrideStatus: '',
                membershipOverrideCheckedAt: '',
              });
              await saveProgress('subscription-check', email);
              await addLog(`UPI Free 分组识别 Plus：${email} -> 已确认 ${subscription.planType}，移入 Plus 组。`, 'ok');
              continue;
            }

            free.push({ email, planType: subscription.planType || 'free', reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'free',
              planType: subscription.planType || 'free',
              reason,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              upiRedeemSubscriptionCheckedAt: checkedAt,
              membershipOverrideStatus: 'free',
              membershipOverrideCheckedAt: checkedAt,
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Free 分组识别 Plus：${email} -> 仍为 Free：${reason}`, 'info');
          } catch (error) {
            if (isMembershipStopError(error)) {
              batchStopRequested = true;
              break;
            }
            const reason = getErrorMessage(error) || 'Plus 识别失败';
            failed.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'free',
              planType: 'free',
              reason: `Plus 识别失败：${reason}`,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              upiRedeemSubscriptionCheckedAt: checkedAt,
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Free 分组识别 Plus：${email} -> 失败：${reason}`, 'warn');
          }
        }

        const finishedAt = new Date().toISOString();
        const finalResults = await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: finishedAt,
          finishedAt: batchStopRequested ? currentResults.finishedAt : finishedAt,
          stoppedAt: batchStopRequested ? finishedAt : currentResults.stoppedAt,
          flowStage: batchStopRequested ? currentResults.flowStage : '',
          flowStageEmail: batchStopRequested ? currentResults.flowStageEmail : '',
          source,
          total: items.length,
          completed: items.length,
        });
        await addLog(
          batchStopRequested
            ? `UPI Free 分组识别 Plus：已停止，已处理 ${paid.length + free.length + failed.length + skipped.length}/${credentials.length}。`
            : `UPI Free 分组识别 Plus：完成，Plus ${paid.length}，仍 Free ${free.length}，跳过 ${skipped.length}，失败 ${failed.length}。`,
          batchStopRequested ? 'warn' : 'ok'
        );
        return {
          results: finalResults,
          paid,
          free,
          failed,
          skipped,
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
          source,
        }).catch(() => null);
        throw error;
      } finally {
        batchRunning = false;
      }
    }

    async function verifyUpiCredentialMembershipPlus(input = {}) {
      if (batchRunning) {
        throw new Error('UPI 备份账号会员核验正在运行，请等待完成或先停止。');
      }
      if (redeemRunning || cdkeyRetryRunning) {
        throw new Error('UPI Free 账号兑换/卡密重试正在运行，请等待完成或先停止。');
      }
      if (typeof checkUpiRedeemSubscriptionStatuses !== 'function') {
        throw new Error('UPI 会员状态查询能力尚未接入。');
      }

      batchRunning = true;
      batchStopRequested = false;
      const startedAt = new Date().toISOString();
      let currentResults = await getStoredResults();
      const requestedCredentials = resolveInputCredentials(input).filter((credential) => credential.email);
      let items = mergeCredentialsIntoResultItems(currentResults.items, requestedCredentials);
      const lookup = {};
      items.forEach((item) => {
        const email = normalizeEmail(item?.email);
        if (email) lookup[email] = item;
      });
      const rawCandidates = requestedCredentials.length
        ? requestedCredentials.map((credential) => ({ ...(lookup[normalizeEmail(credential.email)] || {}), ...credential }))
        : items;
      const credentials = rawCandidates
        .map((credential) => normalizeResultItem({ ...credential, status: credential.status || 'paid' }))
        .filter((credential) => credential.email && credential.status === 'paid' && credential.accessToken);
      const paid = [];
      const free = [];
      const failed = [];
      const skipped = [];
      const source = normalizeString(input.source || currentResults.source || 'plus-verify');

      const saveProgress = async (stage = 'subscription-check', email = '') => {
        currentResults = await saveResults({
          ...currentResults,
          items,
          running: true,
          updatedAt: new Date().toISOString(),
          flowStage: stage,
          flowStageEmail: normalizeEmail(email),
          source,
          total: credentials.length,
          completed: paid.length + free.length + failed.length + skipped.length,
        });
      };

      try {
        if (!credentials.length) {
          const finishedAt = new Date().toISOString();
          return {
            results: await saveResults({
              ...currentResults,
              items,
              running: false,
              updatedAt: finishedAt,
              finishedAt,
              flowStage: '',
              flowStageEmail: '',
              source,
            }),
            paid,
            free,
            failed,
            skipped,
          };
        }

        const runtimeState = normalizeSubscriptionRuntimeState({
          ...(typeof getState === 'function' ? await getState().catch(() => ({})) : {}),
          ...(input.settings || {}),
        });
        await addLog(`UPI Plus 分组验证：开始用已保存 AT 查询 ${credentials.length} 个账号。`, 'info');

        for (const credential of credentials) {
          throwIfMembershipStopRequested('check');
          const email = normalizeEmail(credential.email);
          const existingItem = items.find((item) => normalizeEmail(item?.email) === email) || {};
          const activeCredential = normalizeResultItem({
            ...existingItem,
            ...credential,
            email,
            status: 'paid',
            planType: credential.planType || existingItem.planType || 'plus',
          });
          const accessToken = normalizeString(activeCredential.accessToken);
          const checkedAt = new Date().toISOString();
          if (!accessToken) {
            const reason = '缺少 AT，无法验证 Plus。';
            skipped.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'paid',
              reason,
              upiRedeemSubscriptionCheckedAt: checkedAt,
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Plus 分组验证：${email} -> 跳过：${reason}`, 'warn');
            continue;
          }

          try {
            await saveProgress('subscription-check', email);
            const subscription = await checkCredentialPaidSubscription({
              state: {
                ...runtimeState,
                ...currentResults,
              },
              credential: activeCredential,
              accessToken,
              throwIfStopRequested: () => throwIfMembershipStopRequested('check'),
            });
            const reason = subscription.reason || '订阅 API 已返回会员状态';
            if (subscription.status === 'paid' && isPaidPlanType(subscription.planType)) {
              paid.push({ email, planType: subscription.planType, reason });
              items = upsertResultItem(items, {
                ...activeCredential,
                status: 'paid',
                planType: subscription.planType,
                reason,
                checkedAt,
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                accessTokenUpdatedAt: activeCredential.accessTokenUpdatedAt || checkedAt,
                upiRedeemSubscriptionCheckedAt: checkedAt,
                redeemStatus: activeCredential.redeemStatus,
                redeemReason: activeCredential.redeemReason,
                membershipOverrideStatus: '',
                membershipOverrideCheckedAt: '',
              });
              await saveProgress('subscription-check', email);
              await addLog(`UPI Plus 分组验证：${email} -> 已确认 ${subscription.planType}。`, 'ok');
              continue;
            }

            free.push({ email, planType: subscription.planType || 'free', reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'free',
              planType: subscription.planType || 'free',
              reason,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              accessTokenUpdatedAt: activeCredential.accessTokenUpdatedAt || checkedAt,
              upiRedeemSubscriptionCheckedAt: checkedAt,
              membershipOverrideStatus: 'free',
              membershipOverrideCheckedAt: checkedAt,
              redeemStatus: '',
              redeemReason: '',
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Plus 分组验证：${email} -> 当前不是 Plus，已移回 Free：${reason}`, 'warn');
          } catch (error) {
            if (isMembershipStopError(error)) {
              batchStopRequested = true;
              break;
            }
            const reason = getErrorMessage(error) || 'Plus 验证失败';
            failed.push({ email, reason });
            items = upsertResultItem(items, {
              ...activeCredential,
              status: 'paid',
              reason: `Plus 验证失败：${reason}`,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              upiRedeemSubscriptionCheckedAt: checkedAt,
            });
            await saveProgress('subscription-check', email);
            await addLog(`UPI Plus 分组验证：${email} -> 失败：${reason}`, 'warn');
          }
        }

        const finishedAt = new Date().toISOString();
        const finalResults = await saveResults({
          ...currentResults,
          items,
          running: false,
          updatedAt: finishedAt,
          finishedAt: batchStopRequested ? currentResults.finishedAt : finishedAt,
          stoppedAt: batchStopRequested ? finishedAt : currentResults.stoppedAt,
          flowStage: batchStopRequested ? currentResults.flowStage : '',
          flowStageEmail: batchStopRequested ? currentResults.flowStageEmail : '',
          source,
          total: items.length,
          completed: items.length,
        });
        await addLog(
          batchStopRequested
            ? `UPI Plus 分组验证：已停止，已处理 ${paid.length + free.length + failed.length + skipped.length}/${credentials.length}。`
            : `UPI Plus 分组验证：完成，仍 Plus ${paid.length}，转 Free ${free.length}，跳过 ${skipped.length}，失败 ${failed.length}。`,
          batchStopRequested ? 'warn' : 'ok'
        );
        return {
          results: finalResults,
          paid,
          free,
          failed,
          skipped,
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
          source,
        }).catch(() => null);
        throw error;
      } finally {
        batchRunning = false;
      }
    }

    async function retryFailedUpiRedeemCdkey(input = {}) {
      const summary = {
        ok: true,
        skipped: false,
        limit: 0,
        attempted: 0,
        submitted: 0,
        succeeded: 0,
        failed: 0,
        skippedCount: 0,
        items: [],
        updates: {},
      };

      if (batchRunning || redeemRunning || cdkeyRetryRunning) {
        const reason = 'UPI 备份账号核验/兑换正在运行，暂不继续失败账号兑换轮次。';
        await addLog(`UPI 失败账号兑换轮次：跳过：${reason}`, 'warn');
        return {
          ...summary,
          ok: false,
          skipped: true,
          reason,
        };
      }
      if (typeof redeemUpiCredentialWithAccessToken !== 'function') {
        throw new Error('UPI 失败账号兑换轮次能力尚未接入。');
      }

      const initialState = await getFreshUpiRedeemRuntimeState(input);
      const additionalRoundCount = normalizeRedeemAdditionalRoundCount(
        input.upiRedeemFailedAccountRetryLimit ?? getUpiRedeemStateValue(initialState, 'upiRedeemFailedAccountRetryLimit'),
        DEFAULT_UPI_REDEEM_FAILED_ACCOUNT_RETRY_LIMIT
      );
      const totalRoundLimit = getRedeemTotalRoundLimit(additionalRoundCount);
      summary.limit = totalRoundLimit;
      if (additionalRoundCount <= 0) {
        return {
          ...summary,
          skipped: true,
          reason: '兑换轮数为 0，刷新后不继续失败账号。',
        };
      }

      const startedAt = new Date().toISOString();
      let currentResults = normalizeResultsPayload(input.results || initialState?.[RESULTS_STORAGE_KEY] || await getStoredResults());
      let items = Array.isArray(currentResults.items) ? [...currentResults.items] : [];

      const targetEmail = normalizeEmail(input.email || input.accountEmail || input.credential?.email || '');
      const candidates = items
        .filter((item) => {
          const email = normalizeEmail(item?.email);
          if (!email || (targetEmail && email !== targetEmail)) {
            return false;
          }
          const status = normalizeString(item?.status).toLowerCase();
          const redeemStatus = normalizeString(item?.redeemStatus).toLowerCase();
          if (status !== 'free' || redeemStatus !== 'failed') {
            return false;
          }
          if (isPreSubmitUpiRedeemBlockedResultItem(item)) {
            return false;
          }
          const reason = normalizeString(item?.redeemReason || item?.reason);
          if (isNonRetryableUpiRedeemRetryError(reason)) {
            return false;
          }
          return isRetryableUpiRedeemRoundResultItem(item, totalRoundLimit);
        })
        .map((item) => normalizeResultItem(item));

      if (!candidates.length) {
        return {
          ...summary,
          skipped: true,
          reason: '没有可继续下一轮兑换的失败账号。',
        };
      }

      redeemRunning = true;
      redeemStopRequested = false;
      cdkeyRetryRunning = true;

      const saveRetryProgress = async (patch = {}) => {
        currentResults = await saveResults({
          ...currentResults,
          items,
          redeeming: true,
          redeemStartedAt: currentResults.redeemStartedAt || startedAt,
          redeemUpdatedAt: new Date().toISOString(),
          redeemTotal: Math.max(candidates.length, Math.floor(Number(currentResults.redeemTotal) || 0)),
          redeemCompleted: summary.attempted,
          flowStage: patch.flowStage || currentResults.flowStage,
          flowStageEmail: normalizeEmail(patch.email || currentResults.flowStageEmail),
          source: normalizeString(input.source || currentResults.source || 'upi-failed-account-auto-retry'),
        });
      };

      try {
        const firstRuntimeState = await getFreshUpiRedeemRuntimeState(input);
        const roundCdkeys = getAvailableUpiRedeemCdkeys(firstRuntimeState);
        const roundCdkeySet = new Set(roundCdkeys.map(normalizeString).filter(Boolean));
        if (!roundCdkeys.length) {
          const reason = '没有剩余可用 UPI 卡密，失败账号兑换轮次已停止。';
          const resumeReason = `${reason}导入新卡密后可手动一键兑换。`;
          const stoppedAt = new Date().toISOString();
          for (const candidate of candidates) {
            const email = normalizeEmail(candidate.email);
            const accessToken = normalizeString(candidate.accessToken);
            const previousFailureCount = normalizeRetryCount(candidate.redeemFailureCount) || 1;
            items = upsertResultItem(items, {
              ...candidate,
              status: 'free',
              planType: 'free',
              reason: resumeReason,
              checkedAt: candidate.checkedAt || stoppedAt,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              redeemStatus: '',
              redeemReason: resumeReason,
              redeemFailureCount: previousFailureCount,
              redeemFailureLimit: totalRoundLimit,
              redeemLastFailedAt: candidate.redeemLastFailedAt,
              lastFailedUpiRedeemCdkey: candidate.lastFailedUpiRedeemCdkey || candidate.upiRedeemCdkey,
              upiRedeemCdkey: '',
            });
            summary.skippedCount += 1;
            summary.items.push({ email, skipped: true, reason });
          }
          await saveRetryProgress({ flowStage: '', email: '' });
          await addLog(
            `UPI 失败账号兑换轮次：${reason}已暂停 ${candidates.length} 个失败账号；导入新卡密后可手动一键兑换。`,
            'warn'
          );
        } else {
          await addLog(
            `UPI 失败账号兑换轮次：找到 ${candidates.length} 个失败账号，当前卡密槽位 ${roundCdkeys.length} 个，总轮数 ${totalRoundLimit}；本次每个账号最多进入下一轮一次。`,
            'info'
          );
          for (const candidate of candidates) {
          throwIfMembershipStopRequested('redeem');
          const email = normalizeEmail(candidate.email);
          const accessToken = normalizeString(candidate.accessToken);
          const previousFailureCount = normalizeRetryCount(candidate.redeemFailureCount) || 1;
          const attemptNumber = previousFailureCount + 1;
          const roundLabel = getRedeemRoundLabel(attemptNumber, totalRoundLimit);

          const runtimeState = await getFreshUpiRedeemRuntimeState(input);
          const globalAvailableCdkeys = getAvailableUpiRedeemCdkeys(runtimeState);
          const availableCdkeys = globalAvailableCdkeys
            .filter((cdkey) => roundCdkeySet.has(normalizeString(cdkey)));
          if (!globalAvailableCdkeys.length) {
            const reason = '没有剩余可用 UPI 卡密，失败账号兑换轮次已停止。';
            summary.skippedCount += 1;
            items = upsertResultItem(items, {
              ...candidate,
              status: 'free',
              planType: 'free',
              reason: `${reason}导入新卡密后可手动一键兑换。`,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              redeemStatus: '',
              redeemReason: `${reason}导入新卡密后可手动一键兑换。`,
              redeemFailureCount: previousFailureCount,
              redeemFailureLimit: totalRoundLimit,
              redeemLastFailedAt: candidate.redeemLastFailedAt,
              lastFailedUpiRedeemCdkey: candidate.lastFailedUpiRedeemCdkey || candidate.upiRedeemCdkey,
              upiRedeemCdkey: '',
            });
            await saveRetryProgress({ flowStage: '', email: '' });
            summary.items.push({ email, skipped: true, reason });
            await addLog(`UPI 失败账号兑换轮次：${email} -> 跳过：${reason}`, 'warn');
            break;
          }
          if (!availableCdkeys.length) {
            const reason = '本轮卡密槽位已被成功/等待中的账号占满，剩余失败账号保持 Free。';
            await addLog(`UPI 失败账号兑换轮次：${email} -> ${reason}`, 'warn');
            break;
          }

          const selectedCdkey = pickRandomUpiRedeemCdkey(availableCdkeys);
          if (!selectedCdkey) {
            const reason = '兑换轮次未找到可提交卡密。';
            summary.skippedCount += 1;
            items = upsertResultItem(items, {
              ...candidate,
              status: 'free',
              planType: 'free',
              reason,
              redeemStatus: 'failed',
              redeemReason: reason,
              redeemFailureCount: previousFailureCount,
              redeemFailureLimit: totalRoundLimit,
              upiRedeemCdkey: candidate.upiRedeemCdkey,
            });
            await saveRetryProgress({ flowStage: 'upi-redeem-plus', email });
            summary.items.push({ email, skipped: true, reason });
            continue;
          }

          const redeemAttemptedAt = new Date().toISOString();
          items = upsertResultItem(items, {
            ...candidate,
            status: 'free',
            planType: 'free',
            checkedAt: redeemAttemptedAt,
            reason: `${roundLabel}：已绑定卡密，正在提交`,
            accessToken,
            accessTokenMasked: maskAccessToken(accessToken),
            redeemStatus: 'running',
            redeemReason: `${roundLabel}：${selectedCdkey}`,
            redeemAttemptedAt,
            redeemFailureLimit: totalRoundLimit,
            upiRedeemCdkey: selectedCdkey,
          });
          await saveRetryProgress({ flowStage: 'upi-redeem-plus', email });
          await addLog(`UPI 失败账号兑换轮次：${email} -> ${roundLabel} 随机选择卡密 ${selectedCdkey}。`, 'info');

          try {
            const redeemResult = await redeemUpiCredentialWithAccessToken({
              state: {
                ...runtimeState,
                ...currentResults,
                visibleStep: 7,
              },
              credential: candidate,
              session: { accessToken },
              accessToken,
              forceCdkey: selectedCdkey,
              skipEligibilityCheck: true,
              deferSubscriptionConfirmation: true,
            });

            if (redeemResult?.duplicateCdkeyRejected === true) {
              const reason = redeemResult.reason || '卡密重复提交，当前账号本轮结束，切换下一个账号。';
              const failureCount = Math.min(totalRoundLimit, previousFailureCount + 1);
              summary.attempted += 1;
              summary.failed += 1;
              items = upsertResultItem(items, {
                ...candidate,
                status: 'free',
                planType: 'free',
                reason: `${reason}（${getRedeemRoundLabel(failureCount, totalRoundLimit)}）`,
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                redeemStatus: 'failed',
                redeemReason: reason,
                redeemFailureCount: failureCount,
                redeemFailureLimit: totalRoundLimit,
                redeemLastFailedAt: new Date().toISOString(),
                redeemAttemptedAt,
                lastFailedUpiRedeemCdkey: selectedCdkey,
                upiRedeemCdkey: '',
              });
              await saveRetryProgress({ flowStage: 'upi-redeem-plus', email });
              await addLog(`UPI 失败账号兑换轮次：${email} -> ${selectedCdkey} 重复提交，本账号本轮结束，切换下一个账号。`, 'warn');
              summary.items.push({ email, cdkey: selectedCdkey, failed: true, reason });
              continue;
            }

            if (redeemResult?.pendingRemoteConfirmation === true) {
              summary.attempted += 1;
              summary.submitted += 1;
              items = upsertResultItem(items, {
                ...candidate,
                status: 'free',
                planType: 'free',
                reason: redeemResult.reason || '卡密已提交，等待远端系统返回最终结果',
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                redeemStatus: 'submitted',
                redeemReason: redeemResult.reason || `${roundLabel} 已提交，等待远端结果`,
                redeemAttemptedAt,
                redeemFailureCount: previousFailureCount,
                redeemFailureLimit: totalRoundLimit,
                redeemLastFailedAt: candidate.redeemLastFailedAt,
                upiRedeemCdkey: normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey || selectedCdkey),
              });
              await saveRetryProgress({ flowStage: 'upi-redeem-plus', email });
              await addLog(`UPI 失败账号兑换轮次：${email} -> ${selectedCdkey} 已提交，等待远端结果。`, 'ok');
              summary.items.push({ email, cdkey: selectedCdkey, submitted: true });
              continue;
            }

            const redeemedSubscription = classifyRedeemResult(redeemResult);
            if (redeemedSubscription.active && isPaidPlanType(redeemedSubscription.planType)) {
              const redeemSuccessAt = getRedeemResultSubscriptionCheckedAt(redeemResult) || new Date().toISOString();
              summary.attempted += 1;
              summary.succeeded += 1;
              items = upsertResultItem(items, {
                ...candidate,
                status: 'paid',
                planType: redeemedSubscription.planType,
                checkedAt: redeemSuccessAt,
                reason: redeemedSubscription.reason || `已开通 ${redeemedSubscription.planType}`,
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                redeemStatus: 'success',
                redeemReason: 'UPI 失败账号兑换轮次成功并已确认会员',
                redeemFailureCount: 0,
                redeemFailureLimit: totalRoundLimit,
                redeemLastFailedAt: '',
                redeemAttemptedAt,
                redeemSuccessAt,
                upiRedeemCdkey: normalizeString(redeemResult.cdkey || redeemResult.upiRedeemCdkey || selectedCdkey),
                upiRedeemSubscriptionCheckedAt: redeemSuccessAt,
                membershipOverrideStatus: '',
                membershipOverrideCheckedAt: '',
              });
              await saveRetryProgress({ flowStage: 'confirm-plus', email });
              await addLog(`UPI 失败账号兑换轮次：${email} -> ${selectedCdkey} 已确认 ${redeemedSubscription.planType}。`, 'ok');
              summary.items.push({ email, cdkey: selectedCdkey, succeeded: true });
              continue;
            }

            throw new Error(redeemedSubscription.reason || 'UPI 卡密已提交，但未确认 Plus/Pro/Team 会员。');
          } catch (error) {
            if (isMembershipStopError(error)) {
              throw error;
            }
            const reason = getErrorMessage(error) || '失败账号兑换轮次提交失败。';
            const failureCount = Math.min(totalRoundLimit, previousFailureCount + 1);
            summary.attempted += 1;
            summary.failed += 1;
            if (isUpiRedeemApiAuthError(error)) {
              redeemStopRequested = true;
              items = upsertResultItem(items, {
                ...candidate,
                status: 'free',
                planType: 'free',
                reason: 'UPI 远端接口拒绝请求，失败账号兑换轮次已停止',
                accessToken,
                accessTokenMasked: maskAccessToken(accessToken),
                redeemStatus: 'stopped',
                redeemReason: reason,
                redeemFailureCount: previousFailureCount,
                redeemFailureLimit: totalRoundLimit,
                redeemLastFailedAt: candidate.redeemLastFailedAt,
                redeemAttemptedAt,
                upiRedeemCdkey: selectedCdkey,
              });
              await saveRetryProgress({ flowStage: 'upi-redeem-plus', email });
              await addLog(`UPI 失败账号兑换轮次：远端接口拒绝请求，已停止在 ${email}，请检查 UPI Key 或后端权限：${reason}`, 'error');
              summary.items.push({ email, cdkey: selectedCdkey, failed: true, stopped: true, reason });
              break;
            }
            items = upsertResultItem(items, {
              ...candidate,
              status: 'free',
              planType: 'free',
              reason: `${reason}（${getRedeemRoundLabel(failureCount, totalRoundLimit)}）`,
              accessToken,
              accessTokenMasked: maskAccessToken(accessToken),
              redeemStatus: 'failed',
              redeemReason: reason,
              redeemFailureCount: failureCount,
              redeemFailureLimit: totalRoundLimit,
              redeemLastFailedAt: new Date().toISOString(),
              redeemAttemptedAt,
              lastFailedUpiRedeemCdkey: selectedCdkey,
              upiRedeemCdkey: '',
            });
            await saveRetryProgress({ flowStage: 'upi-redeem-plus', email });
            await addLog(`UPI 失败账号兑换轮次：${email} -> ${selectedCdkey} 失败，本账号本轮结束，切换下一个账号：${reason}`, 'warn');
            summary.items.push({ email, cdkey: selectedCdkey, failed: true, reason });
          }
        }
        }
      } finally {
        const finishedAt = new Date().toISOString();
        currentResults = await saveResults({
          ...currentResults,
          items,
          redeeming: false,
          redeemUpdatedAt: finishedAt,
          redeemFinishedAt: finishedAt,
          flowStage: '',
          flowStageEmail: '',
          source: normalizeString(input.source || currentResults.source || 'upi-failed-account-auto-retry'),
        });
        redeemRunning = false;
        cdkeyRetryRunning = false;
      }

      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      return {
        ...summary,
        ok: summary.failed === 0,
        retried: summary.attempted > 0,
        results: currentResults,
        updates: buildRetryUpdatesPayload(
          currentResults,
          normalizeUpiRedeemCdkeyUsage(getUpiRedeemStateValue(latestState, 'upiRedeemCdkeyUsage') || {})
        ),
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
              accessToken: session.accessToken,
              accessTokenMasked: maskAccessToken(session.accessToken),
              accessTokenUpdatedAt: checkedAt,
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
      const nextRedeemAutoDeletedEmails = (Array.isArray(currentResults.redeemAutoDeletedEmails)
        ? currentResults.redeemAutoDeletedEmails
        : []
      ).map(normalizeEmail).filter((email) => email && !importedEmails.has(email));
      const existingItems = (Array.isArray(currentResults.items) ? currentResults.items : [])
        .filter((item) => {
          const email = normalizeEmail(item?.email);
          return email && !importedEmails.has(email);
        });
      const importedItems = credentials.map((credential) => normalizeResultItem({
        ...credential,
        status: 'free',
        planType: 'free',
        checkedAt: credential.checkedAt || credential.accessTokenUpdatedAt || now,
        reason: '待兑换',
        redeemStatus: '',
        redeemReason: '',
        redeemFailureCount: 0,
        redeemLastFailedAt: '',
        membershipOverrideStatus: 'free',
        membershipOverrideCheckedAt: credential.checkedAt || credential.accessTokenUpdatedAt || now,
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
        redeemAutoDeletedEmails: nextRedeemAutoDeletedEmails,
        redeemAutoDeletedCount: nextRedeemAutoDeletedEmails.length,
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
          const statusMatches = status === 'free'
            ? item.status === 'free' || item.status === 'failed'
            : item.status === status;
          if (!statusMatches) return false;
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
      fillUpiCredentialMembershipFreeAccessTokens,
      getUpiCredentialMembershipCredentialPool,
      getUpiCredentialMembershipCheckResults: getStoredResults,
      identifyUpiCredentialMembershipFreePlus,
      importUpiCredentialMembershipFreeResults,
      loginUpiCredentialMembershipAccount,
      moveUpiCredentialMembershipAccountGroup,
      pruneIneligibleFreeUpiCredentialMembership,
      redeemUpiCredentialMembershipFree,
      retryFailedUpiRedeemCdkey,
      stopUpiCredentialMembershipCheck,
      stopUpiCredentialMembershipRedeem,
      upsertTrialEligibleFreeCredential,
      verifyUpiCredentialMembershipPlus,
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
