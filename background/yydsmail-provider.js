(function yydsMailProviderModule(root, factory) {
  root.MultiPageBackgroundYydsMailProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createYydsMailProviderModule() {
  function createYydsMailProvider(deps = {}) {
    const {
      addLog = async () => {},
      buildYydsMailHeaders,
      DEFAULT_MESSAGE_LIMIT = 50,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getState = async () => ({}),
      getYydsMailAddressFromResponse,
      joinYydsMailUrl,
      normalizeYydsMailAddress,
      normalizeYydsMailBaseUrl,
      normalizeYydsMailDomain,
      normalizeYydsMailMessages,
      persistRegistrationEmailState = null,
      pickVerificationMessageWithTimeFallback,
      setEmailState = async () => {},
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
      YYDSMAIL_GENERATOR = 'yydsmail',
      YYDSMAIL_PROVIDER = 'yydsmail',
    } = deps;

    async function persistResolvedEmailState(state = null, email, options = {}) {
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, options);
        return;
      }
      await setEmailState(email, options);
    }

    function getYydsMailConfig(state = {}) {
      return {
        baseUrl: normalizeYydsMailBaseUrl(state.yydsMailBaseUrl),
        apiKey: String(state.yydsMailApiKey || '').trim(),
        domain: normalizeYydsMailDomain(state.yydsMailDomain),
      };
    }

    function ensureYydsMailConfig(state, options = {}) {
      const { requireApiKey = false } = options;
      const config = getYydsMailConfig(state);
      if (!config.baseUrl) {
        throw new Error('YYDS Mail API 地址为空或格式无效。');
      }
      if (requireApiKey && !config.apiKey) {
        throw new Error('YYDS Mail API Key 为空。');
      }
      return config;
    }

    async function requestYydsMailJson(config, path, options = {}) {
      if (!fetchImpl) {
        throw new Error('YYDS Mail 当前运行环境不支持 fetch。');
      }
      const {
        method = 'GET',
        payload,
        searchParams,
        timeoutMs = 20000,
      } = options;
      const url = new URL(joinYydsMailUrl(config.baseUrl, path));
      if (searchParams && typeof searchParams === 'object') {
        for (const [key, value] of Object.entries(searchParams)) {
          if (value === undefined || value === null || value === '') continue;
          url.searchParams.set(key, String(value));
        }
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers: buildYydsMailHeaders(config, {
            json: payload !== undefined,
          }),
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        const message = err?.name === 'AbortError'
          ? `YYDS Mail 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
          : `YYDS Mail 请求失败：${err?.message || err}`;
        throw new Error(message);
      } finally {
        clearTimeout(timeoutId);
      }

      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = text;
      }
      if (!response.ok) {
        const payloadError = typeof parsed === 'object' && parsed
          ? (parsed.message || parsed.error || parsed.msg || parsed.details)
          : '';
        const status = Number(response.status);
        if (status === 401 || status === 403) {
          throw new Error('YYDS Mail API Key 无效、缺失或已过期。');
        }
        throw new Error(`YYDS Mail 请求失败：${payloadError || text || `HTTP ${status}`}`);
      }
      return parsed;
    }

    async function fetchYydsMailAddress(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const config = ensureYydsMailConfig(latestState, { requireApiKey: true });
      const localPart = String(options.localPart || options.name || '').trim().toLowerCase();
      const payload = {
        ...(localPart ? { localPart } : {}),
        ...(config.domain ? { domain: config.domain } : {}),
      };
      const result = await requestYydsMailJson(config, '/v1/accounts', {
        method: 'POST',
        payload,
      });
      const address = normalizeYydsMailAddress(getYydsMailAddressFromResponse(result));
      if (!address) {
        throw new Error('YYDS Mail 未返回可用邮箱地址。');
      }
      await persistResolvedEmailState(latestState, address, {
        source: 'generated:yydsmail',
        preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
      });
      await addLog(`YYDS Mail：已生成 ${address}`, 'ok');
      return address;
    }

    function resolveYydsMailPollTargetEmail(state = {}, pollPayload = {}) {
      const mailProvider = String(state?.mailProvider || '').trim().toLowerCase();
      const emailGenerator = String(state?.emailGenerator || '').trim().toLowerCase();
      const shouldUseCurrentEmail = mailProvider === YYDSMAIL_PROVIDER
        && emailGenerator !== YYDSMAIL_GENERATOR;
      if (shouldUseCurrentEmail) {
        return normalizeYydsMailAddress(state.email);
      }
      return normalizeYydsMailAddress(pollPayload.targetEmail)
        || normalizeYydsMailAddress(state.email);
    }

    async function listYydsMailMessages(state, options = {}) {
      const latestState = state || await getState();
      const config = ensureYydsMailConfig(latestState, { requireApiKey: true });
      const address = normalizeYydsMailAddress(options.address || latestState.email);
      if (!address) {
        throw new Error('YYDS Mail 轮询前缺少目标邮箱地址，请先生成或填写注册邮箱。');
      }
      const payload = await requestYydsMailJson(config, '/v1/messages', {
        searchParams: {
          address,
          limit: Number(options.limit) || DEFAULT_MESSAGE_LIMIT,
        },
      });
      return {
        config,
        address,
        messages: normalizeYydsMailMessages(payload),
      };
    }

    async function getYydsMailMessageDetail(state, messageId) {
      const latestState = state || await getState();
      const config = ensureYydsMailConfig(latestState, { requireApiKey: true });
      return requestYydsMailJson(config, `/v1/messages/${encodeURIComponent(messageId)}`);
    }

    async function enrichYydsMailMatchWithDetail(state, matchResult = {}) {
      const match = matchResult?.match;
      if (!match?.message?.id || match?.raw) {
        return matchResult;
      }
      try {
        const detail = await getYydsMailMessageDetail(state, match.message.id);
        const detailMessage = normalizeYydsMailMessages(detail)[0];
        if (!detailMessage) {
          return matchResult;
        }
        return {
          ...matchResult,
          match: {
            ...match,
            message: detailMessage,
            raw: detailMessage.raw || match.raw,
            receivedAt: match.receivedAt || detailMessage.receivedAt || match.message?.receivedAt,
            code: match.code,
          },
        };
      } catch (error) {
        await addLog(`YYDS Mail：读取邮件正文失败，继续使用邮件列表预览匹配验证码：${error.message}`, 'warn');
        return matchResult;
      }
    }

    async function hydrateYydsMailMessagesWithDetails(state, messages = [], maxDetails = 3) {
      const sourceMessages = Array.isArray(messages) ? messages : [];
      const result = [...sourceMessages];
      let hydratedCount = 0;
      for (let index = 0; index < result.length && hydratedCount < maxDetails; index += 1) {
        const current = result[index];
        const messageId = String(current?.id || '').trim();
        if (!messageId) {
          continue;
        }
        try {
          const detail = await getYydsMailMessageDetail(state, messageId);
          const detailMessage = normalizeYydsMailMessages(detail)[0];
          if (!detailMessage) {
            continue;
          }
          result[index] = {
            ...current,
            ...detailMessage,
            id: detailMessage.id || current.id,
            address: detailMessage.address || current.address,
            subject: detailMessage.subject || current.subject,
            from: detailMessage.from?.emailAddress?.address
              ? detailMessage.from
              : current.from,
            bodyPreview: detailMessage.bodyPreview || current.bodyPreview,
            raw: detailMessage.raw || current.raw,
            receivedDateTime: detailMessage.receivedDateTime || current.receivedDateTime,
          };
          hydratedCount += 1;
        } catch (error) {
          await addLog(`YYDS Mail：读取邮件正文失败，继续使用预览匹配：${error.message}`, 'warn');
        }
      }
      return result;
    }

    async function pollYydsMailVerificationCode(step, state, pollPayload = {}) {
      const latestState = state || await getState();
      ensureYydsMailConfig(latestState, { requireApiKey: true });
      const targetEmail = resolveYydsMailPollTargetEmail(latestState, pollPayload);
      if (!targetEmail) {
        throw new Error('YYDS Mail 轮询前缺少目标邮箱地址，请先生成或填写注册邮箱。');
      }
      await addLog(`步骤 ${step}：正在轮询 YYDS Mail 邮件（${targetEmail}）...`, 'info');
      const maxAttempts = Number(pollPayload.maxAttempts) || 5;
      const intervalMs = Number(pollPayload.intervalMs) || 3000;
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfStopped();
        try {
          const { messages } = await listYydsMailMessages(latestState, {
            address: targetEmail,
            limit: pollPayload.limit || DEFAULT_MESSAGE_LIMIT,
          });
          const buildMatchResult = (inputMessages) => pickVerificationMessageWithTimeFallback(inputMessages, {
            afterTimestamp: pollPayload.filterAfterTimestamp || 0,
            senderFilters: pollPayload.senderFilters || [],
            subjectFilters: pollPayload.subjectFilters || [],
            requiredKeywords: pollPayload.requiredKeywords || [],
            codePatterns: pollPayload.codePatterns || [],
            excludeCodes: pollPayload.excludeCodes || [],
          });
          let matchResult = buildMatchResult(messages);
          if (!matchResult?.match?.code) {
            const hydratedMessages = await hydrateYydsMailMessagesWithDetails(latestState, messages);
            matchResult = buildMatchResult(hydratedMessages);
          }
          matchResult = await enrichYydsMailMatchWithDetail(latestState, matchResult);
          const match = matchResult.match;
          if (match?.code) {
            return {
              ok: true,
              code: match.code,
              emailTimestamp: match.receivedAt || Date.now(),
              mailId: match.message?.id || '',
            };
          }
          lastError = new Error(`步骤 ${step}：暂未在 YYDS Mail 中找到匹配验证码（${attempt}/${maxAttempts}）。`);
          await addLog(lastError.message, attempt === maxAttempts ? 'warn' : 'info');
        } catch (err) {
          lastError = err;
          await addLog(`步骤 ${step}：YYDS Mail 轮询失败：${err.message}`, 'warn');
        }
        if (attempt < maxAttempts) {
          await sleepWithStop(intervalMs);
        }
      }

      throw lastError || new Error(`步骤 ${step}：未在 YYDS Mail 中找到新的匹配验证码。`);
    }

    return {
      ensureYydsMailConfig,
      fetchYydsMailAddress,
      getYydsMailConfig,
      getYydsMailMessageDetail,
      listYydsMailMessages,
      pollYydsMailVerificationCode,
      requestYydsMailJson,
      resolveYydsMailPollTargetEmail,
    };
  }

  return { createYydsMailProvider };
});
