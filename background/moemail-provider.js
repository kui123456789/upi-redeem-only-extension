(function moemailProviderModule(root, factory) {
  root.MultiPageBackgroundMoemailProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createMoemailProviderModule() {
  function createMoemailProvider(deps = {}) {
    const {
      addLog = async () => {},
      buildMoemailHeaders,
      DEFAULT_MAIL_PAGE_SIZE = 20,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getMoemailAddressFromResponse,
      getMoemailEmailIdFromResponse,
      getMoemailNextCursor,
      getState = async () => ({}),
      joinMoemailUrl,
      MOEMAIL_GENERATOR = 'moemail',
      MOEMAIL_PROVIDER = 'moemail',
      normalizeMoemailAddress,
      normalizeMoemailBaseUrl,
      normalizeMoemailDomain,
      normalizeMoemailDomains,
      normalizeMoemailMailboxes,
      normalizeMoemailMessages,
      persistRegistrationEmailState = null,
      pickVerificationMessageWithTimeFallback,
      setEmailState = async () => {},
      setPersistentSettings = async () => {},
      setState = async () => {},
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
    } = deps;

    const LOOKUP_MAX_PAGES = 20;

    async function persistResolvedEmailState(state = null, email, options = {}) {
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, options);
        return;
      }
      await setEmailState(email, options);
    }

    function getMoemailConfig(state = {}) {
      return {
        baseUrl: normalizeMoemailBaseUrl(state.moemailBaseUrl),
        apiKey: String(state.moemailApiKey || '').trim(),
        domain: normalizeMoemailDomain(state.moemailDomain),
        domains: normalizeMoemailDomains(state.moemailDomains),
        emailId: String(state.moemailEmailId || '').trim(),
      };
    }

    function ensureMoemailConfig(state, options = {}) {
      const { requireApiKey = false } = options;
      const config = getMoemailConfig(state);
      if (!config.baseUrl) {
        throw new Error('MoeMail API 地址为空或格式无效。');
      }
      if (requireApiKey && !config.apiKey) {
        throw new Error('MoeMail API Key 为空。');
      }
      return config;
    }

    async function requestMoemailJson(config, path, options = {}) {
      if (!fetchImpl) {
        throw new Error('MoeMail 当前运行环境不支持 fetch。');
      }
      const {
        method = 'GET',
        payload,
        searchParams,
        timeoutMs = 20000,
      } = options;
      const url = new URL(joinMoemailUrl(config.baseUrl, path));
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
          headers: buildMoemailHeaders(config, {
            json: payload !== undefined,
          }),
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        const message = err?.name === 'AbortError'
          ? `MoeMail 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
          : `MoeMail 请求失败：${err?.message || err}`;
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
          throw new Error('MoeMail API Key 无效或当前角色无 OpenAPI 权限。');
        }
        throw new Error(`MoeMail 请求失败：${payloadError || text || `HTTP ${status}`}`);
      }
      return parsed;
    }

    async function fetchMoemailDomains(state = null) {
      const latestState = state || await getState();
      const config = ensureMoemailConfig(latestState, { requireApiKey: true });
      const payload = await requestMoemailJson(config, '/api/config');
      const domains = normalizeMoemailDomains([
        ...(Array.isArray(payload?.domains) ? payload.domains : []),
        ...(Array.isArray(payload?.data?.domains) ? payload.data.domains : []),
        ...(Array.isArray(payload?.config?.domains) ? payload.config.domains : []),
        payload?.emailDomains,
        payload?.data?.emailDomains,
        payload?.config?.emailDomains,
      ]);
      if (domains.length) {
        await setPersistentSettings({
          moemailDomains: domains,
          moemailDomain: config.domain || domains[0],
        });
        await setState({
          moemailDomains: domains,
          moemailDomain: config.domain || domains[0],
        });
      }
      return domains;
    }

    async function fetchMoemailAddress(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const config = ensureMoemailConfig(latestState, { requireApiKey: true });
      const domains = config.domains.length
        ? config.domains
        : await fetchMoemailDomains(latestState);
      const activeDomain = config.domain || domains[0] || '';
      if (!activeDomain) {
        throw new Error('MoeMail 未返回可用域名，请先检查实例配置。');
      }
      const localPart = String(options.localPart || options.name || '').trim().toLowerCase();
      const payload = {
        name: localPart || undefined,
        domain: activeDomain,
        expiryTime: 0,
      };
      const result = await requestMoemailJson(config, '/api/emails/generate', {
        method: 'POST',
        payload,
      });
      const address = normalizeMoemailAddress(getMoemailAddressFromResponse(result));
      const emailId = String(getMoemailEmailIdFromResponse(result) || '').trim();
      if (!address) {
        throw new Error('MoeMail 未返回可用邮箱地址。');
      }
      if (!emailId) {
        throw new Error('MoeMail 未返回邮箱 ID，无法后续轮询验证码。');
      }
      await setPersistentSettings({
        moemailEmailId: emailId,
        moemailDomain: activeDomain,
      });
      await setState({
        moemailEmailId: emailId,
        moemailDomain: activeDomain,
      });
      await persistResolvedEmailState(latestState, address, {
        source: 'generated:moemail',
        preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
        moemailEmailId: emailId,
      });
      await addLog(`MoeMail：已生成 ${address}`, 'ok');
      return address;
    }

    function resolveMoemailPollTargetEmail(state = {}, pollPayload = {}) {
      const mailProvider = String(state?.mailProvider || '').trim().toLowerCase();
      const emailGenerator = String(state?.emailGenerator || '').trim().toLowerCase();
      const shouldUseCurrentEmail = mailProvider === MOEMAIL_PROVIDER
        && emailGenerator !== MOEMAIL_GENERATOR;
      if (shouldUseCurrentEmail) {
        return normalizeMoemailAddress(state.email);
      }
      return normalizeMoemailAddress(pollPayload.targetEmail)
        || normalizeMoemailAddress(state.email);
    }

    async function listMoemailMailboxes(state, options = {}) {
      const latestState = state || await getState();
      const config = ensureMoemailConfig(latestState, { requireApiKey: true });
      const payload = await requestMoemailJson(config, '/api/emails', {
        searchParams: {
          cursor: options.cursor || undefined,
          limit: Number(options.limit) || DEFAULT_MAIL_PAGE_SIZE,
        },
      });
      return {
        config,
        cursor: getMoemailNextCursor(payload),
        mailboxes: normalizeMoemailMailboxes(payload),
      };
    }

    async function resolveMoemailEmailId(state, options = {}) {
      const latestState = state || await getState();
      const targetEmail = normalizeMoemailAddress(options.targetEmail || latestState.email);
      if (!targetEmail) {
        throw new Error('MoeMail 轮询前缺少目标邮箱地址，请先生成或填写注册邮箱。');
      }
      const currentStateEmail = normalizeMoemailAddress(latestState.email);
      const cachedEmailId = String(latestState.moemailEmailId || '').trim();
      if (cachedEmailId && targetEmail === currentStateEmail) {
        return cachedEmailId;
      }

      let cursor = String(options.cursor || '').trim();
      for (let page = 1; page <= LOOKUP_MAX_PAGES; page += 1) {
        throwIfStopped();
        const { mailboxes, cursor: nextCursor } = await listMoemailMailboxes(latestState, {
          cursor,
          limit: options.limit || DEFAULT_MAIL_PAGE_SIZE,
        });
        const matched = mailboxes.find((item) => item.address === targetEmail);
        if (matched?.id) {
          if (targetEmail === currentStateEmail) {
            await setPersistentSettings({ moemailEmailId: matched.id });
            await setState({ moemailEmailId: matched.id });
          }
          return matched.id;
        }
        if (!nextCursor || nextCursor === cursor) {
          break;
        }
        cursor = nextCursor;
      }

      throw new Error(`未在 MoeMail 中找到邮箱 ${targetEmail}，请确认该邮箱已存在于当前实例。`);
    }

    async function listMoemailMessages(state, options = {}) {
      const latestState = state || await getState();
      const config = ensureMoemailConfig(latestState, { requireApiKey: true });
      const emailId = String(options.emailId || '').trim()
        || await resolveMoemailEmailId(latestState, {
          targetEmail: options.address || latestState.email,
        });
      const payload = await requestMoemailJson(config, `/api/emails/${encodeURIComponent(emailId)}`, {
        searchParams: {
          cursor: options.cursor || undefined,
          limit: Number(options.limit) || DEFAULT_MAIL_PAGE_SIZE,
        },
      });
      return {
        config,
        emailId,
        cursor: getMoemailNextCursor(payload),
        messages: normalizeMoemailMessages(payload),
      };
    }

    async function getMoemailMessageDetail(state, emailId, messageId) {
      const latestState = state || await getState();
      const config = ensureMoemailConfig(latestState, { requireApiKey: true });
      return requestMoemailJson(config, `/api/emails/${encodeURIComponent(emailId)}/${encodeURIComponent(messageId)}`);
    }

    async function enrichMoemailMatchWithDetail(state, emailId, matchResult = {}) {
      const match = matchResult?.match;
      if (!match?.message?.id || match?.raw) {
        return matchResult;
      }
      try {
        const detail = await getMoemailMessageDetail(state, emailId, match.message.id);
        const detailMessage = normalizeMoemailMessages(detail)[0];
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
        await addLog(`MoeMail：读取邮件正文失败，继续使用邮件列表预览匹配验证码：${error.message}`, 'warn');
        return matchResult;
      }
    }

    async function hydrateMoemailMessagesWithDetails(state, emailId, messages = [], maxDetails = 3) {
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
          const detail = await getMoemailMessageDetail(state, emailId, messageId);
          const detailMessage = normalizeMoemailMessages(detail)[0];
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
          await addLog(`MoeMail：读取邮件正文失败，继续使用预览匹配：${error.message}`, 'warn');
        }
      }
      return result;
    }

    async function pollMoemailVerificationCode(step, state, pollPayload = {}) {
      const latestState = state || await getState();
      ensureMoemailConfig(latestState, { requireApiKey: true });
      const targetEmail = resolveMoemailPollTargetEmail(latestState, pollPayload);
      if (!targetEmail) {
        throw new Error('MoeMail 轮询前缺少目标邮箱地址，请先生成或填写注册邮箱。');
      }
      const emailId = await resolveMoemailEmailId(latestState, { targetEmail });
      await addLog(`步骤 ${step}：正在轮询 MoeMail 邮件（${targetEmail}）...`, 'info');
      const maxAttempts = Number(pollPayload.maxAttempts) || 5;
      const intervalMs = Number(pollPayload.intervalMs) || 3000;
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfStopped();
        try {
          const { messages } = await listMoemailMessages(latestState, {
            emailId,
            address: targetEmail,
            limit: pollPayload.limit || DEFAULT_MAIL_PAGE_SIZE,
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
            const hydratedMessages = await hydrateMoemailMessagesWithDetails(latestState, emailId, messages);
            matchResult = buildMatchResult(hydratedMessages);
          }
          matchResult = await enrichMoemailMatchWithDetail(latestState, emailId, matchResult);
          const match = matchResult.match;
          if (match?.code) {
            return {
              ok: true,
              code: match.code,
              emailTimestamp: match.receivedAt || Date.now(),
              mailId: match.message?.id || '',
            };
          }
          lastError = new Error(`步骤 ${step}：暂未在 MoeMail 中找到匹配验证码（${attempt}/${maxAttempts}）。`);
          await addLog(lastError.message, attempt === maxAttempts ? 'warn' : 'info');
        } catch (err) {
          lastError = err;
          await addLog(`步骤 ${step}：MoeMail 轮询失败：${err.message}`, 'warn');
        }
        if (attempt < maxAttempts) {
          await sleepWithStop(intervalMs);
        }
      }

      throw lastError || new Error(`步骤 ${step}：未在 MoeMail 中找到新的匹配验证码。`);
    }

    return {
      ensureMoemailConfig,
      fetchMoemailAddress,
      fetchMoemailDomains,
      getMoemailConfig,
      getMoemailMessageDetail,
      listMoemailMailboxes,
      listMoemailMessages,
      pollMoemailVerificationCode,
      requestMoemailJson,
      resolveMoemailEmailId,
      resolveMoemailPollTargetEmail,
    };
  }

  return { createMoemailProvider };
});
