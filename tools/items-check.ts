// npm run items: what the item model reads from the extracted tables, and a few rolls, as a sanity check.
import { loadTables } from './lib/load-tables.ts';
import { buildItemData } from '../src/sim/items/data.ts';
import { rollItem, itemName, itemStats } from '../src/sim/items/item.ts';
import { towerGear } from '../src/sim/items/gear.ts';
import { createRng } from '../src/sim/rng.ts';

const d = buildItemData(loadTables());
const bases = Object.values(d.bases);
const by = (k: string) => bases.filter((b) => b.kind === k).length;
console.log(`bases ${bases.length} (weapons ${by('weapon')}, armor ${by('armor')}, misc ${by('misc')})`);
console.log(`uniques ${d.uniques.length}, set items ${d.setItems.length}, sets ${Object.keys(d.sets).length}, prefixes ${d.prefixes.length}, suffixes ${d.suffixes.length}, runewords ${d.runewords.length}, gems ${Object.keys(d.gems).length}, runes ${d.runeOrder.length}`);
console.log('class items', [...new Set(bases.map((b) => b.classOnly).filter(Boolean))].join(' '));
console.log('misc', bases.filter((b) => b.kind === 'misc').map((b) => b.code).join(' '));
const unknownProps = new Set<string>();
for (const u of [...d.uniques, ...d.setItems, ...d.runewords]) for (const p of u.props) if (!d.properties[p.code]) unknownProps.add(p.code);
console.log('unknown props', [...unknownProps].join(' '));
const rng = createRng(5);
for (const [code, q] of [['7cr', 'unique'], ['uap', 'rare'], ['rin', 'magic'], ['amu', 'unique'], ['xtp', 'set'], ['ob1', 'magic']] as const) {
  const it = rollItem(d, rng, { uid: code, code, ilvl: 85, quality: q });
  console.log(itemName(d, it), it.quality, it.sockets, JSON.stringify(itemStats(d, it)));
}
const shako = d.uniques.find((u) => u.id === 'Harlequin Crest');
console.log('shako', JSON.stringify(shako?.props));
const enigma = d.runewords.find((r) => r.name === 'Enigma');
console.log('enigma', JSON.stringify(enigma));
const soj = rollItem(d, createRng(1), { uid: 'soj', code: 'rin', ilvl: 90, quality: 'unique' });
console.log(itemName(d, soj), JSON.stringify(towerGear(d, { ring1: soj }, 'paladin')));
