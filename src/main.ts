import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {
  PHASES,
  SYNODIC_MONTH,
  lunarDayLabel,
  moonTimes,
  phaseInfo,
  sunView,
  type EclipseKind,
} from './astro';
import { phaseIcon } from './phaseIcon';
import { atmosphereFragment, atmosphereVertex, earthFragment, earthVertex } from './shaders';
import { makeCoronaTexture, makeEarthTexture, makeGlowTexture, makeMoonTexture } from './textures';

// 單位：地球半徑 = 1。距離經過縮小，但太陽與月亮的「視角大小」接近真實（約 0.5 度的比例）。
const SUN_DISTANCE = 400;
const SUN_RADIUS = 13.5;
const MOON_RADIUS = 0.27;
const PHASE_ORBIT = 8;
const PERIGEE = 7.6; // 月亮看起來比太陽大 → 日全蝕
const APOGEE = 9.6; // 月亮看起來比太陽小 → 日環蝕
const ECLIPSE_SWEEP = 0.3; // 日蝕動畫中，月亮在新月前後各走多少弧度
const ECLIPSE_SECONDS = 14; // 播放一次日蝕需要幾秒

// 主畫面看得到全部；小窗只看得到 layer 0 加上需要的圖層（輔助線、箭頭、影子範圍不會出現在小窗）
const LAYER = { glow: 1, sun: 2, stars: 3, corona: 4, guides: 5 } as const;

type Mode = 'phases' | 'eclipse';

const state = {
  mode: 'phases' as Mode,
  day: 3.5,
  playingPhases: true,
  speed: 1,
  eclipseT: -0.15,
  playingEclipse: false,
  moonDistance: PERIGEE,
  /** 台灣時間（小時）。月相預設晚上 8 點看月亮，日蝕預設中午 */
  hour: { phases: 20, eclipse: 12 } as Record<Mode, number>,
  moonOffset: 0,
};

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

// ---------- renderer / cameras ----------

const canvas = $<HTMLCanvasElement>('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const mainCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 5000);
mainCamera.layers.enable(LAYER.glow);
mainCamera.layers.enable(LAYER.sun);
mainCamera.layers.enable(LAYER.stars);
mainCamera.layers.enable(LAYER.guides);

const controls = new OrbitControls(mainCamera, canvas);
controls.enableDamping = true;
controls.minDistance = 2.5;
controls.maxDistance = 60;
controls.enablePan = false;

const insetCamera = new THREE.PerspectiveCamera(7, 1, 0.01, 5000);

// ---------- sun ----------

const sunPosition = new THREE.Vector3(SUN_DISTANCE, 0, 0);

const sun = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 48, 32),
  new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
);
sun.position.copy(sunPosition);
sun.layers.set(LAYER.sun);

const glow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }),
);
glow.scale.setScalar(SUN_RADIUS * 9);
glow.position.copy(sunPosition);
glow.layers.set(LAYER.glow);

const coronaMaterial = new THREE.SpriteMaterial({
  map: makeCoronaTexture(),
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  transparent: true,
  opacity: 0,
});
const corona = new THREE.Sprite(coronaMaterial);
corona.scale.setScalar(SUN_RADIUS * 6);
corona.position.copy(sunPosition);
corona.layers.set(LAYER.corona);

const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
sunLight.position.copy(sunPosition);
scene.add(sun, glow, corona, sunLight, new THREE.AmbientLight(0xffffff, 0.025));

// 黃色箭頭：太陽光的方向
const sunRays = new THREE.Group();
for (const z of [-6, -2, 2, 6]) {
  sunRays.add(
    new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(11, 0, z), 2.6, 0xffc44d, 0.7, 0.45),
  );
}
scene.add(sunRays);

// ---------- stars ----------

{
  const count = 4000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const direction = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    direction.randomDirection().multiplyScalar(2000);
    direction.toArray(positions, i * 3);
    const brightness = 0.35 + 0.65 * Math.random() ** 3;
    colors.set([brightness, brightness, brightness * (0.85 + 0.3 * Math.random())], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }),
  );
  stars.layers.set(LAYER.stars);
  scene.add(stars);
}

// ---------- earth ----------

const earthUniforms = {
  uMap: { value: makeEarthTexture() },
  uSunPos: { value: sunPosition },
  uSunRadius: { value: SUN_RADIUS },
  uMoonPos: { value: new THREE.Vector3() },
  uMoonRadius: { value: MOON_RADIUS },
  uShadowOn: { value: 0 },
};

// 北極朝太陽傾斜 23.4 度（夏至），台灣在北回歸線上，中午太陽剛好在頭頂
const TAIWAN_LAT = THREE.MathUtils.degToRad(23.5);
const earthTilt = new THREE.Group();
earthTilt.rotation.z = THREE.MathUtils.degToRad(-23.4);
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 160, 80),
  new THREE.ShaderMaterial({ uniforms: earthUniforms, vertexShader: earthVertex, fragmentShader: earthFragment }),
);
earthTilt.add(earth);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.035, 96, 48),
  new THREE.ShaderMaterial({
    uniforms: { uSunPos: { value: sunPosition } },
    vertexShader: atmosphereVertex,
    fragmentShader: atmosphereFragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }),
);
scene.add(earthTilt, atmosphere);

// 台灣（紅點）黏在地球上，跟著地球自轉。地球轉角由台灣時間決定：中午 12 點台灣正對太陽
const observer = new THREE.Mesh(
  new THREE.SphereGeometry(0.035, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
);
observer.position.set(Math.cos(TAIWAN_LAT), Math.sin(TAIWAN_LAT), 0).multiplyScalar(1.004);
{
  const label = document.createElement('canvas');
  label.width = 128;
  label.height = 64;
  const ctx = label.getContext('2d')!;
  ctx.font = 'bold 40px "PingFang TC", "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText('台灣', 64, 32);
  ctx.fillStyle = '#ff6b5e';
  ctx.fillText('台灣', 64, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(label), depthTest: false }));
  sprite.scale.set(0.5, 0.25, 1);
  sprite.position.set(0.25, 0.12, 0);
  sprite.layers.set(LAYER.guides);
  observer.add(sprite);
}
earth.add(observer);
const taiwan = new THREE.Vector3();
const zenith = new THREE.Vector3();

/** 依台灣時間轉動地球，更新台灣的世界座標與天頂方向 */
function placeTaiwan(hour: number) {
  earth.rotation.y = ((hour - 12) / 24) * Math.PI * 2;
  earth.updateWorldMatrix(true, true);
  observer.getWorldPosition(taiwan);
  zenith.copy(taiwan).normalize();
}

/** 從台灣看某個位置的仰角（度），負的代表在地平線下 */
function altitude(target: THREE.Vector3): number {
  const dir = target.clone().sub(taiwan).normalize();
  return THREE.MathUtils.radToDeg(Math.asin(dir.dot(zenith)));
}

// ---------- moon ----------

const moonTexture = makeMoonTexture();
const moonMaterial = new THREE.MeshStandardMaterial({
  map: moonTexture,
  bumpMap: moonTexture,
  bumpScale: 1.5,
  roughness: 1,
  metalness: 0,
});
// 白天的天空在月亮前方散射，所以日蝕小窗裡的月亮會和天空同色，只有擋住太陽的部分看得出來
const moonSilhouette = new THREE.MeshBasicMaterial({ color: 0x000000 });
const moon = new THREE.Mesh<THREE.SphereGeometry, THREE.Material>(
  new THREE.SphereGeometry(MOON_RADIUS, 96, 64),
  moonMaterial,
);
scene.add(moon);

const orbit = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 256 }, (_, i) => {
      const a = (i / 256) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    }),
  ),
  new THREE.LineBasicMaterial({ color: 0x8fa3c8, transparent: true, opacity: 0.35 }),
);
scene.add(orbit);

/** 月亮以逆時針（從北方往下看）公轉；angle = 0 時在地球與太陽之間（新月）。潮汐鎖定，正面一直朝向地球。 */
function placeMoon(angle: number, distance: number, height: number) {
  moon.position.set(distance * Math.cos(angle), height, -distance * Math.sin(angle));
  moon.rotation.y = angle + Math.PI;
  orbit.scale.setScalar(distance);
  orbit.position.y = height;
  earthUniforms.uMoonPos.value.copy(moon.position);
}

// ---------- moon shadow cones ----------

const shadowMaterial = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

const shadowCones = {
  penumbra: new THREE.Mesh(new THREE.BufferGeometry(), shadowMaterial(0xffa53d, 0.12)),
  umbra: new THREE.Mesh(new THREE.BufferGeometry(), shadowMaterial(0xff4b3e, 0.4)),
  antumbra: new THREE.Mesh(new THREE.BufferGeometry(), shadowMaterial(0x5aa9ff, 0.3)),
};
const shadowGroup = new THREE.Group();
shadowGroup.add(shadowCones.penumbra, shadowCones.umbra, shadowCones.antumbra);
scene.add(shadowGroup);
for (const guide of [sunRays, orbit, shadowGroup]) guide.traverse((o) => o.layers.set(LAYER.guides));

const yAxis = new THREE.Vector3(0, 1, 0);

/** 從 start 沿著 direction 畫一段截頭圓錐；起點半徑 startRadius，終點半徑 endRadius */
function setCone(mesh: THREE.Mesh, start: THREE.Vector3, direction: THREE.Vector3, length: number, startRadius: number, endRadius: number) {
  mesh.visible = length > 0;
  if (!mesh.visible) return;
  mesh.geometry.dispose();
  mesh.geometry = new THREE.CylinderGeometry(startRadius, endRadius, length, 48, 1, true);
  mesh.position.copy(start).addScaledVector(direction, length / 2);
  mesh.quaternion.setFromUnitVectors(yAxis, direction.clone().negate());
}

function updateShadowCones() {
  const direction = moon.position.clone().sub(sunPosition);
  const sunToMoon = direction.length();
  direction.normalize();
  const reach = moon.position.length() + 1.6; // 畫到地球後方一點
  const umbraLength = (sunToMoon * MOON_RADIUS) / (SUN_RADIUS - MOON_RADIUS);
  const penumbraSlope = (SUN_RADIUS + MOON_RADIUS) / sunToMoon;
  const umbraSlope = MOON_RADIUS / umbraLength;

  setCone(shadowCones.penumbra, moon.position, direction, reach, MOON_RADIUS, MOON_RADIUS + reach * penumbraSlope);
  setCone(shadowCones.umbra, moon.position, direction, Math.min(umbraLength, reach), MOON_RADIUS, Math.max(0, MOON_RADIUS - reach * umbraSlope));
  const apex = moon.position.clone().addScaledVector(direction, umbraLength);
  const antumbraLength = reach - umbraLength;
  setCone(shadowCones.antumbra, apex, direction, antumbraLength, 0, antumbraLength * umbraSlope);
}

// ---------- HUD ----------

const insetEl = $('#inset');
const insetTitle = $('#inset-title');
const daySlider = $<HTMLInputElement>('#day');
const speedSlider = $<HTMLInputElement>('#speed');
const playPhases = $<HTMLButtonElement>('#play-phases');
const eclipseSlider = $<HTMLInputElement>('#eclipse-t');
const playEclipse = $<HTMLButtonElement>('#play-eclipse');
const hourSliders = {
  phases: $<HTMLInputElement>('#hour-phases'),
  eclipse: $<HTMLInputElement>('#hour-eclipse'),
};
const offsetSlider = $<HTMLInputElement>('#moon-offset');
const showShadow = $<HTMLInputElement>('#show-shadow');
const phaseStrip = $('#phase-strip');

/** 值沒變就不碰 DOM，避免每一格動畫都重排版面 */
function setText(selector: string, text: string) {
  const el = $(selector);
  if (el.textContent !== text) el.textContent = text;
}

const phaseButtons = PHASES.map((phase, i) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = `${phaseIcon((i / 8) * Math.PI * 2)}<span>${phase.name}</span>`;
  button.title = `${phase.name} ${phase.english}`;
  button.addEventListener('click', () => {
    state.day = (i / 8) * SYNODIC_MONTH;
    setPlaying('phases', false);
  });
  phaseStrip.append(button);
  return button;
});

function updatePhaseHud() {
  const info = phaseInfo(state.day);
  const phase = PHASES[info.index];
  const times = moonTimes(state.day);
  setText('#lunar-day', `農曆約${lunarDayLabel(info.lunarDay)}`);
  setText('#phase-name', phase.name);
  setText('#phase-en', phase.english);
  setText('#phase-note', phase.note);
  setText('#illum', `${Math.round(info.illumination * 100)}%`);
  setText('#rise', times.rise);
  setText('#transit', times.transit);
  setText('#set', times.set);
  setText('#day-label', state.day.toFixed(1));
  if (document.activeElement !== daySlider) daySlider.value = String(state.day);
  phaseButtons.forEach((button, i) => button.classList.toggle('active', i === info.index));
}

const ECLIPSE_TEXT: Record<EclipseKind, { title: string; note: string }> = {
  none: { title: '看不到日蝕', note: '月亮沒有擋到太陽。從這個位置看，太陽是完整的。' },
  partial: { title: '日偏蝕', note: '站在月亮的半影裡，太陽被咬掉一塊。' },
  total: { title: '日全蝕', note: '站在月亮的本影裡！太陽整個被遮住，天空變暗，看得到太陽外圍的日冕。' },
  annular: { title: '日環蝕', note: '月亮離地球比較遠，看起來比太陽小一點，太陽剩下一圈亮亮的「金環」。' },
};

function updateEclipseHud(kind: EclipseKind, coverage: number, sunAltitude: number) {
  const text =
    sunAltitude < 0
      ? { title: '太陽已下山', note: '這個時間台灣看不到太陽，當然也看不到日蝕。把時間調回白天看看。' }
      : ECLIPSE_TEXT[kind];
  setText('#eclipse-kind', text.title);
  setText('#eclipse-note', text.note);
  setText('#eclipse-coverage', `太陽被遮住 ${Math.round(coverage * 100)}%・太陽仰角 ${Math.round(sunAltitude)}°`);
  if (document.activeElement !== eclipseSlider) eclipseSlider.value = String(state.eclipseT);
}

function setPlaying(mode: Mode, playing: boolean) {
  if (mode === 'phases') {
    state.playingPhases = playing;
    playPhases.textContent = playing ? '⏸ 暫停' : '▶ 播放';
  } else {
    state.playingEclipse = playing;
    playEclipse.textContent = playing ? '⏸ 暫停' : '▶ 播放';
  }
}

function setMode(mode: Mode) {
  state.mode = mode;
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  $('#panel-phases').hidden = mode !== 'phases';
  $('#panel-eclipse').hidden = mode !== 'eclipse';
  phaseStrip.hidden = mode !== 'phases';
  insetTitle.textContent = mode === 'phases' ? '從台灣看月亮' : '從台灣看太陽';
  earthUniforms.uShadowOn.value = mode === 'eclipse' ? 1 : 0;
  shadowGroup.visible = mode === 'eclipse' && showShadow.checked;
  sunRays.visible = mode === 'phases';
  const [position, target] =
    mode === 'phases'
      ? [new THREE.Vector3(0, 11, 12.5), new THREE.Vector3(0, 0, 0)]
      : [new THREE.Vector3(7.5, 1.8, 9.5), new THREE.Vector3(3.6, 0.2, 0)];
  const visibleAspect = fitViewToPanel();
  // 直式小螢幕看得到的範圍比較窄，鏡頭往後退才放得下整個軌道
  const zoomOut = visibleAspect < 1 ? THREE.MathUtils.clamp(1.7 / visibleAspect, 1, 2.4) : 1;
  mainCamera.position.copy(position.sub(target).multiplyScalar(zoomOut).add(target));
  controls.target.copy(target);
  controls.update();
}

/**
 * 讓 3D 畫面的中心落在沒被說明面板蓋住的區域：
 * 桌機面板在左邊，畫面往右移；手機面板在下方，畫面往上移。
 * 回傳沒被蓋住區域的寬高比。
 */
function fitViewToPanel(): number {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const panel = $(state.mode === 'phases' ? '#panel-phases' : '#panel-eclipse').getBoundingClientRect();
  const bottomSheet = panel.width >= width * 0.9;
  const offsetX = bottomSheet ? 0 : -panel.right / 2;
  const offsetY = bottomSheet ? (height - panel.top) / 2 : 0;
  mainCamera.aspect = width / height;
  mainCamera.setViewOffset(width, height, offsetX, offsetY, width, height);
  return bottomSheet ? width / panel.top : (width - panel.right) / height;
}

document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode as Mode));
});
daySlider.addEventListener('input', () => {
  state.day = Number(daySlider.value);
  setPlaying('phases', false);
});
speedSlider.addEventListener('input', () => {
  state.speed = Number(speedSlider.value);
});
playPhases.addEventListener('click', () => setPlaying('phases', !state.playingPhases));
eclipseSlider.addEventListener('input', () => {
  state.eclipseT = Number(eclipseSlider.value);
  setPlaying('eclipse', false);
});
playEclipse.addEventListener('click', () => setPlaying('eclipse', !state.playingEclipse));
document.querySelectorAll<HTMLInputElement>('input[name="distance"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    state.moonDistance = radio.value === 'far' ? APOGEE : PERIGEE;
  });
});
for (const mode of ['phases', 'eclipse'] as const) {
  const slider = hourSliders[mode];
  slider.value = String(state.hour[mode]);
  const label = () => setText(`#hour-${mode}-label`, `${String(state.hour[mode]).padStart(2, '0')}:00`);
  label();
  slider.addEventListener('input', () => {
    state.hour[mode] = Number(slider.value);
    label();
  });
}
offsetSlider.addEventListener('input', () => {
  state.moonOffset = Number(offsetSlider.value);
  const offset = state.moonOffset;
  setText('#offset-label', offset === 0 ? '剛好對齊' : `偏${offset > 0 ? '上' : '下'} ${Math.abs(offset).toFixed(2)}`);
});
showShadow.addEventListener('change', () => {
  shadowGroup.visible = state.mode === 'eclipse' && showShadow.checked;
});

// ---------- per-frame updates ----------

const nightSky = new THREE.Color(0x02040b);
const daySky = new THREE.Color(0x5b9bd8);
const skyColor = new THREE.Color();

function updatePhases(dt: number) {
  if (state.playingPhases) state.day = (state.day + dt * state.speed) % SYNODIC_MONTH;
  placeMoon(phaseInfo(state.day).angle, PHASE_ORBIT, 0);
  placeTaiwan(state.hour.phases);
  const moonAltitude = altitude(moon.position);
  const sunAltitude = altitude(sunPosition);
  skyColor.copy(nightSky).lerp(daySky, THREE.MathUtils.smoothstep(sunAltitude, -8, 10));
  updatePhaseHud();
  setText(
    '#moon-alt',
    moonAltitude < 0
      ? `月亮在地平線下，台灣這時看不到`
      : `月亮仰角 ${Math.round(moonAltitude)}°${sunAltitude > 0 ? '（白天，天空是亮的）' : ''}`,
  );
  setText('#inset-note', moonAltitude < 0 ? '月亮在地平線下' : '');
}

function updateEclipse(dt: number) {
  if (state.playingEclipse) {
    state.eclipseT += (dt * 2) / ECLIPSE_SECONDS;
    if (state.eclipseT > 1) state.eclipseT = -1;
  }
  placeMoon(state.eclipseT * ECLIPSE_SWEEP, state.moonDistance, state.moonOffset);
  placeTaiwan(state.hour.eclipse);
  if (shadowGroup.visible) updateShadowCones();

  const sunAltitude = altitude(sunPosition);
  const view =
    sunAltitude < 0 ? { coverage: 0, kind: 'none' as const } : sunView(taiwan, sunPosition, SUN_RADIUS, moon.position, MOON_RADIUS);
  coronaMaterial.opacity = THREE.MathUtils.smoothstep(view.coverage, 0.97, 1);
  const daylight = THREE.MathUtils.smoothstep(sunAltitude, -8, 10);
  skyColor.copy(nightSky).lerp(daySky, daylight * Math.pow(1 - view.coverage, 0.35));
  updateEclipseHud(view.kind, view.coverage, sunAltitude);
  setText('#inset-note', sunAltitude < 0 ? '太陽在地平線下' : '');
  return view.coverage;
}

function renderInset(coverage: number) {
  const rect = insetEl.getBoundingClientRect();
  if (rect.width === 0) return;
  const x = rect.left;
  const y = window.innerHeight - rect.bottom;
  renderer.setViewport(x, y, rect.width, rect.height);
  renderer.setScissor(x, y, rect.width, rect.height);
  renderer.setScissorTest(true);
  insetCamera.aspect = rect.width / rect.height;
  insetCamera.layers.set(0);
  // 鏡頭放在台灣，頭頂方向朝上，所以小窗裡月亮亮面的傾斜就是台灣看到的樣子
  insetCamera.position.copy(taiwan);
  insetCamera.up.copy(zenith);
  earth.visible = false;
  atmosphere.visible = false;
  scene.background = skyColor;

  if (state.mode === 'phases') {
    insetCamera.fov = 6.5;
    if (skyColor.getHSL({ h: 0, s: 0, l: 0 }).l < 0.2) insetCamera.layers.enable(LAYER.stars);
    insetCamera.lookAt(moon.position);
    insetCamera.updateProjectionMatrix();
    renderer.render(scene, insetCamera);
  } else {
    insetCamera.fov = 10;
    insetCamera.layers.enable(LAYER.sun);
    insetCamera.layers.enable(LAYER.corona);
    if (coverage > 0.995) insetCamera.layers.enable(LAYER.stars);
    insetCamera.lookAt(sunPosition);
    insetCamera.updateProjectionMatrix();
    moonSilhouette.color.copy(skyColor);
    moon.material = moonSilhouette;
    renderer.render(scene, insetCamera);
    moon.material = moonMaterial;
  }
  earth.visible = true;
  atmosphere.visible = true;
  scene.background = null;
  renderer.setScissorTest(false);
}

const timer = new THREE.Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  // 小窗只畫地平線上的天空；台灣看不到的東西用文字提示
  let coverage = 0;
  if (state.mode === 'phases') updatePhases(dt);
  else coverage = updateEclipse(dt);

  controls.update();
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, mainCamera);
  renderInset(coverage);
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitViewToPanel();
});

setMode('phases');
