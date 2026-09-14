# Competitor size-metric review

- **571** records
- **531** sized
- **40** with no size (left out of size filtering, never guessed)
- **0** SUSPECT — value outside its plausible band, read these first

Each row quotes the spec line it matched and the raw fragment, so a wrong
mapping shows up as a wrong line beside the number rather than as a
plausible number with nothing behind it.

## Cap Machine — 12/12 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| MF-50-18 | 17000 pcs/h | Output: 17000 pcs/h | `Max. Capacity (pcs/hr)` | `17000-19000` | range 17000-19000, took low end |
| MF-80G | 20000 pcs/h | Output: 20000 pcs/h | `Capacity` | `20000-30000pcs/hr
产量: 20000-30000个/小时` | range 20000-30000, took low end |
| MF-50-24 | 25000 pcs/h | Output: 25000 pcs/h | `Max. Capacity (pcs/hr)` | `25000-28000` | range 25000-28000, took low end |
| MF-80E | 25000 pcs/h | Output: 25000 pcs/h | `Capacity` | `25000-30000pcs/hr;产量: 25000-30000个/小时` | range 25000-30000, took low end |
| MF-80C | 25000 pcs/h | Output: 25000 pcs/h | `Capacity` | `25000-30000pcs/hr;产量: 25000-30000个/小时` | range 25000-30000, took low end |
| MF-80B-24 | 30000 pcs/h | Output: 30000 pcs/h | `Max. Capacity (pcs/hr)` | `30000-35000` | range 30000-35000, took low end |
| MF-80D | 30000 pcs/h | Output: 30000 pcs/h | `Capacity` | `30000-35000pcs/hr(Thirty-six heads)
产量: 30000-35000个/小时(36头)` | range 30000-35000, took low end |
| MF-50-32 | 32000 pcs/h | Output: 32000 pcs/h | `Max. Capacity (pcs/hr)` | `32000-35000` | range 32000-35000, took low end |
| MF-80B-32 | 38000 pcs/h | Output: 38000 pcs/h | `Max. Capacity (pcs/hr)` | `38000-40000` | range 38000-40000, took low end |
| MF-80B-36 | 45000 pcs/h | Output: 45000 pcs/h | `Max. Capacity (pcs/hr)` | `45000-52000` | range 45000-52000, took low end |
| MF-80B-48 | 65000 pcs/h | Output: 65000 pcs/h | `Max. Capacity (pcs/hr)` | `65000-70000` | range 65000-70000, took low end |
| MF-80B-64 | 85000 pcs/h | Output: 85000 pcs/h | `Max. Capacity (pcs/hr)` | `85000-100000` | range 85000-100000, took low end |

## Chiller — 17/17 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| SL-2AA | 5.74 kW | Refrigeration capacity: 5.74 kW (1.6 ton refrigeration, TR) | `Refrigeration capacity` | `5.74 kW, 5160 Kcal/h` |  |
| SL-5AA | 14.87 kW | Refrigeration capacity: 14.87 kW (4.2 ton refrigeration, TR) | `Refrigeration capacity` | `14.87 kW, 12800 Kcal/h` |  |
| SL-5W | 14.87 kW | Refrigeration capacity: 14.87 kW (4.2 ton refrigeration, TR) | `Refrigeration capacity` | `14.87 kW, 12800 Kcal/h` |  |
| SL-8AA | 25 kW | Refrigeration capacity: 25 kW (7.1 ton refrigeration, TR) | `Refrigeration capacity` | `25 kW, 20640 Kcal/h` |  |
| SL-10W | 29.74 kW | Refrigeration capacity: 29.74 kW (8.5 ton refrigeration, TR) | `Refrigeration capacity` | `14.87x2 kW, 25800 Kcal/h` | x2 applied |
| SL-10AA | 29.74 kW | Refrigeration capacity: 29.74 kW (8.5 ton refrigeration, TR) | `Refrigeration capacity` | `14.87x2 kW, 25800 Kcal/h` | x2 applied |
| SL-12AA | 38.72 kW | Refrigeration capacity: 38.72 kW (11.0 ton refrigeration, TR) | `Refrigeration capacity` | `19.36x2 kW, 30960 Kcal/h` | x2 applied |
| SL-15W | 47.78 kW | Refrigeration capacity: 47.78 kW (13.6 ton refrigeration, TR) | `Refrigeration capacity` | `23.89x2 kW, 38700 Kcal/h` | x2 applied |
| SL-15AA | 47.78 kW | Refrigeration capacity: 47.78 kW (13.6 ton refrigeration, TR) | `Refrigeration capacity` | `23.89x2 kW, 38700 Kcal/h` | x2 applied |
| SL-20W | 59.2 kW | Refrigeration capacity: 59.2 kW (16.8 ton refrigeration, TR) | `Refrigeration capacity` | `29.6x2 kW, 51600 Kcal/h` | x2 applied |
| SL-20AA | 59.2 kW | Refrigeration capacity: 59.2 kW (16.8 ton refrigeration, TR) | `Refrigeration capacity` | `29.6x2 kW, 51600 Kcal/h` | x2 applied |
| SL-30AA | 88.8 kW | Refrigeration capacity: 88.8 kW (25.2 ton refrigeration, TR) | `Refrigeration capacity` | `29.6x3 kW, 77400 Kcal/h` | x3 applied |
| SL-30W | 88.8 kW | Refrigeration capacity: 88.8 kW (25.2 ton refrigeration, TR) | `Refrigeration capacity` | `29.6x3 kW, 77400 Kcal/h` | x3 applied |
| SL-40AA | 118.4 kW | Refrigeration capacity: 118.4 kW (33.7 ton refrigeration, TR) | `Refrigeration capacity` | `29.6x4 kW, 103200 Kcal/h` | x4 applied |
| SL-40W | 118.4 kW | Refrigeration capacity: 118.4 kW (33.7 ton refrigeration, TR) | `Refrigeration capacity` | `29.6x4 kW, 103200 Kcal/h` | x4 applied |
| SL-50AA | 135.36 kW | Refrigeration capacity: 135.36 kW (38.5 ton refrigeration, TR) | `Refrigeration capacity` | `33.84x4 kW, 129000 Kcal/h` | x4 applied |
| SL-60AA | 180 kW | Refrigeration capacity: 180 kW (51.2 ton refrigeration, TR) | `Refrigeration capacity` | `45x4 kW, 154800 Kcal/h` | x4 applied |

## Crusher / Granulator — 9/9 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| SG-2425-2B/2C | 15 kg/h | Throughput: 15 kg/h | `Crush Capacity(Kg/H)` | `15-20` | range 15-20, took low end |
| SG-2838-2B/2C | 20 kg/h | Throughput: 20 kg/h | `Crush Capacity(Kg/H)` | `20-25` | range 20-25, took low end |
| SG-3242-2B/2C | 25 kg/h | Throughput: 25 kg/h | `Crush Capacity(Kg/H)` | `25-30` | range 25-30, took low end |
| SG-180FET-2B/2C | 30 kg/h | Throughput: 30 kg/h | `Crush Capacity(Kg/H)` | `30-50` | range 30-50, took low end |
| SG-3844-2B/2C | 35 kg/h | Throughput: 35 kg/h | `Crush Capacity(Kg/H)` | `35-40` | range 35-40, took low end |
| SG-240FET-2B/2C | 50 kg/h | Throughput: 50 kg/h | `Crush Capacity(Kg/H)` | `50-80` | range 50-80, took low end |
| SG-300FET-2B/2C | 50 kg/h | Throughput: 50 kg/h | `Crush Capacity(Kg/H)` | `50-100` | range 50-100, took low end |
| SG-360FET-2B/2C | 80 kg/h | Throughput: 80 kg/h | `Crush Capacity(Kg/H)` | `80-130` | range 80-130, took low end |
| SG-420FET-2B/2C | 100 kg/h | Throughput: 100 kg/h | `Crush Capacity(Kg/H)` | `100-150` | range 100-150, took low end |

## Injection Molding Machine — 246/246 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| HD160 (screw 36mm) | 160 kN | Clamping force: 160 kN (16 ton) | `Clamping force` | `160 kN` |  |
| HD160 (screw 28mm) | 160 kN | Clamping force: 160 kN (16 ton) | `Clamping force` | `160 kN` |  |
| HD160 (screw 30mm) | 160 kN | Clamping force: 160 kN (16 ton) | `Clamping force` | `160 kN` |  |
| HD160 (screw 24mm) | 160 kN | Clamping force: 160 kN (16 ton) | `Clamping force` | `160 kN` |  |
| HD160 (screw 26mm) | 160 kN | Clamping force: 160 kN (16 ton) | `Clamping force` | `160 kN` |  |
| HD160 (screw 32mm) | 160 kN | Clamping force: 160 kN (16 ton) | `Clamping force` | `160 kN` |  |
| HD200BR (Toothbrush Special) (screw 42mm) | 200 kN | Clamping force: 200 kN (20 ton) | `Clamping force` | `200 kN` |  |
| HD200BR (Toothbrush Special) (screw 36mm) | 200 kN | Clamping force: 200 kN (20 ton) | `Clamping force` | `200 kN` |  |
| HD200BR (Toothbrush Special) (screw 45mm) | 200 kN | Clamping force: 200 kN (20 ton) | `Clamping force` | `200 kN` |  |
| HD200BR (Toothbrush Special) (screw 38mm) | 200 kN | Clamping force: 200 kN (20 ton) | `Clamping force` | `200 kN` |  |
| HD230 (screw 26mm) | 230 kN | Clamping force: 230 kN (23 ton) | `Clamping force` | `230 kN` |  |
| HD230 (screw 28mm) | 230 kN | Clamping force: 230 kN (23 ton) | `Clamping force` | `230 kN` |  |
| HD230 (screw 30mm) | 230 kN | Clamping force: 230 kN (23 ton) | `Clamping force` | `230 kN` |  |
| HD230 (screw 24mm) | 230 kN | Clamping force: 230 kN (23 ton) | `Clamping force` | `230 kN` |  |
| HD230 (screw 36mm) | 230 kN | Clamping force: 230 kN (23 ton) | `Clamping force` | `230 kN` |  |
| HD230 (screw 32mm) | 230 kN | Clamping force: 230 kN (23 ton) | `Clamping force` | `230 kN` |  |
| HD250P (Pen-making Special) (screw 36mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250BR (Toothbrush Special) (screw 38mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250BR (Toothbrush Special) (screw 48mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250BR (Toothbrush Special) (screw 45mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250P (Pen-making Special) (screw 32mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250BR (Toothbrush Special) (screw 36mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250P (Pen-making Special) (screw 42mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250P (Pen-making Special) (screw 30mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250BR (Toothbrush Special) (screw 42mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD250P (Pen-making Special) (screw 38mm) | 250 kN | Clamping force: 250 kN (25 ton) | `Clamping force` | `250 kN` |  |
| HD280 (screw 42mm) | 280 kN | Clamping force: 280 kN (28 ton) | `Clamping force` | `280 kN` |  |
| HD280 (screw 32mm) | 280 kN | Clamping force: 280 kN (28 ton) | `Clamping force` | `280 kN` |  |
| HD280 (screw 36mm) | 280 kN | Clamping force: 280 kN (28 ton) | `Clamping force` | `280 kN` |  |
| HD280 (screw 45mm) | 280 kN | Clamping force: 280 kN (28 ton) | `Clamping force` | `280 kN` |  |
| HD280 (screw 38mm) | 280 kN | Clamping force: 280 kN (28 ton) | `Clamping force` | `280 kN` |  |
| HD280 (screw 30mm) | 280 kN | Clamping force: 280 kN (28 ton) | `Clamping force` | `280 kN` |  |
| HD320BR (Toothbrush Special) (screw 36mm) | 320 kN | Clamping force: 320 kN (32 ton) | `Clamping force` | `320 kN` |  |
| HD320BR (Toothbrush Special) (screw 45mm) | 320 kN | Clamping force: 320 kN (32 ton) | `Clamping force` | `320 kN` |  |
| HD320BR (Toothbrush Special) (screw 42mm) | 320 kN | Clamping force: 320 kN (32 ton) | `Clamping force` | `320 kN` |  |
| HD320BR (Toothbrush Special) (screw 38mm) | 320 kN | Clamping force: 320 kN (32 ton) | `Clamping force` | `320 kN` |  |
| HD320BR (Toothbrush Special) (screw 48mm) | 320 kN | Clamping force: 320 kN (32 ton) | `Clamping force` | `320 kN` |  |
| HD350 (screw 36mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force` | `350 kN` |  |
| HD350 (screw 45mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force` | `350 kN` |  |
| HD350 (screw 38mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force` | `350 kN` |  |
| HD350 (screw 42mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force` | `350 kN` |  |
| HD350 (screw 50mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force` | `350 kN` |  |
| HD350 (screw 48mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force` | `350 kN` |  |
| HD400NB (screw 28mm, 230) | 400 kN | Clamping force: 400 kN (40 ton) | `Clamping force` | `400kN` |  |
| HD400NB (screw 24mm, 230) | 400 kN | Clamping force: 400 kN (40 ton) | `Clamping force` | `400kN` |  |
| HD400NB (screw 32mm, 300) | 400 kN | Clamping force: 400 kN (40 ton) | `Clamping force` | `400kN` |  |
| HD400NB (screw 36mm, 300) | 400 kN | Clamping force: 400 kN (40 ton) | `Clamping force` | `400kN` |  |
| HD400NB (screw 30mm, 300) | 400 kN | Clamping force: 400 kN (40 ton) | `Clamping force` | `400kN` |  |
| HD400NB (screw 26mm, 230) | 400 kN | Clamping force: 400 kN (40 ton) | `Clamping force` | `400kN` |  |
| HD450 (screw 50mm) | 450 kN | Clamping force: 450 kN (45 ton) | `Clamping force` | `450 kN` |  |
| HD450 (screw 45mm) | 450 kN | Clamping force: 450 kN (45 ton) | `Clamping force` | `450 kN` |  |
| HD450 (screw 60mm) | 450 kN | Clamping force: 450 kN (45 ton) | `Clamping force` | `450 kN` |  |
| HD450 (screw 55mm) | 450 kN | Clamping force: 450 kN (45 ton) | `Clamping force` | `450 kN` |  |
| HD450 (screw 42mm) | 450 kN | Clamping force: 450 kN (45 ton) | `Clamping force` | `450 kN` |  |
| HD450 (screw 48mm) | 450 kN | Clamping force: 450 kN (45 ton) | `Clamping force` | `450 kN` |  |
| HD550 (screw 42mm) | 550 kN | Clamping force: 550 kN (55 ton) | `Clamping force` | `550kN` |  |
| HD550 (screw 55mm, 1380) | 550 kN | Clamping force: 550 kN (55 ton) | `Clamping force` | `550kN` |  |
| HD550 (screw 50mm, 1380) | 550 kN | Clamping force: 550 kN (55 ton) | `Clamping force` | `550kN` |  |
| HD550 (screw 45mm, 1380) | 550 kN | Clamping force: 550 kN (55 ton) | `Clamping force` | `550kN` |  |
| HD550 (screw 45mm) | 550 kN | Clamping force: 550 kN (55 ton) | `Clamping force` | `550kN` |  |
| HD550 (screw 48mm) | 550 kN | Clamping force: 550 kN (55 ton) | `Clamping force` | `550kN` |  |
| HD650 (screw 45mm, 1380) | 650 kN | Clamping force: 650 kN (65 ton) | `Clamping force` | `650kN` |  |
| HD650 (screw 42mm) | 650 kN | Clamping force: 650 kN (65 ton) | `Clamping force` | `650kN` |  |
| HD650 (screw 50mm, 1380) | 650 kN | Clamping force: 650 kN (65 ton) | `Clamping force` | `650kN` |  |
| HD650 (screw 48mm) | 650 kN | Clamping force: 650 kN (65 ton) | `Clamping force` | `650kN` |  |
| HD650 (screw 45mm) | 650 kN | Clamping force: 650 kN (65 ton) | `Clamping force` | `650kN` |  |
| HD650 (screw 55mm, 1380) | 650 kN | Clamping force: 650 kN (65 ton) | `Clamping force` | `650kN` |  |
| HD800NB (Note Book Special) (screw 42mm) | 800 kN | Clamping force: 800 kN (80 ton) | `Clamping force` | `800 kN` |  |
| HD800NB (Note Book Special) (screw 36mm) | 800 kN | Clamping force: 800 kN (80 ton) | `Clamping force` | `800 kN` |  |
| HD800NB (Note Book Special) (screw 38mm) | 800 kN | Clamping force: 800 kN (80 ton) | `Clamping force` | `800 kN` |  |
| HD800NB (Note Book Special) (screw 45mm) | 800 kN | Clamping force: 800 kN (80 ton) | `Clamping force` | `800 kN` |  |
| HD850 (screw 45mm, 1380) | 850 kN | Clamping force: 850 kN (85 ton) | `Clamping force` | `850kN` |  |
| HD850 (screw 60mm, 2960) | 850 kN | Clamping force: 850 kN (85 ton) | `Clamping force` | `850kN` |  |
| HD850 (screw 70mm, 3600) | 850 kN | Clamping force: 850 kN (85 ton) | `Clamping force` | `850kN` |  |
| HD850 (screw 50mm, 1380) | 850 kN | Clamping force: 850 kN (85 ton) | `Clamping force` | `850kN` |  |
| HD850 (screw 55mm, 1380) | 850 kN | Clamping force: 850 kN (85 ton) | `Clamping force` | `850kN` |  |
| HD850 (screw 80mm, 3600) | 850 kN | Clamping force: 850 kN (85 ton) | `Clamping force` | `850kN` |  |
| UN100EMH PLUS (B) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000 KN; Space between tie bars(H×V): 410×360 mm; MIN.mold d` |  |
| UN100EMH PLUS (A) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000 KN; Space between tie bars(H×V): 410×360 mm; MIN.mold d` |  |
| UN100EMH PLUS (AA) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000 KN; Space between tie bars(H×V): 410×360 mm; MIN.mold d` |  |
| UN100EPIII (screw 40mm) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000 KN, Space between tie bars(H×V): 410X360 mm, MIN.mold d` |  |
| UN100EPIII (screw 32mm) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000 KN, Space between tie bars(H×V): 410X360 mm, MIN.mold d` |  |
| UN100EPIII (screw 36mm) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000 KN, Space between tie bars(H×V): 410X360 mm, MIN.mold d` |  |
| UN100EMH PLUS (C) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000 KN; Space between tie bars(H×V): 410×360 mm; MIN.mold d` |  |
| HD1000 (screw 55mm, 1380) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000kN` |  |
| HD1000 (screw 60mm, 2960) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000kN` |  |
| HD1000 (screw 70mm, 3600) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000kN` |  |
| HD1000 (screw 50mm, 1380) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000kN` |  |
| HD1000 (screw 45mm, 1380) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000kN` |  |
| HD1000 (screw 80mm, 3600) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force` | `1000kN` |  |
| LS 130 G (340) | 1300 kN | Clamping force: 1300 kN (130 ton) | `Clamping force` | `1300 KN` |  |
| HD-1300LP/3HD1300LP (screw 45mm) | 1300 kN | Clamping force: 1300 kN (130 ton) | `Clamping force` | `1300 kN` |  |
| HD-1300LP/3HD1300LP (screw 50mm) | 1300 kN | Clamping force: 1300 kN (130 ton) | `Clamping force` | `1300 kN` |  |
| HD-1300LP/3HD1300LP (screw 55mm) | 1300 kN | Clamping force: 1300 kN (130 ton) | `Clamping force` | `1300 kN` |  |
| UN140EPIII (screw 45mm) | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 KN, Space between tie bars(H×V): 460X410 mm, MIN.mold d` |  |
| UN140EPIII (screw 40mm) | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 KN, Space between tie bars(H×V): 460X410 mm, MIN.mold d` |  |
| UN140EMH PLUS (AA) | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 KN; Space between tie bars(H×V): 460×410 mm; MIN.mold d` |  |
| UN140EPIII (screw 36mm) | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 KN, Space between tie bars(H×V): 460X410 mm, MIN.mold d` |  |
| UN140EMH PLUS (A) | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 KN; Space between tie bars(H×V): 460×410 mm; MIN.mold d` |  |
| UN140-EPIII [UPVC/PVC configuration] | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 kN, Space between tie bars (H×V): 460×410 mm, MIN. mold` |  |
| UN140EMH PLUS (B) | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 KN; Space between tie bars(H×V): 460×410 mm; MIN.mold d` |  |
| UN140EMH PLUS (C) | 1400 kN | Clamping force: 1400 kN (140 ton) | `Clamping force` | `1400 KN; Space between tie bars(H×V): 460×410 mm; MIN.mold d` |  |
| HD1500LP/3HD1500LP (screw 55mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force` | `1500 kN` |  |
| HD1500LP/3HD1500LP (screw 60mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force` | `1500 kN` |  |
| HD1500LP/3HD1500LP (screw 90mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force` | `1500 kN` |  |
| HD1500LP/3HD1500LP (screw 80mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force` | `1500 kN` |  |
| HD1500LP/3HD1500LP (screw 70mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force` | `1500 kN` |  |
| LS 170 G (400) | 1700 kN | Clamping force: 1700 kN (170 ton) | `Clamping force` | `1700 KN` |  |
| HD1700LP/3HD1700LP (screw 50mm) | 1700 kN | Clamping force: 1700 kN (170 ton) | `Clamping force` | `1700 kN` |  |
| HD1700LP/3HD1700LP (screw 70mm) | 1700 kN | Clamping force: 1700 kN (170 ton) | `Clamping force` | `1700 kN` |  |
| HD1700LP/3HD1700LP (screw 80mm) | 1700 kN | Clamping force: 1700 kN (170 ton) | `Clamping force` | `1700 kN` |  |
| HD1700LP/3HD1700LP (screw 60mm) | 1700 kN | Clamping force: 1700 kN (170 ton) | `Clamping force` | `1700 kN` |  |
| HD1700LP/3HD1700LP (screw 90mm) | 1700 kN | Clamping force: 1700 kN (170 ton) | `Clamping force` | `1700 kN` |  |
| HD1700LP/3HD1700LP (screw 45mm) | 1700 kN | Clamping force: 1700 kN (170 ton) | `Clamping force` | `1700 kN` |  |
| UN180EMH PLUS (C) | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN; Space between tie bars(H×V): 520×470 mm; MIN.mold d` |  |
| UN180EPIII (screw 40mm) | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN, Space between tie bars(H×V): 520X470 mm, MIN.mold d` |  |
| UN180EMH PLUS (A) | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN; Space between tie bars(H×V): 520×470 mm; MIN.mold d` |  |
| UN180EPIII (screw 45mm) | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN, Space between tie bars(H×V): 520X470 mm, MIN.mold d` |  |
| UN180EMH PLUS (AA) | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN; Space between tie bars(H×V): 520×470 mm; MIN.mold d` |  |
| UN180-EPIII [UPVC/PVC configuration] | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 kN
Space between tie bars(H×V): 520×470 mm
MIN. mold di` |  |
| UN180EPIII (screw 50mm) | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN, Space between tie bars(H×V): 520X470 mm, MIN.mold d` |  |
| UN180EMH PLUS (B) | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN; Space between tie bars(H×V): 520×470 mm; MIN.mold d` |  |
| LS 200 G (600) | 2000 kN | Clamping force: 2000 kN (200 ton) | `Clamping force` | `2000 KN` |  |
| HD-2000/3HD-2000LP (screw 42mm) | 2000 kN | Clamping force: 2000 kN (200 ton) | `Clamping force` | `2000 kN` |  |
| HD-2000/3HD-2000LP (screw 80mm) | 2000 kN | Clamping force: 2000 kN (200 ton) | `Clamping force` | `2000 kN` |  |
| HD-2000/3HD-2000LP (screw 70mm) | 2000 kN | Clamping force: 2000 kN (200 ton) | `Clamping force` | `2000 kN` |  |
| HD-2000/3HD-2000LP (screw 60mm) | 2000 kN | Clamping force: 2000 kN (200 ton) | `Clamping force` | `2000 kN` |  |
| LS 220 G (600) | 2200 kN | Clamping force: 2200 kN (220 ton) | `Clamping force` | `2200 KN` |  |
| UN230EMH PLUS (AA) | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN; Space between tie bars(H×V): 570×520 mm; MIN.mold d` |  |
| UN230EMH PLUS (B) | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN; Space between tie bars(H×V): 570×520 mm; MIN.mold d` |  |
| UN230EPIII (screw 45mm) | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN, Space between tie bars(H×V): 570X520 mm, MIN.mold d` |  |
| UN230EMH PLUS (A) | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN; Space between tie bars(H×V): 570×520 mm; MIN.mold d` |  |
| UN230EPIII (screw 50mm) | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN, Space between tie bars(H×V): 570X520 mm, MIN.mold d` |  |
| UN230EMH PLUS (C) | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN; Space between tie bars(H×V): 570×520 mm; MIN.mold d` |  |
| UN230EPIII (screw 55mm) | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN, Space between tie bars(H×V): 570X520 mm, MIN.mold d` |  |
| UN230-EPIII [UPVC/PVC configuration] | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 kN
Space between tie bars(H×V): 570×520 mm
MIN. mold di` |  |
| HD-2500/3HD-2500LP (screw 45mm) | 2500 kN | Clamping force: 2500 kN (250 ton) | `Clamping force` | `2500 kN` |  |
| HD-2500/3HD-2500LP (screw 90mm) | 2500 kN | Clamping force: 2500 kN (250 ton) | `Clamping force` | `2500 kN` |  |
| HD-2500/3HD-2500LP (screw 70mm) | 2500 kN | Clamping force: 2500 kN (250 ton) | `Clamping force` | `2500 kN` |  |
| HD-2500/3HD-2500LP (screw 80mm) | 2500 kN | Clamping force: 2500 kN (250 ton) | `Clamping force` | `2500 kN` |  |
| UN270EMH PLUS (B) | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN; Space between tie bars(H×V): 620×570 mm; MIN.mold d` |  |
| UN270EPIII (screw 65mm) | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN
Space between tie bars(H×V): 620X570 mm
MIN.mold dim` |  |
| UN270-EPIII [UPVC/PVC configuration] | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 kN; Space between tie bars (H×V): 620×570 mm; MIN. mold` |  |
| UN270EMH PLUS (C) | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN; Space between tie bars(H×V): 620×570 mm; MIN.mold d` |  |
| UN270EPIII (screw 55mm) | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN
Space between tie bars(H×V): 620X570 mm
MIN.mold dim` |  |
| UN270EMH PLUS (A) | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN; Space between tie bars(H×V): 620×570 mm; MIN.mold d` |  |
| UN270EPIII (screw 60mm) | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN
Space between tie bars(H×V): 620X570 mm
MIN.mold dim` |  |
| UN270EMH PLUS (AA) | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN; Space between tie bars(H×V): 620×570 mm; MIN.mold d` |  |
| LS 290 G (770) | 2900 kN | Clamping force: 2900 kN (290 ton) | `Clamping force` | `2900 KN` |  |
| UN300-EPIII [UPVC/PVC configuration] | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 kN, Space between tie bars (H×V): 670×620 mm, MIN. mold` |  |
| UN300EPIII (screw 70mm) | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN
Space between tie bars(H×V): 670X620 mm
MIN.mold dim` |  |
| UN300EPIII (screw 60mm) | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN
Space between tie bars(H×V): 670X620 mm
MIN.mold dim` |  |
| UN300EPIII (screw 65mm) | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN
Space between tie bars(H×V): 670X620 mm
MIN.mold dim` |  |
| UN300EMH PLUS (C) | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN; Space between tie bars(H×V): 670×620 mm; MIN.mold d` |  |
| UN300EMH PLUS (B) | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN; Space between tie bars(H×V): 670×620 mm; MIN.mold d` |  |
| UN300EMH PLUS (AA) | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN; Space between tie bars(H×V): 670×620 mm; MIN.mold d` |  |
| UN300EMH PLUS (A) | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN; Space between tie bars(H×V): 670×620 mm; MIN.mold d` |  |
| LS 310 G (770) | 3100 kN | Clamping force: 3100 kN (310 ton) | `Clamping force` | `3100 KN` |  |
| LS 350 G (770) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN` |  |
| UN350EPIII (screw 65mm) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN
Space between tie bars(H×V): 730X670 mm
MIN.mold dim` |  |
| UN350EMH PLUS (C) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN; Space between tie bars(H×V): 730×670 mm; MIN.mold d` |  |
| UN350EMH PLUS (AA) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN; Space between tie bars(H×V): 730×670 mm; MIN.mold d` |  |
| UN350EMH PLUS (A) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN; Space between tie bars(H×V): 730×670 mm; MIN.mold d` |  |
| UN350EPIII (screw 75mm) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN
Space between tie bars(H×V): 730X670 mm
MIN.mold dim` |  |
| UN350-EPIII [UPVC/PVC configuration] | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 kN, Space between tie bars (H×V): 730×670 mm, MIN. mold` |  |
| UN350EMH PLUS (B) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN; Space between tie bars(H×V): 730×670 mm; MIN.mold d` |  |
| UN350EPIII (screw 70mm) | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN
Space between tie bars(H×V): 730X670 mm
MIN.mold dim` |  |
| LS 380 G (900) | 3800 kN | Clamping force: 3800 kN (380 ton) | `Clamping force` | `3800 KN` |  |
| LS 420 G (900) | 4200 kN | Clamping force: 4200 kN (420 ton) | `Clamping force` | `4200 KN` |  |
| UN420EPIII (screw 70mm) | 4200 kN | Clamping force: 4200 kN (420 ton) | `Clamping force` | `4200 KN
Space between tie bars(H×V): 770X720 mm
MIN.mold dim` |  |
| UN420-EPIII [UPVC/PVC configuration] | 4200 kN | Clamping force: 4200 kN (420 ton) | `Clamping force` | `4200 kN, Space between tie bars (H×V): 770×720 mm, MIN. mold` |  |
| UN420EPIII (screw 80mm) | 4200 kN | Clamping force: 4200 kN (420 ton) | `Clamping force` | `4200 KN
Space between tie bars(H×V): 770X720 mm
MIN.mold dim` |  |
| UN420EPIII (screw 75mm) | 4200 kN | Clamping force: 4200 kN (420 ton) | `Clamping force` | `4200 KN
Space between tie bars(H×V): 770X720 mm
MIN.mold dim` |  |
| LS 458 G (1000) | 4580 kN | Clamping force: 4580 kN (458 ton) | `Clamping force` | `4580 KN` |  |
| LS 490 G (1000) | 4900 kN | Clamping force: 4900 kN (490 ton) | `Clamping force` | `4900 KN` |  |
| UN530-EPIII [UPVC/PVC configuration] | 5300 kN | Clamping force: 5300 kN (530 ton) | `Clamping force` | `5300 kN, Space between tie bars (H×V): 870×820 mm, MIN. mold` |  |
| UN530EPIII (screw specification 80mm) | 5300 kN | Clamping force: 5300 kN (530 ton) | `Clamping force` | `5300KN, Space between tie bars(H×V): 870X820mm, MIN.mold dim` |  |
| UN530EPIII (screw specification 90mm) | 5300 kN | Clamping force: 5300 kN (530 ton) | `Clamping force` | `5300KN, Space between tie bars(H×V): 870X820mm, MIN.mold dim` |  |
| UN530EPIII (screw specification 85mm) | 5300 kN | Clamping force: 5300 kN (530 ton) | `Clamping force` | `5300KN, Space between tie bars(H×V): 870X820mm, MIN.mold dim` |  |
| UN530EPIII (screw specification 75mm) | 5300 kN | Clamping force: 5300 kN (530 ton) | `Clamping force` | `5300KN, Space between tie bars(H×V): 870X820mm, MIN.mold dim` |  |
| UN600-EPIII [UPVC/PVC configuration] | 6000 kN | Clamping force: 6000 kN (600 ton) | `Clamping force` | `6000 kN, Space between tie bars (H×V): 920×870 mm, MIN. mold` |  |
| UN600EPIII (screw specification 90mm) | 6000 kN | Clamping force: 6000 kN (600 ton) | `Clamping force` | `6000KN, Space between tie bars(H×V): 920X870mm, MIN.mold dim` |  |
| UN600EPIII (screw specification 80mm) | 6000 kN | Clamping force: 6000 kN (600 ton) | `Clamping force` | `6000KN, Space between tie bars(H×V): 920X870mm, MIN.mold dim` |  |
| UN600EPIII (screw specification 100mm) | 6000 kN | Clamping force: 6000 kN (600 ton) | `Clamping force` | `6000KN, Space between tie bars(H×V): 920X870mm, MIN.mold dim` |  |
| UN600EPIII (screw specification 85mm) | 6000 kN | Clamping force: 6000 kN (600 ton) | `Clamping force` | `6000KN, Space between tie bars(H×V): 920X870mm, MIN.mold dim` |  |
| LS 680 G (3300) | 6800 kN | Clamping force: 6800 kN (680 ton) | `Clamping force` | `6800 KN` |  |
| UN700-EPIII [UPVC/PVC configuration] | 7000 kN | Clamping force: 7000 kN (700 ton) | `Clamping force` | `7000 kN, Space between tie bars (H×V): 1000×950 mm, MIN. mol` |  |
| UN700EPIII (screw specification 85mm) | 7000 kN | Clamping force: 7000 kN (700 ton) | `Clamping force` | `7000KN, Space between tie bars(H×V): 1000X950mm, MIN.mold di` |  |
| UN700EPIII (screw specification 100mm) | 7000 kN | Clamping force: 7000 kN (700 ton) | `Clamping force` | `7000KN, Space between tie bars(H×V): 1000X950mm, MIN.mold di` |  |
| UN700EPIII (screw specification 110mm) | 7000 kN | Clamping force: 7000 kN (700 ton) | `Clamping force` | `7000KN, Space between tie bars(H×V): 1000X950mm, MIN.mold di` |  |
| UN700EPIII (screw specification 90mm) | 7000 kN | Clamping force: 7000 kN (700 ton) | `Clamping force` | `7000KN, Space between tie bars(H×V): 1000X950mm, MIN.mold di` |  |
| UN850EPIII (screw specification 110mm) | 8500 kN | Clamping force: 8500 kN (850 ton) | `Clamping force` | `8500KN, Space between tie bars(H×V): 1120X1020mm, MIN.mold d` |  |
| UN850EPIII (screw specification 120mm) | 8500 kN | Clamping force: 8500 kN (850 ton) | `Clamping force` | `8500KN, Space between tie bars(H×V): 1120X1020mm, MIN.mold d` |  |
| UN850EPIII (screw specification 100mm) | 8500 kN | Clamping force: 8500 kN (850 ton) | `Clamping force` | `8500KN, Space between tie bars(H×V): 1120X1020mm, MIN.mold d` |  |
| UN850EPIII (screw specification 90mm) | 8500 kN | Clamping force: 8500 kN (850 ton) | `Clamping force` | `8500KN, Space between tie bars(H×V): 1120X1020mm, MIN.mold d` |  |
| LS 928 G (3900) | 9280 kN | Clamping force: 9280 kN (928 ton) | `Clamping force` | `9280 KN` |  |
| UN1050EPIII (screw specification 130mm) | 10500 kN | Clamping force: 10500 kN (1050 ton) | `Clamping force` | `10500KN, Space between tie bars(H×V): 1220X1120mm, MIN.mold ` |  |
| UN1050EPIII (screw specification 120mm) | 10500 kN | Clamping force: 10500 kN (1050 ton) | `Clamping force` | `10500KN, Space between tie bars(H×V): 1220X1120mm, MIN.mold ` |  |
| UN1050EPIII (screw specification 110mm) | 10500 kN | Clamping force: 10500 kN (1050 ton) | `Clamping force` | `10500KN, Space between tie bars(H×V): 1220X1120mm, MIN.mold ` |  |
| UN1050EPIII (screw specification 100mm) | 10500 kN | Clamping force: 10500 kN (1050 ton) | `Clamping force` | `10500KN, Space between tie bars(H×V): 1220X1120mm, MIN.mold ` |  |
| UN1350EPIII (screw 120mm) | 13500 kN | Clamping force: 13500 kN (1350 ton) | `Clamping force` | `13500 KN, Space between tie bars(H×V): 1380×1280 mm, MIN.mol` |  |
| UN1350EPIII (screw 140mm) | 13500 kN | Clamping force: 13500 kN (1350 ton) | `Clamping force` | `13500 KN, Space between tie bars(H×V): 1380×1280 mm, MIN.mol` |  |
| UN1350EPIII (screw 130mm) | 13500 kN | Clamping force: 13500 kN (1350 ton) | `Clamping force` | `13500 KN, Space between tie bars(H×V): 1380×1280 mm, MIN.mol` |  |
| UN1350EPIII (screw 110mm) | 13500 kN | Clamping force: 13500 kN (1350 ton) | `Clamping force` | `13500 KN, Space between tie bars(H×V): 1380×1280 mm, MIN.mol` |  |
| UN1600EPIII (screw 140mm) | 16000 kN | Clamping force: 16000 kN (1600 ton) | `Clamping force` | `16000 KN, Space between tie bars(H×V): 1570×1430 mm, MIN.mol` |  |
| UN1600EPIII (screw 150mm) | 16000 kN | Clamping force: 16000 kN (1600 ton) | `Clamping force` | `16000 KN, Space between tie bars(H×V): 1570×1430 mm, MIN.mol` |  |
| UN1600EPIII (screw 120mm) | 16000 kN | Clamping force: 16000 kN (1600 ton) | `Clamping force` | `16000 KN, Space between tie bars(H×V): 1570×1430 mm, MIN.mol` |  |
| UN1600EPIII (screw 130mm) | 16000 kN | Clamping force: 16000 kN (1600 ton) | `Clamping force` | `16000 KN, Space between tie bars(H×V): 1570×1430 mm, MIN.mol` |  |
| UN1850EPIII (screw 150mm) | 18500 kN | Clamping force: 18500 kN (1850 ton) | `Clamping force` | `18500 KN, Space between tie bars(H×V): 1680×1530 mm, MIN.mol` |  |
| UN1850EPIII (screw 160mm) | 18500 kN | Clamping force: 18500 kN (1850 ton) | `Clamping force` | `18500 KN, Space between tie bars(H×V): 1680×1530 mm, MIN.mol` |  |
| UN1850EPIII (screw 130mm) | 18500 kN | Clamping force: 18500 kN (1850 ton) | `Clamping force` | `18500 KN, Space between tie bars(H×V): 1680×1530 mm, MIN.mol` |  |
| UN1850EPIII (screw 140mm) | 18500 kN | Clamping force: 18500 kN (1850 ton) | `Clamping force` | `18500 KN, Space between tie bars(H×V): 1680×1530 mm, MIN.mol` |  |
| DPL2100-SP26000 (screw 150mm) | 21000 kN | Clamping force: 21000 kN (2100 ton) | `Clamping force` | `21000 KN` |  |
| DPL2100-SP26000 (screw 165mm) | 21000 kN | Clamping force: 21000 kN (2100 ton) | `Clamping force` | `21000 KN` |  |
| UN2200EPIII/23700 (screw specification 170mm) | 22000 kN | Clamping force: 22000 kN (2200 ton) | `Clamping force` | `22000KN, Space between tie bars(H×V): 1800×1600mm, MIN.mold ` |  |
| UN2200EPIII/23700 (screw specification 160mm) | 22000 kN | Clamping force: 22000 kN (2200 ton) | `Clamping force` | `22000KN, Space between tie bars(H×V): 1800×1600mm, MIN.mold ` |  |
| UN2200EPIII/23700 (screw specification 150mm) | 22000 kN | Clamping force: 22000 kN (2200 ton) | `Clamping force` | `22000KN, Space between tie bars(H×V): 1800×1600mm, MIN.mold ` |  |
| UN2200EPIII/23700 (screw specification 140mm) | 22000 kN | Clamping force: 22000 kN (2200 ton) | `Clamping force` | `22000KN, Space between tie bars(H×V): 1800×1600mm, MIN.mold ` |  |
| DPL2400-SP40600 (screw 180mm) | 24000 kN | Clamping force: 24000 kN (2400 ton) | `Clamping force` | `24000 KN` |  |
| DPL2400-SP40600 (screw 200mm) | 24000 kN | Clamping force: 24000 kN (2400 ton) | `Clamping force` | `24000 KN` |  |
| UN2500EPIII/40600 (screw specification 180mm) | 25000 kN | Clamping force: 25000 kN (2500 ton) | `Clamping force` | `25000KN, Space between tie bars(H×V): 1950×1700mm, MIN.mold ` |  |
| UN2500EPIII/40600 (screw specification 200mm) | 25000 kN | Clamping force: 25000 kN (2500 ton) | `Clamping force` | `25000KN, Space between tie bars(H×V): 1950×1700mm, MIN.mold ` |  |
| UN2500EPIII/40600 (screw specification 190mm) | 25000 kN | Clamping force: 25000 kN (2500 ton) | `Clamping force` | `25000KN, Space between tie bars(H×V): 1950×1700mm, MIN.mold ` |  |
| UN2500EPIII/40600 (screw specification 170mm) | 25000 kN | Clamping force: 25000 kN (2500 ton) | `Clamping force` | `25000KN, Space between tie bars(H×V): 1950×1700mm, MIN.mold ` |  |
| DPL2800-SP52700 (screw 200mm) | 28000 kN | Clamping force: 28000 kN (2800 ton) | `Clamping force` | `28000 KN` |  |
| DPL2800-SP52700 (screw 220mm) | 28000 kN | Clamping force: 28000 kN (2800 ton) | `Clamping force` | `28000 KN` |  |
| UN2900EPIII/50500 (screw specification 200mm) | 29000 kN | Clamping force: 29000 kN (2900 ton) | `Clamping force` | `29000KN, Space between tie bars(H×V): 2100×1800mm, MIN.mold ` |  |
| UN2900EPIII/50500 (screw specification 190mm) | 29000 kN | Clamping force: 29000 kN (2900 ton) | `Clamping force` | `29000KN, Space between tie bars(H×V): 2100×1800mm, MIN.mold ` |  |
| UN2900EPIII/50500 (screw specification 180mm) | 29000 kN | Clamping force: 29000 kN (2900 ton) | `Clamping force` | `29000KN, Space between tie bars(H×V): 2100×1800mm, MIN.mold ` |  |
| UN2900EPIII/50500 (screw specification 220mm) | 29000 kN | Clamping force: 29000 kN (2900 ton) | `Clamping force` | `29000KN, Space between tie bars(H×V): 2100×1800mm, MIN.mold ` |  |
| DPL3100-SP92500 (screw 240mm) | 31000 kN | Clamping force: 31000 kN (3100 ton) | `Clamping force` | `31000 KN` |  |
| DPL3100-SP72200 (screw 220mm) | 31000 kN | Clamping force: 31000 kN (3100 ton) | `Clamping force` | `31000 KN` |  |
| DPL3100-SP92500 (screw 260mm) | 31000 kN | Clamping force: 31000 kN (3100 ton) | `Clamping force` | `31000 KN` |  |
| DPL3100-SP72200 (screw 240mm) | 31000 kN | Clamping force: 31000 kN (3100 ton) | `Clamping force` | `31000 KN` |  |
| UN3300EPIII/69200 (screw 230mm) | 33000 kN | Clamping force: 33000 kN (3300 ton) | `Clamping force` | `33000 KN, Space between tie bars(H×V): 2270×1900 mm, Min.mol` |  |
| UN3300EPIII/69200 (screw 220mm) | 33000 kN | Clamping force: 33000 kN (3300 ton) | `Clamping force` | `33000 KN, Space between tie bars(H×V): 2270×1900 mm, Min.mol` |  |
| UN3300EPIII/69200 (screw 240mm) | 33000 kN | Clamping force: 33000 kN (3300 ton) | `Clamping force` | `33000 KN, Space between tie bars(H×V): 2270×1900 mm, Min.mol` |  |
| UN3300EPIII/69200 (screw 200mm) | 33000 kN | Clamping force: 33000 kN (3300 ton) | `Clamping force` | `33000 KN, Space between tie bars(H×V): 2270×1900 mm, Min.mol` |  |
| UN4200EPIII/107500 (screw 260mm) | 42000 kN | Clamping force: 42000 kN (4200 ton) | `Clamping force` | `42000 KN, Space between tie bars(H×V): 2450×2050 mm, Min.mol` |  |
| UN4200EPIII/107500 (screw 240mm) | 42000 kN | Clamping force: 42000 kN (4200 ton) | `Clamping force` | `42000 KN, Space between tie bars(H×V): 2450×2050 mm, Min.mol` |  |
| UN4200EPIII/107500 (screw 230mm) | 42000 kN | Clamping force: 42000 kN (4200 ton) | `Clamping force` | `42000 KN, Space between tie bars(H×V): 2450×2050 mm, Min.mol` |  |
| UN4200EPIII/107500 (screw 250mm) | 42000 kN | Clamping force: 42000 kN (4200 ton) | `Clamping force` | `42000 KN, Space between tie bars(H×V): 2450×2050 mm, Min.mol` |  |
| UN6000EPIII/107500 (screw 230mm) | 60000 kN | Clamping force: 60000 kN (6000 ton) | `Clamping force` | `60000 KN, Space between tie bars(H×V): 2750×2450 mm, Min.mol` |  |
| UN6000EPIII/107500 (screw 260mm) | 60000 kN | Clamping force: 60000 kN (6000 ton) | `Clamping force` | `60000 KN, Space between tie bars(H×V): 2750×2450 mm, Min.mol` |  |
| UN6000EPIII/107500 (screw 240mm) | 60000 kN | Clamping force: 60000 kN (6000 ton) | `Clamping force` | `60000 KN, Space between tie bars(H×V): 2750×2450 mm, Min.mol` |  |
| UN6000EPIII/107500 (screw 250mm) | 60000 kN | Clamping force: 60000 kN (6000 ton) | `Clamping force` | `60000 KN, Space between tie bars(H×V): 2750×2450 mm, Min.mol` |  |

## Loader / Conveying System — 26/28 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| SBL-50 | **none** | — | — | — |  |
| SBL-100 | **none** | — | — | — |  |
| SAL-300C | 250 kg/h | Throughput: 250 kg/h | `Conveying Capacity (kg/hr)` | `250` |  |
| SAL-700G | 300 kg/h | Throughput: 300 kg/h | `Conveying Capacity (kg/hr)` | `300` |  |
| SCB-300B | 300 mm | Belt width: 300 mm | `Belt width (mm)` | `300` |  |
| SAL-360 | 300 kg/h | Throughput: 300 kg/h | `Conveying Capacity (kg/hr)` | `300` |  |
| SCB-300TB | 300 mm | Belt width: 300 mm | `Belt width (mm)` | `300` |  |
| SCB-300 | 300 mm | Belt width: 300 mm | `Belt width (mm)` | `300` |  |
| SAL-360E | 300 kg/h | Throughput: 300 kg/h | `Conveying Capacity (kg/hr)` | `300` |  |
| SAL-700GE | 300 kg/h | Throughput: 300 kg/h | `Conveying Capacity (kg/hr)` | `300` |  |
| SAL-800G1 | 350 kg/h | Throughput: 350 kg/h | `Conveying Capacity (kg/hr)` | `350` |  |
| SAL-800G1E | 350 kg/h | Throughput: 350 kg/h | `Conveying Capacity (kg/hr)` | `350` |  |
| SAL-800G | 350 kg/h | Throughput: 350 kg/h | `Conveying Capacity (kg/hr)` | `350` |  |
| SAL-400 | 350 kg/h | Throughput: 350 kg/h | `Conveying Capacity (kg/hr)` | `350` |  |
| SCB-400TB | 400 mm | Belt width: 400 mm | `Belt width (mm)` | `400` |  |
| SAL-800G2 | 400 kg/h | Throughput: 400 kg/h | `Conveying Capacity (kg/hr)` | `400` |  |
| SAL-800G2E | 400 kg/h | Throughput: 400 kg/h | `Conveying Capacity (kg/hr)` | `400` |  |
| SCB-400 | 400 mm | Belt width: 400 mm | `Belt width (mm)` | `400` |  |
| SCB-400B | 400 mm | Belt width: 400 mm | `Belt width (mm)` | `400` |  |
| SCB-500 | 500 mm | Belt width: 500 mm | `Belt width (mm)` | `500` |  |
| SCB-500B | 500 mm | Belt width: 500 mm | `Belt width (mm)` | `500` |  |
| SAL-3HP(-F)(E) | 550 kg/h | Throughput: 550 kg/h | `Conveying Capacity (kg/hr)` | `550` |  |
| SAL-4HP(-F)(E) | 600 kg/h | Throughput: 600 kg/h | `Conveying Capacity (kg/hr)` | `600` |  |
| SCB-600B | 600 mm | Belt width: 600 mm | `Belt width (mm)` | `600` |  |
| SCB-600 | 600 mm | Belt width: 600 mm | `Belt width (mm)` | `600` |  |
| SAL-5HP(-F)(E) | 700 kg/h | Throughput: 700 kg/h | `Conveying Capacity (kg/hr)` | `700` |  |
| SAL-7.5HP(-F)(E) | 800 kg/h | Throughput: 800 kg/h | `Conveying Capacity (kg/hr)` | `800` |  |
| SAL-10HP(-F)(E) | 1000 kg/h | Throughput: 1000 kg/h | `Conveying Capacity (kg/hr)` | `1000` |  |

## Mixing & Dosing Unit — 11/11 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| SCM-16S(M) | 10 L | Barrel volume: 10 L | `Materials barrel (L)` | `10` |  |
| SCM-12S(M) | 10 L | Barrel volume: 10 L | `Materials barrel (L)` | `10` |  |
| SCM-14S(M) | 10 L | Barrel volume: 10 L | `Materials barrel (L)` | `10` |  |
| SCM-14SD(M) | 20 L | Barrel volume: 20 L | `Materials barrel (L)` | `10x2` | x2 applied |
| SCM-16SD(M) | 20 L | Barrel volume: 20 L | `Materials barrel (L)` | `10x2` | x2 applied |
| SCM-12SD(M) | 20 L | Barrel volume: 20 L | `Materials barrel (L)` | `10x2` | x2 applied |
| SWH-100 | 100 kg/h | Throughput: 100 kg/h | `The max. capacity` | `100` |  |
| SWH-200 | 220 kg/h | Throughput: 220 kg/h | `The max. capacity` | `220` |  |
| SWH-500 | 500 kg/h | Throughput: 500 kg/h | `The max. capacity` | `500` |  |
| SWH-700 | 640 kg/h | Throughput: 640 kg/h | `The max. capacity` | `640` |  |
| SWH-800 | 1000 kg/h | Throughput: 1000 kg/h | `The max. capacity` | `1000` |  |

## Mould Temperature Controller — 26/26 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| STC-6W | 6 kW | Heater power: 6 kW | `Heat(Kw)` | `6` |  |
| STCH-6Z | 6 kW | Heater power: 6 kW | `Heat (kW)` | `6` |  |
| STC-6 | 6 kW | Heater power: 6 kW | `Heat(Kw)` | `6` |  |
| STCH-6WZ | 6 kW | Heater power: 6 kW | `Heat (kW)` | `6` |  |
| STC-6-2D | 6 kW | Heater power: 6 kW | `Heat(Kw)` | `6X2` |  |
| STCH-6W | 6 kW | Heater power: 6 kW | `Heat (kW)` | `6` |  |
| STC-6W-2D | 6 kW | Heater power: 6 kW | `Heat(Kw)` | `6X2` |  |
| STCH-9Z | 9 kW | Heater power: 9 kW | `Heat (kW)` | `9` |  |
| STC-18 | 9 kW | Heater power: 9 kW | `Heat(Kw)` | `9X2` |  |
| STC-18W | 9 kW | Heater power: 9 kW | `Heat(Kw)` | `9X2` |  |
| STCH-9WZ | 9 kW | Heater power: 9 kW | `Heat (kW)` | `9` |  |
| STC-9W-2D | 9 kW | Heater power: 9 kW | `Heat(Kw)` | `9X2` |  |
| STC-9 | 9 kW | Heater power: 9 kW | `Heat(Kw)` | `9` |  |
| STCH-9W | 9 kW | Heater power: 9 kW | `Heat (kW)` | `9` |  |
| STC-9W | 9 kW | Heater power: 9 kW | `Heat(Kw)` | `9` |  |
| STC-9-2D | 9 kW | Heater power: 9 kW | `Heat(Kw)` | `9X2` |  |
| STCH-12WZ | 12 kW | Heater power: 12 kW | `Heat (kW)` | `12` |  |
| STC-12W | 12 kW | Heater power: 12 kW | `Heat(Kw)` | `12` |  |
| STCH-12Z | 12 kW | Heater power: 12 kW | `Heat (kW)` | `12` |  |
| STCH-12W | 12 kW | Heater power: 12 kW | `Heat (kW)` | `12` |  |
| STC-12W-2D | 12 kW | Heater power: 12 kW | `Heat(Kw)` | `12X2` |  |
| STC-12 | 12 kW | Heater power: 12 kW | `Heat(Kw)` | `12` |  |
| STC-24 | 12 kW | Heater power: 12 kW | `Heat(Kw)` | `12X2` |  |
| STC-12-2D | 12 kW | Heater power: 12 kW | `Heat(Kw)` | `12X2` |  |
| STC-24W | 12 kW | Heater power: 12 kW | `Heat(Kw)` | `12X2` |  |
| STCH-18Z | 18 kW | Heater power: 18 kW | `Heat (kW)` | `18` |  |

## PET / Blow Molding Machine (SBM/ISBM/IBM) — 65/80 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| SG-400JF | **none** | — | — | — |  |
| SG-500JF | **none** | — | — | — |  |
| SG-1000F | **none** | — | — | — |  |
| SG-500F | **none** | — | — | — |  |
| SG-230F | **none** | — | — | — |  |
| SG-600JF | **none** | — | — | — |  |
| SG-800JF | **none** | — | — | — |  |
| SG-600F | **none** | — | — | — |  |
| SG-400F | **none** | — | — | — |  |
| SG-1200F | **none** | — | — | — |  |
| SG-300F | **none** | — | — | — |  |
| SG-800F | **none** | — | — | — |  |
| MSZ 70 (application case: 150 ml HDPE bottle) | **none** | — | — | — |  |
| MSZ 70AE (application case: 150 ml HDPE bottle) | **none** | — | — | — |  |
| D7-Pro (application case: 1 L pesticide bottle) | **none** | — | — | — |  |
| OGS-1-20 | 90 pcs/h | Output: 90 pcs/h | `Theoretical output` | `90-200 Pcs/h` | range 90-200, took low end |
| OGS-1-10 | 150 pcs/h | Output: 150 pcs/h | `Theoretical output` | `150-400 Pcs/h` | range 150-400, took low end |
| OGS-1 | 200 pcs/h | Output: 200 pcs/h | `Theoretical output` | `200-900 Pcs/h` | range 200-900, took low end |
| OGS-2-5 | 300 pcs/h | Output: 300 pcs/h | `Theoretical output` | `300-500 Pcs/h` | range 300-500, took low end |
| MSZ 30HE (screw diameter 40mm) | 323.2 kN | Clamping force: 323.2 kN (32.32 ton) | `Clamping force of preform` | `323.2 KN` |  |
| MSZ 30HE (screw diameter 45mm) | 323.2 kN | Clamping force: 323.2 kN (32.32 ton) | `Clamping force of preform` | `323.2 KN` |  |
| MSZ 30 (screw diameter 45mm) | 323.2 kN | Clamping force: 323.2 kN (32.32 ton) | `Clamping force of preform` | `323.2 KN` |  |
| MSZ 30 (screw diameter 40mm) | 323.2 kN | Clamping force: 323.2 kN (32.32 ton) | `Clamping force of preform` | `323.2 KN` |  |
| Q3 (screw diameter 28mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force of preform` | `350 KN` |  |
| MSZ 30AE (screw diameter 40mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force of preform` | `350 KN` |  |
| MSZ 30AE (screw diameter 45mm) | 350 kN | Clamping force: 350 kN (35 ton) | `Clamping force of preform` | `350 KN` |  |
| MSZ50H (screw diameter 50mm) | 504 kN | Clamping force: 504 kN (50.4 ton) | `Clamping force of preform` | `504 KN` |  |
| MSZ50H (screw diameter 45mm) | 504 kN | Clamping force: 504 kN (50.4 ton) | `Clamping force of preform` | `504 KN` |  |
| MSZ50S-HE (screw diameter 50mm) | 528 kN | Clamping force: 528 kN (52.8 ton) | `Clamping force of preform` | `528 KN` |  |
| MSZ50S-HE (screw diameter 45mm) | 528 kN | Clamping force: 528 kN (52.8 ton) | `Clamping force of preform` | `528 KN` |  |
| MSZ 50AE (screw diameter 50mm) | 528 kN | Clamping force: 528 kN (52.8 ton) | `Clamping force of preform` | `528 KN` |  |
| MSZ 50S (screw diameter 50mm) | 528 kN | Clamping force: 528 kN (52.8 ton) | `Clamping force of preform` | `528 KN` |  |
| MSZ 50S (screw diameter 45mm) | 528 kN | Clamping force: 528 kN (52.8 ton) | `Clamping force of preform` | `528 KN` |  |
| MSZ 50AE (screw diameter 45mm) | 528 kN | Clamping force: 528 kN (52.8 ton) | `Clamping force of preform` | `528 KN` |  |
| SJ-1W | 600 pcs/h | Output: 600 pcs/h | `Theoretical output` | `600 Pcs/h` |  |
| SJ-1-20 | 600 pcs/h | Output: 600 pcs/h | `Theoretical output` | `600 Pcs/h` |  |
| MSZ 70S (screw diameter 55mm) | 712 kN | Clamping force: 712 kN (71.2 ton) | `Clamping force of preform` | `712 KN` |  |
| MSZ 70S (screw diameter 50mm) | 712 kN | Clamping force: 712 kN (71.2 ton) | `Clamping force of preform` | `712 KN` |  |
| MSZ 70S-HE (screw diameter 50mm) | 712 kN | Clamping force: 712 kN (71.2 ton) | `Clamping force of preform` | `712 KN` |  |
| MSZ 70AE (screw diameter 50mm) | 712 kN | Clamping force: 712 kN (71.2 ton) | `Clamping force of preform` | `712 KN` |  |
| MSZ 70S-HE (screw diameter 55mm) | 712 kN | Clamping force: 712 kN (71.2 ton) | `Clamping force of preform` | `712 KN` |  |
| MSZ 70AE (screw diameter 55mm) | 712 kN | Clamping force: 712 kN (71.2 ton) | `Clamping force of preform` | `712 KN` |  |
| MSZ 70 (screw diameter 55mm) | 742 kN | Clamping force: 742 kN (74.2 ton) | `Clamping force of preform` | `742 KN` |  |
| MSZ 70 (screw diameter 50mm) | 742 kN | Clamping force: 742 kN (74.2 ton) | `Clamping force of preform` | `742 KN` |  |
| OGS-2 | 900 pcs/h | Output: 900 pcs/h | `Theoretical output` | `900 Pcs/h` |  |
| D7 (screw diameter 55mm) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force of preform` | `1000 KN` |  |
| D7 (screw diameter 50mm) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force of preform` | `1000 KN` |  |
| D7-Pro (screw diameter 55mm) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force of preform` | `1000 KN` |  |
| D7-Pro (screw diameter 50mm) | 1000 kN | Clamping force: 1000 kN (100 ton) | `Clamping force of preform` | `1000 KN` |  |
| MSZ95S-HE (screw diameter 65mm) | 1008 kN | Clamping force: 1008 kN (100.8 ton) | `Clamping force of preform` | `1008 KN` |  |
| MSZ95S-HE (screw diameter 60mm) | 1008 kN | Clamping force: 1008 kN (100.8 ton) | `Clamping force of preform` | `1008 KN` |  |
| MSZ 95S (screw diameter 60mm) | 1008 kN | Clamping force: 1008 kN (100.8 ton) | `Clamping force of preform` | `1008 KN` |  |
| MSZ 95S (screw diameter 65mm) | 1008 kN | Clamping force: 1008 kN (100.8 ton) | `Clamping force of preform` | `1008 KN` |  |
| OGB-2-10 | 1200 pcs/h | Output: 1200 pcs/h | `Theoretical output` | `1200 Pcs/h` |  |
| SJ-2W | 1200 pcs/h | Output: 1200 pcs/h | `Theoretical output` | `1200 Pcs/h` |  |
| MSZ 135 (screw diameter 75mm) | 1344 kN | Clamping force: 1344 kN (134.4 ton) | `Clamping force of preform` | `1344 KN` |  |
| MSZ 135HE (screw diameter 75mm) | 1344 kN | Clamping force: 1344 kN (134.4 ton) | `Clamping force of preform` | `1344 KN` |  |
| MSZ 135 (screw diameter 70mm) | 1344 kN | Clamping force: 1344 kN (134.4 ton) | `Clamping force of preform` | `1344 KN` |  |
| MSZ 135HE (screw diameter 70mm) | 1344 kN | Clamping force: 1344 kN (134.4 ton) | `Clamping force of preform` | `1344 KN` |  |
| D9-Pro (screw diameter 60mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force of preform` | `1500 KN` |  |
| D9-Pro (screw diameter 65mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force of preform` | `1500 KN` |  |
| D9 (screw diameter 65mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force of preform` | `1500 KN` |  |
| D9 (screw diameter 60mm) | 1500 kN | Clamping force: 1500 kN (150 ton) | `Clamping force of preform` | `1500 KN` |  |
| OGB-3-7 | 1800 pcs/h | Output: 1800 pcs/h | `Theoretical output` | `1800 Pcs/h` |  |
| OGS-4 | 1800 pcs/h | Output: 1800 pcs/h | `Theoretical output` | `1800 Pcs/h` |  |
| D13-Pro (screw diameter 75mm) | 2000 kN | Clamping force: 2000 kN (200 ton) | `Clamping force of preform` | `2000 KN` |  |
| D13-Pro (screw diameter 70mm) | 2000 kN | Clamping force: 2000 kN (200 ton) | `Clamping force of preform` | `2000 KN` |  |
| SJ-2 | 2500 pcs/h | Output: 2500 pcs/h | `Theoretical output` | `2500 Pcs/h` |  |
| SJ-2S | 3000 pcs/h | Output: 3000 pcs/h | `Theoretical output` | `3000 Pcs/h` |  |
| OGB-3S | 3500 pcs/h | Output: 3500 pcs/h | `Theoretical output` | `3500 Pcs/h` |  |
| SJ-3S | 3500 pcs/h | Output: 3500 pcs/h | `Theoretical output` | `3500 Pcs/h` |  |
| SJ-3SS | 4000 pcs/h | Output: 4000 pcs/h | `Theoretical output` | `4000 Pcs/h` |  |
| OGB-4S | 4500 pcs/h | Output: 4500 pcs/h | `Theoretical output` | `4500 Pcs/h` |  |
| SJ-4MS | 5000 pcs/h | Output: 5000 pcs/h | `Theoretical output` | `5000 Pcs/h` |  |
| OGB-4SS | 6000 pcs/h | Output: 6000 pcs/h | `Theoretical output` | `6000 Pcs/h` |  |
| OGB-6S | 6000 pcs/h | Output: 6000 pcs/h | `Theoretical output` | `6000 Pcs/h` |  |
| SJ-4SS | 6000 pcs/h | Output: 6000 pcs/h | `Theoretical output` | `6000 Pcs/h` |  |
| OGB-5SS | 7500 pcs/h | Output: 7500 pcs/h | `Theoretical output` | `7500 Pcs/h` |  |
| OGB-6SM | 9000 pcs/h | Output: 9000 pcs/h | `Theoretical output` | `9000 Pcs/h` |  |
| OGB-6SS | 9000 pcs/h | Output: 9000 pcs/h | `Theoretical output` | `9000 Pcs/h` |  |

## PET Preform Injection Molding Machine — 7/7 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| UN180-EPIII [PET configuration] | 1800 kN | Clamping force: 1800 kN (180 ton) | `Clamping force` | `1800 KN, Space between tie-bars(H×V): 520X470 mm, MIN.mold d` |  |
| UN230-EPIII [PET configuration] | 2300 kN | Clamping force: 2300 kN (230 ton) | `Clamping force` | `2300 KN, Space between tie-bars(H×V): 570X520 mm, MIN.mold d` |  |
| UN270-EPIII [PET configuration] | 2700 kN | Clamping force: 2700 kN (270 ton) | `Clamping force` | `2700 KN, Space between tie-bars(H×V): 620X570 mm, MIN.mold d` |  |
| UN300-EPIII [PET configuration] | 3000 kN | Clamping force: 3000 kN (300 ton) | `Clamping force` | `3000 KN, Space between tie-bars(H×V): 670X620 mm, MIN.mold d` |  |
| UN350-EPIII [PET configuration] | 3500 kN | Clamping force: 3500 kN (350 ton) | `Clamping force` | `3500 KN, Space between tie-bars(H×V): 730X670 mm, MIN.mold d` |  |
| UN420-EPIII [PET configuration] | 4200 kN | Clamping force: 4200 kN (420 ton) | `Clamping force` | `4200 KN, Space between tie-bars(H×V): 770X720 mm, MIN.mold d` |  |
| UN530-EPIII [PET configuration] | 5300 kN | Clamping force: 5300 kN (530 ton) | `Clamping force` | `5300 KN, Space between tie-bars(H×V): 870X820 mm, MIN.mold d` |  |

## Plastic Material Dryer / Loader — 57/73 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| SMD-2000 | **none** | — | — | — |  |
| SLD-120 | **none** | — | — | — |  |
| SLD-400 | **none** | — | — | — |  |
| SLD-300 | **none** | — | — | — |  |
| SLD-100 | **none** | — | — | — |  |
| SLD-1500 | **none** | — | — | — |  |
| SLD-700 | **none** | — | — | — |  |
| SLD-2000 | **none** | — | — | — |  |
| SMD-500 | **none** | — | — | — |  |
| SLD-80 | **none** | — | — | — |  |
| SLD-200 | **none** | — | — | — |  |
| SLD-150 | **none** | — | — | — |  |
| SMD-1500 | **none** | — | — | — |  |
| SLD-500 | **none** | — | — | — |  |
| SLD-1000 | **none** | — | — | — |  |
| SMD-1000 | **none** | — | — | — |  |
| SHD-3L | 2 L | Capacity: 2 L | `Capacity` | `2 kg` |  |
| SHD-5L | 3 L | Capacity: 3 L | `Capacity` | `3 kg` |  |
| SHD-15 | 15 L | Capacity: 15 L | `Capacity` | `15 kg` |  |
| SHD-40L | 25 L | Capacity: 25 L | `Capacity` | `25 kg` |  |
| SHD-25 | 25 L | Capacity: 25 L | `Capacity` | `25 kg` |  |
| SLC-40L(D) | 40 L | Capacity: 40 L | `Capacity (L)` | `40` |  |
| SLHJ-40L-40 | 40 L | Capacity: 40 L | `Capacity(L)` | `40, Dry blower(m³/hr): 40` |  |
| SD-5 | 45 kg | Capacity: 45 kg | `Capacity(kg)` | `45` |  |
| SHD-50 | 50 L | Capacity: 50 L | `Capacity` | `50 kg` |  |
| SHD-80L | 50 L | Capacity: 50 L | `Capacity` | `50 kg` |  |
| SHD-120L | 75 L | Capacity: 75 L | `Capacity` | `75 kg` |  |
| SHD-75 | 75 L | Capacity: 75 L | `Capacity` | `75 kg` |  |
| SD-9 | 80 kg | Capacity: 80 kg | `Capacity(kg)` | `80` |  |
| SLHJ-80L-40 | 80 L | Capacity: 80 L | `Capacity(L)` | `80, Dry blower(m³/hr): 40` |  |
| SLC-80L(D) | 80 L | Capacity: 80 L | `Capacity (L)` | `80` |  |
| SLHJ-80L-80 | 80 L | Capacity: 80 L | `Capacity(L)` | `80, Dry blower(m³/hr): 80` |  |
| SHD-160L | 100 L | Capacity: 100 L | `Capacity` | `100 kg` |  |
| SHD-100 | 100 L | Capacity: 100 L | `Capacity` | `100 kg` |  |
| SLHJ-120L-100 | 120 L | Capacity: 120 L | `Capacity(L)` | `120, Dry blower(m³/hr): 100` |  |
| SLC-120L(D) | 120 L | Capacity: 120 L | `Capacity (L)` | `120` |  |
| SHD-150 | 150 L | Capacity: 150 L | `Capacity` | `150 kg` |  |
| SHD-230L | 150 L | Capacity: 150 L | `Capacity` | `150 kg` |  |
| SLC-160L(D) | 160 L | Capacity: 160 L | `Capacity (L)` | `160` |  |
| SLHJ-160L-100 | 160 L | Capacity: 160 L | `Capacity(L)` | `160, Dry blower(m³/hr): 100` |  |
| SHD-300L | 200 L | Capacity: 200 L | `Capacity` | `200 kg` |  |
| SHD-200 | 200 L | Capacity: 200 L | `Capacity` | `200 kg` |  |
| SLHJ-230L-120 | 230 L | Capacity: 230 L | `Capacity(L)` | `230, Dry blower(m³/hr): 120` |  |
| SHD-380L | 250 L | Capacity: 250 L | `Capacity` | `250 kg` |  |
| SHD-250 | 250 L | Capacity: 250 L | `Capacity` | `250 kg` |  |
| SHD-460L | 300 L | Capacity: 300 L | `Capacity` | `300 kg` |  |
| SHD-300 | 300 L | Capacity: 300 L | `Capacity` | `300 kg` |  |
| SLHJ-300L-150 | 300 L | Capacity: 300 L | `Capacity(L)` | `300, Dry blower(m³/hr): 150` |  |
| SLHJ-380L-200 | 380 L | Capacity: 380 L | `Capacity(L)` | `380, Dry blower(m³/hr): 200` |  |
| SHD-400 | 400 L | Capacity: 400 L | `Capacity` | `400 kg` |  |
| SHD-600L | 400 L | Capacity: 400 L | `Capacity` | `400 kg` |  |
| SLH-460L-300 | 460 L | Capacity: 460 L | `Capacity(L)` | `460, Dry blower(m³/hr): 300` |  |
| SHD-500 | 500 L | Capacity: 500 L | `Capacity` | `500 kg` |  |
| SHD-600 | 600 L | Capacity: 600 L | `Capacity` | `600 kg` |  |
| SHD-800L | 600 L | Capacity: 600 L | `Capacity` | `600 kg` |  |
| SLH-600L-400 | 600 L | Capacity: 600 L | `Capacity(L)` | `600, Dry blower(m³/hr): 400` |  |
| SHD-1000L | 700 L | Capacity: 700 L | `Capacity` | `700 kg` |  |
| SHD-1200L | 800 L | Capacity: 800 L | `Capacity` | `800 kg` |  |
| SLH-800L-500 | 800 L | Capacity: 800 L | `Capacity(L)` | `800, Dry blower(m³/hr): 500` |  |
| SHD-800 | 800 L | Capacity: 800 L | `Capacity` | `800 kg` |  |
| SHD-1000 | 1000 L | Capacity: 1000 L | `Capacity` | `1000 kg` |  |
| SHD-1500L | 1000 L | Capacity: 1000 L | `Capacity` | `1000 kg` |  |
| SLH-1000L-700 | 1000 L | Capacity: 1000 L | `Capacity(L)` | `1000, Dry blower(m³/hr): 700` |  |
| SHD-1700L | 1200 L | Capacity: 1200 L | `Capacity` | `1200 kg` |  |
| SLH-1200L-700 | 1200 L | Capacity: 1200 L | `Capacity(L)` | `1200, Dry blower(m³/hr): 700` |  |
| SHD-2000L | 1500 L | Capacity: 1500 L | `Capacity` | `1500 kg` |  |
| SLH-1500L-1000 | 1500 L | Capacity: 1500 L | `Capacity(L)` | `1500, Dry blower(m³/hr): 1000` |  |
| SLH-1700L-1000 | 1800 L | Capacity: 1800 L | `Capacity(L)` | `1800, Dry blower(m³/hr): 1000` |  |
| SHD-3000L | 2000 L | Capacity: 2000 L | `Capacity` | `2000 kg` |  |
| SLH-2000L-1500 | 2000 L | Capacity: 2000 L | `Capacity(L)` | `2000, Dry blower(m³/hr): 1500` |  |
| SHD-4000L | 3000 L | Capacity: 3000 L | `Capacity` | `3000 kg` |  |
| SHD-5000L | 3000 L | Capacity: 3000 L | `Capacity` | `3000 kg` |  |
| SHD-3300L | 3000 L | Capacity: 3000 L | `Capacity` | `3000 kg` |  |

## Screw Air Compressor — 55/62 sized

| model | value | display | matched line | raw | note |
|---|---|---|---|---|---|
| QWL-45WX | **none** | — | — | — |  |
| QWL-20WX | **none** | — | — | — |  |
| QWL-30WX | **none** | — | — | — |  |
| QWL-15WX | **none** | — | — | — |  |
| QWL-5WX | **none** | — | — | — |  |
| QWL-7.5WX | **none** | — | — | — |  |
| QWL-10WX | **none** | — | — | — |  |
| QWL-6ZCY | 4 kW | Motor power: 4 kW (5 HP) | `KW` | `4` |  |
| QWL-7SA | 5.5 kW | Motor power: 5.5 kW (7 HP) | `KW` | `5.5` |  |
| QWL-10SA | 7.5 kW | Motor power: 7.5 kW (10 HP) | `KW` | `7.5` |  |
| QWL-10ZCY | 7.5 kW | Motor power: 7.5 kW (10 HP) | `KW` | `7.5` |  |
| QWL-15SA | 11 kW | Motor power: 11 kW (15 HP) | `KW` | `11` |  |
| QWS-20ZY | 15 kW | Motor power: 15 kW (20 HP) | `KW` | `15` |  |
| QWL-20ZCY | 15 kW | Motor power: 15 kW (20 HP) | `KW` | `15` |  |
| QWL-20SA | 15 kW | Motor power: 15 kW (20 HP) | `KW` | `15` |  |
| QWL-20ZBY | 15 kW | Motor power: 15 kW (20 HP) | `KW` | `15` |  |
| QWL-30ZBY | 22 kW | Motor power: 22 kW (30 HP) | `KW` | `22` |  |
| QWL-30ZCY | 22 kW | Motor power: 22 kW (30 HP) | `KW` | `22` |  |
| QWS-30ZY | 22 kW | Motor power: 22 kW (30 HP) | `KW` | `22` |  |
| QWL-30SA | 22 kW | Motor power: 22 kW (30 HP) | `KW` | `22` |  |
| QWL-40SA (A) | 30 kW | Motor power: 30 kW (40 HP) | `KW` | `30` |  |
| QWL-40SA (W) | 30 kW | Motor power: 30 kW (40 HP) | `KW` | `30` |  |
| QWL-40ZCY | 30 kW | Motor power: 30 kW (40 HP) | `KW` | `30` |  |
| QWL-40ZBY | 30 kW | Motor power: 30 kW (40 HP) | `KW` | `30` |  |
| QWS-40ZY | 30 kW | Motor power: 30 kW (40 HP) | `KW` | `30` |  |
| QWL-50ZBY | 37 kW | Motor power: 37 kW (50 HP) | `KW` | `37` |  |
| QWL-50ZCY | 37 kW | Motor power: 37 kW (50 HP) | `KW` | `37` |  |
| QWL-50SA (A) | 37 kW | Motor power: 37 kW (50 HP) | `KW` | `37` |  |
| QWS-50ZY | 37 kW | Motor power: 37 kW (50 HP) | `KW` | `37` |  |
| QWL-50SA (W) | 37 kW | Motor power: 37 kW (50 HP) | `KW` | `37` |  |
| QWS-60ZY | 45 kW | Motor power: 45 kW (60 HP) | `KW` | `45` |  |
| QWL-60ZBY | 45 kW | Motor power: 45 kW (60 HP) | `KW` | `45` |  |
| QWL-60SA (A) | 45 kW | Motor power: 45 kW (60 HP) | `KW` | `45` |  |
| QWL-60SA (W) | 45 kW | Motor power: 45 kW (60 HP) | `KW` | `45` |  |
| QWL-75SA (A) | 55 kW | Motor power: 55 kW (74 HP) | `KW` | `55` |  |
| QWS-75ZY | 55 kW | Motor power: 55 kW (74 HP) | `KW` | `55` |  |
| QWL-75SA (W) | 55 kW | Motor power: 55 kW (74 HP) | `KW` | `55` |  |
| QWL-75ZBY | 55 kW | Motor power: 55 kW (74 HP) | `KW` | `55` |  |
| QWS-100ZY | 75 kW | Motor power: 75 kW (101 HP) | `KW` | `75` |  |
| QWL-100ZBY | 75 kW | Motor power: 75 kW (101 HP) | `KW` | `75` |  |
| QWL-125ZBY | 90 kW | Motor power: 90 kW (121 HP) | `KW` | `90` |  |
| QWS-125ZY | 90 kW | Motor power: 90 kW (121 HP) | `KW` | `90` |  |
| QWS-150ZY | 110 kW | Motor power: 110 kW (148 HP) | `KW` | `110` |  |
| QWL-150ZBY | 110 kW | Motor power: 110 kW (148 HP) | `KW` | `110` |  |
| QWS-175ZY | 132 kW | Motor power: 132 kW (177 HP) | `KW` | `132` |  |
| QWL-175ZBY | 132 kW | Motor power: 132 kW (177 HP) | `KW` | `132` |  |
| QWL-200ZBY | 160 kW | Motor power: 160 kW (215 HP) | `KW` | `160` |  |
| QWS-200ZY | 160 kW | Motor power: 160 kW (215 HP) | `KW` | `160` |  |
| QWL-250ZBY | 185 kW | Motor power: 185 kW (248 HP) | `KW` | `185` |  |
| QWS-250ZY | 185 kW | Motor power: 185 kW (248 HP) | `KW` | `185` |  |
| QWS-275ZY | 200 kW | Motor power: 200 kW (268 HP) | `KW` | `200` |  |
| QWL-275ZBY | 200 kW | Motor power: 200 kW (268 HP) | `KW` | `200` |  |
| QWL-300ZBY | 220 kW | Motor power: 220 kW (295 HP) | `KW` | `220` |  |
| QWS-300ZY | 220 kW | Motor power: 220 kW (295 HP) | `KW` | `220` |  |
| QWS-350ZY | 250 kW | Motor power: 250 kW (335 HP) | `KW` | `250` |  |
| QWL-350ZBY | 250 kW | Motor power: 250 kW (335 HP) | `KW` | `250` |  |
| QWL-375ZBY | 280 kW | Motor power: 280 kW (375 HP) | `KW` | `280` |  |
| QWS-375ZY | 280 kW | Motor power: 280 kW (375 HP) | `KW` | `280` |  |
| QWL-425ZBY | 315 kW | Motor power: 315 kW (422 HP) | `KW` | `315` |  |
| QWS-425ZY | 315 kW | Motor power: 315 kW (422 HP) | `KW` | `315` |  |
| QWS-475ZY | 355 kW | Motor power: 355 kW (476 HP) | `KW` | `355` |  |
| QWS-525ZY | 400 kW | Motor power: 400 kW (536 HP) | `KW` | `400` |  |
