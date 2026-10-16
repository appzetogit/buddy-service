const UA = 'BuddySeedBot/1.0 (admin@sooperbuddy.in)';
for (const q of process.argv.slice(2)) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=6&fields=product_name,brands,image_front_url,image_front_small_url,countries_tags&tagtype_0=countries&tag_contains_0=contains&tag_0=india`;
  try {
    const d = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
    console.log('\n##', q, d.count);
    for (const p of (d.products || []).slice(0, 5)) console.log('  ', p.brands, '|', p.product_name, '|', (p.image_front_url || '').slice(-40));
  } catch (e) { console.log('ERR', q, e.message); }
}
