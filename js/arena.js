// The arena: a square floor within ±20 m with an answer zone in each corner (A/B/C/D),
// and spectator stands in front of it (z > 30), split into A/B/C/D sections.
window.FF = window.FF || {};

(function () {
  const HALF = 20; // the arena floor is x, z in [-20, 20]
  const CORNER_MIN = 7; // a corner zone is |x| >= 7 and |z| >= 7
  const STANDS_MIN_Z = 31; // the stands floor is z in [31, 39]
  const STANDS_MAX_Z = 39;
  const OUT_Z = 28; // anyone past this is in the stands
  const LETTERS = ['A', 'B', 'C', 'D'];
  const COLORS = ['#ff4d6d', '#ffb703', '#06d6a0', '#4cc9f0'];
  // A top-left, B top-right, C bottom-left, D bottom-right (as seen from the camera).
  const CORNER_SIGNS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  /** Which answer a spot is: 0-3 for a corner (or a stands section), -1 for none. */
  function zoneOf(x, z) {
    if (z > OUT_Z) return Math.max(0, Math.min(3, Math.floor((x + HALF) / 10)));
    if (Math.abs(x) < CORNER_MIN || Math.abs(z) < CORNER_MIN) return -1;
    return z < 0 ? (x < 0 ? 0 : 1) : (x < 0 ? 2 : 3);
  }

  function inStands(z) {
    return z > OUT_Z;
  }

  /** The middle of corner i's zone. */
  function cornerCenter(i) {
    const [sx, sz] = CORNER_SIGNS[i];
    const mid = (CORNER_MIN + HALF) / 2;
    return { x: sx * mid, z: sz * mid };
  }

  /** A random spot inside corner i, away from its edges. */
  function spotInCorner(i, rand) {
    const [sx, sz] = CORNER_SIGNS[i];
    return { x: sx * (CORNER_MIN + 2 + rand() * (HALF - CORNER_MIN - 3.5)), z: sz * (CORNER_MIN + 2 + rand() * (HALF - CORNER_MIN - 3.5)) };
  }

  /** A random spot in stands section i (or anywhere in the stands when i < 0). */
  function spotInStands(i, rand) {
    const left = i < 0 ? -HALF + 1 : -HALF + i * 10 + 1.5;
    const width = i < 0 ? 2 * HALF - 2 : 7;
    return { x: left + rand() * width, z: STANDS_MIN_Z + 1 + rand() * (STANDS_MAX_Z - STANDS_MIN_Z - 2) };
  }

  /** Keeps a spot on the arena floor, or in the stands for players who are out. */
  function clamp(p, out) {
    p.x = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, p.x));
    if (out) p.z = Math.max(STANDS_MIN_Z, Math.min(STANDS_MAX_Z, p.z));
    else p.z = Math.max(-HALF + 0.5, Math.min(HALF - 0.5, p.z));
  }

  function textTexture(draw, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  function flat(geometry, material, x, y, z) {
    const out = new THREE.Mesh(geometry, material);
    out.rotation.x = -Math.PI / 2;
    out.position.set(x, y, z);
    return out;
  }

  function build() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2a0f45');
    scene.fog = new THREE.Fog('#2a0f45', 70, 140);
    scene.add(new THREE.HemisphereLight('#ffe0f0', '#3a1d5c', 1.6));
    const sun = new THREE.DirectionalLight('#ffd9a8', 1.6);
    sun.position.set(-18, 40, 22);
    scene.add(sun);

    const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    // Ground around everything, then the arena floor with a checker of party tiles.
    scene.add(flat(new THREE.PlaneGeometry(240, 240), lambert('#1d0d33'), 0, -0.02, 10));
    const floorTex = textTexture((ctx, w, h) => {
      const n = 10;
      const s = w / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#3b1f63' : '#33195a';
          ctx.fillRect(i * s, j * s, s, s);
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s, 0);
        ctx.lineTo(i * s, h);
        ctx.moveTo(0, i * s);
        ctx.lineTo(w, i * s);
        ctx.stroke();
      }
      // Middle circle: where everyone gathers.
      ctx.strokeStyle = 'rgba(216,253,113,0.55)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.13, 0, Math.PI * 2);
      ctx.stroke();
    }, 1024, 1024);
    scene.add(flat(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), new THREE.MeshLambertMaterial({ map: floorTex }), 0, 0, 0));

    // Edge of the arena.
    const edgeMat = lambert('#d8fd71');
    for (const [x, z, w, d] of [[0, -HALF - 0.3, 2 * HALF + 1.2, 0.6], [0, HALF + 0.3, 2 * HALF + 1.2, 0.6], [-HALF - 0.3, 0, 0.6, 2 * HALF], [HALF + 0.3, 0, 0.6, 2 * HALF]]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, d), edgeMat);
      edge.position.set(x, 0.17, z);
      scene.add(edge);
    }

    // Corner pads with big letters. Their look changes with the round (see setPads).
    const padSize = HALF - CORNER_MIN;
    const pads = CORNER_SIGNS.map(([sx, sz], i) => {
      const c = cornerCenter(i);
      const material = new THREE.MeshBasicMaterial({ color: COLORS[i], transparent: true, opacity: 0.5, depthWrite: false });
      const pad = flat(new THREE.PlaneGeometry(padSize, padSize), material, c.x, 0.03, c.z);
      scene.add(pad);
      const letterTex = textTexture((ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 210px "Arial Black", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 16;
        ctx.fillText(LETTERS[i], w / 2, h / 2 + 12);
      }, 256, 256);
      const letter = flat(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: letterTex, transparent: true, depthWrite: false }), c.x + sx * 2.5, 0.05, c.z + sz * 2.5);
      scene.add(letter);
      // Glowing border.
      const ring = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(padSize, 0.01, padSize)),
        new THREE.LineBasicMaterial({ color: COLORS[i] }),
      );
      ring.position.set(c.x, 0.06, c.z);
      scene.add(ring);
      return { material, letter, ring, base: new THREE.Color(COLORS[i]) };
    });

    // The stands: a terrace with A/B/C/D sections, benches behind.
    for (let i = 0; i < 4; i++) {
      const tile = flat(new THREE.PlaneGeometry(10, STANDS_MAX_Z - STANDS_MIN_Z + 2), new THREE.MeshLambertMaterial({ color: new THREE.Color(COLORS[i]).multiplyScalar(0.45) }), -HALF + 5 + i * 10, 0.01, (STANDS_MIN_Z + STANDS_MAX_Z) / 2);
      scene.add(tile);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textTexture((ctx, w, h) => {
          ctx.fillStyle = COLORS[i];
          ctx.beginPath();
          ctx.roundRect(0, 0, w, h, 24);
          ctx.fill();
          ctx.fillStyle = '#14102a';
          ctx.font = '900 80px "Arial Black", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(LETTERS[i], w / 2, h / 2 + 4);
        }, 128, 112),
      }));
      sign.scale.set(2.2, 1.9, 1);
      sign.position.set(-HALF + 5 + i * 10, 1.4, STANDS_MAX_Z + 3.2);
      scene.add(sign);
    }
    const benchMat = lambert('#5a2d82');
    for (let row = 0; row < 3; row++) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF + 2, 0.6 + row * 0.6, 1.4), benchMat);
      bench.position.set(0, (0.6 + row * 0.6) / 2, STANDS_MAX_Z + 1.6 + row * 1.4);
      scene.add(bench);
    }
    // A rope between the arena and the stands.
    const rope = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF + 2, 0.12, 0.12), lambert('#ffb703'));
    rope.position.set(0, 0.9, 29.6);
    scene.add(rope);
    for (let x = -HALF - 1; x <= HALF + 1; x += 6.25) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1, 6), lambert('#f5f5f5'));
      post.position.set(x, 0.5, 29.6);
      scene.add(post);
    }

    // Bunting on poles around the back and sides.
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.35, 0, 0, 0.35, 0, 0, 0, -0.7, 0], 3));
    flagGeo.computeVertexNormals();
    const flagMats = COLORS.concat('#a55eea', '#ffffff').map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    const poleMat = lambert('#e9e3ff');
    const line = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 1.1);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const sag = Math.sin(t * Math.PI) * 1.2;
        const flag = new THREE.Mesh(flagGeo, flagMats[k % flagMats.length]);
        flag.position.set(ax + (bx - ax) * t, 6 - sag, az + (bz - az) * t);
        flag.rotation.y = Math.atan2(-(bz - az), bx - ax);
        scene.add(flag);
      }
    };
    const poles = [[-22, -22], [-7, -22], [7, -22], [22, -22], [-22, -4], [-22, 14], [22, -4], [22, 14]];
    for (const [x, z] of poles) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 6.4, 6), poleMat);
      pole.position.set(x, 3.2, z);
      scene.add(pole);
    }
    line(-22, -22, -7, -22);
    line(-7, -22, 7, -22);
    line(7, -22, 22, -22);
    line(-22, -22, -22, -4);
    line(-22, -4, -22, 14);
    line(22, -22, 22, -4);
    line(22, -4, 22, 14);

    // DJ stage and banner at the back.
    const stage = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 5), lambert('#14102a'));
    stage.position.set(0, 0.6, -26);
    scene.add(stage);
    for (const x of [-6.5, 6.5]) {
      const speaker = new THREE.Mesh(new THREE.BoxGeometry(2, 3.2, 1.6), lambert('#0b0816'));
      speaker.position.set(x, 2.8, -26);
      scene.add(speaker);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), new THREE.MeshBasicMaterial({ color: '#d8fd71' }));
      cone.position.set(x, 2.6, -25.19);
      scene.add(cone);
    }
    const bannerTex = textTexture((ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#ff4d6d');
      grad.addColorStop(0.5, '#ffb703');
      grad.addColorStop(1, '#06d6a0');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 30);
      ctx.fill();
      ctx.fillStyle = '#14102a';
      ctx.font = '900 120px "Arial Black", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FOLLOW FOLLOW', w / 2, h / 2 + 6);
    }, 1024, 180);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.45), new THREE.MeshBasicMaterial({ map: bannerTex }));
    banner.position.set(0, 4.3, -25.15);
    scene.add(banner);

    // Palm trees around the edges.
    const trunkMat = lambert('#8a5a2b');
    const leafMat = lambert('#1fa365');
    const palm = (x, z, h) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, h, 6), trunkMat);
      trunk.position.set(x, h / 2, z);
      scene.add(trunk);
      for (let k = 0; k < 6; k++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.2, 4), leafMat);
        const a = (k / 6) * Math.PI * 2;
        leaf.position.set(x + Math.cos(a) * 1.2, h - 0.2, z + Math.sin(a) * 1.2);
        leaf.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
        scene.add(leaf);
      }
    };
    for (const [x, z, h] of [[-30, -28, 9], [30, -28, 9], [-33, -4, 7.5], [33, -4, 7.5], [-31, 20, 8], [31, 20, 8], [-28, 44, 7], [28, 44, 7]]) palm(x, z, h);

    // Disco lights above the corners.
    const lights = COLORS.map((c, i) => {
      const p = cornerCenter(i);
      const light = new THREE.PointLight(c, 0, 26, 1.6);
      light.position.set(p.x, 7, p.z);
      scene.add(light);
      return light;
    });

    let states = ['idle', 'idle', 'idle', 'idle'];

    /** states[i]: 'idle', 'live' (answers open), 'win', 'lose'. */
    function setPads(next) {
      states = next.slice();
    }

    function tick(time) {
      states.forEach((state, i) => {
        const pad = pads[i];
        const pulse = 0.5 + 0.5 * Math.sin(time * 6 + i);
        if (state === 'win') {
          pad.material.color.copy(pad.base).lerp(new THREE.Color('#ffffff'), 0.25 * pulse);
          pad.material.opacity = 0.75 + 0.2 * pulse;
          lights[i].intensity = 18 + 12 * pulse;
          pad.ring.material.color.set('#ffffff');
        } else if (state === 'lose') {
          pad.material.color.set('#2b2340');
          pad.material.opacity = 0.7;
          lights[i].intensity = 0;
          pad.ring.material.color.set('#4a3f66');
        } else if (state === 'live') {
          pad.material.color.copy(pad.base);
          pad.material.opacity = 0.5 + 0.12 * pulse;
          lights[i].intensity = 6 + 4 * pulse;
          pad.ring.material.color.copy(pad.base);
        } else {
          pad.material.color.copy(pad.base);
          pad.material.opacity = 0.32;
          lights[i].intensity = 0;
          pad.ring.material.color.copy(pad.base);
        }
      });
    }

    return { scene, setPads, tick };
  }

  FF.arena = {
    HALF,
    CORNER_MIN,
    OUT_Z,
    STANDS_MIN_Z,
    STANDS_MAX_Z,
    LETTERS,
    COLORS,
    zoneOf,
    inStands,
    cornerCenter,
    spotInCorner,
    spotInStands,
    clamp,
    build,
  };
})();
