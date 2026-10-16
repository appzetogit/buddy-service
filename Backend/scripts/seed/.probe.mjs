const UA = 'BuddySeedBot/1.0 (admin@sooperbuddy.in)';
async function s(q) {
  const p = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '12', gsrsearch: q, prop: 'imageinfo', iiprop: 'size|mime' });
  const d = await (await fetch('https://commons.wikimedia.org/w/api.php?' + p, { headers: { 'User-Agent': UA } })).json();
  return Object.values(d?.query?.pages || {}).sort((a, b) => a.index - b.index).map((x) => x.title.replace('File:', '').slice(0, 55));
}
for (const q of process.argv.slice(2)) console.log('\n##', q, '\n ', (await s(q)).join('\n  '));
