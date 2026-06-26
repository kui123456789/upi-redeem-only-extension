(function attachBackgroundVerificationFlow(root, factory) {
  root.MultiPageBackgroundVerificationFlow = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundVerificationFlowModule() {
  const ICLOUD_MAIL_POLL_MIN_ATTEMPTS = 5;
  const ICLOUD_MAIL_POLL_TIMEOUT_MARGIN_MS = 25000;
  const ASSURIVO_VERIFICATION_OPEN_URL = 'https://assurivo.com/console/open.php';
  const ASSURIVO_VERIFICATION_FEED_URL = 'https://assurivo.com/console/feed.php';
  const DEFAULT_SIGNUP_VERIFICATION_CODE_WAIT_SECONDS = 10;
  const MAX_SIGNUP_VERIFICATION_CODE_WAIT_SECONDS = 300;
  const ASSURIVO_VERIFICATION_FILTER_SKEW_MS = 5000;

  function createVerificationFlowHelpers(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      buildVerificationPollPayload: externalBuildVerificationPollPayload = null,
      chrome,
      closeConflictingTabsForSource,
      CLOUDFLARE_TEMP_EMAIL_PROVIDER,
      CLOUD_MAIL_PROVIDER = 'cloudmail',
      FREEMAIL_PROVIDER = 'freemail',
      ICLOUD_API_PROVIDER = 'icloud-api',
      MOEMAIL_PROVIDER = 'moemail',
      YYDSMAIL_PROVIDER = 'yydsmail',
      OUTLOOK_EMAIL_PLUS_PROVIDER = 'outlook-email-plus',
      completeNodeFromBackground,
      confirmCustomVerificationStepBypassRequest,
      getNodeIdByStepForState,
      getHotmailVerificationPollConfig,
      getHotmailVerificationRequestTimestamp,
      handleMail2925LimitReachedError,
      getState,
      getTabId,
      HOTMAIL_PROVIDER,
      isMail2925LimitReachedError,
      isStopError,
      LUCKMAIL_PROVIDER,
      MAIL_2925_VERIFICATION_INTERVAL_MS,
      MAIL_2925_VERIFICATION_MAX_ATTEMPTS,
      pollCloudflareTempEmailVerificationCode,
      pollCloudMailVerificationCode,
      pollFreemailVerificationCode,
      pollIcloudApiVerificationCode,
      pollMoemailVerificationCode,
      pollYydsMailVerificationCode,
      pollOutlookEmailPlusVerificationCode,
      pollHotmailVerificationCode,
      pollLuckmailVerificationCode,
      sendToContentScript,
      sendToContentScriptResilient,
      sendToMailContentScriptResilient,
      setNodeStatus,
      setState,
      sleepWithStop,
      throwIfStopped,
      VERIFICATION_POLL_MAX_ROUNDS,
      fetch: fetchImpl = null,
    } = deps;
    let activeVerificationLogStep = null;

    function normalizeLogStep(value) {
      const step = Math.floor(Number(value) || 0);
      return step > 0 ? step : null;
    }

    function normalizeVerificationLogMessage(message) {
      return String(message || '')
        .replace(/^步骤\s*\d+\s*[:：]\s*/, '')
        .replace(/^Step\s+\d+\s*[:：]\s*/i, '')
        .trim();
    }

    function addLog(message, level = 'info', options = {}) {
      const normalizedOptions = options && typeof options === 'object' ? { ...options } : {};
      const step = normalizeLogStep(normalizedOptions.step || normalizedOptions.visibleStep)
        || normalizeLogStep(activeVerificationLogStep);
      if (step) {
        normalizedOptions.step = step;
        if (!normalizedOptions.stepKey) {
          normalizedOptions.stepKey = step === 4 ? 'fetch-signup-code' : 'fetch-login-code';
        }
      }
      delete normalizedOptions.visibleStep;
      return rawAddLog(normalizeVerificationLogMessage(message), level, normalizedOptions);
    }

    async function getNodeIdForStep(step) {
      const state = typeof getState === 'function' ? await getState() : {};
      return typeof getNodeIdByStepForState === 'function'
        ? String(getNodeIdByStepForState(step, state) || '').trim()
        : '';
    }

    const isRetryableVerificationTransportError = typeof deps.isRetryableContentScriptTransportError === 'function'
      ? deps.isRetryableContentScriptTransportError
      : ((error) => /back\/forward cache|message channel is closed|Receiving end does not exist|port closed before a response was received|A listener indicated an asynchronous response|内容脚本\s+\d+(?:\.\d+)?\s*秒内未响应|did not respond in \d+s/i.test(
        String(typeof error === 'string' ? error : error?.message || '')
      ));

    function getVerificationCodeStateKey(step) {
      return step === 4 ? 'lastSignupCode' : 'lastLoginCode';
    }

    function getVerificationCodeLabel(step) {
      return step === 4 ? '注册' : '登录';
    }

    function normalizeSignupVerificationCodeWaitSeconds(value, fallback = DEFAULT_SIGNUP_VERIFICATION_CODE_WAIT_SECONDS) {
      const rawValue = String(value ?? '').trim();
      const fallbackNumber = Number.parseInt(String(fallback ?? '').trim(), 10);
      const fallbackValue = Number.isFinite(fallbackNumber)
        ? Math.max(0, Math.min(MAX_SIGNUP_VERIFICATION_CODE_WAIT_SECONDS, fallbackNumber))
        : DEFAULT_SIGNUP_VERIFICATION_CODE_WAIT_SECONDS;
      if (!rawValue) {
        return fallbackValue;
      }
      const numeric = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(numeric)) {
        return fallbackValue;
      }
      return Math.max(0, Math.min(MAX_SIGNUP_VERIFICATION_CODE_WAIT_SECONDS, numeric));
    }

    async function waitBeforeFetchingSignupVerificationCode(step, state = {}, attempt = 1, maxAttempts = 1, reason = '') {
      if (Number(step) !== 4) {
        return;
      }
      const waitSeconds = normalizeSignupVerificationCodeWaitSeconds(state?.signupVerificationCodeWaitSeconds);
      if (waitSeconds <= 0) {
        return;
      }
      const attemptText = attempt > 1
        ? `第 ${attempt}/${maxAttempts} 次取码前`
        : '首次取码前';
      const suffix = reason ? `，${reason}` : '';
      await addLog(`步骤 4：${attemptText}等待 ${waitSeconds} 秒${suffix}。`, 'info', {
        step: 4,
        stepKey: 'fetch-signup-code',
      });
      await sleepWithStop(waitSeconds * 1000);
    }

    function normalizeEmailForComparison(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeCustomEmailVerificationUrl(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      const sharedNormalizer = rootScope.MailProviderUtils?.normalizeCustomEmailVerificationUrl;
      if (typeof sharedNormalizer === 'function') {
        return sharedNormalizer(value);
      }
      const raw = String(value || '').trim();
      if (!/^https?:\/\//i.test(raw)) {
        return '';
      }
      try {
        const parsed = new URL(raw);
        return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : '';
      } catch {
        return '';
      }
    }

    function parseCustomEmailPoolEntryValue(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      const sharedParser = rootScope.MailProviderUtils?.parseCustomEmailPoolEntryValue;
      if (typeof sharedParser === 'function') {
        return sharedParser(value);
      }
      const raw = String(value || '').trim();
      const separatorIndex = raw.indexOf('----');
      const emailSource = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw;
      const suffix = separatorIndex >= 0 ? raw.slice(separatorIndex + 4).trim() : '';
      const verificationUrl = normalizeCustomEmailVerificationUrl(suffix);
      return {
        email: normalizeEmailForComparison(emailSource),
        credential: separatorIndex >= 0 && !verificationUrl ? raw : '',
        verificationUrl,
      };
    }

    function normalizeCustomEmailPoolEntryForVerification(rawEntry = {}) {
      const asObject = rawEntry && typeof rawEntry === 'object'
        ? rawEntry
        : { email: rawEntry };
      const parsedEntry = parseCustomEmailPoolEntryValue(asObject.credential || asObject.email || '');
      const email = normalizeEmailForComparison(parsedEntry.email || asObject.email || '');
      if (!email) {
        return null;
      }
      return {
        email,
        credential: parsedEntry.credential || String(asObject.credential || '').trim(),
        verificationUrl: normalizeCustomEmailVerificationUrl(
          asObject.verificationUrl || asObject.url || parsedEntry.verificationUrl || ''
        ),
      };
    }

    function getCustomEmailVerificationEntry(state = {}, targetEmail = '') {
      const normalizedTarget = normalizeEmailForComparison(
        targetEmail
        || state?.step8VerificationTargetEmail
        || state?.boundEmail
        || state?.email
      );
      if (!normalizedTarget) {
        return null;
      }

      const entries = Array.isArray(state?.customEmailPoolEntries)
        ? state.customEmailPoolEntries
        : [];
      for (const rawEntry of entries) {
        const entry = normalizeCustomEmailPoolEntryForVerification(rawEntry);
        if (entry?.email === normalizedTarget) {
          return entry;
        }
      }

      const legacyEntries = Array.isArray(state?.customEmailPool)
        ? state.customEmailPool
        : String(state?.customEmailPool || '').split(/\r?\n/);
      for (const rawEntry of legacyEntries) {
        const entry = normalizeCustomEmailPoolEntryForVerification(rawEntry);
        if (entry?.email === normalizedTarget) {
          return entry;
        }
      }
      return null;
    }

    function normalizeDigits(value = '') {
      const digits = String(value || '').replace(/\D+/g, '');
      return digits.length === 6 ? digits : '';
    }

    function collectCodesFromText(value = '', options = {}) {
      const text = String(value || '');
      if (!text.trim()) {
        return [];
      }
      const contextualPatterns = [
        /(?:openai|chatgpt|verification|verify|one[-\s]*time|temporary|code|验证码|一次性)[^0-9]{0,60}((?:\d[\s-]*){6})/gi,
        /((?:\d[\s-]*){6})[^0-9]{0,60}(?:openai|chatgpt|verification|verify|one[-\s]*time|temporary|code|验证码|一次性)/gi,
      ];
      const codes = [];
      for (const pattern of contextualPatterns) {
        let match = pattern.exec(text);
        while (match) {
          const code = normalizeDigits(match[1]);
          if (code) {
            codes.push(code);
          }
          match = pattern.exec(text);
        }
      }
      if (options.allowBareCode) {
        const barePattern = /(?:^|[^\d])((?:\d[\s-]*){6})(?:[^\d]|$)/g;
        let match = barePattern.exec(text);
        while (match) {
          const code = normalizeDigits(match[1]);
          if (code) {
            codes.push(code);
          }
          match = barePattern.exec(text);
        }
      }
      return codes;
    }

    function decodeHtmlEntitiesForVerificationText(value = '') {
      return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_match, codepoint) => {
          const numeric = Number(codepoint);
          return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : '';
        })
        .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint) => {
          const numeric = Number.parseInt(codepoint, 16);
          return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : '';
        });
    }

    function htmlToVerificationSearchText(value = '') {
      const text = String(value || '');
      if (!/[<&][a-z#!/?]/i.test(text) && !/&(?:nbsp|amp|lt|gt|quot|apos|#)/i.test(text)) {
        return text;
      }
      return decodeHtmlEntitiesForVerificationText(text)
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function shouldAllowBareCodeForVerificationCandidate(candidate = {}) {
      const key = String(candidate.key || '');
      const text = String(candidate.text || '');
      if (/(?:code|otp|verification)/i.test(key)) {
        return true;
      }
      if (!/(?:body|html|content|message|mail|email|text)/i.test(key)) {
        return false;
      }
      const searchable = htmlToVerificationSearchText(text);
      return /(?:openai|chatgpt)/i.test(searchable)
        && /(?:verification|verify|temporary|one[-\s]*time|code|验证码|一次性)/i.test(searchable);
    }

    function extractCodeFromText(value = '', options = {}) {
      const excluded = new Set((options.excludeCodes || []).map((code) => String(code || '').trim()).filter(Boolean));
      const codes = collectCodesFromText(value, options).filter((code) => !excluded.has(code));
      return codes.length ? codes[codes.length - 1] : '';
    }

    function collectCustomEmailVerificationTextCandidates(payload) {
      const prioritized = [];
      const fallback = [];
      const visited = new Set();
      const priorityKeyPattern = /(?:message|sms|body|text|content|mail|email|subject|snippet|code|otp|verification)/i;
      const metadataKeyPattern = /(?:order|id|phone|time|date|expire|created|updated|status|count|timestamp)/i;

      function visit(value, key = '') {
        if (value === null || value === undefined) {
          return;
        }
        if (typeof value === 'string' || typeof value === 'number') {
          const text = String(value || '').trim();
          if (!text) {
            return;
          }
          if (priorityKeyPattern.test(key)) {
            prioritized.push({ key, text });
          } else if (!metadataKeyPattern.test(key)) {
            fallback.push({ key, text });
          }
          return;
        }
        if (typeof value !== 'object') {
          return;
        }
        if (visited.has(value)) {
          return;
        }
        visited.add(value);
        const entries = Array.isArray(value)
          ? value.map((entry, index) => [String(index), entry])
          : Object.entries(value);
        for (const [childKey, childValue] of entries) {
          visit(childValue, childKey);
        }
      }

      visit(payload, '');
      return [...prioritized, ...fallback];
    }

    function collectCustomEmailVerificationCodes(payload) {
      const codes = [];
      if (typeof payload === 'string' || typeof payload === 'number') {
        codes.push(...collectCodesFromText(payload, { allowBareCode: true }));
        const htmlText = htmlToVerificationSearchText(payload);
        if (htmlText && htmlText !== String(payload)) {
          codes.push(...collectCodesFromText(htmlText, { allowBareCode: true }));
        }
        return codes;
      }
      for (const candidate of collectCustomEmailVerificationTextCandidates(payload)) {
        const allowBareCode = shouldAllowBareCodeForVerificationCandidate(candidate);
        codes.push(...collectCodesFromText(candidate.text, { allowBareCode }));
        const htmlText = htmlToVerificationSearchText(candidate.text);
        if (htmlText && htmlText !== candidate.text) {
          codes.push(...collectCodesFromText(htmlText, { allowBareCode }));
        }
      }
      return codes;
    }

    function collectAssurivoOpenPageBodyCodes(payload) {
      const rawText = String(payload || '');
      if (!rawText.trim()) {
        return { codes: [], matchedPrompt: false };
      }
      const text = htmlToVerificationSearchText(rawText).replace(/\s+/g, ' ').trim();
      if (!text) {
        return { codes: [], matchedPrompt: false };
      }
      const patterns = [
        /enter\s+this\s+temporary\s+verification\s+code\s+to\s+continue[:：]?\s*((?:\d[\s-]*){6})/gi,
        /temporary\s+verification\s+code\s+to\s+continue[:：]?\s*((?:\d[\s-]*){6})/gi,
        /your\s+temporary\s+chatgpt\s+(?:login|verification)\s+code[\s\S]{0,1200}?enter\s+this\s+temporary\s+verification\s+code\s+to\s+continue[:：]?\s*((?:\d[\s-]*){6})/gi,
      ];
      const codes = [];
      let matchedPrompt = /enter\s+this\s+temporary\s+verification\s+code\s+to\s+continue|your\s+temporary\s+chatgpt\s+(?:login|verification)\s+code/i.test(text);
      for (const pattern of patterns) {
        let match = pattern.exec(text);
        while (match) {
          const code = normalizeDigits(match[1]);
          if (code && !codes.includes(code)) {
            codes.push(code);
          }
          matchedPrompt = true;
          match = pattern.exec(text);
        }
      }
      return { codes, matchedPrompt };
    }

    function isAssurivoVerificationPayload(payload) {
      return Boolean(
        payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && String(payload.status || '').trim().toLowerCase() === 'success'
        && Array.isArray(payload.data)
        && payload.data.some((item) => (
          item
          && typeof item === 'object'
          && !Array.isArray(item)
          && (
            Object.prototype.hasOwnProperty.call(item, 'body')
            || Object.prototype.hasOwnProperty.call(item, 'subject')
            || Object.prototype.hasOwnProperty.call(item, 'from')
          )
        ))
      );
    }

    function normalizeVerificationTimestampMs(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
      }
      return Math.floor(numeric < 10000000000 ? numeric * 1000 : numeric);
    }

    function parseVerificationTimestampString(value = '') {
      const text = String(value || '').trim();
      if (!text) {
        return 0;
      }
      if (/^\d{10,13}(?:\.\d+)?$/.test(text)) {
        return normalizeVerificationTimestampMs(Number(text));
      }
      if (!/(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|[A-Z][a-z]{2},).*\d{1,2}:\d{2}/.test(text)) {
        return 0;
      }

      const normalized = text.replace(/\s+/g, ' ').trim();
      const ymdMatch = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/);
      if (ymdMatch) {
        const [, year, month, day, hour = '0', minute = '0', second = '0', tz = ''] = ymdMatch;
        if (tz) {
          const normalizedTz = tz === 'Z' ? 'Z' : tz.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
          const parsed = Date.parse(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}${normalizedTz}`);
          return Number.isFinite(parsed) ? parsed : 0;
        }
        const parsed = new Date(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second)
        ).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
      }

      const parsed = Date.parse(text);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function parseVerificationTimestampValue(value) {
      if (typeof value === 'number') {
        return normalizeVerificationTimestampMs(value);
      }
      if (typeof value === 'string') {
        return parseVerificationTimestampString(value);
      }
      return 0;
    }

    function isVerificationTimestampKey(key = '') {
      return /^(?:received(?:_?at|_?time)?|recv(?:_?at|_?time)?|sent(?:_?at|_?time)?|created(?:_?at|_?time)?|mail(?:_?date|_?time)?|date|datetime|time|timestamp)$/i.test(
        String(key || '').replace(/[-\s]+/g, '_')
      );
    }

    function extractVerificationEntryTimestamp(entry) {
      const timestamps = [];
      const dateParts = [];
      const timeParts = [];
      const visited = new Set();

      function visit(value, key = '', depth = 0) {
        if (value === null || value === undefined || depth > 5) {
          return;
        }
        const normalizedKey = String(key || '').replace(/[-\s]+/g, '_');
        const isTimestampKey = isVerificationTimestampKey(normalizedKey);
        if (isTimestampKey && (typeof value === 'string' || typeof value === 'number')) {
          const text = String(value || '').trim();
          if (/date/i.test(normalizedKey)) {
            dateParts.push(text);
          }
          if (/time|timestamp|received|recv|sent|created/i.test(normalizedKey)) {
            timeParts.push(text);
          }
          const timestamp = parseVerificationTimestampValue(value);
          if (timestamp > 0) {
            timestamps.push(timestamp);
          }
          return;
        }
        if (typeof value !== 'object') {
          return;
        }
        if (visited.has(value)) {
          return;
        }
        visited.add(value);
        for (const [childKey, childValue] of Object.entries(value)) {
          visit(childValue, childKey, depth + 1);
        }
      }

      visit(entry, '');
      if (!timestamps.length && dateParts.length && timeParts.length) {
        for (const dateText of dateParts) {
          for (const timeText of timeParts) {
            const timestamp = parseVerificationTimestampString(`${dateText} ${timeText}`);
            if (timestamp > 0) {
              timestamps.push(timestamp);
            }
          }
        }
      }
      return timestamps.length ? Math.max(...timestamps) : 0;
    }

    function normalizeFilterAfterTimestamp(value) {
      const timestamp = normalizeVerificationTimestampMs(value);
      return timestamp > 0 ? timestamp : 0;
    }

    function getOrderedAssurivoVerificationEntries(entries = [], options = {}) {
      const annotated = (Array.isArray(entries) ? entries : []).map((entry, index) => ({
        entry,
        index,
        timestamp: extractVerificationEntryTimestamp(entry),
      }));
      const filterAfterTimestamp = normalizeFilterAfterTimestamp(options.filterAfterTimestamp);
      const hasTimestampedEntries = annotated.some((item) => item.timestamp > 0);
      const minTimestamp = filterAfterTimestamp > 0
        ? Math.max(0, filterAfterTimestamp - ASSURIVO_VERIFICATION_FILTER_SKEW_MS)
        : 0;
      const selected = minTimestamp > 0 && hasTimestampedEntries
        ? annotated.filter((item) => item.timestamp >= minTimestamp)
        : annotated;
      if (hasTimestampedEntries) {
        selected.sort((left, right) => (right.timestamp - left.timestamp) || (left.index - right.index));
      }
      return selected.map((item) => item.entry);
    }

    function hasOnlyOlderTimestampedAssurivoEntries(entries = [], filterAfterTimestamp = 0) {
      const minTimestamp = normalizeFilterAfterTimestamp(filterAfterTimestamp) - ASSURIVO_VERIFICATION_FILTER_SKEW_MS;
      if (!(minTimestamp > 0)) {
        return false;
      }
      const timestamps = (Array.isArray(entries) ? entries : [])
        .map((entry) => extractVerificationEntryTimestamp(entry))
        .filter((timestamp) => timestamp > 0);
      return Boolean(timestamps.length) && timestamps.every((timestamp) => timestamp < minTimestamp);
    }

    function extractFirstEmailCodeFromOrderedEntries(entries = [], excluded = new Set(), options = {}) {
      for (const entry of getOrderedAssurivoVerificationEntries(entries, options)) {
        const codes = collectCustomEmailVerificationCodes(entry)
          .filter((code) => !excluded.has(code));
        if (codes.length) {
          return codes[codes.length - 1];
        }
      }
      return '';
    }

    function extractCustomEmailVerificationCode(payload, options = {}) {
      const excluded = new Set((options.excludeCodes || []).map((code) => String(code || '').trim()).filter(Boolean));
      if (isAssurivoVerificationPayload(payload)) {
        const code = extractFirstEmailCodeFromOrderedEntries(payload.data, excluded, options);
        if (code) {
          return code;
        }
        return '';
      }
      if (options.assurivoOpenPage && (typeof payload === 'string' || typeof payload === 'number')) {
        const { codes: bodyCodes, matchedPrompt } = collectAssurivoOpenPageBodyCodes(payload);
        const filteredBodyCodes = bodyCodes.filter((code) => !excluded.has(code));
        if (filteredBodyCodes.length) {
          return options.preferFirstCode ? filteredBodyCodes[0] : filteredBodyCodes[filteredBodyCodes.length - 1];
        }
        if (matchedPrompt) {
          return '';
        }
      }
      const codes = collectCustomEmailVerificationCodes(payload).filter((code, index, list) => (
        !excluded.has(code) && list.indexOf(code) === index
      ));
      if (!codes.length) {
        return '';
      }
      return options.preferFirstCode ? codes[0] : codes[codes.length - 1];
    }

    function parseCustomEmailVerificationPayloadText(text = '') {
      const rawText = String(text || '').trim();
      if (!rawText) {
        return '';
      }
      try {
        return JSON.parse(rawText);
      } catch {
        return rawText;
      }
    }

    function describeCustomEmailVerificationPayload(payload) {
      if (typeof payload === 'string') {
        return payload.slice(0, 160);
      }
      try {
        return JSON.stringify(payload).slice(0, 160);
      } catch {
        return '';
      }
    }

    function normalizeAssurivoCredentialParts(credential = '', fallbackEmail = '') {
      const raw = String(credential || '').trim();
      const separatorIndex = raw.indexOf('----');
      if (separatorIndex < 0) {
        return { email: '', pwd: '' };
      }
      const email = normalizeEmailForComparison(raw.slice(0, separatorIndex) || fallbackEmail);
      const pwd = raw.slice(separatorIndex + 4).trim();
      if (!email || !pwd) {
        return { email: '', pwd: '' };
      }
      return { email, pwd };
    }

    function buildAssurivoVerificationUrl(entry = {}, state = {}, endpoint = 'open') {
      const credential = String(entry?.credential || '').trim();
      const { email, pwd } = normalizeAssurivoCredentialParts(credential, entry?.email);
      if (!email || !pwd) {
        return '';
      }
      const limit = Math.max(1, Math.min(20, Math.floor(Number(state?.assurivoMailLimit) || 5)));
      const url = new URL(endpoint === 'feed' ? ASSURIVO_VERIFICATION_FEED_URL : ASSURIVO_VERIFICATION_OPEN_URL);
      url.searchParams.set('mail', email);
      url.searchParams.set('pwd', pwd);
      url.searchParams.set('limit', String(limit));
      return url.toString();
    }

    function isAssurivoOpenVerificationUrl(rawUrl = '') {
      try {
        const url = new URL(String(rawUrl || '').trim());
        return url.hostname === 'assurivo.com' && url.pathname === '/console/open.php';
      } catch {
        return false;
      }
    }

    function shouldUseAssurivoCredentialUrl(state = {}) {
      const hasConfiguredIcloudApi = Boolean(
        String(state?.icloudApiBaseUrl || '').trim()
        && String(state?.icloudApiAdminKey || '').trim()
      );
      return !hasConfiguredIcloudApi;
    }

    function isIcloudMail(mail) {
      return mail?.source === 'icloud-mail' || mail?.provider === 'icloud';
    }

    function normalizeIcloudMailPollPayload(mail, payload = {}) {
      if (!isIcloudMail(mail)) {
        return payload;
      }

      const currentAttempts = Math.max(1, Math.floor(Number(payload?.maxAttempts) || 1));
      if (currentAttempts >= ICLOUD_MAIL_POLL_MIN_ATTEMPTS) {
        return payload;
      }

      return {
        ...payload,
        maxAttempts: ICLOUD_MAIL_POLL_MIN_ATTEMPTS,
      };
    }

    function getMailPollingResponseTimeoutMs(payload = {}) {
      const maxAttempts = Math.max(1, Math.floor(Number(payload?.maxAttempts) || 1));
      const intervalMs = Math.max(1, Number(payload?.intervalMs) || 3000);
      return Math.max(45000, maxAttempts * intervalMs + ICLOUD_MAIL_POLL_TIMEOUT_MARGIN_MS);
    }

    function resolveMailPollingTimeouts(mail, timedPoll) {
      const payload = normalizeIcloudMailPollPayload(mail, timedPoll?.payload || {});
      const defaultResponseTimeoutMs = Math.max(1000, Number(timedPoll?.responseTimeoutMs) || 30000);
      const defaultTimeoutMs = Math.max(defaultResponseTimeoutMs, Number(timedPoll?.timeoutMs) || defaultResponseTimeoutMs);
      if (!isIcloudMail(mail)) {
        return {
          payload,
          responseTimeoutMs: defaultResponseTimeoutMs,
          timeoutMs: defaultTimeoutMs,
        };
      }

      const derivedResponseTimeoutMs = Math.max(
        defaultResponseTimeoutMs,
        getMailPollingResponseTimeoutMs(payload)
      );
      const derivedTimeoutMs = Math.max(defaultTimeoutMs, derivedResponseTimeoutMs);

      return {
        payload,
        responseTimeoutMs: derivedResponseTimeoutMs,
        timeoutMs: derivedTimeoutMs,
      };
    }

    function isLikelyLoggedInChatgptHomeUrl(rawUrl) {
      const url = String(rawUrl || '').trim();
      if (!url) return false;

      try {
        const parsed = new URL(url);
        const host = String(parsed.hostname || '').toLowerCase();
        if (!['chatgpt.com', 'www.chatgpt.com'].includes(host)) {
          return false;
        }
        const path = String(parsed.pathname || '');
        if (/^\/(?:auth\/|create-account\/|email-verification|log-in|add-phone)(?:[/?#]|$)/i.test(path)) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    }

    function isSignupProfilePageUrl(rawUrl) {
      const url = String(rawUrl || '').trim();
      if (!url) return false;

      try {
        const parsed = new URL(url);
        const host = String(parsed.hostname || '').toLowerCase();
        if (!['auth.openai.com', 'auth0.openai.com', 'accounts.openai.com'].includes(host)) {
          return false;
        }
        return /\/(?:create-account\/profile|u\/signup\/profile|signup\/profile|about-you)(?:[/?#]|$)/i.test(String(parsed.pathname || ''));
      } catch {
        return false;
      }
    }

    function isPasskeyEnrollmentPageUrl(rawUrl) {
      const url = String(rawUrl || '').trim();
      if (!url) return false;

      try {
        const parsed = new URL(url);
        const host = String(parsed.hostname || '').toLowerCase();
        if (!['auth.openai.com', 'auth0.openai.com', 'accounts.openai.com'].includes(host)) {
          return false;
        }
        return /\/create-account-enroll-passkey(?:[/?#]|$)/i.test(String(parsed.pathname || ''));
      } catch {
        return false;
      }
    }

    async function detectStep4PostSubmitFallback(tabId, options = {}) {
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
      const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || 250);
      const startedAt = Date.now();
      let lastUrl = '';

      while (Date.now() - startedAt < timeoutMs) {
        throwIfStopped();
        try {
          const tab = await chrome.tabs.get(tabId);
          const currentUrl = String(tab?.url || '').trim();
          if (currentUrl) {
            lastUrl = currentUrl;
          }

          if (isLikelyLoggedInChatgptHomeUrl(currentUrl)) {
            return {
              success: true,
              reason: 'chatgpt_home',
              skipProfileStep: true,
              url: currentUrl,
            };
          }

          if (isSignupProfilePageUrl(currentUrl)) {
            return {
              success: true,
              reason: 'signup_profile',
              skipProfileStep: false,
              url: currentUrl,
            };
          }

          if (isPasskeyEnrollmentPageUrl(currentUrl)) {
            return {
              success: true,
              reason: 'passkey_enrollment',
              passkeyEnrollmentRequired: true,
              skipProfileStep: false,
              url: currentUrl,
            };
          }
        } catch {
          // Keep polling until timeout; tab may be mid-navigation.
        }

        await sleepWithStop(pollIntervalMs);
      }

      return {
        success: false,
        reason: 'unknown',
        skipProfileStep: false,
        url: lastUrl,
      };
    }

    async function detectStep8PostSubmitFallback(options = {}) {
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 9000);
      const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || 300);
      const step = Number(options.step) || 8;
      const startedAt = Date.now();
      let lastSnapshot = null;

      while (Date.now() - startedAt < timeoutMs) {
        throwIfStopped();
        try {
          const request = {
            type: 'GET_LOGIN_AUTH_STATE',
            source: 'background',
            payload: {},
          };
          const requestTimeoutMs = Math.max(1200, Math.min(5000, timeoutMs));
          const result = typeof sendToContentScriptResilient === 'function'
            ? await sendToContentScriptResilient(
              'signup-page',
              request,
              {
                timeoutMs: requestTimeoutMs,
                responseTimeoutMs: requestTimeoutMs,
                retryDelayMs: 400,
                logMessage: `步骤 ${step}：验证码提交后页面正在切换，等待页面恢复并确认授权状态...`,
              }
            )
            : await sendToContentScript('signup-page', request, {
              responseTimeoutMs: requestTimeoutMs,
            });

          if (result?.error) {
            throw new Error(result.error);
          }

          const authState = String(result?.state || '').trim();
          const authUrl = String(result?.url || '').trim();
          const verificationErrorText = String(result?.verificationErrorText || '').trim();
          lastSnapshot = {
            state: authState || 'unknown',
            url: authUrl,
          };

          if (authState === 'verification_page' && verificationErrorText) {
            return {
              success: false,
              reason: 'invalid_code',
              invalidCode: true,
              errorText: verificationErrorText,
              url: authUrl,
            };
          }
          if (authState === 'oauth_consent_page') {
            return {
              success: true,
              reason: 'oauth_consent_page',
              addPhonePage: false,
              url: authUrl,
            };
          }
          if (authState === 'add_phone_page' || authState === 'phone_verification_page') {
            return {
              success: true,
              reason: 'add_phone_page',
              addPhonePage: true,
              url: authUrl || 'https://auth.openai.com/add-phone',
            };
          }
          if (authState === 'login_timeout_error_page') {
            return {
              success: false,
              reason: 'login_timeout_error_page',
              restartStep7: true,
              url: authUrl,
            };
          }
        } catch (_) {
          // Ignore transient inspect failures and keep polling.
        }

        await sleepWithStop(pollIntervalMs);
      }

      return {
        success: false,
        reason: 'unknown',
        snapshot: lastSnapshot,
      };
    }

    function getVerificationResendStateKey() {
      return 'verificationResendCount';
    }

    function normalizeVerificationResendCount(value, fallback = 0) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return Math.max(0, Math.floor(Number(fallback) || 0));
      }

      return Math.min(20, Math.max(0, Math.floor(numeric)));
    }

    function getVerificationRequestedAtStateKey(step) {
      if (Number(step) === 4) return 'signupVerificationRequestedAt';
      if (Number(step) === 8) return 'loginVerificationRequestedAt';
      return '';
    }

    function resolveInitialVerificationRequestedAt(step, state = {}, fallback = 0) {
      const stateKey = getVerificationRequestedAtStateKey(step);
      const candidateValues = [
        fallback,
        stateKey ? state?.[stateKey] : 0,
      ];

      for (const value of candidateValues) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
          return Math.floor(numeric);
        }
      }
      return 0;
    }

    function getLegacyVerificationResendCountDefault(step, options = {}) {
      const requestFreshCodeFirst = Boolean(options.requestFreshCodeFirst);
      const legacyMaxRounds = Math.max(1, Math.floor(Number(VERIFICATION_POLL_MAX_ROUNDS) || 1));
      if (step === 4 && requestFreshCodeFirst) {
        return legacyMaxRounds;
      }
      return Math.max(0, legacyMaxRounds - 1);
    }

    function getConfiguredVerificationResendCount(step, state, options = {}) {
      const stateKey = getVerificationResendStateKey(step);
      const configuredValue = state?.[stateKey] !== undefined
        ? state[stateKey]
        : (state?.signupVerificationResendCount ?? state?.loginVerificationResendCount);
      return normalizeVerificationResendCount(
        configuredValue,
        getLegacyVerificationResendCountDefault(step, options)
      );
    }

    function resolveMaxResendRequests(pollOverrides = {}) {
      if (pollOverrides.maxResendRequests !== undefined) {
        return normalizeVerificationResendCount(pollOverrides.maxResendRequests, 0);
      }

      const legacyMaxRounds = Number(pollOverrides.maxRounds);
      if (Number.isFinite(legacyMaxRounds)) {
        return Math.max(0, Math.floor(legacyMaxRounds) - 1);
      }

      return Math.max(0, Math.floor(Number(VERIFICATION_POLL_MAX_ROUNDS) || 1) - 1);
    }

    function getCompletionStep(step, options = {}) {
      const completionStep = Number(options.completionStep);
      return Number.isFinite(completionStep) && completionStep > 0 ? completionStep : step;
    }

    async function confirmCustomVerificationStepBypass(step, options = {}) {
      const completionStep = getCompletionStep(step, options);
      const promptStep = getCompletionStep(step, { completionStep: options.promptStep ?? completionStep });
      const verificationLabel = getVerificationCodeLabel(step);
      await addLog(`步骤 ${completionStep}：当前为自定义邮箱模式，请手动在页面中输入${verificationLabel}验证码并进入下一页面。`, 'warn');

      let response = null;
      try {
        response = await confirmCustomVerificationStepBypassRequest(promptStep);
      } catch {
        throw new Error(`步骤 ${completionStep}：无法打开确认弹窗，请先保持侧边栏打开后重试。`);
      }

      if (response?.error) {
        throw new Error(response.error);
      }
      if (step === 8 && response?.addPhoneDetected) {
        throw new Error(`步骤 ${completionStep}：验证码提交后页面进入手机号页面，当前流程无法继续自动授权。 URL: https://auth.openai.com/add-phone`);
      }
      if (!response?.confirmed) {
        throw new Error(`步骤 ${completionStep}：已取消手动${verificationLabel}验证码确认。`);
      }

      await setState({
        lastEmailTimestamp: null,
        signupVerificationRequestedAt: null,
        loginVerificationRequestedAt: null,
      });
      const completionNodeId = await getNodeIdForStep(completionStep);
      if (!completionNodeId) {
        throw new Error(`步骤 ${completionStep} 未映射到验证码节点。`);
      }
      await setNodeStatus(completionNodeId, 'skipped');
      await addLog(`步骤 ${completionStep}：已确认手动完成${verificationLabel}验证码输入，当前步骤已跳过。`, 'warn');
    }

    function getVerificationPollPayload(step, state, overrides = {}) {
      if (typeof externalBuildVerificationPollPayload === 'function') {
        return externalBuildVerificationPollPayload(step, state, overrides);
      }
      const normalizedStep = Number(step) === 4 ? 4 : 8;
      const is2925Provider = state?.mailProvider === '2925';
      const mail2925MatchTargetEmail = is2925Provider
        && String(state?.mail2925Mode || '').trim().toLowerCase() === 'receive';
      return {
        flowId: String(state?.activeFlowId || '').trim(),
        step: normalizedStep,
        filterAfterTimestamp: is2925Provider ? 0 : getHotmailVerificationRequestTimestamp(normalizedStep, state),
        senderFilters: [],
        subjectFilters: [],
        requiredKeywords: [],
        codePatterns: [],
        targetEmail: normalizedStep === 4
          ? state.email
          : (String(state?.step8VerificationTargetEmail || '').trim() || state.email),
        targetEmailHints: [],
        mail2925MatchTargetEmail,
        maxAttempts: is2925Provider ? MAIL_2925_VERIFICATION_MAX_ATTEMPTS : 5,
        intervalMs: is2925Provider ? MAIL_2925_VERIFICATION_INTERVAL_MS : 3000,
        ...overrides,
      };
    }

    async function getRemainingTimeBudgetMs(step, options = {}, actionLabel = '') {
      const resolver = typeof options.getRemainingTimeMs === 'function'
        ? options.getRemainingTimeMs
        : null;
      if (!resolver) {
        return null;
      }

      const value = await resolver({ step, actionLabel });
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return null;
      }

      return Math.max(0, Math.floor(numeric));
    }

    async function getResponseTimeoutMsForStep(step, options = {}, fallbackMs = 30000, actionLabel = '') {
      const remainingMs = await getRemainingTimeBudgetMs(step, options, actionLabel);
      const fallbackTimeoutMs = Math.max(1000, Number(fallbackMs) || 1000);
      const minResponseTimeoutMs = Math.min(
        fallbackTimeoutMs,
        Math.max(1000, Number(options.minResponseTimeoutMs) || 1000)
      );
      if (remainingMs === null) {
        return Math.max(minResponseTimeoutMs, fallbackTimeoutMs);
      }

      return Math.max(minResponseTimeoutMs, Math.min(fallbackTimeoutMs, remainingMs));
    }

    async function applyMailPollingTimeBudget(step, payload, options = {}, actionLabel = '') {
      const nextPayload = { ...payload };
      const intervalMs = Math.max(1, Number(nextPayload.intervalMs) || 3000);
      const baseMaxAttempts = Math.max(1, Number(nextPayload.maxAttempts) || 1);
      const disableTimeBudgetCap = Boolean(options.disableTimeBudgetCap);
      const remainingMs = await getRemainingTimeBudgetMs(step, options, actionLabel);
      const minPollingResponseTimeoutMs = Math.max(
        3000,
        Number(options.minPollingResponseTimeoutMs) || 5000
      );

      if (!disableTimeBudgetCap && remainingMs !== null) {
        nextPayload.maxAttempts = Math.max(
          1,
          Math.min(baseMaxAttempts, Math.floor(Math.max(0, remainingMs - 1000) / intervalMs) + 1)
        );
      }

      const defaultResponseTimeoutMs = Math.max(45000, nextPayload.maxAttempts * intervalMs + 25000);
      const responseTimeoutMs = disableTimeBudgetCap || remainingMs === null
        ? defaultResponseTimeoutMs
        : Math.max(
          minPollingResponseTimeoutMs,
          Math.min(defaultResponseTimeoutMs, remainingMs)
        );

      return {
        payload: nextPayload,
        responseTimeoutMs,
        timeoutMs: responseTimeoutMs,
      };
    }

    async function requestVerificationCodeResend(step, options = {}) {
      throwIfStopped();
      const signupTabId = await getTabId('signup-page');
      if (!signupTabId) {
        throw new Error('认证页面标签页已关闭，无法重新请求验证码。');
      }

      throwIfStopped();
      await chrome.tabs.update(signupTabId, { active: true });
      throwIfStopped();

      const result = await sendToContentScript('signup-page', {
        type: 'RESEND_VERIFICATION_CODE',
        step,
        source: 'background',
        payload: {},
      }, {
        responseTimeoutMs: await getResponseTimeoutMsForStep(
          step,
          options,
          30000,
          `重新发送${getVerificationCodeLabel(step)}验证码`
        ),
      });

      if (result && result.error) {
        throw new Error(result.error);
      }

      await addLog(`步骤 ${step}：已请求新的${getVerificationCodeLabel(step)}验证码。`, 'warn');

      const requestedAt = Date.now();
      if (step === 4) {
        await setState({ signupVerificationRequestedAt: requestedAt });
      }
      if (step === 8) {
        await setState({ loginVerificationRequestedAt: requestedAt });
      }

      const currentState = await getState();
      if (currentState.mailProvider === '2925') {
        const mailTabId = await getTabId('mail-2925');
        if (mailTabId) {
          await chrome.tabs.update(mailTabId, { active: true });
          await addLog(`步骤 ${step}：已切换到 2925 邮箱标签页等待新邮件。`, 'info');
        }
      }

      return requestedAt;
    }

    function shouldPreclear2925Mailbox(step, mail, options = {}) {
      if (mail?.provider !== '2925' || (step !== 4 && step !== 8)) {
        return false;
      }

      return !(Number(options.filterAfterTimestamp) > 0);
    }

    async function clear2925MailboxBeforePolling(step, mail, options = {}) {
      if (!shouldPreclear2925Mailbox(step, mail, options)) {
        return;
      }

      throwIfStopped();
      await addLog(`步骤 ${step}：开始刷新 2925 邮箱前先清空全部邮件，避免读取旧验证码邮件。`, 'warn');

      try {
        const responseTimeoutMs = await getResponseTimeoutMsForStep(
          step,
          options,
          15000,
          '清空 2925 邮箱历史邮件'
        );
        const result = await sendToMailContentScriptResilient(
          mail,
          {
            type: 'DELETE_ALL_EMAILS',
            step,
            source: 'background',
            payload: {},
          },
          {
            timeoutMs: responseTimeoutMs,
            responseTimeoutMs,
            maxRecoveryAttempts: 2,
            logStep: activeVerificationLogStep,
            logStepKey: step === 4 ? 'fetch-signup-code' : 'fetch-login-code',
          }
        );

        if (result?.error) {
          throw new Error(result.error);
        }

        if (result?.deleted === false) {
          await addLog(`步骤 ${step}：未能确认 2925 邮箱已清空，将继续刷新等待新邮件。`, 'warn');
          return;
        }

        await addLog(`步骤 ${step}：2925 邮箱已预先清空，开始刷新等待新邮件。`, 'info');
      } catch (err) {
        if (isStopError(err)) {
          throw err;
        }
        await addLog(`步骤 ${step}：预清空 2925 邮箱失败，将继续刷新等待新邮件：${err.message}`, 'warn');
      }
    }

    async function closeIcloudMailboxTabAfterSuccess(step, mail) {
      if (mail?.source !== 'icloud-mail') {
        return;
      }

      const tabId = typeof getTabId === 'function'
        ? await getTabId(mail.source)
        : null;

      if (Number.isInteger(tabId)) {
        await chrome.tabs.remove(tabId).catch(() => {});
        await addLog(`步骤 ${step}：已关闭 iCloud 邮箱标签页，避免长期累积。`, 'info');
        return;
      }

      if (typeof closeConflictingTabsForSource === 'function' && mail.url) {
        await closeConflictingTabsForSource(mail.source, mail.url).catch(() => {});
      }
    }

    function triggerPostSuccessMailboxCleanup(step, mail) {
      if (mail?.provider !== '2925' && mail?.source !== 'icloud-mail') {
        return;
      }

      Promise.resolve().then(async () => {
        try {
          if (mail?.source === 'icloud-mail') {
            await closeIcloudMailboxTabAfterSuccess(step, mail);
            return;
          }

          await sendToMailContentScriptResilient(
            mail,
            {
              type: 'DELETE_ALL_EMAILS',
              step,
              source: 'background',
              payload: {},
            },
            {
              timeoutMs: 10000,
              responseTimeoutMs: 5000,
              maxRecoveryAttempts: 1,
              logStep: activeVerificationLogStep,
              logStepKey: step === 4 ? 'fetch-signup-code' : 'fetch-login-code',
            }
          );
        } catch (_) {
          // Best-effort cleanup only.
        }
      });
    }

    async function pollFreshVerificationCodeWithResendInterval(step, state, mail, pollOverrides = {}) {
      const stateKey = getVerificationCodeStateKey(step);
      const rejectedCodes = new Set();
      if (state[stateKey]) {
        rejectedCodes.add(state[stateKey]);
      }
      for (const code of (pollOverrides.excludeCodes || [])) {
        if (code) rejectedCodes.add(code);
      }

      const {
        maxRounds: _ignoredMaxRounds,
        maxResendRequests: _ignoredMaxResendRequests,
        resendIntervalMs: _ignoredResendIntervalMs,
        lastResendAt: _ignoredLastResendAt,
        onResendRequestedAt: _ignoredOnResendRequestedAt,
        ...payloadOverrides
      } = pollOverrides;
      const onResendRequestedAt = typeof pollOverrides.onResendRequestedAt === 'function'
        ? pollOverrides.onResendRequestedAt
        : null;
      let lastError = null;
      let filterAfterTimestamp = payloadOverrides.filterAfterTimestamp ?? getVerificationPollPayload(step, state).filterAfterTimestamp;
      const maxResendRequests = resolveMaxResendRequests(pollOverrides);
      const totalRounds = maxResendRequests + 1;
      const maxRounds = totalRounds;
      const resendIntervalMs = Math.max(0, Number(pollOverrides.resendIntervalMs) || 0);
      let lastResendAt = Number(pollOverrides.lastResendAt) || 0;
      let usedResendRequests = 0;
      let pollOnlyNoResendRounds = 0;
      let transportErrorStreak = 0;
      const maxTransportErrorStreak = mail?.source === 'icloud-mail' ? 6 : 4;
      const maxIcloudNoResendRounds = mail?.source === 'icloud-mail' ? 4 : 0;
      const hasExistingResendTimestamp = Number(lastResendAt) > 0;
      const initialRoundNoResendWindowMs = resendIntervalMs > 0
        ? Math.max(10000, Math.min(45000, resendIntervalMs))
        : 0;
      const initialRoundNoResendUntil = hasExistingResendTimestamp
        ? 0
        : (initialRoundNoResendWindowMs > 0 ? (Date.now() + initialRoundNoResendWindowMs) : 0);

      for (let round = 1; round <= totalRounds; round++) {
        throwIfStopped();
        if (round === 1 && initialRoundNoResendUntil > 0) {
          const waitSeconds = Math.max(1, Math.ceil((initialRoundNoResendUntil - Date.now()) / 1000));
          await addLog(
            `步骤 ${step}：首次进入验证码轮询，先等待 ${waitSeconds} 秒观察新邮件，避免过早重复重发。`,
            'info'
          );
        }
        if (round > 1) {
          lastResendAt = await requestVerificationCodeResend(step, pollOverrides);
          usedResendRequests += 1;
          if (onResendRequestedAt) {
            const nextFilterAfterTimestamp = await onResendRequestedAt(lastResendAt);
            if (nextFilterAfterTimestamp !== undefined) {
              filterAfterTimestamp = nextFilterAfterTimestamp;
            }
          }
        }

        while (true) {
          throwIfStopped();
          const payload = getVerificationPollPayload(step, state, {
            ...payloadOverrides,
            filterAfterTimestamp,
            excludeCodes: [...rejectedCodes],
          });

          if (lastResendAt > 0) {
            const remainingBeforeResendMs = Math.max(0, resendIntervalMs - (Date.now() - lastResendAt));
            const baseMaxAttempts = Math.max(1, Number(payload.maxAttempts) || 5);
            const intervalMs = Math.max(1, Number(payload.intervalMs) || 3000);
            payload.maxAttempts = Math.max(1, Math.min(baseMaxAttempts, Math.floor(remainingBeforeResendMs / intervalMs) + 1));
          }

          try {
            const timedPoll = await applyMailPollingTimeBudget(
              step,
              payload,
              pollOverrides,
              `轮询${getVerificationCodeLabel(step)}验证码邮箱`
            );
            const timeoutWindow = resolveMailPollingTimeouts(mail, timedPoll);
            const result = await sendToMailContentScriptResilient(
              mail,
              {
                type: 'POLL_EMAIL',
                step,
                source: 'background',
                payload: timeoutWindow.payload,
              },
              {
                timeoutMs: timeoutWindow.timeoutMs,
                maxRecoveryAttempts: 2,
                responseTimeoutMs: timeoutWindow.responseTimeoutMs,
                logStep: activeVerificationLogStep,
                logStepKey: step === 4 ? 'fetch-signup-code' : 'fetch-login-code',
              }
            );

            if (result && result.error) {
              throw new Error(result.error);
            }

            if (!result || !result.code) {
              throw new Error(`步骤 ${step}：邮箱轮询结束，但未获取到验证码。`);
            }

            if (rejectedCodes.has(result.code)) {
              throw new Error(`步骤 ${step}：再次收到了相同的${getVerificationCodeLabel(step)}验证码：${result.code}`);
            }

            transportErrorStreak = 0;

            return {
              ...result,
              lastResendAt,
              remainingResendRequests: Math.max(0, maxResendRequests - usedResendRequests),
            };
          } catch (err) {
            if (isStopError(err)) {
              throw err;
            }
            if (mail?.provider === '2925' && typeof isMail2925LimitReachedError === 'function' && isMail2925LimitReachedError(err)) {
              if (typeof handleMail2925LimitReachedError === 'function') {
                throw await handleMail2925LimitReachedError(step, err);
              }
              throw err;
            }
            const isTransportError = isRetryableVerificationTransportError(err);
            if (isTransportError) {
              transportErrorStreak += 1;
              lastError = err;
              await addLog(`步骤 ${step}：${err.message}`, 'warn');
              if (transportErrorStreak >= maxTransportErrorStreak) {
                throw new Error(
                  `步骤 ${step}：${mail?.label || '邮箱'}页面通信异常连续 ${transportErrorStreak} 次，已停止当前轮询以避免重复重发验证码。最后错误：${err.message}`
                );
              }
              const fallbackIntervalMs = Math.max(
                800,
                Math.min(
                  3000,
                  Number(payloadOverrides.intervalMs)
                    || Number(pollOverrides.intervalMs)
                    || 2000
                )
              );
              await sleepWithStop(fallbackIntervalMs);
              continue;
            }
            transportErrorStreak = 0;
            lastError = err;
            await addLog(`步骤 ${step}：${err.message}`, 'warn');
          }

          if (mail?.source === 'icloud-mail' && maxIcloudNoResendRounds > 0) {
            pollOnlyNoResendRounds += 1;
            if (pollOnlyNoResendRounds >= maxIcloudNoResendRounds) {
              throw new Error(
                `步骤 ${step}：iCloud 邮箱连续 ${pollOnlyNoResendRounds} 轮轮询均未拿到验证码且未触发重发，已停止当前链路以避免空轮询循环，请刷新邮箱页后重试。`
              );
            }
          }

          const remainingBeforeResendMs = lastResendAt > 0
            ? Math.max(0, resendIntervalMs - (Date.now() - lastResendAt))
            : 0;
          const initialCooldownMs = (round === 1 && initialRoundNoResendUntil > 0)
            ? Math.max(0, initialRoundNoResendUntil - Date.now())
            : 0;
          const effectiveCooldownMs = Math.max(remainingBeforeResendMs, initialCooldownMs);
          if (effectiveCooldownMs > 0) {
            await addLog(
              `步骤 ${step}：距离下次重新发送验证码还差 ${Math.ceil(effectiveCooldownMs / 1000)} 秒，继续刷新邮箱（第 ${round}/${maxRounds} 轮）...`,
              'info'
            );
            const configuredIntervalMs = Math.max(
              1,
              Number(payloadOverrides.intervalMs)
                || Number(pollOverrides.intervalMs)
                || 3000
            );
            const cooldownSleepMs = Math.min(
              effectiveCooldownMs,
              Math.max(1000, Math.min(configuredIntervalMs, 3000))
            );
            await sleepWithStop(cooldownSleepMs);
            continue;
          }

          if (round < maxRounds) {
            await addLog(`步骤 ${step}：已到 25 秒重发间隔，准备重新发送验证码（第 ${round + 1}/${maxRounds} 轮）...`, 'warn');
          }
          break;
        }
      }

      throw lastError || new Error(`步骤 ${step}：无法获取新的${getVerificationCodeLabel(step)}验证码。`);
    }

    function shouldRequestLuckmailResendBeforeRetry(error) {
      const message = String(error?.message || error || '');
      if (!message) {
        return true;
      }

      return !/没有可用 token|token 对应邮箱与当前邮箱不一致/i.test(message);
    }

    async function pollLuckmailVerificationCodeWithResend(step, state, pollOverrides = {}) {
      const {
        onResendRequestedAt,
        maxRounds: _ignoredMaxRounds,
        maxResendRequests: _ignoredMaxResendRequests,
        initialPollMaxAttempts: _ignoredInitialPollMaxAttempts,
        pollAttemptPlan: _ignoredPollAttemptPlan,
        ...cleanPollOverrides
      } = pollOverrides;
      const basePayload = {
        ...getVerificationPollPayload(step, state),
        ...cleanPollOverrides,
      };
      const maxAttempts = Math.max(1, Number(basePayload.maxAttempts) || 1);
      const intervalMs = Math.max(15000, Number(basePayload.intervalMs) || 15000);
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        throwIfStopped();
        try {
          return await pollLuckmailVerificationCode(step, state, {
            ...basePayload,
            maxAttempts: 1,
            intervalMs,
          });
        } catch (err) {
          if (isStopError(err)) {
            throw err;
          }

          lastError = err;
          const canRetry = attempt < maxAttempts;
          if (!canRetry) {
            break;
          }

          if (shouldRequestLuckmailResendBeforeRetry(err)) {
            try {
              await requestVerificationCodeResend(step, pollOverrides);
            } catch (resendError) {
              if (isStopError(resendError)) {
                throw resendError;
              }
              await addLog(`步骤 ${step}：LuckMail 点击重新发送验证码失败：${resendError.message}，仍将在 ${Math.ceil(intervalMs / 1000)} 秒后继续轮询 /code 接口。`, 'warn');
            }
          }

          await addLog(`步骤 ${step}：LuckMail 暂未获取到新的${getVerificationCodeLabel(step)}验证码，等待 ${Math.ceil(intervalMs / 1000)} 秒后继续轮询 /code 接口（${attempt + 1}/${maxAttempts}）...`, 'warn');
          await sleepWithStop(intervalMs);
        }
      }

      throw lastError || new Error(`步骤 ${step}：无法获取新的${getVerificationCodeLabel(step)}验证码。`);
    }

    async function pollFreshVerificationCode(step, state, mail, pollOverrides = {}) {
      const {
        onResendRequestedAt,
        maxRounds: _ignoredMaxRounds,
        maxResendRequests: _ignoredMaxResendRequests,
        initialPollMaxAttempts: _ignoredInitialPollMaxAttempts,
        pollAttemptPlan: _ignoredPollAttemptPlan,
        ...cleanPollOverrides
      } = pollOverrides;

      if (mail.provider === HOTMAIL_PROVIDER) {
        const hotmailPollConfig = getHotmailVerificationPollConfig(step);
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...hotmailPollConfig,
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollHotmailVerificationCode(step, state, timedPoll.payload);
      }
      if (mail.provider === LUCKMAIL_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollLuckmailVerificationCodeWithResend(step, state, {
          ...cleanPollOverrides,
          ...timedPoll.payload,
          onResendRequestedAt,
        });
      }
      if (mail.provider === CLOUDFLARE_TEMP_EMAIL_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollCloudflareTempEmailVerificationCode(step, state, timedPoll.payload);
      }
      if (mail.provider === CLOUD_MAIL_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollCloudMailVerificationCode(step, state, timedPoll.payload);
      }
      if (mail.provider === FREEMAIL_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollFreemailVerificationCode(step, state, timedPoll.payload);
      }
      if (mail.provider === MOEMAIL_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollMoemailVerificationCode(step, state, timedPoll.payload);
      }
      if (mail.provider === YYDSMAIL_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollYydsMailVerificationCode(step, state, timedPoll.payload);
      }
      if (mail.provider === ICLOUD_API_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollIcloudApiVerificationCode(step, state, timedPoll.payload);
      }
      if (mail.provider === OUTLOOK_EMAIL_PLUS_PROVIDER) {
        const timedPoll = await applyMailPollingTimeBudget(step, {
          ...getVerificationPollPayload(step, state),
          ...cleanPollOverrides,
        }, cleanPollOverrides, `轮询${getVerificationCodeLabel(step)}验证码邮箱`);
        return pollOutlookEmailPlusVerificationCode(step, state, timedPoll.payload);
      }

      if (Number(pollOverrides.resendIntervalMs) > 0) {
        return pollFreshVerificationCodeWithResendInterval(step, state, mail, pollOverrides);
      }

      const stateKey = getVerificationCodeStateKey(step);
      const rejectedCodes = new Set();
      if (state[stateKey]) {
        rejectedCodes.add(state[stateKey]);
      }
      for (const code of (pollOverrides.excludeCodes || [])) {
        if (code) rejectedCodes.add(code);
      }

      let lastError = null;
      let filterAfterTimestamp = cleanPollOverrides.filterAfterTimestamp ?? getVerificationPollPayload(step, state).filterAfterTimestamp;
      const maxResendRequests = resolveMaxResendRequests(pollOverrides);
      const maxRounds = maxResendRequests + 1;
      const initialPollMaxAttempts = Math.max(0, Math.floor(Number(pollOverrides.initialPollMaxAttempts) || 0));
      const configuredPollAttemptPlan = Array.isArray(pollOverrides.pollAttemptPlan)
        ? pollOverrides.pollAttemptPlan
          .map((value) => Math.floor(Number(value) || 0))
          .filter((value) => value > 0)
        : [];
      const pollAttemptPlan = rejectedCodes.size > 0 ? [] : configuredPollAttemptPlan;
      let usedResendRequests = 0;

      for (let round = 1; round <= maxRounds; round++) {
        throwIfStopped();
        if (round > 1) {
          const requestedAt = await requestVerificationCodeResend(step, pollOverrides);
          usedResendRequests += 1;
          if (typeof onResendRequestedAt === 'function') {
            const nextFilterAfterTimestamp = await onResendRequestedAt(requestedAt);
            if (nextFilterAfterTimestamp !== undefined) {
              filterAfterTimestamp = nextFilterAfterTimestamp;
            }
          }
        }

        const payload = getVerificationPollPayload(step, state, {
          ...cleanPollOverrides,
          filterAfterTimestamp,
          excludeCodes: [...rejectedCodes],
        });
        const plannedPollMaxAttempts = pollAttemptPlan[round - 1] || 0;
        if (plannedPollMaxAttempts > 0) {
          payload.maxAttempts = plannedPollMaxAttempts;
        } else if (round === 1 && initialPollMaxAttempts > 0) {
          payload.maxAttempts = initialPollMaxAttempts;
        }

        try {
          const timedPoll = await applyMailPollingTimeBudget(
            step,
            payload,
            pollOverrides,
            `轮询${getVerificationCodeLabel(step)}验证码邮箱`
          );
          const timeoutWindow = resolveMailPollingTimeouts(mail, timedPoll);
          const result = await sendToMailContentScriptResilient(
            mail,
            {
              type: 'POLL_EMAIL',
              step,
              source: 'background',
              payload: timeoutWindow.payload,
            },
            {
              timeoutMs: timeoutWindow.timeoutMs,
              maxRecoveryAttempts: 2,
              responseTimeoutMs: timeoutWindow.responseTimeoutMs,
              logStep: activeVerificationLogStep,
              logStepKey: step === 4 ? 'fetch-signup-code' : 'fetch-login-code',
            }
          );

          if (result && result.error) {
            throw new Error(result.error);
          }

          if (!result || !result.code) {
            throw new Error(`步骤 ${step}：邮箱轮询结束，但未获取到验证码。`);
          }

          if (rejectedCodes.has(result.code)) {
            throw new Error(`步骤 ${step}：再次收到了相同的${getVerificationCodeLabel(step)}验证码：${result.code}`);
          }

          return {
            ...result,
            remainingResendRequests: Math.max(0, maxResendRequests - usedResendRequests),
          };
        } catch (err) {
          if (isStopError(err)) {
            throw err;
          }
          if (mail?.provider === '2925' && typeof isMail2925LimitReachedError === 'function' && isMail2925LimitReachedError(err)) {
            if (typeof handleMail2925LimitReachedError === 'function') {
              throw await handleMail2925LimitReachedError(step, err);
            }
            throw err;
          }
          lastError = err;
          await addLog(`步骤 ${step}：${err.message}`, 'warn');
          if (round < maxRounds) {
            await addLog(`步骤 ${step}：将重新发送验证码后重试（${round + 1}/${maxRounds}）...`, 'warn');
          }
        }
      }

      throw lastError || new Error(`步骤 ${step}：无法获取新的${getVerificationCodeLabel(step)}验证码。`);
    }

    async function submitVerificationCode(step, code, options = {}) {
      const completionStep = getCompletionStep(step, options);
      const authLoginStep = completionStep >= 11 ? 10 : 7;
      const signupTabId = await getTabId('signup-page');
      if (!signupTabId) {
        throw new Error('认证页面标签页已关闭，无法填写验证码。');
      }

      await chrome.tabs.update(signupTabId, { active: true });
      const baseResponseTimeoutMs = await getResponseTimeoutMsForStep(
        step,
        step === 8
          ? {
            ...options,
            minResponseTimeoutMs: Math.max(15000, Number(options.minResponseTimeoutMs) || 0),
          }
          : options,
        step === 7 ? 45000 : 30000,
        `填写${getVerificationCodeLabel(step)}验证码`
      );
      const message = {
        type: 'FILL_CODE',
        step,
        source: 'background',
        payload: {
          code,
          ...(step === 4 && options.signupProfile ? { signupProfile: options.signupProfile } : {}),
          ...(step === 4 && options.password ? { password: options.password } : {}),
        },
      };
      let result;
      const shouldAvoidReplaySubmit = step === 8;
      if (typeof sendToContentScriptResilient === 'function' && !shouldAvoidReplaySubmit) {
        try {
          result = await sendToContentScriptResilient('signup-page', message, {
            timeoutMs: Math.max(baseResponseTimeoutMs + 15000, 30000),
            retryDelayMs: 700,
            responseTimeoutMs: baseResponseTimeoutMs,
            logMessage: '认证页正在切换，等待页面重新就绪后继续确认验证码提交结果...',
            logStep: completionStep,
            logStepKey: step === 4 ? 'fetch-signup-code' : 'fetch-login-code',
          });
        } catch (err) {
          if (step === 4 && isRetryableVerificationTransportError(err)) {
            const fallback = await detectStep4PostSubmitFallback(signupTabId, {
              timeoutMs: 9000,
              pollIntervalMs: 300,
            });
            if (fallback.success) {
              const fallbackLabel = fallback.reason === 'chatgpt_home'
                ? 'ChatGPT 已登录首页'
                : '注册资料页';
              await addLog(`步骤 4：验证码提交后页面已切换到${fallbackLabel}，按提交成功继续。`, 'warn');
              return {
                success: true,
                assumed: true,
                transportRecovered: true,
                skipProfileStep: Boolean(fallback.skipProfileStep),
                url: fallback.url,
              };
            }
          }
          if (step === 8 && isRetryableVerificationTransportError(err)) {
            const fallback = await detectStep8PostSubmitFallback({
              step,
              timeoutMs: 9000,
              pollIntervalMs: 300,
            });
            if (fallback.success) {
              if (fallback.addPhonePage) {
                await addLog('验证码提交后通信中断，但页面已进入手机号验证页，按提交成功继续。', 'warn', {
                  step: completionStep,
                  stepKey: 'fetch-login-code',
                });
              } else {
                await addLog('验证码提交后通信中断，但页面已进入 OAuth 授权页，按提交成功继续。', 'warn', {
                  step: completionStep,
                  stepKey: 'fetch-login-code',
                });
              }
              return {
                success: true,
                assumed: true,
                transportRecovered: true,
                addPhonePage: Boolean(fallback.addPhonePage),
                url: fallback.url || '',
              };
            }
            if (fallback.restartStep7) {
              const urlPart = fallback.url ? ` URL: ${fallback.url}` : '';
              throw new Error(`STEP8_RESTART_STEP7::步骤 ${completionStep}：验证码提交后认证页进入登录超时报错页，请回到步骤 ${authLoginStep} 重新开始。${urlPart}`.trim());
            }
          }
          throw err;
        }
      } else if (shouldAvoidReplaySubmit) {
        try {
          result = await sendToContentScript('signup-page', message, {
            responseTimeoutMs: baseResponseTimeoutMs,
          });
        } catch (err) {
          if (isRetryableVerificationTransportError(err)) {
            await addLog('认证页正在切换，等待页面重新就绪后继续确认验证码提交结果...', 'warn', {
              step: completionStep,
              stepKey: 'fetch-login-code',
            });
            const fallback = await detectStep8PostSubmitFallback({
              step,
              timeoutMs: 9000,
              pollIntervalMs: 300,
            });
            if (fallback.invalidCode) {
              return {
                invalidCode: true,
                errorText: fallback.errorText || '验证码被拒绝。',
                url: fallback.url || '',
              };
            }
            if (fallback.success) {
              if (fallback.addPhonePage) {
                await addLog('验证码提交后通信中断，但页面已进入手机号验证页，按提交成功继续。', 'warn', {
                  step: completionStep,
                  stepKey: 'fetch-login-code',
                });
              } else {
                await addLog('验证码提交后通信中断，但页面已进入 OAuth 授权页，按提交成功继续。', 'warn', {
                  step: completionStep,
                  stepKey: 'fetch-login-code',
                });
              }
              return {
                success: true,
                assumed: true,
                transportRecovered: true,
                addPhonePage: Boolean(fallback.addPhonePage),
                url: fallback.url || '',
              };
            }
            if (fallback.restartStep7) {
              const urlPart = fallback.url ? ` URL: ${fallback.url}` : '';
              throw new Error(`STEP8_RESTART_STEP7::步骤 ${completionStep}：验证码提交后认证页进入登录超时报错页，请回到步骤 ${authLoginStep} 重新开始。${urlPart}`.trim());
            }
          }
          throw err;
        }
      } else {
        result = await sendToContentScript('signup-page', message, {
          responseTimeoutMs: baseResponseTimeoutMs,
        });
      }

      if (result && result.error) {
        throw new Error(result.error);
      }

      return result || {};
    }

    async function fetchCustomEmailVerificationCode(step, state = {}, options = {}) {
      const targetEmail = normalizeEmailForComparison(
        options.targetEmail
        || state?.step8VerificationTargetEmail
        || state?.boundEmail
        || state?.email
      );
      const entry = getCustomEmailVerificationEntry(state, targetEmail);
      const explicitVerificationUrl = String(entry?.verificationUrl || '').trim();
      const assurivoVerificationUrl = (!explicitVerificationUrl && shouldUseAssurivoCredentialUrl(state))
        ? buildAssurivoVerificationUrl(entry, state)
        : '';
      const assurivoFallbackVerificationUrl = assurivoVerificationUrl
        ? buildAssurivoVerificationUrl(entry, state, 'feed')
        : '';
      const verificationUrl = explicitVerificationUrl || assurivoVerificationUrl;
      if (!verificationUrl) {
        return {
          handled: false,
          targetEmail,
        };
      }

      const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      if (typeof fetcher !== 'function') {
        throw new Error(`步骤 ${step}：当前运行环境不支持 fetch，无法通过自定义邮箱取码 URL 获取验证码。`);
      }

      const filterAfterTimestamp = resolveInitialVerificationRequestedAt(step, state, options.filterAfterTimestamp);
      const requests = [];
      if (assurivoVerificationUrl) {
        requests.push({
          url: assurivoVerificationUrl,
          label: 'Assurivo 网页取件',
          preferFirstCode: true,
          assurivoOpenPage: true,
        });
        if (assurivoFallbackVerificationUrl && assurivoFallbackVerificationUrl !== assurivoVerificationUrl) {
          requests.push({
            url: assurivoFallbackVerificationUrl,
            label: 'Assurivo JSON 接口',
            preferFirstCode: false,
          });
        }
      } else {
        requests.push({
          url: verificationUrl,
          label: isAssurivoOpenVerificationUrl(verificationUrl) ? 'Assurivo 网页取件' : '自定义邮箱取码 URL',
          preferFirstCode: isAssurivoOpenVerificationUrl(verificationUrl),
          assurivoOpenPage: isAssurivoOpenVerificationUrl(verificationUrl),
        });
      }

      let lastError = null;
      for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
        const request = requests[requestIndex];
        await addLog(`步骤 ${step}：正在通过${request.label}获取${getVerificationCodeLabel(step)}验证码。`, 'info');
        const response = await fetcher(request.url, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          headers: {
            Accept: request.preferFirstCode ? 'text/html,application/xhtml+xml,application/json,text/plain,*/*' : 'application/json,text/plain,*/*',
            'Cache-Control': 'no-cache, no-store, max-age=0',
            Pragma: 'no-cache',
          },
        });
        const text = await response.text().catch(() => '');
        const payload = parseCustomEmailVerificationPayloadText(text);
        if (!response.ok) {
          const detail = describeCustomEmailVerificationPayload(payload);
          lastError = new Error(`步骤 ${step}：${request.label}请求失败，HTTP ${response.status}${detail ? `：${detail}` : ''}`);
          if (requestIndex < requests.length - 1) {
            await addLog(`${request.label}请求失败，将回退到下一种取码方式：${lastError.message}`, 'warn');
            continue;
          }
          throw lastError;
        }

        const code = extractCustomEmailVerificationCode(payload, {
          excludeCodes: options.excludeCodes || [],
          filterAfterTimestamp,
          preferFirstCode: request.preferFirstCode,
          assurivoOpenPage: request.assurivoOpenPage,
        });
        if (code) {
          await addLog(`步骤 ${step}：已通过${request.label}获取${getVerificationCodeLabel(step)}验证码：${code}`, 'ok');
          return {
            handled: true,
            code,
            emailTimestamp: Date.now(),
            targetEmail,
            verificationUrl: request.url,
          };
        }

        if (
          assurivoVerificationUrl
          && isAssurivoVerificationPayload(payload)
          && hasOnlyOlderTimestampedAssurivoEntries(payload.data, filterAfterTimestamp)
        ) {
          await addLog(`步骤 ${step}：${request.label}只返回了早于本轮发码时间的验证码邮件，将继续等待新邮件。`, 'warn');
        }
        const detail = describeCustomEmailVerificationPayload(payload);
        lastError = new Error(`步骤 ${step}：${request.label}暂未返回有效验证码${detail ? `：${detail}` : ''}`);
        if (requestIndex < requests.length - 1) {
          await addLog(`${request.label}暂未返回有效验证码，将回退到下一种取码方式。`, 'warn');
        }
      }

      throw lastError || new Error(`步骤 ${step}：自定义邮箱暂未返回有效验证码。`);
    }

    async function resolveCustomEmailVerificationStep(step, state = {}, options = {}) {
      const completionStep = getCompletionStep(step, options);
      activeVerificationLogStep = completionStep;
      const stateKey = getVerificationCodeStateKey(step);
      const rejectedCodes = new Set(
        [
          state?.[stateKey],
          ...(Array.isArray(options.excludeCodes) ? options.excludeCodes : []),
        ].map((code) => String(code || '').trim()).filter(Boolean)
      );
      const maxAttempts = Math.max(1, Math.min(5, Math.floor(Number(options.maxSubmitAttempts) || 5)));
      let lastRejectedText = '';
      let nextFilterAfterTimestamp = resolveInitialVerificationRequestedAt(step, state, options.filterAfterTimestamp);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const latestState = typeof getState === 'function'
          ? await getState().catch(() => null)
          : null;
        const attemptState = latestState && typeof latestState === 'object'
          ? { ...state, ...latestState }
          : state;
        await waitBeforeFetchingSignupVerificationCode(
          step,
          attemptState,
          attempt,
          maxAttempts,
          attempt > 1 ? '避免继续读取刚被拒绝的旧验证码' : '等待新邮件到达'
        );
        const result = await fetchCustomEmailVerificationCode(step, attemptState, {
          ...options,
          excludeCodes: [...rejectedCodes],
          filterAfterTimestamp: nextFilterAfterTimestamp || options.filterAfterTimestamp,
        });
        if (!result?.handled) {
          return {
            handled: false,
          };
        }

        throwIfStopped();
        const submitResult = await submitVerificationCode(step, result.code, options);
        if (submitResult.invalidCode) {
          rejectedCodes.add(result.code);
          lastRejectedText = submitResult.errorText || result.code;
          await addLog(`步骤 ${completionStep}：自定义邮箱取码 URL 返回的验证码被页面拒绝：${lastRejectedText}`, 'warn');
          if (attempt < maxAttempts) {
            try {
              const requestedAt = await requestVerificationCodeResend(step, options);
              nextFilterAfterTimestamp = requestedAt || Date.now();
              await addLog(`步骤 ${completionStep}：验证码被拒绝后已重新请求一封新的${getVerificationCodeLabel(step)}验证码。`, 'warn');
            } catch (err) {
              if (isStopError(err)) {
                throw err;
              }
              nextFilterAfterTimestamp = Date.now();
              await addLog(`步骤 ${completionStep}：验证码被拒绝后尝试重新发送失败，将继续等待邮箱新邮件：${err.message}`, 'warn');
            }
            continue;
          }
          throw new Error(`步骤 ${completionStep}：自定义邮箱取码 URL 返回的验证码连续被页面拒绝：${lastRejectedText}`);
        }

        await setState({
          lastEmailTimestamp: result.emailTimestamp,
          [stateKey]: result.code,
        });

        const completionNodeId = await getNodeIdForStep(completionStep);
        if (!completionNodeId) {
          throw new Error(`步骤 ${completionStep} 未映射到验证码节点。`);
        }
        await completeNodeFromBackground(completionNodeId, {
          emailTimestamp: result.emailTimestamp,
          code: result.code,
          phoneVerificationRequired: Boolean(submitResult.addPhonePage),
          ...(step === 4 && (submitResult?.passwordSubmittedAfterVerification || options.passwordSubmittedAfterVerification) ? { passwordSubmittedAfterVerification: true } : {}),
          ...(step === 4 && submitResult?.skipProfileStep ? { skipProfileStep: true } : {}),
          ...(step === 4 && submitResult?.skipProfileStepReason
            ? { skipProfileStepReason: submitResult.skipProfileStepReason }
            : {}),
        });

        return {
          handled: true,
          code: result.code,
          emailTimestamp: result.emailTimestamp,
          phoneVerificationRequired: Boolean(submitResult.addPhonePage),
          url: submitResult.url || '',
          verificationUrl: result.verificationUrl,
        };
      }

      throw new Error(`步骤 ${completionStep}：自定义邮箱取码 URL 未能提交有效验证码${lastRejectedText ? `：${lastRejectedText}` : ''}`);
    }

    async function fetchVerificationCodeOnly(step, state = {}, mail = null, options = {}) {
      const completionStep = getCompletionStep(step, options);
      activeVerificationLogStep = completionStep;
      const stateKey = getVerificationCodeStateKey(step);
      const rejectedCodes = new Set(
        [
          state?.[stateKey],
          ...(Array.isArray(options.excludeCodes) ? options.excludeCodes : []),
        ].map((code) => String(code || '').trim()).filter(Boolean)
      );

      const customResult = await fetchCustomEmailVerificationCode(step, state, {
        ...options,
        excludeCodes: [...rejectedCodes],
      });
      if (customResult?.handled) {
        return {
          ...customResult,
          handled: true,
          stateKey,
        };
      }

      if (!mail || mail.provider === 'custom') {
        return {
          handled: false,
          stateKey,
          targetEmail: customResult?.targetEmail || options.targetEmail || '',
        };
      }

      const {
        completionStep: _completionStep,
        promptStep: _promptStep,
        maxSubmitAttempts: _maxSubmitAttempts,
        password: _password,
        signupProfile: _signupProfile,
        ...pollOverrides
      } = options;
      const result = await pollFreshVerificationCode(step, state, mail, {
        ...pollOverrides,
        excludeCodes: [...rejectedCodes],
      });
      return {
        ...(result || {}),
        handled: true,
        stateKey,
      };
    }

    async function resolveVerificationStep(step, state, mail, options = {}) {
      const completionStep = getCompletionStep(step, options);
      activeVerificationLogStep = completionStep;
      const stateKey = getVerificationCodeStateKey(step);
      const rejectedCodes = new Set();
      const hotmailPollConfig = mail.provider === HOTMAIL_PROVIDER
        ? getHotmailVerificationPollConfig(step)
        : null;
      const beforeSubmit = typeof options.beforeSubmit === 'function'
        ? options.beforeSubmit
        : null;
      const ignorePersistedLastCode = Boolean(hotmailPollConfig?.ignorePersistedLastCode);
      if (state[stateKey] && !ignorePersistedLastCode) {
        rejectedCodes.add(state[stateKey]);
      }

      let nextFilterAfterTimestamp = options.filterAfterTimestamp ?? null;
      const requestFreshCodeFirst = options.requestFreshCodeFirst !== undefined
        ? Boolean(options.requestFreshCodeFirst)
        : (hotmailPollConfig?.requestFreshCodeFirst ?? false);
      let remainingAutomaticResendCount = options.maxResendRequests !== undefined
        ? normalizeVerificationResendCount(
          options.maxResendRequests,
          getLegacyVerificationResendCountDefault(step, { requestFreshCodeFirst })
        )
        : getConfiguredVerificationResendCount(step, state, { requestFreshCodeFirst });
      const maxSubmitAttempts = mail.provider === LUCKMAIL_PROVIDER ? 3 : 15;
      const resendIntervalMs = Math.max(0, Number(options.resendIntervalMs) || 0);
      const externalOnResendRequestedAt = typeof options.onResendRequestedAt === 'function'
        ? options.onResendRequestedAt
        : null;
      let lastResendAt = resolveInitialVerificationRequestedAt(
        step,
        state,
        Number(options.lastResendAt) || 0
      );

      const updateFilterAfterTimestampForVerificationStep = async (requestedAt) => {
        if (externalOnResendRequestedAt) {
          try {
            await externalOnResendRequestedAt(requestedAt);
          } catch (_) {
            // Keep resend flow best-effort; state sync callback failures should not break verification.
          }
        }
        return nextFilterAfterTimestamp;
      };

      await clear2925MailboxBeforePolling(step, mail, options);

      if (requestFreshCodeFirst) {
        if (remainingAutomaticResendCount <= 0) {
          await addLog(`步骤 ${step}：当前自动重新发送验证码次数为 0，将直接使用当前时间窗口轮询邮箱。`, 'info');
        } else {
          try {
            lastResendAt = await requestVerificationCodeResend(step, options);
            remainingAutomaticResendCount -= 1;
            await updateFilterAfterTimestampForVerificationStep(lastResendAt);
            await addLog(`步骤 ${step}：已先请求一封新的${getVerificationCodeLabel(step)}验证码，再开始轮询邮箱。`, 'warn');
          } catch (err) {
            if (isStopError(err)) {
              throw err;
            }
            await addLog(`步骤 ${step}：首次重新获取验证码失败：${err.message}，将继续使用当前时间窗口轮询。`, 'warn');
          }
        }
      }

      if (mail.provider === HOTMAIL_PROVIDER) {
          const initialDelayMs = Number(options.initialDelayMs ?? hotmailPollConfig.initialDelayMs) || 0;
          if (initialDelayMs > 0) {
            const remainingMs = await getRemainingTimeBudgetMs(
              step,
              options,
              `等待${getVerificationCodeLabel(step)}验证码邮件到达`
            );
            const delayMs = remainingMs === null
              ? initialDelayMs
              : Math.min(initialDelayMs, Math.max(0, remainingMs));
            await addLog(`步骤 ${step}：等待 ${Math.round(initialDelayMs / 1000)} 秒，让 Hotmail 验证码邮件先到达...`, 'info');
            await sleepWithStop(delayMs);
          }
        }

        for (let attempt = 1; attempt <= maxSubmitAttempts; attempt++) {
          await waitBeforeFetchingSignupVerificationCode(
            step,
            state,
            attempt,
            maxSubmitAttempts,
            attempt > 1 ? '避免继续读取刚被拒绝的旧验证码' : '等待新邮件到达'
          );
          const pollOptions = {
            excludeCodes: [...rejectedCodes],
            disableTimeBudgetCap: Boolean(options.disableTimeBudgetCap),
            getRemainingTimeMs: options.getRemainingTimeMs,
            maxResendRequests: remainingAutomaticResendCount,
            initialPollMaxAttempts: mail.provider === '2925' && rejectedCodes.size > 0
              ? undefined
              : options.initialPollMaxAttempts,
            pollAttemptPlan: mail.provider === '2925' && rejectedCodes.size > 0
              ? undefined
              : options.pollAttemptPlan,
            resendIntervalMs,
            lastResendAt,
            onResendRequestedAt: updateFilterAfterTimestampForVerificationStep,
          };
          if (nextFilterAfterTimestamp !== null && nextFilterAfterTimestamp !== undefined) {
            pollOptions.filterAfterTimestamp = nextFilterAfterTimestamp;
          }
          const result = await pollFreshVerificationCode(step, state, mail, pollOptions);
          lastResendAt = Number(result?.lastResendAt) || lastResendAt;
          remainingAutomaticResendCount = normalizeVerificationResendCount(
            result?.remainingResendRequests,
            remainingAutomaticResendCount
          );

          throwIfStopped();
          await addLog(`步骤 ${step}：已获取${getVerificationCodeLabel(step)}验证码：${result.code}`);
          if (beforeSubmit) {
            await beforeSubmit(result, {
              attempt,
              rejectedCodes: new Set(rejectedCodes),
              filterAfterTimestamp: nextFilterAfterTimestamp ?? undefined,
              lastResendAt,
            });
          }
          throwIfStopped();
          const submitResult = await submitVerificationCode(step, result.code, options);

          if (submitResult.invalidCode) {
            rejectedCodes.add(result.code);
            await addLog(`步骤 ${step}：验证码被页面拒绝：${submitResult.errorText || result.code}`, 'warn');

            if (attempt >= maxSubmitAttempts) {
              throw new Error(`步骤 ${step}：验证码连续失败，已达到 ${maxSubmitAttempts} 次重试上限。`);
            }

            if (mail.provider === LUCKMAIL_PROVIDER) {
              await addLog(`步骤 ${step}：LuckMail 验证码提交失败，等待 15 秒后重新轮询 /code 接口（${attempt + 1}/${maxSubmitAttempts}）...`, 'warn');
              await sleepWithStop(15000);
              continue;
            }

            if (remainingAutomaticResendCount <= 0) {
              await addLog(`步骤 ${step}：已达到自动重新发送验证码次数上限，将排除已拒绝验证码并继续轮询新邮件。`, 'warn');
              continue;
            }

            lastResendAt = await requestVerificationCodeResend(step, options);
            remainingAutomaticResendCount -= 1;
            await updateFilterAfterTimestampForVerificationStep(lastResendAt);
            await addLog(`步骤 ${step}：提交失败后已请求新验证码（${attempt + 1}/${maxSubmitAttempts}）...`, 'warn');
            continue;
          }

          await setState({
            lastEmailTimestamp: result.emailTimestamp,
            [stateKey]: result.code,
          });

          const completionNodeId = await getNodeIdForStep(completionStep);
          if (!completionNodeId) {
            throw new Error(`步骤 ${completionStep} 未映射到验证码节点。`);
          }
          await completeNodeFromBackground(completionNodeId, {
            emailTimestamp: result.emailTimestamp,
            code: result.code,
            phoneVerificationRequired: Boolean(submitResult.addPhonePage),
            ...(step === 4 && (submitResult?.passwordSubmittedAfterVerification || options.passwordSubmittedAfterVerification) ? { passwordSubmittedAfterVerification: true } : {}),
            ...(step === 4 && submitResult?.skipProfileStep ? { skipProfileStep: true } : {}),
            ...(step === 4 && submitResult?.skipProfileStepReason
              ? { skipProfileStepReason: submitResult.skipProfileStepReason }
              : {}),
          });
          triggerPostSuccessMailboxCleanup(step, mail);
          return {
            phoneVerificationRequired: Boolean(submitResult.addPhonePage),
            url: submitResult.url || '',
          };
        }
      }

      return {
        confirmCustomVerificationStepBypass,
        getVerificationCodeLabel,
        getVerificationCodeStateKey,
        getVerificationPollPayload,
        pollFreshVerificationCode,
        pollFreshVerificationCodeWithResendInterval,
        fetchVerificationCodeOnly,
        requestVerificationCodeResend,
        resolveCustomEmailVerificationStep,
        resolveVerificationStep,
        submitVerificationCode,
        __test: {
          extractCustomEmailVerificationCode,
          fetchCustomEmailVerificationCode,
          fetchVerificationCodeOnly,
          buildAssurivoVerificationUrl,
          getCustomEmailVerificationEntry,
          normalizeCustomEmailVerificationUrl,
          parseCustomEmailPoolEntryValue,
        },
      };
    }

    return {
      createVerificationFlowHelpers,
    };
  });
