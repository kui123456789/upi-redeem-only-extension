(function attachNexSmsProvider(root, factory) {
  root.PhoneSmsNexSmsProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createNexSmsProviderModule() {
  const PROVIDER_ID = 'nexsms';
  const PROVIDER_LABEL = 'NexSMS';
  const DEFAULT_BASE_URL = 'https://api.nexsms.net';
  const DEFAULT_SERVICE_CODE = 'dr';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_ACTIVATION_RETRY_ROUNDS = 3;
  const DEFAULT_ACTIVATION_RETRY_DELAY_MS = 2000;
  const ACQUIRE_PRIORITY_COUNTRY = 'country';
  const ACQUIRE_PRIORITY_PRICE = 'price';
  const ACQUIRE_PRIORITY_PRICE_HIGH = 'price_high';
  const PHONE_CODE_TIMEOUT_ERROR_PREFIX = 'PHONE_CODE_TIMEOUT::';

  function normalizeCountryId(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    const fallbackParsed = Math.floor(Number(fallback));
    if (Number.isFinite(fallbackParsed) && fallbackParsed >= 0) {
      return fallbackParsed;
    }
    return 0;
  }

  function normalizeCountryLabel(value = '', fallback = '') {
    return String(value || '').trim() || fallback;
  }

  function normalizeCountryOrder(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[\r\n,，;；]+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const normalized = [];
    const seen = new Set();
    source.forEach((entry) => {
      const id = normalizeCountryId(
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry.id || entry.countryId || entry.country || '')
          : entry,
        -1
      );
      if (id < 0 || seen.has(id)) {
        return;
      }
      seen.add(id);
      normalized.push(id);
    });
    return normalized.slice(0, 10);
  }

  function resolveCountryCandidates(state = {}) {
    return normalizeCountryOrder(state?.nexSmsCountryOrder).map((id) => ({
      id,
      label: `Country #${id}`,
    }));
  }

  function normalizeServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    if (normalized && normalized !== 'ot' && normalized !== 'any') {
      return normalized;
    }
    const fallbackNormalized = String(fallback || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    return fallbackNormalized && fallbackNormalized !== 'ot' && fallbackNormalized !== 'any'
      ? fallbackNormalized
      : DEFAULT_SERVICE_CODE;
  }

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      return new URL(trimmed).toString().replace(/\/+$/, '');
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return '';
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  function describePayload(raw) {
    if (typeof raw === 'string') {
      return raw.trim();
    }
    if (raw && typeof raw === 'object') {
      const message = String(raw.message || raw.error || raw.msg || raw.statusText || '').trim();
      if (message) {
        return message;
      }
      try {
        return JSON.stringify(raw);
      } catch {
        return String(raw);
      }
    }
    return String(raw || '').trim();
  }

  function isSuccessPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }
    return Number(payload.code) === 0;
  }

  function normalizePrice(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    return Math.round(numeric * 10000) / 10000;
  }

  function normalizePriceLimit(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }
    return normalizePrice(value);
  }

  function isPriceWithinRange(price, minPriceLimit = null, maxPriceLimit = null) {
    const normalized = normalizePrice(price);
    if (normalized === null) {
      return false;
    }
    if (minPriceLimit !== null && normalized < minPriceLimit) {
      return false;
    }
    if (maxPriceLimit !== null && normalized > maxPriceLimit) {
      return false;
    }
    return true;
  }

  function filterPriceCandidatesWithinRange(prices = [], minPriceLimit = null, maxPriceLimit = null) {
    return (Array.isArray(prices) ? prices : []).filter((price) => (
      isPriceWithinRange(price, minPriceLimit, maxPriceLimit)
    ));
  }

  function buildSortedUniquePriceCandidates(values = []) {
    return Array.from(
      new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => normalizePrice(value))
          .filter((value) => value !== null)
      )
    ).sort((left, right) => left - right);
  }

  function normalizeAcquirePriority(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === ACQUIRE_PRIORITY_PRICE) {
      return ACQUIRE_PRIORITY_PRICE;
    }
    if (normalized === ACQUIRE_PRIORITY_PRICE_HIGH) {
      return ACQUIRE_PRIORITY_PRICE_HIGH;
    }
    return ACQUIRE_PRIORITY_COUNTRY;
  }

  function reorderPriceCandidates(prices = [], acquirePriority = ACQUIRE_PRIORITY_COUNTRY, preferredPrice = null) {
    const normalized = buildSortedUniquePriceCandidates(prices);
    const ordered = acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH
      ? normalized.reverse()
      : normalized;
    const preferred = normalizePrice(preferredPrice);
    if (preferred === null) {
      return ordered;
    }
    return [preferred, ...ordered.filter((value) => value !== preferred)];
  }

  function filterPriceCandidatesAboveFloor(prices = [], minExclusivePrice = null) {
    const floor = normalizePrice(minExclusivePrice);
    if (floor === null) {
      return Array.isArray(prices) ? [...prices] : [];
    }
    return (Array.isArray(prices) ? prices : []).filter((value) => {
      const numeric = normalizePrice(value);
      return numeric !== null && numeric > floor;
    });
  }

  function normalizeCountryPriceFloorMap(rawMap = {}, normalizeCountryKey) {
    const normalizedMap = new Map();
    if (!rawMap || typeof rawMap !== 'object') {
      return normalizedMap;
    }
    Object.entries(rawMap).forEach(([rawCountryKey, rawPrice]) => {
      const countryKey = String(
        typeof normalizeCountryKey === 'function'
          ? normalizeCountryKey(rawCountryKey)
          : rawCountryKey
      ).trim();
      const normalizedPrice = normalizePrice(rawPrice);
      if (!countryKey || normalizedPrice === null) {
        return;
      }
      normalizedMap.set(countryKey, normalizedPrice);
    });
    return normalizedMap;
  }

  function formatPriceRangeText(minPriceLimit = null, maxPriceLimit = null) {
    if (minPriceLimit !== null && maxPriceLimit !== null) {
      return `${minPriceLimit}~${maxPriceLimit}`;
    }
    if (minPriceLimit !== null) {
      return `${minPriceLimit}~`;
    }
    if (maxPriceLimit !== null) {
      return `~${maxPriceLimit}`;
    }
    return 'unbounded';
  }

  function normalizeRetryRounds(value) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ACTIVATION_RETRY_ROUNDS;
    }
    return Math.max(1, Math.min(10, parsed));
  }

  function normalizeRetryDelayMs(value) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ACTIVATION_RETRY_DELAY_MS;
    }
    return Math.max(500, Math.min(30000, parsed));
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: String(state.nexSmsApiKey || state.heroSmsApiKey || '').trim(),
      baseUrl: normalizeBaseUrl(state.nexSmsBaseUrl || DEFAULT_BASE_URL),
      serviceCode: normalizeServiceCode(state.nexSmsServiceCode, DEFAULT_SERVICE_CODE),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  async function fetchPayload(config, path, actionLabel, options = {}) {
    if (!config.apiKey) {
      throw new Error('NexSMS API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    if (typeof config.fetchImpl !== 'function') {
      throw new Error('NexSMS 网络请求实现不可用。');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;
    try {
      const method = String(options.method || 'GET').trim().toUpperCase() || 'GET';
      const requestUrl = new URL(path.replace(/^\/+/, ''), `${config.baseUrl.replace(/\/+$/, '')}/`);
      requestUrl.searchParams.set('apiKey', config.apiKey);
      const query = options?.query && typeof options.query === 'object' ? options.query : {};
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        requestUrl.searchParams.set(key, String(value));
      });
      const headers = {
        Accept: 'application/json',
        ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
      };
      const requestInit = {
        method,
        headers,
        signal: controller?.signal,
      };
      if (method !== 'GET' && method !== 'HEAD' && options.body !== undefined) {
        requestInit.body = typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
        if (!requestInit.headers['Content-Type']) {
          requestInit.headers['Content-Type'] = 'application/json';
        }
      }
      const response = await config.fetchImpl(requestUrl.toString(), requestInit);
      const text = await response.text();
      const payload = parsePayload(text);
      if (!response.ok) {
        const error = new Error(`${actionLabel}失败：${describePayload(payload) || response.status}`);
        error.payload = payload;
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${actionLabel}超时。`);
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  function isNoNumbersError(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /numbers?\s+not\s+found|暂无可用|no\s+numbers|no\s+stock|库存.*0|not\s+available/i.test(text);
  }

  function isPendingMessage(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /no\s+sms|暂无短信|waiting|not\s+arrived|empty|未收到|短信为空|no\s+records/i.test(text);
  }

  function isTerminalError(payloadOrMessage, status = 0) {
    if (Number(status) === 401 || Number(status) === 403) {
      return true;
    }
    const text = describePayload(payloadOrMessage);
    return /invalid\s*api\s*key|bad[_\s-]*key|wrong[_\s-]*key|unauthorized|forbidden|no\s*balance|insufficient\s*balance|余额不足|账号.*封禁|banned/i.test(text);
  }

  function collectPriceCandidates(countryData = {}) {
    const candidates = [];
    const pushCandidate = (value) => {
      const normalized = normalizePrice(value);
      if (normalized !== null) {
        candidates.push(normalized);
      }
    };

    pushCandidate(countryData.minPrice);
    pushCandidate(countryData.medianPrice);
    pushCandidate(countryData.maxPrice);

    if (countryData.priceMap && typeof countryData.priceMap === 'object') {
      Object.entries(countryData.priceMap).forEach(([priceKey, count]) => {
        const availableCount = Number(count);
        if (!Number.isFinite(availableCount) || availableCount <= 0) {
          return;
        }
        pushCandidate(priceKey);
      });
    }

    return buildSortedUniquePriceCandidates(candidates);
  }

  async function resolveCountryPricePlan(config, countryConfig, state = {}) {
    const countryId = normalizeCountryId(countryConfig?.id, -1);
    if (countryId < 0) {
      throw new Error(`NexSMS 国家 ID 无效：${countryConfig?.id}`);
    }
    const payload = await fetchPayload(
      config,
      '/api/getCountryByService',
      'NexSMS getCountryByService',
      {
        query: {
          serviceCode: config.serviceCode,
          countryId,
        },
      }
    );
    if (!isSuccessPayload(payload)) {
      const error = new Error(`NexSMS getCountryByService失败：${describePayload(payload) || 'empty response'}`);
      error.payload = payload;
      throw error;
    }
    const countryData = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload.data || {})
      : {};
    const countryLabel = normalizeCountryLabel(
      countryData.countryName || countryConfig?.label,
      `Country #${countryId}`
    );
    const prices = collectPriceCandidates(countryData);
    const minCatalogPrice = prices.length
      ? prices[0]
      : normalizePrice(countryData.minPrice);
    const userLimit = normalizePriceLimit(state?.heroSmsMaxPrice);
    const filteredPrices = userLimit === null
      ? prices
      : prices.filter((price) => price <= userLimit);

    return {
      countryId,
      countryLabel,
      prices: filteredPrices,
      userLimit,
      minCatalogPrice,
      rawPayload: payload,
    };
  }

  function normalizeActivation(record, fallback = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }
    const data = record.data || {};
    const phoneCandidates = Array.isArray(data.phoneNumbers)
      ? data.phoneNumbers
      : (Array.isArray(data.numbers) ? data.numbers : []);
    const phoneNumber = String(
      data.phoneNumber
      || data.phone
      || phoneCandidates[0]
      || fallback.phoneNumber
      || ''
    ).trim();
    if (!phoneNumber) {
      return null;
    }
    const countryId = normalizeCountryId(data.countryId ?? fallback.countryId, 0);
    const countryLabel = normalizeCountryLabel(
      data.countryName || fallback.countryLabel,
      `Country #${countryId}`
    );
    return {
      activationId: phoneNumber,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: normalizeServiceCode(
        data.serviceCode || fallback.serviceCode || DEFAULT_SERVICE_CODE,
        DEFAULT_SERVICE_CODE
      ),
      countryId,
      countryLabel,
      successfulUses: Math.max(0, Math.floor(Number(fallback.successfulUses) || 0)),
      maxUses: 1,
    };
  }

  async function requestActivation(state = {}, options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const allCountryCandidates = resolveCountryCandidates(state);
    if (!allCountryCandidates.length) {
      throw new Error('步骤 9：NexSMS 未选择国家，请先在接码设置中至少选择 1 个国家。');
    }

    const blockedCountryIds = new Set(
      (Array.isArray(options?.blockedCountryIds) ? options.blockedCountryIds : [])
        .map((value) => normalizeCountryId(value, -1))
        .filter((id) => id >= 0)
    );
    let countryCandidates = allCountryCandidates.filter((entry) => {
      const id = normalizeCountryId(entry.id, -1);
      return id >= 0 && !blockedCountryIds.has(id);
    });
    if (!countryCandidates.length) {
      countryCandidates = allCountryCandidates;
      if (blockedCountryIds.size && typeof deps.addLog === 'function') {
        await deps.addLog(
          '步骤 9：已选国家均达到临时收码失败跳过阈值，本轮解除跳过并重新尝试。',
          'warn'
        );
      }
    }

    const acquirePriority = normalizeAcquirePriority(state?.heroSmsAcquirePriority);
    const minPriceLimit = normalizePriceLimit(state?.heroSmsMinPrice);
    const maxPriceLimit = normalizePriceLimit(state?.heroSmsMaxPrice);
    const hasPriceBounds = minPriceLimit !== null || maxPriceLimit !== null;
    if (minPriceLimit !== null && maxPriceLimit !== null && minPriceLimit > maxPriceLimit) {
      throw new Error(`NexSMS 价格区间无效：最低购买价 ${minPriceLimit} 高于价格上限 ${maxPriceLimit}。`);
    }
    const preferredPriceTier = normalizePriceLimit(state?.heroSmsPreferredPrice);
    const countryPriceFloorByCountryId = normalizeCountryPriceFloorMap(
      options?.countryPriceFloorByCountryId,
      (value) => String(normalizeCountryId(value, -1))
    );
    const maxAcquireRounds = Math.max(2, normalizeRetryRounds(state?.heroSmsActivationRetryRounds));
    const retryDelayMs = normalizeRetryDelayMs(state?.heroSmsActivationRetryDelayMs);
    let finalNoNumbersByCountry = [];
    let finalLastError = null;

    for (let round = 1; round <= maxAcquireRounds; round += 1) {
      if (maxAcquireRounds > 1 && typeof deps.addLog === 'function') {
        await deps.addLog(`步骤 9：NexSMS 正在获取手机号（第 ${round}/${maxAcquireRounds} 轮）...`, 'info');
      }

      const candidateAttempts = countryCandidates.map((countryConfig, index) => ({
        index,
        countryConfig,
        pricePlan: null,
        orderingPrice: Number.POSITIVE_INFINITY,
      }));

      if (
        (acquirePriority === ACQUIRE_PRIORITY_PRICE || acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH)
        && candidateAttempts.length > 1
      ) {
        for (const attempt of candidateAttempts) {
          try {
            const pricePlan = await resolveCountryPricePlan(config, attempt.countryConfig, state);
            attempt.pricePlan = pricePlan;
            const orderedForRanking = reorderPriceCandidates(pricePlan.prices, acquirePriority, preferredPriceTier);
            const rangeFilteredForRanking = filterPriceCandidatesWithinRange(
              orderedForRanking,
              minPriceLimit,
              maxPriceLimit
            );
            const rankingPrices = rangeFilteredForRanking.length
              ? rangeFilteredForRanking
              : (hasPriceBounds ? [] : orderedForRanking);
            attempt.orderingPrice = rankingPrices.length
              ? Number(rankingPrices[0])
              : Number.POSITIVE_INFINITY;
          } catch (error) {
            attempt.pricePlan = null;
            attempt.orderingPrice = Number.POSITIVE_INFINITY;
            attempt.lookupError = error;
          }
        }

        candidateAttempts.sort((left, right) => {
          if (left.orderingPrice !== right.orderingPrice) {
            return acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH
              ? (right.orderingPrice - left.orderingPrice)
              : (left.orderingPrice - right.orderingPrice);
          }
          return left.index - right.index;
        });

        if (typeof deps.addLog === 'function') {
          const rankingSummary = candidateAttempts.map((attempt) => {
            const id = normalizeCountryId(attempt.countryConfig.id, -1);
            const label = normalizeCountryLabel(attempt.countryConfig.label, `Country #${id}`);
            return Number.isFinite(attempt.orderingPrice)
              ? `${label}:${attempt.orderingPrice}`
              : `${label}:无`;
          }).join(' | ');
          await deps.addLog(`步骤 9：NexSMS 价格优先排序：${rankingSummary}`, 'info');
        }
      }

      const noNumbersByCountry = [];
      const retryableNoNumberCountries = [];
      let lastError = null;

      for (const attempt of candidateAttempts) {
        const countryId = normalizeCountryId(attempt.countryConfig.id, -1);
        const countryLabel = normalizeCountryLabel(attempt.countryConfig.label, `Country #${countryId}`);
        const countryPriceFloor = countryPriceFloorByCountryId.get(String(countryId)) ?? null;
        let pricePlan = attempt.pricePlan;

        if (!pricePlan) {
          try {
            pricePlan = await resolveCountryPricePlan(config, attempt.countryConfig, state);
          } catch (error) {
            if (isTerminalError(error?.payload || error?.message, error?.status)) {
              throw error;
            }
            lastError = error;
            continue;
          }
        }

        if (!Array.isArray(pricePlan.prices) || !pricePlan.prices.length) {
          if (
            pricePlan.userLimit !== null
            && pricePlan.minCatalogPrice !== null
            && pricePlan.minCatalogPrice > pricePlan.userLimit
          ) {
            noNumbersByCountry.push(
              `${countryLabel}: 价格上限 ${pricePlan.userLimit} 内暂无可用号码；平台最低价=${pricePlan.minCatalogPrice}`
            );
          } else {
            const reason = describePayload(pricePlan.rawPayload) || '无可用价格档位';
            noNumbersByCountry.push(`${countryLabel}: ${reason}`);
            retryableNoNumberCountries.push(countryLabel);
          }
          continue;
        }

        const orderedPrices = reorderPriceCandidates(pricePlan.prices, acquirePriority, preferredPriceTier);
        const rangeFilteredPrices = filterPriceCandidatesWithinRange(
          orderedPrices,
          minPriceLimit,
          maxPriceLimit
        );
        const candidatePrices = rangeFilteredPrices.length
          ? rangeFilteredPrices
          : (hasPriceBounds ? [] : orderedPrices);
        const floorFilteredPrices = filterPriceCandidatesAboveFloor(candidatePrices, countryPriceFloor);
        const hasCountryPriceFloor = countryPriceFloor !== null;
        const hasAlternativeCountries = candidateAttempts.some((entry) => (
          normalizeCountryId(entry?.countryConfig?.id, -1) !== countryId
        ));
        const pricesToTry = hasCountryPriceFloor
          ? (
            floorFilteredPrices.length
              ? floorFilteredPrices
              : (hasAlternativeCountries ? [] : candidatePrices.slice(0, 1))
          )
          : (floorFilteredPrices.length ? floorFilteredPrices : candidatePrices);

        if (!pricesToTry.length) {
          if (minPriceLimit !== null && !rangeFilteredPrices.length) {
            noNumbersByCountry.push(
              `${countryLabel}: 价格区间 ${formatPriceRangeText(minPriceLimit, maxPriceLimit)} 内暂无可用号码`
            );
          } else if (countryPriceFloor !== null && pricePlan.prices.length > 0) {
            noNumbersByCountry.push(`${countryLabel}: 当前回退尝试没有高于 ${countryPriceFloor} 的价格档位`);
          } else {
            noNumbersByCountry.push(`${countryLabel}: ${describePayload(pricePlan.rawPayload) || '暂无可用号码'}`);
            retryableNoNumberCountries.push(countryLabel);
          }
          continue;
        }

        for (const price of pricesToTry) {
          try {
            const payload = await fetchPayload(
              config,
              '/api/order/purchase',
              'NexSMS purchase',
              {
                method: 'POST',
                body: {
                  serviceCode: config.serviceCode,
                  countryId,
                  quantity: 1,
                  price,
                },
              }
            );
            if (!isSuccessPayload(payload)) {
              if (isNoNumbersError(payload)) {
                continue;
              }
              if (isTerminalError(payload)) {
                throw Object.assign(new Error(describePayload(payload) || 'empty response'), { payload });
              }
              lastError = Object.assign(new Error(describePayload(payload) || 'empty response'), { payload });
              continue;
            }
            const activation = normalizeActivation(payload, {
              countryId,
              countryLabel,
              serviceCode: config.serviceCode,
            });
            if (!activation) {
              lastError = new Error('NexSMS 购买成功，但未返回手机号。');
              continue;
            }
            if (typeof deps.rememberActivationAcquiredPrice === 'function') {
              deps.rememberActivationAcquiredPrice(activation, Number(price));
            }
            return activation;
          } catch (error) {
            if (isTerminalError(error?.payload || error?.message, error?.status)) {
              throw error;
            }
            if (isNoNumbersError(error?.payload || error?.message)) {
              continue;
            }
            lastError = error;
          }
        }

        const fallbackReason = describePayload(pricePlan.rawPayload) || '暂无可用号码';
        noNumbersByCountry.push(`${countryLabel}: ${fallbackReason}`);
        retryableNoNumberCountries.push(countryLabel);
      }

      finalNoNumbersByCountry = noNumbersByCountry;
      finalLastError = lastError;

      if (
        noNumbersByCountry.length
        && round < maxAcquireRounds
        && retryableNoNumberCountries.length > 0
      ) {
        if (typeof deps.addLog === 'function') {
          await deps.addLog(
            `步骤 9：NexSMS 暂无可用号码（第 ${round}/${maxAcquireRounds} 轮）；${Math.ceil(retryDelayMs / 1000)} 秒后重试。国家：${retryableNoNumberCountries.join(', ')}。`,
            'warn'
          );
        }
        await deps.sleepWithStop?.(retryDelayMs);
        continue;
      }

      break;
    }

    if (finalNoNumbersByCountry.length) {
      throw new Error(
        `NexSMS 已尝试 ${countryCandidates.length} 个候选国家，均无可用号码：${finalNoNumbersByCountry.join(' | ')}。`
      );
    }
    if (finalLastError) {
      throw finalLastError;
    }
    throw new Error('NexSMS 获取手机号失败。');
  }

  async function reuseActivation() {
    throw new Error('NexSMS 当前流程不支持复用手机号订单。');
  }

  async function finishActivation() {
    return 'NexSMS complete skipped';
  }

  async function cancelActivation(state = {}, activation = null, deps = {}) {
    const normalizedActivation = activation && typeof activation === 'object'
      ? activation
      : null;
    if (!normalizedActivation?.phoneNumber) {
      return '';
    }
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(
      config,
      '/api/close/activation',
      'NexSMS close activation',
      {
        method: 'POST',
        body: {
          phoneNumber: normalizedActivation.phoneNumber,
        },
      }
    );
    if (!isSuccessPayload(payload)) {
      const error = new Error(`NexSMS close activation失败：${describePayload(payload) || 'empty response'}`);
      error.payload = payload;
      throw error;
    }
    return describePayload(payload);
  }

  async function banActivation(state = {}, activation = null, deps = {}) {
    return cancelActivation(state, activation, deps);
  }

  function extractVerificationCode(rawCodeOrText) {
    const trimmed = String(rawCodeOrText || '').trim();
    if (!trimmed) {
      return '';
    }
    const digitMatch = trimmed.match(/\b(\d{4,8})\b/);
    return digitMatch?.[1] || '';
  }

  function buildPhoneCodeTimeoutError(lastResponse = '') {
    const suffix = lastResponse ? ` NexSMS 最后状态：${lastResponse}` : '';
    return new Error(`${PHONE_CODE_TIMEOUT_ERROR_PREFIX}等待手机验证码超时。${suffix}`);
  }

  async function pollActivationCode(state = {}, activation = null, options = {}, deps = {}) {
    const normalizedActivation = activation && typeof activation === 'object'
      ? activation
      : null;
    if (!normalizedActivation?.phoneNumber) {
      throw new Error('缺少手机号接码订单。');
    }
    const config = resolveConfig(state, deps);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let lastResponse = '';
    let pollCount = 0;

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) {
        break;
      }
      deps.throwIfStopped?.();
      const payload = await fetchPayload(
        config,
        '/api/sms/messages',
        'NexSMS get sms messages',
        {
          query: {
            phoneNumber: normalizedActivation.phoneNumber,
            format: 'json_latest',
          },
        }
      );
      const text = describePayload(payload);
      lastResponse = text;
      pollCount += 1;

      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: text || 'PENDING',
          timeoutMs,
        });
      }

      if (isSuccessPayload(payload)) {
        const directCode = extractVerificationCode(payload?.data?.code || payload?.data?.text || '');
        if (directCode) {
          return directCode;
        }
        if (typeof options.onWaitingForCode === 'function') {
          await options.onWaitingForCode({
            activation: normalizedActivation,
            elapsedMs: Date.now() - start,
            pollCount,
            statusText: text || 'PENDING',
            timeoutMs,
          });
        }
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }

      if (isPendingMessage(payload)) {
        if (typeof options.onWaitingForCode === 'function') {
          await options.onWaitingForCode({
            activation: normalizedActivation,
            elapsedMs: Date.now() - start,
            pollCount,
            statusText: text || 'PENDING',
            timeoutMs,
          });
        }
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }

      if (isTerminalError(payload)) {
        const error = new Error(`NexSMS get sms messages失败：${text || 'unknown terminal error'}`);
        error.payload = payload;
        throw error;
      }

      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: text || 'PENDING',
          timeoutMs,
        });
      }
      await deps.sleepWithStop?.(intervalMs);
    }

    throw buildPhoneCodeTimeoutError(lastResponse);
  }

  async function fetchBalance() {
    throw new Error('NexSMS 暂未实现余额查询接口。');
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      addLog: deps.addLog || (async () => {}),
      fetchImpl: deps.fetchImpl,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
      sleepWithStop: deps.sleepWithStop || (async () => {}),
      throwIfStopped: deps.throwIfStopped || (() => {}),
      rememberActivationAcquiredPrice: deps.rememberActivationAcquiredPrice || null,
    };
    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId,
      normalizeCountryLabel,
      normalizeCountryOrder,
      normalizeServiceCode,
      resolveCountryCandidates,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: (state, activation) => finishActivation(state, activation, providerDeps),
      cancelActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      banActivation: (state, activation) => banActivation(state, activation, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      describePayload,
      isSuccessPayload,
      isNoNumbersError,
      isPendingMessage,
      isTerminalError,
      extractVerificationCode,
    };
  }

  return {
    PROVIDER_ID,
    PROVIDER_LABEL,
    DEFAULT_BASE_URL,
    DEFAULT_SERVICE_CODE,
    createProvider,
    normalizeCountryId,
    normalizeCountryLabel,
    normalizeCountryOrder,
    normalizeServiceCode,
  };
});
