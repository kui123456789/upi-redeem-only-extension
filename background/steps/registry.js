(function attachBackgroundStepRegistry(root, factory) {
  root.MultiPageBackgroundStepRegistry = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStepRegistryModule() {
  function createNodeRegistry(definitions = []) {
    const ordered = (Array.isArray(definitions) ? definitions : [])
      .map((definition) => ({
        nodeId: String(definition?.nodeId || definition?.key || '').trim(),
        displayOrder: Number(definition?.displayOrder ?? definition?.order),
        executeKey: String(definition?.executeKey || definition?.key || definition?.nodeId || '').trim(),
        title: String(definition?.title || '').trim(),
        execute: definition?.execute,
      }))
      .filter((definition) => definition.nodeId && typeof definition.execute === 'function')
      .sort((left, right) => {
        const leftOrder = Number.isFinite(left.displayOrder) ? left.displayOrder : 0;
        const rightOrder = Number.isFinite(right.displayOrder) ? right.displayOrder : 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.nodeId.localeCompare(right.nodeId);
      });

    const byId = new Map(ordered.map((definition) => [definition.nodeId, definition]));

    function getNodeDefinition(nodeId) {
      return byId.get(String(nodeId || '').trim()) || null;
    }

    function getOrderedNodes() {
      return ordered.slice();
    }

    function executeNode(nodeId, state) {
      const definition = getNodeDefinition(nodeId);
      if (!definition) {
        throw new Error(`未知节点：${nodeId}`);
      }
      return definition.execute(state);
    }

    return {
      executeNode,
      getNodeDefinition,
      getOrderedNodes,
    };
  }

  return {
    createNodeRegistry,
  };
});
