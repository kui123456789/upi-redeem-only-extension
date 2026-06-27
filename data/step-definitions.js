(function attachStepDefinitions(root, factory) {
  root.MultiPageStepDefinitions = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createStepDefinitionsModule() {
  const DEFAULT_ACTIVE_FLOW_ID = 'openai';
  const PLUS_PAYMENT_METHOD_UPI = 'upi';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH = 'oauth';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH = 'sms_oauth';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH = 'phone_bind_oauth';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION = 'sub2api_codex_session';
  const PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION = 'cpa_codex_session';
  const SIGNUP_METHOD_EMAIL = 'email';
  const SIGNUP_METHOD_PHONE = 'phone';

  const UPI_STEP_DEFINITIONS = Object.freeze([
    { id: 1, order: 10, key: 'open-chatgpt', title: '打开 ChatGPT 官网', sourceId: 'chatgpt', driverId: null, command: 'open-chatgpt' },
    { id: 2, order: 20, key: 'submit-signup-email', title: '注册并输入邮箱', sourceId: 'openai-auth', driverId: 'content/signup-page', command: 'submit-signup-email' },
    { id: 3, order: 30, key: 'fill-password', title: '填写密码并继续', sourceId: 'openai-auth', driverId: 'content/signup-page', command: 'fill-password' },
    { id: 4, order: 40, key: 'fetch-signup-code', title: '获取注册验证码', sourceId: 'openai-auth', driverId: 'content/signup-page', command: 'submit-verification-code', mailRuleId: 'openai-signup-code' },
    { id: 5, order: 50, key: 'fill-profile', title: '填写姓名和生日', sourceId: 'openai-auth', driverId: 'content/signup-page', command: 'fill-profile' },
    { id: 6, order: 60, key: 'set-gpt-password', title: '设置 GPT 密码', sourceId: 'openai-auth', driverId: null, command: 'set-gpt-password' },
    { id: 7, order: 70, key: 'enable-totp-mfa', title: '开通 2FA 并检测资格', sourceId: 'chatgpt', driverId: null, command: 'enable-totp-mfa' },
  ]);

  function normalizeActiveFlowId(value = '', fallback = DEFAULT_ACTIVE_FLOW_ID) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
    const fallbackValue = String(fallback || '').trim().toLowerCase();
    return fallbackValue || DEFAULT_ACTIVE_FLOW_ID;
  }

  function normalizePlusPaymentMethod() {
    return PLUS_PAYMENT_METHOD_UPI;
  }

  function normalizeSignupMethod() {
    return SIGNUP_METHOD_EMAIL;
  }

  function normalizePlusAccountAccessStrategy() {
    return PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH;
  }

  function isPlusModeEnabled() {
    return true;
  }

  function cloneSteps(steps = [], options = {}, flowId = DEFAULT_ACTIVE_FLOW_ID) {
    return steps.map((step) => ({ ...step, flowId }));
  }

  function cloneNodes(steps = [], options = {}, flowId = DEFAULT_ACTIVE_FLOW_ID) {
    return steps.map((step, index) => {
      const nodeId = String(step.key || '').trim();
      return {
        legacyStepId: Number(step.id),
        nodeId,
        flowId,
        title: step.title,
        displayOrder: Number.isFinite(Number(step.order)) ? Number(step.order) : Number(step.id),
        nodeType: 'task',
        sourceId: step.sourceId || '',
        driverId: step.driverId || '',
        executeKey: nodeId,
        command: String(step.command || step.key || '').trim(),
        mailRuleId: String(step.mailRuleId || '').trim(),
        next: steps[index + 1]?.key ? [String(steps[index + 1].key)] : [],
        retryPolicy: {},
        recoveryPolicy: {},
        ui: {},
      };
    }).filter((node) => Boolean(node.nodeId));
  }

  function getSteps(options = {}) {
    const flowId = normalizeActiveFlowId(options?.activeFlowId, DEFAULT_ACTIVE_FLOW_ID);
    return cloneSteps(UPI_STEP_DEFINITIONS, options, flowId);
  }

  function getNodes(options = {}) {
    const flowId = normalizeActiveFlowId(options?.activeFlowId, DEFAULT_ACTIVE_FLOW_ID);
    return cloneNodes(UPI_STEP_DEFINITIONS, options, flowId);
  }

  function getAllSteps(options = {}) {
    return getSteps(options);
  }

  function getAllNodes(options = {}) {
    return getNodes(options);
  }

  function getStepIds(options = {}) {
    return getSteps(options).map((step) => Number(step.id)).filter(Number.isFinite);
  }

  function getNodeIds(options = {}) {
    return getNodes(options).map((node) => node.nodeId);
  }

  function getLastStepId(options = {}) {
    const ids = getStepIds(options);
    return ids[ids.length - 1] || 0;
  }

  function getStepById(id, options = {}) {
    const numericId = Number(id);
    return getSteps(options).find((step) => Number(step.id) === numericId) || null;
  }

  function getNodeById(nodeId, options = {}) {
    const normalizedNodeId = String(nodeId || '').trim();
    return getNodes(options).find((node) => node.nodeId === normalizedNodeId) || null;
  }

  function getNodeByDisplayOrder(displayOrder, options = {}) {
    const normalizedOrder = Number(displayOrder);
    return getNodes(options).find((node) => Number(node.displayOrder) === normalizedOrder) || null;
  }

  function getWorkflow(options = {}) {
    const flowId = normalizeActiveFlowId(options?.activeFlowId || options?.flowId, DEFAULT_ACTIVE_FLOW_ID);
    const nodes = getNodes({ ...options, activeFlowId: flowId, flowId });
    return {
      flowId,
      workflowVersion: 1,
      nodes,
      nodeIds: nodes.map((node) => node.nodeId),
    };
  }

  function getPlusPaymentStepTitle() {
    return 'UPI 试用资格检测';
  }

  function getRegisteredFlowIds() {
    return [DEFAULT_ACTIVE_FLOW_ID];
  }

  function hasFlow(flowId) {
    return normalizeActiveFlowId(flowId, '') === DEFAULT_ACTIVE_FLOW_ID;
  }

  return {
    DEFAULT_ACTIVE_FLOW_ID,
    STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    NORMAL_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    NORMAL_PHONE_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    NORMAL_PHONE_BOUND_EMAIL_RELOGIN_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_ACCOUNT_ACCESS_STRATEGY_OAUTH,
    PLUS_ACCOUNT_ACCESS_STRATEGY_SMS_OAUTH,
    PLUS_ACCOUNT_ACCESS_STRATEGY_PHONE_BIND_OAUTH,
    PLUS_ACCOUNT_ACCESS_STRATEGY_SUB2API_CODEX_SESSION,
    PLUS_ACCOUNT_ACCESS_STRATEGY_CPA_CODEX_SESSION,
    PLUS_PAYPAL_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_SMS_OAUTH_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_PHONE_BIND_OAUTH_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_SUB2API_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_CPA_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_PHONE_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_PHONE_BOUND_EMAIL_RELOGIN_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_HOSTED_CHECKOUT_SUB2API_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_PAYPAL_HOSTED_CHECKOUT_CPA_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GOPAY_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GOPAY_SUB2API_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GOPAY_CPA_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GOPAY_PHONE_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GOPAY_PHONE_BOUND_EMAIL_RELOGIN_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GPC_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GPC_SUB2API_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GPC_CPA_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GPC_PHONE_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_GPC_PHONE_BOUND_EMAIL_RELOGIN_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_UPI_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_UPI_SUB2API_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_UPI_CPA_SESSION_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_UPI_PHONE_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    PLUS_UPI_PHONE_BOUND_EMAIL_RELOGIN_STEP_DEFINITIONS: UPI_STEP_DEFINITIONS,
    SIGNUP_METHOD_EMAIL,
    SIGNUP_METHOD_PHONE,
    getAllSteps,
    getAllNodes,
    getLastStepId,
    getNodeByDisplayOrder,
    getNodeById,
    getNodeIds,
    getNodes,
    getPlusPaymentStepTitle,
    getRegisteredFlowIds,
    getStepById,
    getStepIds,
    getSteps,
    getWorkflow,
    hasFlow,
    isPlusModeEnabled,
    normalizePlusAccountAccessStrategy,
    normalizeActiveFlowId,
    normalizePlusPaymentMethod,
    normalizeSignupMethod,
  };
});
