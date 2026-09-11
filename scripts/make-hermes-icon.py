from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
im = Image.open(ROOT / "assets/hermes-golden-blackhole.png").convert("RGBA")
out = ROOT / "src-tauri/icons"
for file in out.glob("*.png"):
    with Image.open(file) as old:
        size = old.size
    im.resize(size, Image.Resampling.LANCZOS).save(file)
im.save(out / "icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
im.save(out / "icon.icns")
for file in [ROOT / "src/assets/hermes-blackhole.png", ROOT / "src/assets/icons/app-icon.png"]:
    im.resize((256,256), Image.Resampling.LANCZOS).save(file)
