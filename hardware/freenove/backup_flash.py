"""Read-only, resumable 16 MiB backup; validate each block against device MD5."""
import hashlib
from pathlib import Path
import esptool

ROOT = Path(__file__).parent / "backups"
ROOT.mkdir(exist_ok=True)
SIZE = 16 * 1024 * 1024
BLOCK = 64 * 1024
blank = b"\xff" * BLOCK
blank_md5 = hashlib.md5(blank).hexdigest()
esp = esptool.cmds.detect_chip('/dev/cu.usbmodem5B7A1164331', 115200)
esp = esptool.cmds.run_stub(esp)
esp.flash_set_parameters(SIZE)
# This board's USB bridge produced corrupt transfers at 460800 baud.
try:
    for offset in range(0, SIZE, BLOCK):
        target = ROOT / f"block-{offset:08x}.bin"
        expected = esp.flash_md5sum(offset, BLOCK)
        if target.exists() and hashlib.md5(target.read_bytes()).hexdigest() == expected:
            continue
        if expected == blank_md5:
            data = blank
        else:
            data = esp.read_flash(offset, BLOCK)
        if hashlib.md5(data).hexdigest() != expected:
            raise RuntimeError(f"Backup verification failed at {offset:#x}")
        target.write_bytes(data)
        if expected != blank_md5 or offset % (1024 * 1024) == 0:
            print(f"Verified {offset:#08x}: {'empty' if expected == blank_md5 else 'populated'}", flush=True)
    image = b"".join((ROOT / f"block-{offset:08x}.bin").read_bytes() for offset in range(0, SIZE, BLOCK))
    assert len(image) == SIZE
    if hashlib.md5(image).hexdigest() != esp.flash_md5sum(0, SIZE):
        raise RuntimeError("Whole-flash checksum mismatch")
    (ROOT / 'original-flash.bin').write_bytes(image)
    digest = hashlib.sha256(image).hexdigest()
    (ROOT / 'original-flash.sha256').write_text(digest + '  original-flash.bin\n')
    print('Complete 16 MiB backup verified; SHA256: ' + digest, flush=True)
finally:
    esp.hard_reset()
    esp._port.close()
