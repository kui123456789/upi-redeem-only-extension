(function attachSidepanelAccountRecordsManager(globalScope) {
  function createAccountRecordsManager(context = {}) {
    const {
      state,
      dom,
      helpers,
      runtime,
      constants = {},
    } = context;

    const displayTimeZone = constants.displayTimeZone || 'Asia/Shanghai';
    const pageSize = Math.max(1, Math.floor(Number(constants.pageSize) || 10));

    const FILTER_CONFIG = {
      all: {
        label: '总',
        className: '',
        matches: () => true,
        metaLabel: '全部',
      },
      success: {
        label: '成',
        className: 'is-success',
        matches: (record) => getRecordDisplayStatus(record) === 'success',
        metaLabel: '成功',
      },
      running: {
        label: '运行',
        className: 'is-running',
        matches: (record) => getRecordDisplayStatus(record) === 'running',
        metaLabel: '运行中',
      },
      failed: {
        label: '失',
        className: 'is-failed',
        matches: (record) => getRecordDisplayStatus(record) === 'failed',
        metaLabel: '失败',
      },
      stopped: {
        label: '停',
        className: 'is-stopped',
        matches: (record) => getRecordDisplayStatus(record) === 'stopped',
        metaLabel: '停止',
      },
      retry: {
        label: '重试',
        className: 'is-retry',
        matches: (record) => normalizeRetryCount(record.retryCount) > 0,
        metaLabel: '重试',
      },
    };

    let currentPage = 1;
    let activeFilter = 'all';
    let selectionMode = false;
    let eventsBound = false;
    let upiCredentialBackupPreviewVisible = false;
    let upiCredentialMembershipCheckBusy = false;
    let upiCredentialMembershipRedeemBusy = false;
    let upiCredentialMembershipPoolRows = [];
    let upiCredentialMembershipPoolSource = '';
    let upiCredentialMembershipPoolLoaded = false;
    let upiCredentialMembershipPoolLoading = false;
    let upiCredentialMembershipCheckingEmail = '';
    let upiCredentialMembershipGroup = 'free';
    const disabledUpiCredentialMembershipEmails = new Set();
    const selectedRecordIds = new Set();

    function escapeHtml(value) {
      if (typeof helpers.escapeHtml === 'function') {
        return helpers.escapeHtml(String(value || ''));
      }
      return String(value || '');
    }

    function normalizeTimestamp(value) {
      const timestamp = Date.parse(String(value || ''));
      return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function normalizeRetryCount(value) {
      const count = Math.floor(Number(value) || 0);
      return count > 0 ? count : 0;
    }

    function isPreSubmitUpiCredentialMembershipBlockedReason(message = '') {
      const text = String(message || '').trim();
      return /缺少\s*GPT\s*密码|缺少\s*2FA|提交密码后|未进入登录验证码页|登录未进入验证码页|登录需要手机验证码|登录需要邮箱一次性验证码|登录后需要手机|登录后需要邮箱|邮箱一次性验证码|手机号验证码|手机验证码|验证码页面|登录密码未通过|密码未通过|2FA\s*动态码被页面拒绝|账号登录态不一致|accessToken\s*属于|未读取到\s*accessToken|未进入\s*ChatGPT\s*已登录态|登录或读取\s*accessToken\s*未完成|读取\s*accessToken\s*未完成|verify your identity|one-time password|one-time code/i.test(text);
    }

    function isPreSubmitUpiCredentialMembershipBlockedRow(row = {}) {
      const redeemStatus = String(row.redeemStatus || '').trim().toLowerCase();
      const cdkey = String(row.upiRedeemCdkey || row.cdkey || '').trim();
      const reason = row.redeemReason || row.reason || '';
      return redeemStatus === 'failed' && !cdkey && isPreSubmitUpiCredentialMembershipBlockedReason(reason);
    }

    function buildRecordId(record = {}) {
      const rawRecordId = String(record.recordId || '').trim();
      if (rawRecordId) {
        return rawRecordId.toLowerCase();
      }
      const rawIdentifierType = String(record.accountIdentifierType || '').trim().toLowerCase();
      const hasPhoneOnlyIdentifier = !record.email && (
        record.phoneNumber
        || record.phone
        || record.number
        || (record.accountIdentifier && !/@/.test(String(record.accountIdentifier || '')))
      );
      const identifierType = rawIdentifierType === 'phone'
        || (!rawIdentifierType && hasPhoneOnlyIdentifier)
        ? 'phone'
        : 'email';
      const identifier = String(
        record.accountIdentifier
        || (identifierType === 'phone' ? (record.phoneNumber || record.phone || record.number || '') : (record.email || ''))
        || ''
      ).trim();
      if (!identifier) {
        return '';
      }
      return identifierType === 'phone'
        ? `phone:${identifier.toLowerCase()}`
        : identifier.toLowerCase();
    }

    function getRecordDisplayStatus(record = {}) {
      return String(record.displayStatus || record.finalStatus || '').trim().toLowerCase();
    }

    function getRecordExportUrl(record = {}) {
      return String(
        record.emailVerificationUrl
        || record.emailUrl
        || record.mailVerificationUrl
        || record.verificationUrl
        || record.url
        || record.localhostUrl
        || record.oauthUrl
        || record.callbackUrl
        || record.contributionCallbackUrl
        || record.plusReturnUrl
        || record.plusCheckoutUrl
        || record.finalUrl
        || ''
      ).trim();
    }

    function getRecordTotpMfaSecret(record = {}) {
      return String(
        record.totpMfaSecret
        || record.totpSecret
        || record.twoFactorSecret
        || record.twoFaSecret
        || ''
      ).trim();
    }

    function getRecordGptPassword(record = {}) {
      return String(
        record.password
        || record.gptPassword
        || record.chatGptPassword
        || record.openAiPassword
        || record.accountPassword
        || record.customPassword
        || ''
      ).trim();
    }

    function sanitizeExportField(value = '') {
      return String(value || '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
    }

    function isUpiRedeemSuccessRecord(record = {}) {
      const upiRedeemSuccess = record?.upiRedeemSuccess === true
        || String(record?.upiRedeemSuccess || '').trim().toLowerCase() === 'true';
      return upiRedeemSuccess;
    }

    function getRecordUpiRedeemCdkey(record = {}) {
      return String(record.upiRedeemCdkey || record.cdkey || '').trim();
    }

    function getRecordUpiRedeemAccessToken(record = {}) {
      return String(
        record.upiRedeemAccessToken
        || record.accessToken
        || record.chatGptAccessToken
        || record.acToken
        || record.token
        || ''
      ).trim();
    }

    function normalizeSubscriptionPlanType(value = '') {
      const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (!normalized) {
        return '';
      }
      if (normalized.includes('team')) {
        return 'team';
      }
      if (normalized.includes('pro')) {
        return 'pro';
      }
      if (normalized.includes('plus')) {
        return 'plus';
      }
      if (normalized.includes('free')) {
        return 'free';
      }
      return normalized;
    }

    function isPaidSubscriptionPlan(value = '') {
      return ['plus', 'pro', 'team'].includes(normalizeSubscriptionPlanType(value));
    }

    function getRecordSubscriptionPlanType(record = {}) {
      return normalizeSubscriptionPlanType(
        record.upiRedeemSubscriptionPlanType
        || record.subscriptionPlanType
        || record.subscriptionPlan
        || record.planType
        || record.plan_type
        || record.plan
        || record.accountPlan
        || record.membershipPlan
        || record.memberPlan
        || record.chatGptPlan
        || ''
      );
    }

    function getRecordActiveSubscriptionFlag(record = {}) {
      const keys = [
        'upiRedeemSubscriptionActive',
        'upiRedeemHasActiveSubscription',
        'hasActiveSubscription',
        'has_active_subscription',
        'subscriptionActive',
        'subscription_active',
        'isPlus',
        'isPro',
        'isTeam',
      ];
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          return Boolean(record[key]);
        }
      }
      return null;
    }

    function buildSubscriptionCheckId(record = {}) {
      const recordId = buildRecordId(record);
      if (recordId) {
        return recordId;
      }
      const email = getRecordEmail(record).toLowerCase();
      const cdkey = getRecordUpiRedeemCdkey(record).toLowerCase();
      return email || cdkey ? `${email}::${cdkey}` : '';
    }

    function normalizeSubscriptionResultItem(item = {}) {
      const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      return {
        ...source,
        active: source.active === true || String(source.active || '').trim().toLowerCase() === 'true',
        planType: normalizeSubscriptionPlanType(source.planType || source.plan_type || source.plan || ''),
      };
    }

    function buildSubscriptionResultLookup(items = []) {
      const lookup = {};
      (Array.isArray(items) ? items : []).forEach((rawItem) => {
        const item = normalizeSubscriptionResultItem(rawItem);
        [
          item.id,
          item.email,
          item.cdkey,
        ].forEach((key) => {
          const normalizedKey = String(key || '').trim().toLowerCase();
          if (normalizedKey) {
            lookup[normalizedKey] = item;
          }
        });
      });
      return lookup;
    }

    function getSubscriptionResultForRecord(record = {}, lookup = {}) {
      const keys = [
        buildSubscriptionCheckId(record),
        getRecordEmail(record),
        getRecordUpiRedeemCdkey(record),
      ];
      for (const key of keys) {
        const normalizedKey = String(key || '').trim().toLowerCase();
        if (normalizedKey && lookup?.[normalizedKey]) {
          return lookup[normalizedKey];
        }
      }
      return null;
    }

    function isRecordPaidSubscription(record = {}, lookup = null) {
      const result = lookup ? getSubscriptionResultForRecord(record, lookup) : null;
      if (lookup) {
        return Boolean(result) && result.active === true && isPaidSubscriptionPlan(result.planType);
      }

      const planType = getRecordSubscriptionPlanType(record);
      if (!isPaidSubscriptionPlan(planType)) {
        return false;
      }
      const activeFlag = getRecordActiveSubscriptionFlag(record);
      return activeFlag !== false;
    }

    function getPaidSubscriptionPlanLabel(value = '') {
      const planType = normalizeSubscriptionPlanType(value);
      if (planType === 'pro') {
        return 'Pro';
      }
      if (planType === 'team') {
        return 'Team';
      }
      return 'Plus';
    }

    function getConfirmedUpiSubscriptionLabel(record = {}) {
      if (!record.upiRedeemSuccess || record.upiRedeemSubscriptionActive !== true) {
        return '';
      }
      const planType = getRecordSubscriptionPlanType(record);
      if (!isPaidSubscriptionPlan(planType)) {
        return '';
      }
      return `已开通 ${getPaidSubscriptionPlanLabel(planType)} 会员`;
    }

    function normalizeUpiRedeemRemoteStatus(status = '') {
      const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (normalized === 'succeeded' || normalized === 'redeemed' || normalized === 'used') {
        return 'success';
      }
      if (normalized === 'failure' || normalized === 'error') {
        return 'failed';
      }
      if (normalized === 'cancelled') {
        return 'canceled';
      }
      if (normalized === 'notused' || normalized === 'not_used' || normalized === 'unredeemed') {
        return 'unused';
      }
      return normalized;
    }

    function getUpiRedeemCdkeyUsage(currentState = state.getLatestState()) {
      const rawUsage = currentState?.upiRedeemCdkeyUsage || currentState?.pixRedeemCdkeyUsage || {};
      return rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage) ? rawUsage : {};
    }

    function getUpiRedeemUsageEmail(entry = {}) {
      return normalizeUpiCredentialMembershipEmail(
        entry.email
        || entry.accountEmail
        || entry.credentialEmail
        || entry.targetEmail
        || ''
      );
    }

    function isRemoteRedeemSuccess(cdkey = '', usage = {}) {
      const entry = usage?.[cdkey] || {};
      return normalizeUpiRedeemRemoteStatus(entry.remoteStatus) === 'success';
    }

    function isUpiRedeemUsageSuccess(entry = {}) {
      return entry?.subscriptionActive === true
        || normalizeUpiRedeemRemoteStatus(entry?.remoteStatus) === 'success';
    }

    function getUpiRedeemSuccessCheckedAt(entry = {}) {
      const timestamp = Math.max(
        0,
        Number(entry.subscriptionCheckedAt) || 0,
        Number(entry.remoteCheckedAt) || 0,
        Number(entry.usedAt) || 0,
        Number(entry.lastAttemptAt) || 0
      );
      if (!timestamp) {
        return '';
      }
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }

    function getUpiRedeemSuccessPlanType(entry = {}) {
      const planType = normalizeSubscriptionPlanType(entry.subscriptionPlanType || entry.subscription_plan_type || '');
      return isPaidSubscriptionPlan(planType) ? planType : 'plus';
    }

    function buildUpiRedeemSuccessMembershipLookup(currentState = state.getLatestState()) {
      const usage = getUpiRedeemCdkeyUsage(currentState);
      const byCdkey = {};
      const byEmail = {};
      Object.entries(usage).forEach(([rawCdkey, entry]) => {
        const cdkey = String(rawCdkey || '').trim();
        if (!cdkey || !isUpiRedeemUsageSuccess(entry)) {
          return;
        }
        const patch = {
          status: 'paid',
          planType: getUpiRedeemSuccessPlanType(entry),
          reason: entry.subscriptionReason || entry.remoteMessage || 'UPI 卡密已确认兑换成功',
          upiRedeemCdkey: cdkey,
          upiRedeemSubscriptionCheckedAt: getUpiRedeemSuccessCheckedAt(entry),
        };
        byCdkey[cdkey.toLowerCase()] = patch;
        const email = getUpiRedeemUsageEmail(entry);
        if (email) {
          byEmail[email] = patch;
        }
      });
      return { byCdkey, byEmail };
    }

    function shouldKeepCheckedFreeMembershipResult(row = {}, patch = {}) {
      if (String(row.status || '').trim().toLowerCase() !== 'free') {
        return false;
      }
      if (String(row.membershipOverrideStatus || '').trim().toLowerCase() === 'free') {
        return true;
      }
      const rowCheckedAt = normalizeTimestamp(row.checkedAt);
      if (!rowCheckedAt) {
        return false;
      }
      const patchCheckedAt = normalizeTimestamp(patch.upiRedeemSubscriptionCheckedAt);
      return !patchCheckedAt || rowCheckedAt >= patchCheckedAt;
    }

    function applyUpiRedeemSuccessMembershipPatch(row = {}, lookup = buildUpiRedeemSuccessMembershipLookup()) {
      const email = normalizeUpiCredentialMembershipEmail(row.email);
      const cdkey = String(row.upiRedeemCdkey || row.cdkey || '').trim().toLowerCase();
      const patch = (cdkey && lookup.byCdkey?.[cdkey]) || (email && lookup.byEmail?.[email]) || null;
      if (!patch) {
        return row;
      }
      if (shouldKeepCheckedFreeMembershipResult(row, patch)) {
        return row;
      }
      return {
        ...row,
        ...patch,
        redeemStatus: row.redeemStatus === 'success' ? row.redeemStatus : 'success',
        redeemReason: row.redeemReason || patch.reason,
        checkedAt: row.checkedAt || patch.upiRedeemSubscriptionCheckedAt,
      };
    }

    function mergeManualFreeMembershipOverridesIntoResults(results = {}, currentState = state.getLatestState()) {
      const previousResults = currentState?.upiCredentialMembershipCheckResults || {};
      const overrides = {};
      (Array.isArray(previousResults.items) ? previousResults.items : []).forEach((row) => {
        const email = normalizeUpiCredentialMembershipEmail(row?.email);
        if (!email || String(row?.membershipOverrideStatus || '').trim().toLowerCase() !== 'free') {
          return;
        }
        overrides[email] = row;
      });
      if (!Object.keys(overrides).length || !Array.isArray(results?.items)) {
        return results;
      }
      let changed = false;
      const items = results.items.map((item) => {
        const email = normalizeUpiCredentialMembershipEmail(item?.email);
        const override = email ? overrides[email] : null;
        if (!override) {
          return item;
        }
        const itemStatus = String(item.status || '').trim().toLowerCase();
        const itemCheckedAt = normalizeTimestamp(item.checkedAt);
        const overrideCheckedAt = normalizeTimestamp(override.membershipOverrideCheckedAt || override.checkedAt);
        if (itemStatus === 'paid' && itemCheckedAt && overrideCheckedAt && itemCheckedAt > overrideCheckedAt) {
          return item;
        }
        const redeemStatus = String(item.redeemStatus || '').trim().toLowerCase();
        changed = true;
        return {
          ...item,
          status: 'free',
          planType: 'free',
          checkedAt: override.checkedAt || item.checkedAt,
          reason: override.reason || item.reason || '单账号检测确认当前无会员',
          membershipOverrideStatus: 'free',
          membershipOverrideCheckedAt: override.membershipOverrideCheckedAt || override.checkedAt || new Date().toISOString(),
          redeemStatus: ['success', 'skipped'].includes(redeemStatus) ? '' : item.redeemStatus,
          redeemReason: ['success', 'skipped'].includes(redeemStatus) ? '' : item.redeemReason,
        };
      });
      return changed ? { ...results, items } : results;
    }

    function buildUpiRedeemSuccessEmailExportRows(records = [], options = {}) {
      const seen = new Set();
      const seenCdkeys = new Set();
      const usage = options?.usage || {};
      const requireRemoteSuccess = Boolean(options?.requireRemoteSuccess);
      const requirePaidSubscription = Boolean(options?.requirePaidSubscription);
      const subscriptionResults = options?.subscriptionResults || null;
      return records
        .filter((record) => isUpiRedeemSuccessRecord(record))
        .map((record) => {
          const cdkey = getRecordUpiRedeemCdkey(record);
          if (requireRemoteSuccess && (!cdkey || !isRemoteRedeemSuccess(cdkey, usage))) {
            return '';
          }
          const email = sanitizeExportField(getRecordEmail(record));
          const password = sanitizeExportField(getRecordGptPassword(record));
          const secret = sanitizeExportField(getRecordTotpMfaSecret(record));
          if (!email || !password || !secret) {
            return '';
          }
          if (requirePaidSubscription && !isRecordPaidSubscription(record, subscriptionResults)) {
            return '';
          }
          const cdkeyKey = cdkey.toLowerCase();
          if (cdkeyKey && seenCdkeys.has(cdkeyKey)) {
            return '';
          }
          const key = `${email.toLowerCase()}---${password}---${secret}`;
          if (seen.has(key)) {
            return '';
          }
          if (cdkeyKey) {
            seenCdkeys.add(cdkeyKey);
          }
          seen.add(key);
          return `${email}---${password}---${secret}`;
        })
        .filter(Boolean);
    }

    function summarizeUpiRedeemSuccessExportEligibility(records = [], options = {}) {
      const usage = options?.usage || {};
      const seen = new Set();
      const seenCdkeys = new Set();
      const summary = {
        successCount: 0,
        candidateCount: 0,
        remoteNotSuccessCount: 0,
        missingAccessTokenCount: 0,
        subscriptionNotActiveCount: 0,
        missingPasswordCount: 0,
        missingTotpMfaSecretCount: 0,
        duplicateCdkeyCount: 0,
        duplicateRowCount: 0,
        exportableCount: 0,
      };
      const requirePaidSubscription = Boolean(options?.requirePaidSubscription);
      const subscriptionResults = options?.subscriptionResults || null;

      records
        .filter((record) => isUpiRedeemSuccessRecord(record))
        .forEach((record) => {
          summary.successCount += 1;
          const email = sanitizeExportField(getRecordEmail(record));
          const password = sanitizeExportField(getRecordGptPassword(record));
          const secret = sanitizeExportField(getRecordTotpMfaSecret(record));
          if (!email) {
            return;
          }
          if (!password) {
            summary.missingPasswordCount += 1;
            return;
          }
          if (!secret) {
            summary.missingTotpMfaSecretCount += 1;
            return;
          }
          summary.candidateCount += 1;

          const cdkey = getRecordUpiRedeemCdkey(record);
          if (!cdkey || !isRemoteRedeemSuccess(cdkey, usage)) {
            summary.remoteNotSuccessCount += 1;
            return;
          }

          if (requirePaidSubscription) {
            if (!getRecordUpiRedeemAccessToken(record)) {
              summary.missingAccessTokenCount += 1;
              return;
            }
            if (!isRecordPaidSubscription(record, subscriptionResults)) {
              summary.subscriptionNotActiveCount += 1;
              return;
            }
          }

          const cdkeyKey = cdkey.toLowerCase();
          if (cdkeyKey && seenCdkeys.has(cdkeyKey)) {
            summary.duplicateCdkeyCount += 1;
            return;
          }
          const rowKey = `${email.toLowerCase()}---${password}---${secret}`;
          if (seen.has(rowKey)) {
            summary.duplicateRowCount += 1;
            return;
          }
          if (cdkeyKey) {
            seenCdkeys.add(cdkeyKey);
          }
          seen.add(rowKey);
          summary.exportableCount += 1;
        });

      return summary;
    }

    function buildUpiRedeemSuccessExportBlockedMessage(summary = {}) {
      const blockers = [];
      if (summary.missingTotpMfaSecretCount) {
        blockers.push(`${summary.missingTotpMfaSecretCount} 条缺少 2FA 密钥`);
      }
      if (summary.missingPasswordCount) {
        blockers.push(`${summary.missingPasswordCount} 条缺少 GPT 密码`);
      }
      if (summary.remoteNotSuccessCount) {
        blockers.push(`${summary.remoteNotSuccessCount} 条远端未确认成功`);
      }
      if (summary.missingAccessTokenCount) {
        blockers.push(`${summary.missingAccessTokenCount} 条缺少 accessToken，无法确认会员状态`);
      }
      if (summary.subscriptionNotActiveCount) {
        blockers.push(`${summary.subscriptionNotActiveCount} 条不是 Plus/Pro/Team 会员`);
      }

      if (!summary.candidateCount) {
        if (blockers.length) {
          return `未导出：${blockers.join('，')}。旧记录缺少 GPT 密码/2FA 的需要重新兑换生成成功记录。`;
        }
        return '没有可导出的 UPI 兑换成功邮箱 GPT 密码 2FA 记录。';
      }
      const suffix = summary.missingTotpMfaSecretCount || summary.missingPasswordCount
        ? '旧记录缺少 GPT 密码/2FA 的需要重新兑换生成成功记录。'
        : (summary.missingAccessTokenCount || summary.subscriptionNotActiveCount
          ? '请确认账号仍是 Plus/Pro/Team 会员。'
          : '请确认远端卡密状态。');
      return `未导出：${blockers.join('，') || '没有符合条件的记录'}。${suffix}`;
    }

    function getUpiRedeemSuccessExportSubscriptionItems(records = [], options = {}) {
      const usage = options?.usage || {};
      const seen = new Set();
      return records
        .filter((record) => isUpiRedeemSuccessRecord(record))
        .filter((record) => getRecordGptPassword(record) && getRecordTotpMfaSecret(record))
        .filter((record) => {
          const cdkey = getRecordUpiRedeemCdkey(record);
          return cdkey && isRemoteRedeemSuccess(cdkey, usage);
        })
        .map((record) => {
          const id = buildSubscriptionCheckId(record);
          const email = getRecordEmail(record);
          const cdkey = getRecordUpiRedeemCdkey(record);
          const token = getRecordUpiRedeemAccessToken(record);
          return {
            id,
            email,
            cdkey,
            token,
          };
        })
        .filter((item) => {
          const key = String(item.id || item.email || item.cdkey || '').trim().toLowerCase();
          if (!key || !item.token || seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
    }

    function getUpiRedeemSuccessExportCdkeys(records = []) {
      const seen = new Set();
      return records
        .filter((record) => isUpiRedeemSuccessRecord(record))
        .filter((record) => getRecordTotpMfaSecret(record))
        .map((record) => getRecordUpiRedeemCdkey(record))
        .filter((cdkey) => {
          if (!cdkey || seen.has(cdkey)) {
            return false;
          }
          seen.add(cdkey);
          return true;
        });
    }

    function buildUpiRedeemSuccessEmailExportFileName() {
      const stamp = new Date().toISOString()
        .replace(/\.\d{3}Z$/, '')
        .replace(/[^\dT]/g, '')
        .replace('T', '-');
      return `upi-redeem-success-password-2fa-${stamp}.txt`;
    }

    function getUpiCredentialMembershipCheckResults(currentState = state.getLatestState()) {
      const raw = currentState?.upiCredentialMembershipCheckResults || {};
      const successLookup = buildUpiRedeemSuccessMembershipLookup(currentState);
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .map((item) => applyUpiRedeemSuccessMembershipPatch(item, successLookup));
      return {
        items,
        running: raw.running === true,
        redeeming: raw.redeeming === true,
        source: String(raw.source || '').trim(),
        total: Math.max(0, Math.floor(Number(raw.total) || items.length || 0)),
        completed: Math.max(0, Math.floor(Number(raw.completed) || items.length || 0)),
        redeemTotal: Math.max(0, Math.floor(Number(raw.redeemTotal) || 0)),
        redeemCompleted: Math.max(0, Math.floor(Number(raw.redeemCompleted) || 0)),
        flowStage: String(raw.flowStage || '').trim().toLowerCase(),
        flowStageEmail: normalizeUpiCredentialMembershipEmail(raw.flowStageEmail || ''),
        paidCount: items.filter((item) => item?.status === 'paid').length,
        freeCount: items.filter((item) => item?.status === 'free').length,
        failedCount: items.filter((item) => item?.status === 'failed').length,
        updatedAt: String(raw.updatedAt || '').trim(),
        stoppedAt: String(raw.stoppedAt || '').trim(),
        redeemStoppedAt: String(raw.redeemStoppedAt || '').trim(),
      };
    }

    function getMembershipStatusTitle(status = '') {
      if (status === 'paid') return '有会员';
      if (status === 'free') return '无会员';
      return '失败';
    }

    function getMembershipPlanLabel(planType = '') {
      const normalized = normalizeSubscriptionPlanType(planType);
      if (normalized === 'pro') return 'Pro';
      if (normalized === 'team') return 'Team';
      if (normalized === 'plus') return 'Plus';
      return normalized || '-';
    }

    function getUpiCredentialMembershipFlowTitle(stepKey = '') {
      const normalized = String(stepKey || '').trim().toLowerCase();
      return UPI_CREDENTIAL_MEMBERSHIP_FLOW_STEPS.find((step) => step.key === normalized)?.title || '处理中';
    }

    function compactMembershipReason(value = '', maxLength = 42) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        return '';
      }
      const limit = Math.max(8, Math.floor(Number(maxLength) || 42));
      return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
    }

    function normalizeUpiCredentialMembershipEmail(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeUpiCredentialMembershipText(value = '') {
      return String(value || '').trim();
    }

    function normalizeUpiCredentialMembershipTotpSecret(value = '') {
      return normalizeUpiCredentialMembershipText(value).replace(/\s+/g, '').toUpperCase();
    }

    function normalizeUpiCredentialMembershipCredential(rawItem = {}, fallbackSource = '') {
      const source = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {};
      const email = normalizeUpiCredentialMembershipEmail(source.email || source.accountIdentifier);
      if (!email) {
        return null;
      }
      return {
        ...source,
        email,
        password: normalizeUpiCredentialMembershipText(
          source.password
          || source.gptPassword
          || source.chatGptPassword
          || ''
        ),
        totpMfaSecret: normalizeUpiCredentialMembershipTotpSecret(
          source.totpMfaSecret
          || source.totpSecret
          || source.twoFactorSecret
          || ''
        ),
        source: normalizeUpiCredentialMembershipText(fallbackSource || source.source),
      };
    }

    function parseUpiCredentialMembershipText(text = '') {
      const seen = new Set();
      return String(text || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const parts = line.split(/---+/).map((part) => part.trim());
          return normalizeUpiCredentialMembershipCredential({
            email: parts[0] || '',
            password: parts[1] || '',
            totpMfaSecret: parts.slice(2).join('---'),
            source: 'txt',
          }, 'txt');
        })
        .filter((item) => {
          if (!item?.email || seen.has(item.email)) {
            return false;
          }
          seen.add(item.email);
          return true;
        });
    }

    function setUpiCredentialMembershipPoolRows(rows = [], source = '') {
      const seen = new Set();
      upiCredentialMembershipPoolRows = (Array.isArray(rows) ? rows : [])
        .map((item) => normalizeUpiCredentialMembershipCredential(item, source))
        .filter((item) => {
          if (!item?.email || seen.has(item.email)) {
            return false;
          }
          seen.add(item.email);
          return true;
        });
      upiCredentialMembershipPoolSource = normalizeUpiCredentialMembershipText(source);
      for (const email of Array.from(disabledUpiCredentialMembershipEmails)) {
        if (!seen.has(email)) {
          disabledUpiCredentialMembershipEmails.delete(email);
        }
      }
    }

    function buildUpiCredentialMembershipResultLookup(items = []) {
      const lookup = {};
      (Array.isArray(items) ? items : []).forEach((rawItem) => {
        const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {};
        const email = normalizeUpiCredentialMembershipEmail(item.email);
        if (!email) {
          return;
        }
        lookup[email] = item;
      });
      return lookup;
    }

    function buildUpiCredentialMembershipDisplayRows(results = getUpiCredentialMembershipCheckResults()) {
      const rows = [];
      const seen = new Set();
      const resultLookup = buildUpiCredentialMembershipResultLookup(results.items);
      const successLookup = buildUpiRedeemSuccessMembershipLookup();
      upiCredentialMembershipPoolRows.forEach((credential) => {
        const email = normalizeUpiCredentialMembershipEmail(credential.email);
        if (!email || seen.has(email)) {
          return;
        }
        seen.add(email);
        const storedResult = resultLookup[email] || {};
        const fallbackFreeResult = storedResult.status ? {} : {
          status: 'free',
          planType: 'free',
          reason: 'Free 分组账号，可提交卡密兑换',
        };
        rows.push(applyUpiRedeemSuccessMembershipPatch({
          ...credential,
          ...fallbackFreeResult,
          ...storedResult,
          email,
          source: credential.source || upiCredentialMembershipPoolSource || results.source || '',
          enabled: !disabledUpiCredentialMembershipEmails.has(email),
        }, successLookup));
      });
      results.items.forEach((result) => {
        const email = normalizeUpiCredentialMembershipEmail(result?.email);
        if (!email || seen.has(email)) {
          return;
        }
        seen.add(email);
        rows.push(applyUpiRedeemSuccessMembershipPatch({
          ...result,
          email,
          source: results.source || '',
          enabled: !disabledUpiCredentialMembershipEmails.has(email),
        }, successLookup));
      });
      return rows;
    }

    function getUpiCredentialMembershipRowStatusMeta(row = {}, results = getUpiCredentialMembershipCheckResults()) {
      const rowEmail = normalizeUpiCredentialMembershipEmail(row.email);
      const currentEmail = normalizeUpiCredentialMembershipEmail(results.flowStageEmail);
      if (upiCredentialMembershipCheckingEmail && rowEmail === upiCredentialMembershipCheckingEmail) {
        return {
          className: 'pending',
          label: '检测中',
          detail: '正在单独检测是否有 Plus/Pro/Team 会员',
        };
      }
      if ((results.running || results.redeeming) && rowEmail && currentEmail && rowEmail === currentEmail) {
        const label = results.redeeming ? '补兑中' : '核验中';
        return {
          className: 'pending',
          label,
          detail: getUpiCredentialMembershipFlowTitle(results.flowStage),
        };
      }
      const redeemStatus = String(row.redeemStatus || '').trim().toLowerCase();
      const isStoppedResult = String(row.status || '').trim().toLowerCase() === 'stopped'
        || redeemStatus === 'stopped'
        || (rowEmail && currentEmail && rowEmail === currentEmail && (results.stoppedAt || results.redeemStoppedAt));
      if (isStoppedResult) {
        return {
          className: 'pending',
          label: '已停止',
          detail: row.redeemReason || row.reason || getUpiCredentialMembershipFlowTitle(results.flowStage),
        };
      }
      const status = String(row.status || '').trim().toLowerCase();
      if (status === 'paid') {
        const paidDetail = redeemStatus === 'skipped'
          ? (row.redeemReason || row.reason || '重新核验已是会员，未消耗卡密')
          : (row.reason || row.redeemReason || '已确认会员');
        return {
          className: 'used',
          label: `有会员 ${getMembershipPlanLabel(row.planType)}`,
          detail: paidDetail,
        };
      }
      if (status === 'free') {
        const trialStatus = normalizeTrialEligibilityStatus(row.trialEligibilityStatus);
        const trialReason = row.trialEligibilityReason || row.reason || '';
        const redeemFailureCount = normalizeRetryCount(row.redeemFailureCount);
        if (['running', 'submitted', 'pending', 'processing', 'accepted'].includes(redeemStatus)) {
          return {
            className: 'pending',
            label: '等待远端结果',
            detail: row.redeemReason || row.reason || '卡密已提交，等待远端系统返回最终结果',
          };
        }
        if (redeemStatus === 'blocked' || isPreSubmitUpiCredentialMembershipBlockedRow(row)) {
          const blockedReason = row.redeemReason || row.reason || '登录或读取 accessToken 未完成';
          const blockedLabel = /登录|验证码|accessToken|AT|密码|2FA/i.test(blockedReason)
            ? '登录受阻'
            : '未提交卡密';
          return {
            className: 'pending',
            label: blockedLabel,
            detail: blockedReason,
          };
        }
        if (redeemStatus === 'failed' && trialStatus === 'eligible') {
          return {
            className: redeemFailureCount >= 2 ? 'failed' : 'pending',
            label: `兑换失败 ${Math.max(1, redeemFailureCount)}/3`,
            detail: `${row.redeemReason || row.reason || 'UPI 卡密兑换失败'}；账号有试用资格，可重新兑换，失败 3 次会自动删除。`,
          };
        }
        if (trialStatus === 'eligible') {
          return {
            className: 'active',
            label: '有试用资格',
            detail: trialReason || '试用资格已确认，可提交卡密兑换',
          };
        }
        if (trialStatus === 'ineligible') {
          return {
            className: 'failed',
            label: '无试用资格',
            detail: trialReason || '账号无试用资格',
          };
        }
        if (trialStatus === 'failed') {
          return {
            className: 'failed',
            label: '试用检测失败',
            detail: trialReason || '试用资格检测失败，账号已保留',
          };
        }
        if (trialStatus === 'skipped') {
          return {
            className: 'pending',
            label: '未检测资格',
            detail: trialReason || '缺少必要信息，未检测试用资格',
          };
        }
        return {
          className: 'active',
          label: '可兑换',
          detail: row.trialEligibilityReason || row.reason || 'Free 分组账号，点击邮箱或状态可提交卡密兑换',
        };
      }
      if (status === 'failed') {
        const reason = row.reason || '核验失败';
        return {
          className: 'failed',
          label: `失败：${compactMembershipReason(reason, 30)}`,
          detail: reason,
        };
      }
      if (results.running) {
        return {
          className: 'pending',
          label: '待核验',
          detail: '等待批量核验',
        };
      }
      return {
        className: row.enabled === false ? '' : 'active',
        label: row.enabled === false ? '停用' : '待核验',
        detail: row.source === 'txt' ? 'TXT 导入' : '本地备份',
      };
    }

    function normalizeTrialEligibilityStatus(value = '') {
      const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (['eligible', 'trial_eligible', 'available', 'ok', 'success'].includes(normalized)) {
        return 'eligible';
      }
      if (['ineligible', 'not_eligible', 'no_trial', 'trial_ineligible', 'rejected'].includes(normalized)) {
        return 'ineligible';
      }
      if (['failed', 'failure', 'error'].includes(normalized)) {
        return 'failed';
      }
      if (['skipped', 'skip'].includes(normalized)) {
        return 'skipped';
      }
      return '';
    }

    function normalizeTrialEligibilitySummaryItem(item = {}) {
      const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      return {
        email: normalizeUpiCredentialMembershipEmail(source.email),
        reason: String(source.reason || '').trim(),
      };
    }

    function buildUpiCredentialMembershipTrialEligibilitySummary(results = {}, rows = []) {
      const source = results?.trialEligibilitySummary && typeof results.trialEligibilitySummary === 'object'
        ? results.trialEligibilitySummary
        : {};
      const kept = Array.isArray(source.kept) ? source.kept.map(normalizeTrialEligibilitySummaryItem).filter((item) => item.email) : [];
      const skipped = Array.isArray(source.skipped) ? source.skipped.map(normalizeTrialEligibilitySummaryItem).filter((item) => item.email) : [];
      const failed = Array.isArray(source.failed) ? source.failed.map(normalizeTrialEligibilitySummaryItem).filter((item) => item.email) : [];
      const deletedEmails = Array.isArray(source.deletedEmails)
        ? source.deletedEmails.map(normalizeUpiCredentialMembershipEmail).filter(Boolean)
        : [];
      const rowCounts = (Array.isArray(rows) ? rows : []).reduce((counts, row) => {
        const trialStatus = normalizeTrialEligibilityStatus(row?.trialEligibilityStatus);
        if (trialStatus === 'eligible') counts.eligible += 1;
        if (trialStatus === 'skipped') counts.skipped += 1;
        if (trialStatus === 'failed') counts.failed += 1;
        return counts;
      }, { eligible: 0, skipped: 0, failed: 0 });
      const hasStoredSummary = Boolean(source.checkedAt || kept.length || skipped.length || failed.length || deletedEmails.length);
      return {
        checkedAt: String(source.checkedAt || '').trim(),
        eligibleCount: hasStoredSummary ? Math.max(0, Math.floor(Number(source.eligibleCount) || kept.length || 0)) : rowCounts.eligible,
        skippedCount: hasStoredSummary ? Math.max(0, Math.floor(Number(source.skippedCount) || skipped.length || 0)) : rowCounts.skipped,
        failedCount: hasStoredSummary ? Math.max(0, Math.floor(Number(source.failedCount) || failed.length || 0)) : rowCounts.failed,
        deletedCount: hasStoredSummary ? Math.max(0, Math.floor(Number(source.deletedCount) || deletedEmails.length || 0)) : 0,
        deletedEmails,
      };
    }

    function buildTrialEligibilitySummaryText(summary = {}) {
      const parts = [];
      if (summary.checkedAt) {
        parts.push(`上次 ${formatAccountRecordTime(summary.checkedAt)}`);
      }
      parts.push(`有资格 ${summary.eligibleCount || 0}`);
      parts.push(`无资格删除 ${summary.deletedCount || 0}`);
      parts.push(`跳过 ${summary.skippedCount || 0}`);
      parts.push(`失败 ${summary.failedCount || 0}`);
      return parts.join(' / ');
    }

    function buildTrialEligibilityDeletedPreview(summary = {}) {
      const deletedEmails = Array.isArray(summary.deletedEmails) ? summary.deletedEmails.filter(Boolean) : [];
      if (!deletedEmails.length) {
        return '';
      }
      const preview = deletedEmails.slice(0, 3).join('、');
      return deletedEmails.length > 3 ? `${preview} 等 ${deletedEmails.length} 个无资格账号已删除` : `${preview} 已删除`;
    }

    function isRedeemableFreeUpiCredentialMembershipRow(row = {}) {
      const status = String(row.status || '').trim().toLowerCase();
      if (!row?.email || row.enabled === false || status !== 'free') {
        return false;
      }
      const redeemStatus = String(row.redeemStatus || '').trim().toLowerCase();
      if (['running', 'submitted', 'pending', 'processing', 'accepted'].includes(redeemStatus)) {
        return false;
      }
      if (redeemStatus === 'blocked' || isPreSubmitUpiCredentialMembershipBlockedRow(row)) {
        return false;
      }
      if (redeemStatus === 'failed') {
        return normalizeRetryCount(row.redeemFailureCount) < 3;
      }
      if (normalizeRetryCount(row.redeemFailureCount) >= 3) {
        return false;
      }
      return true;
    }

    function getNotRedeemableFreeUpiCredentialMembershipReason(row = {}) {
      const status = String(row.status || '').trim().toLowerCase();
      const redeemStatus = String(row.redeemStatus || '').trim().toLowerCase();
      const reason = String(row.redeemReason || row.reason || '').trim();
      if (!row?.email) {
        return '账号邮箱为空，无法补兑';
      }
      if (row.enabled === false) {
        return '账号已停用';
      }
      if (status !== 'free') {
        return status === 'paid' ? '当前已有会员' : '当前不是无会员状态';
      }
      if (['running', 'submitted', 'pending', 'processing', 'accepted'].includes(redeemStatus)) {
        return reason || '卡密已提交，等待远端状态刷新';
      }
      if (redeemStatus === 'blocked' || isPreSubmitUpiCredentialMembershipBlockedRow(row)) {
        return reason || '登录或读取 ChatGPT session 未完成，尚未提交卡密';
      }
      if (['success', 'skipped'].includes(redeemStatus)) {
        return '已有兑换成功记录';
      }
      if (normalizeRetryCount(row.redeemFailureCount) >= 3) {
        return '账号兑换失败已达 3 次';
      }
      return '当前不可补兑';
    }

    function isTrialEligibilityCheckableFreeUpiCredentialMembershipRow(row = {}) {
      const status = String(row.status || '').trim().toLowerCase();
      const trialStatus = normalizeTrialEligibilityStatus(row.trialEligibilityStatus);
      return row?.email
        && row.enabled !== false
        && status === 'free'
        && trialStatus !== 'eligible'
        && Boolean(normalizeUpiCredentialMembershipText(row.password))
        && Boolean(normalizeUpiCredentialMembershipTotpSecret(row.totpMfaSecret));
    }

    function getUpiCredentialMembershipGroup(row = {}) {
      return String(row.status || '').trim().toLowerCase() === 'paid' ? 'paid' : 'free';
    }

    function filterUpiCredentialMembershipRowsByGroup(rows = [], group = upiCredentialMembershipGroup) {
      const normalizedGroup = String(group || '').trim().toLowerCase() === 'paid' ? 'paid' : 'free';
      return (Array.isArray(rows) ? rows : []).filter((row) => getUpiCredentialMembershipGroup(row) === normalizedGroup);
    }

    function getUpiCredentialMembershipGroupLabel(group = upiCredentialMembershipGroup) {
      return String(group || '').trim().toLowerCase() === 'paid' ? '有 Plus' : 'Free';
    }

    const UPI_CREDENTIAL_MEMBERSHIP_FLOW_STEPS = [
      { key: 'import', title: '导入备份账号' },
      { key: 'open-chatgpt', title: '打开 ChatGPT 官网' },
      { key: 'login', title: '登录邮箱密码' },
      { key: 'totp', title: '提交 2FA 验证' },
      { key: 'token', title: '读取 accessToken' },
      { key: 'subscription-check', title: '查询会员资格' },
      { key: 'upi-redeem-plus', title: 'UPI 卡密兑换 Plus' },
      { key: 'confirm-plus', title: '确认 Plus 会员' },
    ];

    function getUpiCredentialMembershipFlowStepIndex(stepKey = '') {
      return UPI_CREDENTIAL_MEMBERSHIP_FLOW_STEPS.findIndex((step) => step.key === stepKey);
    }

    function normalizeUpiCredentialMembershipFlowStage(value = '') {
      const stage = String(value || '').trim().toLowerCase();
      return getUpiCredentialMembershipFlowStepIndex(stage) >= 0 ? stage : '';
    }

    function getUpiCredentialMembershipFlowStatus(stepKey = '', results = getUpiCredentialMembershipCheckResults(), rows = []) {
      const items = Array.isArray(results.items) ? results.items : [];
      const hasRows = rows.length > 0 || items.length > 0;
      const isRunning = results.running === true;
      const isRedeeming = results.redeeming === true;
      const isStopped = !isRunning && !isRedeeming && Boolean(results.stoppedAt || results.redeemStoppedAt);
      const activeStage = (isRunning || isRedeeming)
        ? normalizeUpiCredentialMembershipFlowStage(results.flowStage)
        : '';
      const stoppedStage = isStopped
        ? normalizeUpiCredentialMembershipFlowStage(results.flowStage)
          || (results.redeemStoppedAt ? 'upi-redeem-plus' : 'subscription-check')
        : '';
      const fallbackActiveStage = !activeStage && (isRunning || isRedeeming)
        ? (!hasRows ? 'import' : (isRunning ? 'subscription-check' : 'upi-redeem-plus'))
        : '';
      const runningStage = activeStage || fallbackActiveStage;
      if (runningStage) {
        const activeIndex = getUpiCredentialMembershipFlowStepIndex(runningStage);
        const stepIndex = getUpiCredentialMembershipFlowStepIndex(stepKey);
        if (stepIndex < 0 || activeIndex < 0) {
          return 'pending';
        }
        if (stepIndex < activeIndex) return 'completed';
        if (stepIndex === activeIndex) return 'running';
        return 'pending';
      }
      if (stoppedStage) {
        const stoppedIndex = getUpiCredentialMembershipFlowStepIndex(stoppedStage);
        const stepIndex = getUpiCredentialMembershipFlowStepIndex(stepKey);
        if (stepIndex < 0 || stoppedIndex < 0) {
          return 'pending';
        }
        if (stepIndex < stoppedIndex) return 'completed';
        if (stepIndex === stoppedIndex) return 'stopped';
        return 'pending';
      }
      const hasCheckedItems = items.some((item) => item?.checkedAt || item?.accessTokenMasked || item?.status === 'paid' || item?.status === 'failed');
      const hasRedeemAttempt = items.some((item) => String(item?.redeemStatus || '').trim());
      const hasRedeemSuccess = items.some((item) => String(item?.redeemStatus || '').trim().toLowerCase() === 'success');
      const hasRedeemSkipped = items.some((item) => String(item?.redeemStatus || '').trim().toLowerCase() === 'skipped');
      const hasPaid = items.some((item) => item?.status === 'paid');
      const hasFailure = items.some((item) => item?.status === 'failed' || String(item?.redeemStatus || '').trim().toLowerCase() === 'failed');
      const importedFreeOnly = String(results.source || '').trim().toLowerCase() === 'txt-free' && !hasCheckedItems && !hasRedeemAttempt;

      if (stepKey === 'import') {
        return hasRows ? 'completed' : 'pending';
      }
      if (!hasRows) {
        return 'pending';
      }
      if (stepKey === 'open-chatgpt' || stepKey === 'login' || stepKey === 'totp' || stepKey === 'token') {
        if (hasCheckedItems || hasRedeemAttempt) return 'completed';
        return importedFreeOnly ? 'pending' : 'pending';
      }
      if (stepKey === 'subscription-check') {
        if (hasCheckedItems || hasRedeemAttempt || (items.length && !importedFreeOnly)) return 'completed';
        return 'pending';
      }
      if (stepKey === 'upi-redeem-plus') {
        if (hasRedeemSuccess) return 'completed';
        if (hasRedeemSkipped && !hasFailure) return 'skipped';
        if (hasRedeemAttempt && hasFailure) return 'failed';
        return 'pending';
      }
      if (stepKey === 'confirm-plus') {
        if (hasPaid) return 'completed';
        if (hasFailure) return 'failed';
        return 'pending';
      }
      return 'pending';
    }

    function getUpiCredentialMembershipFlowStatusLabel(status = '') {
      if (status === 'completed') return '完成';
      if (status === 'running') return '进行中';
      if (status === 'stopped') return '已停止';
      if (status === 'failed') return '失败';
      if (status === 'skipped') return '已跳过';
      return '';
    }

    function getUpiCredentialMembershipFlowDetail(results = getUpiCredentialMembershipCheckResults()) {
      const items = Array.isArray(results.items) ? results.items : [];
      const currentEmail = normalizeUpiCredentialMembershipEmail(results.flowStageEmail);
      const currentItem = currentEmail
        ? items.find((item) => normalizeUpiCredentialMembershipEmail(item?.email) === currentEmail)
        : null;
      if ((results.redeeming || results.running) && currentItem?.redeemReason) {
        return currentItem.redeemReason;
      }
      const failedItem = items.slice().reverse().find((item) => {
        return String(item?.redeemStatus || '').trim().toLowerCase() === 'failed'
          || String(item?.status || '').trim().toLowerCase() === 'failed';
      });
      if (failedItem) {
        return failedItem.redeemReason || failedItem.reason || '';
      }
      const skippedCount = items.filter((item) => String(item?.redeemStatus || '').trim().toLowerCase() === 'skipped').length;
      const successCount = items.filter((item) => String(item?.redeemStatus || '').trim().toLowerCase() === 'success').length;
      if (skippedCount && !successCount) {
        return '第 7 步已跳过：账号重新核验已经是 Plus/Pro/Team 会员，未消耗 UPI 卡密。';
      }
      return '';
    }

    function renderUpiCredentialMembershipFlow(results = getUpiCredentialMembershipCheckResults(), rows = []) {
      const detail = getUpiCredentialMembershipFlowDetail(results);
      return `
        <div class="upi-membership-flow-list" aria-label="UPI 备份会员核验流程">
          ${UPI_CREDENTIAL_MEMBERSHIP_FLOW_STEPS.map((step, index) => {
            const status = getUpiCredentialMembershipFlowStatus(step.key, results, rows);
            const statusLabel = getUpiCredentialMembershipFlowStatusLabel(status);
            return `
              <div class="upi-membership-flow-row ${escapeHtml(status)}" data-upi-membership-flow-step="${escapeHtml(step.key)}">
                <div class="upi-membership-flow-indicator"><span class="upi-membership-flow-num">${escapeHtml(String(index + 1))}</span></div>
                <div class="upi-membership-flow-title">${escapeHtml(step.title)}</div>
                <span class="upi-membership-flow-status">${escapeHtml(statusLabel)}</span>
              </div>
            `;
          }).join('')}
        </div>
        ${detail ? `<div class="upi-membership-flow-detail">${escapeHtml(detail)}</div>` : ''}
      `;
    }

    function restoreScrollTopAfterRender(node, scrollTop = 0) {
      if (!node || scrollTop <= 0) {
        return;
      }
      const restore = () => {
        const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
        node.scrollTop = Math.min(scrollTop, maxScrollTop);
      };
      restore();
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(restore);
      }
    }

    function renderUpiCredentialMembershipCheckResults() {
      const container = dom.upiCredentialMembershipCheckResults;
      if (!container) return;
      const results = getUpiCredentialMembershipCheckResults();
      const rows = buildUpiCredentialMembershipDisplayRows(results);
      const groupedRows = filterUpiCredentialMembershipRowsByGroup(rows);
      const hasItems = rows.length > 0;
      const show = hasItems || results.running || results.redeeming;
      setNodeHidden(container, !show);
      if (!show) {
        container.innerHTML = '';
        return;
      }
      const progress = results.running
        ? `核验中 ${results.completed}/${results.total || results.completed}`
        : results.redeeming
          ? `补兑中 ${results.redeemCompleted}/${results.redeemTotal || results.redeemCompleted}`
          : results.redeemStoppedAt
            ? `补兑已停止 ${results.redeemCompleted}/${results.redeemTotal || results.redeemCompleted}`
            : results.stoppedAt
              ? `核验已停止 ${results.completed}/${results.total || results.completed}`
        : `已核验 ${results.completed || results.items.length}/${results.total || results.items.length}`;
      const currentFlowEmail = normalizeUpiCredentialMembershipEmail(results.flowStageEmail);
      const currentFlowTitle = getUpiCredentialMembershipFlowTitle(results.flowStage);
      const currentFlowText = currentFlowEmail
        ? ` · 当前 ${currentFlowEmail}${currentFlowTitle ? ` · ${currentFlowTitle}` : ''}`
        : '';
      const enabledCount = rows.filter((row) => row.enabled !== false).length;
      const paidCount = rows.filter((row) => String(row.status || '').trim().toLowerCase() === 'paid').length;
      const freeCount = rows.filter((row) => String(row.status || '').trim().toLowerCase() === 'free').length;
      const nonPlusCount = rows.length - paidCount;
      const failedCount = rows.filter((row) => String(row.status || '').trim().toLowerCase() === 'failed').length;
      const redeemableFreeCount = rows.filter(isRedeemableFreeUpiCredentialMembershipRow).length;
      const trialCheckableFreeCount = rows.filter(isTrialEligibilityCheckableFreeUpiCredentialMembershipRow).length;
      const membershipBusy = results.running || results.redeeming || upiCredentialMembershipCheckBusy;
      const trialSummary = buildUpiCredentialMembershipTrialEligibilitySummary(results, rows);
      const trialSummaryText = buildTrialEligibilitySummaryText(trialSummary);
      const trialDeletedPreview = buildTrialEligibilityDeletedPreview(trialSummary);
      const trialDeletedTitle = (Array.isArray(trialSummary.deletedEmails) ? trialSummary.deletedEmails : []).join('\n');
      const redeemFreeButtonLabel = `兑换启用无会员(${escapeHtml(String(redeemableFreeCount))})`;
      const showPaidGroupActions = upiCredentialMembershipGroup === 'paid';
      const showFreeGroupActions = upiCredentialMembershipGroup === 'free';
      const previousListScrollTop = container.querySelector('.upi-membership-check-list')?.scrollTop || 0;
      container.innerHTML = `
        <div class="upi-membership-check-head">
          <span>${escapeHtml(`${progress}${currentFlowText}`)} · 启用 ${escapeHtml(String(enabledCount))} / 有会员 ${escapeHtml(String(paidCount))} / 无会员 ${escapeHtml(String(freeCount))} / 失败 ${escapeHtml(String(failedCount))}</span>
          ${results.updatedAt ? `<span class="mono">${escapeHtml(formatAccountRecordTime(results.updatedAt))}</span>` : ''}
        </div>
        <div class="upi-membership-check-actions">
          ${['paid', 'free', 'failed'].map((status) => {
            const count = results.items.filter((item) => item?.status === status).length;
            return `<button class="btn btn-ghost btn-xs" type="button" data-upi-membership-export="${escapeHtml(status)}"${count ? '' : ' disabled'}>导出${escapeHtml(getMembershipStatusTitle(status))}(${escapeHtml(String(count))})</button>`;
          }).join('')}
          ${showFreeGroupActions ? `<button class="btn btn-ghost btn-xs" type="button" data-upi-membership-import-free ${membershipBusy ? 'disabled' : ''}>导入 Free</button>` : ''}
          ${showPaidGroupActions ? `<button class="btn btn-ghost btn-xs" type="button" data-upi-membership-delete-group="paid" ${paidCount && !membershipBusy ? '' : 'disabled'}>删除 Plus(${escapeHtml(String(paidCount))})</button>` : ''}
          <button class="btn btn-ghost btn-xs" type="button" data-upi-membership-redeem-free ${redeemableFreeCount && !membershipBusy ? '' : 'disabled'}>${redeemFreeButtonLabel}</button>
          ${results.redeeming ? '<button class="btn btn-ghost btn-xs" type="button" data-upi-membership-stop-redeem>停止补兑</button>' : '<button class="btn btn-ghost btn-xs" type="button" data-upi-membership-stop-redeem hidden>停止补兑</button>'}
        </div>
        ${renderUpiCredentialMembershipFlow(results, rows)}
        <div class="upi-membership-check-groups" role="group" aria-label="UPI 备份账号会员分组">
          ${[
            { key: 'paid', label: '有 Plus', count: paidCount },
            { key: 'free', label: 'Free', count: nonPlusCount },
          ].map((group) => `
            <button
              class="upi-membership-check-group ${upiCredentialMembershipGroup === group.key ? 'is-active' : ''}"
              type="button"
              data-upi-membership-group="${escapeHtml(group.key)}"
              aria-pressed="${upiCredentialMembershipGroup === group.key ? 'true' : 'false'}"
            >
              <span>${escapeHtml(group.label)}</span>
              <strong>${escapeHtml(String(group.count))}</strong>
            </button>
          `).join('')}
        </div>
        <div class="upi-membership-check-prune-row">
          <div class="upi-membership-check-prune-copy">
            <strong>Free 试用资格</strong>
            <span>可检测 ${escapeHtml(String(trialCheckableFreeCount))} 个；${escapeHtml(trialSummaryText)}</span>
            ${trialDeletedPreview ? `<span class="upi-membership-check-prune-deleted" title="${escapeHtml(trialDeletedTitle)}">${escapeHtml(trialDeletedPreview)}</span>` : ''}
          </div>
            <button
              class="btn btn-primary btn-xs upi-membership-check-prune-button"
              type="button"
              data-upi-membership-prune-ineligible-free
              ${trialCheckableFreeCount && !membershipBusy ? '' : 'disabled'}
              title="检测 Free 分组账号是否有试用资格，无资格自动删除"
            >
              检测试用资格
            </button>
        </div>
        <div class="upi-membership-check-status-header">
          <span>启用</span>
          <span>邮箱</span>
          <span>状态</span>
          <span>删除</span>
        </div>
        <div class="upi-membership-check-list">
          ${groupedRows.length ? groupedRows.map((row) => {
            const meta = getUpiCredentialMembershipRowStatusMeta(row, results);
            const email = normalizeUpiCredentialMembershipEmail(row.email);
            const isRowChecking = upiCredentialMembershipCheckingEmail === email;
            const disableSingleCheck = membershipBusy || isRowChecking || row.enabled === false;
            const singleActionTitle = upiCredentialMembershipGroup === 'free'
              ? '点击用卡密兑换该账号'
              : '点击检测该账号是否已开通 Plus/Pro/Team';
            const singleActionAria = upiCredentialMembershipGroup === 'free'
              ? `用卡密兑换 ${email}`
              : `检测 ${email} 是否有 Plus`;
            const titleParts = [
              email,
              meta.detail,
              row.checkedAt ? formatAccountRecordTime(row.checkedAt) : '',
            ].filter(Boolean);
            return `
              <div class="upi-membership-check-item" data-upi-membership-email="${escapeHtml(email)}" title="${escapeHtml(titleParts.join('\n'))}">
                <label class="toggle-switch upi-membership-check-enabled-toggle">
                  <input type="checkbox" data-upi-membership-toggle="${escapeHtml(email)}" ${row.enabled === false ? '' : 'checked'} ${membershipBusy ? 'disabled' : ''} aria-label="启用核验 ${escapeHtml(email)}" />
                  <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
                </label>
                <button class="upi-membership-check-email upi-membership-check-email-action mono" type="button" data-upi-membership-check-one="${escapeHtml(email)}" ${disableSingleCheck ? 'disabled' : ''} title="${escapeHtml(singleActionTitle)}">${escapeHtml(email)}</button>
                <button class="icloud-tag upi-membership-check-status-action ${escapeHtml(meta.className)}" type="button" data-upi-membership-check-one="${escapeHtml(email)}" ${disableSingleCheck ? 'disabled' : ''} aria-label="${escapeHtml(singleActionAria)}" title="${escapeHtml(singleActionTitle)}">${escapeHtml(meta.label)}</button>
                <button class="icloud-tag danger upi-membership-check-delete-action" type="button" data-upi-membership-delete="${escapeHtml(email)}" ${membershipBusy ? 'disabled' : ''}>删除</button>
              </div>
              ${meta.detail ? `<div class="upi-membership-check-detail">${escapeHtml(meta.detail)}</div>` : ''}
            `;
          }).join('') : `<div class="upi-membership-check-empty">${escapeHtml(`${getUpiCredentialMembershipGroupLabel()} 分组暂无账号`)}</div>`}
        </div>
      `;
      restoreScrollTopAfterRender(
        container.querySelector('.upi-membership-check-list'),
        previousListScrollTop
      );
    }

    function isAutoRunRecordDisplayRunning(currentState = {}) {
      const phase = String(currentState.autoRunPhase || '').trim().toLowerCase();
      return Boolean(currentState.autoRunning)
        && ['running', 'waiting_step', 'waiting_email', 'retrying'].includes(phase);
    }

    function buildCurrentAccountRecordId(currentState = {}) {
      const accountIdentifierType = String(currentState.accountIdentifierType || '').trim().toLowerCase();
      const email = String(currentState.email || '').trim();
      const phoneNumber = String(
        currentState.signupPhoneNumber
        || currentState.phoneNumber
        || currentState.phone
        || ''
      ).trim();
      const accountIdentifier = String(
        currentState.accountIdentifier
        || (accountIdentifierType === 'phone' ? phoneNumber : email)
        || ''
      ).trim();
      return buildRecordId({
        accountIdentifierType,
        accountIdentifier,
        email,
        phoneNumber,
      });
    }

    function applyRunningDisplayState(record = {}, currentState = {}) {
      if (!isAutoRunRecordDisplayRunning(currentState)) {
        return record;
      }
      if (getRecordDisplayStatus(record) === 'success') {
        return record;
      }

      const currentRecordId = buildCurrentAccountRecordId(currentState);
      if (!currentRecordId || buildRecordId(record) !== currentRecordId) {
        return record;
      }

      return {
        ...record,
        displayStatus: 'running',
        displaySummary: '正在运行',
      };
    }

    function getRecordIdentifierType(record = {}) {
      const rawType = String(record.accountIdentifierType || '').trim().toLowerCase();
      if (rawType === 'phone') {
        return 'phone';
      }
      if (rawType === 'email') {
        return 'email';
      }
      if (!record.email && (record.phoneNumber || record.phone || record.number)) {
        return 'phone';
      }
      if (!record.email && record.accountIdentifier && !/@/.test(String(record.accountIdentifier || ''))) {
        return 'phone';
      }
      return 'email';
    }

    function getRecordEmail(record = {}) {
      const identifierType = getRecordIdentifierType(record);
      return String(
        record.email
        || (identifierType === 'email' ? record.accountIdentifier : '')
        || ''
      ).trim();
    }

    function getRecordPhoneNumber(record = {}) {
      const identifierType = getRecordIdentifierType(record);
      return String(
        record.phoneNumber
        || record.phone
        || record.number
        || (identifierType === 'phone' ? record.accountIdentifier : '')
        || ''
      ).trim();
    }

    function getRecordPrimaryIdentifier(record = {}) {
      const identifierType = getRecordIdentifierType(record);
      const email = getRecordEmail(record);
      const phoneNumber = getRecordPhoneNumber(record);
      return identifierType === 'phone'
        ? (phoneNumber || String(record.accountIdentifier || '').trim() || email)
        : (email || String(record.accountIdentifier || '').trim() || phoneNumber);
    }

    function getRecordSecondaryIdentifier(record = {}) {
      const identifierType = getRecordIdentifierType(record);
      const email = getRecordEmail(record);
      const phoneNumber = getRecordPhoneNumber(record);
      if (identifierType === 'phone' && email) {
        return `邮箱 ${email}`;
      }
      if (identifierType !== 'phone' && phoneNumber) {
        return `绑定手机号 ${phoneNumber}`;
      }
      return '';
    }

    function getRecordTitle(record = {}) {
      const primaryIdentifier = getRecordPrimaryIdentifier(record) || '(空账号)';
      const secondaryIdentifier = getRecordSecondaryIdentifier(record);
      return secondaryIdentifier
        ? `${primaryIdentifier} / ${secondaryIdentifier}`
        : primaryIdentifier;
    }

    function getAccountRunRecords(currentState = state.getLatestState()) {
      return (Array.isArray(currentState?.accountRunHistory) ? currentState.accountRunHistory : [])
        .filter((item) => item && typeof item === 'object')
        .slice()
        .sort((left, right) => normalizeTimestamp(right.finishedAt) - normalizeTimestamp(left.finishedAt))
        .map((record) => applyRunningDisplayState(record, currentState));
    }

    function summarizeAccountRunHistory(records = []) {
      return records.reduce((summary, record) => {
        const retryCount = normalizeRetryCount(record.retryCount);
        const status = getRecordDisplayStatus(record);
        summary.total += 1;
        if (status === 'success') {
          summary.success += 1;
        } else if (status === 'running') {
          summary.running += 1;
        } else if (status === 'failed') {
          summary.failed += 1;
        } else if (status === 'stopped') {
          summary.stopped += 1;
        }
        if (retryCount > 0) {
          summary.retryRecordCount += 1;
        }
        summary.retryTotal += retryCount;
        return summary;
      }, {
        total: 0,
        success: 0,
        running: 0,
        failed: 0,
        stopped: 0,
        retryRecordCount: 0,
        retryTotal: 0,
      });
    }

    function formatAccountRecordTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return '--:--';
      }

      const now = new Date();
      const sameYear = date.getFullYear() === now.getFullYear();
      const sameDay = date.toDateString() === now.toDateString();

      if (sameDay) {
        return date.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          timeZone: displayTimeZone,
        });
      }

      return date.toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...(sameYear ? {} : { year: '2-digit' }),
        timeZone: displayTimeZone,
      }).replace(/\//g, '-');
    }

    function getStatusMeta(record = {}) {
      const status = getRecordDisplayStatus(record);
      if (status === 'success') {
        return { kind: 'success', label: getConfirmedUpiSubscriptionLabel(record) || '成功' };
      }
      if (status === 'running') {
        return { kind: 'running', label: '正在运行' };
      }
      if (status === 'stopped') {
        return { kind: 'stopped', label: '停止' };
      }
      return { kind: 'failed', label: '失败' };
    }

    function getRecordSummaryText(record = {}) {
      const status = getRecordDisplayStatus(record);
      if (record.displaySummary) {
        return String(record.displaySummary || '').trim();
      }
      if (status === 'success') {
        return getConfirmedUpiSubscriptionLabel(record) || '流程完成';
      }
      if (status === 'running') {
        return '正在运行';
      }

      return String(record.failureDetail || record.reason || '').trim()
        || String(record.failureLabel || '').trim()
        || '流程失败';
    }

    function getRecordTooltipText(record = {}, summaryText = '') {
      const recordTitle = getRecordTitle(record);
      const status = getRecordDisplayStatus(record);
      const detail = String(record.displaySummary || record.failureDetail || record.reason || '').trim();
      if (status === 'success' || status === 'running' || !detail || detail === recordTitle) {
        return recordTitle;
      }
      return `${recordTitle}\n${detail}`;
    }

    function getFilterConfig(filterKey = activeFilter) {
      return FILTER_CONFIG[filterKey] || FILTER_CONFIG.all;
    }

    function getFilteredRecords(records = []) {
      const filterConfig = getFilterConfig(activeFilter);
      return records.filter((record) => filterConfig.matches(record));
    }

    function pruneSelectedRecordIds(records = []) {
      const availableIds = new Set(records.map((record) => buildRecordId(record)).filter(Boolean));
      for (const recordId of Array.from(selectedRecordIds)) {
        if (!availableIds.has(recordId)) {
          selectedRecordIds.delete(recordId);
        }
      }
    }

    function setNodeHidden(node, hidden) {
      if (node) {
        node.hidden = Boolean(hidden);
      }
    }

    function setNodeDisabled(node, disabled) {
      if (node) {
        node.disabled = Boolean(disabled);
      }
    }

    function toggleNodeClass(node, className, enabled) {
      if (!node || !className) {
        return;
      }
      if (node.classList && typeof node.classList.toggle === 'function') {
        node.classList.toggle(className, Boolean(enabled));
      }
    }

    function setNodeText(node, value) {
      if (node) {
        node.textContent = String(value || '');
      }
    }

    function setNodeAttr(node, name, value) {
      if (!node || !name) {
        return;
      }
      if (typeof node.setAttribute === 'function') {
        node.setAttribute(name, String(value));
        return;
      }
      node[name] = value;
    }

    function getDatasetValue(node, attrName) {
      if (!node || !attrName) {
        return '';
      }

      if (typeof node.getAttribute === 'function') {
        return String(node.getAttribute(attrName) || '');
      }

      const dataKey = attrName
        .replace(/^data-/, '')
        .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      return String(node.dataset?.[dataKey] || '');
    }

    function findClosest(target, selector) {
      if (!target || typeof target.closest !== 'function') {
        return null;
      }
      try {
        return target.closest(selector);
      } catch {
        return null;
      }
    }

    function createStatChip(filterKey, value) {
      const filterConfig = getFilterConfig(filterKey);
      const classNames = [
        'account-records-stat',
        filterConfig.className,
        activeFilter === filterKey ? 'is-active' : '',
      ].filter(Boolean).join(' ');

      return `
        <button
          type="button"
          class="${classNames}"
          data-account-record-filter="${escapeHtml(filterKey)}"
          aria-pressed="${activeFilter === filterKey ? 'true' : 'false'}"
        >
          <strong>${escapeHtml(String(value))}</strong>${escapeHtml(filterConfig.label)}
        </button>
      `;
    }

    function updateHeader(allRecords, filteredRecords) {
      if (!dom.accountRecordsMeta) {
        return;
      }

      if (!allRecords.length) {
        dom.accountRecordsMeta.textContent = '暂无账号记录';
        return;
      }

      const latestTime = formatAccountRecordTime(allRecords[0]?.finishedAt);
      let metaText = `共 ${allRecords.length} 条，最近更新于 ${latestTime}`;

      if (activeFilter !== 'all') {
        metaText = `共 ${allRecords.length} 条，当前筛选 ${getFilterConfig(activeFilter).metaLabel} ${filteredRecords.length} 条，最近更新于 ${latestTime}`;
      }

      if (selectionMode) {
        metaText += `，已选 ${selectedRecordIds.size} 条`;
      }

      dom.accountRecordsMeta.textContent = metaText;
    }

    function updateStats(allRecords) {
      if (!dom.accountRecordsStats) {
        return;
      }

      const summary = summarizeAccountRunHistory(allRecords);
      dom.accountRecordsStats.innerHTML = [
        createStatChip('all', summary.total),
        createStatChip('running', summary.running),
        createStatChip('success', summary.success),
        createStatChip('failed', summary.failed),
        createStatChip('stopped', summary.stopped),
        createStatChip('retry', summary.retryTotal),
      ].join('');
    }

    function updateToolbarState(allRecords) {
      const totalRecords = allRecords.length;
      const exportRows = buildUpiRedeemSuccessEmailExportRows(allRecords);
      setNodeDisabled(dom.btnClearAccountRecords, totalRecords === 0);
      setNodeDisabled(dom.btnExportSuccessAccountRecords, exportRows.length === 0);
      setNodeDisabled(dom.btnShowUpiCredentialBackups, false);
      setNodeDisabled(dom.btnExportUpiCredentialBackups, false);
      setNodeDisabled(dom.btnExportUpiRedeemSuccessRecords, exportRows.length === 0);
      setNodeDisabled(dom.btnToggleAccountRecordsSelection, totalRecords === 0);
      setNodeHidden(dom.btnClearAccountRecords, selectionMode);
      setNodeHidden(dom.btnExportSuccessAccountRecords, selectionMode);
      setNodeHidden(dom.btnShowUpiCredentialBackups, selectionMode);
      setNodeHidden(dom.btnExportUpiCredentialBackups, selectionMode);
      setNodeHidden(dom.upiCredentialBackupPreviewWrap, selectionMode || !upiCredentialBackupPreviewVisible);
      toggleNodeClass(dom.btnToggleAccountRecordsSelection, 'is-active', selectionMode);
      setNodeAttr(dom.btnToggleAccountRecordsSelection, 'aria-pressed', selectionMode ? 'true' : 'false');
      setNodeText(dom.btnToggleAccountRecordsSelection, selectionMode ? '取消多选' : '多选');

      const selectedCount = selectedRecordIds.size;
      setNodeHidden(dom.btnDeleteSelectedAccountRecords, !selectionMode);
      setNodeDisabled(dom.btnDeleteSelectedAccountRecords, selectedCount === 0);
      setNodeText(
        dom.btnDeleteSelectedAccountRecords,
        selectedCount > 0 ? `删除选中(${selectedCount})` : '删除选中'
      );
    }

    function updatePagination(totalRecords) {
      const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / pageSize) : 0;
      if (totalPages === 0) {
        currentPage = 1;
      } else if (currentPage > totalPages) {
        currentPage = totalPages;
      } else if (currentPage < 1) {
        currentPage = 1;
      }

      setNodeText(dom.accountRecordsPageLabel, totalPages > 0 ? `${currentPage} / ${totalPages}` : '0 / 0');
      setNodeDisabled(dom.btnAccountRecordsPrev, totalPages <= 1 || currentPage <= 1);
      setNodeDisabled(dom.btnAccountRecordsNext, totalPages <= 1 || currentPage >= totalPages);

      return totalPages;
    }

    function renderEmptyState(allRecords) {
      if (!dom.accountRecordsList) {
        return;
      }

      const message = allRecords.length
        ? `当前筛选“${getFilterConfig(activeFilter).metaLabel}”下暂无记录`
        : '暂无账号记录';
      dom.accountRecordsList.innerHTML = `<div class="account-records-empty">${escapeHtml(message)}</div>`;
    }

    function renderRecordList(allRecords, filteredRecords) {
      if (!dom.accountRecordsList) {
        return;
      }

      const totalPages = updatePagination(filteredRecords.length);
      if (!filteredRecords.length) {
        renderEmptyState(allRecords);
        return;
      }

      const startIndex = (currentPage - 1) * pageSize;
      const visibleRecords = filteredRecords.slice(startIndex, startIndex + pageSize);

      dom.accountRecordsList.innerHTML = visibleRecords.map((record) => {
        const recordId = buildRecordId(record);
        const primaryIdentifier = getRecordPrimaryIdentifier(record) || '(空账号)';
        const secondaryIdentifier = getRecordSecondaryIdentifier(record);
        const statusMeta = getStatusMeta(record);
        const summaryText = getRecordSummaryText(record);
        const recordTitle = getRecordTooltipText(record, summaryText);
        const retryCount = normalizeRetryCount(record.retryCount);
        const isSelected = selectedRecordIds.has(recordId);
        const itemClassNames = [
          'account-record-item',
          `is-${statusMeta.kind}`,
          selectionMode ? 'is-selectable' : '',
          isSelected ? 'is-selected' : '',
        ].filter(Boolean).join(' ');
        const selectionMarkup = selectionMode
          ? `
              <label class="account-record-item-check" data-account-record-toggle="${escapeHtml(recordId)}">
                <input
                  type="checkbox"
                  data-account-record-checkbox="${escapeHtml(recordId)}"
                  ${isSelected ? 'checked' : ''}
                />
              </label>
            `
          : '';

        return `
          <div
            class="${itemClassNames}"
            data-account-record-id="${escapeHtml(recordId)}"
            title="${escapeHtml(recordTitle)}"
          >
            <div class="account-record-item-top">
              <div class="account-record-item-email-row">
                ${selectionMarkup}
                <div class="account-record-item-identity">
                  <div class="account-record-item-email mono">${escapeHtml(primaryIdentifier)}</div>
                  ${secondaryIdentifier ? `<div class="account-record-item-secondary mono">${escapeHtml(secondaryIdentifier)}</div>` : ''}
                </div>
              </div>
              <div class="account-record-item-side">
                <span class="account-record-item-status">${escapeHtml(statusMeta.label)}</span>
                <span class="account-record-item-time mono">${escapeHtml(formatAccountRecordTime(record.finishedAt))}</span>
              </div>
            </div>
            <div class="account-record-item-bottom">
              <div class="account-record-item-summary">${escapeHtml(summaryText)}</div>
              <span class="account-record-item-retry mono">重试 ${escapeHtml(String(retryCount))}</span>
            </div>
          </div>
        `;
      }).join('');

      if (totalPages <= 1) {
        setNodeText(dom.accountRecordsPageLabel, '1 / 1');
      }
    }

    function render(currentState = state.getLatestState()) {
      const allRecords = getAccountRunRecords(currentState);
      pruneSelectedRecordIds(allRecords);

      if (!allRecords.length) {
        selectionMode = false;
      }

      const filteredRecords = getFilteredRecords(allRecords);
      updateHeader(allRecords, filteredRecords);
      updateStats(allRecords);
      updateToolbarState(allRecords);
      renderRecordList(allRecords, filteredRecords);
      const membershipResults = getUpiCredentialMembershipCheckResults(currentState);
      upiCredentialMembershipCheckBusy = membershipResults.running;
      upiCredentialMembershipRedeemBusy = membershipResults.redeeming;
      setExportButtonsBusy(false);
      renderUpiCredentialMembershipCheckResults();
    }

    function openPanel() {
      setNodeHidden(dom.accountRecordsOverlay, false);
      render();
      if (!upiCredentialMembershipPoolLoaded) {
        refreshUpiCredentialMembershipCredentialPool({ silent: true }).catch(() => null);
      }
    }

    function closePanel() {
      setNodeHidden(dom.accountRecordsOverlay, true);
    }

    function resetSelection() {
      selectedRecordIds.clear();
    }

    function setSelectionMode(nextValue) {
      const nextSelectionMode = Boolean(nextValue);
      if (!nextSelectionMode) {
        resetSelection();
      }
      selectionMode = nextSelectionMode;
      currentPage = 1;
      render();
    }

    function toggleSelectionMode() {
      setSelectionMode(!selectionMode);
    }

    function toggleRecordSelection(recordId, forceSelected = null) {
      const normalizedRecordId = String(recordId || '').trim().toLowerCase();
      if (!selectionMode || !normalizedRecordId) {
        return;
      }

      const shouldSelect = forceSelected === null
        ? !selectedRecordIds.has(normalizedRecordId)
        : Boolean(forceSelected);

      if (shouldSelect) {
        selectedRecordIds.add(normalizedRecordId);
      } else {
        selectedRecordIds.delete(normalizedRecordId);
      }
    }

    async function clearRecords() {
      const records = getAccountRunRecords();
      if (!records.length) {
        helpers.showToast?.('没有可清理的账号记录。', 'warn', 1800);
        return;
      }

      const confirmed = await helpers.openConfirmModal({
        title: '清理账号记录',
        message: '确认清理当前全部账号记录吗？该操作会同时清空面板记录与本地同步快照。',
        confirmLabel: '确认清理',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      const response = await runtime.sendMessage({
        type: 'CLEAR_ACCOUNT_RUN_HISTORY',
        source: 'sidepanel',
      });
      if (response?.error) {
        throw new Error(response.error);
      }

      activeFilter = 'all';
      currentPage = 1;
      selectionMode = false;
      resetSelection();
      state.syncLatestState({ accountRunHistory: [] });
      helpers.showToast?.(`已清理 ${Math.max(0, Number(response?.clearedCount) || 0)} 条账号记录。`, 'success', 2200);
    }

    async function deleteSelectedRecords() {
      const recordIds = Array.from(selectedRecordIds).filter(Boolean);
      if (!recordIds.length) {
        helpers.showToast?.('请先勾选要删除的账号记录。', 'warn', 1800);
        return;
      }

      const confirmed = await helpers.openConfirmModal({
        title: '删除选中记录',
        message: `确认删除选中的 ${recordIds.length} 条账号记录吗？该操作会同步更新本地 helper 快照。`,
        confirmLabel: '确认删除',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      const response = await runtime.sendMessage({
        type: 'DELETE_ACCOUNT_RUN_HISTORY_RECORDS',
        source: 'sidepanel',
        payload: {
          recordIds,
        },
      });
      if (response?.error) {
        throw new Error(response.error);
      }

      const existingRecords = getAccountRunRecords();
      const selectedIds = new Set(recordIds);
      const nextRecords = existingRecords.filter((record) => !selectedIds.has(buildRecordId(record)));

      resetSelection();
      state.syncLatestState({ accountRunHistory: nextRecords });
      helpers.showToast?.(`已删除 ${Math.max(0, Number(response?.deletedCount) || 0)} 条账号记录。`, 'success', 2200);
    }

    function setExportButtonsBusy(busy) {
      setNodeDisabled(dom.btnExportSuccessAccountRecords, busy);
      setNodeDisabled(dom.btnShowUpiCredentialBackups, busy);
      setNodeDisabled(dom.btnExportUpiCredentialBackups, busy);
      const membershipBusy = upiCredentialMembershipCheckBusy || upiCredentialMembershipRedeemBusy;
      setNodeDisabled(dom.btnCheckUpiCredentialMembershipLocal, busy || membershipBusy);
      setNodeDisabled(dom.btnImportUpiCredentialMembershipTxt, busy || membershipBusy);
      setNodeDisabled(dom.btnImportUpiCredentialMembershipFreeTxt, busy || membershipBusy);
      setNodeDisabled(dom.btnExportUpiRedeemSuccessRecords, busy);
      setNodeText(dom.btnExportUpiRedeemSuccessRecords, busy ? '查询中' : '导出已开通会员密码2FA');
      setNodeText(dom.btnShowUpiCredentialBackups, busy ? '读取中' : '查看全部已存密码2FA');
      setNodeText(dom.btnExportUpiCredentialBackups, busy ? '查询中' : '导出当前卡密成功密码2FA');
      setNodeText(dom.btnCheckUpiCredentialMembershipLocal, membershipBusy ? (upiCredentialMembershipRedeemBusy ? '补兑中' : '核验中') : '核验启用已存备份');
      setNodeText(dom.btnImportUpiCredentialMembershipTxt, membershipBusy ? (upiCredentialMembershipRedeemBusy ? '补兑中' : '核验中') : '导入备份TXT并核验');
      setNodeText(dom.btnImportUpiCredentialMembershipFreeTxt, membershipBusy ? (upiCredentialMembershipRedeemBusy ? '补兑中' : '核验中') : '导入无会员TXT');
      setNodeHidden(dom.btnStopUpiCredentialMembershipCheck, !upiCredentialMembershipCheckBusy);
    }

    function setUpiCredentialBackupPreviewText(content = '') {
      if (dom.upiCredentialBackupPreview) {
        dom.upiCredentialBackupPreview.value = String(content || '').trimEnd()
          || '暂无已保存的 UPI 密码 2FA 备份。';
      }
      setNodeHidden(dom.upiCredentialBackupPreviewWrap, !upiCredentialBackupPreviewVisible);
    }

    async function fetchUpiCredentialBackupExportPayload() {
      const response = await runtime.sendMessage({
        type: 'EXPORT_UPI_ACCOUNT_CREDENTIAL_BACKUPS',
        source: 'sidepanel',
        payload: {},
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      return response || {};
    }

    async function fetchUpiCredentialMembershipCredentialPool() {
      const response = await runtime.sendMessage({
        type: 'GET_UPI_CREDENTIAL_MEMBERSHIP_CREDENTIAL_POOL',
        source: 'sidepanel',
        payload: {},
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      return response?.pool || { items: [] };
    }

    async function refreshUpiCredentialMembershipCredentialPool(options = {}) {
      if (upiCredentialMembershipPoolLoading) {
        return upiCredentialMembershipPoolRows;
      }
      upiCredentialMembershipPoolLoading = true;
      try {
        const pool = await fetchUpiCredentialMembershipCredentialPool();
        setUpiCredentialMembershipPoolRows(pool?.items || [], 'local');
        upiCredentialMembershipPoolLoaded = true;
        renderUpiCredentialMembershipCheckResults();
        return upiCredentialMembershipPoolRows;
      } catch (error) {
        if (!options.silent) {
          helpers.showToast?.(`读取 UPI 备份账号核验池失败：${error.message}`, 'error');
        }
        return upiCredentialMembershipPoolRows;
      } finally {
        upiCredentialMembershipPoolLoading = false;
      }
    }

    function getEnabledUpiCredentialMembershipPoolRows() {
      return upiCredentialMembershipPoolRows
        .filter((item) => item?.email && !disabledUpiCredentialMembershipEmails.has(item.email))
        .map((item) => ({
          email: item.email,
          password: item.password,
          totpMfaSecret: item.totpMfaSecret,
        }));
    }

    function getEnabledFreeUpiCredentialMembershipRows() {
      const results = getUpiCredentialMembershipCheckResults();
      return buildUpiCredentialMembershipDisplayRows(results)
        .filter(isRedeemableFreeUpiCredentialMembershipRow)
        .map(buildUpiCredentialMembershipRedeemCredential)
        .filter((row) => row.email);
    }

    function buildUpiCredentialMembershipRedeemCredential(row = {}) {
      return {
        email: normalizeUpiCredentialMembershipEmail(row.email),
        password: normalizeUpiCredentialMembershipText(row.password),
        totpMfaSecret: normalizeUpiCredentialMembershipTotpSecret(row.totpMfaSecret),
      };
    }

    function getUpiCredentialMembershipSingleRedeemRow(email = '') {
      const normalizedEmail = normalizeUpiCredentialMembershipEmail(email);
      if (!normalizedEmail) {
        return null;
      }
      const results = getUpiCredentialMembershipCheckResults();
      return buildUpiCredentialMembershipDisplayRows(results)
        .find((row) => normalizeUpiCredentialMembershipEmail(row.email) === normalizedEmail) || null;
    }

    function getTrialEligibilityCheckableFreeUpiCredentialMembershipRows() {
      const results = getUpiCredentialMembershipCheckResults();
      return buildUpiCredentialMembershipDisplayRows(results)
        .filter(isTrialEligibilityCheckableFreeUpiCredentialMembershipRow)
        .map((row) => ({
          email: normalizeUpiCredentialMembershipEmail(row.email),
          password: normalizeUpiCredentialMembershipText(row.password),
          totpMfaSecret: normalizeUpiCredentialMembershipTotpSecret(row.totpMfaSecret),
        }))
        .filter((row) => row.email);
    }

    async function refreshRemoteRedeemStatusesForExport(records = []) {
      const cdkeys = getUpiRedeemSuccessExportCdkeys(records);
      if (!cdkeys.length) {
        return null;
      }
      const response = await runtime.sendMessage({
        type: 'REFRESH_UPI_REDEEM_CDKEY_STATUSES',
        source: 'sidepanel',
        payload: { cdkeys },
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      if (response?.updates) {
        state.syncLatestState(response.updates);
      }
      return response;
    }

    async function checkPaidSubscriptionStatusesForExport(records = [], options = {}) {
      const items = getUpiRedeemSuccessExportSubscriptionItems(records, options);
      if (!items.length) {
        return { items: [] };
      }
      const response = await runtime.sendMessage({
        type: 'CHECK_UPI_REDEEM_SUBSCRIPTION_STATUSES',
        source: 'sidepanel',
        payload: { items },
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      return response || { items: [] };
    }

    async function exportUpiRedeemSuccessEmailTextFile() {
      const candidateRecords = getAccountRunRecords();
      const candidateRows = buildUpiRedeemSuccessEmailExportRows(candidateRecords);
      if (!candidateRows.length) {
        const summary = summarizeUpiRedeemSuccessExportEligibility(candidateRecords, {
          usage: getUpiRedeemCdkeyUsage(),
        });
        helpers.showToast?.(buildUpiRedeemSuccessExportBlockedMessage(summary), 'warn', 2600);
        return;
      }
      if (typeof helpers.downloadTextFile !== 'function') {
        helpers.showToast?.('当前环境不支持导出 TXT。', 'error');
        return;
      }
      try {
        setExportButtonsBusy(true);
        await refreshRemoteRedeemStatusesForExport(candidateRecords);
        const latestRecords = getAccountRunRecords();
        const latestUsage = getUpiRedeemCdkeyUsage();
        const rows = buildUpiRedeemSuccessEmailExportRows(latestRecords, {
          usage: latestUsage,
          requireRemoteSuccess: true,
        });
        if (!rows.length) {
          const summary = summarizeUpiRedeemSuccessExportEligibility(latestRecords, {
            usage: latestUsage,
          });
          helpers.showToast?.(buildUpiRedeemSuccessExportBlockedMessage(summary), 'warn', 3200);
          return;
        }
        helpers.downloadTextFile(`${rows.join('\n')}\n`, buildUpiRedeemSuccessEmailExportFileName(), 'text/plain;charset=utf-8');
        helpers.showToast?.(`已按远端卡密状态导出 ${rows.length} 条兑换成功邮箱 2FA。`, 'success', 2200);
      } catch (error) {
        helpers.showToast?.(`导出前查询 UPI 兑换/会员状态失败：${error.message}`, 'error');
      } finally {
        setExportButtonsBusy(false);
        render();
      }
    }

    async function exportUpiCredentialBackupTextFile() {
      if (typeof helpers.downloadTextFile !== 'function') {
        helpers.showToast?.('当前环境不支持导出 TXT。', 'error');
        return;
      }
      try {
        setExportButtonsBusy(true);
        const response = await fetchUpiCredentialBackupExportPayload();
        if (!response?.fileContent || !response?.fileName) {
          helpers.showToast?.('没有已保存的 UPI 密码 2FA 备份。', 'warn', 2600);
          return;
        }
        helpers.downloadTextFile(response.fileContent, response.fileName, 'text/plain;charset=utf-8');
        helpers.showToast?.(`已导出 ${response.count || 0} 条已保存密码 2FA 备份。`, 'success', 2200);
      } catch (error) {
        helpers.showToast?.(`导出已保存密码 2FA 失败：${error.message}`, 'error');
      } finally {
        setExportButtonsBusy(false);
        render();
      }
    }

    async function showUpiCredentialBackupText() {
      try {
        setExportButtonsBusy(true);
        const response = await fetchUpiCredentialBackupExportPayload();
        upiCredentialBackupPreviewVisible = true;
        setUpiCredentialBackupPreviewText(response?.fileContent || '');
        setUpiCredentialMembershipPoolRows(parseUpiCredentialMembershipText(response?.fileContent || ''), 'local');
        upiCredentialMembershipPoolLoaded = true;
        if (!response?.fileContent) {
          helpers.showToast?.('没有已保存的 UPI 密码 2FA 备份。', 'warn', 2600);
          return;
        }
        helpers.showToast?.(`已显示 ${response.count || 0} 条已保存密码 2FA。`, 'success', 1800);
      } catch (error) {
        helpers.showToast?.(`读取已保存密码 2FA 失败：${error.message}`, 'error');
      } finally {
        setExportButtonsBusy(false);
        render();
      }
    }

    function getMembershipCheckSettingsPayload() {
      const latest = state.getLatestState();
      return {
        upiCredentialMembershipCheckTotpApiBaseUrl: String(
          dom.inputUpiCredentialMembershipTotpApiBaseUrl?.value
          || latest?.upiCredentialMembershipCheckTotpApiBaseUrl
          || 'https://cha.nerver.cc'
        ).trim(),
        upiCredentialMembershipCheckTotpLookupKey: String(
          dom.inputUpiCredentialMembershipTotpLookupKey?.value
          || latest?.upiCredentialMembershipCheckTotpLookupKey
          || ''
        ).trim(),
        upiRedeemExternalApiKey: String(
          dom.inputUpiRedeemExternalApiKey?.value
          || latest?.upiRedeemExternalApiKey
          || latest?.pixRedeemExternalApiKey
          || ''
        ).trim(),
        upiRedeemClientId: String(
          dom.inputUpiRedeemClientId?.value
          || latest?.upiRedeemClientId
          || latest?.pixRedeemClientId
          || ''
        ).trim(),
        upiRedeemCdkeyPoolText: String(
          dom.inputUpiRedeemCdkeyPool?.value
          ?? latest?.upiRedeemCdkeyPoolText
          ?? latest?.pixRedeemCdkeyPoolText
          ?? ''
        ).replace(/\r/g, '').trim(),
        upiRedeemCdkeyUsage: latest?.upiRedeemCdkeyUsage || latest?.pixRedeemCdkeyUsage || {},
      };
    }

    async function refreshUpiCredentialMembershipCheckResults() {
      const response = await runtime.sendMessage({
        type: 'GET_UPI_CREDENTIAL_MEMBERSHIP_CHECK_RESULTS',
        source: 'sidepanel',
        payload: {},
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      if (response?.results) {
        state.syncLatestState({
          upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
        });
        upiCredentialMembershipCheckBusy = response.results.running === true;
        upiCredentialMembershipRedeemBusy = response.results.redeeming === true;
      }
      return response?.results || null;
    }

    async function startUpiCredentialMembershipCheck(payload = {}) {
      try {
        upiCredentialMembershipCheckBusy = true;
        setExportButtonsBusy(false);
        const response = await runtime.sendMessage({
          type: 'CHECK_UPI_CREDENTIAL_MEMBERSHIP_BATCH',
          source: 'sidepanel',
          payload: {
            ...payload,
            settings: getMembershipCheckSettingsPayload(),
          },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        const results = response?.results || getUpiCredentialMembershipCheckResults();
        helpers.showToast?.(`核验完成：有会员 ${results.paidCount || 0}，无会员 ${results.freeCount || 0}，失败 ${results.failedCount || 0}。`, 'success', 2600);
      } catch (error) {
        helpers.showToast?.(`UPI 备份账号会员核验失败：${error.message}`, 'error');
      } finally {
        upiCredentialMembershipCheckBusy = false;
        await refreshUpiCredentialMembershipCheckResults().catch(() => null);
        setExportButtonsBusy(false);
        render();
      }
    }

    async function startLocalUpiCredentialMembershipCheck() {
      await refreshUpiCredentialMembershipCredentialPool({ silent: true });
      const credentials = getEnabledUpiCredentialMembershipPoolRows();
      if (!credentials.length) {
        helpers.showToast?.('没有启用的 UPI 备份账号可核验。', 'warn', 2000);
        return;
      }
      await startUpiCredentialMembershipCheck({ source: 'local-selected', credentials });
    }

    async function readTextFile(file) {
      if (!file) return '';
      if (typeof file.text === 'function') {
        return await file.text();
      }
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取 TXT 文件失败。'));
        reader.readAsText(file, 'utf-8');
      });
    }

    async function importUpiCredentialMembershipFreeText(text = '') {
      const credentials = parseUpiCredentialMembershipText(text);
      setUpiCredentialMembershipPoolRows(credentials, 'txt-free');
      upiCredentialMembershipPoolLoaded = true;
      const response = await runtime.sendMessage({
        type: 'IMPORT_UPI_CREDENTIAL_MEMBERSHIP_FREE_RESULTS',
        source: 'sidepanel',
        payload: {
          source: 'txt-free',
          text,
        },
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      const results = response?.results || {
        items: credentials.map((credential) => ({
          ...credential,
          status: 'free',
          planType: 'free',
          reason: '待补兑',
        })),
        source: 'txt-free',
      };
      state.syncLatestState({ upiCredentialMembershipCheckResults: results });
      disabledUpiCredentialMembershipEmails.clear();
      renderUpiCredentialMembershipCheckResults();
      return {
        results,
        importedCount: credentials.length,
      };
    }

    function openUpiCredentialMembershipTxtImport(mode = 'check') {
      if (dom.inputUpiCredentialMembershipTxt?.dataset) {
        dom.inputUpiCredentialMembershipTxt.dataset.membershipImportMode = mode === 'free' ? 'free' : 'check';
      }
      dom.inputUpiCredentialMembershipTxt?.click?.();
    }

    async function handleUpiCredentialMembershipTxtSelected(event) {
      const file = event?.target?.files?.[0] || null;
      const importMode = String(event?.target?.dataset?.membershipImportMode || 'check').trim().toLowerCase();
      if (event?.target) {
        event.target.value = '';
        event.target.dataset.membershipImportMode = 'check';
      }
      if (!file) return;
      try {
        const text = await readTextFile(file);
        if (!text.trim()) {
          helpers.showToast?.('导入的 TXT 为空。', 'warn', 1800);
          return;
        }
        const credentials = parseUpiCredentialMembershipText(text);
        setUpiCredentialMembershipPoolRows(credentials, 'txt');
        upiCredentialMembershipPoolLoaded = true;
        renderUpiCredentialMembershipCheckResults();
        if (importMode === 'free') {
          const importResult = await importUpiCredentialMembershipFreeText(text);
          helpers.showToast?.(`已按无会员去重导入 ${importResult.importedCount || 0} 条账号，可直接点击“兑换启用无会员”。`, 'success', 2200);
          return;
        }
        await startUpiCredentialMembershipCheck({ source: 'txt', text });
      } catch (error) {
        helpers.showToast?.(`读取备份 TXT 失败：${error.message}`, 'error');
      }
    }

    async function stopUpiCredentialMembershipCheck() {
      try {
        const response = await runtime.sendMessage({
          type: 'STOP_UPI_CREDENTIAL_MEMBERSHIP_CHECK',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        upiCredentialMembershipCheckBusy = false;
        helpers.showToast?.('已停止 UPI 备份账号会员核验。', 'warn', 1800);
      } catch (error) {
        helpers.showToast?.(`停止核验失败：${error.message}`, 'error');
      } finally {
        setExportButtonsBusy(false);
        render();
      }
    }

    async function startUpiCredentialMembershipFreeRedeem(inputCredentials = null, options = {}) {
      const credentials = Array.isArray(inputCredentials)
        ? inputCredentials
        : getEnabledFreeUpiCredentialMembershipRows();
      const singleEmail = normalizeUpiCredentialMembershipEmail(options.singleEmail || '');
      if (!credentials.length) {
        helpers.showToast?.(singleEmail ? `${singleEmail} 当前不可补兑。` : '没有启用的无会员账号可补兑。', 'warn', 2000);
        return;
      }
      try {
        upiCredentialMembershipRedeemBusy = true;
        setExportButtonsBusy(false);
        const response = await runtime.sendMessage({
          type: 'REDEEM_UPI_CREDENTIAL_MEMBERSHIP_FREE',
          source: 'sidepanel',
          payload: {
            source: options.source || (singleEmail ? 'free-single' : 'free-selected'),
            credentials,
            deleteBackups: upiCredentialMembershipPoolSource !== 'txt' && upiCredentialMembershipPoolSource !== 'txt-free',
            settings: getMembershipCheckSettingsPayload(),
          },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        const results = response?.results || getUpiCredentialMembershipCheckResults();
        const autoDeletedEmails = (Array.isArray(results.redeemAutoDeletedEmails) ? results.redeemAutoDeletedEmails : [])
          .map(normalizeUpiCredentialMembershipEmail)
          .filter(Boolean);
        if (autoDeletedEmails.length) {
          const deletedSet = new Set(autoDeletedEmails);
          setUpiCredentialMembershipPoolRows(
            upiCredentialMembershipPoolRows.filter((item) => !deletedSet.has(normalizeUpiCredentialMembershipEmail(item.email))),
            upiCredentialMembershipPoolSource
          );
          autoDeletedEmails.forEach((email) => disabledUpiCredentialMembershipEmails.delete(email));
        }
        const summaryText = `有会员 ${results.paidCount || 0}，无会员 ${results.freeCount || 0}，失败 ${results.failedCount || 0}，失败三次删除 ${autoDeletedEmails.length}`;
        if (results.redeemStoppedAt) {
          const stoppedEmail = normalizeUpiCredentialMembershipEmail(results.flowStageEmail || singleEmail);
          const stoppedItem = (Array.isArray(results.items) ? results.items : [])
            .find((item) => normalizeUpiCredentialMembershipEmail(item?.email) === stoppedEmail) || null;
          const stoppedReason = String(stoppedItem?.redeemReason || stoppedItem?.reason || '').trim();
          helpers.showToast?.(
            `${stoppedEmail || singleEmail || 'UPI 无会员补兑'} 已停止：${stoppedReason || summaryText}。`,
            'warn',
            5000
          );
        } else {
          helpers.showToast?.(singleEmail ? `${singleEmail} 补兑完成：${summaryText}。` : `补兑完成：${summaryText}。`, 'success', 3000);
        }
      } catch (error) {
        helpers.showToast?.(singleEmail ? `${singleEmail} 补兑失败：${error.message}` : `UPI 无会员账号补兑失败：${error.message}`, 'error');
      } finally {
        upiCredentialMembershipRedeemBusy = false;
        await refreshUpiCredentialMembershipCheckResults().catch(() => null);
        setExportButtonsBusy(false);
        render();
      }
    }

    async function startSingleUpiCredentialMembershipFreeRedeem(email = '') {
      const normalizedEmail = normalizeUpiCredentialMembershipEmail(email);
      if (!normalizedEmail || upiCredentialMembershipRedeemBusy || upiCredentialMembershipCheckBusy) {
        return;
      }
      const row = getUpiCredentialMembershipSingleRedeemRow(normalizedEmail);
      if (!row) {
        helpers.showToast?.(`未找到账号 ${normalizedEmail}`, 'warn', 1800);
        return;
      }
      if (!isRedeemableFreeUpiCredentialMembershipRow(row)) {
        const reason = getNotRedeemableFreeUpiCredentialMembershipReason(row);
        helpers.showToast?.(`${normalizedEmail} ${reason}。`, 'warn', 2200);
        return;
      }
      const credential = buildUpiCredentialMembershipRedeemCredential(row);
      if (!credential.password || !credential.totpMfaSecret) {
        helpers.showToast?.(`账号 ${normalizedEmail} 缺少密码或 2FA，无法补兑。`, 'error');
        return;
      }
      await startUpiCredentialMembershipFreeRedeem([credential], {
        singleEmail: normalizedEmail,
        source: 'free-click',
      });
    }

    async function pruneIneligibleFreeUpiCredentialMembershipRows() {
      const credentials = getTrialEligibilityCheckableFreeUpiCredentialMembershipRows();
      if (!credentials.length) {
        helpers.showToast?.('Free 分组没有可检测试用资格的账号。', 'warn', 2000);
        return;
      }
      try {
        upiCredentialMembershipCheckBusy = true;
        setExportButtonsBusy(false);
        const response = await runtime.sendMessage({
          type: 'PRUNE_INELIGIBLE_UPI_CREDENTIAL_MEMBERSHIP_FREE',
          source: 'sidepanel',
          payload: {
            source: 'free-trial-eligibility',
            credentials,
            deleteBackups: upiCredentialMembershipPoolSource !== 'txt' && upiCredentialMembershipPoolSource !== 'txt-free',
            settings: getMembershipCheckSettingsPayload(),
          },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        const deletedEmails = (Array.isArray(response?.deletedEmails) ? response.deletedEmails : [])
          .map(normalizeUpiCredentialMembershipEmail)
          .filter(Boolean);
        if (deletedEmails.length) {
          const deletedSet = new Set(deletedEmails);
          setUpiCredentialMembershipPoolRows(
            upiCredentialMembershipPoolRows.filter((item) => !deletedSet.has(normalizeUpiCredentialMembershipEmail(item.email))),
            upiCredentialMembershipPoolSource
          );
          deletedEmails.forEach((email) => disabledUpiCredentialMembershipEmails.delete(email));
        }
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        helpers.showToast?.(
          `试用资格检测完成：有资格 ${response?.kept?.length || 0}，自动删除无资格 ${deletedEmails.length}，失败 ${response?.failed?.length || 0}。`,
          'success',
          2800
        );
      } catch (error) {
        helpers.showToast?.(`Free 分组试用资格检测失败：${error.message}`, 'error');
      } finally {
        upiCredentialMembershipCheckBusy = false;
        await refreshUpiCredentialMembershipCheckResults().catch(() => null);
        setExportButtonsBusy(false);
        render();
      }
    }

    async function stopUpiCredentialMembershipRedeem() {
      try {
        const response = await runtime.sendMessage({
          type: 'STOP_UPI_CREDENTIAL_MEMBERSHIP_REDEEM',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        upiCredentialMembershipRedeemBusy = false;
        helpers.showToast?.('已停止 UPI 无会员账号补兑。', 'warn', 1800);
      } catch (error) {
        helpers.showToast?.(`停止补兑失败：${error.message}`, 'error');
      } finally {
        setExportButtonsBusy(false);
        render();
      }
    }

    async function exportUpiCredentialMembershipCheckResultTextFile(status = 'paid') {
      if (typeof helpers.downloadTextFile !== 'function') {
        helpers.showToast?.('当前环境不支持导出 TXT。', 'error');
        return;
      }
      try {
        const removeAfterExport = String(status || '').trim().toLowerCase() === 'paid';
        const response = await runtime.sendMessage({
          type: 'EXPORT_UPI_CREDENTIAL_MEMBERSHIP_CHECK_RESULTS',
          source: 'sidepanel',
          payload: { status, removeAfterExport },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        if (!response?.fileContent || !response?.fileName) {
          helpers.showToast?.(`${getMembershipStatusTitle(status)} 分组没有可导出的记录。`, 'warn', 1800);
          return;
        }
        helpers.downloadTextFile(response.fileContent, response.fileName, 'text/plain;charset=utf-8');
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        helpers.showToast?.(
          removeAfterExport
            ? `已导出 ${response.count || 0} 条${getMembershipStatusTitle(status)}记录，并从 Plus 分组移除这一批。`
            : `已导出 ${response.count || 0} 条${getMembershipStatusTitle(status)}记录。`,
          'success',
          2200
        );
        render();
      } catch (error) {
        helpers.showToast?.(`导出核验结果失败：${error.message}`, 'error');
      }
    }

    async function deleteUpiCredentialMembershipResultGroup(status = 'paid') {
      const normalizedStatus = String(status || '').trim().toLowerCase() || 'paid';
      const results = getUpiCredentialMembershipCheckResults();
      const count = results.items.filter((item) => String(item?.status || '').trim().toLowerCase() === normalizedStatus).length;
      if (!count) {
        helpers.showToast?.(`${getMembershipStatusTitle(normalizedStatus)} 分组没有可删除的记录。`, 'warn', 1800);
        return;
      }

      const confirmed = typeof helpers.openConfirmModal === 'function'
        ? await helpers.openConfirmModal({
          title: `删除${getMembershipStatusTitle(normalizedStatus)}分组`,
          message: `确认从当前核验结果中删除 ${count} 条${getMembershipStatusTitle(normalizedStatus)}记录吗？该操作只清理当前结果列表，不删除本地密码/2FA 备份。`,
          confirmLabel: '确认删除',
          confirmVariant: 'btn-danger',
        })
        : true;
      if (!confirmed) {
        return;
      }

      try {
        const response = await runtime.sendMessage({
          type: 'DELETE_UPI_CREDENTIAL_MEMBERSHIP_CHECK_RESULTS',
          source: 'sidepanel',
          payload: { status: normalizedStatus },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        helpers.showToast?.(`已删除 ${response?.deletedCount || 0} 条${getMembershipStatusTitle(normalizedStatus)}分组记录。`, 'success', 1800);
      } catch (error) {
        helpers.showToast?.(`删除${getMembershipStatusTitle(normalizedStatus)}分组失败：${error.message}`, 'error');
      } finally {
        render();
      }
    }

    async function deleteUpiCredentialMembershipCredential(email = '') {
      const normalizedEmail = normalizeUpiCredentialMembershipEmail(email);
      if (!normalizedEmail) {
        return;
      }
      const deleteBackups = upiCredentialMembershipPoolSource !== 'txt';
      try {
        const response = await runtime.sendMessage({
          type: 'DELETE_UPI_CREDENTIAL_MEMBERSHIP_CREDENTIALS',
          source: 'sidepanel',
          payload: {
            emails: [normalizedEmail],
            deleteBackups,
          },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        disabledUpiCredentialMembershipEmails.delete(normalizedEmail);
        setUpiCredentialMembershipPoolRows(
          upiCredentialMembershipPoolRows.filter((item) => item.email !== normalizedEmail),
          upiCredentialMembershipPoolSource
        );
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        helpers.showToast?.(
          deleteBackups ? `已从本地备份核验池删除 ${normalizedEmail}` : `已从当前核验池删除 ${normalizedEmail}`,
          'success',
          1800
        );
      } catch (error) {
        helpers.showToast?.(`删除 UPI 核验账号失败：${error.message}`, 'error');
      } finally {
        render();
      }
    }

    function getUpiCredentialMembershipDisplayRowByEmail(email = '') {
      const targetEmail = normalizeUpiCredentialMembershipEmail(email);
      if (!targetEmail) {
        return null;
      }
      return buildUpiCredentialMembershipDisplayRows()
        .find((row) => normalizeUpiCredentialMembershipEmail(row.email) === targetEmail) || null;
    }

    function mergeUpiCredentialMembershipResultItem(item = {}) {
      const email = normalizeUpiCredentialMembershipEmail(item?.email);
      if (!email) {
        return;
      }
      const currentResults = getUpiCredentialMembershipCheckResults();
      const items = Array.isArray(currentResults.items) ? [...currentResults.items] : [];
      const index = items.findIndex((row) => normalizeUpiCredentialMembershipEmail(row?.email) === email);
      const itemStatus = String(item.status || '').trim().toLowerCase();
      const nextItem = {
        ...(index >= 0 ? items[index] : {}),
        ...item,
        email,
      };
      if (itemStatus === 'free') {
        nextItem.membershipOverrideStatus = 'free';
        nextItem.membershipOverrideCheckedAt = item.checkedAt || new Date().toISOString();
        if (['success', 'skipped'].includes(String(nextItem.redeemStatus || '').trim().toLowerCase())) {
          nextItem.redeemStatus = '';
          nextItem.redeemReason = '';
        }
      } else if (itemStatus === 'paid') {
        delete nextItem.membershipOverrideStatus;
        delete nextItem.membershipOverrideCheckedAt;
      }
      if (index >= 0) {
        items[index] = nextItem;
      } else {
        items.push(nextItem);
      }
      state.syncLatestState({
        upiCredentialMembershipCheckResults: {
          ...currentResults,
          items,
          running: false,
          updatedAt: new Date().toISOString(),
          flowStage: '',
          flowStageEmail: '',
          total: Math.max(Number(currentResults.total) || 0, items.length),
          completed: Math.max(Number(currentResults.completed) || 0, items.length),
        },
      });
    }

    async function checkOneUpiCredentialMembership(email = '') {
      const normalizedEmail = normalizeUpiCredentialMembershipEmail(email);
      if (!normalizedEmail || upiCredentialMembershipCheckingEmail) {
        return;
      }
      const row = getUpiCredentialMembershipDisplayRowByEmail(normalizedEmail);
      if (!row) {
        helpers.showToast?.(`未找到账号 ${normalizedEmail}`, 'warn', 1800);
        return;
      }
      if (!row.password || !row.totpMfaSecret) {
        helpers.showToast?.(`账号 ${normalizedEmail} 缺少密码或 2FA，无法检测。`, 'error');
        return;
      }
      upiCredentialMembershipCheckingEmail = normalizedEmail;
      render();
      try {
        const response = await runtime.sendMessage({
          type: 'CHECK_UPI_CREDENTIAL_MEMBERSHIP_ONE',
          source: 'sidepanel',
          payload: {
            email: normalizedEmail,
            source: row.source || upiCredentialMembershipPoolSource || 'single',
            credential: {
              email: normalizedEmail,
              password: row.password,
              totpMfaSecret: row.totpMfaSecret,
            },
          },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        if (response?.results) {
          state.syncLatestState({
            upiCredentialMembershipCheckResults: mergeManualFreeMembershipOverridesIntoResults(response.results),
          });
        }
        const item = response?.item || {};
        mergeUpiCredentialMembershipResultItem(item);
        const status = String(item.status || '').trim().toLowerCase();
        if (status === 'paid') {
          helpers.showToast?.(`${normalizedEmail} 已开通 ${getMembershipPlanLabel(item.planType)}。`, 'success', 2200);
        } else if (status === 'free') {
          helpers.showToast?.(`${normalizedEmail} 当前无会员。`, 'warn', 2200);
        } else {
          helpers.showToast?.(`${normalizedEmail} 检测失败：${item.reason || '未知错误'}`, 'error');
        }
      } catch (error) {
        helpers.showToast?.(`检测 ${normalizedEmail} 失败：${error.message}`, 'error');
      } finally {
        upiCredentialMembershipCheckingEmail = '';
        render();
      }
    }

    function handleStatsClick(event) {
      const filterNode = findClosest(event?.target, '[data-account-record-filter]');
      if (!filterNode) {
        return;
      }

      const nextFilter = getDatasetValue(filterNode, 'data-account-record-filter');
      if (!FILTER_CONFIG[nextFilter]) {
        return;
      }

      activeFilter = activeFilter === nextFilter && nextFilter !== 'all'
        ? 'all'
        : nextFilter;
      currentPage = 1;
      render();
    }

    function handleRecordListClick(event) {
      if (!selectionMode) {
        return;
      }

      const toggleNode = findClosest(event?.target, '[data-account-record-toggle]');
      if (toggleNode) {
        const recordId = getDatasetValue(toggleNode, 'data-account-record-toggle');
        const explicitChecked = typeof event?.target?.checked === 'boolean' ? event.target.checked : null;
        toggleRecordSelection(recordId, explicitChecked);
        render();
        return;
      }

      const recordNode = findClosest(event?.target, '[data-account-record-id]');
      if (!recordNode) {
        return;
      }

      toggleRecordSelection(getDatasetValue(recordNode, 'data-account-record-id'));
      render();
    }

    function handleUpiCredentialMembershipCheckResultsClick(event) {
      const groupNode = findClosest(event?.target, '[data-upi-membership-group]');
      if (groupNode) {
        const nextGroup = getDatasetValue(groupNode, 'data-upi-membership-group') === 'paid' ? 'paid' : 'free';
        if (upiCredentialMembershipGroup !== nextGroup) {
          upiCredentialMembershipGroup = nextGroup;
          renderUpiCredentialMembershipCheckResults();
        }
        return;
      }

      const checkOneNode = findClosest(event?.target, '[data-upi-membership-check-one]');
      if (checkOneNode) {
        const email = getDatasetValue(checkOneNode, 'data-upi-membership-check-one');
        if (upiCredentialMembershipGroup === 'free') {
          startSingleUpiCredentialMembershipFreeRedeem(email);
        } else {
          checkOneUpiCredentialMembership(email);
        }
        return;
      }

      const exportNode = findClosest(event?.target, '[data-upi-membership-export]');
      if (exportNode) {
        exportUpiCredentialMembershipCheckResultTextFile(getDatasetValue(exportNode, 'data-upi-membership-export'));
        return;
      }

      const deleteGroupNode = findClosest(event?.target, '[data-upi-membership-delete-group]');
      if (deleteGroupNode) {
        deleteUpiCredentialMembershipResultGroup(getDatasetValue(deleteGroupNode, 'data-upi-membership-delete-group'));
        return;
      }

      const redeemFreeNode = findClosest(event?.target, '[data-upi-membership-redeem-free]');
      if (redeemFreeNode) {
        startUpiCredentialMembershipFreeRedeem();
        return;
      }

      const importFreeNode = findClosest(event?.target, '[data-upi-membership-import-free]');
      if (importFreeNode) {
        openUpiCredentialMembershipTxtImport('free');
        return;
      }

      const pruneIneligibleFreeNode = findClosest(event?.target, '[data-upi-membership-prune-ineligible-free]');
      if (pruneIneligibleFreeNode) {
        pruneIneligibleFreeUpiCredentialMembershipRows();
        return;
      }

      const stopRedeemNode = findClosest(event?.target, '[data-upi-membership-stop-redeem]');
      if (stopRedeemNode) {
        stopUpiCredentialMembershipRedeem();
        return;
      }

      const deleteNode = findClosest(event?.target, '[data-upi-membership-delete]');
      if (deleteNode) {
        deleteUpiCredentialMembershipCredential(getDatasetValue(deleteNode, 'data-upi-membership-delete'));
      }
    }

    function handleUpiCredentialMembershipCheckResultsChange(event) {
      const toggleNode = findClosest(event?.target, '[data-upi-membership-toggle]');
      if (!toggleNode) {
        return;
      }
      const email = normalizeUpiCredentialMembershipEmail(getDatasetValue(toggleNode, 'data-upi-membership-toggle'));
      if (!email) {
        return;
      }
      const checked = event?.target?.checked !== false;
      if (checked) {
        disabledUpiCredentialMembershipEmails.delete(email);
      } else {
        disabledUpiCredentialMembershipEmails.add(email);
      }
      renderUpiCredentialMembershipCheckResults();
    }

    function bindEvents() {
      if (eventsBound) {
        return;
      }
      eventsBound = true;

      dom.btnOpenAccountRecords?.addEventListener('click', () => {
        openPanel();
      });
      dom.btnCloseAccountRecords?.addEventListener('click', () => {
        closePanel();
      });
      dom.accountRecordsOverlay?.addEventListener('click', (event) => {
        if (event.target === dom.accountRecordsOverlay) {
          closePanel();
        }
      });
      dom.accountRecordsStats?.addEventListener('click', (event) => {
        handleStatsClick(event);
      });
      dom.accountRecordsList?.addEventListener('click', (event) => {
        handleRecordListClick(event);
      });
      dom.btnAccountRecordsPrev?.addEventListener('click', () => {
        if (currentPage <= 1) {
          return;
        }
        currentPage -= 1;
        render();
      });
      dom.btnAccountRecordsNext?.addEventListener('click', () => {
        currentPage += 1;
        render();
      });
      dom.btnToggleAccountRecordsSelection?.addEventListener('click', () => {
        toggleSelectionMode();
      });
      dom.btnDeleteSelectedAccountRecords?.addEventListener('click', async () => {
        try {
          await deleteSelectedRecords();
        } catch (error) {
          helpers.showToast?.(`删除账号记录失败：${error.message}`, 'error');
        }
      });
      dom.btnExportSuccessAccountRecords?.addEventListener('click', () => {
        exportUpiRedeemSuccessEmailTextFile();
      });
      dom.btnShowUpiCredentialBackups?.addEventListener('click', () => {
        showUpiCredentialBackupText();
      });
      dom.btnExportUpiCredentialBackups?.addEventListener('click', async () => {
        await exportUpiRedeemSuccessEmailTextFile();
      });
      dom.btnCheckUpiCredentialMembershipLocal?.addEventListener('click', () => {
        startLocalUpiCredentialMembershipCheck();
      });
      dom.btnImportUpiCredentialMembershipTxt?.addEventListener('click', () => {
        openUpiCredentialMembershipTxtImport('check');
      });
      dom.btnImportUpiCredentialMembershipFreeTxt?.addEventListener('click', () => {
        openUpiCredentialMembershipTxtImport('free');
      });
      dom.inputUpiCredentialMembershipTxt?.addEventListener('change', (event) => {
        handleUpiCredentialMembershipTxtSelected(event);
      });
      dom.btnStopUpiCredentialMembershipCheck?.addEventListener('click', () => {
        stopUpiCredentialMembershipCheck();
      });
      dom.upiCredentialMembershipCheckResults?.addEventListener('click', (event) => {
        handleUpiCredentialMembershipCheckResultsClick(event);
      });
      dom.upiCredentialMembershipCheckResults?.addEventListener('change', (event) => {
        handleUpiCredentialMembershipCheckResultsChange(event);
      });
      dom.btnExportUpiRedeemSuccessRecords?.addEventListener('click', () => {
        exportUpiRedeemSuccessEmailTextFile();
      });
      dom.btnClearAccountRecords?.addEventListener('click', async () => {
        try {
          await clearRecords();
        } catch (error) {
          helpers.showToast?.(`清理账号记录失败：${error.message}`, 'error');
        }
      });
    }

    function reset() {
      currentPage = 1;
      activeFilter = 'all';
      selectionMode = false;
      resetSelection();
      closePanel();
      render();
    }

    return {
      bindEvents,
      clearRecords,
      closePanel,
      deleteSelectedRecords,
      exportUpiCredentialBackupTextFile,
      exportUpiRedeemSuccessEmailTextFile,
      openPanel,
      render,
      reset,
      setSelectionMode,
      showUpiCredentialBackupText,
      summarizeAccountRunHistory,
      toggleSelectionMode,
    };
  }

  globalScope.SidepanelAccountRecordsManager = {
    createAccountRecordsManager,
  };
})(typeof window !== 'undefined' ? window : globalThis);
