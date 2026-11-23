import { cleanName, isIdentity } from './identity';
import { isPoint, type Point } from './points';
import { isLiveStroke, type LiveStroke } from './strokes';

// One connected tab, as read from awareness.
// - `personId`: the browser it runs in (all your tabs share one), or a per-tab fallback for tabs
//   that send no id.
// - `isSelf`: this very tab. `isMe`: any of your tabs.
// - `cursor` is in canvas units, or null when the pointer is off the canvas.
// - `drawing` is the stroke they are drawing right now, or null.
export type Peer = {
  clientId: number;
  personId: string;
  isSelf: boolean;
  isMe: boolean;
  name: string;
  color: string;
  cursor: Point | null;
  drawing: LiveStroke | null;
};

// What y-websocket's awareness.getStates() returns: client id → that tab's state, untrusted.
export type AwarenessStates = ReadonlyMap<number, Record<string, unknown>>;

// Every tab that announced a valid identity: this tab first, then your other tabs, then everyone
// else in join order. Anything malformed from other clients is dropped.
export function peersFromStates(states: AwarenessStates, selfClientId: number): Peer[] {
  const myPersonId = personIdOf(states.get(selfClientId)?.user, selfClientId);
  const peers: Peer[] = [];
  states.forEach((state, clientId) => {
    const user: unknown = state.user;
    if (!isIdentity(user)) return; // connected, but hasn't announced itself yet
    const personId = personIdOf(user, clientId);
    const cursor: unknown = state.cursor;
    const drawing: unknown = state.drawing;
    peers.push({
      clientId,
      personId,
      isSelf: clientId === selfClientId,
      isMe: personId === myPersonId,
      name: cleanName(user.name),
      color: user.color,
      cursor: isPoint(cursor) ? cursor : null,
      // Same object as in awareness, so an unchanged stroke keeps its identity between reads.
      drawing: isLiveStroke(drawing) ? drawing : null,
    });
  });
  const rank = (p: Peer) => (p.isSelf ? 0 : p.isMe ? 1 : 2);
  return peers.sort((a, b) => rank(a) - rank(b)); // stable: join order kept within each group
}

// Tabs without a person id count as their own person. The ':' can't appear in a valid person id,
// so a peer can't pick an id that collides with this fallback.
function personIdOf(user: unknown, clientId: number): string {
  return isIdentity(user) && user.id ? user.id : `tab:${clientId}`;
}

// One person with all their tabs: name and color from their first tab in the list.
export type Person = { personId: string; isMe: boolean; name: string; color: string; tabs: number };

export function groupByPerson(peers: readonly Pick<Peer, 'personId' | 'isMe' | 'name' | 'color'>[]): Person[] {
  const people = new Map<string, Person>();
  for (const { personId, isMe, name, color } of peers) {
    const person = people.get(personId);
    if (person) person.tabs += 1;
    else people.set(personId, { personId, isMe, name, color, tabs: 1 });
  }
  return [...people.values()];
}
