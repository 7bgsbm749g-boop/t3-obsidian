#!/usr/bin/env python3
"""Deploy the tested release over the existing private laptop SSH alias.
Preserves settings; the plugin migrates retired transport settings on load.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
PYTHON = 'C:/Users/jacks/AppData/Local/Programs/Python/Python311/python.exe'
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'fleet-laptop']
STAGE = 'C:/Users/jacks/.t3/send-to-t3-code/plugin-install'


def remote(code):
    result = subprocess.run(SSH + [PYTHON + ' -'], input=code, text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise SystemExit('Laptop deployment unavailable: ' + result.stderr[-1200:])
    print(result.stdout.strip())


def main():
    archive = ROOT / 'release/send-to-t3-code-2.4.3.zip'
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    remote(f"from pathlib import Path\nPath({STAGE!r}).mkdir(parents=True,exist_ok=True)\nprint('Laptop reachable')\n")
    subprocess.run(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', str(archive), f'fleet-laptop:{STAGE}/send-to-t3-code-2.4.3.zip'], check=True, timeout=45)
    remote(f'''
import json,hashlib,zipfile,shutil,os,datetime
from pathlib import Path
stage=Path({STAGE!r})
archive=stage/'send-to-t3-code-2.4.3.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest()=={digest!r}
plugin=Path('C:/Users/jacks/Documents/QLO2/.obsidian/plugins/send-to-t3-code')
assert plugin.is_dir()
data_path=plugin/'data.json'
raw=data_path.read_bytes()
data=json.loads(raw.decode('utf-8-sig'))
backup=stage/('before-2.4.3-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir()
for name in ['main.js','manifest.json','data.json','README.md','versions.json']:
 if (plugin/name).exists():shutil.copy2(plugin/name,backup/name)
allowed={{'main.js','manifest.json','versions.json','README.md','LICENSE'}}
with zipfile.ZipFile(archive) as z:
 assert set(z.namelist())=={{'send-to-t3-code/'+n for n in allowed}}
 for name in allowed:
  out=plugin/name;out.parent.mkdir(parents=True,exist_ok=True)
  tmp=out.with_suffix(out.suffix+'.installing');tmp.write_bytes(z.read('send-to-t3-code/'+name));os.replace(tmp,out)
old_companion=plugin/'companion'
if old_companion.exists():shutil.move(str(old_companion),str(backup/'companion'))
assert data_path.read_bytes()==raw, 'Settings changed during deployment; re-run after Obsidian finishes saving.'
print(json.dumps({{'version':json.loads((plugin/'manifest.json').read_text())['version'],'mobileEnabled':not json.loads((plugin/'manifest.json').read_text())['isDesktopOnly'],'mainSha256':hashlib.sha256((plugin/'main.js').read_bytes()).hexdigest(),'settingsPreserved':True}}))
''')


if __name__ == '__main__':
    main()
