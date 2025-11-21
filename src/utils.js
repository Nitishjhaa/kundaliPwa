function normalize360(deg){ let x=deg%360; if(x<0)x+=360; return x; }
function toDMS(deg){ const d=Math.floor(deg); const mF=(deg-d)*60; const m=Math.floor(mF); const s=Math.round((mF-m)*60); return {d,m,s}; }
const RASHIS=['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
function getRashi(deg){ const d=normalize360(deg); const index=Math.floor(d/30); return { index, name:RASHIS[index] }; }
function getDegreeInSign(deg){ const d=normalize360(deg); const within=d%30; const dms=toDMS(within); return { value:within, dms }; }
const NAKS=['Ashwini','Bharani','Krittika','Rohini','Mrigashirsha','Ardra','Punarvasu','Pushya','Ashlesha','Magha','Purva_Phalguni','Uttara_Phalguni','Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha','Mula','Purva_Ashadha','Uttara_Ashadha','Shravana','Dhanishta','Shatabhisha','Purva_Bhadrapada','Uttara_Bhadrapada','Revati'];
const NAK_LEN_DEG=360/27;
function getNakshatra(deg){ const d=normalize360(deg); const idx=Math.floor(d/NAK_LEN_DEG); const within=d-idx*NAK_LEN_DEG; const frac=within/NAK_LEN_DEG; const pada=Math.floor(frac*4)+1; return { index:idx, name:NAKS[idx], fracElapsed:frac, pada }; }
function isRetro(speed){ return speed<0; }
function angDist(a,b){ const x=Math.abs(normalize360(a)-normalize360(b)); return x>180?360-x:x; }
const COMBUST_THRESH={Mercury:12,Venus:10,Mars:17,Jupiter:11,Saturn:15};
function isCombust(name,lon,sun){ const th=COMBUST_THRESH[name]; if(!th) return false; return angDist(lon,sun)<=th; }
module.exports={normalize360,toDMS,getRashi,getDegreeInSign,getNakshatra,isRetro,isCombust,NAK_LEN_DEG};