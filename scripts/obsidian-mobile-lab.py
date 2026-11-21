#!/usr/bin/env python3
"""On-demand Android Obsidian lab. Never connects to a production vault.

Only official, pinned Android and Obsidian artifacts are installed. Device data
is private to this lab; screenshots and command receipts go to --evidence.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile

ROOT = Path(os.environ.get('T3_MOBILE_LAB_ROOT', Path.home() / '.local/share/t3-obsidian-mobile-lab'))
SDK = ROOT / 'sdk'
IMAGE = SDK / 'system-images/android-35/default/x86_64'
ADB = SDK / 'platform-tools/adb'
EMULATOR = SDK / 'emulator/emulator'
SERIAL = 'emulator-5580'
SESSION = 'obsidian-android-lab'
VAULT = '/storage/emulated/0/Android/data/md.obsidian/files/T3 Mobile Lab'
PLUGIN = VAULT + '/.obsidian/plugins/t-three-code'
RUNTIME = ['main.js', 'manifest.json', 'styles.css']
GUEST_RAM_MIB = 1536
# Host allowance for the whole emulator session: KVM guest RAM (the guest page
# cache eventually touches all of it) plus QEMU, swiftshader/gfxstream buffers
# and mapped emulator libraries. On 2026-11-21 the old 2300M allowance filled
# with 256M of swap after 7 minutes of benchmark use, and the kernel OOM-killed
# the emulator after 17m40s. See docs/obsidian-sync-test-lab.md for the sizing.
SESSION_MEMORY = '3584M'
# Long runs restart the emulator in a clean state before host-side growth can
# reach that allowance. 7-minute sessions survived; 17-minute ones did not.
RESTART_MINUTES = 10
PACKAGES = [
    ('emulator', 'https://dl.google.com/android/repository/emulator-linux_x64-16740729.zip', 349658551, 'sha1', 'f41f9e31eb5ca64926603c03265c50bbc0ff4172', SDK),
    ('platform-tools', 'https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip', 9054187, 'sha1', '477254aa5f903c15cf51001717bdf347fb6b53e0', SDK),
    ('android-35', 'https://dl.google.com/android/repository/sys-img/android/x86_64-35_r02.zip', 782404023, 'sha1', '2d857d170c0d1b827149565da34b3383e5306f7f', IMAGE.parent),
    ('obsidian', 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.15.0/Obsidian-1.15.0.apk', 14511986, 'sha256', '2d92966fba5441a8976ae86b39cf138c0a845d3dcd318e6f0d29d304950bca5d', None),
]


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, timeout=kwargs.pop('timeout', 45), **kwargs)


def adb(*args, **kwargs):
    if args and args[0] == 'shell':
        args = ('shell', shlex.join([str(a) for a in args[1:]]))
    return run([ADB, '-P', '5041', '-s', SERIAL, *args], **kwargs)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def device_sha256(remote):
    value = adb('shell', 'sha256sum', remote, capture_output=True, text=True).stdout.split()
    if not value or len(value[0]) != 64:
        raise RuntimeError('Android did not report a checksum for ' + remote)
    return value[0]


def flush():
    # Guest writes from adb push stay in the Android page cache until synced;
    # an emulator stop before this loses them and leaves empty files.
    adb('shell', 'sync', timeout=120)


def push_verified(local_files, remote_dir):
    expected = {Path(path).name: sha256(path) for path in local_files}
    adb('shell', 'mkdir', '-p', remote_dir)
    adb('push', *local_files, remote_dir + '/', timeout=120)
    flush()
    actual = {name: device_sha256(remote_dir + '/' + name) for name in expected}
    if actual != expected:
        raise RuntimeError('Android file checksums do not match the pushed files')
    return expected


def record(evidence, name, value):
    path = evidence / name
    path.write_text(json.dumps(value, indent=2) + '\n')
    return path


def initialize():
    ROOT.mkdir(parents=True, exist_ok=True)
    marker = ROOT / 'SYNTHETIC-ANDROID-LAB'
    if not marker.exists():
        if any(ROOT.iterdir()):
            raise RuntimeError('Lab root is not empty and has no ownership marker')
        marker.write_text('Dedicated Android Obsidian test device. No production vaults.\n')


def setup(evidence):
    receipts = []
    for name, url, size, algorithm, expected, destination in PACKAGES:
        receipt = ROOT / (name + '-installed.json')
        if receipt.exists():
            receipts.append(json.loads(receipt.read_text()))
            continue
        if shutil.disk_usage(ROOT).free < size + 1_050_000_000:
            raise RuntimeError('Insufficient disk space with the lab safety reserve')
        archive = ROOT / (name + ('.apk' if destination is None else '.zip'))
        temporary = archive.with_suffix(archive.suffix + '.partial')
        digest = hashlib.new(algorithm)
        total = 0
        print('Downloading pinned official artifact:', name, flush=True)
        request = urllib.request.Request(url + '?t3-mobile-lab=full', headers={'User-Agent': 't3-obsidian-mobile-lab'})
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as out:
            if response.status != 200:
                raise RuntimeError('Expected a complete artifact response')
            while chunk := response.read(1_048_576):
                total += len(chunk)
                if total > size:
                    raise RuntimeError('Artifact exceeds its pinned size')
                digest.update(chunk)
                out.write(chunk)
        if total != size or digest.hexdigest() != expected:
            raise RuntimeError('Official artifact checksum does not match its pin')
        temporary.replace(archive)
        if destination is not None:
            with zipfile.ZipFile(archive) as package:
                required = sum(item.file_size for item in package.infolist())
                if shutil.disk_usage(ROOT).free < required + 900_000_000:
                    raise RuntimeError('Insufficient disk space to unpack the verified artifact')
                for item in package.infolist():
                    target = destination / item.filename
                    if not target.resolve().is_relative_to(destination.resolve()) or item.filename.startswith('/'):
                        raise RuntimeError('Unsafe path in official archive')
                package.extractall(destination)
                for item in package.infolist():
                    mode = item.external_attr >> 16 & 0o777
                    if mode:
                        (destination / item.filename).chmod(mode)
            archive.unlink()
        value = dict(name=name, url=url, bytes=size, algorithm=algorithm, checksum=expected)
        receipt.write_text(json.dumps(value, indent=2) + '\n')
        receipts.append(value)
    record(evidence, 'installed-artifacts.json', receipts)
    return dict(root=str(ROOT), installed=receipts)


def start(evidence):
    if not EMULATOR.is_file() or not IMAGE.is_dir():
        raise RuntimeError('Run setup first')
    device = ROOT / 'device'
    device.mkdir(exist_ok=True)
    avds = ROOT / 'avd'
    avds.mkdir(exist_ok=True)
    (avds / 't3-obsidian.ini').write_text(f'avd.ini.encoding=UTF-8\npath={device}\ntarget=android-35\n')
    (device / 'config.ini').write_text('\n'.join([
        'AvdId=t3-obsidian', 'avd.ini.encoding=UTF-8', 'abi.type=x86_64',
        'hw.cpu.arch=x86_64', 'tag.id=default', 'tag.display=Default',
        f'image.sysdir.1={IMAGE}/', 'hw.ramSize=1536', 'hw.lcd.width=720',
        'hw.lcd.height=1280', 'hw.lcd.density=320', 'hw.keyboard=yes',
        'hw.gpu.enabled=yes', 'hw.gpu.mode=swiftshader', 'hw.sdCard=no',
        'disk.dataPartition.size=768M', 'showDeviceFrame=no',
        'fastboot.forceColdBoot=yes', 'PlayStore.enabled=false', '',
    ]))
    userdata = device / 'userdata-qemu.img'
    if not userdata.exists():
        # Provision the bounded lab filesystem explicitly. New emulator first
        # boot defaults otherwise expand every API >=24 device to 6 GiB.
        if shutil.disk_usage(ROOT).free < 1_750_000_000:
            raise RuntimeError('Insufficient disk space for the bounded lab device')
        with userdata.open('xb') as out:
            out.truncate(768 * 1024 * 1024)
        run([SDK / 'emulator/bin64/mkfs.ext4', '-F', '-b', '4096', '-L', 'data', userdata], capture_output=True, text=True)
    # A separate adb server prevents this lab from taking over a user's devices.
    adb_session = run(['t3-session', 'start', '--key', SESSION + '-adb', '--purpose', 'Private ADB server for Android Obsidian lab', '--gui', '--memory', '128M', '--', ADB, '-P', '5041', 'nodaemon', 'server'], capture_output=True, text=True, timeout=90)
    adb_receipt = json.loads(adb_session.stdout)
    (ROOT / 'adb-session.json').write_text(json.dumps(adb_receipt))
    args = [EMULATOR, '-avd', 't3-obsidian', '-sysdir', IMAGE, '-datadir', device,
            '-kernel', IMAGE / 'kernel-ranchu', '-ramdisk', IMAGE / 'ramdisk.img',
            '-system', IMAGE / 'system.img', '-vendor', IMAGE / 'vendor.img',
            '-data', device / 'userdata-qemu.img',
            '-partition-size', '768', '-memory', '1536', '-lowram', '-cores', '2',
            '-skin', '720x1280', '-port', '5580', '-no-window', '-no-audio',
            '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader',
            '-feature', '-Vulkan', '-accel', 'on', '-no-metrics']
    # sg refreshes the configured user's KVM group without restarting T3.
    environment = {'ANDROID_ADB_SERVER_PORT': '5041', 'ANDROID_SDK_ROOT': str(SDK), 'ANDROID_AVD_HOME': str(avds), 'ANDROID_EMULATOR_HOME': str(ROOT / 'android-home')}
    command = 'export ' + ' '.join(key + '=' + shlex.quote(value) for key, value in environment.items()) + '; exec ' + shlex.join([str(a) for a in args])
    result = run(['t3-session', 'start', '--key', SESSION, '--purpose', 'Isolated Android Obsidian recovery validation', '--gui', '--memory', SESSION_MEMORY, '--', '/usr/bin/sg', 'kvm', '-c', command], capture_output=True, text=True, timeout=90)
    (evidence / 'start-session.txt').write_text(result.stdout + result.stderr)
    (ROOT / 'emulator-session.json').write_text(json.dumps(dict(json.loads(result.stdout), startedAt=time.time(), memory=SESSION_MEMORY)))
    print(result.stdout, end='')
    return dict(session=SESSION, serial=SERIAL, memory=SESSION_MEMORY, owner='t3-obsidian mobile lab', shutdown=f'python3 scripts/obsidian-mobile-lab.py stop --evidence {shlex.quote(str(evidence))}')


def wait_boot(timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        try:
            if status().get('bootCompleted'):
                adb('shell', 'test', '-d', '/storage/emulated/0/Android')
                return dict(bootCompleted=True)
        except subprocess.SubprocessError:
            pass
        if time.monotonic() > deadline:
            raise RuntimeError('Android did not finish booting')
        time.sleep(2)


def session_age():
    path = ROOT / 'emulator-session.json'
    if not path.exists() or 'startedAt' not in (session := json.loads(path.read_text())):
        return None
    return time.time() - session['startedAt']


def restart(evidence, older_than_minutes=None):
    # A fresh boot returns QEMU and swiftshader host memory, so long runs call
    # this between rounds instead of growing one session until the OOM killer.
    age = session_age()
    if older_than_minutes is not None and age is not None and age < older_than_minutes * 60 and adb_running():
        return dict(restarted=False, sessionMinutes=round(age / 60, 1))
    stopped = stop(evidence)
    deadline = time.monotonic() + 60
    while adb_running():
        if time.monotonic() > deadline:
            raise RuntimeError('The previous lab ADB server did not close')
        time.sleep(1)
    started = start(evidence)
    wait_boot()
    return dict(restarted=True, stopped=stopped, started=started)


def status():
    result = dict(root=str(ROOT), emulatorInstalled=EMULATOR.is_file(), imageInstalled=IMAGE.is_dir(), serial=SERIAL)
    age = session_age()
    if age is not None and adb_running():
        result.update(sessionMinutes=round(age / 60, 1), restartDue=age >= RESTART_MINUTES * 60, memory=session_memory())
    if ADB.is_file() and adb_running():
        devices = run([ADB, '-P', '5041', 'devices', '-l'], capture_output=True, text=True)
        result['devices'] = devices.stdout
        if SERIAL + ' ' in devices.stdout or SERIAL + '\t' in devices.stdout:
            result['bootCompleted'] = adb('shell', 'getprop', 'sys.boot_completed', capture_output=True, text=True).stdout.strip() == '1'
    return result


def adb_running():
    try:
        with socket.create_connection(('127.0.0.1', 5041), timeout=1):
            return True
    except OSError:
        return False


def capture(evidence):
    with (evidence / 'screen.png').open('wb') as out:
        adb('exec-out', 'screencap', '-p', stdout=out)
    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/t3-mobile-window.xml')
    adb('pull', '/data/local/tmp/t3-mobile-window.xml', evidence / 'window.xml')
    logs = adb('logcat', '-d', '-t', '300', capture_output=True, text=True)
    (evidence / 'logcat.txt').write_text(logs.stdout)
    return dict(screenshot=str(evidence / 'screen.png'), accessibility=str(evidence / 'window.xml'))


def attach(evidence):
    pid = adb('shell', 'pidof', 'md.obsidian', capture_output=True, text=True).stdout.strip()
    if not pid.isdigit():
        raise RuntimeError('The owned Obsidian app process is unavailable')
    port = adb('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid, capture_output=True, text=True).stdout.strip()
    if not port.isdigit():
        raise RuntimeError('ADB did not confirm a WebView forwarding port')
    result = dict(endpoint='http://127.0.0.1:' + port, pid=int(pid), serial=SERIAL)
    record(evidence, 'webview.json', result)
    (ROOT / 'webview.json').write_text(json.dumps(result))
    return result


def process_identity(pid):
    value = adb('shell', 'cat', f'/proc/{pid}/stat', capture_output=True, text=True).stdout
    fields = value.rsplit(')', 1)[1].split()
    return dict(pid=pid, startTicks=fields[19], state=fields[0])


def freeze(evidence):
    previous = ROOT / 'freeze.json'
    if previous.exists() and not json.loads(previous.read_text()).get('resumed'):
        raise RuntimeError('The owned app is already frozen; run thaw first')
    # Deliver Android's real background transition before stopping execution.
    adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME')
    result = adb('shell', 'ps', '-A', '-o', 'PID,NAME,ARGS', capture_output=True, text=True)
    selected = []
    for line in result.stdout.splitlines()[1:]:
        fields = line.strip().split(None, 2)
        if len(fields) < 2:
            continue
        name = fields[1]
        if name == 'md.obsidian' or name.startswith('md.obsidian:') or name.startswith('com.android.webview:sandboxed_process'):
            selected.append(process_identity(int(fields[0])))
    if not selected or not any('md.obsidian' in line for line in result.stdout.splitlines()):
        raise RuntimeError('The owned test Obsidian app is not running')
    receipt = dict(at=time.time(), processes=selected, resumed=False, scope='Owned isolated Android app and WebView; iOS suspension approximation')
    # Retain exact process start identities before signals, so failure recovery
    # never sends CONT to a recycled PID.
    (ROOT / 'freeze.json').write_text(json.dumps(receipt, indent=2))
    adb('shell', 'kill', '-STOP', *[str(item['pid']) for item in selected])
    receipt['stoppedStates'] = [process_identity(item['pid']) for item in selected]
    record(evidence, 'freeze.json', receipt)
    if any(item['state'] not in ['T', 't'] for item in receipt['stoppedStates']):
        raise RuntimeError('A selected app process did not stop; run thaw')
    return receipt


def thaw(evidence):
    path = ROOT / 'freeze.json'
    if not path.exists():
        raise RuntimeError('There is no owned freeze receipt')
    receipt = json.loads(path.read_text())
    if receipt.get('resumed'):
        return receipt
    resumed = []
    for item in receipt['processes']:
        try:
            current = process_identity(item['pid'])
        except subprocess.SubprocessError:
            continue
        if current['startTicks'] == item['startTicks']:
            adb('shell', 'kill', '-CONT', str(item['pid']))
            resumed.append(item['pid'])
    receipt.update(resumed=True, resumedPids=resumed, resumedAt=time.time())
    path.write_text(json.dumps(receipt, indent=2))
    adb('shell', 'am', 'start', '-W', '-n', 'md.obsidian/.MainActivity')
    record(evidence, 'thaw.json', receipt)
    return receipt


def scenario(evidence, name, seconds):
    repository = Path(__file__).resolve().parent.parent
    webview = attach(evidence)
    endpoint = webview['endpoint']
    outputs = {}
    frozen = False
    def evaluate(expression, step):
        path = evidence / (step + '.js')
        path.write_text(expression)
        try:
            result = run(['node', repository / 'scripts/mobile-cdp.mjs', endpoint, path], capture_output=True, text=True)
        except subprocess.CalledProcessError as error:
            (evidence / (step + '-error.txt')).write_text((error.stdout or '') + (error.stderr or ''))
            raise
        value = json.loads(result.stdout)
        record(evidence, step + '.json', value)
        outputs[step] = value
        return value
    fixture = (repository / 'tests/native/mobile-recovery-lab.js').read_text()
    evaluate("(async()=>{const end=Date.now()+15000;while(!globalThis.app?.plugins?.plugins?.['t-three-code']?.deviceInline||!globalThis.app?.plugins?.plugins?.['t-three-code']?.settingsTab){if(Date.now()>end)throw Error('The test plugin did not finish startup');await new Promise(r=>setTimeout(r,100));}return {mobile:app.isMobile,vault:app.vault.getName()};})()", 'app-ready')
    evaluate(fixture, 'install-fixture')
    result = dict(status='running', scenario=name, nativeAndroid=True, syntheticCanonicalInput=True, nativeIOS=False, outputs=outputs)
    try:
        before = evaluate('globalThis.__t3MobileRecovery.' + ('snapshot()' if name == 'recover-existing' else 'prepare()'), 'before')
        if not before.get('present'):
            raise RuntimeError('There is no exact mobile response fixture to test')
        before_screen = evidence / 'before-screen'
        before_screen.mkdir(exist_ok=True)
        capture(before_screen)
        if name == 'suspension':
            freeze(evidence)
            frozen = True
            record(evidence, 'peer-completed.json', dict(at=time.time(), canonicalComplete=True, synthetic=True))
            time.sleep(seconds)
            thaw(evidence)
            frozen = False
        elif name == 'pane-gap':
            gap = evaluate('globalThis.__t3MobileRecovery.transientMissingPane()', 'pane-gap')
            if gap.get('runtime', {}).get('done'):
                raise RuntimeError('A transient pane gap permanently retired the unsaved reply')
        elif name == 'closed-destination':
            evaluate('globalThis.__t3MobileRecovery.closeDestination()', 'closed-destination')
        final = evaluate('globalThis.__t3MobileRecovery.final()', 'final')
        if not final['status'].get('finalSaved') or 'Synthetic mobile reply finished.' not in final['disk'] or 'Ordinary text remains.' not in final['disk']:
            raise RuntimeError('The exact native mobile final was not saved with ordinary text preserved')
        if name == 'closed-destination':
            final = evaluate('globalThis.__t3MobileRecovery.reopen()', 'reopened')
        if final.get('editor') != final['disk']:
            raise RuntimeError('The native mobile editor does not show the verified saved note')
        screen = evidence / 'after-screen'
        screen.mkdir(exist_ok=True)
        capture(screen)
        result.update({'pass': True, 'status': 'complete'})
    except Exception as error:
        result.update(status='failed', error=str(error))
        raise
    finally:
        if frozen:
            thaw(evidence)
        cleanup = evaluate('globalThis.__t3MobileRecovery.cleanup()', 'cleanup')
        result['cleanupVerified'] = cleanup.get('clean') is True
        record(evidence, 'result.json', result)
        if not cleanup.get('clean'):
            raise RuntimeError('The native fixture note was not deleted')
    return dict(result=str(evidence / 'result.json'), passed=True, scenario=name, cleanupVerified=True)


def unit_state(unit):
    return run(['systemctl', '--user', 'show', '-p', 'ActiveState', '--value', unit], capture_output=True, text=True).stdout.strip()


def session_memory():
    """Read the emulator session's cgroup counters, for evidence-based sizing."""
    try:
        unit = json.loads((ROOT / 'emulator-session.json').read_text())['unit']
        group = run(['systemctl', '--user', 'show', '-p', 'ControlGroup', '--value', unit], capture_output=True, text=True).stdout.strip()
        base = Path('/sys/fs/cgroup') / group.lstrip('/')
        if not group or not base.is_dir():
            return None
        result = dict(unit=unit)
        for name in ['memory.current', 'memory.peak', 'memory.max', 'memory.swap.current', 'memory.swap.peak', 'memory.swap.max']:
            if (base / name).exists():
                result[name] = (base / name).read_text().strip()
        for name in ['memory.events', 'memory.stat']:
            if (base / name).exists():
                values = dict(line.split() for line in (base / name).read_text().splitlines() if line.strip())
                keep = None if name == 'memory.events' else ['anon', 'file', 'kernel', 'shmem', 'file_mapped', 'sock']
                result[name] = {key: int(value) for key, value in values.items() if keep is None or key in keep}
        return result
    except (OSError, KeyError, ValueError, subprocess.SubprocessError) as error:
        return dict(error=str(error))


def emulator_present(unit):
    if unit and unit_state(unit) in ['active', 'activating', 'deactivating', 'reloading']:
        return True
    devices = run([ADB, '-P', '5041', 'devices'], capture_output=True, text=True).stdout if adb_running() else ''
    return SERIAL in devices


def shutdown(timeout=90):
    """Flush the guest, then power it off cleanly; kill only as a fallback."""
    receipt = dict(flushed=False, method=None)
    try:
        flush()
        receipt['flushed'] = True
    except subprocess.SubprocessError as error:
        receipt['flushError'] = str(error)
    path = ROOT / 'emulator-session.json'
    unit = json.loads(path.read_text()).get('unit') if path.exists() else None
    try:
        # Android unmounts /data and QEMU exits after a guest power-off.
        adb('shell', 'reboot', '-p', timeout=30)
    except subprocess.SubprocessError as error:
        receipt['poweroffCommand'] = str(error)
    deadline = time.monotonic() + timeout
    while emulator_present(unit):
        if time.monotonic() > deadline:
            break
        time.sleep(1)
    else:
        receipt['method'] = 'poweroff'
    if receipt['method'] is None:
        adb('emu', 'kill')
        receipt['method'] = 'emu-kill'
    return receipt


def stop(evidence):
    # Target this exact emulator; never kill a shared adb server or another AVD.
    devices = run([ADB, '-P', '5041', 'devices'], capture_output=True, text=True).stdout if adb_running() else ''
    receipt = dict(session=SESSION, memory=session_memory())
    online = any(line.split() == [SERIAL, 'device'] for line in devices.splitlines())
    if online:
        receipt['shutdown'] = shutdown()
    elif SERIAL in devices:
        # An offline guest cannot be synced; report that its writes are unflushed.
        adb('emu', 'kill')
        receipt['shutdown'] = dict(flushed=False, method='emu-kill', reason='device offline')
    outputs = []
    for name in ['emulator-session.json', 'adb-session.json']:
        path = ROOT / name
        if path.exists():
            session = json.loads(path.read_text())
            result = run(['t3-session', 'release', session['id']], capture_output=True, text=True)
            outputs.append(result.stdout + result.stderr)
    (evidence / 'stop-session.txt').write_text('\n'.join(outputs))
    receipt['released'] = True
    record(evidence, 'stop.json', receipt)
    return receipt


def backup_plugin(evidence, backup):
    """Pull the installed lab runtime; refuse empty or unverifiable copies."""
    manifest_path = backup / 'backup.json'
    if manifest_path.exists():
        raise RuntimeError('The backup directory already holds a backup; choose a new one')
    backup.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name in RUNTIME:
        remote = PLUGIN + '/' + name
        adb('pull', remote, backup / name, timeout=120)
        if not (backup / name).stat().st_size:
            raise RuntimeError('The installed lab runtime file is empty: ' + name)
        hashes[name] = sha256(backup / name)
        if device_sha256(remote) != hashes[name]:
            raise RuntimeError('The pulled runtime does not match Android: ' + name)
    manifest = dict(at=time.time(), source=PLUGIN, sha256=hashes, bytes={name: (backup / name).stat().st_size for name in RUNTIME})
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    record(evidence, 'plugin-backup.json', dict(manifest, backup=str(backup)))
    return manifest


def verified_backup(backup):
    manifest_path = backup / 'backup.json'
    if not manifest_path.is_file():
        raise RuntimeError('The backup has no checksum manifest')
    manifest = json.loads(manifest_path.read_text())
    expected = manifest.get('sha256', {})
    if sorted(expected) != sorted(RUNTIME):
        raise RuntimeError('The backup manifest does not list the three runtime files')
    for name in RUNTIME:
        path = backup / name
        if not path.is_file() or not path.stat().st_size:
            raise RuntimeError('The backup runtime file is missing or empty: ' + name)
        if sha256(path) != expected[name]:
            raise RuntimeError('The backup runtime file does not match its checksum: ' + name)
    return manifest


def restore_plugin(evidence, backup):
    # Verify every file before any push, so a bad backup never replaces the runtime.
    manifest = verified_backup(backup)
    pushed = push_verified([backup / name for name in RUNTIME], PLUGIN)
    if pushed != manifest['sha256']:
        raise RuntimeError('The restored runtime does not match the backup manifest')
    result = dict(restored=PLUGIN, sha256=pushed, backup=str(backup), flushed=True)
    record(evidence, 'plugin-restore.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'start', 'status', 'capture', 'attach', 'restart-app', 'install-app', 'install-plugin', 'backup-plugin', 'restore-plugin', 'run', 'freeze', 'thaw', 'restart', 'stop'])
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--plugin-dir', type=Path)
    parser.add_argument('--backup-dir', type=Path)
    parser.add_argument('--if-older-than', type=float, metavar='MINUTES', help='restart only when the emulator session is at least this old')
    parser.add_argument('--scenario', choices=['suspension', 'pane-gap', 'closed-destination', 'recover-existing'])
    parser.add_argument('--freeze-seconds', type=float, default=10)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    if not evidence.is_relative_to(Path('/srv/t3-evidence')):
        parser.error('Evidence must be outside checkouts under /srv/t3-evidence')
    evidence.mkdir(parents=True, exist_ok=True)
    initialize()
    with (ROOT / 'operation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == 'setup':
            result = setup(evidence)
        elif args.action == 'start':
            result = start(evidence)
        elif args.action == 'status':
            result = status()
        elif args.action == 'capture':
            result = capture(evidence)
        elif args.action == 'attach':
            result = attach(evidence)
        elif args.action == 'run':
            if args.scenario is None or not 0 <= args.freeze_seconds <= 30:
                raise RuntimeError('Choose a scenario and a freeze interval from 0 to 30 seconds')
            result = scenario(evidence, args.scenario, args.freeze_seconds)
        elif args.action == 'restart-app':
            adb('shell', 'am', 'force-stop', 'md.obsidian')
            adb('shell', 'am', 'start', '-W', '-n', 'md.obsidian/.MainActivity')
            result = dict(restarted='md.obsidian')
        elif args.action == 'install-app':
            adb('install', '-r', ROOT / 'obsidian.apk', timeout=90)
            result = dict(installed='md.obsidian', version='1.15.0')
        elif args.action == 'install-plugin':
            if args.plugin_dir is None:
                raise RuntimeError('Choose the reviewed plugin artifact directory')
            files = [args.plugin_dir / name for name in ['main.js', 'manifest.json', 'styles.css']]
            if not all(path.is_file() for path in files) or json.loads(files[1].read_text()).get('id') != 't-three-code':
                raise RuntimeError('The plugin artifact set is incomplete or has the wrong ID')
            if any(not path.stat().st_size for path in files):
                raise RuntimeError('A plugin artifact file is empty')
            result = dict(destination=PLUGIN, sha256=push_verified(files, PLUGIN), flushed=True)
            record(evidence, 'plugin-artifacts.json', result)
        elif args.action in ['backup-plugin', 'restore-plugin']:
            if args.backup_dir is None or args.backup_dir.resolve().is_relative_to(Path(__file__).resolve().parent.parent):
                raise RuntimeError('Choose a backup directory outside this checkout')
            action = backup_plugin if args.action == 'backup-plugin' else restore_plugin
            result = action(evidence, args.backup_dir.resolve())
        elif args.action == 'restart':
            result = restart(evidence, args.if_older_than)
        elif args.action == 'freeze':
            result = freeze(evidence)
        elif args.action == 'thaw':
            result = thaw(evidence)
        else:
            result = stop(evidence)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
