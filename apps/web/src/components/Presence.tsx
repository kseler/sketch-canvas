import { useMemo } from 'react';
import { usePeers, type Peer } from '../hooks/usePeers';
import { initials } from '../lib/identity';
import { groupByPerson, type Person } from '../lib/people';
import type { Awareness } from '../sync/room';
import { NameEditor } from './NameEditor';

type Props = { awareness: Awareness; onRename: (name: string) => void };

const MAX_AVATARS = 4;
const AVATAR = 32;

// Only who is here, not where their cursor is: cursor moves don't re-render the avatars.
type Member = Pick<Peer, 'clientId' | 'personId' | 'isMe' | 'name' | 'color'>;
const toMember = ({ clientId, personId, isMe, name, color }: Peer): Member => ({ clientId, personId, isMe, name, color });

// "3 online", a stack of avatars (overflow shown as +N) and your own editable name. Counts people,
// not tabs: your 2 tabs are one avatar.
export function Presence({ awareness, onRename }: Props) {
  const members = usePeers(awareness, toMember);
  const people = useMemo(() => groupByPerson(members), [members]);
  const shown = people.slice(0, MAX_AVATARS);
  const hidden = people.length - shown.length;
  const me = people.find((p) => p.isMe);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ color: '#555', fontSize: 14 }}>
        <span style={{ color: '#22a55b' }}>●</span> {people.length} online
      </span>
      <div style={{ display: 'flex' }}>
        {shown.map((person, i) => (
          <Avatar key={person.personId} person={person} overlap={i > 0} />
        ))}
        {hidden > 0 && <Bubble color="#777" text={`+${hidden}`} title={`${hidden} more`} overlap />}
      </div>
      {me && <NameEditor name={me.name} onRename={onRename} />}
    </div>
  );
}

function Avatar({ person, overlap }: { person: Person; overlap: boolean }) {
  const title = `${person.name}${person.isMe ? ' (you)' : ''}${person.tabs > 1 ? ` · ${person.tabs} tabs` : ''}`;
  return <Bubble color={person.color} text={initials(person.name)} title={title} overlap={overlap} />;
}

function Bubble({ color, text, title, overlap }: { color: string; text: string; title: string; overlap: boolean }) {
  return (
    <span
      title={title}
      style={{
        width: AVATAR,
        height: AVATAR,
        marginLeft: overlap ? -8 : 0,
        borderRadius: '50%',
        border: '2px solid #fff',
        background: color,
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {text}
    </span>
  );
}
