(function attachBackgroundStep4(root, factory) {
  root.MultiPageBackgroundStep4 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep4Module() {
  const MAIL_2925_FILTER_LOOKBACK_MS = 10 * 60 * 1000;

  function createStep4Executor(deps = {}) {
    const {
      addLog,
      chrome,
      completeNodeFromBackground,
      confirmCustomVerificationStepBypass,
      generatePassword,
      generateRandomBirthday,
      generateRandomName,
      ensureMail2925MailboxSession,
      ensureIcloudMailSession,
      getMailConfig,
      getState,
      getTabId,
      HOTMAIL_PROVIDER,
      ICLOUD_API_PROVIDER = 'icloud-api',
      isTabAlive,
      LUCKMAIL_PROVIDER,
      CLOUDFLARE_TEMP_EMAIL_PROVIDER,
      CLOUD_MAIL_PROVIDER = 'cloudmail',
      FREEMAIL_PROVIDER = 'freemail',
      MOEMAIL_PROVIDER = 'moemail',
      YYDSMAIL_PROVIDER = 'yydsmail',
      OUTLOOK_EMAIL_PLUS_PROVIDER = 'outlook-email-plus',
      resolveCustomEmailVerificationStep = null,
      resolveVerificationStep,
      reuseOrCreateTab,
      sendToContentScript,
      sendToContentScriptResilient,
      setPasswordState,
      isRetryableContentScriptTransportError = () => false,
      shouldUseCustomRegistrationEmail,
      STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS,
      throwIfStopped,
      waitForTabStableComplete = null,
      phoneVerificationHelpers = null,
      resolveSignupMethod = () => 'email',
    } = deps;

    function buildSignupProfileForVerificationStep() {
      const name = typeof generateRandomName === 'function' ? generateRandomName() : null;
      const birthday = typeof generateRandomBirthday === 'function' ? generateRandomBirthday() : null;
      if (!name?.firstName || !name?.lastName || !birthday) {
        return null;
      }
      return {
        firstName: name.firstName,
        lastName: name.lastName,
        year: birthday.year,
        month: birthday.month,
        day: birthday.day,
      };
    }

    function getExpectedMail2925MailboxEmail(state = {}) {
      if (Boolean(state?.mail2925UseAccountPool)) {
        const currentAccountId = String(state?.currentMail2925AccountId || '').trim();
        const accounts = Array.isArray(state?.mail2925Accounts) ? state.mail2925Accounts : [];
        const currentAccount = accounts.find((account) => String(account?.id || '') === currentAccountId) || null;
        const accountEmail = String(currentAccount?.email || '').trim().toLowerCase();
        if (accountEmail) {
          return accountEmail;
        }
      }

      return String(state?.mail2925BaseEmail || '').trim().toLowerCase();
    }

    function isPhoneSignupState(state = {}) {
      return resolveSignupMethod(state) === 'phone'
        || state?.accountIdentifierType === 'phone'
        || Boolean(state?.signupPhoneActivation);
    }

    function isRegisteredLoginTotpVerificationState(snapshot = null) {
      const stateName = String(snapshot?.state || '').trim().toLowerCase();
      const verificationKind = String(snapshot?.verificationKind || '').trim().toLowerCase();
      if (verificationKind !== 'totp') {
        return false;
      }
      return stateName === 'verification_page'
        || Boolean(snapshot?.hasVerificationTarget)
        || Boolean(snapshot?.verificationVisible);
    }

    async function getLoginAuthStateFromSignupPage() {
      const request = {
        type: 'GET_LOGIN_AUTH_STATE',
        step: 4,
        source: 'background',
        payload: {},
      };
      try {
        if (typeof sendToContentScript === 'function') {
          return await sendToContentScript('signup-page', request, {
            responseTimeoutMs: 8000,
          });
        }
        if (typeof sendToContentScriptResilient === 'function') {
          return await sendToContentScriptResilient('signup-page', request, {
            timeoutMs: 8000,
            responseTimeoutMs: 8000,
            retryDelayMs: 500,
            logMessage: '步骤 4：正在确认当前认证页是否误入登录二次验证页...',
          });
        }
      } catch (error) {
        await addLog(`步骤 4：登录验证页预检查未完成，将继续使用注册验证码页检测。${error?.message || error}`, 'warn');
      }
      return null;
    }

    function buildRegisteredLoginVerificationError(authState = {}) {
      const url = String(authState?.url || '').trim();
      const suffix = url ? ` URL: ${url}` : '';
      return new Error(`SIGNUP_USER_ALREADY_EXISTS::步骤 4：注册流程进入登录 TOTP 二次验证页，说明当前邮箱已注册并启用 2FA，当前邮箱将标记为已用并切换下一个。${suffix}`);
    }

    function normalizePasswordAccountIdentifierType(value = '') {
      return String(value || '').trim().toLowerCase() === 'phone' ? 'phone' : 'email';
    }

    function normalizePasswordAccountIdentifierValue(type, value = '') {
      const normalizedType = normalizePasswordAccountIdentifierType(type);
      const normalizedValue = String(value || '').trim();
      return normalizedType === 'email' ? normalizedValue.toLowerCase() : normalizedValue;
    }

    function resolvePasswordAccountIdentity(state = {}) {
      const rawType = normalizePasswordAccountIdentifierType(state?.accountIdentifierType);
      const phoneNumber = String(
        state?.signupPhoneNumber
        || state?.phoneNumber
        || (rawType === 'phone' ? state?.accountIdentifier : '')
        || ''
      ).trim();
      const email = String(
        state?.email
        || state?.registrationEmailState?.current
        || (rawType === 'email' ? state?.accountIdentifier : '')
        || ''
      ).trim();
      if (rawType === 'phone' && phoneNumber) {
        return {
          accountIdentifierType: 'phone',
          accountIdentifier: phoneNumber,
          email,
          phoneNumber,
        };
      }
      return {
        accountIdentifierType: 'email',
        accountIdentifier: email,
        email,
        phoneNumber,
      };
    }

    function isStatePasswordForIdentity(state = {}, identity = {}) {
      const password = String(state?.password || '').trim();
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

    async function ensureSignupPasswordForStep4(state = {}) {
      const identity = resolvePasswordAccountIdentity(state);
      if (state.customPassword) {
        return state.customPassword;
      }
      if (isStatePasswordForIdentity(state, identity)) {
        return state.password;
      }
      if (typeof generatePassword !== 'function') {
        return '';
      }

      const password = generatePassword();
      if (typeof setPasswordState === 'function') {
        await setPasswordState(password, identity);
      }
      await addLog('步骤 4：步骤 3 已跳过且未设置自定义密码，已自动生成 GPT 密码用于注册后的密码页。', 'info');
      return password;
    }

    async function executeSignupPhoneCodeStep(state, signupTabId) {
      if (typeof phoneVerificationHelpers?.completeSignupPhoneVerificationFlow !== 'function') {
        throw new Error('步骤 4：手机号注册验证码流程不可用，接码模块尚未初始化。');
      }

      const signupProfile = buildSignupProfileForVerificationStep();
      const result = await phoneVerificationHelpers.completeSignupPhoneVerificationFlow(signupTabId, {
        state,
        signupProfile,
        password: state.password || state.customPassword || '',
      });

      if (result?.emailVerificationRequired || result?.emailVerificationPage) {
        return result || {};
      }

      await completeNodeFromBackground('fetch-signup-code', {
        phoneVerification: true,
        code: result?.code || '',
        ...(result?.passwordSubmittedAfterVerification ? { passwordSubmittedAfterVerification: true } : {}),
        ...(result?.skipProfileStep ? { skipProfileStep: true } : {}),
        ...(result?.skipProfileStepReason ? { skipProfileStepReason: result.skipProfileStepReason } : {}),
      });
      return result || {};
    }

    async function executeSignupEmailVerificationStep(state, stepStartedAt, verificationSessionKey) {
      const signupProfile = buildSignupProfileForVerificationStep();
      const password = state.password || state.customPassword || '';
      const latestState = typeof getState === 'function'
        ? await getState().catch(() => null)
        : null;
      const stateForVerification = latestState && typeof latestState === 'object'
        ? { ...state, ...latestState, password: password || latestState.password || latestState.customPassword || '' }
        : state;
      const verificationFilterAfterTimestamp = Number(stateForVerification?.signupVerificationRequestedAt) > 0
        ? Number(stateForVerification.signupVerificationRequestedAt)
        : stepStartedAt;
      if (typeof resolveCustomEmailVerificationStep === 'function') {
        const customResult = await resolveCustomEmailVerificationStep(4, stateForVerification, {
          signupProfile,
          password: stateForVerification.password || stateForVerification.customPassword || password,
          filterAfterTimestamp: verificationFilterAfterTimestamp,
        });
        if (customResult?.handled) {
          return customResult;
        }
      }

      if (shouldUseCustomRegistrationEmail(state)) {
        await confirmCustomVerificationStepBypass(4);
        return;
      }

      const mail = getMailConfig(state);
      if (mail.error) throw new Error(mail.error);
      if (mail.source === 'icloud-mail') {
        throw new Error('步骤 4：当前邮箱是 iCloud 网页邮箱，但已禁止自动打开 iCloud Mail；请为该邮箱配置自定义取码 URL/Assurivo 查询码。');
      }

      const mailVerificationFilterAfterTimestamp = mail.provider === '2925'
        ? Math.max(0, stepStartedAt - MAIL_2925_FILTER_LOOKBACK_MS)
        : verificationFilterAfterTimestamp;

      throwIfStopped();
      if (
        mail.provider === HOTMAIL_PROVIDER
        || mail.provider === ICLOUD_API_PROVIDER
        || mail.provider === LUCKMAIL_PROVIDER
        || mail.provider === CLOUDFLARE_TEMP_EMAIL_PROVIDER
        || mail.provider === CLOUD_MAIL_PROVIDER
        || mail.provider === FREEMAIL_PROVIDER
        || mail.provider === MOEMAIL_PROVIDER
        || mail.provider === YYDSMAIL_PROVIDER
        || mail.provider === OUTLOOK_EMAIL_PLUS_PROVIDER
      ) {
        await addLog(`步骤 4：正在通过 ${mail.label} 轮询验证码...`);
      } else if (mail.provider === '2925') {
        await addLog(`步骤 4：正在打开${mail.label}...`);
        if (typeof ensureMail2925MailboxSession === 'function') {
          await ensureMail2925MailboxSession({
            accountId: state.currentMail2925AccountId || null,
            forceRelogin: false,
            allowLoginWhenOnLoginPage: Boolean(state?.mail2925UseAccountPool),
            expectedMailboxEmail: getExpectedMail2925MailboxEmail(state),
            actionLabel: '步骤 4：确认 2925 邮箱登录态',
          });
        } else {
          await focusOrOpenMailTab(mail);
        }
        await addLog(`步骤 4：将直接使用当前已登录的 ${mail.label} 轮询验证码。`, 'info');
      } else {
        await addLog(`步骤 4：正在打开${mail.label}...`);
        await focusOrOpenMailTab(mail);
      }

      const shouldRequestFreshCodeFirst = ![
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
      await resolveVerificationStep(4, state, mail, {
        filterAfterTimestamp: mailVerificationFilterAfterTimestamp,
        sessionKey: verificationSessionKey,
        disableTimeBudgetCap: mail.provider === '2925',
        requestFreshCodeFirst: shouldRequestFreshCodeFirst,
        signupProfile,
        password,
        resendIntervalMs: mail.provider === LUCKMAIL_PROVIDER
          ? 15000
          : ((mail.provider === HOTMAIL_PROVIDER || mail.provider === ICLOUD_API_PROVIDER || mail.provider === '2925')
            ? 0
            : STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS),
      });
    }

    async function focusOrOpenMailTab(mail) {
      const alive = await isTabAlive(mail.source);
      if (alive) {
        if (mail.navigateOnReuse) {
          await reuseOrCreateTab(mail.source, mail.url, {
            inject: mail.inject,
            injectSource: mail.injectSource,
          });
          return;
        }

        const tabId = await getTabId(mail.source);
        await chrome.tabs.update(tabId, { active: true });
        return;
      }

      await reuseOrCreateTab(mail.source, mail.url, {
        inject: mail.inject,
        injectSource: mail.injectSource,
      });
    }

    async function executeStep4(state) {
      const stepStartedAt = Date.now();
      const verificationSessionKey = `4:${stepStartedAt}`;
      const signupTabId = await getTabId('signup-page');

      if (!signupTabId) {
        throw new Error('认证页面标签页已关闭，无法继续步骤 4。请先执行步骤 1 或步骤 2，重新打开认证页后再试。');
      }

      const signupPassword = await ensureSignupPasswordForStep4(state);
      const stateWithPassword = signupPassword
        ? { ...state, password: signupPassword }
        : state;

      await chrome.tabs.update(signupTabId, { active: true });
      throwIfStopped();
      if (typeof waitForTabStableComplete === 'function') {
        await addLog('步骤 4：等待注册验证码页面完成加载后再继续...', 'info');
        await waitForTabStableComplete(signupTabId, {
          timeoutMs: 45000,
          retryDelayMs: 300,
          stableMs: 800,
          initialDelayMs: 300,
        });
      }
      throwIfStopped();

      const loginAuthState = await getLoginAuthStateFromSignupPage();
      if (isRegisteredLoginTotpVerificationState(loginAuthState)) {
        await addLog('步骤 4：检测到当前页是登录 TOTP 二次验证页，判定当前邮箱已注册，将标记为已用并切换下一个。', 'warn');
        throw buildRegisteredLoginVerificationError(loginAuthState);
      }

      await addLog('步骤 4：正在确认注册验证码页面是否就绪，必要时自动恢复密码页超时报错...');

      const prepareRequest = {
        type: 'PREPARE_SIGNUP_VERIFICATION',
        step: 4,
        source: 'background',
        payload: {
          password: signupPassword,
          prepareSource: 'step4_execute',
          prepareLogLabel: '步骤 4 执行',
        },
      };
      const prepareTimeoutMs = 30000;
      const prepareResponseTimeoutMs = 30000;
      const prepareStartAt = Date.now();
      let prepareResult = null;

      while (Date.now() - prepareStartAt < prepareTimeoutMs) {
        throwIfStopped();

        try {
          prepareResult = typeof sendToContentScript === 'function'
            ? await sendToContentScript('signup-page', prepareRequest, {
              responseTimeoutMs: prepareResponseTimeoutMs,
            })
            : await sendToContentScriptResilient('signup-page', prepareRequest, {
              timeoutMs: Math.max(1000, prepareTimeoutMs - (Date.now() - prepareStartAt)),
              responseTimeoutMs: prepareResponseTimeoutMs,
              retryDelayMs: 700,
              logMessage: '步骤 4：认证页正在切换，等待页面重新就绪后继续检测...',
            });
          break;
        } catch (error) {
          if (!isRetryableContentScriptTransportError(error)) {
            throw error;
          }

          const remainingMs = Math.max(0, prepareTimeoutMs - (Date.now() - prepareStartAt));
          if (remainingMs <= 0) {
            throw error;
          }

          const recoverResult = await sendToContentScriptResilient('signup-page', {
            type: 'RECOVER_AUTH_RETRY_PAGE',
            step: 4,
            source: 'background',
            payload: {
              flow: 'signup',
              step: 4,
              timeoutMs: Math.min(12000, remainingMs),
              maxClickAttempts: 2,
              logLabel: '步骤 4：检测到注册认证重试页，正在点击“重试”恢复',
            },
          }, {
            timeoutMs: Math.min(12000, remainingMs),
            responseTimeoutMs: Math.min(12000, remainingMs),
            retryDelayMs: 700,
            logMessage: '步骤 4：认证页正在切换，等待页面重新就绪后继续检测...',
          });

          if (recoverResult?.error) {
            throw new Error(recoverResult.error);
          }
        }
      }

      if (!prepareResult) {
        throw new Error('步骤 4：等待注册验证码页面就绪超时，请刷新认证页后重试。');
      }

      if (prepareResult && prepareResult.error) {
        throw new Error(prepareResult.error);
      }
      if (prepareResult?.alreadyVerified) {
        await completeNodeFromBackground('fetch-signup-code', prepareResult?.skipProfileStep ? { skipProfileStep: true } : {});
        return;
      }

      if (isPhoneSignupState(state)) {
        const phoneResult = await executeSignupPhoneCodeStep(stateWithPassword, signupTabId);
        if (phoneResult?.emailVerificationRequired || phoneResult?.emailVerificationPage) {
          await addLog('步骤 4：手机验证码已通过，OpenAI 要求继续邮箱验证，切换到邮箱验证码轮询。', 'info');
          return executeSignupEmailVerificationStep(stateWithPassword, stepStartedAt, verificationSessionKey);
        }
        return phoneResult;
      }

      return executeSignupEmailVerificationStep(stateWithPassword, stepStartedAt, verificationSessionKey);
    }

    return { executeStep4 };
  }

  return { createStep4Executor };
});
