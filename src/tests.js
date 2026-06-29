// Self-check harness. Run `_test()` in the dev console; logs `self-check ok`.
// Exercises the DOM-free core in pure.js only — no canvas/DOM needed.
'use strict';

import {
  writePGM, parsePGM, parseYAML, rasterPoly,
  buildWorldTomlFrom, worldIssuesFrom, canon, tomlStr, splitList, normalizeVocab,
} from './pure.js';

export function runSelfCheck() {
  const w = 4, h = 3;
  const px = new Uint8Array([0,128,255,0, 50,100,150,200, 10,20,30,40]);
  const buf = writePGM(w, h, px);
  const back = parsePGM(buf.buffer);
  console.assert(back.w === w && back.h === h, 'pgm dims');
  for (let i = 0; i < px.length; i++) console.assert(back.pixels[i] === px[i], 'pgm bytes ' + i);

  const yaml = 'image: map.pgm\nmode: trinary\nresolution: 0.05\norigin: [-1.5, -2.0, 0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n';
  const m = parseYAML(yaml);
  console.assert(m.resolution === 0.05 && m.origin[0] === -1.5, 'yaml parse');

  const out = new Uint8Array(16).fill(254);
  rasterPoly(out, 4, 4, [[1,1],[3,1],[3,3],[1,3]], 0);
  let blackCount = 0;
  for (const v of out) if (v === 0) blackCount++;
  console.assert(blackCount >= 4, 'raster filled, got ' + blackCount);

  // world.toml builder (pure)
  const wpRoom = { type: 'waypoint', role: 'room', name: 'Kitchen', heading: Math.PI / 2,
    coords: [[1.2, 3.4]], aliases: ['the kitchen'], barrier: true, present: true };
  const wpLoc = { type: 'waypoint', role: 'location', name: 'kitchen table', room: 'kitchen',
    heading: 0, coords: [[1.0, 2.0]], category: 'table', placement: true, aliases: [], present: true };
  const wpAbsent = { type: 'waypoint', role: 'room', name: 'hall', heading: 0, coords: [[0, 0]], present: false };
  const vocab = { object_categories: { drinks: ['Cola', 'water'] }, names: ['Charlie'],
    gestures: { waving: ['waving person'] } };
  const toml = buildWorldTomlFrom([wpRoom, wpLoc, wpAbsent], vocab);
  console.assert(/\[rooms\.kitchen\]/.test(toml), 'room table');
  console.assert(/\[locations\.kitchen_table\]/.test(toml), 'location table snake_cased');
  console.assert(/room = "kitchen"/.test(toml), 'location->room link');
  console.assert(/pose = \[1\.2, 3\.4, 1\.5708\]/.test(toml), 'room pose w/ heading, got:\n' + toml);
  console.assert(/barrier = true/.test(toml), 'barrier flag');
  console.assert(/present = false/.test(toml), 'absent room marked present=false');
  console.assert(/\[object_categories\]/.test(toml) && /drinks = \["cola", "water"\]/.test(toml), 'object categories lowercased');
  console.assert(/names = \["Charlie"\]/.test(toml), 'names keep casing');
  console.assert(/\[gestures\.waving\]/.test(toml), 'gestures table');
  console.assert(canon('the Kitchen Table') === 'the_kitchen_table', 'canon');

  // doors -> [doors.*]; radius emitted only when set
  const wpDoor = { type: 'waypoint', role: 'door', name: 'Entrance Door', heading: 0,
    coords: [[2.0, 1.0]], radius: 1.2, present: true };
  const wpDoorNoR = { type: 'waypoint', role: 'door', name: 'side', heading: 0, coords: [[0, 0]], present: true };
  const tomlD = buildWorldTomlFrom([wpDoor, wpDoorNoR], {});
  console.assert(/\[doors\.entrance_door\]/.test(tomlD), 'doors table snake_cased');
  console.assert(/\[doors\.entrance_door\]\npose = \[2\.0, 1\.0, 0\.0\]\nradius = 1\.2/.test(tomlD), 'door pose + radius, got:\n' + tomlD);
  console.assert(/\[doors\.side\]\npose = \[0\.0, 0\.0, 0\.0\]\n/.test(tomlD) && !/\[doors\.side\][\s\S]*radius/.test(tomlD), 'no radius line when unset');
  const dupDoors = [
    { type: 'waypoint', role: 'door', name: 'Front', coords: [[0, 0]], heading: 0, present: true },
    { type: 'waypoint', role: 'door', name: 'front', coords: [[1, 1]], heading: 0, present: true }];
  console.assert(worldIssuesFrom(dupDoors, {}).errors.length === 1, 'colliding door names -> error');

  // vocab editor helpers
  console.assert(splitList('cola, water ,  milk ').length === 3, 'splitList trims + drops blanks');
  console.assert(splitList('').length === 0, 'splitList empty');
  const nv = normalizeVocab({ object_categories: { drinks: ['cola'] }, names: ['Alex'], gestures: { waving: [] } });
  console.assert(nv.object_categories.drinks[0] === 'cola' && nv.names[0] === 'Alex' && 'waving' in nv.gestures, 'normalizeVocab round-trips');

  // canon parity with Python _norm: Unicode letters survive
  console.assert(canon('Café') === 'café', 'canon keeps unicode letters, got ' + canon('Café'));
  // tomlStr escapes a control char rather than emitting it raw
  console.assert(tomlStr('a\nb') === '"a\\nb"', 'tomlStr escapes newline, got ' + tomlStr('a\nb'));

  // validation: clean world has no fatal errors; canon-collisions are errors
  console.assert(worldIssuesFrom([wpRoom, wpLoc], vocab).errors.length === 0, 'clean world: no errors');
  console.assert(worldIssuesFrom([], { object_categories: { Drinks: ['a'], drinks: ['b'] }, names: [], gestures: {} }).errors.length === 1, 'colliding categories -> error');
  const dupRooms = [
    { type: 'waypoint', role: 'room', name: 'Kitchen', coords: [[0, 0]], heading: 0, present: true },
    { type: 'waypoint', role: 'room', name: 'kitchen', coords: [[1, 1]], heading: 0, present: true }];
  console.assert(worldIssuesFrom(dupRooms, {}).errors.length === 1, 'colliding room names -> error');
  // location -> present=false room is a warning (cascade-dropped on the robot)
  const absentRoomCase = [
    { type: 'waypoint', role: 'room', name: 'pantry', coords: [[0, 0]], heading: 0, present: false },
    { type: 'waypoint', role: 'location', name: 'pantry_shelf', room: 'pantry', coords: [[1, 1]], heading: 0, present: true }];
  console.assert(worldIssuesFrom(absentRoomCase, {}).warnings.some(w => /pantry_shelf/.test(w)), 'location->absent room warned');

  console.log('self-check ok');
}
