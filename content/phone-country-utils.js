(function attachPhoneCountryUtils(root, factory) {
  root.MultiPagePhoneCountryUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createPhoneCountryUtils() {
  const KNOWN_DIAL_CODES = Object.freeze([
    '1246', '1264', '1268', '1284', '1340', '1345', '1441', '1473', '1649', '1664', '1670', '1671', '1684',
    '1721', '1758', '1767', '1784', '1809', '1829', '1849', '1868', '1869', '1876',
    '971', '962', '886', '880', '856', '855', '852', '853', '683', '678', '673', '672', '670', '599', '598', '597', '596',
    '595', '594', '593', '592', '591', '590', '509', '508', '507', '506', '505', '504', '503', '502', '501', '500',
    '423', '421', '420', '389', '387', '386', '385', '383', '382', '381', '380', '379', '378', '377', '376',
    '375', '374', '373', '372', '371', '370', '359', '358', '357', '356', '355', '354', '353', '352', '351',
    '350', '299', '298', '297', '291', '290', '269', '268', '267', '266', '265', '264', '263', '262', '261',
    '260', '258', '257', '256', '255', '254', '253', '252', '251', '250', '249', '248', '247', '246', '245',
    '244', '243', '242', '241', '240', '239', '238', '237', '236', '235', '234', '233', '232', '231', '230',
    '229', '228', '227', '226', '225', '224', '223', '222', '221', '220', '218', '216', '213', '212', '211',
    '98', '95', '94', '93', '92', '91', '90', '89', '88', '86', '84', '82', '81', '66', '65', '64', '63',
    '62', '61', '60', '58', '57', '56', '55', '54', '53', '52', '51', '49', '48', '47', '46', '45', '44',
    '43', '41', '40', '39', '36', '34', '33', '32', '31', '30', '27', '20', '7', '1',
  ]);

  function normalizePhoneDigits(value) {
    let digits = String(value || '').replace(/\D+/g, '');
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }
    return digits;
  }

  function extractDialCodeFromText(value) {
    const match = String(value || '').match(/\(\+\s*(\d{1,4})\s*\)|\+\s*\(\s*(\d{1,4})\s*\)|\+\s*(\d{1,4})\b/);
    return String(match?.[1] || match?.[2] || match?.[3] || '').trim();
  }

  function normalizeCountryLabel(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeCountryOptionValue(value) {
    return String(value || '').trim().toUpperCase();
  }

  function getCountryLabelAliases(value) {
    const aliases = new Set();
    const addAlias = (alias) => {
      const normalized = normalizeCountryLabel(alias);
      if (normalized) {
        aliases.add(normalized);
      }
    };

    const raw = String(value || '').trim();
    addAlias(raw);
    Array.from(raw.matchAll(/\(([^()]+)\)/g))
      .map((match) => match[1])
      .forEach(addAlias);
    const withoutParentheses = raw.replace(/\([^()]*\)/g, ' ');
    const withoutDialCodes = withoutParentheses
      .replace(/\+\s*\d{1,4}\b/g, ' ')
      .replace(/\(\s*\+\s*\d{1,4}\s*\)/g, ' ');
    addAlias(withoutDialCodes);

    const normalized = normalizeCountryLabel(raw);
    const compact = normalized.replace(/\s+/g, '');
    if (
      /(?:^|\s)(?:gb|uk)(?:\s|$)/i.test(raw)
      || /england|united\s*kingdom|great\s*britain|\bbritain\b/i.test(raw)
      || /英国|英格兰|大不列颠/.test(raw)
      || ['gb', 'uk', 'england', 'unitedkingdom', 'greatbritain', 'britain'].includes(compact)
    ) {
      [
        'GB',
        'UK',
        'United Kingdom',
        'Great Britain',
        'Britain',
        'England',
        '英国',
        '英格兰',
        '大不列颠',
      ].forEach(addAlias);
    }

    return Array.from(aliases);
  }

  function isLooseCountryLabelMatch(optionLabel, targetLabel) {
    if (!optionLabel || !targetLabel || optionLabel.length <= 2 || targetLabel.length <= 2) {
      return false;
    }
    if (optionLabel.includes(targetLabel)) {
      return true;
    }
    return /\s/.test(optionLabel) && targetLabel.includes(optionLabel);
  }

  function getRegionDisplayName(regionCode, locale) {
    const normalizedRegionCode = normalizeCountryOptionValue(regionCode);
    const normalizedLocale = String(locale || '').trim();
    if (!/^[A-Z]{2}$/.test(normalizedRegionCode) || !normalizedLocale || typeof Intl?.DisplayNames !== 'function') {
      return '';
    }
    try {
      return String(
        new Intl.DisplayNames([normalizedLocale], { type: 'region' }).of(normalizedRegionCode) || ''
      ).trim();
    } catch {
      return '';
    }
  }

  function getOptionLabel(option) {
    return String(option?.textContent || option?.label || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getOptionMatchLabels(option, options = {}) {
    const labels = new Set();
    const pushLabel = (value) => {
      const label = String(value || '').replace(/\s+/g, ' ').trim();
      if (label) {
        labels.add(label);
      }
    };

    const getLabel = typeof options.getOptionLabel === 'function'
      ? options.getOptionLabel
      : getOptionLabel;
    pushLabel(getLabel(option));

    const regionCode = normalizeCountryOptionValue(option?.value);
    if (/^[A-Z]{2}$/.test(regionCode)) {
      pushLabel(regionCode);
      pushLabel(getRegionDisplayName(regionCode, 'en'));

      const pageLocale = String(
        options.pageLocale
        || options.document?.documentElement?.lang
        || options.document?.documentElement?.getAttribute?.('lang')
        || options.navigator?.language
        || ''
      ).trim();
      if (pageLocale && !/^en(?:[-_]|$)/i.test(pageLocale)) {
        pushLabel(getRegionDisplayName(regionCode, pageLocale));
      }
    }

    return Array.from(labels);
  }

  function resolveDialCodeFromPhoneNumber(phoneNumber = '', texts = []) {
    const digits = normalizePhoneDigits(phoneNumber);
    if (!digits) {
      return '';
    }

    const textDialCodes = texts
      .map((text) => normalizePhoneDigits(extractDialCodeFromText(text)))
      .filter((dialCode) => dialCode && digits.startsWith(dialCode) && digits.length > dialCode.length)
      .sort((left, right) => right.length - left.length);
    if (textDialCodes[0]) {
      return textDialCodes[0];
    }

    return KNOWN_DIAL_CODES.find((code) => digits.startsWith(code) && digits.length > code.length) || '';
  }

  function findOptionByCountryLabel(options, countryLabel, config = {}) {
    const source = Array.from(options || []);
    const normalizedTargets = getCountryLabelAliases(countryLabel);
    if (source.length === 0 || normalizedTargets.length === 0) {
      return null;
    }

    return source.find((option) => (
      getOptionMatchLabels(option, config).some((label) => normalizedTargets.includes(normalizeCountryLabel(label)))
    ))
      || source.find((option) => {
        const normalizedLabels = getOptionMatchLabels(option, config)
          .map((label) => normalizeCountryLabel(label))
          .filter(Boolean);
        return normalizedLabels.some((optionLabel) => normalizedTargets.some((normalizedTarget) => (
          isLooseCountryLabelMatch(optionLabel, normalizedTarget)
        )));
      })
      || null;
  }

  function findOptionByPhoneNumber(options, phoneNumber, config = {}) {
    const source = Array.from(options || []);
    const digits = normalizePhoneDigits(phoneNumber);
    if (source.length === 0 || !digits) {
      return null;
    }

    const getLabel = typeof config.getOptionLabel === 'function'
      ? config.getOptionLabel
      : getOptionLabel;
    let bestMatch = null;
    let bestDialCodeLength = 0;
    for (const option of source) {
      const dialCode = normalizePhoneDigits(extractDialCodeFromText(getLabel(option)));
      if (!dialCode || !digits.startsWith(dialCode) || dialCode.length <= bestDialCodeLength) {
        continue;
      }
      bestMatch = option;
      bestDialCodeLength = dialCode.length;
    }
    return bestMatch;
  }

  function findElementByDialCode(elements, phoneNumber, config = {}) {
    const source = Array.from(elements || []);
    const digits = normalizePhoneDigits(phoneNumber);
    if (source.length === 0 || !digits) {
      return null;
    }

    const getText = typeof config.getText === 'function' ? config.getText : getOptionLabel;
    let bestMatch = null;
    let bestDialCodeLength = 0;
    for (const element of source) {
      const dialCode = normalizePhoneDigits(extractDialCodeFromText(getText(element)));
      if (!dialCode || !digits.startsWith(dialCode) || dialCode.length <= bestDialCodeLength) {
        continue;
      }
      bestMatch = element;
      bestDialCodeLength = dialCode.length;
    }
    return bestMatch;
  }

  return {
    extractDialCodeFromText,
    findElementByDialCode,
    findOptionByCountryLabel,
    findOptionByPhoneNumber,
    getCountryLabelAliases,
    getOptionLabel,
    getOptionMatchLabels,
    getRegionDisplayName,
    isLooseCountryLabelMatch,
    normalizeCountryLabel,
    normalizeCountryOptionValue,
    normalizePhoneDigits,
    resolveDialCodeFromPhoneNumber,
  };
});
