(function attachBackgroundLocalCliProxyApi(root, factory) {
  root.MultiPageBackgroundLocalCliProxyApi = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundLocalCliProxyApiModule() {
  const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
  const TOKEN_URL = 'https://auth.openai.com/oauth/token';
  const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
  const REDIRECT_URI = 'http://localhost:1455/auth/callback';
  const DEFAULT_RELATIVE_AUTH_DIR = '.cli-proxy-api';

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function ensureTextEncoder() {
    if (typeof TextEncoder === 'function') {
      return new TextEncoder();
    }
    throw new Error('当前环境缺少 TextEncoder，无法生成 PKCE。');
  }

  function getCryptoLike(explicitCrypto = null) {
    const candidate = explicitCrypto || globalThis.crypto || null;
    if (candidate && typeof candidate.getRandomValues === 'function' && candidate.subtle) {
      return candidate;
    }
    throw new Error('当前环境缺少 Web Crypto，无法执行本地 OAuth 模块。');
  }

  function getFetchLike(explicitFetch = null) {
    const candidate = explicitFetch || globalThis.fetch || null;
    if (typeof candidate === 'function') {
      return candidate.bind(globalThis);
    }
    throw new Error('当前环境缺少 fetch，无法交换 OAuth token。');
  }

  function getSessionConverter(explicitConverter = null) {
    const candidate = explicitConverter
      || globalThis.MultiPageSessionToJsonConverter
      || (typeof self !== 'undefined' ? self.MultiPageSessionToJsonConverter : null)
      || null;
    if (candidate && typeof candidate.convertSessionJson === 'function') {
      return candidate;
    }
    throw new Error('session-to-json 转换模块未加载，无法生成本地 auth json。');
  }

  function bytesToBase64Url(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('bytesToBase64Url 需要 Uint8Array 输入。');
    }

    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function sha256Bytes(value, cryptoLike) {
    const encoder = ensureTextEncoder();
    const digest = await cryptoLike.subtle.digest('SHA-256', encoder.encode(String(value || '')));
    return new Uint8Array(digest);
  }

  async function sha256Hex(value, cryptoLike) {
    const bytes = await sha256Bytes(value, cryptoLike);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function generateRandomState(options = {}) {
    const cryptoLike = getCryptoLike(options.crypto);
    const bytes = new Uint8Array(16);
    cryptoLike.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function generatePkceCodes(options = {}) {
    const cryptoLike = getCryptoLike(options.crypto);
    const bytes = new Uint8Array(96);
    cryptoLike.getRandomValues(bytes);
    const codeVerifier = bytesToBase64Url(bytes);
    const codeChallenge = bytesToBase64Url(await sha256Bytes(codeVerifier, cryptoLike));
    return {
      codeVerifier,
      codeChallenge,
    };
  }

  function normalizePlanTypeForFilename(planType = '') {
    const parts = normalizeString(planType)
      .split(/[^A-Za-z0-9]+/g)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    return parts.join('-');
  }

  function resolvePathSeparator(basePath = '') {
    return String(basePath || '').includes('\\') ? '\\' : '/';
  }

  function sanitizeRelativeDir(input = DEFAULT_RELATIVE_AUTH_DIR) {
    const normalized = normalizeString(input || DEFAULT_RELATIVE_AUTH_DIR);
    if (!normalized) {
      return DEFAULT_RELATIVE_AUTH_DIR;
    }

    const segments = normalized
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw new Error('relativeAuthDir 不能包含 . 或 .. 路径段。');
    }

    return segments.join('/');
  }

  function joinPath(basePath, ...parts) {
    const separator = resolvePathSeparator(basePath);
    const normalizedBase = normalizeString(basePath).replace(/[\\/]+$/g, '');
    const resultParts = [normalizedBase];

    for (const rawPart of parts) {
      const normalized = String(rawPart || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (normalized.length) {
        resultParts.push(normalized.join(separator));
      }
    }

    return resultParts.join(separator);
  }

  function buildAuthUrl({
    state,
    codeChallenge,
    clientId = CLIENT_ID,
    redirectUri = REDIRECT_URI,
  } = {}) {
    const normalizedState = normalizeString(state);
    const normalizedChallenge = normalizeString(codeChallenge);
    if (!normalizedState) {
      throw new Error('生成 OAuth 地址失败：缺少 state。');
    }
    if (!normalizedChallenge) {
      throw new Error('生成 OAuth 地址失败：缺少 PKCE code_challenge。');
    }

    const params = new URLSearchParams();
    params.set('client_id', normalizeString(clientId) || CLIENT_ID);
    params.set('response_type', 'code');
    params.set('redirect_uri', normalizeString(redirectUri) || REDIRECT_URI);
    params.set('scope', 'openid email profile offline_access');
    params.set('state', normalizedState);
    params.set('code_challenge', normalizedChallenge);
    params.set('code_challenge_method', 'S256');
    params.set('prompt', 'login');
    params.set('id_token_add_organizations', 'true');
    params.set('codex_cli_simplified_flow', 'true');
    return `${AUTH_URL}?${params.toString()}`;
  }

  function parseOAuthCallback(callbackUrl, expectedState = '') {
    const rawInput = normalizeString(callbackUrl);
    if (!rawInput) {
      throw new Error('缺少 OAuth callback 地址。');
    }

    let candidate = rawInput;
    if (!candidate.includes('://')) {
      if (candidate.startsWith('?')) {
        candidate = `http://localhost${candidate}`;
      } else if (candidate.includes('=') && !candidate.includes('/')) {
        candidate = `http://localhost/?${candidate}`;
      } else {
        candidate = `http://${candidate}`;
      }
    }

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error('OAuth callback 地址格式无效。');
    }

    const query = parsed.searchParams;
    let code = normalizeString(query.get('code'));
    let state = normalizeString(query.get('state'));
    let error = normalizeString(query.get('error'));
    let errorDescription = normalizeString(query.get('error_description'));

    if (parsed.hash) {
      const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      code = code || normalizeString(fragment.get('code'));
      state = state || normalizeString(fragment.get('state'));
      error = error || normalizeString(fragment.get('error'));
      errorDescription = errorDescription || normalizeString(fragment.get('error_description'));
    }

    if (error) {
      throw new Error(errorDescription ? `OAuth 回调失败：${errorDescription}` : `OAuth 回调失败：${error}`);
    }
    if (!code) {
      throw new Error('OAuth callback 缺少 code。');
    }

    const normalizedExpectedState = normalizeString(expectedState);
    if (normalizedExpectedState && state !== normalizedExpectedState) {
      throw new Error(`OAuth state 不匹配：expected ${normalizedExpectedState}, got ${state || '(empty)'}`);
    }

    return {
      code,
      state,
      callbackUrl: parsed.toString(),
    };
  }

  async function buildCredentialFileName(authJson, options = {}) {
    const cryptoLike = getCryptoLike(options.crypto);
    const email = normalizeString(authJson?.email);
    if (!email) {
      throw new Error('生成本地 auth 文件名失败：json 中缺少 email。');
    }

    const planType = normalizePlanTypeForFilename(authJson?.plan_type || authJson?.chatgpt_plan_type);
    const accountId = normalizeString(authJson?.account_id || authJson?.chatgpt_account_id);
    const hashAccountId = accountId ? (await sha256Hex(accountId, cryptoLike)).slice(0, 8) : '';

    if (!planType) {
      return `codex-${email}.json`;
    }
    if (planType === 'team') {
      return `codex-${hashAccountId}-${email}-${planType}.json`;
    }
    return `codex-${email}-${planType}.json`;
  }

  function createLocalCliProxyApi(deps = {}) {
    const fetchLike = getFetchLike(deps.fetch);
    const cryptoLike = getCryptoLike(deps.crypto);
    const sessionConverter = getSessionConverter(deps.sessionToJsonConverter);
    const ensureDirectory = typeof deps.ensureDirectory === 'function' ? deps.ensureDirectory : null;
    const writeTextFile = typeof deps.writeTextFile === 'function' ? deps.writeTextFile : null;

    async function createAuthorizationRequest(options = {}) {
      const oauthState = normalizeString(options.state) || await generateRandomState({ crypto: cryptoLike });
      const pkceCodes = options.pkceCodes?.codeVerifier && options.pkceCodes?.codeChallenge
        ? {
            codeVerifier: normalizeString(options.pkceCodes.codeVerifier),
            codeChallenge: normalizeString(options.pkceCodes.codeChallenge),
          }
        : await generatePkceCodes({ crypto: cryptoLike });

      return {
        oauthState,
        redirectUri: normalizeString(options.redirectUri) || REDIRECT_URI,
        pkceCodes,
        oauthUrl: buildAuthUrl({
          state: oauthState,
          codeChallenge: pkceCodes.codeChallenge,
          clientId: options.clientId || CLIENT_ID,
          redirectUri: options.redirectUri || REDIRECT_URI,
        }),
      };
    }

    async function exchangeCodeForTokens(options = {}) {
      const code = normalizeString(options.code);
      const redirectUri = normalizeString(options.redirectUri) || REDIRECT_URI;
      const codeVerifier = normalizeString(options.pkceCodes?.codeVerifier);
      if (!code) {
        throw new Error('token 交换失败：缺少 OAuth code。');
      }
      if (!codeVerifier) {
        throw new Error('token 交换失败：缺少 PKCE code_verifier。');
      }

      const form = new URLSearchParams();
      form.set('grant_type', 'authorization_code');
      form.set('client_id', normalizeString(options.clientId) || CLIENT_ID);
      form.set('code', code);
      form.set('redirect_uri', redirectUri);
      form.set('code_verifier', codeVerifier);

      const response = await fetchLike(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(`token exchange failed with status ${response.status}: ${rawText}`);
      }

      let payload = {};
      try {
        payload = JSON.parse(rawText || '{}');
      } catch {
        throw new Error('token 交换失败：返回内容不是合法 JSON。');
      }

      const accessToken = normalizeString(payload.access_token);
      const refreshToken = normalizeString(payload.refresh_token);
      const idToken = normalizeString(payload.id_token);
      const expiresIn = Number(payload.expires_in);
      if (!accessToken) {
        throw new Error('token 交换失败：缺少 access_token。');
      }

      const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined;

      return {
        accessToken,
        refreshToken,
        idToken,
        tokenType: normalizeString(payload.token_type),
        expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
        expiresAt,
        rawPayload: payload,
      };
    }

    async function buildAuthJsonArtifact(options = {}) {
      const accessToken = normalizeString(options.accessToken || options.access_token);
      if (!accessToken) {
        throw new Error('生成本地 auth json 失败：缺少 accessToken。');
      }

      const sourceSession = options.session && typeof options.session === 'object' && !Array.isArray(options.session)
        ? options.session
        : {};
      const sessionRecord = {
        ...sourceSession,
        type: 'codex',
        accessToken,
        refreshToken: normalizeString(options.refreshToken || options.refresh_token || sourceSession.refreshToken || sourceSession.refresh_token),
        idToken: normalizeString(options.idToken || options.id_token || sourceSession.idToken || sourceSession.id_token),
        sessionToken: normalizeString(options.sessionToken || options.session_token || sourceSession.sessionToken || sourceSession.session_token),
        expiresAt: options.expiresAt || options.expires_at || sourceSession.expiresAt || sourceSession.expires,
        email: options.email || sourceSession.email || sourceSession.user?.email,
        account_id: options.accountId || options.account_id || sourceSession.account?.id,
        user_id: options.userId || options.user_id || sourceSession.user?.id,
        plan_type: options.planType || options.plan_type || sourceSession.account?.planType || sourceSession.account?.plan_type,
      };

      const converted = sessionConverter.convertSessionJson(sessionRecord, {
        lastRefresh: options.lastRefresh,
        now: options.now || new Date(),
        sourceName: normalizeString(options.sourceName) || 'CLIProxyAPI Local OAuth',
      });

      const authJson = converted.output;
      const fileName = await buildCredentialFileName(authJson, { crypto: cryptoLike });
      const pluginDir = normalizeString(options.pluginDir);
      if (!pluginDir) {
        throw new Error('生成本地 auth json 失败：缺少 pluginDir。');
      }

      const relativeAuthDir = sanitizeRelativeDir(options.relativeAuthDir || DEFAULT_RELATIVE_AUTH_DIR);
      const directoryPath = joinPath(pluginDir, relativeAuthDir);
      const filePath = joinPath(directoryPath, fileName);
      const jsonText = `${JSON.stringify(authJson, null, 2)}\n`;

      return {
        provider: 'codex',
        fileName,
        directoryPath,
        filePath,
        relativeAuthDir,
        authJson,
        jsonText,
        warnings: Array.isArray(converted.warnings) ? converted.warnings.slice() : [],
      };
    }

    async function saveAuthJsonArtifact(artifact) {
      if (!artifact || typeof artifact !== 'object') {
        throw new Error('保存本地 auth json 失败：artifact 无效。');
      }
      if (!writeTextFile) {
        throw new Error('保存本地 auth json 失败：未提供 writeTextFile。');
      }
      if (!normalizeString(artifact.filePath)) {
        throw new Error('保存本地 auth json 失败：缺少 filePath。');
      }

      if (ensureDirectory) {
        await ensureDirectory(artifact.directoryPath);
      }
      await writeTextFile(artifact.filePath, artifact.jsonText);

      return {
        ...artifact,
        saved: true,
      };
    }

    async function exchangeCallbackToAuthArtifact(options = {}) {
      const callback = parseOAuthCallback(options.callbackUrl, options.expectedState);
      const tokenBundle = await exchangeCodeForTokens({
        code: callback.code,
        pkceCodes: options.pkceCodes,
        redirectUri: options.redirectUri,
        clientId: options.clientId,
      });

      return buildAuthJsonArtifact({
        ...tokenBundle,
        pluginDir: options.pluginDir,
        relativeAuthDir: options.relativeAuthDir,
        sourceName: options.sourceName,
        now: options.now,
      });
    }

    return {
      AUTH_URL,
      TOKEN_URL,
      CLIENT_ID,
      REDIRECT_URI,
      DEFAULT_RELATIVE_AUTH_DIR,
      buildAuthJsonArtifact,
      createAuthorizationRequest,
      exchangeCallbackToAuthArtifact,
      exchangeCodeForTokens,
      parseOAuthCallback,
      saveAuthJsonArtifact,
    };
  }

  return {
    AUTH_URL,
    TOKEN_URL,
    CLIENT_ID,
    REDIRECT_URI,
    DEFAULT_RELATIVE_AUTH_DIR,
    buildAuthUrl,
    buildCredentialFileName,
    createLocalCliProxyApi,
    generatePkceCodes,
    generateRandomState,
    normalizePlanTypeForFilename,
    parseOAuthCallback,
  };
});
