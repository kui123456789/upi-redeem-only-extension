// phone-sms/providers/hosted-sms.js - hosted phone verification SMS provider
(function attachHostedSmsProvider(root, factory) {
  const moduleValue = factory();
  root.PhoneSmsHostedSmsProvider = moduleValue;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleValue;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createHostedSmsProviderModule() {
  const PROVIDER_ID = 'hosted-sms';
  const PROVIDER_LABEL = '托管短信接口';
  const DEFAULT_SERVICE_CODE = 'openai';
  const DEFAULT_COUNTRY_ID = 'US';
  const DEFAULT_COUNTRY_LABEL = 'United States (+1)';
  const DEFAULT_POOL_ENTRY_MAX_USES = 3;
  const PHONE_CODE_TIMEOUT_ERROR_PREFIX = 'PHONE_CODE_TIMEOUT::';
  const TRUSTED_TEXT_KEYS = new Set([
    'sms',
    'message',
    'msg',
    'text',
    'content',
    'body',
    'code',
    'otp',
    'verification_code',
    'verificationcode',
  ]);
  const METADATA_KEY_PATTERN = /(?:phone|mobile|tel|order|request|task|activation|id|time|date|expire|expired|status|price|amount|balance|count|created|updated)/i;
  const CONTEXT_CODE_PATTERN = /(?:verification\s*code|security\s*code|one[-\s]*time\s*code|passcode|auth(?:entication)?\s*code|login\s*code|code|验证码|驗證碼|校验码|校驗碼)[^\d]{0,60}((?:\d[\s-]*){4,8})(?!\d)/i;
  const REVERSE_CONTEXT_CODE_PATTERN = /(^|[^\d])((?:\d[\s-]*){4,8})(?!\d)[^\n\r\d]{0,60}(?:verification\s*code|security\s*code|one[-\s]*time\s*code|passcode|auth(?:entication)?\s*code|login\s*code|code|验证码|驗證碼|校验码|校驗碼)/i;
  const DIRECT_CODE_PATTERN = /(^|[^\d])((?:\d[\s-]*){4,8})(?!\d)/g;

  function normalizeHostedSmsPhone(value = '') {
    const digits = String(value || '').replace(/\D+/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.slice(1);
    }
    return digits;
  }

  function isValidHostedSmsPhone(value = '') {
    return /^\d{10}$/.test(normalizeHostedSmsPhone(value));
  }

  function normalizeHostedSmsUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const url = new URL(raw);
      url.searchParams.delete('t');
      return url.toString();
    } catch {
      return raw
        .replace(/([?&])t=[^&#]*(?=&|#|$)/gi, '$1')
        .replace(/\?&/g, '?')
        .replace(/[?&](#|$)/, '$1')
        .trim();
    }
  }

  function buildHostedSmsPoolKey(phone, verificationUrl) {
    const normalizedPhone = normalizeHostedSmsPhone(phone);
    const normalizedUrl = normalizeHostedSmsUrl(verificationUrl);
    return normalizedPhone && normalizedUrl ? `${normalizedPhone}----${normalizedUrl}` : '';
  }

  function createHostedSmsPoolEntry(phone, verificationUrl, index = 0) {
    const normalizedPhone = normalizeHostedSmsPhone(phone);
    const normalizedUrl = normalizeHostedSmsUrl(verificationUrl);
    if (!/^\d{10}$/.test(normalizedPhone) || !normalizedUrl) {
      return null;
    }
    const key = buildHostedSmsPoolKey(normalizedPhone, normalizedUrl);
    if (!key) {
      return null;
    }
    return {
      key,
      index: Math.max(0, Math.floor(Number(index) || 0)),
      provider: PROVIDER_ID,
      phone: normalizedPhone,
      phoneNumber: normalizedPhone,
      verificationUrl: normalizedUrl,
      countryId: DEFAULT_COUNTRY_ID,
      countryLabel: DEFAULT_COUNTRY_LABEL,
      serviceCode: DEFAULT_SERVICE_CODE,
    };
  }

  function parseHostedSmsPoolEntries(text = '') {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
    const entries = [];
    const seen = new Set();
    let pendingPhone = '';

    const pushEntry = (phone, url) => {
      const entry = createHostedSmsPoolEntry(phone, url, entries.length);
      if (!entry || seen.has(entry.key)) {
        return;
      }
      seen.add(entry.key);
      entries.push(entry);
    };

    lines.forEach((line) => {
      const separatorIndex = line.indexOf('----');
      if (separatorIndex >= 0) {
        pushEntry(line.slice(0, separatorIndex), line.slice(separatorIndex + 4));
        pendingPhone = '';
        return;
      }
      if (isValidHostedSmsPhone(line)) {
        pendingPhone = normalizeHostedSmsPhone(line);
        return;
      }
      if (pendingPhone) {
        pushEntry(pendingPhone, line);
        pendingPhone = '';
      }
    });

    return entries;
  }

  function normalizeHostedSmsPoolUsage(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.entries(source).reduce((usage, [key, record]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || !record || typeof record !== 'object' || Array.isArray(record)) {
        return usage;
      }
      usage[normalizedKey] = {
        useCount: Math.max(0, Math.floor(Number(record.useCount) || 0)),
        usedAt: Math.max(0, Number(record.usedAt) || 0),
        lastAttemptAt: Math.max(0, Number(record.lastAttemptAt) || 0),
        lastSuccessAt: Math.max(0, Number(record.lastSuccessAt) || 0),
        lastCancelAt: Math.max(0, Number(record.lastCancelAt) || 0),
        lastBanAt: Math.max(0, Number(record.lastBanAt) || 0),
        ...(record.lastError ? { lastError: String(record.lastError || '').trim() } : {}),
      };
      return usage;
    }, {});
  }

  function normalizeHostedSmsPoolEntryMaxUses(value = DEFAULT_POOL_ENTRY_MAX_USES) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_POOL_ENTRY_MAX_USES;
    }
    return Math.max(1, parsed);
  }

  function chooseHostedSmsPoolEntry(entries = [], usage = {}, options = {}) {
    const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const blockedKeys = new Set([
      ...(Array.isArray(options.blockedKeys) ? options.blockedKeys : []),
      ...(Array.isArray(options.blockedActivationIds) ? options.blockedActivationIds : []),
      ...(Array.isArray(options.blockedHostedSmsPoolKeys) ? options.blockedHostedSmsPoolKeys : []),
    ].map((key) => String(key || '').trim()).filter(Boolean));
    const maxUses = normalizeHostedSmsPoolEntryMaxUses(options.maxUses ?? options.hostedSmsPoolEntryMaxUses);
    const normalizedUsage = normalizeHostedSmsPoolUsage(usage);
    const candidateEntries = normalizedEntries.filter((entry) => {
      const key = String(entry?.key || '').trim();
      if (!key || blockedKeys.has(key)) {
        return false;
      }
      const useCount = Math.max(0, Math.floor(Number(normalizedUsage[key]?.useCount) || 0));
      return useCount < maxUses;
    });
    if (!candidateEntries.length) {
      return null;
    }
    return [...candidateEntries].sort((left, right) => {
      const leftUsage = normalizedUsage[left.key] || {};
      const rightUsage = normalizedUsage[right.key] || {};
      const leftUseCount = Math.max(0, Math.floor(Number(leftUsage.useCount) || 0));
      const rightUseCount = Math.max(0, Math.floor(Number(rightUsage.useCount) || 0));
      if (leftUseCount !== rightUseCount) {
        return leftUseCount - rightUseCount;
      }
      const leftUsedAt = Math.max(0, Number(leftUsage.usedAt) || 0);
      const rightUsedAt = Math.max(0, Number(rightUsage.usedAt) || 0);
      if (leftUsedAt !== rightUsedAt) {
        return leftUsedAt - rightUsedAt;
      }
      return Math.max(0, Number(left.index) || 0) - Math.max(0, Number(right.index) || 0);
    })[0] || null;
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return '';
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  function describePayload(payload) {
    if (typeof payload === 'string') {
      return payload.trim();
    }
    if (payload && typeof payload === 'object') {
      try {
        return JSON.stringify(payload);
      } catch {
        return String(payload);
      }
    }
    return String(payload || '').trim();
  }

  function normalizeDigits(rawValue = '') {
    return String(rawValue || '').replace(/\D+/g, '');
  }

  function normalizeMatchedCode(rawValue = '') {
    const digits = normalizeDigits(rawValue);
    return /^\d{4,8}$/.test(digits) ? digits : '';
  }

  function extractContextualCode(text = '') {
    const rawText = String(text || '');
    if (!rawText.trim()) {
      return '';
    }
    const contextualMatch = rawText.match(CONTEXT_CODE_PATTERN);
    const contextualCode = normalizeMatchedCode(contextualMatch?.[1] || '');
    if (contextualCode) {
      return contextualCode;
    }
    const reverseMatch = rawText.match(REVERSE_CONTEXT_CODE_PATTERN);
    return normalizeMatchedCode(reverseMatch?.[2] || '');
  }

  function extractDirectCode(text = '') {
    const rawText = String(text || '');
    if (!rawText.trim()) {
      return '';
    }
    DIRECT_CODE_PATTERN.lastIndex = 0;
    let match = DIRECT_CODE_PATTERN.exec(rawText);
    while (match) {
      const rawCandidate = String(match[2] || '');
      if (!/[-/]/.test(rawCandidate)) {
        const code = normalizeMatchedCode(rawCandidate);
        if (code) {
          return code;
        }
      }
      match = DIRECT_CODE_PATTERN.exec(rawText);
    }
    return '';
  }

  function isTrustedTextKey(key = '') {
    return TRUSTED_TEXT_KEYS.has(String(key || '').trim().replace(/[-\s]+/g, '_').toLowerCase());
  }

  function isMetadataKey(key = '') {
    const normalized = String(key || '').trim().toLowerCase();
    return normalized && METADATA_KEY_PATTERN.test(normalized) && !isTrustedTextKey(normalized);
  }

  function collectCodeCandidates(payload, context = {}, candidates = []) {
    if (payload === null || payload === undefined) {
      return candidates;
    }
    if (typeof payload === 'string' || typeof payload === 'number') {
      const text = String(payload || '').trim();
      if (!text || isMetadataKey(context.key)) {
        return candidates;
      }
      const trusted = Boolean(context.trusted || isTrustedTextKey(context.key));
      const contextualCode = extractContextualCode(text);
      if (contextualCode) {
        candidates.push({ code: contextualCode, priority: trusted ? 0 : 1 });
      }
      if (trusted || context.root) {
        const directCode = extractDirectCode(text);
        if (directCode) {
          candidates.push({ code: directCode, priority: trusted ? 2 : 3 });
        }
      }
      return candidates;
    }
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectCodeCandidates(entry, context, candidates));
      return candidates;
    }
    if (typeof payload === 'object') {
      Object.entries(payload).forEach(([key, value]) => {
        const trusted = context.trusted || isTrustedTextKey(key);
        collectCodeCandidates(value, { key, trusted, root: false }, candidates);
      });
    }
    return candidates;
  }

  function extractHostedSmsVerificationCode(payload) {
    const parsed = typeof payload === 'string' ? parsePayload(payload) : payload;
    const candidates = collectCodeCandidates(parsed, { root: true }, []);
    if (!candidates.length && parsed !== payload) {
      candidates.push(...collectCodeCandidates(payload, { root: true }, []));
    }
    candidates.sort((left, right) => left.priority - right.priority);
    return candidates[0]?.code || '';
  }

  function buildCacheBustUrl(urlValue, now = Date.now()) {
    const normalizedUrl = normalizeHostedSmsUrl(urlValue);
    if (!normalizedUrl) {
      return '';
    }
    try {
      const url = new URL(normalizedUrl);
      url.searchParams.set('t', String(Math.max(0, Number(now) || Date.now())));
      return url.toString();
    } catch {
      const separator = normalizedUrl.includes('?') ? '&' : '?';
      return `${normalizedUrl}${separator}t=${Math.max(0, Number(now) || Date.now())}`;
    }
  }

  function normalizeActivation(record = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }
    const phoneNumber = normalizeHostedSmsPhone(record.phoneNumber || record.phone || record.number || '');
    const verificationUrl = normalizeHostedSmsUrl(record.verificationUrl || record.url || '');
    const activationId = String(record.activationId || record.id || record.key || buildHostedSmsPoolKey(phoneNumber, verificationUrl)).trim();
    if (!phoneNumber || !activationId || !verificationUrl) {
      return null;
    }
    return {
      activationId,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: String(record.serviceCode || DEFAULT_SERVICE_CODE).trim() || DEFAULT_SERVICE_CODE,
      countryId: DEFAULT_COUNTRY_ID,
      countryLabel: DEFAULT_COUNTRY_LABEL,
      verificationUrl,
      hostedSmsPoolKey: String(record.hostedSmsPoolKey || activationId).trim() || activationId,
      successfulUses: Math.max(0, Math.floor(Number(record.successfulUses) || 0)),
      maxUses: Math.max(1, Math.floor(Number(record.maxUses) || 1)),
    };
  }

  async function persistUsagePatch(deps = {}, state = {}, activation = {}, patch = {}) {
    if (typeof deps.setState !== 'function') {
      return;
    }
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      return;
    }
    const usage = normalizeHostedSmsPoolUsage(state?.hostedSmsPoolUsage || {});
    const key = normalizedActivation.hostedSmsPoolKey || normalizedActivation.activationId;
    usage[key] = {
      ...(usage[key] || { useCount: 0, usedAt: 0 }),
      ...patch,
    };
    await deps.setState({
      hostedSmsPoolUsage: usage,
      hostedSmsCurrentEntry: {
        key,
        phone: normalizedActivation.phoneNumber,
        phoneNumber: normalizedActivation.phoneNumber,
        verificationUrl: normalizedActivation.verificationUrl,
        countryId: DEFAULT_COUNTRY_ID,
        countryLabel: DEFAULT_COUNTRY_LABEL,
        ...usage[key],
      },
    });
  }

  async function requestActivation(state = {}, options = {}, deps = {}) {
    const entries = parseHostedSmsPoolEntries(state?.hostedSmsPoolText || '');
    if (!entries.length) {
      throw new Error('托管短信接口号码池为空，请在侧边栏接码设置中填写 phone----url。');
    }
    const usage = normalizeHostedSmsPoolUsage(state?.hostedSmsPoolUsage || {});
    const selected = chooseHostedSmsPoolEntry(entries, usage, options);
    if (!selected) {
      throw new Error('托管短信接口号码池没有可替换手机号。');
    }
    const now = Date.now();
    const nextUsage = {
      ...usage,
      [selected.key]: {
        ...(usage[selected.key] || {}),
        useCount: Math.max(0, Math.floor(Number(usage[selected.key]?.useCount) || 0)) + 1,
        usedAt: now,
        lastAttemptAt: now,
      },
    };
    const currentEntry = {
      ...selected,
      ...nextUsage[selected.key],
    };
    if (typeof deps.setState === 'function') {
      await deps.setState({
        hostedSmsPoolUsage: nextUsage,
        hostedSmsCurrentEntry: currentEntry,
      });
    }
    return {
      activationId: selected.key,
      hostedSmsPoolKey: selected.key,
      phoneNumber: selected.phone,
      provider: PROVIDER_ID,
      serviceCode: DEFAULT_SERVICE_CODE,
      countryId: DEFAULT_COUNTRY_ID,
      countryLabel: DEFAULT_COUNTRY_LABEL,
      verificationUrl: selected.verificationUrl,
      successfulUses: 0,
      maxUses: 1,
    };
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      throw new Error('缺少托管短信接口手机号记录。');
    }
    const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (typeof fetchImpl !== 'function') {
      throw new Error('托管短信接口网络请求实现不可用。');
    }
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let pollCount = 0;
    let lastResponse = '';

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) {
        break;
      }
      deps.throwIfStopped?.();
      const response = await fetchImpl(buildCacheBustUrl(normalizedActivation.verificationUrl), {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      const text = await response.text();
      const payload = parsePayload(text);
      lastResponse = describePayload(payload || text);
      pollCount += 1;
      if (!response.ok) {
        throw new Error(`托管短信接口请求失败：${lastResponse || response.status}`);
      }
      const code = extractHostedSmsVerificationCode(payload || text);
      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: code ? `CODE_RECEIVED:${code}` : (lastResponse || 'PENDING'),
          timeoutMs,
        });
      }
      if (code) {
        return code;
      }
      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: lastResponse || 'PENDING',
          timeoutMs,
        });
      }
      await (deps.sleepWithStop ? deps.sleepWithStop(intervalMs) : new Promise((resolve) => setTimeout(resolve, intervalMs)));
    }

    const suffix = lastResponse ? ` 托管短信接口最后响应：${lastResponse}` : '';
    throw new Error(`${PHONE_CODE_TIMEOUT_ERROR_PREFIX}等待手机验证码超时。${suffix}`);
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      fetchImpl: deps.fetchImpl,
      setState: deps.setState,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
    };
    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_CODE,
      normalizePhone: normalizeHostedSmsPhone,
      parsePoolEntries: parseHostedSmsPoolEntries,
      choosePoolEntry: chooseHostedSmsPoolEntry,
      normalizePoolUsage: normalizeHostedSmsPoolUsage,
      extractVerificationCode: extractHostedSmsVerificationCode,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      finishActivation: (state, activation) => persistUsagePatch(providerDeps, state, activation, { lastSuccessAt: Date.now(), lastError: '' }),
      cancelActivation: (state, activation) => persistUsagePatch(providerDeps, state, activation, { lastCancelAt: Date.now() }),
      banActivation: (state, activation) => persistUsagePatch(providerDeps, state, activation, { lastBanAt: Date.now(), lastError: 'banned' }),
      describePayload,
    };
  }

  return {
    PROVIDER_ID,
    PROVIDER_LABEL,
    DEFAULT_COUNTRY_ID,
    DEFAULT_COUNTRY_LABEL,
    DEFAULT_SERVICE_CODE,
    buildCacheBustUrl,
    buildHostedSmsPoolKey,
    chooseHostedSmsPoolEntry,
    createProvider,
    extractHostedSmsVerificationCode,
    normalizeHostedSmsPhone,
    normalizeHostedSmsPoolUsage,
    normalizeHostedSmsUrl,
    parseHostedSmsPoolEntries,
  };
});
