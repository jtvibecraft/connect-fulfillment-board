/**
 * Connect Fulfillment board — static / public deploy config.
 * Live promotions + zero-transactions hit Workers.dev directly (CORS *).
 * Snapshot / exceptions / L2E units are bundled JSON next to index.html.
 */
window.FULFILLMENT_CONFIG = {
  mode: 'static',
  endpoints: {
    snapshot: './snapshot.json',
    exceptions: './exceptions.json',
    promotions: 'https://promotions-api.asabadoelement.workers.dev/scoreboard/promotions',
    zeroTransactions: 'https://promotions-api.asabadoelement.workers.dev/scoreboard/zero-transactions',
    l2eUnits: './l2e-units.json',
  },
  fallbacks: {
    snapshot: './snapshot.json',
    l2eUnits: './unit-counts.json',
  },
};
