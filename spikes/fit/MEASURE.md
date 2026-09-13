# Measuring parts

Every value in `parts/*.json` starts as a nominal number from vendor drawings or common clones. **Measure
the actual part you'll put in the box.** Clone boards drift by a millimetre or more, which is more than any
clearance in the tolerance table.

Use calipers and take each measurement twice. Record the largest value (the part has to fit), and set
`"source"` to `measured <date>, <supplier>` once a file is done.

## Conventions

- **x** is the part's long side, **y** the short side, **z** up, when the part lies as it will be mounted.
- The origin is the min corner of the bounding box. For a PCB that's the board's corner; z = 0 is the lowest
  point of anything hanging below it (header pins, through-hole leads).
- A port's `center` is `[u, v]`: `u` along the side it faces, from that side's min end; `v` is height above
  z = 0.

## Per part

| Part | Measure | JSON fields |
| --- | --- | --- |
| **C-001 ESP32-S3-DevKitC-1** | Board length, width; height from pin tips to the top of the tallest component; PCB thickness; header pin length below the board. Each USB-C: centre from the board's -y edge, height of its centre above the pin tips, receptacle width and height. Check for mounting holes (many revisions have none) | `bounding_mm`, `pcb_thickness_mm`, `spike_ext.ports[].center/size`, `spike_ext.holes` |
| **P-001 BME280** | Board outline; height with components; hole centres from the board corner and hole diameter | `bounding_mm`, `spike_ext.holes` |
| **P-002 DS18B20 probe** | Probe tube diameter and length; cable diameter just behind the tube | `bounding_mm`, `mount.d_mm` (tube), `mount.cable_d_mm` |
| **E-001 18650 holder** | Outline with a cell fitted; mounting hole centres and diameter | `bounding_mm`, `spike_ext.holes` |
| **E-004 TP4056 USB-C** | Board outline; PCB thickness; USB-C centre (along the short edge, and height); how far the receptacle overhangs the board edge | `bounding_mm`, `pcb_thickness_mm`, `spike_ext.ports` |
| **USB-C cable** *(optional)* | Overmold width and height at the plug end. Not needed: `plug` defaults to the USB-IF compliance maximum, 12.35 × 6.5 mm, which fits any compliant cable. Measure only to tighten the opening for one known cable | `spike_ext.ports[].plug` |

If a receptacle overhangs the board edge, add the overhang to the length, so the part still sits at
clearance from the wall.
