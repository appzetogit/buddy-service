import json, sys, os
from PIL import Image, ImageDraw, ImageFont
plan = json.load(open('.cache/food-plan.json', encoding='utf-8'))
man = json.load(open('.cache/manifest.json', encoding='utf-8'))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
TW, TH, COLS = 300, 225, 6
font = ImageFont.load_default()
def tile(entry, label):
    im = Image.new('RGB', (TW, TH + 34), 'white')
    try:
        p = Image.open(entry['file']).convert('RGB'); p.thumbnail((TW, TH)); im.paste(p, ((TW - p.width)//2, 0))
    except Exception as e:
        pass
    d = ImageDraw.Draw(im)
    d.text((3, TH + 2), label[:48], fill='black', font=font)
    d.text((3, TH + 16), entry['title'].replace('File:', '')[:48], fill='#a00', font=font)
    return im
names = list(plan['restaurants'].keys())
for s in range(0, len(names), 2):
    tiles = []
    for rn in names[s:s+2]:
        r = plan['restaurants'][rn]
        tiles.append(tile(r['profile'], rn + ' [PROFILE]'))
        tiles.append(tile(r['menu'], rn + ' [MENU]'))
        for k, v in r['items'].items(): tiles.append(tile(v, k))
    rows = (len(tiles) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * TW, rows * (TH + 34)), 'white')
    for i, t in enumerate(tiles): sheet.paste(t, ((i % COLS) * TW, (i // COLS) * (TH + 34)))
    sheet.thumbnail((2000, 2000))
    sheet.save(f'{out}/food_{s//2+1}.jpg', quality=80)
print('ok')
