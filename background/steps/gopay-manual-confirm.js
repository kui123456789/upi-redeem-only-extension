(function attachBackgroundGoPayManualConfirm(root, factory) {
  root.MultiPageBackgroundGoPayManualConfirm = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGoPayManualConfirmModule() {
  const PLUS_CHECKOUT_SOURCE = 'plus-checkout';
  const DEFAULT_CONFIRM_TITLE = 'GoPay 订阅确认';
  const DEFAULT_CONFIRM_MESSAGE = 'GoPay 订阅页已打开。请先手动完成订阅，完成后确认继续 OAuth 登录。';

  function createGoPayManualConfirmExecutor(deps = {}) {
    const {
      addLog,
      broadcastDataUpdate,
      chrome,
      createAutomationTab = null,
      getTabId,
      isTabAlive,
      registerTab,
      setState,
    } = deps;

    function buildRequestId() {
      return `gopay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function resolveCheckoutTabId(state = {}) {
      const registeredTabId = typeof getTabId === 'function'
        ? await getTabId(PLUS_CHECKOUT_SOURCE)
        : null;
      if (registeredTabId && typeof isTabAlive === 'function' && await isTabAlive(PLUS_CHECKOUT_SOURCE)) {
        return Number(registeredTabId) || 0;
      }

      const storedTabId = Number(state?.plusCheckoutTabId) || 0;
      if (storedTabId && chrome?.tabs?.get) {
        const tab = await chrome.tabs.get(storedTabId).catch(() => null);
        if (tab?.id) {
          if (typeof registerTab === 'function') {
            await registerTab(PLUS_CHECKOUT_SOURCE, tab.id);
          }
          return tab.id;
        }
      }

      const checkoutUrl = String(state?.plusCheckoutUrl || '').trim();
      if (!checkoutUrl) {
        throw new Error('步骤 7：未检测到 GoPay 订阅页，请先执行步骤 6。');
      }

      if (!chrome?.tabs?.create) {
        throw new Error('步骤 7：无法自动重新打开 GoPay 订阅页。');
      }

      const tab = typeof createAutomationTab === 'function'
        ? await createAutomationTab({ url: checkoutUrl, active: true })
        : await chrome.tabs.create({ url: checkoutUrl, active: true });
      const tabId = Number(tab?.id) || 0;
      if (!tabId) {
        throw new Error('步骤 7：重新打开 GoPay 订阅页失败。');
      }
      if (typeof registerTab === 'function') {
        await registerTab(PLUS_CHECKOUT_SOURCE, tabId);
      }
      return tabId;
    }

    async function executeGoPayManualConfirm(state = {}) {
      const tabId = await resolveCheckoutTabId(state);
      if (chrome?.tabs?.update && tabId) {
        await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      }

      const payload = {
        plusCheckoutTabId: tabId,
        plusManualConfirmationPending: true,
        plusManualConfirmationRequestId: buildRequestId(),
        plusManualConfirmationStep: 7,
        plusManualConfirmationMethod: 'gopay',
        plusManualConfirmationTitle: DEFAULT_CONFIRM_TITLE,
        plusManualConfirmationMessage: DEFAULT_CONFIRM_MESSAGE,
      };

      await setState(payload);
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate(payload);
      }

      await addLog('步骤 7：正在等待手动完成 GoPay 订阅，确认后继续 OAuth 登录。', 'info');
    }

    return {
      executeGoPayManualConfirm,
    };
  }

  return {
    createGoPayManualConfirmExecutor,
  };
});
