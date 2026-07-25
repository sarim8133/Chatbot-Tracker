# machine_type review

Correct anything wrong here BEFORE a non-dry run. You know the catalogue.

- **118** models across **1** catalogues
- machine_type source: **75 printed**, **39 derived**, **4 unknown** (left blank on purpose)
- **104** model names already exist in the live namespace

## Collisions -- resolve before ingesting

| new model | catalogue | already exists as |
|---|---|---|
| SCR30APM-7 | SCR Compressor | `100APM_SCR30APM-7` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR30APM-7` (SCR Compressor) |
| SCR30APM-8 | SCR Compressor | `100APM_SCR30APM-8` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR30APM-8` (SCR Compressor) |
| SCR30APM-10 | SCR Compressor | `100APM_SCR30APM-10` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR30APM-10` (SCR Compressor) |
| SCR30APM-12.5 | SCR Compressor | `100APM_SCR30APM-125` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR30APM-125` (SCR Compressor) |
| SCR30APM-15 | SCR Compressor | `100APM_SCR30APM-15` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR30APM-15` (SCR Compressor) |
| SCR30APM-16 | SCR Compressor | `100APM_SCR30APM-16` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR30APM-16` (SCR Compressor) |
| SCR40APM-7 | SCR Compressor | `100APM_SCR40APM-7` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR40APM-7` (SCR Compressor) |
| SCR40APM-8 | SCR Compressor | `100APM_SCR40APM-8` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR40APM-8` (SCR Compressor) |
| SCR40APM-10 | SCR Compressor | `100APM_SCR40APM-10` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR40APM-10` (SCR Compressor) |
| SCR50APM-7 | SCR Compressor | `100APM_SCR50APM-7` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR50APM-7` (SCR Compressor) |
| SCR50APM-8 | SCR Compressor | `100APM_SCR50APM-8` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR50APM-8` (SCR Compressor) |
| SCR50APM-10 | SCR Compressor | `100APM_SCR50APM-10` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR50APM-10` (SCR Compressor) |
| SCR50APM-12.5 | SCR Compressor | `100APM_SCR50APM-125` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR50APM-125` (SCR Compressor) |
| SCR60APM-7 | SCR Compressor | `100APM_SCR60APM-7` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR60APM-7` (SCR Compressor) |
| SCR60APM-8 | SCR Compressor | `100APM_SCR60APM-8` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR60APM-8` (SCR Compressor) |
| SCR60APM-10 | SCR Compressor | `100APM_SCR60APM-10` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR60APM-10` (SCR Compressor) |
| SCR60APM-12.5 | SCR Compressor | `100APM_SCR60APM-125` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR60APM-125` (SCR Compressor) |
| SCR75APM-7 | SCR Compressor | `100APM_SCR75APM-7` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR75APM-7` (SCR Compressor) |
| SCR75APM-8 | SCR Compressor | `100APM_SCR75APM-8` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR75APM-8` (SCR Compressor) |
| SCR75APM-10 | SCR Compressor | `100APM_SCR75APM-10` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR75APM-10` (SCR Compressor) |
| SCR75APM-12.5 | SCR Compressor | `100APM_SCR75APM-125` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR75APM-125` (SCR Compressor) |
| SCR100APM-7 | SCR Compressor | `100APM_SCR100APM-7` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR100APM-7` (SCR Compressor) |
| SCR100APM-8 | SCR Compressor | `100APM_SCR100APM-8` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR100APM-8` (SCR Compressor) |
| SCR100APM-10 | SCR Compressor | `100APM_SCR100APM-10` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR100APM-10` (SCR Compressor) |
| SCR100APM-12.5 | SCR Compressor | `100APM_SCR100APM-125` (SCR APM Screw Air Compressor), `SCR_Compressor_Booklet_SCR100APM-125` (SCR Compressor) |
| SCR530LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR530LHPM` (SCR Compressor) |
| SCR830LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR830LHPM` (SCR Compressor) |
| SCR950LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR950LHPM` (SCR Compressor) |
| SCR1200LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR1200LHPM` (SCR Compressor) |
| SCR1300LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR1300LHPM` (SCR Compressor) |
| SCR1500LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR1500LHPM` (SCR Compressor) |
| SCR1900LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR1900LHPM` (SCR Compressor) |
| SCR2200LHPM | SCR Compressor | `SCR_Compressor_Booklet_SCR2200LHPM` (SCR Compressor) |
| SCR180H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR180H-7` (SCR Compressor) |
| SCR180H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR180H-8` (SCR Compressor) |
| SCR180H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR180H-10` (SCR Compressor) |
| SCR180H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR180H-125` (SCR Compressor) |
| SCR220H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR220H-7` (SCR Compressor) |
| SCR220H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR220H-8` (SCR Compressor) |
| SCR220H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR220H-10` (SCR Compressor) |
| SCR220H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR220H-125` (SCR Compressor) |
| SCR250H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR250H-7` (SCR Compressor) |
| SCR250H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR250H-8` (SCR Compressor) |
| SCR250H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR250H-10` (SCR Compressor) |
| SCR250H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR250H-125` (SCR Compressor) |
| SCR270H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR270H-7` (SCR Compressor) |
| SCR270H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR270H-8` (SCR Compressor) |
| SCR270H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR270H-10` (SCR Compressor) |
| SCR270H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR270H-125` (SCR Compressor) |
| SCR300H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR300H-7` (SCR Compressor) |
| SCR300H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR300H-8` (SCR Compressor) |
| SCR300H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR300H-10` (SCR Compressor) |
| SCR300H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR300H-125` (SCR Compressor) |
| SCR340H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR340H-7` (SCR Compressor) |
| SCR340H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR340H-8` (SCR Compressor) |
| SCR340H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR340H-10` (SCR Compressor) |
| SCR340H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR340H-125` (SCR Compressor) |
| SCR375H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR375H-7` (SCR Compressor) |
| SCR375H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR375H-8` (SCR Compressor) |
| SCR375H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR375H-10` (SCR Compressor) |
| SCR375H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR375H-125` (SCR Compressor) |
| SCR400H-7 | SCR Compressor | `SCR_Compressor_Booklet_SCR400H-7` (SCR Compressor) |
| SCR400H-8 | SCR Compressor | `SCR_Compressor_Booklet_SCR400H-8` (SCR Compressor) |
| SCR400H-10 | SCR Compressor | `SCR_Compressor_Booklet_SCR400H-10` (SCR Compressor) |
| SCR400H-12.5 | SCR Compressor | `SCR_Compressor_Booklet_SCR400H-125` (SCR Compressor) |
| SCR20EPM-7 | SCR Compressor | `EPM_EPM2_SCR20EPM-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR20EPM-7` (SCR Compressor) |
| SCR20EPM-8 | SCR Compressor | `EPM_EPM2_SCR20EPM-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR20EPM-8` (SCR Compressor) |
| SCR20EPM-10 | SCR Compressor | `EPM_EPM2_SCR20EPM-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR20EPM-10` (SCR Compressor) |
| SCR25EPM-7 | SCR Compressor | `EPM_EPM2_SCR25EPM-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR25EPM-7` (SCR Compressor) |
| SCR25EPM-8 | SCR Compressor | `EPM_EPM2_SCR25EPM-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR25EPM-8` (SCR Compressor) |
| SCR25EPM-10 | SCR Compressor | `EPM_EPM2_SCR25EPM-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR25EPM-10` (SCR Compressor) |
| SCR30EPM-7 | SCR Compressor | `EPM_EPM2_SCR30EPM-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR30EPM-7` (SCR Compressor) |
| SCR30EPM-8 | SCR Compressor | `EPM_EPM2_SCR30EPM-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR30EPM-8` (SCR Compressor) |
| SCR30EPM-10 | SCR Compressor | `EPM_EPM2_SCR30EPM-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR30EPM-10` (SCR Compressor) |
| SCR40EPM-7 | SCR Compressor | `EPM_EPM2_SCR40EPM-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR40EPM-7` (SCR Compressor) |
| SCR40EPM-8 | SCR Compressor | `EPM_EPM2_SCR40EPM-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR40EPM-8` (SCR Compressor) |
| SCR40EPM-10 | SCR Compressor | `EPM_EPM2_SCR40EPM-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR40EPM-10` (SCR Compressor) |
| SCR50EPM-7 | SCR Compressor | `EPM_EPM2_SCR50EPM-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR50EPM-7` (SCR Compressor) |
| SCR50EPM-8 | SCR Compressor | `EPM_EPM2_SCR50EPM-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR50EPM-8` (SCR Compressor) |
| SCR50EPM-10 | SCR Compressor | `EPM_EPM2_SCR50EPM-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR50EPM-10` (SCR Compressor) |
| SCR60EPM-7 | SCR Compressor | `EPM_EPM2_SCR60EPM-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR60EPM-7` (SCR Compressor) |
| SCR60EPM-8 | SCR Compressor | `EPM_EPM2_SCR60EPM-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR60EPM-8` (SCR Compressor) |
| SCR60EPM-10 | SCR Compressor | `EPM_EPM2_SCR60EPM-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR60EPM-10` (SCR Compressor) |
| SCR75EPM2-7 | SCR Compressor | `EPM_EPM2_SCR75EPM2-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR75EPM2-7` (SCR Compressor) |
| SCR75EPM2-8 | SCR Compressor | `EPM_EPM2_SCR75EPM2-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR75EPM2-8` (SCR Compressor) |
| SCR75EPM2-10 | SCR Compressor | `EPM_EPM2_SCR75EPM2-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR75EPM2-10` (SCR Compressor) |
| SCR90EPM2-7 | SCR Compressor | `EPM_EPM2_SCR90EPM2-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR90EPM2-7` (SCR Compressor) |
| SCR90EPM2-8 | SCR Compressor | `EPM_EPM2_SCR90EPM2-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR90EPM2-8` (SCR Compressor) |
| SCR90EPM2-10 | SCR Compressor | `EPM_EPM2_SCR90EPM2-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR90EPM2-10` (SCR Compressor) |
| SCR100EPM2-7 | SCR Compressor | `EPM_EPM2_SCR100EPM2-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR100EPM2-7` (SCR Compressor) |
| SCR100EPM2-8 | SCR Compressor | `EPM_EPM2_SCR100EPM2-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR100EPM2-8` (SCR Compressor) |
| SCR100EPM2-10 | SCR Compressor | `EPM_EPM2_SCR100EPM2-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR100EPM2-10` (SCR Compressor) |
| SCR125EPM2-7 | SCR Compressor | `EPM_EPM2_SCR125EPM2-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR125EPM2-7` (SCR Compressor) |
| SCR125EPM2-8 | SCR Compressor | `EPM_EPM2_SCR125EPM2-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR125EPM2-8` (SCR Compressor) |
| SCR125EPM2-10 | SCR Compressor | `EPM_EPM2_SCR125EPM2-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR125EPM2-10` (SCR Compressor) |
| SCR150EPM2-7 | SCR Compressor | `EPM_EPM2_SCR150EPM2-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR150EPM2-7` (SCR Compressor) |
| SCR150EPM2-8 | SCR Compressor | `EPM_EPM2_SCR150EPM2-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR150EPM2-8` (SCR Compressor) |
| SCR150EPM2-10 | SCR Compressor | `EPM_EPM2_SCR150EPM2-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR150EPM2-10` (SCR Compressor) |
| SCR180EPM2-7 | SCR Compressor | `EPM_EPM2_SCR180EPM2-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR180EPM2-7` (SCR Compressor) |
| SCR180EPM2-8 | SCR Compressor | `EPM_EPM2_SCR180EPM2-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR180EPM2-8` (SCR Compressor) |
| SCR180EPM2-10 | SCR Compressor | `EPM_EPM2_SCR180EPM2-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR180EPM2-10` (SCR Compressor) |
| SCR220EPM2-7 | SCR Compressor | `EPM_EPM2_SCR220EPM2-7` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR220EPM2-7` (SCR Compressor) |
| SCR220EPM2-8 | SCR Compressor | `EPM_EPM2_SCR220EPM2-8` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR220EPM2-8` (SCR Compressor) |
| SCR220EPM2-10 | SCR Compressor | `EPM_EPM2_SCR220EPM2-10` (SCR EPM / EPM2), `SCR_Compressor_Booklet_SCR220EPM2-10` (SCR Compressor) |


## SCR Compressor

| p | model | machine_type | src | evidence |
|---|---|---|---|---|
| 1 | 100EPM2 | Screw air compressor designed for low-pressure air needs | printed | SCREW AIR COMPRESSOR RANGE Designed for Low-Pressure Air Needs POWER: 3.7 - 315 KW PRESSURE: 4.5-16 BAR |
| 1 | 20APM | Screw air compressor designed for low-pressure air needs | printed | SCREW AIR COMPRESSOR RANGE Designed for Low-Pressure Air Needs POWER: 3.7 - 315 KW PRESSURE: 4.5-16 BAR |
| 1 | 50APM | Screw air compressor designed for low-pressure air needs | printed | SCREW AIR COMPRESSOR RANGE Designed for Low-Pressure Air Needs POWER: 3.7 - 315 KW PRESSURE: 4.5-16 BAR |
| 1 | SCR30XA | Screw air compressor designed for low-pressure air needs | printed | SCREW AIR COMPRESSOR RANGE Designed for Low-Pressure Air Needs POWER: 3.7 - 315 KW PRESSURE: 4.5-16 BAR |
| 7 | SCR100APM-10 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR100APM-12.5 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR100APM-7 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR100APM-8 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR30APM-10 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR30APM-12.5 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR30APM-15 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR30APM-16 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR30APM-7 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR30APM-8 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR40APM-10 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR40APM-12.5 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR40APM-7 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR40APM-8 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR50APM-10 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR50APM-12.5 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR50APM-7 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR50APM-8 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR60APM-10 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR60APM-12.5 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR60APM-7 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR60APM-8 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR75APM-10 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR75APM-12.5 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR75APM-7 | PM VSD air compressor | printed | PM VSD |
| 7 | SCR75APM-8 | PM VSD air compressor | printed | PM VSD |
| 8 | SCR1200LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR1300LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR1500LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR180H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR180H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR180H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR180H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR1900LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR2200LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR220H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR220H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR220H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR220H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR250H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR250H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR250H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR250H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR270H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR270H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR270H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR270H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR300H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR300H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR300H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR300H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR340H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR340H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR340H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR340H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR375H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR375H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR375H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR375H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR400H-10 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR400H-12.5 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR400H-7 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR400H-8 | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR530LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR830LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 8 | SCR950LHPM | Two-stage PM VSD air compressor | printed | Two Stage PM VSD |
| 9 | SCR100EPM2-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR100EPM2-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR100EPM2-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR125EPM2-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR125EPM2-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR125EPM2-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR150EPM2-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR150EPM2-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR150EPM2-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR180EPM2-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR180EPM2-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR180EPM2-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR20EPM-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR20EPM-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR20EPM-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR220EPM2-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR220EPM2-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR220EPM2-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR25EPM-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR25EPM-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR25EPM-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR30EPM-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR30EPM-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR30EPM-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR40EPM-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR40EPM-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR40EPM-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR50EPM-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR50EPM-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR50EPM-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR60EPM-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR60EPM-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR60EPM-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR75EPM2-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR75EPM2-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR75EPM2-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR90EPM2-10 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR90EPM2-7 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 9 | SCR90EPM2-8 | Air compressor | derived | Capacity (m /min), Pressure (BAR) |
| 10 | APM | Screw air compressor | printed | SCREW AIR COMPRESSORS |
| 10 | EPM/EPM2 | Screw air compressor | printed | SCREW AIR COMPRESSORS |
| 10 | LBPM | Screw air compressor | printed | SCREW AIR COMPRESSORS |
| 10 | OIL FREE | _(blank -- nothing on the page supported it)_ | unknown | SCREW AIR COMPRESSORS, Oil-free Air |
| 10 | PM2 | Screw air compressor | printed | SCREW AIR COMPRESSORS |
| 10 | TWO STAGES | Two-stage screw air compressor | printed | SCREW AIR COMPRESSORS |
| 11 | Air Dryer | _(blank -- nothing on the page supported it)_ | unknown | Air Dryer Removes Moisture & Contaminants |
| 11 | Air Storage Tank | _(blank -- nothing on the page supported it)_ | unknown | Air Storage Tank Provides stable supply & pressure balance |
| 11 | Booster Air Compressor | _(blank -- nothing on the page supported it)_ | unknown | Booster Air Compressor Raises pressure up to 40 bar for demanding applications |
