import fs from 'node:fs';
const UA = 'BuddySeedBot/1.0 (admin@sooperbuddy.in)';
const qs = process.argv.slice(2);
fs.mkdirSync('.cache/probe', { recursive: true });
let n = 0; const meta = [];
for (const q of qs) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=6&category=photograph&license_type=commercial&extension=jpg&filter_dead=true&mature=false`;
  const d = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
  for (const r of (d.results || []).slice(0, 4)) {
    try {
      const img = await fetch(r.thumbnail || r.url, { headers: { 'User-Agent': UA } });
      const buf = Buffer.from(await img.arrayBuffer());
      const f = `.cache/probe/${n}.jpg`; fs.writeFileSync(f, buf);
      meta.push({ file: f, title: `[${q}] ${r.title} (${r.source})` }); n++;
    } catch {}
  }
}
fs.writeFileSync('.cache/probe/meta.json', JSON.stringify(meta));
console.log('saved', n);
