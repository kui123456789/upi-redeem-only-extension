(function moemailUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.MoemailUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createMoemailUtils() {
  const DEFAULT_MAIL_PAGE_SIZE = 20;

  function firstNonEmptyString(values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeMoemailBaseUrl(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(candidate);
      parsed.hash = '';
      parsed.search = '';
      const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
      return `${parsed.origin}${pathname}`;
    } catch {
      return '';
    }
  }

  function normalizeMoemailDomain(rawValue = '') {
    let value = String(rawValue || '').trim().toLowerCase();
    if (!value) return '';
    value = value.replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value : '';
  }

  function normalizeMoemailDomains(values) {
    const domains = [];
    const seen = new Set();
    const source = Array.isArray(values)
      ? values
      : (typeof values === 'string'
        ? values.split(/[\s,，;；]+/)
        : (values && typeof values === 'object' ? Object.values(values) : []));
    for (const value of source) {
      if (typeof value === 'string' && /[\s,，;；]/.test(value)) {
        for (const piece of value.split(/[\s,，;；]+/)) {
          const normalizedPiece = normalizeMoemailDomain(piece);
          if (!normalizedPiece || seen.has(normalizedPiece)) continue;
          seen.add(normalizedPiece);
          domains.push(normalizedPiece);
        }
        continue;
      }
      const candidate = typeof value === 'object' && value
        ? (value.domain || value.name || value.value || '')
        : value;
      const normalized = normalizeMoemailDomain(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      domains.push(normalized);
    }
    return domains;
  }

  function normalizeMoemailAddress(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function buildMoemailHeaders(config = {}, options = {}) {
    const headers = {};
    const apiKey = firstNonEmptyString([
      config.apiKey,
      config.moemailApiKey,
      options.apiKey,
    ]);
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    if (options.json) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.acceptJson !== false) {
      headers.Accept = 'application/json';
    }
    return headers;
  }

  function joinMoemailUrl(baseUrl, path) {
    const normalizedBase = normalizeMoemailBaseUrl(baseUrl);
    const normalizedPath = String(path || '').trim();
    if (!normalizedBase || !normalizedPath) return normalizedBase || '';
    return `${normalizedBase}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
  }

  function getArrayCandidates(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (
      payload.id !== undefined
      && (
        payload.subject !== undefined
        || payload.from_address !== undefined
        || payload.email !== undefined
        || payload.address !== undefined
      )
    ) {
      return [payload];
    }
    const candidates = [
      payload.data,
      payload.items,
      payload.rows,
      payload.results,
      payload.list,
      payload.records,
      payload.emails,
      payload.messages,
      payload.message ? [payload.message] : null,
      payload?.data?.items,
      payload?.data?.rows,
      payload?.data?.results,
      payload?.data?.list,
      payload?.data?.records,
      payload?.data?.emails,
      payload?.data?.messages,
      payload?.data?.message ? [payload.data.message] : null,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  function stripHtmlTags(value = '') {
    return String(value || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeMoemailDate(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      const numeric = value < 1e12 ? value * 1000 : value;
      return new Date(numeric).toISOString();
    }
    const source = String(value).trim();
    if (!source) return '';
    const parsed = Date.parse(source);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : source;
  }

  function extractMoemailMessageBody(row = {}) {
    return firstNonEmptyString([
      row.text,
      row.text_content,
      row.textBody,
      row.plainText,
      row.bodyText,
      row.body?.text,
      row.contentText,
      stripHtmlTags(firstNonEmptyString([
        row.html,
        row.html_content,
        row.htmlBody,
        row.bodyHtml,
        row.body?.html,
        row.content,
      ])),
      row.snippet,
      row.preview,
    ]);
  }

  function normalizeMoemailMailbox(row = {}) {
    if (!row || typeof row !== 'object') return null;
    const address = normalizeMoemailAddress(firstNonEmptyString([
      row.email,
      row.address,
      row.mailbox,
      row.mailAddress,
      row.account,
      row.username && row.domain ? `${row.username}@${row.domain}` : '',
    ]));
    if (!address) return null;
    return {
      id: firstNonEmptyString([row.id, row.emailId, row.mailboxId, row.addressId]),
      address,
      raw: row,
    };
  }

  function normalizeMoemailMessage(row = {}) {
    if (!row || typeof row !== 'object') return null;
    const htmlContent = firstNonEmptyString([
      row.html,
      row.htmlBody,
      row.bodyHtml,
      row.body?.html,
      row.content,
    ]);
    const textContent = extractMoemailMessageBody(row);
    const code = firstNonEmptyString([row.verificationCode, row.verification_code, row.code]);
    const bodyPreview = [code, textContent || stripHtmlTags(htmlContent)].filter(Boolean).join(' ').trim();
    return {
      id: firstNonEmptyString([row.id, row.messageId, row.mailId]),
      address: normalizeMoemailAddress(firstNonEmptyString([
        row.email,
        row.address,
        row.to,
        row.recipient,
        row.mailbox,
      ])),
      subject: firstNonEmptyString([row.subject, row.title]),
      from: {
        emailAddress: {
          address: firstNonEmptyString([
            row.from?.address,
            row.from?.email,
            row.from_address,
            row.fromAddress,
            row.from,
            row.sender,
            row.senderEmail,
            row.mailFrom,
          ]),
        },
      },
      bodyPreview,
      raw: htmlContent || textContent || code || '',
      receivedDateTime: normalizeMoemailDate(firstNonEmptyString([
        row.createdAt,
        row.created_at,
        row.receivedAt,
        row.received_at,
        row.date,
        row.timestamp,
      ])),
    };
  }

  function normalizeMoemailMailboxes(payload) {
    return getArrayCandidates(payload).map((row) => normalizeMoemailMailbox(row)).filter(Boolean);
  }

  function normalizeMoemailMessages(payload) {
    return getArrayCandidates(payload).map((row) => normalizeMoemailMessage(row)).filter(Boolean);
  }

  function getMoemailAddressFromResponse(payload = {}) {
    return firstNonEmptyString([
      payload.email,
      payload.address,
      payload.data?.email,
      payload.data?.address,
      payload.data?.mailbox,
    ]);
  }

  function getMoemailEmailIdFromResponse(payload = {}) {
    return firstNonEmptyString([
      payload.id,
      payload.emailId,
      payload.data?.id,
      payload.data?.emailId,
      payload.data?.mailboxId,
    ]);
  }

  function getMoemailNextCursor(payload = {}) {
    return firstNonEmptyString([
      payload.nextCursor,
      payload.cursor,
      payload.next,
      payload?.data?.nextCursor,
      payload?.data?.cursor,
      payload?.data?.next,
      payload?.meta?.nextCursor,
      payload?.meta?.cursor,
    ]);
  }

  return {
    DEFAULT_MAIL_PAGE_SIZE,
    buildMoemailHeaders,
    extractMoemailMessageBody,
    getMoemailAddressFromResponse,
    getMoemailEmailIdFromResponse,
    getMoemailNextCursor,
    joinMoemailUrl,
    normalizeMoemailAddress,
    normalizeMoemailBaseUrl,
    normalizeMoemailDate,
    normalizeMoemailDomain,
    normalizeMoemailDomains,
    normalizeMoemailMailboxes,
    normalizeMoemailMessage,
    normalizeMoemailMessages,
  };
});
