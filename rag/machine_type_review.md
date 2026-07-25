# machine_type review

Correct anything wrong here BEFORE a non-dry run. You know the catalogue.

- **93** models across **4** catalogues
- machine_type source: **33 printed**, **52 derived**, **8 unknown** (left blank on purpose)
- **2** model names already exist in the live namespace

## Collisions -- resolve before ingesting

| new model | catalogue | already exists as |
|---|---|---|
| i380-i600 | NEO-T (Toggle Clamp) | `2-DT_Parameters_Brochure_20241227_EN_i380_i600` (DT (Toggle-Clamp)) |
| i850-i1900 | NEO-T (Toggle Clamp) | `2-DT_Parameters_Brochure_20241227_EN_i850_i1900` (DT (Toggle-Clamp)) |


## NEO-T (Toggle Clamp)

| p | model | machine_type | src | evidence |
|---|---|---|---|---|
| 2 | NEO-T2400 | _(blank -- nothing on the page supported it)_ | unknown | NEO-T2400 is a specific model under the NEO-T series, which is described as a 'New High-end Toggle System IMM' |
| 2 | NEO-T90 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power |
| 3 | NEO
T Clamping Unit | _(blank -- nothing on the page supported it)_ | unknown | Clamping Unit |
| 3 | NEO-T130 | Servo-hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power |
| 4 | NEO-T | Injection Unit | printed | Injection Unit |
| 4 | NEO-T160 | Servo-hydraulic injection moulding machine | derived | Clamping force, Injection unit, Screw diameter, Injection weight (PS), Injection pressure, Max. pump pressure, |
| 5 | NEO
Electrical & Hydraulic | Servo-hydraulic injection moulding machine | printed | Electrical & Hydraulic; Equipped with advanced controller especially for injection molding machine; A new gene |
| 5 | NEO-T200 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power |
| 6 | NEO-T260 | Injection moulding machine, servo-hydraulic | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power, Hopper capacity, Oil tank v |
| 7 | NEO-T360 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power |
| 8 | NEO-T400 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Screw diameter, Injection weight (PS), Injection pressure, Injection rate into  |
| 9 | NEO-T500 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power |
| 10 | NEO-T600 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power, Hopper capacity, Oil tank v |
| 11 | NEO-T700 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power, Hopper capacity, Oil tank v |
| 12 | NEO-T800 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power, Hopper capacity, Oil tank v |
| 13 | NEO-T1050 | Hydraulic injection moulding machine | derived | Clamping unit, Injection unit, Max. pump pressure, Pump motor power, Heater power, Hopper capacity, Oil tank v |
| 14 | NEO-T400-NEO-T1050 | Toggle-clamp injection moulding machine | derived | High rigidity 5 points-doubt toggle structure |
| 14 | NEO-T90-NEO-T360 | Toggle-clamp injection moulding machine | derived | High rigidity 5 points-doubt toggle structure |
| 14 | i2500-i5800 | Injection unit | printed | Function description /Injection unit |
| 14 | i380-i600 | Injection unit | printed | Function description /Injection unit |
| 14 | i7500-i19500 | Injection unit | printed | Function description /Injection unit |
| 14 | i850-i1900 | Injection unit | printed | Function description /Injection unit |
| 15 | NEO-T90-NEO-T1050 | Hydraulic injection moulding machine | derived | Function description / Clamping unit |
| 15 | NEO-T90-NEO-T320 | Injection moulding machine auxiliary | derived | Function description / Other |
| 15 | i380-i4800 | Electric injection moulding machine | derived | Function description/ Injection unit |
| 15 | i5800-i9500 | Electric injection moulding machine | derived | Function description/ Injection unit |

## NEO-M

| p | model | machine_type | src | evidence |
|---|---|---|---|---|
| 2 | NEOMv | Multi-component injection molding machine with vertical rotary turntable | printed | Multi-component IMM with vertical rotary turntable |
| 2 | NEO-M1120s Type 1 i1900 | Servo-hydraulic injection moulding machine with a two-platen clamping unit and a rotary table | derived | Clamping force, Clamping stroke (moving platen), Clamping stroke (middle platen), Space between tie bar, Max.  |
| 2 | NEO-M1120s Type 2 e1400h | Servo-hydraulic injection moulding machine with a two-platen clamping unit and a rotary table | derived | Clamping force, Clamping stroke (moving platen), Clamping stroke (middle platen), Space between tie bar, Max.  |
| 2 | NEO-M1120s Type 2 i3800 | Servo-hydraulic injection moulding machine with a two-platen clamping unit and a rotary table | derived | Clamping force, Clamping stroke (moving platen), Clamping stroke (middle platen), Space between tie bar, Max.  |
| 3 | NEO
Ms | Opposite injection IMM with horizontal rotary turntable | printed | Opposite injection IMM with horizontal rotary turntable |
| 3 | NEO-M1320s | Injection moulding machine | derived | Clamping unit, Injection unit, Screw diameter, Shot size (theoretical), Injection weight (PS), Injection press |
| 3 | NEO-M1320s i1900 | Injection moulding machine | derived | Clamping unit, Injection unit, Screw diameter, Shot size (theoretical), Injection weight (PS), Injection press |
| 4 | NEO-M1920s Type 1 i5800 | Hydraulic injection moulding machine with a rotary table | derived | Clamping unit, Injection unit, Rotation table weight |
| 4 | NEO-M1920s Type 1 i7500 | Hydraulic injection moulding machine with a rotary table | derived | Clamping unit, Injection unit, Rotation table weight |
| 4 | NEO-M1920s Type 2 i5800 | Hydraulic injection moulding machine with a rotary table | derived | Clamping unit, Injection unit, Rotation table weight |
| 4 | NEO-M1920s Type 2 i9500 | Hydraulic injection moulding machine with a rotary table | derived | Clamping unit, Injection unit, Rotation table weight |
| 5 | NEO-M1120s-NEO-M1320s | Injection moulding machine with two-platen clamping unit, double cylinder injection, and double carriage cylinders | printed | For clamping; High rigid two-platen clamping unit; For injection; Double cylinder injection; Double carriage c |
| 5 | NEO-M1920s | Injection moulding machine with two-platen clamping unit, double cylinder injection, and double carriage cylinders | printed | For clamping; High rigid two-platen clamping unit; For injection; Double cylinder injection; Double carriage c |
| 6 | NEO-M1120s | Electric injection moulding machine with KEBA controller and various monitoring and control functions, including options for hydraulic and other auxiliary systems. | derived | Function description /Clamping unit, For electric, For hydraulic, For other |
| 6 | NEO-M1320s-NEO-M1920s | Electric injection moulding machine with KEBA controller and various monitoring and control functions, including options for hydraulic and other auxiliary systems. | derived | Function description /Clamping unit, For electric, For hydraulic, For other |
| 7 | NEO-M1120v | Servo-hydraulic injection moulding machine with rotary table | derived | Clamping unit, Injection unit, Rotation table weight, Diameter of rotation platen, Rotation space of table |
| 7 | NEO-M1120v m2500 | Servo-hydraulic injection moulding machine with rotary table | derived | Clamping unit, Injection unit, Rotation table weight, Diameter of rotation platen, Rotation space of table |
| 7 | NEO-M1120v m640 | Servo-hydraulic injection moulding machine with rotary table | derived | Clamping unit, Injection unit, Rotation table weight, Diameter of rotation platen, Rotation space of table |
| 8 | NEO-M1420v | Injection moulding machine with a rotary table, servo-hydraulic, with clamping force of 14200 kN, for molds up to 1400 mm height, with various injection unit options. | derived | Clamping unit, Injection unit, Diameter of rotation platen, Rotation space of table, Rotation table weight, Fr |
| 9 | NEO-M1720v | Injection moulding machine | derived | Clamping force, Clamping stroke, Space between tie bar, Max. mold height, Min. mold height, Ejector stroke, Ej |
| 9 | m1100 | Injection moulding machine | derived | Screw diameter, Shot size (theoretical), Injection weight (PS), Injection pressure, Injection rate into air (P |
| 9 | m2500 | Injection moulding machine | derived | Screw diameter, Shot size (theoretical), Injection weight (PS), Injection pressure, Injection rate into air (P |
| 9 | m3700 | Injection moulding machine | derived | Screw diameter, Shot size (theoretical), Injection weight (PS), Injection pressure, Injection rate into air (P |
| 10 | NEO-M1920v | Injection moulding machine with rotary table | derived | Diameter of rotation platen, Rotation space of table, Rotation table weight |
| 10 | NEO-M1920v m1100 Type 1 | Injection moulding machine | printed | Injection unit |
| 10 | NEO-M1920v m1500 Type 2 | Injection moulding machine | printed | Injection unit |
| 10 | NEO-M1920v m2500 Type 3 | Injection moulding machine | printed | Injection unit |
| 10 | NEO-M1920v m3700 Type 1 | Injection moulding machine | printed | Injection unit |
| 10 | NEO-M1920v m3700 Type 2 | Injection moulding machine | printed | Injection unit |
| 10 | NEO-M1920v m3700 Type 3 | Injection moulding machine | printed | Injection unit |
| 11 | m370-m5800 | Hydraulic injection unit with single cylinder injection, transducer control for carriage, and proportional injection valve and back pressure control | derived | Single cylinder injection, Transducer control for carriage cylinder, Plasticizing with hydraulic motor, Propor |
| 12 | NEO-M1120v-NEO-M1920v | Electric injection molding machine | printed | For electric |

## FUDL

| p | model | machine_type | src | evidence |
|---|---|---|---|---|
| 8 | SQ-1-10L SIX-STATION 1.2L-2L | Six-station wheel blow molding machine, electric/hydraulic parison control, three-layer servo motor extrusion, for containers 1.2L-2L, with 3 die head cavities, producing 48000 units per 24 hours | printed | SQ-1-10L SIX-STATION Wheel Blow Molding Machine, Product Description, Specifications, Production capacity (24H |
| 8 | SQ-1-10L SIX-STATION 3-10L | Six-station wheel blow molding machine, electric/hydraulic parison control, three-layer servo motor extrusion, for containers 3-10L, with 2 die head cavities, producing 28000-33000 units per 24 hours | printed | SQ-1-10L SIX-STATION Wheel Blow Molding Machine, Product Description, Specifications, Production capacity (24H |
| 8 | SQ-1-10L SIX-STATION 500ml-1L | Six-station wheel blow molding machine, electric/hydraulic parison control, three-layer servo motor extrusion, for containers 500ml-1L, with 4 die head cavities, producing 60000 units per 24 hours | printed | SQ-1-10L SIX-STATION Wheel Blow Molding Machine, Product Description, Specifications, Production capacity (24H |
| 9 | SQ-100ML - 5L | Full-electric blow molding machine, 1-6 layers, full servo drive, for 1-5 liter pesticide bottles, milk bottles, detergent articles, and jerry cans | printed | Full-Electric Blow Molding Machine, 1-6 layer design, full servo drive, It is suitable for various hollow blow |
| 10 | SQ-11 (5L) | Full-hydraulic automatic blow molding machine for making 1-12 L hollow products, single or multi-layer (1-4) machines can produce cladding products or liquid level line products, such as Jerry cans, soy sauce pots, and other products. The machine adopts a hydraulic system, double stations, and PLC computer control. Multiple configurations and flexible choices. 1-6 die Head. High efficiency, cost-effective. | printed | Hydraulic Automatic Blow Molding Machine, This is a full-hydraulic automatic blow molding machine for making 1 |
| 11 | SQ-100-1000ML | _(blank -- nothing on the page supported it)_ | unknown | SQ-100-1000ML (1-6 LAYERS) 8-Stations high Speed Wheel Blow Molding Machine; This machine is suitable for manu |
| 12 | SQ-15-30L Double Stations (3 Layers) | Continuous fully automatic extrusion blow molding machine, double stations, 1-6 layers, for 15-30L hollow products such as urea drums, jerrycans, and detergent barrels | printed | SQ-15-30L (1-6 LAYERS) Continuous Fully Automatic Blow Molding Machine; This is a fully automatic continuous e |
| 12 | SQ-15-30L Single Station (3 Layers) | Continuous fully automatic extrusion blow molding machine, single station, 1-6 layers, for 15-30L hollow products such as urea drums, jerrycans, and detergent barrels | printed | SQ-15-30L (1-6 LAYERS) Continuous Fully Automatic Blow Molding Machine; This is a fully automatic continuous e |
| 13 | SQ-3-5L 65 | Crank automatic hydraulic blow molding machine, 1-6 layers, suitable for producing laundry detergent pots, liquid detergent buckets, soy sauce pots, ocean balls, cosmetic bottles, fruit milk bottles, medical bottles, etc. This machine is controlled by a PLC program. It has the characteristics of high stability, low resistance, high precision, and full automaticity. It could achieve a fully automatic operation. | printed | Crank Automatic Hydraulic Blow Molding Machine, This model is a single or multi-die head hydraulic automatic b |
| 13 | SQ-3-5L 75 | Crank automatic hydraulic blow molding machine, 1-6 layers, suitable for producing laundry detergent pots, liquid detergent buckets, soy sauce pots, ocean balls, cosmetic bottles, fruit milk bottles, medical bottles, etc. This machine is controlled by a PLC program. It has the characteristics of high stability, low resistance, high precision, and full automaticity. It could achieve a fully automatic operation. | printed | Crank Automatic Hydraulic Blow Molding Machine, This model is a single or multi-die head hydraulic automatic b |
| 14 | SQ-20-200L 200L | Large accumulator blow molding machine for containers up to 200L | printed | Large Accumulator Blow Molding Machine; Max. product volume: 200L |
| 14 | SQ-20-200L 25L | Large accumulator blow molding machine for containers up to 25L | printed | Large Accumulator Blow Molding Machine; Max. product volume: 25L |
| 14 | SQ-20-200L 50L | Large accumulator blow molding machine for containers up to 50L | printed | Large Accumulator Blow Molding Machine; Max. product volume: 50L |
| 15 | SQ-9 | Double stations long tube wheel blow molding machine for slender hollow products like sewer pipes, washing machine pipes, explosive pipes, warning frame box, and seeding machine pipes with PE/PP/EVA as raw materials. It is able to load materials automatically, blow products automatically, and demold automatically. The maximum length of blowing products could be up to 1 meter. The machine is easy to operate, stable in quality, with a daily output of 12000 to 20000 pcs. | printed | Double Stations Long Tube Wheel Machine, Product Description |
| 16 | SQ- SHOE PAD | Blow Molding Machine (Material TPU) | printed | Blow Molding Machine (Material TPU) |
| 17 | SQ- 4-8 | Pneumatic Rotary Blow Molding Machine for producing medical bottles, fruit milk bottles, ice lolly tubes, jelly tubes, guide tubes, dropper pipettes, bearing boxes, toy parts, cosmetic bottles, straws, etc. | printed | Pneumatic Rotary Blow Molding Machine, This machine is suitable for producing medical bottles, fruit milk bott |

## YHE Gen 5

| p | model | machine_type | src | evidence |
|---|---|---|---|---|
| 1 | YHE Generation 5 | Injection moulding machine | derived | Clamping Force |
| 6 | UWA Generation 5 | _(blank -- nothing on the page supported it)_ | unknown | UWA Generation 5 combines high-speed injection, electric charging, and double servo linear guide rails, delive |
| 8 | YHE 308 Generation 5 | Injection molding machine, servo-hydraulic, with high-precision modular injection unit, intelligent digital control system, and energy-efficient design with wide platen and integrated computer control | printed | All Standard Upgrades Of Injection Molding Machines; Key Features: > High-precision modular injection unit > I |
| 9 | CLAMPING UNIT | _(blank -- nothing on the page supported it)_ | unknown | CLAMPING UNIT Configuration Function > Widened and thickened templates for stronger structure > Optimized forc |
| 10 | INJECTION UNIT | _(blank -- nothing on the page supported it)_ | unknown | INJECTION UNIT, Configuration Function, Advanced Barrel Cooling, Powerful Drive: High-torque hydraulic motor,  |
| 12 | POWER CONTROL SYSTEM | _(blank -- nothing on the page supported it)_ | unknown | POWER CONTROL SYSTEM, Configuration Function, 20%-40% Enhanced With E-Charge System, 2-in-1 Servo Drive (Optio |
| 13 | A-BOX | IoT gateway | derived | Up to 50 units can be connected |
| 13 | C-BOX | Wireless communication module | derived | The maximum radius is 50m. |
| 16 | SCREW AIR COMPRESSOR | _(blank -- nothing on the page supported it)_ | unknown | SCREW AIR COMPRESSOR |
| 18 | YHE138 | Injection moulding machine | derived | Injection Unit, Clamping unit |
| 18 | YHE168 | Injection moulding machine | derived | Injection Unit, Clamping unit |
| 19 | YHE188 330V | Injection moulding machine | derived | Injection Unit, Screw diameter, Screw ratio, Theoretical injection capacity, Shot weight(PS), Injection rate i |
| 19 | YHE188 500V | Injection moulding machine | derived | Injection Unit, Screw diameter, Screw ratio, Theoretical injection capacity, Shot weight(PS), Injection rate i |
| 19 | YHE228 500V | Injection moulding machine | derived | Injection Unit, Screw diameter, Screw ratio, Theoretical injection capacity, Shot weight(PS), Injection rate i |
| 19 | YHE228 800V | Injection moulding machine | derived | Injection Unit, Screw diameter, Screw ratio, Theoretical injection capacity, Shot weight(PS), Injection rate i |
| 20 | YHE288 1080V | Hydraulic injection moulding machine | derived | Clamping force, Injection stroke, Injection Speed, Screw speed, Injection pressure |
| 20 | YHE288 800V | Hydraulic injection moulding machine | derived | Clamping force, Injection stroke, Injection Speed, Screw speed, Injection pressure |
| 20 | YHE308 1080V | Hydraulic injection moulding machine | derived | Clamping force, Injection stroke, Injection Speed, Screw speed, Injection pressure |
| 20 | YHE308 1400V | Hydraulic injection moulding machine | derived | Clamping force, Injection stroke, Injection Speed, Screw speed, Injection pressure |
