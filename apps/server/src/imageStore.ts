import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Generated pictures live on our server, as files. The shared Yjs document only holds a small
// record pointing at them (CLAUDE.md instant-mode rule 1), never image bytes.

// The only file names we ever write or serve: a random UUID v4 + ".png". Anything else (paths,
// "..", other extensions) can't match, so the image route can't be used to read other files.
export const IMAGE_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/;

export const IMAGE_URL_PREFIX = '/api/images/';

export type StoredImage = { id: string; url: string };

export type ImageStore = {
  save(png: Uint8Array): Promise<StoredImage>;
  read(fileName: string): Promise<Uint8Array | null>;
};

// `newId` is for tests; the server always uses random UUIDs.
// Pictures are never deleted yet: the daily caps bound how fast they pile up (about 60 a day at
// the default $2). Cleanup (a retention period) is on the list before a public deploy.
export function createImageStore(dir: string, newId: () => string = randomUUID): ImageStore {
  return {
    async save(png) {
      await mkdir(dir, { recursive: true });
      const id = newId();
      // Written under a temporary name first, then linked into place, so a crash mid-write never
      // leaves a half-written picture under a real name. link() fails if the name exists: a stored
      // picture is never overwritten.
      const final = path.join(dir, `${id}.png`);
      const partial = `${final}.partial`;
      try {
        await writeFile(partial, png, { flag: 'wx' });
        await link(partial, final);
      } finally {
        // Never hides the real error; a leftover .partial is never served (wrong name).
        await unlink(partial).catch(() => {});
      }
      return { id, url: `${IMAGE_URL_PREFIX}${id}.png` };
    },
    async read(fileName) {
      if (!IMAGE_FILE_NAME.test(fileName)) return null;
      try {
        return await readFile(path.join(dir, fileName));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
