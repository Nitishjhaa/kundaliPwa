// src/dasha/vimshottari.js
const moment = require('moment-timezone');
const interpretations = require('./interpretations.json');

// ---- Constants ----
const LORDS = [
  'Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'
];

const YEARS = {
  Ketu: 7,
  Venus: 20,
  Sun: 6,
  Moon: 10,
  Mars: 7,
  Rahu: 18,
  Jupiter: 16,
  Saturn: 19,
  Mercury: 17,
};

// Astronomical time constants (tropical/ephemeris year used by your prior code)
const MS_PER_DAY = 86400 * 1000;
const YEAR_MS = 31556952 * 1000; // 365.2425 days

// ---- Helpers ----
function normalize360(deg) {
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
}
const NAK_LEN_DEG = 360 / 27;

function nakFromLon(lonDeg) {
  const d = normalize360(lonDeg);
  const idx = Math.floor(d / NAK_LEN_DEG);
  const fracElapsed = (d - idx * NAK_LEN_DEG) / NAK_LEN_DEG;
  return { index: idx, fracElapsed };
}

function rotateFromStart(startLord) {
  const i = LORDS.indexOf(startLord);
  return LORDS.slice(i).concat(LORDS.slice(0, i));
}

function toISO(ms) {
  return new Date(ms).toISOString();
}

/**
 * Build a list of weighted segments (e.g., Antar or Pratyantar) inside a parent span.
 * The *weights* are the standard Vimshottari dasha years per lord.
 */
function buildWeightedSegments(parentStartMs, parentDurMs, order, weightsYears) {
  const totalYears = order.reduce((acc, lord) => acc + weightsYears[lord], 0);
  const out = [];
  let cursor = parentStartMs;

  for (let i = 0; i < order.length; i++) {
    const lord = order[i];
    // Last segment: fill remaining to avoid rounding gaps
    const segDur = (i < order.length - 1)
      ? parentDurMs * (weightsYears[lord] / totalYears)
      : (parentStartMs + parentDurMs - cursor);

    const startMs = cursor;
    const endMs = startMs + segDur;
    out.push({ lord, startMs, endMs, durationMs: segDur });
    cursor = endMs;
  }
  return out;
}

// ---- Interpretation lookup ----
/**
 * interpretations.json uses *lowercase* keys: "sun" -> { "moon": "...", ... }.
 * Our lords are capitalized ("Sun", "Moon", ...).
 */
function interpFor(md, ad) {
  const a = String(md || '').toLowerCase();
  const b = String(ad || '').toLowerCase();
  const mdBlock = interpretations[a];
  if (!mdBlock) return null;
  return mdBlock[b] || null;
}

// ---- Core: Compute Vimshottari ----
/**
 * Input:
 *  {
 *    birthDate: "YYYY-MM-DD",
 *    birthTime: "HH:mm[:ss]",
 *    timeZone:  "Asia/Kolkata",
 *    moonSiderealDeg: <Number>,  // REQUIRED (sidereal moon longitude in degrees)
 *    totalYears?: 120             // optional cap (default 120)
 *  }
 *
 * Output:
 *  {
 *    meta: { birthUTC, startLord },
 *    sequence: [
 *      {
 *        lord, start, end, years, days,
 *        antar: [
 *          {
 *            lord, start, end, interpretation,   // MD/AD interpretation
 *            pratyantar: [
 *              { lord, start, end, interpretation } // AD/PD interpretation
 *            ]
 *          }
 *        ]
 *      }
 *    ]
 *  }
 */
function computeVimshottari({
  birthDate,
  birthTime,
  timeZone,
  moonSiderealDeg,
  totalYears = 120,
}) {
  if (
    !birthDate ||
    !birthTime ||
    !timeZone ||
    typeof moonSiderealDeg !== 'number'
  ) {
    throw new Error('Invalid payload for computeVimshottari');
  }

  // Birth UTC in ms
  const birthMs = moment.tz(`${birthDate} ${birthTime}`, timeZone).utc().valueOf();

  // Find starting Nakshatra and its lord
  const nak = nakFromLon(moonSiderealDeg);
  const startLord = LORDS[nak.index % 9];

  // Remaining portion of the *starting* Mahadasha (portion left from birth)
  const mdTotalMs = YEAR_MS * YEARS[startLord];
  const elapsedMs = mdTotalMs * nak.fracElapsed;
  const mdRemainingMs = mdTotalMs - elapsedMs;

  const capEnd = birthMs + YEAR_MS * totalYears;

  const sequence = [];
  let mdStartMs = birthMs;
  let mdEndMs = Math.min(birthMs + mdRemainingMs, capEnd);

  // Helper to push one MD block with Antar & Pratyantar (with interpretations)
  const pushMD = (mdLord, mdStart, mdEnd) => {
    const mdDur = mdEnd - mdStart;
    // Antar order always starts from MD lord itself
    const antarOrder = rotateFromStart(mdLord);
    const antarSegs = buildWeightedSegments(mdStart, mdDur, antarOrder, YEARS);

    const antar = antarSegs.map(seg => {
      const adLord = seg.lord;
      const adInterpretation = interpFor(mdLord, adLord);

      // Pratyantar order always starts from the AD lord
      const pdOrder = rotateFromStart(adLord);
      const pdSegs = buildWeightedSegments(seg.startMs, seg.durationMs, pdOrder, YEARS);

      const pratyantar = pdSegs.map(pd => {
        const pdLord = pd.lord;
        // Interpretation for AD -> PD
        const pdInterpretation = interpFor(adLord, pdLord);
        return {
          lord: pdLord,
          start: toISO(pd.startMs),
          end: toISO(pd.endMs),
          interpretation: pdInterpretation || null,
        };
      });

      return {
        lord: adLord,
        start: toISO(seg.startMs),
        end: toISO(seg.endMs),
        interpretation: adInterpretation || null,
        pratyantar,
      };
    });

    sequence.push({
      lord: mdLord,
      start: toISO(mdStart),
      end: toISO(mdEnd),
      years: YEARS[mdLord],
      days: (mdDur / MS_PER_DAY),
      antar,
    });
  };

  // 1) First (partial) MD (remaining portion from birth)
  pushMD(startLord, mdStartMs, mdEndMs);
  mdStartMs = mdEndMs;

  if (mdStartMs >= capEnd) {
    return { meta: { birthUTC: toISO(birthMs), startLord }, sequence };
  }

  // Full-cycles builder from any lord
  const cycleOrder = rotateFromStart(startLord);

  // 2) Remaining MDs up to totalYears cap
  outer: for (;;) {
    for (let i = 1; i < cycleOrder.length; i++) {
      const lord = cycleOrder[i];
      const durMs = YEAR_MS * YEARS[lord];
      const mdEnd = mdStartMs + durMs;

      if (mdEnd > capEnd) {
        // Clip the last one and finish
        pushMD(lord, mdStartMs, capEnd);
        break outer;
      } else {
        pushMD(lord, mdStartMs, mdEnd);
        mdStartMs = mdEnd;
      }
    }

    // Complete cycles thereafter
    for (let i = 0; i < cycleOrder.length; i++) {
      const lord = cycleOrder[i];
      const durMs = YEAR_MS * YEARS[lord];
      const mdEnd = mdStartMs + durMs;

      if (mdEnd > capEnd) {
        pushMD(lord, mdStartMs, capEnd);
        break outer;
      } else {
        pushMD(lord, mdStartMs, mdEnd);
        mdStartMs = mdEnd;
      }
    }
  }

  return { meta: { birthUTC: toISO(birthMs), startLord }, sequence };
}

// Convenience wrapper compatible with your existing imports
function computeVimshottariFromMoon(args) {
  return computeVimshottari(args);
}

module.exports = {
  computeVimshottariFromMoon,
  computeVimshottari,
  LORDS,
  YEARS,
};
