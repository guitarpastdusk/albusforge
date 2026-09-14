"""Create deterministic, credential-free downloadable firmware ZIP."""
import sys
from pathlib import Path
import zipfile
root=Path(sys.argv[1])
files=['manifest.json','bootloader.bin','partition-table.bin','albusforge.bin','app.cpp','install.py','requirements.txt']
with zipfile.ZipFile(root/'firmware.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for name in files:
        info=zipfile.ZipInfo(name,date_time=(2020,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644 << 16
        archive.writestr(info,(root/name).read_bytes())
