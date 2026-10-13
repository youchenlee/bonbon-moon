// 地球表面每個點都計算「從這裡看，太陽被月亮遮住多少」，
// 所以本影、半影和日環蝕的影子都是算出來的，不是貼上去的圖案。
// 算法和 astro.ts 的 sunView 相同。

const worldVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const earthVertex = worldVertex;

export const earthFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunPos;
uniform float uSunRadius;
uniform vec3 uMoonPos;
uniform float uMoonRadius;
uniform float uShadowOn;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;

const float EARTH_PI = 3.141592653589793;

float circleOverlap(float r1, float r2, float d) {
  if (d >= r1 + r2) return 0.0;
  if (d <= abs(r1 - r2)) { float r = min(r1, r2); return EARTH_PI * r * r; }
  float a = r1 * r1 * acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0));
  float b = r2 * r2 * acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));
  float c = 0.5 * sqrt(max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return a + b - c;
}

float sunlightFraction(vec3 p) {
  vec3 toSun = uSunPos - p;
  vec3 toMoon = uMoonPos - p;
  float ls = length(toSun);
  float lm = length(toMoon);
  if (lm > ls || dot(toSun, toMoon) <= 0.0) return 1.0;
  float rs = asin(min(1.0, uSunRadius / ls));
  float rm = asin(min(1.0, uMoonRadius / lm));
  float sep = atan(length(cross(toSun, toMoon)), dot(toSun, toMoon));
  return 1.0 - min(1.0, circleOverlap(rs, rm, sep) / (EARTH_PI * rs * rs));
}

void main() {
  vec3 n = normalize(vNormal);
  float light = max(dot(n, normalize(uSunPos - vWorld)), 0.0);
  if (uShadowOn > 0.5) light *= sunlightFraction(vWorld);
  vec3 albedo = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(albedo * (light * 1.3 + 0.02), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const atmosphereVertex = worldVertex;

export const atmosphereFragment = /* glsl */ `
uniform vec3 uSunPos;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float rim = pow(1.0 - abs(dot(n, normalize(cameraPosition - vWorld))), 3.0);
  float day = smoothstep(-0.25, 0.6, dot(n, normalize(uSunPos - vWorld)));
  gl_FragColor = vec4(vec3(0.35, 0.62, 1.0) * rim * day * 1.4, 1.0);
}
`;
