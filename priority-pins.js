/**
 * Jon P1 priority pins for Remaining hero queue.
 * Edit match aliases here — order = hero order (pinned first).
 * Do NOT invent fulfillment counts; pins only affect sort + visibility.
 *
 * Numbered Learn to Earn (L2E B\d+) is the top priority — each B61–B67
 * is its own pin. L2E Activated Single Lesson NFTs is NOT a P1.
 */
window.FULFILLMENT_P1_PINS = [
  // Numbered L2E first (biggest priority)
  { key: 'l2e-b61', label: 'L2E B61', match: ['L2E B61'], preferredTitle: 'L2E B61' },
  { key: 'l2e-b62', label: 'L2E B62', match: ['L2E B62'], preferredTitle: 'L2E B62' },
  { key: 'l2e-b63', label: 'L2E B63', match: ['L2E B63'], preferredTitle: 'L2E B63' },
  {
    key: 'l2e-b64',
    label: 'L2E B64',
    match: ['L2E B64'],
    preferredTitle: 'L2E B64',
    /** Access-denied / unreadable sheet rows for B64 nest here (not under Single Lesson) */
    groupAlso: [],
  },
  { key: 'l2e-b65', label: 'L2E B65', match: ['L2E B65'], preferredTitle: 'L2E B65' },
  { key: 'l2e-b66', label: 'L2E B66', match: ['L2E B66'], preferredTitle: 'L2E B66' },
  { key: 'l2e-b67', label: 'L2E B67', match: ['L2E B67'], preferredTitle: 'L2E B67' },
  // Then classic pins
  {
    key: 'sell-4-get-1',
    label: 'Sell 4, Get 1',
    match: ['Sell 4, Get 1', 'Sell 4 Get 1'],
  },
  {
    key: 'give-2-earn',
    label: 'Give 2 Earn (Give Incentive)',
    match: [
      'Give 2 Earn (Give Incentive)',
      'Give 2 Earn',
      'Give2Earn',
      'Give Incentive',
    ],
  },
  {
    key: 'droidpay',
    label: 'DroidPay',
    match: ['DroidPay'],
  },
  {
    key: 'new-impact-bb',
    label: 'New Impact BB Incentive - 500k',
    match: [
      'New Impact BB Incentive - 500k',
      'New Impact BB',
      'New Impact BlockBot',
      'New Impact BB Incentive',
    ],
  },
  {
    key: 'winpay',
    label: 'WINPay',
    match: ['WINPay'],
  },
];
