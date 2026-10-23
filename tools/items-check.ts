// npm run items: what the item model reads from the extracted tables, and a few rolls, as a sanity check.
import { loadTables } from './lib/load-tables.ts';
import { buildItemData } from '../src/sim/items/data.ts';
import { rollItem, itemName, itemStats, propertyStats } from '../src/sim/items/item.ts';
import { ITEM_MECHANICS, towerGear } from '../src/sim/items/gear.ts';
import { readFileSync } from 'node:fs';
import { DESIGN } from '../src/data/design.ts';
import type { PropRoll } from '../src/sim/items/data.ts';
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

// No dead stats: every stat an affix, unique, set item, set bonus, runeword, gem or rune can
// give is read by the gear (gear.ts by name), converted (balance.json itemConversions), cast
// on hit (itemProcs) or one of the item model's own (ITEM_MECHANICS)
const seen = new Map<string, string>();
const scan = (src: string, props: PropRoll[]) => {
  for (const p of props) for (const st of propertyStats(d, p, undefined, 90)) if (!seen.has(st.stat)) seen.set(st.stat, src);
};
for (const u of d.uniques) scan(u.name, u.props);
for (const s of d.setItems) { scan(s.name, s.props); s.partial.forEach((p) => scan(s.name, p)); }
for (const s of Object.values(d.sets)) { s.partial.forEach((p) => scan(s.name, p)); scan(s.name, s.full); }
for (const r of d.runewords) scan(r.name, r.props);
for (const a of [...d.prefixes, ...d.suffixes]) scan(a.name, a.props);
for (const g of Object.values(d.gems)) for (const props of [g.weapon, g.helm, g.shield]) scan(g.code, props);
const gearSource = readFileSync(new URL('../src/sim/items/gear.ts', import.meta.url), 'utf8');
const { itemConversions, itemProcs } = DESIGN.balance;
const dead = [...seen].filter(([stat]) => !gearSource.includes(`'${stat}'`) && !gearSource.includes(`  ${stat}:`) && !(stat in itemConversions) && !(stat in itemProcs) && !ITEM_MECHANICS.includes(stat));
console.log(`stats the items give: ${seen.size}; dead (nothing on a tower): ${dead.length ? dead.map(([s, src]) => `${s} (${src})`).join(', ') : 'none'}`);
if (dead.length) process.exitCode = 1;
