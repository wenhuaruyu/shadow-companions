export function initialState() {
  return { phase: 'lobby', chapter: 0, players: [0, 1].map(() => ({
    int: 5, str: 5, ready: false, instruction: false, tutorial: false,
    entered: false, read: false, continued: false, role: null
  })) };
}

export function gameSnapshot(document) {
  const state = document.state || initialState();
  return {
    id: document.id, version: document.version, contentVersion: document.contentVersion,
    rulesVersion: 'mvp-rules-1', phase: state.phase, chapter: state.chapter,
    ended: false, outcome: null, paused: false, pause: null,
    requirements: { int: 5, str: 5 }, me: document.seat,
    players: state.players.slice(0, document.playerCount).map((player, seat) => ({
      name: seat ? '顾宁' : '林舟', int: player.int, str: player.str,
      ready: player.ready, instruction: player.instruction, tutorial: player.tutorial,
      entered: player.entered, read: player.read, continued: player.continued,
      online: false, event: null, investment: null
    })),
    attempt: null, questions: null, investmentDraft: null, records: []
  };
}
