import { useMemo } from 'react';
import { groupByPerson, type Person } from '../lib/people';
import type { Awareness } from '../sync/room';
import { usePeers, type Peer } from './usePeers';

// Only who is here, not where their cursor is: cursor moves don't re-render the people list.
type Member = Pick<Peer, 'clientId' | 'personId' | 'isMe' | 'name' | 'color'>;
const toMember = ({ clientId, personId, isMe, name, color }: Peer): Member => ({ clientId, personId, isMe, name, color });

// The people in the room, counted as people, not tabs: your 2 tabs are one person.
export function usePeople(awareness: Awareness | null): Person[] {
  const members = usePeers(awareness, toMember);
  return useMemo(() => groupByPerson(members), [members]);
}
