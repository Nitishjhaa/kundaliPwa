const swe = require("swisseph");
const moment = require("moment-timezone");

const {
  normalize360,
  getRashi,
  getDegreeInSign,
  getNakshatra,
  isRetro,
  isCombust
} = require("./utils");

const FLAGS_TROP = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;
const FLAGS_SID = swe.SEFLG_SWIEPH | swe.SEFLG_SIDEREAL | swe.SEFLG_SPEED;

const PLANETS = {
  Sun: swe.SE_SUN,
  Moon: swe.SE_MOON,
  Mars: swe.SE_MARS,
  Mercury: swe.SE_MERCURY,
  Jupiter: swe.SE_JUPITER,
  Venus: swe.SE_VENUS,
  Saturn: swe.SE_SATURN,
  Rahu: swe.SE_MEAN_NODE
};

// =========================
// Convert date → Julian day
// =========================
function toJulianUTC(date, time, tz) {
  const m = moment.tz(`${date} ${time}`, tz).utc();
  const hour = m.hour() + m.minute() / 60 + m.second() / 3600;

  const JD = swe.swe_julday(
    m.year(),
    m.month() + 1,
    m.date(),
    hour,
    swe.SE_GREG_CAL
  );

  return { JD, m };
}

// =========
// Planets
// =========
function calcPlanet(JD, code, flags) {
  return new Promise((resolve, reject) => {
    swe.swe_calc_ut(JD, code, flags, (res) => {
      if (!res || res.error) {
        return reject(new Error(res?.error || "swe_calc_ut failed"));
      }
      resolve(res);
    });
  });
}

// =========
// Houses (tropical cusps)
// =========
function calcHouses(JD, lat, lon) {
  return new Promise((resolve, reject) => {
    swe.swe_houses(JD, lat, lon, "P", (res) => {
      if (!res || !res.ascendant) {
        return reject(new Error("House calculation failed"));
      }

      const cusps = res.house || res.houses || res.houseCusps || res.cusps;

      resolve({
        tropicalAsc: normalize360(res.ascendant),
        tropicalCusps: cusps.slice(0, 12).map(normalize360)
      });
    });
  });
}

// ============================
// Main Kundali Engine Function
// ============================
async function computeKundali({ birthDate, birthTime, timeZone, lat, lon }) {
  if (!birthDate || !birthTime || !timeZone || typeof lat !== "number" || typeof lon !== "number") {
    throw new Error("Invalid payload");
  }

  const { JD, m } = toJulianUTC(birthDate, birthTime, timeZone);

  // ================
  // Planet positions
  // ================
  const planets = {};

  for (const [name, code] of Object.entries(PLANETS)) {
    const trop = await calcPlanet(JD, code, FLAGS_TROP);
    const sid = await calcPlanet(JD, code, FLAGS_SID);

    const sidDeg = normalize360(sid.longitude);
    const rashi = getRashi(sidDeg);
    const ansh = getDegreeInSign(sidDeg);
    const nak = getNakshatra(sidDeg);

    planets[name] = {
      tropical: normalize360(trop.longitude),
      sidereal: sidDeg,
      speed: sid.speed,
      retrograde: isRetro(sid.speed),
      rashi: rashi.name,
      rashiIndex: rashi.index,
      ansh: ansh.value,
      anshDMS: ansh.dms,
      nakshatra: nak.name,
      nakshatraIndex: nak.index,
      pada: nak.pada
    };
  }

  // --------
  // Ketu (opposite of Rahu) — recompute rashi/ansh/nakshatra for correct indices
  // --------
  if (planets.Rahu) {
    const rahu = planets.Rahu;
    const ketuSid = normalize360(rahu.sidereal + 180);
    const ketuTrop = normalize360(rahu.tropical + 180);
    const kr = getRashi(ketuSid);
    const ka = getDegreeInSign(ketuSid);
    const kn = getNakshatra(ketuSid);

    planets.Ketu = {
      tropical: ketuTrop,
      sidereal: ketuSid,
      speed: rahu.speed,
      retrograde: rahu.retrograde,
      rashi: kr.name,
      rashiIndex: kr.index,
      ansh: ka.value,
      anshDMS: ka.dms,
      nakshatra: kn.name,
      nakshatraIndex: kn.index,
      pada: kn.pada
    };
  }

  // Combust checks (needs sun sidereal)
  const sunSid = planets.Sun.sidereal;
  for (const k of Object.keys(planets)) {
    planets[k].combust = isCombust(k, planets[k].sidereal, sunSid);
  }

  // ===============================
  // ✅ Correct Ascendant Calculation (sidereal)
  // ===============================
  const housesTrop = await calcHouses(JD, lat, lon);

  const tropicalAsc = housesTrop.tropicalAsc;
  const tropicalCusps = housesTrop.tropicalCusps;

  const ayanamsa = swe.swe_get_ayanamsa(JD);

  const siderealAsc = normalize360(tropicalAsc - ayanamsa);
  const siderealCusps = tropicalCusps.map(c => normalize360(c - ayanamsa));

  // Derived ascendant info
  const ascR = getRashi(siderealAsc);
  const ascAn = getDegreeInSign(siderealAsc);
  const ascNak = getNakshatra(siderealAsc);

  const ascendant = {
    sidereal: siderealAsc,
    rashi: ascR.name,
    rashiIndex: ascR.index,
    ansh: ascAn.value,
    anshDMS: ascAn.dms,
    nakshatra: ascNak.name,
    nakshatraIndex: ascNak.index,
    pada: ascNak.pada
  };

  // ======================================
  // ⭐ Add Maargi/Bakri and sign-based house number
  // ======================================
  const ascRashiIndex = ascendant.rashiIndex;

  for (const [pname, pObj] of Object.entries(planets)) {
    // motion
    pObj.motion = pObj.retrograde ? "Bakri" : "Maargi";

    // determine planet rashi index (fallback to compute from sidereal)
    const planetRashiIndex =
      typeof pObj.rashiIndex === "number"
        ? pObj.rashiIndex
        : Math.floor(normalize360(pObj.sidereal) / 30);

    // whole-sign house number (House 1 = ascendant.rashiIndex)
    const houseNumber = ((planetRashiIndex - ascRashiIndex + 12) % 12) + 1;
    pObj.house = houseNumber;
  }

  return {
    meta: {
      datetimeUTC: m.toISOString(),
      JD
    },
    planets,
    ascendant,
    houses: siderealCusps
  };
}

module.exports = { computeKundali };
