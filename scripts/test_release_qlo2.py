from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('release-qlo2.py')
SPEC = importlib.util.spec_from_file_location('release_qlo2', SCRIPT)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleasePipelineTests(unittest.TestCase):
    def test_semver_bumps_are_strict(self) -> None:
        self.assertEqual(release.bump_version('2.12.1', 'patch'), '2.12.2')
        self.assertEqual(release.bump_version('2.12.1', 'minor'), '2.13.0')
        self.assertEqual(release.bump_version('2.12.1', 'major'), '3.0.0')
        with self.assertRaises(ValueError):
            release.parse_version('2.12')
        with self.assertRaises(ValueError):
            release.parse_version('v2.12.1')

    def test_archive_is_exact_and_immutable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'dist').mkdir()
            files = {
                'main.js': b'plugin bundle',
                'manifest.json': json.dumps({'version': '3.4.5'}).encode(),
                'versions.json': b'{"3.4.5":"1.8.7"}',
                'styles.css': b'body {}',
                'README.md': b'docs',
                'LICENSE': b'license',
            }
            for name, value in files.items():
                path = root / 'dist/main.js' if name == 'main.js' else root / name
                path.write_bytes(value)
            original = release.ROOT
            release.ROOT = root
            try:
                archive = release.create_archive('3.4.5')
                hashes = release.validate_archive(archive, '3.4.5')
                self.assertEqual(hashes['main.js'], release.sha256_bytes(files['main.js']))
                with self.assertRaises(SystemExit):
                    release.create_archive('3.4.5')
            finally:
                release.ROOT = original

    def test_dev_install_preserves_data_and_rejects_source_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            plugin = Path(directory) / 'plugin'
            (root / 'dist').mkdir(parents=True)
            plugin.mkdir()
            (root / 'dist/main.js').write_bytes(b'bundle')
            (root / 'manifest.json').write_text('{"version":"1.0.0"}')
            (root / 'styles.css').write_bytes(b'css')
            settings = b'{"kept":true}'
            (plugin / 'data.json').write_bytes(settings)
            original = release.ROOT
            release.ROOT = root
            try:
                release.install_runtime(plugin, strict_dev=True)
                self.assertEqual((plugin / 'data.json').read_bytes(), settings)
                self.assertEqual({path.name for path in plugin.iterdir()}, release.DEV_ALLOWED)
                (plugin / 'main.ts').write_text('source must not be installed')
                with self.assertRaises(SystemExit):
                    release.install_runtime(plugin, strict_dev=True)
            finally:
                release.ROOT = original


if __name__ == '__main__':
    unittest.main()
