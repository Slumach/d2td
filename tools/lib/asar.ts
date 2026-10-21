// Reading Electron's asar archives, enough to list and hash what an installer ships.
// Layout: a pickled uint32 header size, then a pickled JSON string describing a file tree
// whose leaves give each file's size and its offset into the data after the header. Files
// marked "unpacked" live beside the archive in <name>.asar.unpacked instead.

import { closeSync, openSync, readSync } from 'node:fs';

export interface AsarEntry {
  /** Forward-slash path inside the archive. */
  path: string;
  size: number;
  /** Byte offset of the contents in the archive file; undefined when unpacked. */
  offset?: number;
  unpacked: boolean;
}

interface Node {
  files?: Record<string, Node>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
  link?: string;
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  readSync(fd, buf, 0, length, position);
  return buf;
}

export function listAsar(archive: string): AsarEntry[] {
  const fd = openSync(archive, 'r');
  try {
    // [uint32 4][uint32 headerPickleSize] then the header pickle: [uint32 payload][uint32 strlen][json]
    const headerSize = readAt(fd, 0, 8).readUInt32LE(4);
    const header = readAt(fd, 8, headerSize);
    const json = header.subarray(8, 8 + header.readUInt32LE(4)).toString('utf8');
    const dataStart = 8 + headerSize;
    const out: AsarEntry[] = [];
    const walk = (node: Node, prefix: string) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (child.files) walk(child, path);
        else if (child.link === undefined) {
          const unpacked = child.unpacked === true;
          out.push({ path, size: child.size ?? 0, unpacked, offset: unpacked ? undefined : dataStart + Number(child.offset ?? 0) });
        }
      }
    };
    walk(JSON.parse(json) as Node, '');
    return out;
  } finally {
    closeSync(fd);
  }
}

/** The contents of a packed entry. */
export function readAsarEntry(archive: string, entry: AsarEntry): Buffer {
  if (entry.offset === undefined) throw new Error(`${entry.path} is unpacked`);
  const fd = openSync(archive, 'r');
  try {
    return readAt(fd, entry.offset, entry.size);
  } finally {
    closeSync(fd);
  }
}
