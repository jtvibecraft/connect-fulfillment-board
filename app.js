(() => {
  'use strict';

  const state = {
    snapshot: null,
    exceptions: null,
    promotions: null,
    zero: null,
    l2eUnits: null,
    sources: {},
    promoFilter: 'all',
    exFilter: 'all',
    uniqueQueue: [],
    synthesizedPins: [],
  };


  /** Normalize Pulse exceptions schema: {exceptions,kpi} or legacy {queue,count}. */
  function normalizeExceptions(data) {
    if (!data) return null;
    const queue = data.queue || data.exceptions || [];
    const count = data.count ?? queue.length;
    return Object.assign({}, data, { queue, count });
  }

  /** Dual-mode: config.js sets mode 'local' | 'static'. Auto-detect if missing. */
  function resolveConfig() {
    const cfg = window.FULFILLMENT_CONFIG;
    if (cfg && cfg.endpoints) return cfg;
    const host = (typeof location !== 'undefined' && location.hostname) || '';
    const port = (typeof location !== 'undefined' && location.port) || '';
    const isLocalDash =
      port === '8787' ||
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '0.0.0.0';
    if (isLocalDash) {
      return {
        mode: 'local',
        endpoints: {
          snapshot: '/api/snapshot',
          exceptions: '/api/exceptions',
          promotions: '/api/promotions',
          zeroTransactions: '/api/zero-transactions',
          l2eUnits: '/api/l2e-units',
        },
        fallbacks: { snapshot: '/snapshot.json', l2eUnits: '/unit-counts.json' },
      };
    }
    return {
      mode: 'static',
      endpoints: {
        snapshot: './snapshot.json',
        exceptions: './exceptions.json',
        promotions:
          'https://promotions-api.asabadoelement.workers.dev/scoreboard/promotions',
        zeroTransactions:
          'https://promotions-api.asabadoelement.workers.dev/scoreboard/zero-transactions',
        l2eUnits: './l2e-units.json',
      },
      fallbacks: { snapshot: './snapshot.json', l2eUnits: './unit-counts.json' },
    };
  }

  const CONFIG = resolveConfig();

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function dash(v) {
    if (v === null || v === undefined || v === '' || v === '-') {
      return '<span class="dash">—</span>';
    }
    return esc(v);
  }

  function fmtDate(iso) {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
        return String(iso);
      }
      return (
        d.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }) + ' ET'
      );
    } catch {
      return String(iso);
    }
  }

  function fmtShortDate(iso) {
    if (!iso) return null;
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d, 12));
        return dt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        });
      }
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return String(iso);
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const source = res.headers.get('X-Data-Source') || 'ok';
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const data = await res.json();
    return { data, source, upstreamError: res.headers.get('X-Upstream-Error') };
  }

  function setBadge(id, label, kind) {
    const el = $(id);
    if (!el) return;
    el.className = `badge ${kind || ''}`;
    el.innerHTML = `<span class="dot"></span> ${esc(label)}`;
  }

  /** Extract spreadsheet id from a Google Sheets URL when present. */
  function sheetIdFromLink(link) {
    const m = String(link || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  /**
   * Outstanding NFT/units for a Remaining row.
   * Never invent counts. data_row_count is NOT outstanding units.
   * L2E B## uses unit-counts.json hero metric: Action=Complete AND
   * Fulfillment Date (NFT) blank → sum Qty (unsent_nft_qty).
   * Returns { known: boolean, value: number|null, label: string, reason: string, meta?: string }.
   */
  function l2eBlockKey(title) {
    const m = String(title || '').match(/^L2E\s+(B\d+)\b/i);
    return m ? m[1].toUpperCase() : null;
  }

  function resolveUnits(row) {
    const title = String(row?.title || '');
    const ev = row?.evidence || {};
    const block = l2eBlockKey(title);

    // Honest L2E evidence from /api/l2e-units (unit-counts.json)
    if (block && state.l2eUnits?.blocks) {
      const b = state.l2eUnits.blocks[block];
      if (b) {
        if (b.access === 'ok' && typeof b.unsent_nft_qty === 'number') {
          const n = b.unsent_nft_qty;
          const mf = b.missing_form_members;
          return {
            known: true,
            value: n,
            label: `${n.toLocaleString()} unsent`,
            reason:
              'unsent NFT Qty: Action=Complete AND Fulfillment Date (NFT) blank; sum Qty' +
              (typeof mf === 'number'
                ? ` · Missing Form members: ${mf.toLocaleString()} (context, not hero)`
                : ''),
            meta:
              typeof mf === 'number'
                ? `Missing Form members: ${mf.toLocaleString()}`
                : null,
          };
        }
        if (b.access === 'need_access') {
          return {
            known: false,
            value: null,
            label: '— · need access',
            reason: b.note || 'need access — unit count unknown',
            meta: 'need access',
          };
        }
      }
    }

    // Explicit outstanding fields only (none on API today — keep hooks honest)
    const explicitKeys = [
      'outstanding_units',
      'units_outstanding',
      'nft_outstanding',
      'remaining_units',
      'units_remaining',
    ];
    for (const k of explicitKeys) {
      const v = ev[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        return {
          known: true,
          value: v,
          label: v.toLocaleString(),
          reason: `from evidence.${k}`,
        };
      }
    }

    const sheets = state.snapshot?.sheets || {};
    const gaps = state.snapshot?.gaps || [];
    const locked = state.snapshot?.locked || [];
    const fileId = sheetIdFromLink(ev.file_link) || ev.id;
    const isL2EBatch = /^L2E B\d+/i.test(title);

    let sheet = null;
    let sheetName = null;
    if (fileId && typeof fileId === 'string' && !fileId.includes(':')) {
      for (const [name, sh] of Object.entries(sheets)) {
        if (sh && sh.id === fileId) {
          sheet = sh;
          sheetName = name;
          break;
        }
      }
    }
    if (!sheet) {
      for (const [name, sh] of Object.entries(sheets)) {
        if (name === title || (isL2EBatch && name.toLowerCase() === title.toLowerCase())) {
          sheet = sh;
          sheetName = name;
          break;
        }
      }
    }

    const gap =
      gaps.find((g) => g.sheet === sheetName || g.sheet === title || (fileId && g.id === fileId)) ||
      null;
    const lock =
      locked.find((L) => L.name === sheetName || L.name === title || (fileId && L.id === fileId)) ||
      null;

    if (sheet && sheet.readable === false) {
      return {
        known: false,
        value: null,
        label: '—',
        reason: 'sheet locked / access denied — unit count unknown',
      };
    }
    if (gap && /access denied|401|locked|HTML/i.test(String(gap.gap || ''))) {
      return {
        known: false,
        value: null,
        label: '—',
        reason: 'sheet locked / access denied — unit count unknown',
      };
    }
    if (lock) {
      return {
        known: false,
        value: null,
        label: '—',
        reason: 'sheet locked / access denied — unit count unknown',
      };
    }

    if (isL2EBatch) {
      return {
        known: false,
        value: null,
        label: '—',
        reason: 'L2E unit evidence not loaded — unit count unknown',
      };
    }

    if (sheet && sheet.readable === true) {
      return {
        known: false,
        value: null,
        label: '—',
        reason: 'sheet readable — outstanding unit count not wired yet',
      };
    }

    return {
      known: false,
      value: null,
      label: '—',
      reason: 'unit count unknown',
    };
  }

  /**
   * Hero: when L2E unit-counts exist, surface total unsent NFT Qty for readable
   * pinned L2E blocks (e.g. 54 unsent NFTs (B63–B67)). Promo-line count is secondary.
   * Never invent B61/B62 when access is need_access.
   */
  function heroMetric(uniqueRows) {
    const data = state.l2eUnits;
    if (data?.blocks && data?.totals) {
      const ok = Array.isArray(data.totals.blocks_ok) ? data.totals.blocks_ok : [];
      const total =
        typeof data.totals.unsent_nft_qty_readable_blocks === 'number'
          ? data.totals.unsent_nft_qty_readable_blocks
          : null;
      if (ok.length && total != null) {
        const range =
          ok.length === 1
            ? ok[0]
            : `${ok[0]}–${ok[ok.length - 1]}`;
        const blocked = Array.isArray(data.totals.blocks_blocked)
          ? data.totals.blocks_blocked
          : [];
        const n = uniqueRows.length;
        const blockedNote = blocked.length
          ? ` · ${blocked.join('/')} need access (units unknown)`
          : '';
        return {
          num: total.toLocaleString(),
          label:
            total === 1
              ? `unsent NFT (${range})`
              : `unsent NFTs (${range})`,
          mode: 'l2e_units',
          secondary: `${n} promo line${n === 1 ? '' : 's'}${blockedNote}`,
          total,
          range,
        };
      }
    }

    // Fallback: all rows have known units → sum (non-L2E path)
    const units = uniqueRows.map((r) => resolveUnits(r));
    const allKnown = units.length > 0 && units.every((u) => u.known);
    if (allKnown) {
      const total = units.reduce((s, u) => s + (u.value || 0), 0);
      return {
        num: total.toLocaleString(),
        label: total === 1 ? 'NFT unit outstanding' : 'NFT units outstanding',
        mode: 'units',
      };
    }
    const n = uniqueRows.length;
    return {
      num: String(n),
      label: n === 1 ? 'promo line' : 'promo lines',
      mode: 'promos',
    };
  }

  function pillClass(label) {
    const t = String(label || '');
    if (t === 'Needs Review') return 'needs-review';
    if (t === 'Active') return 'active';
    if (t === 'Archived') return 'archived';
    if (t === 'High') return 'high';
    if (/pending delivery/i.test(t)) return 'pending';
    if (/invoice/i.test(t)) return 'invoice';
    if (/null last_sent/i.test(t)) return 'null-sent';
    if (/blocked|locked|unreadable|access/i.test(t)) return 'locked';
    if (/missing form|form/i.test(t)) return 'pending';
    return 'priority';
  }

  /** Classify a single raw exception row into filter tags */
  function classifyItem(ex) {
    const tags = new Set();
    const title = String(ex.title || '');
    const detail = String(ex.detail || '');
    const ev = ex.evidence || {};
    const evTags = String(ev.tags || '');
    const team = String(ev.team_status || '');
    const blob = `${title} ${detail} ${evTags} ${team} ${ex.source || ''}`.toLowerCase();

    if (team === 'Needs Review' || /needs review/i.test(title)) tags.add('needs_review');
    if (/pending delivery/i.test(evTags) || /pending delivery/i.test(title)) {
      tags.add('pending_delivery');
    }
    if (
      ev.last_sent === null ||
      /null last_sent/i.test(title) ||
      (Object.prototype.hasOwnProperty.call(ev, 'last_sent') &&
        ev.last_sent === null)
    ) {
      tags.add('null_last_sent');
    }
    if (/invoice/i.test(evTags) || /invoice/i.test(title)) tags.add('invoice');
    if (/^high priority/i.test(title) || ev.priority_level === 'High') tags.add('high');
    if (
      /unreadable|access denied|locked|no access/i.test(blob) ||
      /access denied/i.test(String(ex.source || ''))
    ) {
      tags.add('blocked');
    }
    if (/missing form|form sheet|claim form/i.test(blob)) tags.add('missing_form');

    return tags;
  }

  function flagLabel(ex) {
    const title = String(ex.title || '');
    if (/needs review/i.test(title)) return 'Needs Review';
    if (/pending delivery/i.test(title)) return 'Pending Delivery';
    if (/null last_sent/i.test(title)) return 'Null last_sent';
    if (/invoice/i.test(title)) return 'Invoice';
    if (/high priority/i.test(title)) return 'High';
    if (/unreadable|access denied|locked/i.test(title)) return 'Blocked';
    if (/missing|form/i.test(title) && /form|missing/i.test(title)) return 'Form / sheet';
    if (/missing-nft|missing nft/i.test(title)) return 'Missing NFT';
    // sheet activity
    if (String(ex.source || '').startsWith('sheet:')) {
      return title.split(':')[0].slice(0, 40) || 'Sheet note';
    }
    return title.slice(0, 42) || `P${ex.priority}`;
  }

  function deriveDisplayTitle(items) {
    // Prefer a clean promo name from "Needs Review: X" / "Pending Delivery: X" / "null last_sent (active): X"
    for (const ex of items) {
      const t = String(ex.title || '');
      const m = t.match(
        /^(?:Needs Review|Pending Delivery|Invoice tag|High priority|null last_sent \(active\)|Unreadable active promo sheet|Unreadable triage sheet):\s*(.+)$/i
      );
      if (m) return m[1].trim();
    }
    // Match NFT missing-NFT comment → Match NFT
    for (const ex of items) {
      const t = String(ex.title || '');
      if (/^Match NFT/i.test(t)) return 'Match NFT';
    }
    return items[0]?.title || 'Untitled';
  }

  function mergeEvidence(items) {
    const out = {};
    for (const ex of items) {
      const ev = ex.evidence || {};
      for (const [k, v] of Object.entries(ev)) {
        if (out[k] === undefined || out[k] === null || out[k] === '') {
          if (v !== undefined && v !== null && v !== '') out[k] = v;
        }
      }
      // Prefer explicit null last_sent if any item has it
      if (Object.prototype.hasOwnProperty.call(ev, 'last_sent') && ev.last_sent === null) {
        out.last_sent = null;
        out._null_last_sent = true;
      }
    }
    return out;
  }

  /** Jon P1 pins — editable list in priority-pins.js */
  function getJonP1Pins() {
    return Array.isArray(window.FULFILLMENT_P1_PINS)
      ? window.FULFILLMENT_P1_PINS
      : [];
  }

  function normalizePinKey(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function pinMatchesText(text, aliases) {
    const raw = String(text || '');
    if (!raw) return false;
    const norm = normalizePinKey(raw);
    for (const a of aliases || []) {
      if (!a) continue;
      if (raw.toLowerCase().includes(String(a).toLowerCase())) return true;
      const an = normalizePinKey(a);
      if (an && norm.includes(an)) return true;
    }
    return false;
  }

  function findPromoForPin(pin, promotions) {
    const list = promotions || [];
    const preferred = pin.preferredTitle || pin.label;
    // Exact name first (critical for L2E B61 vs B62 vs Single Lesson)
    if (preferred) {
      const exact = list.find((p) => String(p.name || '') === preferred);
      if (exact) return exact;
    }
    let best = null;
    for (const p of list) {
      const name = String(p.name || '');
      if (!pinMatchesText(name, pin.match) && name !== pin.label) continue;
      const surface =
        String(p.status || '').toLowerCase() === 'active' ||
        p.team_status === 'Active' ||
        p.team_status === 'Needs Review';
      if (!best) {
        best = p;
        continue;
      }
      const bestSurface =
        String(best.status || '').toLowerCase() === 'active' ||
        best.team_status === 'Active' ||
        best.team_status === 'Needs Review';
      if (surface && !bestSurface) best = p;
    }
    return best;
  }

  function scoreRowForPin(row, pin, promo) {
    let score = 0;
    if (promo && row.id === promo.id) score += 1000;
    if (pin.preferredTitle && row.title === pin.preferredTitle) score += 500;
    if (pin.label && row.title === pin.label) score += 300;
    if (pinMatchesText(row.title, [pin.label].filter(Boolean))) score += 200;
    if (pinMatchesText(row.title, pin.match)) score += 100;
    score += Math.max(0, 40 - (row.priority ?? 99));
    return score;
  }

  function synthesizePinnedRow(promo, pin, pinIndex) {
    const cats = new Set();
    const flags = [];
    const team = String(promo.team_status || '');
    const tags = String(promo.tags || '');
    const priLevel = String(promo.priority_level || '');
    const name = promo.name || pin.label;

    if (team === 'Needs Review') {
      cats.add('needs_review');
      flags.push({
        priority: 1,
        title: `Needs Review: ${name}`,
        detail: 'Jon P1 — from promotions API (no exception row)',
        source: 'promotions_api',
        label: 'Needs Review',
      });
    }
    if (priLevel === 'High') {
      cats.add('high');
      flags.push({
        priority: 4,
        title: `High priority: ${name}`,
        detail: 'Jon P1 — from promotions API (no exception row)',
        source: 'promotions_api',
        label: 'High',
      });
    }
    if (Object.prototype.hasOwnProperty.call(promo, 'last_sent') && promo.last_sent === null) {
      cats.add('null_last_sent');
      flags.push({
        priority: 5,
        title: `null last_sent (active): ${name}`,
        detail: 'Jon P1 — from promotions API (no exception row)',
        source: 'promotions_api',
        label: 'Null last_sent',
      });
    }
    if (/Pending Delivery/i.test(tags)) {
      cats.add('pending_delivery');
      flags.push({
        priority: 2,
        title: `Pending Delivery: ${name}`,
        detail: 'Jon P1 — from promotions API (no exception row)',
        source: 'promotions_api',
        label: 'Pending Delivery',
      });
    }
    if (!flags.length) {
      flags.push({
        priority: 1,
        title: name,
        detail: 'Jon P1 — active in promotions API, no exception row yet',
        source: 'promotions_api',
        label: 'Jon P1',
      });
    }

    const evidence = {
      id: promo.id,
      team_status: promo.team_status,
      brand: promo.brand,
      tags: promo.tags,
      last_sent: promo.last_sent,
      file_link: promo.file_link,
      faq_link: promo.faq_link,
      priority_level: promo.priority_level,
      _synthetic: true,
    };
    if (promo.last_sent === null) evidence._null_last_sent = true;

    return {
      id: promo.id || `synthetic:${pin.key}`,
      priority: 1,
      title: name,
      detail: 'Jon P1 — surfaced from promotions API (no exception row yet)',
      source: 'promotions_api',
      evidence,
      cats,
      flags,
      rawCount: flags.length,
      jonP1: true,
      pinIndex,
      pinKey: pin.key,
      pinLabel: pin.label,
      synthetic: true,
    };
  }

  /**
   * Pin Jon P1 promos to the front of the unique queue (config order).
   * Synthesize from promotions API when a pin has no exception row yet.
   * Returns { rows, synthesized: string[] }.
   */
  function applyJonP1Pins(uniqueRows, promotions) {
    const pins = getJonP1Pins();
    const used = new Set();
    const pinned = [];
    const synthesized = [];

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      const promo = findPromoForPin(pin, promotions);

      const candidates = uniqueRows.filter((r) => {
        if (used.has(r.id)) return false;
        if (promo && r.id === promo.id) return true;
        if (pinMatchesText(r.title, pin.match)) return true;
        return false;
      });

      let hero = null;
      if (candidates.length) {
        candidates.sort(
          (a, b) => scoreRowForPin(b, pin, promo) - scoreRowForPin(a, pin, promo)
        );
        if (pin.preferredTitle) {
          hero =
            candidates.find(
              (c) =>
                c.title === pin.preferredTitle || (promo && c.id === promo.id)
            ) || candidates[0];
        } else {
          hero = candidates[0];
        }
      }

      if (hero) {
        used.add(hero.id);
        const extras = [];
        // Nest sibling candidates for this pin (e.g. B64 access-denied under B64)
        for (const r of candidates) {
          if (r.id === hero.id || used.has(r.id)) continue;
          used.add(r.id);
          extras.push(r);
        }
        for (const alias of pin.groupAlso || []) {
          for (const r of uniqueRows) {
            if (used.has(r.id)) continue;
            if (pinMatchesText(r.title, [alias])) {
              used.add(r.id);
              extras.push(r);
            }
          }
        }

        const mergedCats = new Set(hero.cats);
        let mergedFlags = hero.flags.slice();
        let rawCount = hero.rawCount;
        for (const e of extras) {
          for (const c of e.cats) mergedCats.add(c);
          rawCount += e.rawCount;
          for (const f of e.flags) {
            mergedFlags.push({
              ...f,
              label: f.label || e.title,
              detail: f.detail || e.title,
            });
          }
          if (!e.flags.length) {
            mergedFlags.push({
              priority: e.priority,
              title: e.title,
              detail: e.detail,
              source: e.source,
              label: e.title,
            });
          }
        }

        const enrichedEv = { ...(hero.evidence || {}) };
        if (promo) {
          if (!enrichedEv.file_link && promo.file_link)
            enrichedEv.file_link = promo.file_link;
          if (!enrichedEv.faq_link && promo.faq_link)
            enrichedEv.faq_link = promo.faq_link;
          if (!enrichedEv.team_status && promo.team_status)
            enrichedEv.team_status = promo.team_status;
          if (!enrichedEv.brand && promo.brand) enrichedEv.brand = promo.brand;
          if (!enrichedEv.tags && promo.tags) enrichedEv.tags = promo.tags;
          if (
            enrichedEv.priority_level == null &&
            promo.priority_level != null &&
            promo.priority_level !== '-'
          ) {
            enrichedEv.priority_level = promo.priority_level;
          }
          enrichedEv._pin_promo_id = promo.id;
        }

        pinned.push({
          ...hero,
          // Prefer canonical promo name on hero when sheet/noid title is a loose alias match
          title:
            promo && pin.preferredTitle
              ? pin.preferredTitle
              : promo && !String(hero.id).startsWith('noid:')
                ? hero.title
                : promo
                  ? promo.name || hero.title
                  : hero.title,
          evidence: enrichedEv,
          cats: mergedCats,
          flags: mergedFlags,
          rawCount,
          jonP1: true,
          pinIndex: i,
          pinKey: pin.key,
          pinLabel: pin.label,
        });
      } else if (promo) {
        // Surface pin even when status=archived if team still Active / Needs Review
        const surface =
          String(promo.status || '').toLowerCase() === 'active' ||
          promo.team_status === 'Active' ||
          promo.team_status === 'Needs Review';
        if (surface) {
          const syn = synthesizePinnedRow(promo, pin, i);
          synthesized.push(promo.name || pin.label);
          pinned.push(syn);
          used.add(syn.id);
        }
      }
    }

    const rest = uniqueRows
      .filter((r) => !used.has(r.id))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return String(a.title).localeCompare(String(b.title));
      });

    return { rows: [...pinned, ...rest], synthesized };
  }

  /**
   * Deduplicate raw exception rows by evidence.id (promo / sheet id).
   * Items without id keyed by source+title. Nested flags keep secondary signals.
   */
  function buildUniqueQueue(rawQueue) {
    const map = new Map();
    const order = [];

    for (const ex of rawQueue || []) {
      const id =
        (ex.evidence && ex.evidence.id) ||
        `noid:${ex.source || ''}:${ex.title || ''}`;
      if (!map.has(id)) {
        map.set(id, []);
        order.push(id);
      }
      map.get(id).push(ex);
    }

    return order
      .map((id) => {
        const items = map.get(id);
        items.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        const primary = items[0];
        const evidence = mergeEvidence(items);
        const cats = new Set();
        for (const it of items) {
          for (const c of classifyItem(it)) cats.add(c);
        }
        // Also check merged evidence
        if (evidence._null_last_sent || evidence.last_sent === null) {
          cats.add('null_last_sent');
        }
        if (String(evidence.team_status || '') === 'Needs Review') {
          cats.add('needs_review');
        }
        if (/Pending Delivery/i.test(String(evidence.tags || ''))) {
          cats.add('pending_delivery');
        }
        if (/Invoice/i.test(String(evidence.tags || ''))) cats.add('invoice');

        return {
          id,
          priority: primary.priority ?? 99,
          title: deriveDisplayTitle(items),
          detail: primary.detail || '',
          source: primary.source || '',
          evidence,
          cats,
          flags: items.map((it) => ({
            priority: it.priority,
            title: it.title,
            detail: it.detail,
            source: it.source,
            label: flagLabel(it),
          })),
          rawCount: items.length,
        };
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return String(a.title).localeCompare(String(b.title));
      });
  }

  function matchExFilter(row, filter) {
    if (filter === 'all') return true;
    return row.cats.has(filter);
  }

  function renderBlockers() {
    const strip = $('blocker-strip');
    if (!strip) return;

    const locked = state.snapshot?.locked || [];
    const gaps = state.snapshot?.gaps || [];
    const required = [
      'NFT Payouts',
      'Lite Node Claim Form',
      '6 Month WIN Smart Node Hosting Credit',
    ];
    const byName = new Map();
    for (const L of locked) byName.set(L.name, L);
    if (byName.has('Lite Node Claim') && !byName.has('Lite Node Claim Form')) {
      const src = byName.get('Lite Node Claim');
      byName.set('Lite Node Claim Form', { ...src, name: 'Lite Node Claim Form' });
    }

    const chips = [];
    for (const name of required) {
      const L =
        byName.get(name) ||
        byName.get(name.replace(' Form', '')) || {
          name,
          reason: 'access denied — locked',
        };
      chips.push({
        kind: 'locked',
        label: L.name || name,
        title: L.reason || 'Locked — no access (not an error)',
      });
    }

    const accessGaps = gaps.filter((g) =>
      /access denied|401|locked/i.test(String(g.gap || ''))
    );
    for (const g of accessGaps) {
      // Avoid duplicating the three known locked sheets
      if (
        required.some(
          (n) => n === g.sheet || n.replace(' Form', '') === g.sheet
        )
      ) {
        continue;
      }
      chips.push({
        kind: 'gap',
        label: g.sheet,
        title: g.gap || 'Access limited',
      });
    }

    if (!chips.length) {
      strip.hidden = true;
      strip.innerHTML = '';
      return;
    }

    strip.hidden = false;
    strip.innerHTML = `
      <div class="blocker-label">Blocked sources</div>
      <div class="blocker-chips">
        ${chips
          .map(
            (c) =>
              `<span class="blocker-chip ${c.kind}" title="${esc(c.title)}">${esc(c.label)}</span>`
          )
          .join('')}
      </div>`;
  }

  function renderExFilters() {
    const list = state.uniqueQueue;
    const counts = {
      all: list.length,
      needs_review: list.filter((r) => r.cats.has('needs_review')).length,
      pending_delivery: list.filter((r) => r.cats.has('pending_delivery')).length,
      null_last_sent: list.filter((r) => r.cats.has('null_last_sent')).length,
      invoice: list.filter((r) => r.cats.has('invoice')).length,
      high: list.filter((r) => r.cats.has('high')).length,
      blocked: list.filter((r) => r.cats.has('blocked')).length,
      missing_form: list.filter((r) => r.cats.has('missing_form')).length,
    };
    const set = (id, n) => {
      const el = $(id);
      if (el) el.textContent = n;
    };
    set('efc-all', counts.all);
    set('efc-needs', counts.needs_review);
    set('efc-pending', counts.pending_delivery);
    set('efc-null', counts.null_last_sent);
    set('efc-invoice', counts.invoice);
    set('efc-high', counts.high);
    set('efc-blocked', counts.blocked);
    set('efc-form', counts.missing_form);
  }

  function renderExceptions() {
    const raw = state.exceptions?.queue || state.exceptions?.exceptions || state.snapshot?.promotions?.exceptions || [];
    const built = buildUniqueQueue(raw);
    const pinned = applyJonP1Pins(built, state.promotions || []);
    state.uniqueQueue = pinned.rows;
    state.synthesizedPins = pinned.synthesized;
    const unique = state.uniqueQueue;
    const filtered = unique.filter((r) => matchExFilter(r, state.exFilter));

    const metric = heroMetric(unique);
    $('owed-count').textContent = metric.num;
    if (state.exFilter === 'all') {
      $('owed-label').textContent = metric.label;
    } else {
      $('owed-label').textContent =
        `${filtered.length} matching · ${unique.length} promo lines`;
    }
    if (metric.mode === 'l2e_units') {
      $('owed-lead').textContent =
        metric.secondary ||
        'Unsent NFT Qty from L2E sheets (Complete + blank Fulfillment Date) · promo lines secondary · Pending Delivery is a status filter';
    } else {
      $('owed-lead').textContent =
        'Unique promo / work items still open — not NFT unit totals · Pending Delivery is a status filter on this list';
    }
    const note = $('owed-note');
    if (note) {
      if (metric.mode === 'l2e_units') {
        note.textContent =
          `Hero = unsent NFT Qty for readable pinned L2E (${metric.range || 'B63–B67'}). ` +
          `Rule: Action=Complete AND Fulfillment Date (NFT) blank; sum Qty. ` +
          `${unique.length} promo lines still listed below. B61/B62 need access — not invented.`;
      } else if (metric.mode === 'units') {
        note.textContent =
          'Outstanding NFT/unit totals from sheet evidence. Promo lines still listed below.';
      } else {
        note.textContent =
          'Remaining work is unit-level inside each promo sheet; this board currently tracks promo lines until sheet unit counts are wired.';
      }
    }

    const rawCount = state.exceptions?.count ?? raw.length;
    $('raw-ex-hint').textContent =
      rawCount !== unique.length
        ? `Raw exception rows: ${rawCount} → ${unique.length} promo lines (duplicate flags nested)`
        : `Exception rows: ${rawCount} · ${unique.length} promo lines`;

    renderExFilters();

    if (!filtered.length) {
      const emptyPending =
        state.exFilter === 'pending_delivery'
          ? '<li class="empty-state"><strong>None pending delivery</strong>Nothing in Remaining with that status.</li>'
          : '<li class="empty-state"><strong>No matches</strong>Try another filter — other Remaining work still exists.</li>';
      $('ex-list').innerHTML =
        unique.length === 0
          ? '<li class="empty-state"><strong>Nothing remaining</strong>All caught up — nothing still needs fulfillment.</li>'
          : emptyPending;
      return;
    }

    $('ex-list').innerHTML = filtered
      .map((row, idx) => {
        const pri = row.jonP1 ? 1 : row.priority ?? '—';
        const priClass = row.jonP1
          ? 'p1 jon-pin'
          : pri <= 1
            ? 'p1'
            : pri === 2
              ? 'p2'
              : pri <= 3
                ? 'p3'
                : '';
        const ev = row.evidence || {};
        const units = resolveUnits(row);
        const unitsHtml = `<span class="ex-units${units.known ? ' known' : ' unknown'}" title="${esc(units.reason)}"><span class="ex-units-label">Units</span> ${esc(units.label)}</span>`;
        const links = [];
        if (ev.file_link) {
          links.push(
            `<a href="${esc(ev.file_link)}" target="_blank" rel="noopener">Sheet</a>`
          );
        }
        if (ev.faq_link) {
          links.push(
            `<a href="${esc(ev.faq_link)}" target="_blank" rel="noopener">FAQ</a>`
          );
        }

        const metaBits = [];
        if (units.meta) metaBits.push(esc(units.meta));
        if (ev.team_status) metaBits.push(esc(ev.team_status));
        if (ev.brand) metaBits.push(esc(ev.brand));
        if (ev.tags) metaBits.push(esc(ev.tags));
        if (ev._null_last_sent || ev.last_sent === null) {
          metaBits.push('<span class="null-callout">last_sent null</span>');
        } else if (ev.last_sent) {
          metaBits.push(`sent ${esc(fmtShortDate(ev.last_sent))}`);
        }

        // Show at most 2 pills in the row; rest live in expand body
        const catList = [...row.cats];
        const labels = {
          needs_review: 'Needs Review',
          pending_delivery: 'Pending Delivery',
          null_last_sent: 'Null last_sent',
          invoice: 'Invoice',
          high: 'High',
          blocked: 'Blocked',
          missing_form: 'Missing Form',
        };
        const catPills = catList
          .slice(0, 2)
          .map((c) => {
            const lab = labels[c] || c;
            return `<span class="pill ${pillClass(lab)}">${esc(lab)}</span>`;
          })
          .join('');
        const moreCats =
          catList.length > 2
            ? `<span class="pill priority">+${catList.length - 2}</span>`
            : '';

        const hasNested = row.flags.length > 1;
        const hasBody = hasNested || links.length || metaBits.length;
        const rowId = `ex-${idx}`;

        const nested = hasNested
          ? `<ul class="ex-flags">${row.flags
              .map(
                (f) =>
                  `<li><span class="flag-pri">P${esc(f.priority)}</span>${esc(f.label)}${
                    f.detail && f.detail !== row.detail
                      ? `<span class="flag-detail"> — ${esc(f.detail)}</span>`
                      : ''
                  }</li>`
              )
              .join('')}</ul>`
          : '';

        const expandBtn = hasBody
          ? `<button type="button" class="ex-expand" data-ex-toggle="${rowId}" aria-expanded="false" aria-label="Expand details">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 2l4 4-4 4"/></svg>
            </button>`
          : `<span class="ex-expand" aria-hidden="true"></span>`;

        const body = hasBody
          ? `<div class="ex-body" id="${rowId}-body">
              <div class="ex-meta">
                ${metaBits.map((b) => `<span>${b}</span>`).join('')}
                ${links.join('')}
              </div>
              ${nested}
            </div>`
          : '';

        const jonPill = row.jonP1
          ? `<span class="pill jon-p1" title="Jon P1 priority">P1</span>`
          : '';
        const priTitle = row.jonP1
          ? `Jon P1${row.priority != null ? ` · exception P${row.priority}` : ''}${row.synthetic ? ' · synthetic' : ''}`
          : `P${pri}`;

        return `<li class="ex-item${row.jonP1 ? ' jon-p1' : ''}${row.synthetic ? ' synthetic' : ''}" data-ex-id="${rowId}"${row.pinKey ? ` data-pin="${esc(row.pinKey)}"` : ''}>
          <div class="ex-row">
            <div class="ex-pri ${priClass}" title="${esc(priTitle)}">P${esc(pri)}</div>
            <div class="ex-main">
              <div class="ex-title-row">
                <p class="ex-title" title="${esc(row.title)}">${esc(row.title)}</p>
                <div class="ex-cats">${jonPill}${catPills}${moreCats}</div>
              </div>
              ${row.detail ? `<p class="ex-detail" title="${esc(row.detail)}">${esc(row.detail)}</p>` : ''}
            </div>
            <div class="ex-aside">
              ${unitsHtml}
              ${
                row.rawCount > 1
                  ? `<span class="ex-dup" title="nested flags">${row.rawCount}</span>`
                  : ''
              }
              <span class="ex-source" title="${esc(row.source)}">${esc(row.source)}</span>
              ${expandBtn}
            </div>
          </div>
          ${body}
        </li>`;
      })
      .join('');
  }

  function matchPromoFilter(p, filter) {
    const tags = String(p.tags || '').toLowerCase();
    const team = String(p.team_status || '');
    const pri = String(p.priority_level || '');
    const status = String(p.status || '').toLowerCase();
    switch (filter) {
      case 'active':
        return status === 'active' || team === 'Active';
      case 'needs_review':
        return team === 'Needs Review';
      case 'high':
        return pri === 'High';
      case 'pending_delivery':
        return tags.includes('pending delivery');
      case 'all':
      default:
        return true;
    }
  }

  function renderPromoFilters() {
    const list = state.promotions || [];
    const counts = {
      all: list.length,
      active: list.filter((p) => matchPromoFilter(p, 'active')).length,
      needs_review: list.filter((p) => matchPromoFilter(p, 'needs_review')).length,
      high: list.filter((p) => matchPromoFilter(p, 'high')).length,
    };
    const set = (id, n) => {
      const el = $(id);
      if (el) el.textContent = n;
    };
    set('fc-all', counts.all);
    set('fc-active', counts.active);
    set('fc-needs', counts.needs_review);
    set('fc-high', counts.high);
  }

  function renderPromos() {
    const list = (state.promotions || []).filter((p) =>
      matchPromoFilter(p, state.promoFilter)
    );
    list.sort((a, b) => {
      const rank = (p) => {
        if (p.team_status === 'Needs Review') return 0;
        if (p.priority_level === 'High') return 1;
        if (String(p.tags || '').includes('Pending Delivery')) return 2;
        if (!p.last_sent && (p.status === 'active' || p.team_status === 'Active'))
          return 3;
        if (p.status === 'active') return 4;
        return 5;
      };
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    $('promo-count').textContent = `${list.length} shown · ${(state.promotions || []).length} total`;

    if (!list.length) {
      $('promo-tbody').innerHTML =
        '<tr><td colspan="9"><div class="empty-state"><strong>No promos in catalog</strong>Try another status filter.</div></td></tr>';
      return;
    }

    $('promo-tbody').innerHTML = list
      .map((p) => {
        const tags = String(p.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const tagHtml = tags.length
          ? `<div class="tags">${tags
              .map((t) => `<span class="pill ${pillClass(t)}">${esc(t)}</span>`)
              .join('')}</div>`
          : '<span class="dash">—</span>';

        const links = [];
        if (p.file_link)
          links.push(
            `<a href="${esc(p.file_link)}" target="_blank" rel="noopener">Sheet</a>`
          );
        if (p.faq_link)
          links.push(
            `<a href="${esc(p.faq_link)}" target="_blank" rel="noopener">FAQ</a>`
          );
        if (p.invoice_link)
          links.push(
            `<a href="${esc(p.invoice_link)}" target="_blank" rel="noopener">Invoice</a>`
          );

        const lastSentHtml = p.last_sent
          ? esc(fmtShortDate(p.last_sent))
          : '<span class="null-callout" title="null last_sent">— null</span>';

        const dueHtml = p.due_date
          ? esc(fmtShortDate(p.due_date))
          : '<span class="dash">—</span>';

        const pri =
          p.priority_level && p.priority_level !== '-'
            ? `<span class="pill ${pillClass(p.priority_level)}">${esc(p.priority_level)}</span>`
            : '<span class="dash">—</span>';

        return `<tr>
          <td class="name-cell">${esc(p.name || '—')}${
            p.product ? `<span class="product">${esc(p.product)}</span>` : ''
          }</td>
          <td class="cell-muted">${dash(p.brand)}</td>
          <td><span class="pill ${pillClass(p.team_status)}">${esc(p.team_status || '—')}</span></td>
          <td>${tagHtml}</td>
          <td class="cell-muted">${lastSentHtml}</td>
          <td class="cell-muted">${dueHtml}</td>
          <td>${pri}</td>
          <td class="cell-muted">${dash(p.ownership)}</td>
          <td><div class="links">${
            links.length ? links.join('') : '<span class="dash">—</span>'
          }</div></td>
        </tr>`;
      })
      .join('');
  }

  function renderKpis() {
    const week = state.zero || state.snapshot?.week || {};
    const products = week.products || [];
    const issued = week.total != null ? Number(week.total).toLocaleString() : '—';
    $('kpi-issued').textContent = issued;
    $('kpi-brands').textContent = week.brands != null ? week.brands : '—';
    $('kpi-products').textContent = products.length ? products.length : '—';
    $('kpi-ontime').textContent = '—';
    $('kpi-ontime-sub').textContent = 'not on API / not computable';

    const start = week.week_start || state.snapshot?.week?.week_start;
    const end = week.week_end || state.snapshot?.week?.week_end;
    if (start && end) {
      $('week-range').textContent = `${fmtShortDate(start)} – ${fmtShortDate(end)}`;
      $('kpi-issued-sub').textContent = `units · week of ${fmtShortDate(start)}`;
    }

    const exKpi = state.exceptions?.kpi;
    const delta =
      exKpi?.delta != null
        ? Number(exKpi.delta)
        : week.delta_since_last_snapshot != null
          ? Number(week.delta_since_last_snapshot)
          : null;
    // A negative delta at a new week boundary is a rollover (not a decline).
    // Keep the context line calm; only show plausible same-week increases.
    const issuedNumber = week.total != null ? Number(week.total) : null;
    const isPlausibleSameWeekIncrease =
      delta != null &&
      !Number.isNaN(delta) &&
      delta > 0 &&
      (issuedNumber == null || Number.isNaN(issuedNumber) || delta <= issuedNumber);
    const deltaPart = isPlausibleSameWeekIncrease ? ` · Δ +${delta}` : '';
    $('context-summary-meta').textContent = `Issued ${issued}${deltaPart} · On-time — (not on API)`;
  }

  function renderChart() {
    const week = state.zero || state.snapshot?.week || {};
    const products = [...(week.products || [])].sort(
      (a, b) => (b.totalQuantity || 0) - (a.totalQuantity || 0)
    );
    const max = Math.max(...products.map((p) => p.totalQuantity || 0), 1);
    const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))];

    $('brand-chips').innerHTML = brands
      .map((b) => `<span class="chip">${esc(b)}</span>`)
      .join('');

    if (!products.length) {
      $('product-chart').innerHTML =
        '<div class="empty-state"><strong>No product data</strong>Zero-transactions scoreboard empty.</div>';
      return;
    }

    $('product-chart').innerHTML = products
      .map((p) => {
        const pct = Math.round(((p.totalQuantity || 0) / max) * 100);
        const label = `<strong>${esc(p.product || '—')}</strong> · ${esc(p.brand || '')}`;
        return `<div class="bar-row">
          <div class="bar-label" title="${esc(p.product)}">${label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="bar-val">${(p.totalQuantity || 0).toLocaleString()}</div>
        </div>`;
      })
      .join('');
  }

  function renderActivity() {
    const sheets = state.snapshot?.sheets || {};
    const rows24 = [];
    const rowsWeek = [];
    let sum24 = 0;
    let sumWeek = 0;

    for (const [name, sh] of Object.entries(sheets)) {
      if (!sh || sh.readable === false) continue;
      const r24 = sh.recent_24h;
      const rw = sh.recent_week;
      if (typeof r24 === 'number' && r24 > 0) {
        rows24.push({ name, n: r24 });
        sum24 += r24;
      }
      if (typeof rw === 'number' && rw > 0) {
        rowsWeek.push({ name, n: rw });
        sumWeek += rw;
      }
    }

    rows24.sort((a, b) => b.n - a.n);
    rowsWeek.sort((a, b) => b.n - a.n);

    $('sum-24h').textContent = sum24.toLocaleString();
    $('sum-week').textContent = sumWeek.toLocaleString();

    const fill = (cardId, rows, emptyTitle, emptySub) => {
      const card = $(cardId);
      const h3 = card.querySelector('h3');
      const body =
        rows.length === 0
          ? `<div class="empty-state"><strong>${esc(emptyTitle)}</strong>${esc(emptySub)}</div>`
          : rows
              .map(
                (r) => `<div class="activity-row">
                  <span>${esc(r.name)}</span>
                  <span class="n">${r.n.toLocaleString()}</span>
                </div>`
              )
              .join('');
      card.innerHTML = '';
      card.appendChild(h3);
      const wrap = document.createElement('div');
      wrap.innerHTML = body;
      while (wrap.firstChild) card.appendChild(wrap.firstChild);
    };

    fill(
      'activity-24h',
      rows24,
      'No dated activity',
      'Nothing in the last 24h window across readable sheets.'
    );
    fill(
      'activity-week',
      rowsWeek,
      'No dated activity',
      'Nothing since week start across readable sheets.'
    );
  }

  function renderMeta() {
    const gen = state.snapshot?.generated_at;

    // Separate quiet chips = data-source status only (never work queues)
    const promoSrc = state.sources.promotions;
    const weekSrc = state.sources.zero;
    const promoKind =
      promoSrc === 'live' ? 'live' : promoSrc === 'cache' ? 'cache' : 'error';
    const weekKind =
      weekSrc === 'live' ? 'live' : weekSrc === 'cache' ? 'cache' : 'error';
    const promoLabel =
      promoSrc === 'live'
        ? 'Promotions live'
        : promoSrc === 'cache'
          ? 'Promotions cache'
          : 'Promotions offline';
    const weekLabel =
      weekSrc === 'live'
        ? 'Week issued live'
        : weekSrc === 'cache'
          ? 'Week issued cache'
          : 'Week issued offline';

    setBadge('badge-promos', promoLabel, promoKind);
    setBadge('badge-week', weekLabel, weekKind);

    $('updated-at').textContent = gen
      ? `Snapshot ${fmtDate(gen)}`
      : `Refreshed ${fmtDate(new Date().toISOString())}`;

    const modeLabel = CONFIG.mode === 'static' ? 'static host' : 'local :8787';
    $('footer-source').textContent = `Snapshot ${
      gen ? fmtShortDate(gen) : '—'
    } · ${modeLabel} · sources: promotions API · week issued · read-only`;
  }

  function renderAll() {
    renderBlockers();
    renderExceptions();
    renderPromoFilters();
    renderPromos();
    renderKpis();
    renderChart();
    renderActivity();
    renderMeta();
  }

  async function load() {
    const btn = $('btn-refresh');
    if (btn) btn.disabled = true;
    $('error-slot').innerHTML = '';

    const ep = CONFIG.endpoints;
    const fb = CONFIG.fallbacks || {};

    const results = await Promise.allSettled([
      fetchJson(ep.snapshot),
      fetchJson(ep.exceptions),
      fetchJson(ep.promotions),
      fetchJson(ep.zeroTransactions),
      fetchJson(ep.l2eUnits),
    ]);

    const [snapR, exR, promoR, zeroR, l2eR] = results;

    if (snapR.status === 'fulfilled') {
      state.snapshot = snapR.value.data;
      state.sources.snapshot = CONFIG.mode === 'static' ? 'bundle' : 'ok';
    } else {
      try {
        const r = await fetchJson(fb.snapshot || './snapshot.json');
        state.snapshot = r.data;
        state.sources.snapshot = 'fallback';
      } catch {
        state.sources.snapshot = 'error';
      }
    }

    if (exR.status === 'fulfilled') {
      state.exceptions = normalizeExceptions(exR.value.data);
    } else if (state.snapshot?.promotions?.exceptions) {
      state.exceptions = normalizeExceptions({
        generated_at: state.snapshot.generated_at,
        queue: state.snapshot.promotions.exceptions,
      });
    }

    if (promoR.status === 'fulfilled') {
      state.promotions = Array.isArray(promoR.value.data)
        ? promoR.value.data
        : promoR.value.data?.promotions || [];
      state.sources.promotions = promoR.value.source || 'ok';
    } else {
      state.sources.promotions = 'error';
      state.promotions = [];
    }

    if (zeroR.status === 'fulfilled') {
      state.zero = zeroR.value.data;
      state.sources.zero = zeroR.value.source || 'ok';
    } else {
      state.sources.zero = 'error';
      state.zero = state.snapshot?.week || null;
    }

    if (l2eR.status === 'fulfilled') {
      state.l2eUnits = l2eR.value.data;
      state.sources.l2eUnits = CONFIG.mode === 'static' ? 'bundle' : 'ok';
    } else {
      try {
        const r = await fetchJson(fb.l2eUnits || './unit-counts.json');
        state.l2eUnits = r.data;
        state.sources.l2eUnits = 'fallback';
      } catch {
        state.l2eUnits = null;
        state.sources.l2eUnits = 'error';
      }
    }

    const errs = [];
    if (snapR.status === 'rejected') errs.push('snapshot unavailable');
    if (exR.status === 'rejected')
      errs.push('exceptions unavailable (using snapshot if present)');
    if (promoR.status === 'rejected') errs.push('promotions API unavailable');
    if (zeroR.status === 'rejected') errs.push('zero-transactions API unavailable');
    if (l2eR.status === 'rejected' && state.sources.l2eUnits === 'error')
      errs.push('L2E unit-counts unavailable');

    if (errs.length && !state.snapshot) {
      $('error-slot').innerHTML = `<div class="error-banner">${esc(errs.join(' · '))}</div>`;
    } else if (errs.length) {
      $('error-slot').innerHTML = `<div class="error-banner soft">${esc(errs.join(' · '))}</div>`;
    }

    renderAll();
    if (btn) btn.disabled = false;
  }

  function bind() {
    $('btn-refresh')?.addEventListener('click', () => load());
    $('promo-filters')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      state.promoFilter = btn.dataset.filter || 'all';
      $('promo-filters').querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderPromos();
    });
    $('ex-filters')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      state.exFilter = btn.dataset.exFilter || 'all';
      $('ex-filters').querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderExceptions();
    });
    $('ex-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ex-toggle]');
      if (!btn) return;
      const item = btn.closest('.ex-item');
      if (!item) return;
      const open = item.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  bind();
  load();
})();
