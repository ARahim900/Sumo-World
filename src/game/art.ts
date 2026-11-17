import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { blocks, DESTINATION } from './content';
const boxGeometry = new T.BoxGeometry(1, 1, 1);
export function box(parent: T.Object3D, size: number[], position: number[], material: T.Material) {
  const mesh = new T.Mesh(boxGeometry, material); mesh.scale.set(size[0], size[1], size[2]); mesh.position.set(position[0], position[1], position[2]); parent.add(mesh); return mesh;
}
const surface = (color: T.ColorRepresentation, roughness = .5, metalness = .1) => new T.MeshStandardMaterial({ color, roughness, metalness });
const glow = (color: T.ColorRepresentation, intensity = 1.6) => new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });
export function createCar() {
  const group = new T.Group();
  const paint = new T.MeshPhysicalMaterial({ color: '#71838c', metalness: .85, roughness: .23, clearcoat: 1, clearcoatRoughness: .12 });
  const black = surface('#080d16', .3, .6); const glass = surface('#071521', .1, .85);
  const body = new T.Mesh(new RoundedBoxGeometry(1.87, .53, 4.15, 3, .12), paint); body.position.y = .04; body.castShadow = true; group.add(body);
  // A tapered cabin gives the original coupe a continuous roof and windscreen silhouette.
  const shape = new T.Shape(); shape.moveTo(-1.15, .26); shape.lineTo(-.65, .85); shape.lineTo(.45, .84); shape.lineTo(1.12, .27); shape.closePath();
  const cabin = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 1.52, bevelEnabled: true, bevelThickness: .035, bevelSize: .04, bevelSegments: 2, steps: 1 }), glass);
  cabin.rotation.y = -Math.PI / 2; cabin.position.x = .76; group.add(cabin);
  box(group, [1.48, .06, 1.15], [0, .86, -.1], paint);
  box(group, [1.94, .14, .18], [0, -.13, 2.03], black);
  box(group, [1.92, .14, .18], [0, -.13, -2.04], black);
  box(group, [1.72, .06, .24], [0, .38, -1.88], black);
  for (let i = 0; i < 5; i++) box(group, [1.3, .025, .035], [0, .3, -1.15 - i * .12], black);
  box(group, [.64, .14, .03], [0, -.08, -2.14], surface('#ced4d8'));
  box(group, [1.65, .055, .055], [0, .14, -2.09], glow('#ff284b', 5));
  for (const side of [-1, 1]) {
    box(group, [.62, .055, .06], [side * .54, .15, 2.09], glow('#c4f6ff', 7));
    box(group, [.035, .045, 2.4], [side * .944, -.18, -.1], glow('#6cdeee', 2));
    box(group, [.23, .12, .25], [side * 1.01, .43, .55], paint);
    box(group, [.035, .045, .23], [side * .95, .28, -.25], black);
    box(group, [.16, .12, .3], [side * .62, -.19, -2.11], black);
  }
  const wheels: T.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new T.Group(); const tyre = new T.Mesh(new T.CylinderGeometry(.36, .36, .23, 24), surface('#08090c', .85)); tyre.rotation.z = Math.PI / 2; pivot.add(tyre);
    for (const s of [-1, 1]) {
      const rim = new T.Mesh(new T.CylinderGeometry(.245, .245, .012, 16), surface('#a3aab0', .22, .95)); rim.rotation.z = Math.PI / 2; rim.position.x = s * .123; pivot.add(rim);
      const hub = new T.Mesh(new T.CylinderGeometry(.09, .09, .016, 12), black); hub.rotation.z = Math.PI / 2; hub.position.x = s * .134; pivot.add(hub);
      for (let k = 0; k < 5; k++) { const spoke = box(pivot, [.02, .04, .4], [s * .135, 0, 0], black); spoke.rotation.x = k * Math.PI / 5; }
    }
    group.add(pivot); wheels.push(pivot);
  }
  const lights: T.SpotLight[] = [];
  for (const x of [-.65, .65]) {
    const light = new T.SpotLight('#c4eaff', 70, 42, .48, .6, 1.1); light.position.set(x, .2, 2); light.target.position.set(x, -1, 22); group.add(light, light.target); lights.push(light);
  }
  const under = new T.PointLight('#19d9df', 7, 5, 1.8); under.position.set(0, -.3, 0); group.add(under);
  return { group, wheels, lights };
}
export function person(color = '#cfbbce') {
  const group = new T.Group(); const cloth = surface('#192233'); const accent = glow(color, .25);
  const torso = new T.Mesh(new T.CapsuleGeometry(.22, .42, 4, 8), cloth); torso.position.y = .18; group.add(torso);
  const head = new T.Mesh(new T.SphereGeometry(.17, 12, 10), surface('#b59688')); head.position.y = .72; group.add(head);
  box(group, [.36, .035, .035], [0, .48, .205], accent);
  const legs: T.Mesh[] = [];
  for (const s of [-1, 1]) {
    const leg = new T.Mesh(new T.CapsuleGeometry(.08, .45, 3, 6), cloth); leg.position.set(s * .12, -.43, 0); group.add(leg); legs.push(leg);
    const arm = new T.Mesh(new T.CapsuleGeometry(.065, .4, 3, 6), cloth); arm.position.set(s * .29, .12, 0); group.add(arm);
  }
  return { group, legs };
}
function sign(text: string, color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#090d18'; ctx.fillRect(0, 0, 512, 128); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(5, 5, 502, 118);
  ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 256, 66);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map: texture, toneMapped: false });
}
export async function createCity(scene: T.Scene) {
  const texture = await new T.TextureLoader().loadAsync('/assets/facade.png'); texture.colorSpace = T.SRGBColorSpace; texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.anisotropy = 4;
  const facade = new T.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#87bed4', emissiveIntensity: .38, roughness: .7, metalness: .2 });
  const pavement = surface('#242b3a', .6); const graphite = surface('#111827', .4, .5);
  const cyan = glow('#23dce8'); const pink = glow('#ef3fa3');
  const noise = document.createElement('canvas'); noise.width = noise.height = 256;
  const nc = noise.getContext('2d')!; const image = nc.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) { const v = 70 + Math.random() * 80; image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255; }
  nc.putImageData(image, 0, 0); const asphalt = new T.CanvasTexture(noise); asphalt.wrapS = asphalt.wrapT = T.RepeatWrapping; asphalt.repeat.set(160, 160);
  const roadMat = new T.MeshStandardMaterial({ color: '#101722', roughness: .28, metalness: .3, roughnessMap: asphalt, bumpMap: asphalt, bumpScale: .025, envMapIntensity: .15 });
  const road = box(scene, [400, .1, 400], [0, -.06, 0], roadMat); road.receiveShadow = true;
  for (let x = -150; x <= 150; x += 60) for (let z = -150; z <= 150; z += 60) {
    box(scene, [44, .16, 44], [x, .02, z], pavement);
    for (const s of [-1, 1]) {
      box(scene, [44, .035, .12], [x, .115, z + s * 22], s > 0 ? cyan : pink);
      box(scene, [.12, .035, 44], [x + s * 22, .115, z], s > 0 ? pink : cyan);
    }
  }
  const mats = [1, 2, 3, 4].map(n => { const t = texture.clone(); t.repeat.set(1, n); t.needsUpdate = true; const m = facade.clone(); m.map = t; m.emissiveMap = t; return m; });
  const names = ['SUMO', 'NOVA', 'AFTERHOURS', 'NEON MARKET', 'ORBIT', 'NIGHT CITY'];
  const signs = names.map((n, i) => sign(n, i % 2 ? '#ff59b6' : '#61eaf4'));
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]; const mesh = box(scene, [b.w, b.h, b.d], [b.x, b.h / 2 + .1, b.z], mats[Math.min(3, Math.floor(b.h / 20))]); mesh.castShadow = true; mesh.receiveShadow = true;
    box(scene, [b.w + .3, .3, b.d + .3], [b.x, b.h + .1, b.z], graphite);
    const neon = b.style % 2 ? pink : cyan;
    box(scene, [.12, b.h, .12], [b.x - b.w / 2 - .03, b.h / 2, b.z + b.d / 2], neon);
    if (i % 3 === 0) {
      box(scene, [b.w + .2, .18, b.d + .2], [b.x, b.h * .75, b.z], neon);
      const billboard = new T.Mesh(new T.PlaneGeometry(8, 2), signs[i % signs.length]); billboard.position.set(b.x, 5.5, b.z + b.d / 2 + .03); scene.add(billboard);
    }
    if (i % 4 === 0) {
      box(scene, [4, 2, 4], [b.x, b.h + 1, b.z], graphite);
      box(scene, [.09, 8, .09], [b.x, b.h + 5, b.z], graphite);
      box(scene, [.2, .3, .2], [b.x, b.h + 9, b.z], pink);
    }
  }
  const stripe = new T.MeshBasicMaterial({ color: '#9bafbb' });
  for (let lane = -180; lane <= 180; lane += 60) for (let at = -192; at < 198; at += 9) {
    if (Math.abs(at % 60) < 9) continue;
    box(scene, [.12, .012, 3], [lane, .015, at], stripe);
    box(scene, [3, .012, .12], [at, .015, lane], stripe);
  }
  for (let lane = -180; lane <= 180; lane += 60) for (let at = -180; at <= 180; at += 60) {
    for (let i = -5; i <= 5; i++) {
      box(scene, [.55, .015, 2.7], [lane + i * 1.1, .02, at + 10], stripe);
      box(scene, [2.7, .015, .55], [lane + 10, .02, at + i * 1.1], stripe);
    }
  }
  const pole = surface('#323c50', .4, .7); const lamp = glow('#bddde7', 4);
  for (let z = -180; z <= 180; z += 24) for (const x of [-9, 9]) {
    box(scene, [.12, 6, .12], [x, 3, z], pole); box(scene, [1.8, .12, .16], [x - Math.sign(x) * .8, 6, z], pole); box(scene, [1, .06, .3], [x - Math.sign(x), 5.93, z], lamp);
    if (Math.abs(z) < 90) { const l = new T.PointLight(x < 0 ? '#29c6e2' : '#e0469a', 24, 19, 1.6); l.position.set(x, 5.3, z); scene.add(l); }
    box(scene, [.7, .7, 1.2], [x + Math.sign(x) * 1.5, .42, z + 3], graphite);
  }
  const lightCanvas = document.createElement('canvas'); lightCanvas.width = lightCanvas.height = 128;
  const lc = lightCanvas.getContext('2d')!; const gradient = lc.createRadialGradient(64, 64, 2, 64, 64, 64); gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.3, '#ffffff70'); gradient.addColorStop(1, '#ffffff00'); lc.fillStyle = gradient; lc.fillRect(0, 0, 128, 128); const lightTexture = new T.CanvasTexture(lightCanvas);
  for (let i = 0; i < 64; i++) {
    const z = -192 + i * 6; const x = i % 2 ? 6.5 : -6.5;
    const material = new T.MeshBasicMaterial({ map: lightTexture, color: i % 2 ? '#e845a9' : '#18cbe5', transparent: true, opacity: .22, depthWrite: false, blending: T.AdditiveBlending });
    const pool = new T.Mesh(new T.PlaneGeometry(5, 9), material); pool.rotation.x = -Math.PI / 2; pool.position.set(x, .022, z); scene.add(pool);
  }
  for (const s of [-1, 1]) { box(scene, [1.5, 2.2, 400], [s * 199, 1, 0], graphite); box(scene, [400, 2.2, 1.5], [0, 1, s * 199], graphite); }
  const marker = new T.Group(); marker.position.set(DESTINATION.x, .07, DESTINATION.z);
  const ring = new T.Mesh(new T.RingGeometry(4.7, 5, 64), new T.MeshBasicMaterial({ color: '#45ffcb', side: T.DoubleSide, transparent: true, opacity: .8 })); ring.rotation.x = -Math.PI / 2; marker.add(ring);
  const beam = new T.Mesh(new T.CylinderGeometry(5, 5, 8, 48, 1, true), new T.MeshBasicMaterial({ color: '#45ffcb', transparent: true, opacity: .055, side: T.DoubleSide, depthWrite: false })); beam.position.y = 4; marker.add(beam); scene.add(marker);
  const terminal = new T.Mesh(new T.PlaneGeometry(10, 2.5), sign('TRANSIT TERMINAL', '#64ffcf')); terminal.position.set(4, 7, -113); scene.add(terminal);
  for (const x of [-3, 11]) box(scene, [.22, 7, .22], [x, 3.5, -113], cyan);
  const route = new T.Group(); scene.add(route);
  for (let z = 14; z > -100; z -= 9) {
    const arrow = new T.Shape(); arrow.moveTo(-.5, 0); arrow.lineTo(0, -.8); arrow.lineTo(.5, 0); arrow.lineTo(.25, 0); arrow.lineTo(0, -.4); arrow.lineTo(-.25, 0); arrow.closePath();
    const mesh = new T.Mesh(new T.ShapeGeometry(arrow), new T.MeshBasicMaterial({ color: '#46ece6', transparent: true, opacity: .65, side: T.DoubleSide, depthWrite: false })); mesh.rotation.x = Math.PI / 2; mesh.position.set(4, .035, z); route.add(mesh);
  }
  const npcs: ReturnType<typeof person>[] = [];
  for (let i = 0; i < 18; i++) { const npc = person(i % 2 ? '#f067c1' : '#53e1dc'); npc.group.position.set(i % 2 ? 10.7 : -10.7, .95, -155 + i * 18); scene.add(npc.group); npcs.push(npc); }
  return { marker, route, npcs };
}
