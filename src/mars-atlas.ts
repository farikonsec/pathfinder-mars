/**
 * Named places on Mars. Planetocentric latitude, east-positive longitude (0–360), degrees.
 * Landing coordinates are the published touchdown estimates, rounded to ~0.01°; features use IAU nomenclature centres.
 * Good to a few km, which is finer than the 15 km MOLA grid they sit on.
 */
export type PlaceKind = 'volcano' | 'crater' | 'plain' | 'canyon' | 'dunes' | 'polar' | 'site' | 'crash' | 'glyph' | 'base';
export interface Place {id: string; name: string; lat: number; lon: number; kind: PlaceKind; note: string; /** Height above the ground, for airborne objectives. */ agl?: number;}

export const PLACES: Place[] = [
  // Volcanoes
  {id: 'olympus', name: 'Olympus Mons', lat: 18.65, lon: 226.2, kind: 'volcano', note: 'Tallest volcano in the Solar System · ~22 km relief, 600 km across'},
  {id: 'ascraeus', name: 'Ascraeus Mons', lat: 11.92, lon: 255.92, kind: 'volcano', note: 'Tharsis Montes, northern shield'},
  {id: 'pavonis', name: 'Pavonis Mons', lat: 1.48, lon: 247.04, kind: 'volcano', note: 'Tharsis Montes, central shield'},
  {id: 'arsia', name: 'Arsia Mons', lat: -8.26, lon: 239.9, kind: 'volcano', note: 'Tharsis Montes, southern shield'},
  {id: 'elysium-mons', name: 'Elysium Mons', lat: 24.8, lon: 146.9, kind: 'volcano', note: 'Largest volcano of the Elysium rise'},
  // Canyons
  {id: 'valles', name: 'Valles Marineris', lat: -13.9, lon: 300.8, kind: 'canyon', note: '4,000 km canyon system, up to 7 km deep'},
  {id: 'noctis', name: 'Noctis Labyrinthus', lat: -6.8, lon: 257.3, kind: 'canyon', note: 'Maze of fault valleys at the head of Valles Marineris'},
  // Craters and basins
  {id: 'hellas', name: 'Hellas Planitia', lat: -42.4, lon: 70.5, kind: 'crater', note: 'Impact basin 2,300 km wide, lowest point on Mars'},
  {id: 'argyre', name: 'Argyre Planitia', lat: -49.7, lon: 316.0, kind: 'crater', note: 'Impact basin ~1,800 km wide'},
  {id: 'gale', name: 'Gale Crater', lat: -5.4, lon: 137.8, kind: 'crater', note: '154 km crater with Aeolis Mons (Mount Sharp)'},
  {id: 'jezero', name: 'Jezero Crater', lat: 18.38, lon: 77.58, kind: 'crater', note: '45 km crater with an ancient river delta'},
  {id: 'gusev', name: 'Gusev Crater', lat: -14.5, lon: 175.4, kind: 'crater', note: '166 km crater, Spirit rover field site'},
  {id: 'huygens', name: 'Huygens Crater', lat: -13.9, lon: 55.6, kind: 'crater', note: '470 km peak-ring crater'},
  {id: 'schiaparelli', name: 'Schiaparelli Crater', lat: -2.7, lon: 16.7, kind: 'crater', note: '460 km crater on the equator'},
  {id: 'holden', name: 'Holden Crater', lat: -26.4, lon: 325.9, kind: 'crater', note: 'Layered lake sediments'},
  {id: 'endeavour', name: 'Endeavour Crater', lat: -2.28, lon: 354.77, kind: 'crater', note: '22 km crater, Opportunity explored its rim'},
  {id: 'victoria', name: 'Victoria Crater', lat: -2.05, lon: 354.51, kind: 'crater', note: '750 m crater, Opportunity 2006–2008'},
  {id: 'korolev', name: 'Korolev Crater', lat: 73.0, lon: 165.0, kind: 'crater', note: '82 km crater filled with water ice'},
  // Plains and dune seas
  {id: 'utopia', name: 'Utopia Planitia', lat: 46.7, lon: 117.5, kind: 'plain', note: 'Largest recognised impact basin in the north'},
  {id: 'elysium', name: 'Elysium Planitia', lat: 3.0, lon: 154.7, kind: 'plain', note: 'Young volcanic plains'},
  {id: 'amazonis', name: 'Amazonis Planitia', lat: 24.8, lon: 196.0, kind: 'plain', note: 'Smooth, youthful lowland plains'},
  {id: 'arcadia', name: 'Arcadia Planitia', lat: 47.2, lon: 184.3, kind: 'plain', note: 'Shallow buried ice'},
  {id: 'chryse', name: 'Chryse Planitia', lat: 28.4, lon: 319.7, kind: 'plain', note: 'Outflow channels drain into it'},
  {id: 'acidalia', name: 'Acidalia Planitia', lat: 46.7, lon: 337.0, kind: 'plain', note: 'Dark northern plain'},
  {id: 'isidis', name: 'Isidis Planitia', lat: 12.9, lon: 87.0, kind: 'plain', note: 'Impact basin plain'},
  {id: 'meridiani', name: 'Meridiani Planum', lat: 0.2, lon: 357.5, kind: 'plain', note: 'Hematite plains'},
  {id: 'syrtis', name: 'Syrtis Major', lat: 8.4, lon: 69.5, kind: 'plain', note: 'Dark volcanic plateau, visible from Earth'},
  {id: 'olympia-undae', name: 'Olympia Undae', lat: 81.0, lon: 180.0, kind: 'dunes', note: 'Largest dune sea on Mars, around the north polar cap'},
  {id: 'north-cap', name: 'Planum Boreum', lat: 88.0, lon: 15.0, kind: 'polar', note: 'North polar ice cap'},
  {id: 'south-cap', name: 'Planum Australe', lat: -84.0, lon: 160.0, kind: 'polar', note: 'South polar ice cap'},
  // Landing sites
  {id: 'mars3', name: 'Mars 3', lat: -45.0, lon: 202.0, kind: 'site', note: 'USSR · 1971 · first soft landing, lost after ~20 s'},
  {id: 'viking1', name: 'Viking 1', lat: 22.27, lon: 312.05, kind: 'site', note: 'NASA · 1976 · Chryse Planitia'},
  {id: 'viking2', name: 'Viking 2', lat: 47.64, lon: 134.29, kind: 'site', note: 'NASA · 1976 · Utopia Planitia'},
  {id: 'pathfinder', name: 'Mars Pathfinder', lat: 19.13, lon: 326.78, kind: 'site', note: 'NASA · 1997 · Sojourner rover, Ares Vallis'},
  {id: 'beagle2', name: 'Beagle 2', lat: 11.53, lon: 90.43, kind: 'site', note: 'UK / ESA · 2003 · landed, panels never fully opened'},
  {id: 'spirit', name: 'Spirit', lat: -14.57, lon: 175.47, kind: 'site', note: 'NASA · 2004 · Gusev Crater'},
  {id: 'opportunity', name: 'Opportunity', lat: -1.95, lon: 354.47, kind: 'site', note: 'NASA · 2004 · Meridiani Planum'},
  {id: 'phoenix', name: 'Phoenix', lat: 68.22, lon: 234.25, kind: 'site', note: 'NASA · 2008 · touched water ice'},
  {id: 'curiosity', name: 'Curiosity', lat: -4.59, lon: 137.44, kind: 'site', note: 'NASA · 2012 · Bradbury Landing, Gale Crater'},
  {id: 'schiaparelli-edm', name: 'Schiaparelli EDM', lat: -2.05, lon: 353.79, kind: 'crash', note: 'ESA · 2016 · impact site'},
  {id: 'insight', name: 'InSight', lat: 4.5, lon: 135.62, kind: 'site', note: 'NASA · 2018 · marsquake seismometer'},
  {id: 'perseverance', name: 'Perseverance', lat: 18.44, lon: 77.45, kind: 'site', note: 'NASA · 2021 · Octavia E. Butler Landing, with Ingenuity'},
  {id: 'zhurong', name: 'Zhurong', lat: 25.07, lon: 109.93, kind: 'site', note: 'CNSA · 2021 · Utopia Planitia'},
  // Fictional
  {id: 'jezero-base', name: 'Jezero Base', lat: 18.462, lon: 77.472, kind: 'base', note: 'Fictional first human settlement · habitats, greenhouse farms, two landing pads'},
  {id: 'rahimli-glyph', name: 'Rahimli Geoglyph', lat: 18.3, lon: 226.2, kind: 'glyph', note: 'Fictional 30 km inscription on the Olympus Mons caldera floor'},
];

export const placeById = (id: string) => PLACES.find(p => p.id === id);
export const LANDING_SITES = PLACES.filter(p => p.kind === 'site' || p.kind === 'crash');
