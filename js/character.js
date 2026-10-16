// A low-poly start.ng character, drawn from the player's start.ng `style`:
// body, colours, skin, hair + hairColor, hat and accessory. Faces +z; rotate with ry.
window.FF = window.FF || {};

(function () {
  const HAIRS = ['short', 'afro', 'braids', 'bun', 'ponytail', 'dreads', 'bald'];
  const HATS = ['none', 'cap', 'beanie', 'tophat', 'crown'];
  const ACCESSORIES = ['none', 'glasses', 'earrings', 'beard', 'scarf', 'backpack'];
  const HEX = /^#[0-9a-f]{6}$/i;

  /** A complete style, falling back to something sensible for missing or unknown values. */
  function normalizeStyle(style) {
    const s = style || {};
    const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    const color = (value, fallback) => (HEX.test(value || '') ? value : fallback);
    return {
      body: s.body === 'female' ? 'female' : 'male',
      primaryColor: color(s.primaryColor, '#d8fd71'),
      secondaryColor: color(s.secondaryColor, '#292a23'),
      skinColor: color(s.skinColor, '#a0662f'),
      hairColor: color(s.hairColor, '#17120f'),
      hair: pick(s.hair, HAIRS, 'short'),
      hat: pick(s.hat, HATS, 'none'),
      accessory: pick(s.accessory, ACCESSORIES, 'none'),
    };
  }

  /** A random style, for bots. rand is a () => [0,1) function. */
  function randomStyle(rand) {
    const any = (list) => list[Math.floor(rand() * list.length)];
    const brights = ['#ff4d6d', '#ffb703', '#06d6a0', '#118ab2', '#a55eea', '#ff7f11', '#e63946', '#2ec4b6', '#f72585', '#d8fd71'];
    const darks = ['#292a23', '#1d3557', '#0c6e5a', '#5e3023', '#3a0ca3', '#6c757d', '#14213d'];
    const skins = ['#8d5524', '#a0662f', '#c68642', '#6b3e1e', '#4a2a12', '#e0ac69'];
    const hairs = ['#17120f', '#2b1b10', '#4a3020', '#0d0d0d', '#7a4b2a', '#c43c9b'];
    return {
      body: rand() < 0.5 ? 'female' : 'male',
      primaryColor: any(brights),
      secondaryColor: any(darks),
      skinColor: any(skins),
      hairColor: any(hairs),
      hair: any(HAIRS),
      hat: rand() < 0.55 ? 'none' : any(HATS.slice(1)),
      accessory: rand() < 0.4 ? 'none' : any(ACCESSORIES.slice(1)),
    };
  }

  // Shared geometries and materials keep 50 characters cheap on phones.
  const geo = {};
  function g(key, make) {
    return (geo[key] ??= make());
  }
  const mats = new Map();
  function m(color) {
    if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return mats.get(color);
  }
  function mesh(geometry, color, x = 0, y = 0, z = 0) {
    const out = new THREE.Mesh(geometry, m(color));
    out.position.set(x, y, z);
    return out;
  }
  function darken(hex, amount) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(1 - amount);
    return `#${c.getHexString()}`;
  }

  const HEAD_Y = 1.6;
  const SCALE = 1.9;

  function addHair(head, s) {
    const c = s.hairColor;
    const cap = () => {
      const out = mesh(g('hairCap', () => new THREE.SphereGeometry(0.215, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55)), c);
      out.position.set(0, 0.015, -0.015);
      return out;
    };
    const strand = (x, z, len, tilt) => {
      const out = mesh(g(`strand${len}`, () => new THREE.CylinderGeometry(0.035, 0.03, len, 5)), c);
      out.position.set(x, -len / 2 + 0.05, z);
      out.rotation.x = tilt;
      return out;
    };
    switch (s.hair) {
      case 'bald':
        return;
      case 'afro': {
        const afro = mesh(g('afro', () => new THREE.DodecahedronGeometry(0.31, 1)), c, 0, 0.09, -0.04);
        head.add(afro);
        return;
      }
      case 'bun':
        head.add(cap(), mesh(g('bun', () => new THREE.IcosahedronGeometry(0.11, 0)), c, 0, 0.22, -0.1));
        return;
      case 'ponytail': {
        const tail = mesh(g('tail', () => new THREE.ConeGeometry(0.07, 0.42, 6)), c, 0, -0.08, -0.25);
        tail.rotation.x = Math.PI - 0.35;
        head.add(cap(), tail);
        return;
      }
      case 'braids':
        head.add(cap());
        for (let i = 0; i < 7; i++) {
          const a = Math.PI * (0.15 + (0.7 * i) / 6) + Math.PI / 2; // around the back and sides
          head.add(strand(Math.cos(a) * 0.17, -Math.abs(Math.sin(a)) * 0.17, 0.5, -0.12));
        }
        return;
      case 'dreads':
        head.add(cap());
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI * 2 * i) / 10;
          if (Math.sin(a) > 0.55) continue; // keep the face clear
          head.add(strand(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0.36, Math.sin(a) * -0.25));
        }
        return;
      default:
        head.add(cap());
    }
  }

  function addHat(head, s) {
    switch (s.hat) {
      case 'cap': {
        head.add(mesh(g('capTop', () => new THREE.SphereGeometry(0.225, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5)), s.primaryColor, 0, 0.04, 0));
        head.add(mesh(g('capBrim', () => new THREE.BoxGeometry(0.3, 0.03, 0.2)), darken(s.primaryColor, 0.25), 0, 0.06, 0.22));
        return;
      }
      case 'beanie':
        head.add(mesh(g('beanie', () => new THREE.SphereGeometry(0.235, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52)), s.secondaryColor, 0, 0.03, 0));
        head.add(mesh(g('pom', () => new THREE.IcosahedronGeometry(0.06, 0)), s.primaryColor, 0, 0.27, 0));
        return;
      case 'tophat':
        head.add(mesh(g('topBrim', () => new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12)), '#1d1d1d', 0, 0.15, 0));
        head.add(mesh(g('topCrown', () => new THREE.CylinderGeometry(0.18, 0.19, 0.32, 12)), '#1d1d1d', 0, 0.31, 0));
        head.add(mesh(g('topBand', () => new THREE.CylinderGeometry(0.192, 0.192, 0.05, 12)), s.primaryColor, 0, 0.18, 0));
        return;
      case 'crown': {
        head.add(mesh(g('crownRing', () => new THREE.CylinderGeometry(0.2, 0.19, 0.1, 10, 1, true)), '#f5c542', 0, 0.2, 0));
        for (let i = 0; i < 5; i++) {
          const a = (Math.PI * 2 * i) / 5;
          head.add(mesh(g('crownSpike', () => new THREE.ConeGeometry(0.05, 0.12, 4)), '#f5c542', Math.sin(a) * 0.18, 0.3, Math.cos(a) * 0.18));
        }
        return;
      }
      default:
    }
  }

  function addAccessory(root, head, s) {
    switch (s.accessory) {
      case 'glasses': {
        const lens = g('lens', () => new THREE.BoxGeometry(0.11, 0.07, 0.03));
        head.add(mesh(lens, '#111111', -0.08, 0.02, 0.19), mesh(lens, '#111111', 0.08, 0.02, 0.19));
        head.add(mesh(g('bridge', () => new THREE.BoxGeometry(0.06, 0.02, 0.02)), '#111111', 0, 0.03, 0.2));
        return;
      }
      case 'earrings': {
        const ring = g('earring', () => new THREE.OctahedronGeometry(0.035, 0));
        head.add(mesh(ring, '#f5c542', -0.2, -0.07, 0), mesh(ring, '#f5c542', 0.2, -0.07, 0));
        return;
      }
      case 'beard':
        head.add(mesh(g('beard', () => new THREE.BoxGeometry(0.28, 0.16, 0.14)), s.hairColor, 0, -0.13, 0.11));
        return;
      case 'scarf': {
        const color = s.secondaryColor === s.primaryColor ? '#ffffff' : s.secondaryColor;
        const scarf = mesh(g('scarf', () => new THREE.TorusGeometry(0.15, 0.06, 5, 10)), color, 0, 1.4, 0.01);
        scarf.rotation.x = Math.PI / 2;
        root.add(scarf, mesh(g('scarfEnd', () => new THREE.BoxGeometry(0.1, 0.3, 0.05)), color, 0.08, 1.24, 0.15));
        return;
      }
      case 'backpack':
        root.add(mesh(g('pack', () => new THREE.BoxGeometry(0.38, 0.44, 0.2)), darken(s.secondaryColor, -0.2), 0, 1.12, -0.24));
        return;
      default:
    }
  }

  /**
   * Builds a character. Returns { root, style, update(dt, moving), cheer() }.
   * root's position and rotation.y are the character's place and facing.
   */
  function makeCharacter(styleIn) {
    const s = normalizeStyle(styleIn);
    const female = s.body === 'female';
    const root = new THREE.Group();
    const scaled = new THREE.Group(); // characters are drawn larger than life so they read from overhead
    scaled.scale.setScalar(SCALE);
    root.add(scaled);
    const body = new THREE.Group(); // bobs and jumps; root stays on the ground
    scaled.add(body);

    // Shadow blob, so characters read clearly from the overhead camera.
    const shadow = new THREE.Mesh(
      g('shadow', () => new THREE.CircleGeometry(0.42, 12)),
      (mats.get('shadow') ?? mats.set('shadow', new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })).get('shadow')),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    scaled.add(shadow);

    // Legs pivot at the hips.
    const legColor = female ? s.skinColor : s.secondaryColor;
    const legs = [-0.11, 0.11].map((x) => {
      const hip = new THREE.Group();
      hip.position.set(x, 0.8, 0);
      hip.add(mesh(g('leg', () => new THREE.BoxGeometry(0.17, 0.72, 0.2)), legColor, 0, -0.38, 0));
      hip.add(mesh(g('shoe', () => new THREE.BoxGeometry(0.19, 0.1, 0.3)), '#1b1b1b', 0, -0.76, 0.04));
      body.add(hip);
      return hip;
    });
    if (female) {
      body.add(mesh(g('skirt', () => new THREE.CylinderGeometry(0.24, 0.38, 0.46, 8)), s.secondaryColor, 0, 0.74, 0));
    } else {
      body.add(mesh(g('hips', () => new THREE.BoxGeometry(0.42, 0.18, 0.24)), s.secondaryColor, 0, 0.84, 0));
    }

    const torsoW = female ? 0.42 : 0.5;
    body.add(mesh(g(`torso${torsoW}`, () => new THREE.BoxGeometry(torsoW, 0.6, 0.27)), s.primaryColor, 0, 1.12, 0));
    body.add(mesh(g('neck', () => new THREE.CylinderGeometry(0.07, 0.08, 0.12, 6)), s.skinColor, 0, 1.45, 0));

    // Arms pivot at the shoulders.
    const arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * (torsoW / 2 + 0.07), 1.38, 0);
      shoulder.add(mesh(g('arm', () => new THREE.BoxGeometry(0.12, 0.5, 0.14)), s.primaryColor, 0, -0.24, 0));
      shoulder.add(mesh(g('hand', () => new THREE.IcosahedronGeometry(0.07, 0)), s.skinColor, 0, -0.52, 0));
      body.add(shoulder);
      return shoulder;
    });

    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    head.add(mesh(g('head', () => new THREE.IcosahedronGeometry(0.2, 1)), s.skinColor));
    const eye = g('eye', () => new THREE.BoxGeometry(0.04, 0.05, 0.02));
    head.add(mesh(eye, '#111111', -0.07, 0.02, 0.185), mesh(eye, '#111111', 0.07, 0.02, 0.185));
    addHair(head, s);
    addHat(head, s);
    addAccessory(body, head, s);
    body.add(head);

    let phase = 0;
    let swing = 0;
    let cheerLeft = 0;

    return {
      root,
      style: s,
      cheer() {
        cheerLeft = 1.2;
      },
      update(dt, moving) {
        const target = moving ? 1 : 0;
        swing += (target - swing) * Math.min(1, dt * 10);
        phase += dt * 11 * swing;
        const a = Math.sin(phase) * 0.65 * swing;
        legs[0].rotation.x = a;
        legs[1].rotation.x = -a;
        body.position.y = Math.abs(Math.sin(phase)) * 0.06 * swing;
        if (cheerLeft > 0) {
          cheerLeft -= dt;
          const k = Math.max(0, cheerLeft) / 1.2;
          const wave = Math.sin(k * Math.PI * 6) * 0.3;
          arms[0].rotation.set(0, 0, -2.6 + wave);
          arms[1].rotation.set(0, 0, 2.6 - wave);
          body.position.y += Math.abs(Math.sin(k * Math.PI * 2)) * 0.35;
        } else {
          arms[0].rotation.set(-a, 0, -0.06);
          arms[1].rotation.set(a, 0, 0.06);
        }
      },
    };
  }

  /** A name label sprite that floats over a character. */
  function makeNameTag(name, { bot = false, me = false } = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '700 34px "Trebuchet MS", system-ui, sans-serif';
    ctx.font = font;
    const label = name.length > 18 ? `${name.slice(0, 17)}…` : name;
    const badge = bot ? 'BOT' : '';
    const badgeW = badge ? ctx.measureText(badge).width * 0.75 + 20 : 0;
    const w = Math.ceil(ctx.measureText(label).width + badgeW + 36);
    canvas.width = w;
    canvas.height = 56;
    ctx.font = font;
    ctx.fillStyle = me ? '#d8fd71' : 'rgba(20, 16, 40, 0.78)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, 56, 28);
    ctx.fill();
    let x = 18;
    if (badge) {
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.roundRect(x - 6, 12, badgeW - 6, 32, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillText(badge, x + 2, 36);
      ctx.font = font;
      x += badgeW;
    }
    ctx.fillStyle = me ? '#14102a' : '#ffffff';
    ctx.fillText(label, x, 40);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    const height = 0.95;
    sprite.scale.set((height * w) / 56, height, 1);
    sprite.position.y = 2.3 * SCALE;
    sprite.renderOrder = 10;
    return sprite;
  }

  FF.character = { normalizeStyle, randomStyle, makeCharacter, makeNameTag };
})();
