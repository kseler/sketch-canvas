import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH } from './identity';
import { groupByPerson, peersFromStates, type AwarenessStates } from './people';

const ME = 'aaaa-1111';
const OTHER = 'bbbb-2222';
const user = (over: Record<string, unknown> = {}) => ({ id: ME, name: 'Blue Fox', color: '#e76f51', ...over });
const stroke = { color: '#000000', width: 4, points: [0, 0, 1, 1] };

const states = (entries: [number, Record<string, unknown>][]): AwarenessStates => new Map(entries);

describe('peersFromStates', () => {
  it('builds a peer from a valid state', () => {
    const peers = peersFromStates(states([[1, { user: user(), cursor: { x: 1, y: 2 }, drawing: stroke }]]), 1);
    expect(peers).toEqual([
      {
        clientId: 1,
        personId: ME,
        isSelf: true,
        isMe: true,
        name: 'Blue Fox',
        color: '#e76f51',
        cursor: { x: 1, y: 2 },
        drawing: stroke,
      },
    ]);
  });

  it.each([
    ['no user', {}],
    ['null user', { user: null }],
    ['user with a CSS color', { user: user({ color: 'url(http://evil.test/x)' }) }],
    ['user with a blank name', { user: user({ name: '   ' }) }],
    ['user with an id containing ":"', { user: user({ id: 'tab:2' }) }],
    ['user with an uppercase id', { user: user({ id: 'ABC' }) }],
    ['user with an over-long id', { user: user({ id: 'a'.repeat(65) }) }],
  ])('drops a tab with %s', (_label, state) => {
    const peers = peersFromStates(states([[1, { user: user() }], [2, state]]), 1);
    expect(peers.map((p) => p.clientId)).toEqual([1]);
  });

  it.each([
    ['string', 'x'],
    ['NaN coordinate', { x: NaN, y: 0 }],
    ['Infinity coordinate', { x: 0, y: Infinity }],
    ['missing y', { x: 1 }],
    ['null', null],
  ])('turns a bad cursor (%s) into null', (_label, cursor) => {
    const [peer] = peersFromStates(states([[1, { user: user(), cursor }]]), 1);
    expect(peer!.cursor).toBeNull();
  });

  it.each([
    ['CSS color', { ...stroke, color: 'url(http://evil.test/x)' }],
    ['NaN point', { ...stroke, points: [0, NaN] }],
    ['zero width', { ...stroke, width: 0 }],
    ['string', 'scribble'],
  ])('turns a bad drawing (%s) into null but keeps the peer', (_label, drawing) => {
    const [peer] = peersFromStates(states([[1, { user: user(), drawing }]]), 1);
    expect(peer).toBeDefined();
    expect(peer!.drawing).toBeNull();
  });

  it('gives null cursor and drawing when absent', () => {
    const [peer] = peersFromStates(states([[1, { user: user() }]]), 1);
    expect(peer!.cursor).toBeNull();
    expect(peer!.drawing).toBeNull();
  });

  it('keeps the same drawing object, so an unchanged stroke keeps its identity', () => {
    const drawing = { ...stroke };
    const [peer] = peersFromStates(states([[1, { user: user(), drawing }]]), 1);
    expect(peer!.drawing).toBe(drawing);
  });

  it('cleans long names from other players', () => {
    const [, other] = peersFromStates(
      states([[1, { user: user() }], [2, { user: user({ id: OTHER, name: `  ${'x'.repeat(MAX_NAME_LENGTH + 10)}` }) }]]),
      1,
    );
    expect(other!.name).toBe('x'.repeat(MAX_NAME_LENGTH));
  });

  it('marks isSelf only for the given client id', () => {
    const peers = peersFromStates(states([[1, { user: user() }], [2, { user: user() }], [3, { user: user({ id: OTHER }) }]]), 2);
    expect(peers.filter((p) => p.isSelf).map((p) => p.clientId)).toEqual([2]);
  });

  it('marks isMe for every tab with the same person id, and not for others', () => {
    const peers = peersFromStates(states([[1, { user: user() }], [2, { user: user() }], [3, { user: user({ id: OTHER }) }]]), 1);
    expect(Object.fromEntries(peers.map((p) => [p.clientId, p.isMe]))).toEqual({ 1: true, 2: true, 3: false });
  });

  it('treats a tab without a person id as its own person (tab:<clientId>)', () => {
    const noId = { name: 'Old Tab', color: '#e76f51' };
    const peers = peersFromStates(states([[1, { user: noId }], [2, { user: noId }]]), 1);
    expect(peers.map((p) => p.personId)).toEqual(['tab:1', 'tab:2']);
    expect(peers.map((p) => p.isMe)).toEqual([true, false]);
  });

  it('does not let a peer without an id be one of my tabs, even if my tab has an id', () => {
    const peers = peersFromStates(states([[1, { user: user() }], [2, { user: { name: 'X', color: '#e76f51' } }]]), 1);
    expect(peers[1]!.isMe).toBe(false);
  });

  it('cannot be tricked into isMe by an id equal to the fallback of my id-less tab', () => {
    const peers = peersFromStates(
      states([[1, { user: { name: 'Me', color: '#e76f51' } }], [2, { user: user({ id: 'tab:1' }) }]]),
      1,
    );
    expect(peers.map((p) => p.clientId)).toEqual([1]); // the hostile tab is dropped (':' is invalid)
  });

  it('works when this tab has not announced itself yet: nobody is me', () => {
    const peers = peersFromStates(states([[2, { user: user({ id: OTHER }) }]]), 1);
    expect(peers).toHaveLength(1);
    expect(peers[0]!.isSelf).toBe(false);
    expect(peers[0]!.isMe).toBe(false);
  });

  it('orders this tab, then your other tabs, then others, keeping join order within each group', () => {
    const peers = peersFromStates(
      states([
        [10, { user: user({ id: OTHER }) }],
        [11, { user: user() }],
        [12, { user: user({ id: 'cccc' }) }],
        [13, { user: user() }], // this tab
        [14, { user: user() }],
      ]),
      13,
    );
    expect(peers.map((p) => p.clientId)).toEqual([13, 11, 14, 10, 12]);
  });

  it('returns an empty list for no states', () => {
    expect(peersFromStates(states([]), 1)).toEqual([]);
  });
});

describe('groupByPerson', () => {
  const p = (personId: string, name: string, color = '#111111', isMe = false) => ({ personId, isMe, name, color });

  it('returns one entry per person with the number of tabs', () => {
    expect(groupByPerson([p('a', 'A'), p('b', 'B'), p('a', 'A'), p('a', 'A')]).map((x) => [x.personId, x.tabs])).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
  });

  it('takes name and color from the first tab in the list', () => {
    const [person] = groupByPerson([p('a', 'First', '#111111'), p('a', 'Second', '#222222')]);
    expect(person).toEqual({ personId: 'a', isMe: false, name: 'First', color: '#111111', tabs: 2 });
  });

  it('keeps the order of first appearance', () => {
    expect(groupByPerson([p('c', 'C'), p('a', 'A'), p('c', 'C'), p('b', 'B')]).map((x) => x.personId)).toEqual(['c', 'a', 'b']);
  });

  it('keeps isMe from the first tab', () => {
    expect(groupByPerson([p('a', 'A', '#111111', true), p('a', 'A', '#111111', true)])[0]!.isMe).toBe(true);
  });

  it('returns an empty list for no peers', () => {
    expect(groupByPerson([])).toEqual([]);
  });

  it('counts the people of real peers: two tabs of mine plus one other = 2 people', () => {
    const peers = peersFromStates(states([[1, { user: user() }], [2, { user: user() }], [3, { user: user({ id: OTHER }) }]]), 1);
    const people = groupByPerson(peers);
    expect(people.map((x) => [x.isMe, x.tabs])).toEqual([[true, 2], [false, 1]]);
  });
});
