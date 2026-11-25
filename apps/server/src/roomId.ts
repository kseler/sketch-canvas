// Same rule as the web app's isValidRoomId (apps/web/src/lib/roomId.ts); the server can't import it,
// so it is repeated here. Kept in sync by the tests on both sides (roomId.test.ts).
export const ROOM_ID = /^[a-z0-9-]{1,64}$/;
