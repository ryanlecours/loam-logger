import type { Bike } from '../models/BikeComponents';

export const bikes: Bike[] = [
  {
    id: 'bike-tyee',
    name: 'Propain Tyee CF 6',
    type: 'enduro',
    frameMaterial: 'carbon',
    travelFrontMm: 170,
    travelRearMm: 160,
    hoursSinceLastService: 45,
    fork: {
        brand: 'RockShox',
        model: 'Zeb Ultimate',
        travelMm: 170,
        offsetMm: 44,
        damper: 'Charger 3.0',
        hoursSinceLastService: 21
    },
    shock: {
        brand: 'Öhlins',
        model: 'TTX2 Air',
        strokeMm: 65,
        eyeToEyeMm: 230,
        type: 'air',
        hoursSinceLastService: 45
    },
    drivetrain: {
        brand: 'SRAM',
        speed: 12,
        cassetteRange: '10-52T',
        derailleur: 'GX AXS',
        shifter: 'GX AXS Controller',
        hoursSinceLastService: 45
    },
  },
  {
    id: 'bike-smuggler',
    name: 'Transition Smuggler',
    type: 'trail',
    frameMaterial: 'carbon',
    travelFrontMm: 140,
    travelRearMm: 130,
    hoursSinceLastService: 80,
    fork: {
        brand: 'Fox',
        model: '34 Factory',
        travelMm: 140,
        offsetMm: 44,
        damper: 'FIT4',
        hoursSinceLastService: 80
    },
    shock: {
        brand: 'Fox',
        model: 'Float X Factory',
        strokeMm: 50,
        eyeToEyeMm: 190,
        type: 'air',
        hoursSinceLastService: 5
    },
    drivetrain: {
        brand: 'SRAM',
        speed: 12,
        cassetteRange: '10-50T',
        derailleur: 'GX',
        shifter: 'GX Trigger',
        hoursSinceLastService: 80
    },
  },
  {
    id: 'bike-wreckoning',
    name: 'Evil Wreckoning V3',
    type: 'enduro',
    frameMaterial: 'carbon',
    travelFrontMm: 170,
    travelRearMm: 166,
    hoursSinceLastService: 230,
    fork: {
        brand: 'Fox',
        model: '38 Factory',
        travelMm: 170,
        offsetMm: 44,
        damper: 'GRIP2',
        hoursSinceLastService: 210
    },
    shock: {
        brand: 'RockShox',
        model: 'Super Deluxe Coil Ultimate',
        strokeMm: 65,
        eyeToEyeMm: 230,
        type: 'coil',
        hoursSinceLastService: 210
    },
    drivetrain: {
        brand: 'SRAM',
        speed: 12,
        cassetteRange: '10-52T',
        derailleur: 'X01',
        shifter: 'X01 Trigger',
        hoursSinceLastService: 210
    },
  },
];
