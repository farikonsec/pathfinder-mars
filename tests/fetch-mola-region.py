"""Reproduce the unresampled 128-pixel/degree MOLA radius crop used in the game."""
from pathlib import Path
from urllib.request import Request, urlopen

url = 'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg128/megr00n270hb.img'
rows, source_width, x, width = 2048, 11520, 1280, 2560
byte_count = rows * source_width * 2
with urlopen(Request(url, headers={'Range': f'bytes=0-{byte_count-1}'}), timeout=60) as response:
    data = response.read(byte_count)
if len(data) != byte_count:
    raise ValueError('Incomplete MOLA region')
crop = b''.join(data[(row*source_width+x)*2:(row*source_width+x+width)*2] for row in range(rows))
target = Path(__file__).resolve().parents[1] / 'public/textures/mars-canyon-radius.img'
target.write_bytes(crop)
print(f'{target}: {len(crop)} bytes; 0 to -16 latitude, 280 to 300 east longitude')
