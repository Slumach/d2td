// Where the pipeline reads game files from: a CascView export on disk, or the D2R CASC
// storage itself. Paths are relative to the CASC "data" root with forward slashes, e.g.
// "global/excel/monstats.txt".

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DataSource {
  /** A short description for logs and the setup screen. */
  readonly label: string;
  exists(path: string): boolean;
  read(path: string): Uint8Array;
  close(): void;
}

/** A CascView export: assets-raw, nesting the CASC "data" folder once or twice. */
export class FolderSource implements DataSource {
  readonly label: string;

  constructor(readonly root: string) {
    this.label = `folder ${root}`;
  }

  exists(path: string): boolean {
    return existsSync(join(this.root, path));
  }

  read(path: string): Uint8Array {
    const full = join(this.root, path);
    if (!existsSync(full)) throw new Error(`Missing file: ${full}`);
    return new Uint8Array(readFileSync(full));
  }

  close(): void {}
}

/** The subset of @jamiephan/casclib's Storage the pipeline uses. */
export interface CascStorage {
  fileExists(name: string): boolean;
  readFile(name: string): Uint8Array;
  close(): boolean;
}

/** D2R's CASC storage, opened with CascLib. Files live under the "data:" namespace. */
export class CascSource implements DataSource {
  readonly label: string;

  constructor(
    private readonly storage: CascStorage,
    installPath: string,
  ) {
    this.label = `D2R install ${installPath}`;
  }

  private name(path: string): string {
    return `data:data\\${path.replace(/\//g, '\\')}`;
  }

  exists(path: string): boolean {
    return this.storage.fileExists(this.name(path));
  }

  read(path: string): Uint8Array {
    if (!this.exists(path)) throw new Error(`Not in the CASC storage: ${path}`);
    return new Uint8Array(this.storage.readFile(this.name(path)));
  }

  close(): void {
    this.storage.close();
  }
}
