from pathlib import Path
from PIL import Image

design = Path(__file__).resolve().parent
root = design.parent / 'public'
for name in ('idea', 'book', 'person'):
    source = design / f'{name}-draft.png'
    if not source.exists():
        continue
    image = Image.open(source)
    bounds = image.getchannel('A').getbbox()
    if bounds:
        left, top, right, bottom = bounds
        pad = 60
        image = image.crop((max(0, left-pad), max(0, top-pad), min(image.width, right+pad), min(image.height, bottom+pad)))
    temporary = design / f'{name}.webp.tmp'
    image.save(temporary, format='WEBP', quality=88, method=6)
    temporary.replace(root / f'{name}.webp')
    print(name, image.size, (root / f'{name}.webp').stat().st_size)
