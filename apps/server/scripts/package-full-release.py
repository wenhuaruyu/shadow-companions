from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import subprocess
import os

root = Path(__file__).resolve().parents[3]
output = root / 'output/deployment/暗渡1941_完整联机版部署包.zip'
output.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([os.environ.get('NODE_BINARY', 'node'), 'apps/web/scripts/build.mjs'], cwd=root, check=True)
files = [root / name for name in ['package.json', 'package-lock.json', 'apps/server/package.json', 'apps/web/package.json', 'apps/web/src/games/back-alley.js']]
files += [path for path in (root / 'apps/server/src').rglob('*') if path.is_file()]
files += [path for path in (root / 'apps/web/dist').rglob('*') if path.is_file()]
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    archive.write(root / 'apps/server/Dockerfile', 'Dockerfile')
    for path in sorted(files):
        archive.write(path, path.relative_to(root))
print(f'完整部署包已生成，{output.stat().st_size // 1024 // 1024} MiB')
