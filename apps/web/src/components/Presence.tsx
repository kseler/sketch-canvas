import { usePeers, type Peer } from '../hooks/usePeers';
import { initials } from '../lib/identity';
import type { Awareness } from '../sync/room';
import { NameEditor } from './NameEditor';

type Props = { awareness: Awareness; onRename: (name: string) => void };

const MAX_AVATARS = 4;
const AVATAR = 32;

// Only who is here, not where their cursor is: cursor moves don't re-render the avatars.
type Member = Pick<Peer, 'clientId' | 'isSelf' | 'name' | 'color'>;
const toMember = ({ clientId, isSelf, name, color }: Peer): Member => ({ clientId, isSelf, name, color });

// "3 online", a stack of avatars (overflow shown as +N) and your own editable name.
export function Presence({ awareness, onRename }: Props) {
  const peers = usePeers(awareness, toMember);
  const shown = peers.slice(0, MAX_AVATARS);
  const hidden = peers.length - shown.length;
  const self = peers.find((p) => p.isSelf);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ color: '#555', fontSize: 14 }}>
        <span style={{ color: '#22a55b' }}>●</span> {peers.length} online
      </span>
      <div style={{ display: 'flex' }}>
        {shown.map((peer, i) => (
          <Avatar key={peer.clientId} peer={peer} overlap={i > 0} />
        ))}
        {hidden > 0 && <Bubble color="#777" text={`+${hidden}`} title={`${hidden} more`} overlap />}
      </div>
      {self && <NameEditor name={self.name} onRename={onRename} />}
    </div>
  );
}

function Avatar({ peer, overlap }: { peer: Member; overlap: boolean }) {
  const title = peer.isSelf ? `${peer.name} (you)` : peer.name;
  return <Bubble color={peer.color} text={initials(peer.name)} title={title} overlap={overlap} />;
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
