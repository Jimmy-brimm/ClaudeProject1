/*
 * Rough rotating 3D preview of the main shape with Three.js.
 * One body plus optional simple parts (boxes, rings, rods). Sizes are in mm.
 * Drag to turn it; it spins slowly on its own unless reduced motion is on.
 */
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;

  function roundedBoxGeometry(THREE, w, h, d, r) {
    const b = Math.max(0.01, Math.min(r, d / 2) * 0.6); // bevel on the front and back edges
    const iw = Math.max(0.02, w - 2 * b);
    const ih = Math.max(0.02, h - 2 * b);
    const cr = Math.max(0.01, Math.min(r - b, iw / 2 - 0.01, ih / 2 - 0.01));
    const s = new THREE.Shape();
    const x = -iw / 2;
    const y = -ih / 2;
    s.moveTo(x + cr, y);
    s.lineTo(x + iw - cr, y);
    s.quadraticCurveTo(x + iw, y, x + iw, y + cr);
    s.lineTo(x + iw, y + ih - cr);
    s.quadraticCurveTo(x + iw, y + ih, x + iw - cr, y + ih);
    s.lineTo(x + cr, y + ih);
    s.quadraticCurveTo(x, y + ih, x, y + ih - cr);
    s.lineTo(x, y + cr);
    s.quadraticCurveTo(x, y, x + cr, y);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.01, d - 2 * b),
      bevelEnabled: true,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 4,
      curveSegments: 10,
    });
    geo.center();
    return geo;
  }

  function bodyGeometry(THREE, s) {
    switch (s.body) {
      case 'box':
        return new THREE.BoxGeometry(s.w, s.h, s.d);
      case 'cylinder': {
        const g = new THREE.CylinderGeometry(s.w / 2, s.w / 2, s.h, 48);
        g.scale(1, 1, s.d / s.w);
        return g;
      }
      case 'sphere': {
        const g = new THREE.SphereGeometry(0.5, 48, 32);
        g.scale(s.w, s.h, s.d);
        return g;
      }
      case 'capsule': {
        const r = s.w / 2;
        const g = new THREE.CapsuleGeometry(r, Math.max(0.01, s.h - 2 * r), 10, 32);
        g.scale(1, 1, s.d / s.w);
        return g;
      }
      default:
        return roundedBoxGeometry(THREE, s.w, s.h, s.d, s.radius);
    }
  }

  function partGeometry(THREE, p) {
    const [a, b, c] = p.size.map((v) => Math.max(0.1, v));
    switch (p.shape) {
      case 'torus':
        return new THREE.TorusGeometry(a, Math.min(b, a), 12, 48);
      case 'cylinder':
        return new THREE.CylinderGeometry(a, a, b, 24);
      case 'sphere':
        return new THREE.SphereGeometry(a, 24, 16);
      case 'roundedBox':
        return roundedBoxGeometry(THREE, a, b, c, Math.min(a, b, c) / 4);
      default:
        return new THREE.BoxGeometry(a, b, c);
    }
  }

  function create(container) {
    const THREE = root.THREE;
    if (!THREE) {
      container.innerHTML = '<p class="empty-note">The 3D preview needs Three.js, which did not load.</p>';
      return { update() {}, setEdgeColor() {} };
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1.2, 2, 2.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(-2, -1, -1.5);
    scene.add(rim);

    const turntable = new THREE.Group();
    const model = new THREE.Group();
    turntable.add(model);
    scene.add(turntable);

    let edgeColor = 0x1c2430;
    let lastShape = null;
    const reduceMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let spin = !reduceMotion;
    turntable.rotation.set(0.25, -0.6, 0);

    function clearModel() {
      while (model.children.length) {
        const o = model.children.pop();
        o.geometry && o.geometry.dispose();
        o.material && o.material.dispose();
      }
    }

    function addMesh(geo, colorHex, pos, rot) {
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55, metalness: 0.12 });
      const mesh = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 35),
        new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.35 }),
      );
      [mesh, edges].forEach((o) => {
        if (pos) o.position.set(pos[0], pos[1], pos[2]);
        if (rot) o.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG);
        model.add(o);
      });
    }

    function update(shape) {
      lastShape = shape;
      clearModel();
      model.position.set(0, 0, 0);
      addMesh(bodyGeometry(THREE, shape), shape.color);
      shape.parts.forEach((p) => addMesh(partGeometry(THREE, p), p.color, p.position, p.rotation));

      // Centre the model on the turntable and frame it.
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      radius = size.length() / 2;
      frame();
    }

    // Distance that keeps the whole model in view at the narrower field of view.
    let radius = 100;
    function frame() {
      const vHalf = (camera.fov * DEG) / 2;
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
      const dist = radius / Math.sin(Math.min(vHalf, hHalf));
      camera.position.set(0, 0, dist * 1.05);
      camera.near = dist / 50;
      camera.far = dist * 10;
      camera.updateProjectionMatrix();
      draw();
    }

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      frame();
    }

    function draw() {
      renderer.render(scene, camera);
    }

    // Drag to rotate.
    let drag = null;
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, rx: turntable.rotation.x, ry: turntable.rotation.y };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      turntable.rotation.y = drag.ry + (e.clientX - drag.x) * 0.01;
      turntable.rotation.x = Math.max(-1.2, Math.min(1.2, drag.rx + (e.clientY - drag.y) * 0.01));
      draw();
    });
    const endDrag = () => (drag = null);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    function tick() {
      if (spin && !drag && container.offsetParent !== null) {
        turntable.rotation.y += 0.006;
        draw();
      }
      root.requestAnimationFrame(tick);
    }

    if (root.ResizeObserver) new root.ResizeObserver(resize).observe(container);
    root.requestAnimationFrame(tick);
    resize();

    return {
      update,
      setSpin(on) {
        spin = on;
      },
      get spinning() {
        return spin;
      },
      setEdgeColor(hex) {
        edgeColor = hex;
        if (lastShape) update(lastShape);
      },
      resize,
    };
  }

  root.Preview3D = { create };
})(typeof self !== 'undefined' ? self : this);
