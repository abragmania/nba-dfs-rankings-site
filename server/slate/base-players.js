// The players a send is planned and restored against (R4, Adam 11-13): the board's own, with our minutes engine's figures on, so a send's "from" and a restore go to what the board shows; else the
// slate's own with the reason. One copy for the console route (the page's send), the server's news pass and the server's resend (resend.js).

/**
 * `ourPlayers`: (slate, slateData, { nowMs }) -> slateData with our figures (minutes/board.js withOurProjection) or null for none. Returns { players, note }; players are the engine's whenever it gave any
 * (the slate's own only when none is wired); note says what was off (a problem the engine reported, a source other than ours), recorded in resend.json (G62).
 */
export function basePlayers(slate, slateData, nowMs, ourPlayers) {
  const raw = slateData.players ?? [];
  if (!ourPlayers) return { players: raw, note: "the slate's own figures (no engine wired)" };
  const ours = ourPlayers(slate, slateData, { nowMs });
  if (!ours) return { players: raw, note: "the slate's own figures (the engine gave none)" };
  // Exactly the players effectivePlayers merges the overrides onto, so a send compares with and restores to what the board shows; a problem is a note, never a switch to other players.
  const note = ours.proj_problem ? `the engine reported: ${ours.proj_problem}` : ours.proj_source !== "ours" ? `the projection source is ${ours.proj_source ?? "unknown"}` : null;
  return { players: ours.players ?? raw, note };
}
