import json, sys, os
from PIL import Image, ImageDraw, ImageFont
plan = json.load(open('.cache/qc-plan.json', encoding='utf-8'))
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
TW, TH, COLS = 300, 225, 6
font = ImageFont.load_default()
def tile(entry, label):
    im = Image.new('RGB', (TW, TH + 34), 'white')
    try:
        p = Image.open(entry['file']).convert('RGB'); p.thumbnail((TW, TH)); im.paste(p, ((TW - p.width)//2, 0))
    except Exception: pass
    d = ImageDraw.Draw(im); d.text((3, TH + 2), label[:48], fill='black', font=font)
    d.text((3, TH + 16), entry['title'].replace('File:', '')[:48], fill='#a00', font=font)
    return im
groups = {}
for k, v in plan['products'].items():
    shop, name = k.split('/', 1); groups.setdefault(shop, []).append((name, v))
cats = [('H:' + k, v) for k, v in plan['headers'].items()] + [('L2:' + k, v) for k, v in plan['level2'].items()] + [('S:' + k, v) for k, v in plan['subs'].items()]
sets = [('cats1', cats[:30]), ('cats2', cats[30:])]
shops = list(groups.items())
for i in range(0, len(shops), 2):
    items = []
    for shop, lst in shops[i:i+2]: items += lst
    sets.append((f'qc_{i//2+1}', items))
for name, items in sets:
    if not items: continue
    tiles = [tile(v, n) for n, v in items]
    rows = (len(tiles) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * TW, rows * (TH + 34)), 'white')
    for i, t in enumerate(tiles): sheet.paste(t, ((i % COLS) * TW, (i // COLS) * (TH + 34)))
    sheet.thumbnail((2000, 2000)); sheet.save(f'{out}/{name}.jpg', quality=80)
print('ok')
