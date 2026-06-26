(function attachMultiPageFlowCapabilities(root, factory) {
  root.MultiPageFlowCapabilities = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createFlowCapabilitiesModule() {
  const DEFAULT_FLOW_ID = 'openai';
  const DEFAULT_PANEL_MODE = 'local-cpa-json';
  const LOCAL_CPA_JSON_NO_RT_PANEL_MODE = 'local-cpa-json-no-rt';
  const SIGNUP_METHOD_EMAIL = 'email';
  const SIGNUP_METHOD_PHONE = 'phone';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH = 'oauth';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH = 'sms_oauth';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH = 'phone_bind_oauth';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION = 'sub2api_codex_session';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION = 'cpa_codex_session';
  const VALID_PANEL_MODES = Object.freeze(['local-cpa-json', LOCAL_CPA_JSON_NO_RT_PANEL_MODE, 'cpa', 'sub2api', 'codex2api']);

  const DEFAULT_FLOW_CAPABILITIES = Object.freeze({
    supportsEmailSignup: true,
    supportsPhoneSignup: false,
    supportsPhoneVerificationSettings: false,
    supportsPlusMode: false,
    supportsContributionMode: false,
    supportsPlatformBinding: [],
    supportsLuckmail: false,
    supportsOauthTimeoutBudget: false,
    canSwitchFlow: false,
    stepDefinitionMode: 'default',
  });

  const FLOW_CAPABILITIES = Object.freeze({
    openai: Object.freeze({
      ...DEFAULT_FLOW_CAPABILITIES,
      supportsPhoneSignup: true,
      supportsPhoneVerificationSettings: true,
      supportsPlusMode: true,
      supportsContributionMode: true,
      supportsPlatformBinding: ['local-cpa-json', LOCAL_CPA_JSON_NO_RT_PANEL_MODE, 'cpa', 'sub2api', 'codex2api'],
      supportsLuckmail: true,
      supportsOauthTimeoutBudget: true,
      stepDefinitionMode: 'openai-dynamic',
    }),
  });

  const DEFAULT_PANEL_CAPABILITIES = Object.freeze({
    supportsPhoneSignup: true,
    supportedPlusAccountAccessStrategies: Object.freeze([PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH]),
  });
  const MODE_SWITCH_RELEVANT_KEYS = Object.freeze([
    'activeFlowId',
    'contributionMode',
    'panelMode',
    'phoneVerificationEnabled',
    'plusAccountAccessStrategy',
    'plusModeEnabled',
    'signupMethod',
  ]);

  const PANEL_CAPABILITIES = Object.freeze({
    cpa: Object.freeze({
      supportsPhoneSignup: true,
      supportedPlusAccountAccessStrategies: Object.freeze([
        PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION,
      ]),
    }),
    'local-cpa-json': Object.freeze({
      supportsPhoneSignup: true,
      supportedPlusAccountAccessStrategies: Object.freeze([
        PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH,
      ]),
    }),
    [LOCAL_CPA_JSON_NO_RT_PANEL_MODE]: Object.freeze({
      supportsPhoneSignup: true,
      supportedPlusAccountAccessStrategies: Object.freeze([
        PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH,
      ]),
    }),
    sub2api: Object.freeze({
      supportsPhoneSignup: true,
      supportedPlusAccountAccessStrategies: Object.freeze([
        PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH,
        PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION,
      ]),
    }),
    codex2api: Object.freeze({
      supportsPhoneSignup: true,
    }),
  });

  function normalizeFlowId(value = '', fallback = DEFAULT_FLOW_ID) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
    const fallbackValue = String(fallback || '').trim().toLowerCase();
    return fallbackValue || DEFAULT_FLOW_ID;
  }

  function normalizePanelMode(value = '', fallback = DEFAULT_PANEL_MODE) {
    const normalized = String(value || '').trim().toLowerCase();
    if (VALID_PANEL_MODES.includes(normalized)) {
      return normalized;
    }
    const fallbackValue = String(fallback || '').trim().toLowerCase();
    return VALID_PANEL_MODES.includes(fallbackValue) ? fallbackValue : DEFAULT_PANEL_MODE;
  }

  function normalizeSignupMethod(value = '') {
    return String(value || '').trim().toLowerCase() === SIGNUP_METHOD_PHONE
      ? SIGNUP_METHOD_PHONE
      : SIGNUP_METHOD_EMAIL;
  }

  function normalizePlusAccountAccessStrategy(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH) {
      return PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH;
    }
    if (normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH) {
      return PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH;
    }
    if (normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION) {
      return PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION;
    }
    if (normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION) {
      return PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION;
    }
    return PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH;
  }

  function getPlusAccountSessionStrategyForPanel(panelMode = '') {
    const normalizedPanelMode = normalizePanelMode(panelMode);
    if (normalizedPanelMode === 'sub2api') {
      return PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION;
    }
    if (normalizedPanelMode === 'cpa') {
      return PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION;
    }
    return PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH;
  }

  function normalizePlusAccountAccessStrategyForPanel(value = '', panelMode = '') {
    const normalized = normalizePlusAccountAccessStrategy(value);
    if (normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH) {
      return ['cpa', 'local-cpa-json', LOCAL_CPA_JSON_NO_RT_PANEL_MODE, 'sub2api'].includes(normalizePanelMode(panelMode))
        ? PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH
        : PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH;
    }
    if (normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH) {
      return ['cpa', 'local-cpa-json', LOCAL_CPA_JSON_NO_RT_PANEL_MODE, 'sub2api'].includes(normalizePanelMode(panelMode))
        ? PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH
        : PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH;
    }
    if (
      normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION
      || normalized === PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION
    ) {
      return getPlusAccountSessionStrategyForPanel(panelMode);
    }
    return normalized;
  }

  function normalizePanelModeList(values = []) {
    if (!Array.isArray(values)) {
      return [];
    }
    const seen = new Set();
    const normalized = [];
    values.forEach((value) => {
      const mode = normalizePanelMode(value, '');
      if (!mode || seen.has(mode)) {
        return;
      }
      seen.add(mode);
      normalized.push(mode);
    });
    return normalized;
  }

  function getPanelModeLabel(panelMode = '') {
    const normalized = normalizePanelMode(panelMode);
    if (normalized === 'local-cpa-json') {
      return '本地CPA JSON 有RT';
    }
    if (normalized === LOCAL_CPA_JSON_NO_RT_PANEL_MODE) {
      return '本地CPA JSON 无RT';
    }
    if (normalized === 'sub2api') {
      return 'SUB2API';
    }
    if (normalized === 'codex2api') {
      return 'Codex2API';
    }
    return 'CPA';
  }

  function createFlowCapabilityRegistry(deps = {}) {
    const {
      defaultFlowCapabilities = DEFAULT_FLOW_CAPABILITIES,
      defaultFlowId = DEFAULT_FLOW_ID,
      defaultPanelCapabilities = DEFAULT_PANEL_CAPABILITIES,
      flowCapabilities = FLOW_CAPABILITIES,
      panelCapabilities = PANEL_CAPABILITIES,
    } = deps;

    function getFlowCapabilities(flowId) {
      const normalizedFlowId = normalizeFlowId(flowId, defaultFlowId);
      const entry = flowCapabilities[normalizedFlowId] || null;
      return {
        ...defaultFlowCapabilities,
        ...(entry || {}),
        supportsPlatformBinding: normalizePanelModeList(entry?.supportsPlatformBinding || defaultFlowCapabilities.supportsPlatformBinding),
      };
    }

    function getPanelCapabilities(panelMode) {
      const normalizedPanelMode = normalizePanelMode(panelMode);
      return {
        ...defaultPanelCapabilities,
        ...(panelCapabilities[normalizedPanelMode] || {}),
      };
    }

    function normalizeChangedKeys(values = []) {
      const list = Array.isArray(values) ? values : [];
      const seen = new Set();
      const normalized = [];
      list.forEach((value) => {
        const key = String(value || '').trim();
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        normalized.push(key);
      });
      return normalized;
    }

    function resolveSidepanelCapabilities(options = {}) {
      const state = options?.state || {};
      const activeFlowId = normalizeFlowId(
        options?.activeFlowId ?? state?.activeFlowId,
        defaultFlowId
      );
      const flowState = getFlowCapabilities(activeFlowId);
      const requestedPanelMode = normalizePanelMode(
        options?.panelMode ?? state?.panelMode,
        DEFAULT_PANEL_MODE
      );
      const supportedPanelModes = normalizePanelModeList(flowState.supportsPlatformBinding);
      const panelModeSupported = supportedPanelModes.length === 0
        ? true
        : supportedPanelModes.includes(requestedPanelMode);
      const effectivePanelMode = panelModeSupported
        ? requestedPanelMode
        : supportedPanelModes[0];
      const panelState = getPanelCapabilities(effectivePanelMode);
      const runtimeLocks = {
        autoRunLocked: Boolean(options?.autoRunLocked ?? state?.autoRunLocked),
        contributionMode: flowState.supportsContributionMode && Boolean(state?.contributionMode),
        phoneVerificationEnabled: flowState.supportsPhoneVerificationSettings && Boolean(state?.phoneVerificationEnabled),
        plusModeEnabled: flowState.supportsPlusMode && Boolean(state?.plusModeEnabled),
        settingsMenuLocked: Boolean(options?.settingsMenuLocked ?? state?.settingsMenuLocked),
      };
      const requestedPlusAccountAccessStrategy = normalizePlusAccountAccessStrategyForPanel(
        options?.plusAccountAccessStrategy ?? state?.plusAccountAccessStrategy,
        effectivePanelMode
      );
      const panelPlusAccountAccessStrategies = (Array.isArray(panelState.supportedPlusAccountAccessStrategies)
        && panelState.supportedPlusAccountAccessStrategies.length > 0
        ? panelState.supportedPlusAccountAccessStrategies
        : [PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH])
        .map(normalizePlusAccountAccessStrategy)
        .filter((strategy, index, strategies) => strategy && strategies.indexOf(strategy) === index);
      const canUseSmsOauthPhoneSignup = activeFlowId === 'openai'
        && Boolean(runtimeLocks.plusModeEnabled)
        && requestedPlusAccountAccessStrategy === PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH
        && panelPlusAccountAccessStrategies.includes(PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH);
      const canUsePhoneBindOauth = activeFlowId === 'openai'
        && Boolean(runtimeLocks.plusModeEnabled)
        && requestedPlusAccountAccessStrategy === PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH
        && panelPlusAccountAccessStrategies.includes(PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH);
      const effectiveSignupMethods = [];
      if (flowState.supportsEmailSignup !== false) {
        effectiveSignupMethods.push(SIGNUP_METHOD_EMAIL);
      }
      const canSelectPhoneSignup = Boolean(flowState.supportsPhoneSignup)
        && Boolean(panelState.supportsPhoneSignup)
        && runtimeLocks.phoneVerificationEnabled
        && !runtimeLocks.contributionMode;
      const phoneSignupSelectable = canSelectPhoneSignup
        && (!runtimeLocks.plusModeEnabled || canUseSmsOauthPhoneSignup);
      if (phoneSignupSelectable) {
        effectiveSignupMethods.push(SIGNUP_METHOD_PHONE);
      }
      if (!effectiveSignupMethods.length) {
        effectiveSignupMethods.push(SIGNUP_METHOD_EMAIL);
      }
      const requestedSignupMethod = normalizeSignupMethod(
        options?.signupMethod ?? state?.signupMethod
      );
      const effectiveSignupMethod = canUsePhoneBindOauth
        ? SIGNUP_METHOD_EMAIL
        : (canUseSmsOauthPhoneSignup
        ? SIGNUP_METHOD_PHONE
        : (requestedSignupMethod === SIGNUP_METHOD_PHONE && phoneSignupSelectable
        ? SIGNUP_METHOD_PHONE
        : (effectiveSignupMethods.includes(SIGNUP_METHOD_EMAIL)
          ? SIGNUP_METHOD_EMAIL
          : effectiveSignupMethods[0])));
      const availablePlusAccountAccessStrategies = activeFlowId === 'openai'
        && Boolean(flowState.supportsPlusMode)
        && Boolean(runtimeLocks.plusModeEnabled)
        ? panelPlusAccountAccessStrategies
        : [PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH];
      const effectivePlusAccountAccessStrategy = availablePlusAccountAccessStrategies.includes(requestedPlusAccountAccessStrategy)
        ? requestedPlusAccountAccessStrategy
        : PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH;
      const canEditPlusAccountAccessStrategy = activeFlowId === 'openai'
        && Boolean(flowState.supportsPlusMode)
        && Boolean(runtimeLocks.plusModeEnabled)
        && availablePlusAccountAccessStrategies.length > 1;

      return {
        activeFlowId,
        canShowContributionMode: Boolean(flowState.supportsContributionMode),
        canShowLuckmail: Boolean(flowState.supportsLuckmail),
        canShowPhoneSettings: Boolean(flowState.supportsPhoneVerificationSettings),
        canShowPlusSettings: Boolean(flowState.supportsPlusMode),
        canSwitchFlow: Boolean(flowState.canSwitchFlow),
        canEditPlusAccountAccessStrategy,
        canUsePhoneSignup: phoneSignupSelectable,
        canUseSelectedPanelMode: panelModeSupported,
        effectivePlusAccountAccessStrategy,
        effectivePanelMode,
        effectiveSignupMethod,
        effectiveSignupMethods,
        flowCapabilities: flowState,
        panelCapabilities: panelState,
        panelMode: effectivePanelMode,
        requestedPanelMode,
        requestedPlusAccountAccessStrategy,
        requestedSignupMethod,
        runtimeLocks,
        stepDefinitionOptions: {
          activeFlowId,
          panelMode: effectivePanelMode,
          plusAccountAccessStrategy: effectivePlusAccountAccessStrategy,
          plusModeEnabled: runtimeLocks.plusModeEnabled,
          signupMethod: effectiveSignupMethod,
        },
        availablePlusAccountAccessStrategies,
        supportedPanelModes,
      };
    }

    function buildPhoneSignupValidationError(capabilityState = {}) {
      const flowState = capabilityState.flowCapabilities || {};
      const panelState = capabilityState.panelCapabilities || {};
      const runtimeLocks = capabilityState.runtimeLocks || {};

      if (!flowState.supportsPhoneSignup) {
        return {
          code: 'phone_signup_flow_unsupported',
          message: '当前 flow 不支持手机号注册。',
        };
      }
      if (!panelState.supportsPhoneSignup) {
        return {
          code: 'phone_signup_panel_unsupported',
          message: `当前面板模式 ${getPanelModeLabel(capabilityState.requestedPanelMode)} 不支持手机号注册。`,
        };
      }
      if (!runtimeLocks.phoneVerificationEnabled) {
        return {
          code: 'phone_signup_phone_verification_disabled',
          message: '请先开启接码功能后再使用手机号注册。',
        };
      }
      if (runtimeLocks.plusModeEnabled) {
        return {
          code: 'phone_signup_plus_mode_locked',
          message: 'Plus 模式开启时不能使用手机号注册。',
        };
      }
      if (runtimeLocks.contributionMode) {
        return {
          code: 'phone_signup_contribution_mode_locked',
          message: '贡献模式开启时不能使用手机号注册。',
        };
      }
      return {
        code: 'phone_signup_unavailable',
        message: '当前设置暂不支持手机号注册。',
      };
    }

    function validateAutoRunStart(options = {}) {
      const state = options?.state || {};
      const capabilityState = resolveSidepanelCapabilities(options);
      const errors = [];

      if (
        Array.isArray(capabilityState.supportedPanelModes)
        && capabilityState.supportedPanelModes.length > 0
        && capabilityState.canUseSelectedPanelMode === false
      ) {
        errors.push({
          code: 'panel_mode_unsupported',
          message: `当前 flow 不支持 ${getPanelModeLabel(capabilityState.requestedPanelMode)} 面板模式。`,
        });
      }

      if (Boolean(state?.plusModeEnabled) && !capabilityState.flowCapabilities?.supportsPlusMode) {
        errors.push({
          code: 'plus_mode_unsupported',
          message: '当前 flow 不支持 Plus 模式。',
        });
      }

      if (Boolean(state?.contributionMode) && !capabilityState.flowCapabilities?.supportsContributionMode) {
        errors.push({
          code: 'contribution_mode_unsupported',
          message: '当前 flow 不支持贡献模式。',
        });
      }

      if (
        capabilityState.requestedSignupMethod === SIGNUP_METHOD_PHONE
        && capabilityState.effectiveSignupMethod !== SIGNUP_METHOD_PHONE
        && capabilityState.effectivePlusAccountAccessStrategy !== PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH
      ) {
        errors.push(buildPhoneSignupValidationError(capabilityState));
      }

      return {
        ok: errors.length === 0,
        errors,
        capabilityState,
      };
    }

    function validateModeSwitch(options = {}) {
      const state = options?.state || {};
      const changedKeys = normalizeChangedKeys(
        options?.changedKeys !== undefined
          ? options.changedKeys
          : Object.keys(state || {})
      );
      const changedKeySet = new Set(changedKeys);
      const capabilityState = resolveSidepanelCapabilities(options);
      const errors = [];
      const normalizedUpdates = {};
      const flowState = capabilityState.flowCapabilities || {};
      const requestedPhoneSignup = capabilityState.requestedSignupMethod === SIGNUP_METHOD_PHONE;
      const shouldReconcileSignupMethod = MODE_SWITCH_RELEVANT_KEYS.some((key) => changedKeySet.has(key));

      if (
        changedKeySet.has('panelMode')
        && Array.isArray(capabilityState.supportedPanelModes)
        && capabilityState.supportedPanelModes.length > 0
        && capabilityState.canUseSelectedPanelMode === false
      ) {
        normalizedUpdates.panelMode = capabilityState.effectivePanelMode;
        errors.push({
          code: 'panel_mode_unsupported',
          message: `当前 flow 不支持 ${getPanelModeLabel(capabilityState.requestedPanelMode)} 面板模式。`,
        });
      }

      if (changedKeySet.has('plusModeEnabled') && Boolean(state?.plusModeEnabled) && !flowState.supportsPlusMode) {
        normalizedUpdates.plusModeEnabled = false;
        errors.push({
          code: 'plus_mode_unsupported',
          message: '当前 flow 不支持 Plus 模式。',
        });
      }

      if (changedKeySet.has('contributionMode') && Boolean(state?.contributionMode) && !flowState.supportsContributionMode) {
        normalizedUpdates.contributionMode = false;
        errors.push({
          code: 'contribution_mode_unsupported',
          message: '当前 flow 不支持贡献模式。',
        });
      }

      if (
        changedKeySet.has('phoneVerificationEnabled')
        && Boolean(state?.phoneVerificationEnabled)
        && !flowState.supportsPhoneVerificationSettings
      ) {
        normalizedUpdates.phoneVerificationEnabled = false;
        errors.push({
          code: 'phone_verification_unsupported',
          message: '当前 flow 不支持接码配置。',
        });
      }

      if (
        shouldReconcileSignupMethod
        && requestedPhoneSignup
        && capabilityState.effectiveSignupMethod !== SIGNUP_METHOD_PHONE
      ) {
        normalizedUpdates.signupMethod = capabilityState.effectiveSignupMethod;
        if (capabilityState.effectivePlusAccountAccessStrategy !== PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH) {
          errors.push(buildPhoneSignupValidationError(capabilityState));
        }
      }

      if (
        changedKeySet.has('plusAccountAccessStrategy')
        && capabilityState.requestedPlusAccountAccessStrategy !== capabilityState.effectivePlusAccountAccessStrategy
      ) {
        normalizedUpdates.plusAccountAccessStrategy = capabilityState.effectivePlusAccountAccessStrategy;
      }

      return {
        ok: errors.length === 0,
        changedKeys,
        capabilityState,
        errors,
        normalizedUpdates,
      };
    }

    function canUsePhoneSignup(state = {}) {
      return resolveSidepanelCapabilities({ state }).canUsePhoneSignup;
    }

    function resolveSignupMethod(state = {}, signupMethod = undefined) {
      return resolveSidepanelCapabilities({
        signupMethod,
        state,
      }).effectiveSignupMethod;
    }

    return {
      canUsePhoneSignup,
      getFlowCapabilities,
      getPanelCapabilities,
      normalizeFlowId,
      normalizePanelMode,
      normalizeSignupMethod,
      resolveSidepanelCapabilities,
      resolveSignupMethod,
      validateAutoRunStart,
      validateModeSwitch,
    };
  }

  return {
    createFlowCapabilityRegistry,
    DEFAULT_FLOW_CAPABILITIES,
    DEFAULT_FLOW_ID,
    DEFAULT_PANEL_CAPABILITIES,
    DEFAULT_PANEL_MODE,
    FLOW_CAPABILITIES,
    PANEL_CAPABILITIES,
    PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH,
    PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH,
    PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH,
    PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION,
    PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION,
    SIGNUP_METHOD_EMAIL,
    SIGNUP_METHOD_PHONE,
    normalizeFlowId,
    normalizePanelMode,
    normalizePlusAccountAccessStrategy,
    normalizeSignupMethod,
  };
});
