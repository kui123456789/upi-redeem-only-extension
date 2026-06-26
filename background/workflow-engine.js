(function attachBackgroundWorkflowEngine(root, factory) {
  root.MultiPageBackgroundWorkflowEngine = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundWorkflowEngineModule() {
  function createWorkflowEngine(deps = {}) {
    const {
      defaultFlowId = 'openai',
      workflowDefinitions = null,
    } = deps;

    function normalizeFlowId(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized || defaultFlowId;
    }

    function normalizeNodeId(value = '') {
      return String(value || '').trim();
    }

    function resolveStateFlowId(state = {}) {
      return normalizeFlowId(state?.flowId || state?.activeFlowId || defaultFlowId);
    }

    function getWorkflow(options = {}) {
      const flowId = normalizeFlowId(options?.flowId || options?.activeFlowId || defaultFlowId);
      if (workflowDefinitions?.getWorkflow) {
        return workflowDefinitions.getWorkflow({
          ...options,
          activeFlowId: flowId,
          flowId,
        });
      }
      return {
        flowId,
        workflowVersion: 1,
        nodes: [],
        nodeIds: [],
      };
    }

    function getWorkflowForState(state = {}) {
      return getWorkflow({
        ...state,
        flowId: resolveStateFlowId(state),
        activeFlowId: resolveStateFlowId(state),
      });
    }

    function getNodesForState(state = {}) {
      return Array.isArray(getWorkflowForState(state).nodes)
        ? getWorkflowForState(state).nodes
        : [];
    }

    function getNodeIdsForState(state = {}) {
      return getNodesForState(state).map((node) => node.nodeId).filter(Boolean);
    }

    function getNodeById(nodeId, state = {}) {
      const normalizedNodeId = normalizeNodeId(nodeId);
      if (!normalizedNodeId) {
        return null;
      }
      return getNodesForState(state).find((node) => node.nodeId === normalizedNodeId) || null;
    }

    function getDisplayOrderForNode(nodeId, state = {}) {
      const node = getNodeById(nodeId, state);
      return Number.isFinite(Number(node?.displayOrder)) ? Number(node.displayOrder) : null;
    }

    function getNodeTitle(nodeId, state = {}) {
      return getNodeById(nodeId, state)?.title || nodeId || '';
    }

    function normalizeNodeStatus(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized || 'pending';
    }

    function buildDefaultNodeStatuses(state = {}) {
      return Object.fromEntries(getNodeIdsForState(state).map((nodeId) => [nodeId, 'pending']));
    }

    function normalizeNodeStatuses(statuses = {}, state = {}) {
      const defaults = buildDefaultNodeStatuses(state);
      const next = { ...defaults };
      if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
        return next;
      }
      for (const [rawNodeId, rawStatus] of Object.entries(statuses)) {
        const nodeId = normalizeNodeId(rawNodeId);
        if (!nodeId || !Object.prototype.hasOwnProperty.call(defaults, nodeId)) {
          continue;
        }
        next[nodeId] = normalizeNodeStatus(rawStatus);
      }
      return next;
    }

    function isNodeDoneStatus(status = '') {
      return ['completed', 'manual_completed', 'skipped'].includes(normalizeNodeStatus(status));
    }

    function isNodeTerminalStatus(status = '') {
      return ['completed', 'manual_completed', 'skipped', 'failed', 'stopped'].includes(normalizeNodeStatus(status));
    }

    function getRunningNodeIds(statuses = {}, state = {}) {
      const normalizedStatuses = normalizeNodeStatuses(statuses, state);
      return getNodeIdsForState(state).filter((nodeId) => normalizedStatuses[nodeId] === 'running');
    }

    function getFirstUnfinishedNodeId(statuses = {}, state = {}) {
      const normalizedStatuses = normalizeNodeStatuses(statuses, state);
      return getNodeIdsForState(state).find((nodeId) => !isNodeDoneStatus(normalizedStatuses[nodeId])) || '';
    }

    function hasSavedProgress(statuses = {}, state = {}) {
      const normalizedStatuses = normalizeNodeStatuses(statuses, state);
      return getNodeIdsForState(state).some((nodeId) => normalizeNodeStatus(normalizedStatuses[nodeId]) !== 'pending');
    }

    function getNextNodeIds(nodeId, state = {}) {
      const node = getNodeById(nodeId, state);
      if (!node) {
        return [];
      }
      return Array.isArray(node.next) ? node.next.map(normalizeNodeId).filter(Boolean) : [];
    }

    return {
      buildDefaultNodeStatuses,
      getDisplayOrderForNode,
      getFirstUnfinishedNodeId,
      getNextNodeIds,
      getNodeById,
      getNodeIdsForState,
      getNodesForState,
      getNodeTitle,
      getRunningNodeIds,
      getWorkflow,
      getWorkflowForState,
      hasSavedProgress,
      isNodeDoneStatus,
      isNodeTerminalStatus,
      normalizeFlowId,
      normalizeNodeId,
      normalizeNodeStatuses,
      normalizeNodeStatus,
      resolveStateFlowId,
    };
  }

  return {
    createWorkflowEngine,
  };
});
