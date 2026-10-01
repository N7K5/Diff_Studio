"""Encode captured VS Code frames. Requires Pillow; no project runtime dependency."""
import json
from pathlib import Path
from PIL import Image

frames = json.loads(Path('artifacts/walkthrough-frames/frames.json').read_text())
images = [Image.open(frame['file']).convert('RGB') for frame in frames]
# Build a shared palette from representative frames to avoid flickering colors.
samples = images[::max(1, len(images) // 12)]
sheet = Image.new('RGB', (640, 400 * len(samples)))
for i, sample in enumerate(samples):
    sheet.paste(sample.resize((640, 400), Image.Resampling.NEAREST), (0, i * 400))
palette = sheet.quantize(colors=256)
encoded = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
durations = [max(20, round((frames[i+1]['time'] - frame['time']) / 10) * 10) if i+1 < len(frames) else 1500 for i, frame in enumerate(frames)]
output = Path('assets/screenshots/folder-walkthrough.gif')
encoded[0].save(output, save_all=True, append_images=encoded[1:], duration=durations, loop=0, optimize=True, disposal=1)
with Image.open(output) as gif:
    report = {'frames': gif.n_frames, 'width': gif.width, 'height': gif.height, 'seconds': sum(durations)/1000, 'bytes': output.stat().st_size, 'loop': gif.info['loop']}
    assert gif.n_frames > 20 and gif.info['loop'] == 0
Path('artifacts/marketplace-gif.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
