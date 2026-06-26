(function attachBackgroundPlusReturnConfirm(root, factory) {
  root.MultiPageBackgroundPlusReturnConfirm = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPlusReturnConfirmModule() {
  const PAYPAL_SOURCE = 'paypal-flow';
  const GOPAY_SOURCE = 'gopay-flow';
  const PLUS_CHECKOUT_SOURCE = 'plus-checkout';
  const PLUS_RETURN_SETTLE_WAIT_MS = 20000;
  const PPBOOM_PLUS_CHECKOUT_SOURCE = 'ppboom-paypal-redirect';
  const ADSPOWER_PLUS_CHECKOUT_SOURCE = 'ppboom-adspower-redirect';
  const PPBOOM_SUCCESS_CHECK_WAIT_MS = 3000;
  const PLUS_CHECKOUT_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/plus-checkout.js'];

  function createPlusReturnConfirmExecutor(deps = {}) {
    const {
      addLog,
      completeNodeFromBackground,
      createAutomationTab = null,
      ensureContentScriptReadyOnTabUntilStopped = null,
      getTabId,
      isTabAlive,
      registerTab = null,
      sendTabMessageUntilStopped = null,
      setState,
      sleepWithStop,
      waitForTabCompleteUntilStopped = null,
      waitForTabUrlMatchUntilStopped,
    } = deps;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function isPpBoomCheckoutSource(state = {}) {
      return normalizeString(state?.plusCheckoutSource) === PPBOOM_PLUS_CHECKOUT_SOURCE;
    }

    function isAdsPowerCheckoutSource(state = {}) {
      return Boolean(state?.plusActivatedByAdsPowerCheckout)
        || normalizeString(state?.plusCheckoutSource) === ADSPOWER_PLUS_CHECKOUT_SOURCE;
    }

    async function resolveReturnTabId(state = {}) {
      const paypalTabId = await getTabId(PAYPAL_SOURCE);
      if (paypalTabId && await isTabAlive(PAYPAL_SOURCE)) {
        return paypalTabId;
      }
      const gopayTabId = await getTabId(GOPAY_SOURCE);
      if (gopayTabId && await isTabAlive(GOPAY_SOURCE)) {
        return gopayTabId;
      }
      const checkoutTabId = await getTabId(PLUS_CHECKOUT_SOURCE);
      if (checkoutTabId) {
        return checkoutTabId;
      }
      const storedTabId = Number(state.plusCheckoutTabId) || 0;
      if (storedTabId) {
        return storedTabId;
      }
      throw new Error('步骤 9：未找到 Plus / PayPal / GoPay 标签页，无法确认订阅回跳。');
    }

    function isReturnUrl(url = '') {
      return /https:\/\/(?:chatgpt\.com|chat\.openai\.com|openai\.com)\//i.test(String(url || ''))
        && !/paypal\.|gopay|gojek|midtrans|xendit|stripe/i.test(String(url || ''));
    }

    function isHostedCheckoutPage(url = '') {
      return /^https:\/\/(?:pay\.openai\.com|checkout\.stripe\.com)\/c\/pay\/cs_/i.test(String(url || '').trim());
    }

    function isHostedCheckoutSucceededRedirectUrl(url = '') {
      try {
        const parsed = new URL(String(url || '').trim());
        return isHostedCheckoutPage(url)
          && String(parsed.searchParams.get('redirect_status') || '').trim().toLowerCase() === 'succeeded';
      } catch {
        return false;
      }
    }

    function isPaidPlanType(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      return !/(^|[_-])(free|guest|basic|default|none|null|unknown)([_-]|$)/i.test(normalized);
    }

    function collectSessionFieldValues(root, targetKeys = []) {
      const normalizedTargets = new Set((Array.isArray(targetKeys) ? targetKeys : []).map((key) => normalizeString(key).toLowerCase()));
      if (!normalizedTargets.size || !root || typeof root !== 'object') {
        return [];
      }
      const queue = [{ value: root, path: '$' }];
      const matches = [];
      while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current.value !== 'object' || current.value === null) {
          continue;
        }
        if (Array.isArray(current.value)) {
          current.value.forEach((item, index) => {
            queue.push({ value: item, path: `${current.path}[${index}]` });
          });
          continue;
        }
        Object.entries(current.value).forEach(([key, value]) => {
          const path = `${current.path}.${key}`;
          if (normalizedTargets.has(normalizeString(key).toLowerCase())) {
            matches.push({ path, value });
          }
          if (value && typeof value === 'object') {
            queue.push({ value, path });
          }
        });
      }
      return matches;
    }

    function inspectPlusActivationFromSession(session = null) {
      const planSignals = collectSessionFieldValues(session, [
        'planType',
        'plan_type',
        'chatgpt_plan_type',
      ]);
      const booleanSignals = collectSessionFieldValues(session, [
        'isPaid',
        'is_paid',
        'hasActiveSubscription',
        'has_active_subscription',
        'subscriptionActive',
        'subscription_active',
        'isSubscribed',
        'is_subscribed',
      ]);
      const planType = normalizeString(
        (planSignals.find((entry) => typeof entry?.value === 'string') || {}).value
        || session?.account?.planType
        || session?.account?.plan_type
        || session?.planType
        || session?.plan_type
      );
      const paidSignal = booleanSignals.some((entry) => entry?.value === true);
      return {
        active: paidSignal || isPaidPlanType(planType),
        planType,
        paidSignal,
      };
    }

    async function readPlusCheckoutState(tabId, options = {}) {
      if (typeof waitForTabCompleteUntilStopped === 'function') {
        await waitForTabCompleteUntilStopped(tabId);
      }
      await sleepWithStop(1000);
      if (typeof ensureContentScriptReadyOnTabUntilStopped === 'function') {
        await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
          inject: PLUS_CHECKOUT_INJECT_FILES,
          injectSource: PLUS_CHECKOUT_SOURCE,
          logMessage: '步骤 9：正在等待页面完成加载，再继续检查支付完成状态...',
        });
      }
      if (typeof sendTabMessageUntilStopped !== 'function') {
        throw new Error('步骤 9：未接入 PLUS_CHECKOUT_GET_STATE 通信能力。');
      }
      const result = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'PLUS_CHECKOUT_GET_STATE',
        source: 'background',
        payload: options,
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function openFreshChatGptSessionTab() {
      const tab = typeof createAutomationTab === 'function'
        ? await createAutomationTab({ url: 'https://chatgpt.com/', active: true })
        : null;
      const tabId = Number(tab?.id);
      if (!Number.isInteger(tabId) || tabId <= 0) {
        throw new Error('步骤 9：打开新的 ChatGPT 会话页失败，无法检查 Plus 状态。');
      }
      if (typeof registerTab === 'function') {
        await registerTab(PLUS_CHECKOUT_SOURCE, tabId);
      }
      return tabId;
    }

    async function verifyPpBoomSuccessPagePlusActivation(successTabId, successUrl, pageState = {}) {
      const title = normalizeString(pageState?.hostedCompletionTitle || '');
      const detail = normalizeString(pageState?.hostedCompletionDetail || '');
      await addLog(
        `步骤 9：检测到 PPBoom 支付成功页${title ? `（${title}${detail ? ` / ${detail}` : ''}）` : ''}，正在新开 ChatGPT 标签检查 Plus 状态...`,
        'info'
      );
      const sessionTabId = await openFreshChatGptSessionTab();
      if (typeof waitForTabCompleteUntilStopped === 'function') {
        await waitForTabCompleteUntilStopped(sessionTabId);
      }
      await sleepWithStop(PPBOOM_SUCCESS_CHECK_WAIT_MS);
      const sessionState = await readPlusCheckoutState(sessionTabId, {
        includeSession: true,
        includeAccessToken: true,
      });
      const activation = inspectPlusActivationFromSession(sessionState?.session || null);
      if (!activation.active) {
        throw new Error(
          `步骤 9：PPBoom 成功页后检查会话仍未命中 Plus 状态（planType=${activation.planType || 'unknown'}${activation.paidSignal ? ', paid=true' : ''}）。`
        );
      }
      await addLog(
        `步骤 9：PPBoom 成功页后已在新会话中确认 Plus 生效（planType=${activation.planType || 'paid'}），准备继续刷新 OAuth 并登录。`,
        'ok'
      );
      await setState({
        plusCheckoutTabId: sessionTabId,
        plusReturnUrl: successUrl,
      });
      await completeNodeFromBackground('plus-checkout-return', {
        plusReturnUrl: successUrl,
        plusActivatedByPpBoomSuccessPage: true,
        ppboomSuccessPageTabId: successTabId,
        ppboomSessionCheckTabId: sessionTabId,
      });
      return true;
    }

    async function verifyAdsPowerCheckoutPlusActivation(state = {}) {
      await addLog('步骤 9：检测到 AdsPower 支付链路已完成，正在新开 ChatGPT 标签检查 Plus 状态...', 'info');
      const sessionTabId = await openFreshChatGptSessionTab();
      if (typeof waitForTabCompleteUntilStopped === 'function') {
        await waitForTabCompleteUntilStopped(sessionTabId);
      }
      await sleepWithStop(PPBOOM_SUCCESS_CHECK_WAIT_MS);
      const sessionState = await readPlusCheckoutState(sessionTabId, {
        includeSession: true,
        includeAccessToken: true,
      });
      const activation = inspectPlusActivationFromSession(sessionState?.session || null);
      if (!activation.active) {
        throw new Error(
          `步骤 9：AdsPower 支付链路后检查会话仍未命中 Plus 状态（planType=${activation.planType || 'unknown'}${activation.paidSignal ? ', paid=true' : ''}）。`
        );
      }
      await addLog(
        `步骤 9：AdsPower 支付链路后已在新会话中确认 Plus 生效（planType=${activation.planType || 'paid'}），准备继续刷新 OAuth 并登录。`,
        'ok'
      );
      await setState({
        plusCheckoutTabId: sessionTabId,
        plusReturnUrl: '',
      });
      await completeNodeFromBackground('plus-checkout-return', {
        plusReturnUrl: '',
        plusActivatedByAdsPowerCheckout: true,
        ppboomAdsPowerSessionCheckTabId: sessionTabId,
      });
      return true;
    }

    async function executePlusReturnConfirm(state = {}) {
      if (isAdsPowerCheckoutSource(state)) {
        return verifyAdsPowerCheckoutPlusActivation(state);
      }
      const tabId = await resolveReturnTabId(state);
      if (isPpBoomCheckoutSource(state)) {
        const currentTab = await chrome.tabs.get(tabId).catch(() => null);
        const currentUrl = normalizeString(currentTab?.url || '');
        if (isHostedCheckoutPage(currentUrl)) {
          const pageState = await readPlusCheckoutState(tabId);
          if (pageState?.hostedCompletionDetected || isHostedCheckoutSucceededRedirectUrl(currentUrl)) {
            return verifyPpBoomSuccessPagePlusActivation(tabId, currentUrl, pageState);
          }
        }
      }
      await addLog('步骤 9：正在等待支付授权后回跳到 ChatGPT / OpenAI 页面...', 'info');
      const tab = await waitForTabUrlMatchUntilStopped(tabId, isReturnUrl);
      await addLog('步骤 9：已检测到订阅回跳页面，固定等待 20 秒让页面完成加载。', 'info');
      await sleepWithStop(PLUS_RETURN_SETTLE_WAIT_MS);

      await setState({
        plusCheckoutTabId: tabId,
        plusReturnUrl: tab?.url || '',
      });
      await completeNodeFromBackground('plus-checkout-return', {
        plusReturnUrl: tab?.url || '',
      });
    }

    return {
      executePlusReturnConfirm,
    };
  }

  return {
    createPlusReturnConfirmExecutor,
  };
});
