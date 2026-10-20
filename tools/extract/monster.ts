// Extracts one monster animation into a PNG sprite sheet plus a JSON atlas.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { animFps, decodeAnimData } from '../lib/animdata.ts';
import { DrawEffect, compositeCode, decodeCof } from '../lib/cof.ts';
import { decodeDcc } from '../lib/dcc.ts';
import { decodePalDat } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import { composite, layerAlpha, type CompositeLayer } from './composite.ts';
import { column, readBytes, readTable } from './paths.ts';

/** D2 file direction order for 8-direction animations, by direction index. */
const DIRECTION_NAMES_8 = ['sw', 'nw', 'ne', 'se', 's', 'w', 'n', 'e'];
const SHEET_PADDING = 1;

export interface MonsterOptions {
  dataRoot: string;
  out: string;
  token: string;
  mode: string;
  /** monstats2.txt Id, for the weapon class and part variants. */
  monster: string;
  act: string;
}

export function extractMonster(opts: MonsterOptions): void {
  const token = opts.token.toLowerCase();
  const mode = opts.mode.toLowerCase();
  const { dataRoot } = opts;
  const monsterDir = join(dataRoot, 'global', 'monsters', token);

  const monster = readTable(dataRoot, 'monstats2.txt').find((row) => row['Id'] === opts.monster);
  if (!monster) throw new Error(`monstats2.txt has no row with Id ${opts.monster}`);
  const weaponClass = column(monster, 'BaseW').toLowerCase();

  const cofName = `${token}${mode}${weaponClass}`;
  const cof = decodeCof(readBytes(join(monsterDir, 'cof', `${cofName}.cof`)));

  const animRecord = decodeAnimData(readBytes(join(dataRoot, 'global', 'animdata.d2'))).get(cofName.toUpperCase())?.[0];
  if (!animRecord) throw new Error(`animdata.d2 has no record ${cofName.toUpperCase()}`);
  if (animRecord.framesPerDirection !== cof.framesPerDirection) {
    console.warn(`animdata says ${animRecord.framesPerDirection} frames, COF has ${cof.framesPerDirection}; using the COF`);
  }

  const palette = decodePalDat(readBytes(join(dataRoot, 'global', 'palette', opts.act, 'pal.dat')));

  const layers: CompositeLayer[] = [];
  const layerReport: Record<string, string> = {};
  for (const cofLayer of cof.layers) {
    const code = compositeCode(cofLayer.type);
    // monstats2 lists the allowed variants, e.g. "lit,med,hvy". Take the first so output is stable.
    const variant = column(monster, `${code}v`).replace(/"/g, '').split(',')[0]?.trim().toLowerCase() || 'lit';
    const file = `${token}${code}${variant}${mode}${cofLayer.weaponClass}.dcc`.toLowerCase();
    const dcc = decodeDcc(readBytes(join(monsterDir, code.toLowerCase(), file)));

    if (cofLayer.transparent && cofLayer.drawEffect > DrawEffect.PctTransparency75) {
      console.warn(`Layer ${code} uses draw effect ${cofLayer.drawEffect}; drawn opaque for now`);
    }

    layers.push({ type: cofLayer.type, dcc, alpha: layerAlpha(cofLayer.transparent, cofLayer.drawEffect) });
    layerReport[code] = file;
  }

  const result = composite(cof, layers, palette);

  if (cof.numberOfDirections !== DIRECTION_NAMES_8.length) {
    throw new Error(`Only 8-direction animations are supported so far, ${cofName} has ${cof.numberOfDirections}`);
  }

  // Sheet: one row per direction in D2 file order, one column per frame.
  const cellW = result.frameWidth + SHEET_PADDING;
  const cellH = result.frameHeight + SHEET_PADDING;
  const sheetW = cellW * cof.framesPerDirection;
  const sheetH = cellH * cof.numberOfDirections;
  const sheet = new Uint8Array(sheetW * sheetH * 4);

  const fps = animFps(animRecord);
  const durationMs = Math.round(1000 / fps);
  const atlasFrames: Record<string, object> = {};

  result.frames.forEach((dirFrames, d) => {
    const dirName = DIRECTION_NAMES_8[d]!;
    dirFrames.forEach((rgba, f) => {
      const x0 = f * cellW;
      const y0 = d * cellH;
      for (let y = 0; y < result.frameHeight; y++) {
        const src = rgba.subarray(y * result.frameWidth * 4, (y + 1) * result.frameWidth * 4);
        sheet.set(src, ((y0 + y) * sheetW + x0) * 4);
      }
      atlasFrames[`${mode}_${dirName}_${String(f).padStart(2, '0')}`] = {
        frame: { x: x0, y: y0, w: result.frameWidth, h: result.frameHeight },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: result.frameWidth, h: result.frameHeight },
        sourceSize: { w: result.frameWidth, h: result.frameHeight },
        direction: dirName,
        index: f,
        offset: { x: result.originX, y: result.originY },
        duration: durationMs,
      };
    });
  });

  const outDir = join(opts.out, 'monsters', token);
  mkdirSync(outDir, { recursive: true });
  const baseName = `${token}_${mode}_${weaponClass}`;

  writeFileSync(join(outDir, `${baseName}.png`), encodePng(sheetW, sheetH, sheet));
  writeFileSync(
    join(outDir, `${baseName}.json`),
    JSON.stringify(
      {
        frames: atlasFrames,
        meta: {
          app: 'd2td tools/extract',
          image: `${baseName}.png`,
          format: 'RGBA8888',
          size: { w: sheetW, h: sheetH },
          scale: '1',
          source: { cof: `${cofName}.cof`, palette: `${opts.act}/pal.dat`, monster: opts.monster, layers: layerReport },
          mode,
          directions: DIRECTION_NAMES_8,
          framesPerDirection: cof.framesPerDirection,
          animSpeed: animRecord.speed,
          fps,
          frameWidth: result.frameWidth,
          frameHeight: result.frameHeight,
          origin: { x: result.originX, y: result.originY },
        },
      },
      null,
      2,
    ),
  );

  console.log(
    `${cofName}: ${cof.numberOfDirections} directions x ${cof.framesPerDirection} frames, ` +
      `${result.frameWidth}x${result.frameHeight} px, origin (${result.originX}, ${result.originY}), ` +
      `${fps.toFixed(2)} fps, layers ${Object.keys(layerReport).join(' ')}`,
  );
  console.log(`Wrote ${join(outDir, baseName)}.png and .json`);
}
