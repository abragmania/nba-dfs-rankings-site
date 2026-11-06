// Design colours for the 30 NBA teams (not figures). c: implied-points bar; t1: main row tint and stripe; t2: second tint;
// t3 (optional, only where the logo really has a third colour): a further choice for colours.js. They are the team's logo colours.
// t1 and t2 are lifted for a dark page. Keys are the abbreviations DraftKings and TwoGun use.
export const TEAMS = {
  ATL: { c: "#E03A3E", t1: "#e8484c", t2: "#d9d9de" },
  BKN: { c: "#cfcfd6", t1: "#9a9aa3", t2: "#e8e8e8" },
  BOS: { c: "#007A33", t1: "#1fa35c", t2: "#bb9753" },
  CHA: { c: "#1fa3b8", t1: "#1fa3b8", t2: "#6a4fd0" },
  CHI: { c: "#CE1141", t1: "#ee2a52", t2: "#6b6b73" },
  CLE: { c: "#b8244f", t1: "#b8244f", t2: "#FDBB30" },
  DAL: { c: "#2a7fd0", t1: "#2a7fd0", t2: "#8a95a3" },
  DEN: { c: "#FEC524", t1: "#FEC524", t2: "#3a6fc4", t3: "#b8404f" },
  DET: { c: "#C8102E", t1: "#e0213f", t2: "#2f6fd0" },
  GSW: { c: "#FFC72C", t1: "#3a6fd6", t2: "#FFC72C" },
  HOU: { c: "#CE1141", t1: "#ee2a52", t2: "#9aa0a8" },
  IND: { c: "#FDBB30", t1: "#FDBB30", t2: "#3a5fb0" },
  LAC: { c: "#2f6fd0", t1: "#2f6fd0", t2: "#e0213f" },
  LAL: { c: "#552583", t1: "#8a4fd1", t2: "#FDB927" },
  MEM: { c: "#6f8cc4", t1: "#6f8cc4", t2: "#F5B112" },
  MIA: { c: "#c01e4a", t1: "#c01e4a", t2: "#F9A01B" },
  MIL: { c: "#00471B", t1: "#2e9a52", t2: "#EEE1C6" },
  MIN: { c: "#3f86c0", t1: "#3f86c0", t2: "#78BE20" },
  NOP: { c: "#B4975A", t1: "#3a73c4", t2: "#B4975A", t3: "#e0434f" },
  NYK: { c: "#F58426", t1: "#F58426", t2: "#2f7fd6" },
  OKC: { c: "#1f9ae0", t1: "#1f9ae0", t2: "#EF3B24" },
  ORL: { c: "#1f96e0", t1: "#1f96e0", t2: "#9aa0a8" },
  PHI: { c: "#2a8ad8", t1: "#2a8ad8", t2: "#ED174C" },
  PHX: { c: "#E56020", t1: "#E56020", t2: "#8a5cd6", t3: "#fdb827" },
  POR: { c: "#E03A3E", t1: "#ee4a4e", t2: "#8a8a93" },
  SAC: { c: "#8a54c4", t1: "#8a54c4", t2: "#9aa0a8" },
  SAS: { c: "#b5bfc7", t1: "#b5bfc7", t2: "#6b6b73" },
  TOR: { c: "#CE1141", t1: "#ee2a52", t2: "#9aa0a8" },
  UTA: { c: "#F9A01B", t1: "#7a45c8", t2: "#F9A01B" },
  WAS: { c: "#E31837", t1: "#ee3552", t2: "#2f6fd0" },
};

/** Neutral grey for a team code the table does not know. */
export const UNKNOWN_TEAM = { c: "#8a8a93", t1: "#8a8a93", t2: "#55555d" };

/** A team's logo colours in preference order [t1, t2, t3 if it has one]; an unknown team has just the neutral grey. */
export const paletteOf = (code) => {
  const t = TEAMS[code];
  return t ? [t.t1, t.t2, t.t3].filter(Boolean) : [UNKNOWN_TEAM.t1];
};
export const teamColors = (code) => TEAMS[code] ?? UNKNOWN_TEAM;
export const isKnownTeam = (code) => Object.prototype.hasOwnProperty.call(TEAMS, code);
