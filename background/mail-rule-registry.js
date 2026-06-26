(function attachBackgroundMailRuleRegistry(root, factory) {
  root.MultiPageBackgroundMailRuleRegistry = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundMailRuleRegistryModule() {
  function createMailRuleRegistry(deps = {}) {
    const {
      defaultFlowId = 'openai',
      flowBuilders = {},
    } = deps;

    function resolveFlowId(state = {}) {
      const activeFlowId = String(state?.activeFlowId || '').trim();
      return activeFlowId || String(defaultFlowId || '').trim() || 'openai';
    }

    function getFlowBuilder(flowId) {
      const normalizedFlowId = String(flowId || '').trim();
      return normalizedFlowId ? flowBuilders[normalizedFlowId] || null : null;
    }

    function getVerificationMailRule(step, state = {}) {
      const flowId = resolveFlowId(state);
      const flowBuilder = getFlowBuilder(flowId);
      if (!flowBuilder || typeof flowBuilder.getRuleDefinition !== 'function') {
        throw new Error(`未找到 flow=${flowId} 的邮件规则定义。`);
      }
      return flowBuilder.getRuleDefinition(step, state);
    }

    function getVerificationMailRuleForNode(nodeId, state = {}) {
      const flowId = resolveFlowId(state);
      const flowBuilder = getFlowBuilder(flowId);
      if (!flowBuilder) {
        throw new Error(`未找到 flow=${flowId} 的邮件规则定义。`);
      }
      if (typeof flowBuilder.getRuleDefinitionForNode === 'function') {
        return flowBuilder.getRuleDefinitionForNode(nodeId, state);
      }
      if (typeof flowBuilder.getRuleDefinition === 'function') {
        return flowBuilder.getRuleDefinition({ nodeId }, state);
      }
      throw new Error(`未找到 flow=${flowId} 的邮件规则定义。`);
    }

    function buildVerificationPollPayload(step, state = {}, overrides = {}) {
      const flowId = resolveFlowId(state);
      const flowBuilder = getFlowBuilder(flowId);
      if (!flowBuilder || typeof flowBuilder.buildVerificationPollPayload !== 'function') {
        throw new Error(`未找到 flow=${flowId} 的邮件轮询规则构造器。`);
      }
      return flowBuilder.buildVerificationPollPayload(step, state, overrides);
    }

    function buildVerificationPollPayloadForNode(nodeId, state = {}, overrides = {}) {
      const flowId = resolveFlowId(state);
      const flowBuilder = getFlowBuilder(flowId);
      if (!flowBuilder) {
        throw new Error(`未找到 flow=${flowId} 的邮件轮询规则构造器。`);
      }
      if (typeof flowBuilder.buildVerificationPollPayloadForNode === 'function') {
        return flowBuilder.buildVerificationPollPayloadForNode(nodeId, state, overrides);
      }
      if (typeof flowBuilder.buildVerificationPollPayload === 'function') {
        return flowBuilder.buildVerificationPollPayload({ nodeId }, state, overrides);
      }
      throw new Error(`未找到 flow=${flowId} 的邮件轮询规则构造器。`);
    }

    return {
      buildVerificationPollPayload,
      buildVerificationPollPayloadForNode,
      getVerificationMailRule,
      getVerificationMailRuleForNode,
      resolveFlowId,
    };
  }

  return {
    createMailRuleRegistry,
  };
});
