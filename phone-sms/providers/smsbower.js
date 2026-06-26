// phone-sms/providers/smsbower.js - SMSBower 接码平台适配层
(function attachSmsBowerProvider(root, factory) {
  const moduleValue = factory();
  root.PhoneSmsBowerProvider = moduleValue;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleValue;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createSmsBowerProviderModule() {
  const PROVIDER_ID = 'smsbower';
  const DEFAULT_BASE_URL = 'https://smsbower.page/stubs/handler_api.php';
  const DEFAULT_SERVICE_CODE = 'dr';
  const DEFAULT_SERVICE_LABEL = 'OpenAI';
  const DEFAULT_COUNTRY_ID = 52;
  const DEFAULT_COUNTRY_LABEL = '泰国 +66 (Thailand)';
  const DEFAULT_COUNTRY_ORDER = Object.freeze([52, 55, 12, 187, 182, 204, 36, 78, 91, 19, 38, 7]);
  const SUPPORTED_COUNTRY_ITEMS = Object.freeze([
    { id: 52, label: '泰国 +66 (Thailand)', phonePrefix: '66', searchText: '52 TH Thailand 泰国 +66' },
    { id: 55, label: '台湾 +886 (Taiwan)', phonePrefix: '886', searchText: '55 TW Taiwan 台湾 +886' },
    { id: 12, label: '美国 +1 (United States)', phonePrefix: '1', searchText: '12 US USA United States 美国 +1 实体' },
    { id: 187, label: '美国虚拟 +1 (United States Virtual)', phonePrefix: '1', searchText: '187 US USA United States Virtual 美国虚拟 +1' },
    { id: 182, label: '日本 +81 (Japan)', phonePrefix: '81', searchText: '182 JP Japan 日本 +81' },
    { id: 204, label: '纽埃 +683 (Niue)', phonePrefix: '683', searchText: '204 NU Niue 纽埃 +683' },
    { id: 36, label: '加拿大 +1 (Canada)', phonePrefix: '1', searchText: '36 CA Canada 加拿大 +1' },
    { id: 78, label: '法国 +33 (France)', phonePrefix: '33', searchText: '78 FR France 法国 +33' },
    { id: 91, label: '东帝汶 +670 (Timor-Leste)', phonePrefix: '670', searchText: '91 TL Timor-Leste East Timor 东帝汶 +670' },
    { id: 19, label: '尼日利亚 +234 (Nigeria)', phonePrefix: '234', searchText: '19 NG Nigeria 尼日利亚 +234' },
    { id: 7, label: '马来西亚 +60 (Malaysia)', phonePrefix: '60', searchText: '7 MY Malaysia 马来西亚 +60' },
    { id: 38, label: '加纳 +233 (Ghana)', phonePrefix: '233', searchText: '38 GH Ghana 加纳 +233' },
    { id: 6, label: '印度尼西亚 +62 (Indonesia)', phonePrefix: '62', searchText: '6 ID Indonesia 印度尼西亚 +62' },
    { id: 10, label: '越南 +84 (Vietnam)', phonePrefix: '84', searchText: '10 VN Vietnam 越南 +84' },
  ]);
  const KNOWN_DIAL_PREFIXES = Object.freeze([
    '1246', '1264', '1268', '1284', '1340', '1345', '1441', '1473', '1649', '1664', '1670', '1671', '1684',
    '1721', '1758', '1767', '1784', '1809', '1829', '1849', '1868', '1869', '1876',
    '971', '962', '886', '880', '856', '855', '852', '853', '683', '678', '673', '672', '670', '599', '598', '597', '596',
    '595', '594', '593', '592', '591', '590', '509', '508', '507', '506', '505', '504', '503', '502', '501', '500',
    '423', '421', '420', '389', '387', '386', '385', '383', '382', '381', '380', '379', '378', '377', '376',
    '375', '374', '373', '372', '371', '370', '359', '358', '357', '356', '355', '354', '353', '352', '351',
    '350', '299', '298', '297', '291', '290', '269', '268', '267', '266', '265', '264', '263', '262', '261',
    '260', '258', '257', '256', '255', '254', '253', '252', '251', '250', '249', '248', '247', '246', '245',
    '244', '243', '242', '241', '240', '239', '238', '237', '236', '235', '234', '233', '232', '231', '230',
    '229', '228', '227', '226', '225', '224', '223', '222', '221', '220', '218', '216', '213', '212', '211',
    '98', '95', '94', '93', '92', '91', '90', '89', '88', '86', '84', '82', '81', '66', '65', '64', '63',
    '62', '61', '60', '58', '57', '56', '55', '54', '53', '52', '51', '49', '48', '47', '46', '45', '44',
    '43', '41', '40', '39', '36', '34', '33', '32', '31', '30', '27', '20', '7', '1',
  ]);
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_LANG = '';
  const DEFAULT_PRICES_ACTION = 'getPricesV3';

  function normalizeSmsBowerCountryId(value, fallback = DEFAULT_COUNTRY_ID) {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const fallbackParsed = Math.floor(Number(fallback));
    return Number.isFinite(fallbackParsed) && fallbackParsed > 0 ? fallbackParsed : DEFAULT_COUNTRY_ID;
  }

  function getSupportedCountryById(id) {
    const normalizedId = normalizeSmsBowerCountryId(id, 0);
    return SUPPORTED_COUNTRY_ITEMS.find((entry) => entry.id === normalizedId) || null;
  }

  function normalizeSmsBowerCountryLabel(value = '', fallback = DEFAULT_COUNTRY_LABEL) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
    if (typeof fallback === 'number' || /^\d+$/.test(String(fallback || '').trim())) {
      const id = normalizeSmsBowerCountryId(fallback, DEFAULT_COUNTRY_ID);
      return getSupportedCountryById(id)?.label || `Country #${id}`;
    }
    return String(fallback || '').trim() || DEFAULT_COUNTRY_LABEL;
  }

  function normalizeSmsBowerCountryOrder(value, fallbackOrder = DEFAULT_COUNTRY_ORDER) {
    const hasExplicitValue = value !== undefined && value !== null;
    const source = hasExplicitValue
      ? (Array.isArray(value)
        ? value
        : String(value || '')
          .split(/[\r\n,，;；]+/)
          .map((entry) => String(entry || '').trim())
          .filter(Boolean))
      : (Array.isArray(fallbackOrder) ? fallbackOrder : DEFAULT_COUNTRY_ORDER);
    const normalized = [];
    const seen = new Set();

    source.forEach((entry) => {
      const id = normalizeSmsBowerCountryId(
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry.id ?? entry.countryId ?? entry.country ?? '')
          : entry,
        0
      );
      if (!id || seen.has(id)) return;
      seen.add(id);
      normalized.push(id);
    });

    if (hasExplicitValue) return normalized.slice(0, 12);
    if (normalized.length) return normalized.slice(0, 12);

    DEFAULT_COUNTRY_ORDER.forEach((entry) => {
      const id = normalizeSmsBowerCountryId(
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry.id ?? entry.countryId ?? entry.country ?? '')
          : entry,
        0
      );
      if (!id || seen.has(id)) return;
      seen.add(id);
      normalized.push(id);
    });
    return normalized.slice(0, 12);
  }

  function normalizeSmsBowerCountryFallback(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[\r\n,，;；]+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const seen = new Set();
    const normalized = [];

    for (const entry of source) {
      let id = 0;
      let label = '';
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        id = normalizeSmsBowerCountryId(entry.id ?? entry.countryId, 0);
        label = String((entry.label ?? entry.countryLabel) || '').trim();
      } else {
        const text = String(entry || '').trim();
        const structured = text.match(/^(\d+)\s*(?:[:|/-]\s*(.+))?$/);
        id = normalizeSmsBowerCountryId(structured?.[1] || text, 0);
        label = String(structured?.[2] || '').trim();
      }
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({ id, label: label || `Country #${id}` });
      if (normalized.length >= 20) break;
    }
    return normalized;
  }

  function normalizeSmsBowerPrice(value = '') {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return '';
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    return String(Math.round(numeric * 10000) / 10000);
  }

  function normalizeSmsBowerServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    if (normalized && normalized !== 'ot' && normalized !== 'any') return normalized;
    const fallbackNormalized = String(fallback || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    return fallbackNormalized && fallbackNormalized !== 'ot' && fallbackNormalized !== 'any'
      ? fallbackNormalized
      : DEFAULT_SERVICE_CODE;
  }

  function normalizeSmsBowerLang(value = '', fallback = DEFAULT_LANG) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'ru' || normalized === 'en') {
      return normalized;
    }
    const fallbackNormalized = String(fallback || '').trim().toLowerCase();
    return fallbackNormalized === 'ru' || fallbackNormalized === 'en' ? fallbackNormalized : DEFAULT_LANG;
  }

  function normalizeSmsBowerPricesAction(value = '', fallback = DEFAULT_PRICES_ACTION) {
    const normalized = String(value || '').trim();
    if (normalized === 'getPrices' || normalized === 'getPricesV3') {
      return normalized;
    }
    const fallbackNormalized = String(fallback || '').trim();
    return fallbackNormalized === 'getPrices' || fallbackNormalized === 'getPricesV3'
      ? fallbackNormalized
      : DEFAULT_PRICES_ACTION;
  }

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      return new URL(trimmed).toString();
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function buildUrl(config = {}, query = {}) {
    const url = new URL(normalizeBaseUrl(config.baseUrl));
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { return trimmed; }
    }
    return trimmed;
  }

  function describePayload(raw) {
    if (typeof raw === 'string') return raw.trim();
    if (raw && typeof raw === 'object') {
      const direct = String(raw.message || raw.msg || raw.error || raw.title || raw.status || '').trim();
      if (direct) return direct;
      try { return JSON.stringify(raw); } catch { return String(raw); }
    }
    return String(raw || '').trim();
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: String(state.smsBowerApiKey || '').trim(),
      baseUrl: state.smsBowerBaseUrl || DEFAULT_BASE_URL,
      lang: normalizeSmsBowerLang(state.smsBowerLang, deps.lang),
      pricesAction: normalizeSmsBowerPricesAction(state.smsBowerPricesAction, deps.pricesAction),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  async function fetchPayload(config, query, actionLabel = 'SMSBower request') {
    if (query.api_key === undefined && config.apiKey) {
      query = { api_key: config.apiKey, ...query };
    }
    if (query.lang === undefined && config.lang) {
      query = { ...query, lang: config.lang };
    }
    if (!config.apiKey) {
      throw new Error('SMSBower API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    if (!config.fetchImpl) {
      throw new Error('SMSBower 网络请求实现不可用。');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;
    try {
      const response = await config.fetchImpl(buildUrl(config, query), {
        method: 'GET',
        signal: controller?.signal,
      });
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
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function resolveCountryConfig(state = {}) {
    return {
      id: normalizeSmsBowerCountryId(state.smsBowerCountryId ?? state.heroSmsCountryId),
      label: normalizeSmsBowerCountryLabel(state.smsBowerCountryLabel || state.heroSmsCountryLabel, state.smsBowerCountryId ?? state.heroSmsCountryId ?? DEFAULT_COUNTRY_ID),
    };
  }

  function resolveCountryCandidates(state = {}) {
    const hasExplicitCountryOrder = Object.prototype.hasOwnProperty.call(state, 'smsBowerCountryOrder')
      && state.smsBowerCountryOrder !== undefined
      && state.smsBowerCountryOrder !== null;
    if (hasExplicitCountryOrder) {
      const countryOrder = normalizeSmsBowerCountryOrder(state.smsBowerCountryOrder, []);
      return countryOrder.map((id) => ({
        id,
        label: normalizeSmsBowerCountryLabel('', id),
      }));
    }

    const primary = resolveCountryConfig(state);
    const fallbackSource = state.smsBowerCountryFallback !== undefined
      ? state.smsBowerCountryFallback
      : state.heroSmsCountryFallback;
    const seen = new Set([primary.id]);
    const candidates = [primary];
    normalizeSmsBowerCountryFallback(fallbackSource).forEach((entry) => {
      const id = normalizeSmsBowerCountryId(entry.id, 0);
      if (!id || seen.has(id)) return;
      seen.add(id);
      candidates.push({ id, label: normalizeSmsBowerCountryLabel(entry.label, id) });
    });
    return candidates;
  }

  function getServiceCode(state = {}) {
    return normalizeSmsBowerServiceCode(state.smsBowerServiceCode, DEFAULT_SERVICE_CODE);
  }

  function getPriceBounds(state = {}) {
    return {
      minPrice: normalizeSmsBowerPrice(state.smsBowerMinPrice || state.heroSmsMinPrice),
      maxPrice: normalizeSmsBowerPrice(state.smsBowerMaxPrice || state.heroSmsMaxPrice),
    };
  }

  function hasSmsBowerSpecificPriceBounds(state = {}) {
    return Boolean(
      normalizeSmsBowerPrice(state.smsBowerMinPrice)
      || normalizeSmsBowerPrice(state.smsBowerMaxPrice)
    );
  }

  function normalizeSmsBowerPriceLimit(value = '') {
    const normalized = normalizeSmsBowerPrice(value);
    return normalized ? Number(normalized) : null;
  }

  function isSmsBowerPriceWithinBounds(price, minPrice = null, maxPrice = null) {
    const numeric = Number(price);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return false;
    }
    if (minPrice !== null && numeric < minPrice) {
      return false;
    }
    if (maxPrice !== null && numeric > maxPrice) {
      return false;
    }
    return true;
  }

  function buildSmsBowerRequestPriceCandidates(priceEntries = [], priceBounds = {}) {
    const minPrice = normalizeSmsBowerPriceLimit(priceBounds.minPrice);
    const maxPrice = normalizeSmsBowerPriceLimit(priceBounds.maxPrice);
    const hasMinPrice = minPrice !== null;
    const hasMaxPrice = maxPrice !== null;
    if (!hasMinPrice && !hasMaxPrice) {
      return [{ minPrice: '', maxPrice: '' }];
    }

    const prices = Array.from(new Set(
      (Array.isArray(priceEntries) ? priceEntries : [])
        .filter((entry) => entry?.inStock !== false)
        .map((entry) => Number(entry?.cost))
        .filter((price) => Number.isFinite(price) && price > 0)
        .map((price) => Math.round(price * 10000) / 10000)
    )).sort((left, right) => left - right);

    const inRange = prices.filter((price) => isSmsBowerPriceWithinBounds(price, minPrice, maxPrice));
    if (inRange.length) {
      return inRange.map((price) => ({
        minPrice: hasMinPrice ? String(minPrice) : '',
        maxPrice: String(price),
      }));
    }

    const hasCatalogBelowMin = hasMinPrice && prices.some((price) => price < minPrice);
    const hasCatalogAboveMax = hasMaxPrice && prices.some((price) => price > maxPrice);
    let probePrice = null;
    if (hasCatalogBelowMin && !hasCatalogAboveMax) {
      probePrice = minPrice;
    } else if (hasCatalogAboveMax && !hasCatalogBelowMin) {
      probePrice = maxPrice;
    } else {
      probePrice = maxPrice ?? minPrice;
    }

    return [{
      minPrice: hasMinPrice ? String(minPrice) : '',
      maxPrice: probePrice !== null ? String(probePrice) : '',
    }];
  }

  function normalizeSmsBowerPhoneForSubmit(phoneNumber = '', countryId = DEFAULT_COUNTRY_ID) {
    const digits = String(phoneNumber || '').replace(/[^\d]/g, '');
    if ([1, 12, 22, 36, 187].includes(normalizeSmsBowerCountryId(countryId, 0))) {
      if (digits.length === 11 && digits.startsWith('1')) {
        return digits.slice(1);
      }
      if (digits.length === 10) {
        return digits;
      }
    }
    return digits;
  }

  function resolveSmsBowerPhoneDialPrefix(phoneNumber = '') {
    const digits = String(phoneNumber || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    return KNOWN_DIAL_PREFIXES
      .find((prefix) => digits.startsWith(prefix) && digits.length > prefix.length) || '';
  }

  function getSmsBowerCountryDialMismatch(activation, countryConfig = {}) {
    const country = getSupportedCountryById(countryConfig?.id);
    const expectedPrefix = String(country?.phonePrefix || '').replace(/[^\d]/g, '');
    if (!expectedPrefix) {
      return null;
    }
    const rawDigits = String(activation?.rawPhoneNumber || activation?.phoneNumber || '').replace(/[^\d]/g, '');
    if (!rawDigits || rawDigits.startsWith(expectedPrefix)) {
      return null;
    }
    const actualPrefix = resolveSmsBowerPhoneDialPrefix(rawDigits);
    if (!actualPrefix || actualPrefix === expectedPrefix) {
      return null;
    }
    return {
      expectedPrefix,
      actualPrefix,
    };
  }

  function normalizeActivation(record, fallback = {}) {
    let activationId = '';
    let rawPhoneNumber = '';
    let activationCost;
    let canGetAnotherSms;

    if (typeof record === 'string') {
      const match = record.trim().match(/^ACCESS_NUMBER:([^:]+):(.+)$/i);
      if (match) {
        activationId = match[1];
        rawPhoneNumber = match[2];
      }
    } else if (record && typeof record === 'object' && !Array.isArray(record)) {
      activationId = String(record.activationId ?? record.id ?? '').trim();
      rawPhoneNumber = String(record.rawPhoneNumber ?? record.phoneNumber ?? record.phone ?? '').trim();
      activationCost = record.activationCost ?? record.price ?? record.cost;
      if (record.canGetAnotherSms !== undefined && record.canGetAnotherSms !== null) {
        canGetAnotherSms = record.canGetAnotherSms === true
          || record.canGetAnotherSms === 1
          || String(record.canGetAnotherSms).trim().toLowerCase() === 'true';
      }
    }

    if (!activationId || !rawPhoneNumber) return null;
    const countryId = normalizeSmsBowerCountryId(fallback.countryId ?? fallback.id ?? record?.countryId, DEFAULT_COUNTRY_ID);
    const phoneNumber = normalizeSmsBowerPhoneForSubmit(rawPhoneNumber, countryId);
    if (!phoneNumber) return null;
    return {
      activationId,
      phoneNumber,
      rawPhoneNumber,
      provider: PROVIDER_ID,
      serviceCode: normalizeSmsBowerServiceCode(fallback.serviceCode),
      countryId,
      countryLabel: normalizeSmsBowerCountryLabel(fallback.countryLabel || fallback.label, countryId),
      successfulUses: Math.max(0, Math.floor(Number(record?.successfulUses) || 0)),
      maxUses: 1,
      ...(Array.isArray(record?.smsBowerIgnoredCodes) || Array.isArray(fallback?.smsBowerIgnoredCodes)
        ? {
          smsBowerIgnoredCodes: Array.from(new Set(
            (Array.isArray(record?.smsBowerIgnoredCodes) ? record.smsBowerIgnoredCodes : fallback.smsBowerIgnoredCodes)
              .map((entry) => extractVerificationCode(entry))
              .filter(Boolean)
          )),
        }
        : {}),
      ...(activationCost !== undefined ? { price: Number(activationCost) } : {}),
      ...(canGetAnotherSms !== undefined ? { canGetAnotherSms } : {}),
    };
  }

  function isNoNumbersPayload(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /NO_NUMBERS|NO_BALANCE|NO_BALANCE_FORWARD|no\s+numbers|not\s+found|empty/i.test(text);
  }

  function isTerminalPayload(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /BAD_KEY|BAD_SERVICE|BAD_ACTION|BAD_COUNTRY|NO_BALANCE|banned|invalid/i.test(text);
  }

  async function requestActivation(state = {}, options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const serviceCode = getServiceCode(state);
    const priceBounds = getPriceBounds(state);
    const blockedCountryIds = new Set(
      (Array.isArray(options?.blockedCountryIds) ? options.blockedCountryIds : [])
        .map((value) => normalizeSmsBowerCountryId(value, 0))
        .filter((id) => id > 0)
    );
    const allCountryCandidates = resolveCountryCandidates(state);
    let countryCandidates = allCountryCandidates
      .filter((entry) => !blockedCountryIds.has(normalizeSmsBowerCountryId(entry.id, 0)));
    if (!countryCandidates.length && blockedCountryIds.size > 0) {
      const blockedLabels = allCountryCandidates
        .filter((entry) => blockedCountryIds.has(normalizeSmsBowerCountryId(entry.id, 0)))
        .map((entry) => entry.label || `Country #${entry.id}`)
        .filter(Boolean);
      throw new Error(`SMSBower 已跳过所有候选国家${blockedLabels.length ? `：${blockedLabels.join('、')}` : ''}。`);
    }
    if (!countryCandidates.length) {
      countryCandidates = allCountryCandidates;
    }

    const failures = [];
    let lastError = null;
    const requestActions = priceBounds.minPrice || priceBounds.maxPrice
      ? ['getNumber']
      : ['getNumberV2', 'getNumber'];
    for (const countryConfig of countryCandidates) {
      let priceCandidates = buildSmsBowerRequestPriceCandidates([], priceBounds);
      if (hasSmsBowerSpecificPriceBounds(state)) {
        try {
          const pricePayload = await fetchPrices(state, countryConfig, deps);
          priceCandidates = buildSmsBowerRequestPriceCandidates(
            collectPriceEntries(pricePayload, []),
            priceBounds
          );
        } catch (error) {
          lastError = error;
        }
      }
      for (const requestPrice of priceCandidates) {
        for (const action of requestActions) {
          try {
            const payload = await fetchPayload(config, {
              action,
              service: serviceCode,
              country: normalizeSmsBowerCountryId(countryConfig.id),
              minPrice: requestPrice.minPrice,
              maxPrice: requestPrice.maxPrice,
            }, `SMSBower ${action}`);
            const activation = normalizeActivation(payload, {
              serviceCode,
              countryId: countryConfig.id,
              countryLabel: countryConfig.label,
            });
            if (activation) {
              const dialMismatch = countryCandidates.length > 1
                ? getSmsBowerCountryDialMismatch(activation, countryConfig)
                : null;
              if (dialMismatch) {
                await setActivationStatus(state, activation, 8, deps).catch(() => '');
                failures.push(`${countryConfig.label}: 返回号码区号 +${dialMismatch.actualPrefix} 与国家区号 +${dialMismatch.expectedPrefix} 不匹配，已取消订单`);
                continue;
              }
              return activation;
            }
            const text = describePayload(payload);
            if (isTerminalPayload(text) && !(action === 'getNumberV2' && /BAD_ACTION/i.test(text))) {
              throw new Error(`SMSBower ${action}失败：${text}`);
            }
            failures.push(`${countryConfig.label}: ${text || '空响应'}`);
          } catch (error) {
            const payloadOrMessage = error?.payload || error?.message;
            const text = describePayload(payloadOrMessage);
            if (
              isTerminalPayload(payloadOrMessage)
              && !isNoNumbersPayload(payloadOrMessage)
              && !(action === 'getNumberV2' && /BAD_ACTION/i.test(text))
            ) {
              throw new Error(`SMSBower 获取手机号失败：${text || '未知错误'}`);
            }
            lastError = error;
            failures.push(`${countryConfig.label}: ${text || error?.message || '未知错误'}`);
          }
        }
      }
    }

    if (failures.length) {
      throw new Error(`SMSBower 已尝试 ${countryCandidates.length} 个候选国家，均无可用号码：${Array.from(new Set(failures)).join(' | ')}。`);
    }
    throw lastError || new Error('SMSBower 获取手机号失败。');
  }

  async function setActivationStatus(state = {}, activation, status, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) return '';
    const payload = await fetchPayload(resolveConfig(state, deps), {
      action: 'setStatus',
      id: normalizedActivation.activationId,
      status: Math.floor(Number(status) || 0),
    }, `SMSBower setStatus(${status})`);
    return describePayload(payload);
  }

  function resolveIgnoredCodeSet(activation = null) {
    const ignoredCodes = Array.isArray(activation?.smsBowerIgnoredCodes)
      ? activation.smsBowerIgnoredCodes
      : [];
    return new Set(ignoredCodes.map((entry) => extractVerificationCode(entry)).filter(Boolean));
  }

  function extractCodeFromStatusText(statusText = '') {
    const okMatch = String(statusText || '').match(/^STATUS_OK:(.+)$/i);
    return okMatch ? extractVerificationCode(okMatch[1]) : '';
  }

  function isJsonStatusPayload(payload) {
    return Boolean(
      payload
      && typeof payload === 'object'
      && !Array.isArray(payload)
      && Object.prototype.hasOwnProperty.call(payload, 'code')
      && (
        Object.prototype.hasOwnProperty.call(payload, 'msg')
        || Object.prototype.hasOwnProperty.call(payload, 'data')
      )
    );
  }

  function extractPayPalVerificationCodesFromSmsContent(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return [];
    }
    if (Number(payload.code) !== 0) {
      return [];
    }
    const smsList = Array.isArray(payload?.data?.sms_content) ? payload.data.sms_content : [];
    const codes = [];
    for (const smsItem of smsList) {
      const content = String(smsItem?.content || '').trim();
      if (!content) {
        continue;
      }
      const match = content.match(/PayPal:\s*(\d{6})\b/i);
      if (match?.[1]) {
        codes.push(match[1]);
      }
    }
    return Array.from(new Set(codes));
  }

  function extractCodesFromPayload(payload) {
    const codes = [];
    const statusCode = extractCodeFromStatusText(describePayload(payload));
    if (statusCode) {
      codes.push(statusCode);
    }
    codes.push(...extractPayPalVerificationCodesFromSmsContent(payload));
    return Array.from(new Set(codes.filter(Boolean)));
  }

  async function captureExistingCodesForActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      return [];
    }
    try {
      const payload = await fetchPayload(resolveConfig(state, deps), {
        action: 'getStatus',
        id: normalizedActivation.activationId,
      }, 'SMSBower capture existing sms');
      return extractCodesFromPayload(payload);
    } catch {
      return [];
    }
  }

  async function reuseActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少可复用的 SMSBower 手机号订单。');
    }
    const existingCodes = await captureExistingCodesForActivation(state, normalizedActivation, deps);
    await setActivationStatus(state, normalizedActivation, 3, deps);
    return {
      ...normalizedActivation,
      ...(existingCodes.length ? { smsBowerIgnoredCodes: existingCodes } : {}),
    };
  }

  async function finishActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 6, deps);
  }

  async function cancelActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 8, deps);
  }

  async function requestAdditionalSms(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 3, deps);
  }

  function extractVerificationCode(rawCodeOrText) {
    const trimmed = String(rawCodeOrText || '').trim();
    if (!trimmed) return '';
    const digitMatch = trimmed.match(/\b(\d{4,8})\b/);
    return digitMatch?.[1] || '';
  }

  function extractVerificationCodeFromStatus(statusText = '') {
    const match = String(statusText || '').trim().match(/^STATUS_OK:(.+)$/i);
    return match ? extractVerificationCode(match[1]) : '';
  }

  function isWaitingStatus(statusText = '') {
    return /^STATUS_(WAIT_CODE|WAIT_RETRY|WAIT_RESEND)(?::.+)?$/i.test(String(statusText || '').trim());
  }

  function isCancelledStatus(statusText = '') {
    return /^STATUS_CANCEL$/i.test(String(statusText || '').trim());
  }

  function parseBalancePayload(payload = '') {
    const text = describePayload(payload);
    const balance = Number(String(text).replace(/^ACCESS_BALANCE:/i, '').trim());
    return { balance, raw: payload };
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少 SMSBower 手机号接码订单。');
    }
    const config = resolveConfig(state, deps);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let pollCount = 0;
    let lastResponse = '';
    const ignoredCodes = resolveIgnoredCodeSet(normalizedActivation);
    let ignoredHistoricalCodeLogged = false;

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) break;
      deps.throwIfStopped?.();
      const payload = await fetchPayload(config, {
        action: 'getStatus',
        id: normalizedActivation.activationId,
      }, 'SMSBower getStatus');
      pollCount += 1;
      lastResponse = describePayload(payload);

      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: lastResponse || 'PENDING',
          timeoutMs,
        });
      }

      const codes = extractCodesFromPayload(payload);
      if (codes.length) {
        const nextCode = codes.find((code) => !ignoredCodes.has(code));
        if (nextCode) {
          return nextCode;
        }
        if (!ignoredHistoricalCodeLogged) {
          ignoredHistoricalCodeLogged = true;
          await deps.addLog?.(
            `步骤 8：SMSBower 复用订单 ${normalizedActivation.phoneNumber} 命中历史验证码，继续等待新短信。`,
            'info'
          );
        }
        if (typeof options.onWaitingForCode === 'function') {
          await options.onWaitingForCode({
            activation: normalizedActivation,
            elapsedMs: Date.now() - start,
            pollCount,
            statusText: lastResponse,
            timeoutMs,
          });
        }
        await deps.sleepWithStop(intervalMs);
        continue;
      }

      if (isWaitingStatus(lastResponse)) {
        if (typeof options.onWaitingForCode === 'function') {
          await options.onWaitingForCode({
            activation: normalizedActivation,
            elapsedMs: Date.now() - start,
            pollCount,
            statusText: lastResponse,
            timeoutMs,
          });
        }
        await deps.sleepWithStop(intervalMs);
        continue;
      }

      if (isJsonStatusPayload(payload)) {
        if (typeof options.onWaitingForCode === 'function') {
          await options.onWaitingForCode({
            activation: normalizedActivation,
            elapsedMs: Date.now() - start,
            pollCount,
            statusText: lastResponse || 'PENDING',
            timeoutMs,
          });
        }
        await deps.sleepWithStop(intervalMs);
        continue;
      }

      if (isCancelledStatus(lastResponse)) {
        throw new Error('SMSBower 订单在短信到达前已被取消。');
      }
      throw new Error(`SMSBower 查询验证码失败：${lastResponse || '空响应'}`);
    }

    const suffix = lastResponse ? ` SMSBower 最后状态：${lastResponse}` : '';
    throw new Error(`PHONE_CODE_TIMEOUT::等待手机验证码超时。${suffix}`);
  }

  async function fetchBalance(state = {}, deps = {}) {
    const payload = await fetchPayload(resolveConfig(state, deps), { action: 'getBalance' }, 'SMSBower getBalance');
    return parseBalancePayload(payload);
  }

  async function fetchPrices(state = {}, countryConfig = resolveCountryConfig(state), deps = {}) {
    const config = resolveConfig(state, deps);
    return fetchPayload(config, {
      action: normalizeSmsBowerPricesAction(config.pricesAction),
      service: getServiceCode(state),
      country: normalizeSmsBowerCountryId(countryConfig?.id),
    }, `SMSBower ${normalizeSmsBowerPricesAction(config.pricesAction)}`);
  }

  function collectPriceEntries(payload, entries = []) {
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectPriceEntries(entry, entries));
      return entries;
    }
    if (!payload || typeof payload !== 'object') return entries;

    const directPrice = Number(payload.price ?? payload.cost);
    const directCount = Number(payload.count ?? payload.qty);
    if (Number.isFinite(directPrice) && directPrice > 0) {
      entries.push({
        cost: Math.round(directPrice * 10000) / 10000,
        count: Number.isFinite(directCount) ? Math.max(0, directCount) : 0,
        inStock: !Number.isFinite(directCount) || directCount > 0,
      });
    }
    Object.entries(payload).forEach(([key, value]) => {
      const keyedPrice = Number(key);
      if (Number.isFinite(keyedPrice) && keyedPrice > 0) {
        const count = Number(value?.count ?? value);
        entries.push({
          cost: Math.round(keyedPrice * 10000) / 10000,
          count: Number.isFinite(count) ? Math.max(0, count) : 0,
          inStock: !Number.isFinite(count) || count > 0,
        });
      }
      collectPriceEntries(value, entries);
    });
    return entries;
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      addLog: deps.addLog,
      fetchImpl: deps.fetchImpl,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
    return {
      id: PROVIDER_ID,
      label: 'SMSBower',
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      supportedCountries: SUPPORTED_COUNTRY_ITEMS,
      defaultCountryOrder: DEFAULT_COUNTRY_ORDER,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId: normalizeSmsBowerCountryId,
      normalizeCountryLabel: normalizeSmsBowerCountryLabel,
      normalizeCountryOrder: normalizeSmsBowerCountryOrder,
      normalizeCountryFallback: normalizeSmsBowerCountryFallback,
      normalizeMaxPrice: normalizeSmsBowerPrice,
      normalizeServiceCode: normalizeSmsBowerServiceCode,
      resolveCountryCandidates,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: (state, activation) => finishActivation(state, activation, providerDeps),
      cancelActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      banActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      requestAdditionalSms: (state, activation) => requestAdditionalSms(state, activation, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      fetchPrices: (state, countryConfig) => fetchPrices(state, countryConfig, providerDeps),
      collectPriceEntries,
      describePayload,
    };
  }

  return {
    PROVIDER_ID,
    DEFAULT_BASE_URL,
    DEFAULT_COUNTRY_ID,
    DEFAULT_COUNTRY_LABEL,
    DEFAULT_COUNTRY_ORDER,
    DEFAULT_SERVICE_CODE,
    DEFAULT_SERVICE_LABEL,
    SUPPORTED_COUNTRY_ITEMS,
    createProvider,
    describePayload,
    extractVerificationCodeFromStatus,
    isCancelledStatus,
    isWaitingStatus,
    normalizeSmsBowerCountryFallback,
    normalizeSmsBowerCountryId,
    normalizeSmsBowerCountryLabel,
    normalizeSmsBowerCountryOrder,
    normalizeSmsBowerPhoneForSubmit,
    normalizeSmsBowerPrice,
    normalizeSmsBowerServiceCode,
    normalizeSmsBowerLang,
    normalizeSmsBowerPricesAction,
    parseActivationPayload: normalizeActivation,
    parseBalancePayload,
  };
});
