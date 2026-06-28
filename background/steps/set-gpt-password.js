(function attachBackgroundSetGptPassword(root, factory) {
  root.MultiPageBackgroundSetGptPassword = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSetGptPasswordModule() {
  const AUTH_SOURCE = 'signup-page';
  const SET_GPT_PASSWORD_ENTRY_URL = 'https://chatgpt.com/#settings/Security';
  const SET_GPT_PASSWORD_NEW_PASSWORD_URL = 'https://auth.openai.com/reset-password/new-password';
  const MAIL_2925_FILTER_LOOKBACK_MS = 10 * 60 * 1000;
  const DEFAULT_CODE_SUBMIT_ATTEMPTS = 5;
  const DEFAULT_VERIFICATION_WAIT_SECONDS = 10;
  const MAX_VERIFICATION_WAIT_SECONDS = 300;

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function normalizeEmail(value = '') {
    return normalizeString(value).toLowerCase();
  }

  function isRetryableContentScriptTransportError(error) {
    const message = normalizeString(typeof error === 'string' ? error : error?.message || '');
    return /back\/forward cache|message channel is closed|Receiving end does not exist|port closed before a response was received|A listener indicated an asynchronous response|内容脚本\s+\d+(?:\.\d+)?\s*秒内未响应|did not respond in \d+s/i.test(message);
  }

  function isRetryablePasswordSetupCodeFetchError(error) {
    const message = normalizeString(typeof error === 'string' ? error : error?.message || '');
    return /HTTP\s*(?:408|429|5\d\d)\b|Gateway Time-out|gateway timeout|暂未返回有效验证码|自定义邮箱暂未返回有效验证码|取码接口.*(?:超时|timeout)/i.test(message);
  }

  function isSetGptPasswordNewPasswordUrl(url = '') {
    try {
      const parsed = new URL(String(url || ''));
      return /\/reset-password\/new-password(?:[/?#]|$)/i.test(parsed.pathname || '');
    } catch {
      return /\/reset-password\/new-password(?:[/?#]|$)/i.test(String(url || ''));
    }
  }

  function createSetGptPasswordExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      chrome,
      completeNodeFromBackground = async () => {},
      ensureContentScriptReadyOnTab = async () => {},
      ensureMail2925MailboxSession = null,
      fetchVerificationCodeOnly = null,
      generatePassword = null,
      getMailConfig = null,
      getState = async () => ({}),
      getTabId = null,
      getVerificationCodeStateKey = null,
      HOTMAIL_PROVIDER = 'hotmail-api',
      ICLOUD_API_PROVIDER = 'icloud-api',
      isTabAlive = null,
      LUCKMAIL_PROVIDER = 'luckmail-api',
      CLOUDFLARE_TEMP_EMAIL_PROVIDER = 'cloudflare-temp-email',
      CLOUD_MAIL_PROVIDER = 'cloudmail',
      FREEMAIL_PROVIDER = 'freemail',
      MOEMAIL_PROVIDER = 'moemail',
      YYDSMAIL_PROVIDER = 'yydsmail',
      OUTLOOK_EMAIL_PLUS_PROVIDER = 'outlook-email-plus',
      reuseOrCreateTab = null,
      sendToContentScriptResilient = null,
      setPasswordState = null,
      setState = async () => {},
      SIGNUP_PAGE_INJECT_FILES = [],
      sleepWithStop = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS = 25000,
      throwIfStopped = () => {},
      upsertUpiAccountCredentialBackup = null,
      waitForTabStableComplete = null,
    } = deps;

    function getVisibleStep(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : 6;
    }

    function addStepLog(step, message, level = 'info') {
      return rawAddLog(message, level, {
        step,
        stepKey: 'set-gpt-password',
      });
    }

    async function getMergedState(state = {}) {
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => ({}))
        : {};
      return {
        ...(latestState || {}),
        ...(state || {}),
      };
    }

    function resolveAccountEmail(state = {}) {
      return normalizeEmail(
        state.email
        || state.step8VerificationTargetEmail
        || state.boundEmail
        || state.registrationEmailState?.current
        || state.accountIdentifier
      );
    }

    function resolveSessionEmail(sessionResult = {}) {
      return normalizeEmail(
        sessionResult.email
        || sessionResult.session?.user?.email
        || sessionResult.user?.email
      );
    }

    function resolvePasswordAccountIdentity(state = {}) {
      const email = resolveAccountEmail(state);
      return {
        accountIdentifierType: 'email',
        accountIdentifier: email,
        email,
      };
    }

    function normalizePasswordAccountIdentifierType(value = '') {
      return String(value || '').trim().toLowerCase() === 'phone' ? 'phone' : 'email';
    }

    function normalizePasswordAccountIdentifierValue(type, value = '') {
      const normalizedType = normalizePasswordAccountIdentifierType(type);
      const normalizedValue = normalizeString(value);
      return normalizedType === 'email' ? normalizedValue.toLowerCase() : normalizedValue;
    }

    function isStatePasswordForIdentity(state = {}, identity = {}) {
      const password = normalizeString(state?.password);
      if (!password) return false;
      const accountIdentifier = normalizePasswordAccountIdentifierValue(
        identity.accountIdentifierType,
        identity.accountIdentifier
      );
      if (!accountIdentifier) return false;
      const stateIdentifier = normalizePasswordAccountIdentifierValue(
        state?.passwordAccountIdentifierType,
        state?.passwordAccountIdentifier
      );
      const stateType = normalizePasswordAccountIdentifierType(state?.passwordAccountIdentifierType);
      const identityType = normalizePasswordAccountIdentifierType(identity.accountIdentifierType);
      return Boolean(stateIdentifier && stateIdentifier === accountIdentifier && stateType === identityType);
    }

    async function persistGptPassword(password, accountIdentity = {}) {
      if (typeof setPasswordState === 'function') {
        await setPasswordState(password, accountIdentity);
      } else {
        await setState({
          password,
          passwordAccountIdentifierType: accountIdentity.accountIdentifier ? accountIdentity.accountIdentifierType : null,
          passwordAccountIdentifier: accountIdentity.accountIdentifier || '',
        });
      }
    }

    async function ensureGptPassword(state = {}, visibleStep = 6) {
      const accountIdentity = resolvePasswordAccountIdentity(state);
      const customPassword = normalizeString(state.customPassword || '');
      if (customPassword) {
        if (normalizeString(state.password) !== customPassword || !isStatePasswordForIdentity(state, accountIdentity)) {
          await persistGptPassword(customPassword, accountIdentity);
        }
        return customPassword;
      }
      const existingPassword = isStatePasswordForIdentity(state, accountIdentity)
        ? normalizeString(state.password)
        : '';
      if (existingPassword) {
        return existingPassword;
      }
      if (typeof generatePassword !== 'function') {
        throw new Error(`步骤 ${visibleStep}：缺少 GPT 密码，且当前环境无法自动生成密码。`);
      }
      const generatedPassword = normalizeString(generatePassword());
      if (!generatedPassword) {
        throw new Error(`步骤 ${visibleStep}：自动生成 GPT 密码失败。`);
      }
      await persistGptPassword(generatedPassword, accountIdentity);
      await addStepLog(visibleStep, '当前账号缺少 GPT 密码，已自动生成并保存到扩展本地状态。', 'info');
      return generatedPassword;
    }

    async function generateReplacementGptPassword(previousPasswords = [], visibleStep = 6, state = {}) {
      if (typeof generatePassword !== 'function') {
        throw new Error(`步骤 ${visibleStep}：OpenAI 拒绝重复密码，但当前环境无法自动生成新 GPT 密码。`);
      }
      const blocked = new Set(
        previousPasswords
          .map((item) => normalizeString(item))
          .filter(Boolean)
      );
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const candidate = normalizeString(generatePassword());
        if (!candidate || blocked.has(candidate)) {
          continue;
        }
        await persistGptPassword(candidate, resolvePasswordAccountIdentity(state));
        await addStepLog(visibleStep, 'OpenAI 提示密码已用过，已自动生成并保存新的 GPT 登录密码。', 'warn');
        return candidate;
      }
      throw new Error(`步骤 ${visibleStep}：OpenAI 拒绝重复密码，且连续生成的新密码仍不可用。`);
    }

    function getExpectedMail2925MailboxEmail(state = {}) {
      if (Boolean(state?.mail2925UseAccountPool)) {
        const currentAccountId = normalizeString(state?.currentMail2925AccountId);
        const accounts = Array.isArray(state?.mail2925Accounts) ? state.mail2925Accounts : [];
        const currentAccount = accounts.find((account) => normalizeString(account?.id) === currentAccountId) || null;
        const accountEmail = normalizeEmail(currentAccount?.email);
        if (accountEmail) {
          return accountEmail;
        }
      }
      return normalizeEmail(state?.mail2925BaseEmail);
    }

    function isApiMailProvider(mail = {}) {
      return [
        HOTMAIL_PROVIDER,
        ICLOUD_API_PROVIDER,
        LUCKMAIL_PROVIDER,
        CLOUDFLARE_TEMP_EMAIL_PROVIDER,
        CLOUD_MAIL_PROVIDER,
        FREEMAIL_PROVIDER,
        MOEMAIL_PROVIDER,
        YYDSMAIL_PROVIDER,
        OUTLOOK_EMAIL_PLUS_PROVIDER,
      ].includes(mail.provider);
    }

    function getPasswordSetupResendIntervalMs(mail = {}) {
      if (mail.provider === LUCKMAIL_PROVIDER) {
        return 15000;
      }
      if (mail.provider === HOTMAIL_PROVIDER || mail.provider === ICLOUD_API_PROVIDER || mail.provider === '2925') {
        return 0;
      }
      return Math.max(0, Number(STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS) || 0);
    }

    function normalizeVerificationWaitSeconds(value, fallback = DEFAULT_VERIFICATION_WAIT_SECONDS) {
      const rawValue = String(value ?? '').trim();
      const fallbackValue = Math.max(0, Math.min(MAX_VERIFICATION_WAIT_SECONDS, Math.floor(Number(fallback) || 0)));
      if (!rawValue) {
        return fallbackValue;
      }
      const numeric = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(numeric)) {
        return fallbackValue;
      }
      return Math.max(0, Math.min(MAX_VERIFICATION_WAIT_SECONDS, numeric));
    }

    async function waitBeforeFetchingPasswordSetupCode(state = {}, visibleStep = 6, attempt = 1, maxAttempts = 1) {
      const waitSeconds = normalizeVerificationWaitSeconds(state.setGptPasswordVerificationWaitSeconds);
      if (waitSeconds <= 0) {
        return;
      }
      const attemptText = attempt > 1
        ? `第 ${attempt}/${maxAttempts} 次取码前`
        : '首次取码前';
      await addStepLog(
        visibleStep,
        `设置 GPT 密码：${attemptText}等待 ${waitSeconds} 秒，避免读取旧验证码。`,
        'info'
      );
      await sleepWithStop(waitSeconds * 1000);
    }

    async function focusOrOpenMailTab(mail = {}) {
      if (!mail?.source) {
        return;
      }
      const alive = typeof isTabAlive === 'function'
        ? await isTabAlive(mail.source)
        : false;
      if (alive) {
        if (mail.navigateOnReuse && typeof reuseOrCreateTab === 'function') {
          await reuseOrCreateTab(mail.source, mail.url, {
            inject: mail.inject,
            injectSource: mail.injectSource,
          });
          return;
        }
        const tabId = typeof getTabId === 'function' ? await getTabId(mail.source) : 0;
        if (tabId && chrome?.tabs?.update) {
          await chrome.tabs.update(tabId, { active: true });
        }
        return;
      }
      if (typeof reuseOrCreateTab !== 'function') {
        throw new Error(`无法打开 ${mail.label || '邮箱'} 标签页，缺少 reuseOrCreateTab。`);
      }
      await reuseOrCreateTab(mail.source, mail.url, {
        inject: mail.inject,
        injectSource: mail.injectSource,
      });
    }

    async function prepareMailProviderForPolling(mail = {}, state = {}, visibleStep = 6) {
      if (!mail || mail.provider === 'custom') {
        return;
      }
      if (mail.source === 'icloud-mail') {
        await addStepLog(visibleStep, '设置 GPT 密码：iCloud 邮箱将优先通过取码接口获取验证码，不主动打开 iCloud 网页。', 'info');
        return;
      }
      if (isApiMailProvider(mail)) {
        await addStepLog(visibleStep, `设置 GPT 密码：正在通过 ${mail.label || mail.provider} 轮询验证码...`, 'info');
        return;
      }
      if (mail.provider === '2925' && typeof ensureMail2925MailboxSession === 'function') {
        await addStepLog(visibleStep, `设置 GPT 密码：正在确认 ${mail.label || '2925 邮箱'} 登录态...`, 'info');
        await ensureMail2925MailboxSession({
          accountId: state.currentMail2925AccountId || null,
          forceRelogin: false,
          allowLoginWhenOnLoginPage: Boolean(state?.mail2925UseAccountPool),
          expectedMailboxEmail: getExpectedMail2925MailboxEmail(state),
          actionLabel: `步骤 ${visibleStep}：确认 2925 邮箱登录态`,
        });
        return;
      }
      await addStepLog(visibleStep, `设置 GPT 密码：正在打开 ${mail.label || '邮箱'} 等待验证码...`, 'info');
      await focusOrOpenMailTab(mail);
    }

    async function openPasswordSetupVerificationPage(visibleStep) {
      if (typeof reuseOrCreateTab !== 'function') {
        throw new Error(`步骤 ${visibleStep}：无法打开 OpenAI 设置密码入口页，缺少标签页管理器。`);
      }
      const tabId = await reuseOrCreateTab(AUTH_SOURCE, SET_GPT_PASSWORD_ENTRY_URL, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: AUTH_SOURCE,
        reloadIfSameUrl: true,
      });
      if (!tabId) {
        throw new Error(`步骤 ${visibleStep}：打开 OpenAI 设置密码入口页失败。`);
      }
      if (typeof waitForTabStableComplete === 'function') {
        await waitForTabStableComplete(tabId, {
          timeoutMs: 45000,
          retryDelayMs: 300,
          stableMs: 800,
          initialDelayMs: 300,
        });
      }
      await ensureContentScriptReadyOnTab(AUTH_SOURCE, tabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: AUTH_SOURCE,
        timeoutMs: 30000,
      });
      return tabId;
    }

    async function openPasswordSetupNewPasswordPage(tabId, visibleStep) {
      let nextTabId = tabId;
      if (chrome?.tabs?.update && nextTabId) {
        await chrome.tabs.update(nextTabId, {
          active: true,
          url: SET_GPT_PASSWORD_NEW_PASSWORD_URL,
        });
      } else {
        if (typeof reuseOrCreateTab !== 'function') {
          throw new Error(`步骤 ${visibleStep}：无法打开 OpenAI 新密码页，缺少标签页管理器。`);
        }
        nextTabId = await reuseOrCreateTab(AUTH_SOURCE, SET_GPT_PASSWORD_NEW_PASSWORD_URL, {
          inject: SIGNUP_PAGE_INJECT_FILES,
          injectSource: AUTH_SOURCE,
          reloadIfSameUrl: true,
        });
      }
      if (!nextTabId) {
        throw new Error(`步骤 ${visibleStep}：打开 OpenAI 新密码页失败。`);
      }
      if (typeof waitForTabStableComplete === 'function') {
        await waitForTabStableComplete(nextTabId, {
          timeoutMs: 45000,
          retryDelayMs: 300,
          stableMs: 800,
          initialDelayMs: 300,
        });
      }
      await ensureContentScriptReadyOnTab(AUTH_SOURCE, nextTabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: AUTH_SOURCE,
        timeoutMs: 30000,
      });
      return nextTabId;
    }

    async function ensureSetPasswordContentScriptReady(tabId, visibleStep, label = 'OpenAI 设置密码页面') {
      if (!tabId) {
        return;
      }
      await ensureContentScriptReadyOnTab(AUTH_SOURCE, tabId, {
        inject: SIGNUP_PAGE_INJECT_FILES,
        injectSource: AUTH_SOURCE,
        timeoutMs: 30000,
        logMessage: `步骤 ${visibleStep}：${label}内容脚本未就绪，正在重新注入...`,
        logStep: visibleStep,
        logStepKey: 'set-gpt-password',
      });
    }

    async function getCurrentAuthTabUrl(tabId) {
      if (!tabId || typeof chrome?.tabs?.get !== 'function') {
        return '';
      }
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      return normalizeString(tab?.url || '');
    }

    async function recoverCodeSubmitAfterTransportLoss(tabId, visibleStep, error) {
      await addStepLog(
        visibleStep,
        `设置 GPT 密码：验证码提交后页面跳转导致通信中断，正在检查新密码页状态...（${normalizeString(error?.message || error)}）`,
        'warn'
      );
      if (typeof waitForTabStableComplete === 'function' && tabId) {
        await waitForTabStableComplete(tabId, {
          timeoutMs: 30000,
          retryDelayMs: 300,
          stableMs: 800,
          initialDelayMs: 500,
        });
      }
      const currentUrl = await getCurrentAuthTabUrl(tabId);
      if (isSetGptPasswordNewPasswordUrl(currentUrl)) {
        await addStepLog(visibleStep, '设置 GPT 密码：已确认进入新密码页，继续填写 GPT 密码。', 'success');
        return {
          success: true,
          newPasswordPage: true,
          recoveredAfterTransportLoss: true,
          url: currentUrl,
        };
      }
      if (tabId) {
        await ensureSetPasswordContentScriptReady(tabId, visibleStep, 'OpenAI 设置密码页面');
      }
      return null;
    }

    async function recoverPasswordSubmitAfterTransportLoss(tabId, visibleStep, error) {
      await addStepLog(
        visibleStep,
        `设置 GPT 密码：提交密码后页面跳转导致通信中断，正在确认是否已离开新密码页...（${normalizeString(error?.message || error)}）`,
        'warn'
      );
      if (typeof waitForTabStableComplete === 'function' && tabId) {
        await waitForTabStableComplete(tabId, {
          timeoutMs: 30000,
          retryDelayMs: 300,
          stableMs: 800,
          initialDelayMs: 500,
        });
      }
      const currentUrl = await getCurrentAuthTabUrl(tabId);
      if (currentUrl && !isSetGptPasswordNewPasswordUrl(currentUrl)) {
        await addStepLog(visibleStep, '设置 GPT 密码：页面已跳出新密码页，按密码设置成功继续。', 'success');
        return {
          success: true,
          gptPasswordSet: true,
          recoveredAfterTransportLoss: true,
          url: currentUrl,
        };
      }
      if (tabId) {
        await ensureSetPasswordContentScriptReady(tabId, visibleStep, 'OpenAI 新密码页');
      }
      return null;
    }

    async function sendSetPasswordPageMessage(type, payload = {}, visibleStep = 6, timeoutMs = 30000) {
      if (typeof sendToContentScriptResilient !== 'function') {
        throw new Error(`步骤 ${visibleStep}：无法与 OpenAI 认证页通信，内容脚本通道未初始化。`);
      }
      const result = await sendToContentScriptResilient(AUTH_SOURCE, {
        type,
        source: 'background',
        payload: {
          ...payload,
          visibleStep,
          nodeId: 'set-gpt-password',
        },
      }, {
        timeoutMs: Math.max(timeoutMs, 1000),
        responseTimeoutMs: Math.max(timeoutMs, 1000),
        retryDelayMs: 700,
        logMessage: `步骤 ${visibleStep}：OpenAI 设置密码页面正在切换，等待页面重新就绪...`,
        logStep: visibleStep,
        logStepKey: 'set-gpt-password',
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function resolveLoggedInAccountEmailFromSession(visibleStep = 6) {
      await addStepLog(visibleStep, '当前运行状态缺少账号邮箱，正在从已登录的 ChatGPT 会话读取邮箱...', 'info');
      let sessionResult = null;
      try {
        sessionResult = await sendSetPasswordPageMessage('READ_CHATGPT_SESSION_EXPORT_DATA', {}, visibleStep, 30000);
      } catch (error) {
        throw new Error(`步骤 ${visibleStep}：缺少当前账号邮箱，且无法从 ChatGPT 会话读取登录邮箱：${error?.message || error}`);
      }
      const sessionEmail = resolveSessionEmail(sessionResult);
      if (!sessionEmail) {
        throw new Error(`步骤 ${visibleStep}：缺少当前账号邮箱，且 ChatGPT 会话未返回登录邮箱，请确认当前标签页已登录目标账号。`);
      }
      const patch = {
        email: sessionEmail,
        accountIdentifierType: 'email',
        accountIdentifier: sessionEmail,
        step8VerificationTargetEmail: sessionEmail,
      };
      await setState(patch);
      await addStepLog(visibleStep, `已从 ChatGPT 登录会话识别当前账号邮箱：${sessionEmail}`, 'success');
      return sessionEmail;
    }

    async function fetchPasswordSetupCode(state = {}, mail = null, options = {}) {
      if (typeof fetchVerificationCodeOnly !== 'function') {
        throw new Error('设置 GPT 密码取码能力未初始化。');
      }
      const disableIcloudWebMailFallback = mail?.source === 'icloud-mail';
      const result = await fetchVerificationCodeOnly(8, state, disableIcloudWebMailFallback ? null : mail, options);
      if (!result?.handled) {
        if (disableIcloudWebMailFallback) {
          throw new Error('当前邮箱是 iCloud 网页邮箱，但已禁止自动打开 iCloud Mail；请为该邮箱配置自定义取码 URL/Assurivo 查询码。');
        }
        throw new Error('当前邮箱来源没有可自动获取 OpenAI 设置密码验证码的接口，请配置自定义取码 URL/Assurivo 或可轮询邮箱 provider。');
      }
      if (!normalizeString(result.code)) {
        throw new Error('设置 GPT 密码验证码为空。');
      }
      return result;
    }

    async function executeSetGptPassword(state = {}) {
      throwIfStopped();
      const initialState = await getMergedState(state);
      const visibleStep = getVisibleStep(initialState);
      let email = resolveAccountEmail(initialState);

      await setState({
        gptPasswordSet: false,
        gptPasswordSetAt: '',
      });
      let authTabId = await openPasswordSetupVerificationPage(visibleStep);
      if (chrome?.tabs?.update) {
        await chrome.tabs.update(authTabId, { active: true }).catch(() => {});
      }
      if (!email) {
        email = await resolveLoggedInAccountEmailFromSession(visibleStep);
      }
      let password = await ensureGptPassword({
        ...initialState,
        email,
        accountIdentifierType: 'email',
        accountIdentifier: email,
        step8VerificationTargetEmail: email,
      }, visibleStep);

      const startedAt = Date.now();
      const runtimeState = {
        ...(await getMergedState(initialState)),
        email,
        accountIdentifierType: 'email',
        accountIdentifier: email,
        step8VerificationTargetEmail: email,
        password,
      };

      await addStepLog(visibleStep, `正在为 ${email} 强制设置 GPT 登录密码，完成后会开通 2FA 并检测 UPI 试用资格...`, 'info');

      let prepareResult = await sendSetPasswordPageMessage('START_SET_GPT_PASSWORD_RESET', {
        email,
      }, visibleStep, 60000);
      if (prepareResult?.resetTriggered) {
        if (typeof waitForTabStableComplete === 'function') {
          await waitForTabStableComplete(authTabId, {
            timeoutMs: 60000,
            retryDelayMs: 300,
            stableMs: 800,
            initialDelayMs: 500,
          });
        }
        await ensureContentScriptReadyOnTab(AUTH_SOURCE, authTabId, {
          inject: SIGNUP_PAGE_INJECT_FILES,
          injectSource: AUTH_SOURCE,
          timeoutMs: 30000,
        });
        prepareResult = await sendSetPasswordPageMessage('PREPARE_SET_GPT_PASSWORD', {}, visibleStep, 30000);
      }
      if (!prepareResult?.ready) {
        prepareResult = await sendSetPasswordPageMessage('PREPARE_SET_GPT_PASSWORD', {}, visibleStep, 30000);
      }
      if (prepareResult?.emailAlreadyVerified || prepareResult?.requiresNewPasswordNavigation) {
        await addStepLog(visibleStep, '设置 GPT 密码：邮箱已验证，正在直接打开新密码页。', 'info');
        authTabId = await openPasswordSetupNewPasswordPage(authTabId, visibleStep);
        prepareResult = await sendSetPasswordPageMessage('PREPARE_SET_GPT_PASSWORD', {}, visibleStep, 30000);
      }
      if (!prepareResult?.alreadyOnNewPasswordPage) {
        const mail = typeof getMailConfig === 'function' ? getMailConfig(runtimeState) : null;
        if (mail?.error) {
          throw new Error(mail.error);
        }
        await addStepLog(
          visibleStep,
          `设置 GPT 密码：验证码页已就绪，准备通过 ${mail?.label || mail?.provider || '邮箱'} 获取 ${email} 的验证码。`,
          'info'
        );
        await prepareMailProviderForPolling(mail, runtimeState, visibleStep);
        await addStepLog(visibleStep, '设置 GPT 密码：邮箱准备完成，开始取验证码。', 'info');

        const stateKey = typeof getVerificationCodeStateKey === 'function'
          ? getVerificationCodeStateKey(8)
          : 'lastLoginCode';
        const rejectedCodes = new Set();
        if (runtimeState[stateKey]) {
          rejectedCodes.add(runtimeState[stateKey]);
        }
        let acceptedCodeResult = null;
        let lastRejectedText = '';
        const maxAttempts = Math.max(1, Math.min(8, Math.floor(Number(runtimeState.setGptPasswordCodeMaxAttempts) || DEFAULT_CODE_SUBMIT_ATTEMPTS)));
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          throwIfStopped();
          await waitBeforeFetchingPasswordSetupCode(runtimeState, visibleStep, attempt, maxAttempts);
          await addStepLog(visibleStep, `设置 GPT 密码：正在获取验证码（${attempt}/${maxAttempts}，邮箱：${email}）...`, 'info');
          let codeResult = null;
          try {
            codeResult = await fetchPasswordSetupCode(runtimeState, mail, {
              completionStep: visibleStep,
              targetEmail: email,
              filterAfterTimestamp: mail?.provider === '2925'
                ? Math.max(0, startedAt - MAIL_2925_FILTER_LOOKBACK_MS)
                : startedAt,
              excludeCodes: [...rejectedCodes],
              maxResendRequests: mail?.provider === '2925' ? 2 : undefined,
              initialPollMaxAttempts: mail?.provider === '2925' ? 5 : undefined,
              pollAttemptPlan: mail?.provider === '2925' ? [2, 3, 15] : undefined,
              resendIntervalMs: getPasswordSetupResendIntervalMs(mail || {}),
            });
          } catch (error) {
            if (!isRetryablePasswordSetupCodeFetchError(error) || attempt >= maxAttempts) {
              throw error;
            }
            await addStepLog(
              visibleStep,
              `设置 GPT 密码：本次取码临时失败，将继续等待下一次尝试（${attempt + 1}/${maxAttempts}）：${error?.message || error}`,
              'warn'
            );
            continue;
          }

          await addStepLog(visibleStep, `已获取设置 GPT 密码验证码：${codeResult.code}，正在提交（${attempt}/${maxAttempts}）...`, 'info');
          let submitResult = null;
          try {
            submitResult = await sendSetPasswordPageMessage('SUBMIT_SET_GPT_PASSWORD_CODE', {
              code: codeResult.code,
            }, visibleStep, 45000);
          } catch (error) {
            if (!isRetryableContentScriptTransportError(error)) {
              throw error;
            }
            submitResult = await recoverCodeSubmitAfterTransportLoss(authTabId, visibleStep, error);
            if (!submitResult) {
              throw error;
            }
          }
          if (submitResult.invalidCode) {
            rejectedCodes.add(codeResult.code);
            lastRejectedText = submitResult.errorText || codeResult.code;
            await addStepLog(visibleStep, `设置 GPT 密码验证码被页面拒绝：${lastRejectedText}`, 'warn');
            if (attempt < maxAttempts) {
              continue;
            }
            throw new Error(`步骤 ${visibleStep}：设置 GPT 密码验证码连续被拒绝：${lastRejectedText}`);
          }
          if (submitResult.unexpectedUrl) {
            throw new Error(`步骤 ${visibleStep}：验证码提交后没有进入设置新密码页。URL: ${submitResult.url || ''}`);
          }
          if (submitResult.emailAlreadyVerified || submitResult.requiresNewPasswordNavigation) {
            await addStepLog(visibleStep, '设置 GPT 密码：验证码提交后显示邮箱已验证，正在直接打开新密码页。', 'info');
            authTabId = await openPasswordSetupNewPasswordPage(authTabId, visibleStep);
          }
          acceptedCodeResult = codeResult;
          break;
        }
        if (!acceptedCodeResult) {
          throw new Error(`步骤 ${visibleStep}：未能提交有效的设置 GPT 密码验证码${lastRejectedText ? `：${lastRejectedText}` : ''}`);
        }
        await setState({
          lastEmailTimestamp: acceptedCodeResult.emailTimestamp || Date.now(),
          [stateKey]: acceptedCodeResult.code,
        });
      }

      await ensureSetPasswordContentScriptReady(authTabId, visibleStep, 'OpenAI 新密码页');

      let passwordResult = null;
      const submittedPasswords = new Set();
      for (let submitAttempt = 1; submitAttempt <= 3; submitAttempt += 1) {
        submittedPasswords.add(password);
        try {
          passwordResult = await sendSetPasswordPageMessage('SET_GPT_PASSWORD', {
            password,
          }, visibleStep, 45000);
        } catch (error) {
          if (!isRetryableContentScriptTransportError(error)) {
            throw error;
          }
          passwordResult = await recoverPasswordSubmitAfterTransportLoss(authTabId, visibleStep, error);
          if (!passwordResult) {
            if (submitAttempt >= 3) {
              throw error;
            }
            await addStepLog(
              visibleStep,
              `设置 GPT 密码：页面通信恢复后仍停留在新密码页，重新提交当前 GPT 密码（${submitAttempt + 1}/3）。`,
              'warn'
            );
            continue;
          }
        }
        if (passwordResult?.passwordReused) {
          await addStepLog(
            visibleStep,
            `设置 GPT 密码：OpenAI 拒绝重复使用当前密码，正在换一个新密码重试（${submitAttempt}/3）。`,
            'warn'
          );
          if (submitAttempt >= 3) {
            break;
          }
          password = await generateReplacementGptPassword([...submittedPasswords], visibleStep, runtimeState);
          runtimeState.password = password;
          continue;
        }
        break;
      }
      if (!passwordResult?.success && !passwordResult?.gptPasswordSet) {
        const detail = passwordResult?.errorText ? ` 原因：${passwordResult.errorText}` : '';
        throw new Error(`步骤 ${visibleStep}：GPT 密码提交后未确认成功。URL: ${passwordResult?.url || ''}${detail}`);
      }

      const gptPasswordSetAt = new Date().toISOString();
      const patch = {
        password,
        gptPasswordSet: true,
        gptPasswordSetAt,
      };
      await setState(patch);
      if (typeof upsertUpiAccountCredentialBackup === 'function') {
        await upsertUpiAccountCredentialBackup({
          email,
          ...patch,
          sourceStep: 'set-gpt-password',
        });
      }
      await addStepLog(visibleStep, 'GPT 登录密码已设置成功，继续开通 2FA。', 'success');
      await completeNodeFromBackground(state?.nodeId || 'set-gpt-password', patch);
      return patch;
    }

    return {
      executeSetGptPassword,
    };
  }

  return {
    createSetGptPasswordExecutor,
  };
});
