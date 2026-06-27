(function attachMultiPageSourceRegistry(root, factory) {
  root.MultiPageSourceRegistry = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createSourceRegistryModule() {
  const SOURCE_ALIASES = Object.freeze({
    'signup-page': 'openai-auth',
  });

  const SOURCE_DEFINITIONS = Object.freeze({
    'openai-auth': {
      flowId: 'openai',
      kind: 'flow-page',
      label: '认证页',
      readyPolicy: 'allow-child-frame',
      family: 'openai-auth-family',
      driverId: 'content/signup-page',
      cleanupScopes: ['oauth-localhost-callback'],
    },
    chatgpt: {
      flowId: 'openai',
      kind: 'flow-entry',
      label: 'ChatGPT 首页',
      readyPolicy: 'allow-child-frame',
      family: 'chatgpt-entry-family',
      driverId: null,
      cleanupScopes: [],
    },
    'qq-mail': {
      flowId: null,
      kind: 'mail-provider',
      label: 'QQ 邮箱',
      readyPolicy: 'top-frame-only',
      family: 'qq-mail-family',
      driverId: 'content/qq-mail',
      cleanupScopes: [],
    },
    'mail-163': {
      flowId: null,
      kind: 'mail-provider',
      label: '163 邮箱',
      readyPolicy: 'top-frame-only',
      family: 'mail-163-family',
      driverId: 'content/mail-163',
      cleanupScopes: [],
    },
    'gmail-mail': {
      flowId: null,
      kind: 'mail-provider',
      label: 'Gmail 邮箱',
      readyPolicy: 'top-frame-only',
      family: 'gmail-mail-family',
      driverId: 'content/gmail-mail',
      cleanupScopes: [],
    },
    'icloud-mail': {
      flowId: null,
      kind: 'mail-provider',
      label: 'iCloud 邮箱',
      readyPolicy: 'allow-child-frame',
      family: 'icloud-mail-family',
      driverId: 'content/icloud-mail',
      cleanupScopes: [],
    },
    'inbucket-mail': {
      flowId: null,
      kind: 'mail-provider',
      label: 'Inbucket 邮箱',
      readyPolicy: 'top-frame-only',
      family: 'inbucket-mail-family',
      driverId: 'content/inbucket-mail',
      cleanupScopes: [],
    },
    'mail-2925': {
      flowId: null,
      kind: 'mail-provider',
      label: '2925 邮箱',
      readyPolicy: 'top-frame-only',
      family: 'mail-2925-family',
      driverId: 'content/mail-2925',
      cleanupScopes: [],
    },
    'duck-mail': {
      flowId: null,
      kind: 'mail-provider',
      label: 'Duck 邮箱',
      readyPolicy: 'allow-child-frame',
      family: 'duck-mail-family',
      driverId: 'content/duck-mail',
      cleanupScopes: [],
    },
    'vps-panel': {
      flowId: 'openai',
      kind: 'panel-page',
      label: 'CPA 面板',
      readyPolicy: 'allow-child-frame',
      family: 'vps-panel-family',
      driverId: 'content/vps-panel',
      cleanupScopes: [],
    },
    'platform-panel': {
      flowId: 'openai',
      kind: 'virtual-page',
      label: '平台回调面板',
      readyPolicy: 'disabled',
      family: 'platform-panel-family',
      driverId: 'content/platform-panel',
      cleanupScopes: [],
    },
    'sub2api-panel': {
      flowId: 'openai',
      kind: 'panel-page',
      label: 'SUB2API 后台',
      readyPolicy: 'allow-child-frame',
      family: 'sub2api-panel-family',
      driverId: 'content/sub2api-panel',
      cleanupScopes: [],
    },
    'codex2api-panel': {
      flowId: 'openai',
      kind: 'panel-page',
      label: 'Codex2API 后台',
      readyPolicy: 'allow-child-frame',
      family: 'codex2api-panel-family',
      driverId: 'content/sub2api-panel',
      cleanupScopes: [],
    },
    'chatgpt-session-reader': {
      flowId: 'openai',
      kind: 'flow-page',
      label: 'ChatGPT 会话读取',
      readyPolicy: 'top-frame-only',
      family: 'chatgpt-session-reader-family',
      driverId: 'content/chatgpt-session-reader',
      cleanupScopes: [],
    },
    'unknown-source': {
      flowId: null,
      kind: 'unknown',
      label: '未知来源',
      readyPolicy: 'disabled',
      family: 'unknown-family',
      driverId: null,
      cleanupScopes: [],
    },
  });

  const DRIVER_DEFINITIONS = Object.freeze({
    'content/signup-page': {
      sourceId: 'openai-auth',
      commands: [
        'submit-signup-email',
        'fill-password',
        'fill-profile',
        'oauth-login',
        'submit-verification-code',
        'post-login-phone-verification',
        'bind-email',
        'fetch-bind-email-code',
        'confirm-oauth',
        'detect-auth-state',
      ],
    },
    'content/qq-mail': {
      sourceId: 'qq-mail',
      commands: ['POLL_EMAIL'],
    },
    'content/mail-163': {
      sourceId: 'mail-163',
      commands: ['POLL_EMAIL'],
    },
    'content/gmail-mail': {
      sourceId: 'gmail-mail',
      commands: ['POLL_EMAIL'],
    },
    'content/icloud-mail': {
      sourceId: 'icloud-mail',
      commands: ['POLL_EMAIL'],
    },
    'content/mail-2925': {
      sourceId: 'mail-2925',
      commands: ['POLL_EMAIL'],
    },
    'content/duck-mail': {
      sourceId: 'duck-mail',
      commands: ['FETCH_ALIAS_EMAIL'],
    },
    'content/sub2api-panel': {
      sourceId: 'sub2api-panel',
      commands: ['open-panel', 'fetch-oauth-url', 'platform-verify'],
    },
    'content/vps-panel': {
      sourceId: 'vps-panel',
      commands: ['open-panel', 'fetch-oauth-url', 'platform-verify'],
    },
    'content/platform-panel': {
      sourceId: 'platform-panel',
      commands: ['platform-verify', 'fetch-oauth-url'],
    },
    'content/chatgpt-session-reader': {
      sourceId: 'chatgpt-session-reader',
      commands: ['read-chatgpt-session'],
    },
  });

  const CLEANUP_SCOPE_OWNERS = Object.freeze({
    'oauth-localhost-callback': 'openai-auth',
  });

  const AUTH_PAGE_HOSTS = new Set(['auth0.openai.com', 'auth.openai.com', 'accounts.openai.com']);
  const ENTRY_PAGE_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com']);
  const CHILD_FRAME_BLOCKED_SOURCES = new Set([
    'qq-mail',
    'mail-163',
    'gmail-mail',
    'mail-2925',
    'inbucket-mail',
    'chatgpt-session-reader',
  ]);

  function createSourceRegistry() {
    function parseUrlSafely(rawUrl) {
      if (!rawUrl) return null;
      try {
        return new URL(rawUrl);
      } catch {
        return null;
      }
    }

    function normalizeSourceId(source) {
      return String(source || '').trim();
    }

    function resolveCanonicalSource(source) {
      const normalized = normalizeSourceId(source);
      if (!normalized) return '';
      return SOURCE_ALIASES[normalized] || normalized;
    }

    function getAliasKeysForCanonicalSource(source) {
      const canonical = resolveCanonicalSource(source);
      return Object.keys(SOURCE_ALIASES).filter((alias) => SOURCE_ALIASES[alias] === canonical);
    }

    function getSourceKeys(source) {
      const normalized = normalizeSourceId(source);
      const canonical = resolveCanonicalSource(normalized);
      return Array.from(new Set([
        canonical,
        ...getAliasKeysForCanonicalSource(canonical),
        normalized,
      ].filter(Boolean)));
    }

    function getSourceMeta(source) {
      const canonical = resolveCanonicalSource(source);
      const definition = SOURCE_DEFINITIONS[canonical];
      if (!definition) {
        return null;
      }
      return {
        id: canonical,
        aliases: getAliasKeysForCanonicalSource(canonical),
        ...definition,
      };
    }

    function getSourceLabel(source) {
      return getSourceMeta(source)?.label || normalizeSourceId(source) || '未知来源';
    }

    function getDriverIdForSource(source) {
      return getSourceMeta(source)?.driverId || null;
    }

    function getDriverMeta(sourceOrDriverId) {
      const directDriverId = normalizeSourceId(sourceOrDriverId);
      const driverId = Object.prototype.hasOwnProperty.call(DRIVER_DEFINITIONS, directDriverId)
        ? directDriverId
        : getDriverIdForSource(sourceOrDriverId);
      if (!driverId || !Object.prototype.hasOwnProperty.call(DRIVER_DEFINITIONS, driverId)) {
        return null;
      }
      return {
        id: driverId,
        ...DRIVER_DEFINITIONS[driverId],
      };
    }

    function driverAcceptsCommand(sourceOrDriverId, command) {
      const normalizedCommand = normalizeSourceId(command);
      if (!normalizedCommand) {
        return false;
      }
      const driver = getDriverMeta(sourceOrDriverId);
      return Array.isArray(driver?.commands) && driver.commands.includes(normalizedCommand);
    }

    function isSignupPageHost(hostname = '') {
      return AUTH_PAGE_HOSTS.has(String(hostname || '').toLowerCase());
    }

    function isSignupEntryHost(hostname = '') {
      return ENTRY_PAGE_HOSTS.has(String(hostname || '').toLowerCase());
    }

    function is163MailHost(hostname = '') {
      const normalized = String(hostname || '').toLowerCase();
      return normalized === 'mail.163.com'
        || normalized.endsWith('.mail.163.com')
        || normalized === 'mail.126.com'
        || normalized.endsWith('.mail.126.com')
        || normalized === 'webmail.vip.163.com';
    }

    function matchesSourceUrlFamily(source, candidateUrl, referenceUrl) {
      const candidate = parseUrlSafely(candidateUrl);
      if (!candidate) return false;

      const canonical = resolveCanonicalSource(source);
      const reference = parseUrlSafely(referenceUrl);

      switch (canonical) {
        case 'openai-auth':
          return isSignupPageHost(candidate.hostname) || isSignupEntryHost(candidate.hostname);
        case 'chatgpt':
          return isSignupEntryHost(candidate.hostname);
        case 'duck-mail':
          return candidate.hostname === 'duckduckgo.com' && candidate.pathname.startsWith('/email/');
        case 'qq-mail':
          return candidate.hostname === 'mail.qq.com' || candidate.hostname === 'wx.mail.qq.com';
        case 'mail-163':
          return is163MailHost(candidate.hostname);
        case 'gmail-mail':
          return candidate.hostname === 'mail.google.com';
        case 'icloud-mail':
          return candidate.hostname === 'www.icloud.com'
            || candidate.hostname === 'www.icloud.com.cn';
        case 'inbucket-mail':
          return Boolean(reference)
            && candidate.origin === reference.origin
            && candidate.pathname.startsWith('/m/');
        case 'mail-2925':
          return candidate.hostname === '2925.com' || candidate.hostname === 'www.2925.com';
        case 'vps-panel':
          return Boolean(reference)
            && candidate.origin === reference.origin
            && candidate.pathname === reference.pathname;
        case 'sub2api-panel':
          return Boolean(reference)
            && candidate.origin === reference.origin
            && (
              candidate.pathname.startsWith('/admin/accounts')
              || candidate.pathname.startsWith('/login')
              || candidate.pathname === '/'
            );
        case 'codex2api-panel':
          return Boolean(reference)
            && candidate.origin === reference.origin
            && (
              candidate.pathname.startsWith('/admin/accounts')
              || candidate.pathname === '/admin'
              || candidate.pathname === '/'
            );
        case 'chatgpt-session-reader':
          return candidate.hostname === 'chatgpt.com' || candidate.hostname === 'chat.openai.com';
        default:
          return false;
      }
    }

    function detectSourceFromLocation({
      injectedSource,
      url = '',
      hostname = '',
    } = {}) {
      if (injectedSource) return resolveCanonicalSource(injectedSource);

      const normalizedHostname = String(hostname || '').toLowerCase();
      const normalizedUrl = String(url || '');

      if (isSignupPageHost(normalizedHostname)) return 'openai-auth';
      if (normalizedHostname === 'mail.qq.com' || normalizedHostname === 'wx.mail.qq.com') return 'qq-mail';
      if (is163MailHost(normalizedHostname)) return 'mail-163';
      if (normalizedHostname === 'mail.google.com') return 'gmail-mail';
      if (normalizedHostname === 'www.icloud.com' || normalizedHostname === 'www.icloud.com.cn') return 'icloud-mail';
      if (normalizedUrl.includes('duckduckgo.com/email/settings/autofill')) return 'duck-mail';
      if (normalizedUrl.includes('2925.com')) return 'mail-2925';
      if (isSignupEntryHost(normalizedHostname)) return 'chatgpt';
      return 'unknown-source';
    }

    function shouldReportReadyForFrame(source, isChildFrame) {
      const canonical = resolveCanonicalSource(source);
      const readyPolicy = getSourceMeta(canonical)?.readyPolicy || 'allow-child-frame';
      if (readyPolicy === 'disabled') return false;
      if (!isChildFrame) return true;
      if (readyPolicy === 'top-frame-only') return false;
      if (CHILD_FRAME_BLOCKED_SOURCES.has(canonical)) return false;
      return true;
    }

    function getCleanupOwnerSource(cleanupScope) {
      return resolveCanonicalSource(CLEANUP_SCOPE_OWNERS[String(cleanupScope || '').trim()] || '');
    }

    return {
      detectSourceFromLocation,
      getCleanupOwnerSource,
      getDriverIdForSource,
      getDriverMeta,
      driverAcceptsCommand,
      getSourceKeys,
      getSourceLabel,
      getSourceMeta,
      is163MailHost,
      isSignupEntryHost,
      isSignupPageHost,
      matchesSourceUrlFamily,
      parseUrlSafely,
      resolveCanonicalSource,
      shouldReportReadyForFrame,
    };
  }

  return {
    createSourceRegistry,
  };
});

