// Incredible Spin Dummies - Game Logic
// Using Matter.js physics engine

// Aliases
const {
  Engine,
  Runner,
  World,
  Bodies,
  Body,
  Constraint,
  Composite,
  Vector,
  Mouse,
  MouseConstraint,
  Events
} = Matter;

// Collision Categories
const CATEGORY_WHEEL = 0x0001;
const CATEGORY_DUMMY = 0x0002;
const CATEGORY_WALL  = 0x0004;
const CATEGORY_MOUSE = 0x0008;

// Canvas Setup
const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 700;
document.getElementById('canvas-wrapper').appendChild(canvas);
const ctx = canvas.getContext('2d');

// Engine & World
const engine = Engine.create();
const world = engine.world;
// Top-down view: disable normal 2D gravity on the canvas plane
world.gravity.y = 0;

// Runner
const runner = Runner.create();
Runner.run(runner, engine);

// Global Game Variables
let wheel;
let wallBodies = [];
let dummies = [];
let particles = [];
let shouts = [];
let nextNameIndex = 0;
let isDraggingWheel = false;

// High Score / Telemetry Record
let maxRPMValue = 0;
let maxGForceValue = 0;

// Slider parameters (read from HTML inputs)
let gripMultiplier = 1.0;  // controlled by grip-slider
let dummyMass = 80;        // controlled by weight-slider (kg)
let jointStrength = 2;     // 1 = WEAK, 2 = NORMAL, 3 = STRONG, 4 = INDESTRUCTIBLE

const DUMMY_NAMES = [
  "Buster", "Slick", "Spin", "Crash", "Dash", 
  "Wobble", "Tumble", "Clumsy", "Splat", "Bounce"
];

// Helper: Convert Local Coordinates to World Coordinates
function localToWorld(center, angle, localPoint) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + localPoint.x * cos - localPoint.y * sin,
    y: center.y + localPoint.x * sin + localPoint.y * cos
  };
}

// Helper: Convert World Coordinates to Local Coordinates
function toLocal(body, worldPoint) {
  const cos = Math.cos(-body.angle);
  const sin = Math.sin(-body.angle);
  const dx = worldPoint.x - body.position.x;
  const dy = worldPoint.y - body.position.y;
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}

// Helper: Draw standard Crash Target Symbol
function drawTargetSymbol(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  
  // Yellow circle outline & backing
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffcc00';
  ctx.fill();
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  // Black quadrants
  ctx.fillStyle = '#222222';
  // Top-right
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, -Math.PI / 2, 0);
  ctx.closePath();
  ctx.fill();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, Math.PI / 2, Math.PI);
  ctx.closePath();
  ctx.fill();
  
  // Crosshair lines
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.moveTo(0, -r);
  ctx.lineTo(0, r);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  ctx.restore();
}

// Initialize LED Telemetry Segment display
const ledsContainer = document.getElementById('speed-leds');
const numLeds = 20;
const ledSegments = [];
ledsContainer.innerHTML = '';
for (let i = 0; i < numLeds; i++) {
  const led = document.createElement('div');
  led.classList.add('led-segment');
  if (i < numLeds * 0.5) led.classList.add('green');
  else if (i < numLeds * 0.75) led.classList.add('yellow');
  else if (i < numLeds * 0.9) led.classList.add('orange');
  else led.classList.add('red');
  ledsContainer.appendChild(led);
  ledSegments.push(led);
}

// Build Static Boundaries
function buildWalls() {
  // Remove existing walls if any
  wallBodies.forEach(wall => World.remove(world, wall));
  wallBodies = [];

  const wallThickness = 40;
  const w = canvas.width;
  const h = canvas.height;

  const wallOptions = {
    isStatic: true,
    friction: 0.8,
    restitution: 0.6,
    collisionFilter: {
      category: CATEGORY_WALL,
      mask: CATEGORY_DUMMY // only collide with dummy parts
    }
  };

  const top = Bodies.rectangle(w / 2, wallThickness / 2, w, wallThickness, wallOptions);
  const bottom = Bodies.rectangle(w / 2, h - wallThickness / 2, w, wallThickness, wallOptions);
  const left = Bodies.rectangle(wallThickness / 2, h / 2, wallThickness, h, wallOptions);
  const right = Bodies.rectangle(w - wallThickness / 2, h / 2, wallThickness, h, wallOptions);

  wallBodies = [top, bottom, left, right];
  World.add(world, wallBodies);
}

// Build the central Merry-Go-Round
function buildWheel() {
  if (wheel) {
    World.remove(world, wheel);
  }

  // Large circle in center
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = 200;

  wheel = Bodies.circle(cx, cy, radius, {
    density: 0.08, // heavy, gives high inertia
    frictionAir: 0.003, // low damping, spins for a long time
    collisionFilter: {
      category: CATEGORY_WHEEL,
      mask: CATEGORY_MOUSE // collides with mouse interaction only
    }
  });

  // Constrain wheel to screen center so it only rotates
  const pivot = Constraint.create({
    pointA: { x: cx, y: cy },
    bodyB: wheel,
    pointB: { x: 0, y: 0 },
    stiffness: 1.0,
    length: 0,
    render: { visible: false }
  });

  World.add(world, [wheel, pivot]);
}

// Create a single Dummy at a specific angle
function spawnDummy(angle) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  
  // Placement radius (just at the edge of the 200px wheel)
  const rPlace = 212;
  const dummyX = cx + rPlace * Math.cos(angle);
  const dummyY = cy + rPlace * Math.sin(angle);
  
  // Dummy's initial rotation (facing inwards towards center of wheel)
  const dummyAngle = angle - Math.PI / 2;

  // Mass scale factor (from weight slider)
  // Base density of 0.002 for normal dummy parts
  const densityVal = (dummyMass / 80) * 0.002;
  const dummyGroup = Body.nextGroup(true);
  const partOptions = (label) => ({
    density: densityVal,
    friction: 0.6,
    frictionAir: 0.03, // simulates sliding friction on ground
    restitution: 0.3,
    label: label,
    collisionFilter: {
      group: dummyGroup, // same negative group for all parts of this dummy!
      category: CATEGORY_DUMMY,
      mask: CATEGORY_WALL | CATEGORY_DUMMY
    }
  });

  // Helper to build a rotated body part
  function createPart(dx, dy, w, h, label) {
    const wPos = localToWorld({ x: dummyX, y: dummyY }, dummyAngle, { x: dx, y: dy });
    const body = Bodies.rectangle(wPos.x, wPos.y, w, h, partOptions(label));
    Body.setAngle(body, dummyAngle);
    return body;
  }

  // 1. Create rigid bodies for anatomical parts
  const torso = createPart(0, 0, 20, 48, 'torso');
  
  const headWPos = localToWorld({ x: dummyX, y: dummyY }, dummyAngle, { x: 0, y: -34 });
  const head = Bodies.circle(headWPos.x, headWPos.y, 10, partOptions('head'));
  Body.setAngle(head, dummyAngle);

  const leftUpperArm = createPart(-15, -14, 8, 22, 'leftUpperArm');
  const leftLowerArm = createPart(-20, -32, 6, 20, 'leftLowerArm');

  const rightUpperArm = createPart(15, -14, 8, 22, 'rightUpperArm');
  const rightLowerArm = createPart(20, -32, 6, 20, 'rightLowerArm');

  const leftUpperLeg = createPart(-7, 34, 10, 24, 'leftUpperLeg');
  const leftLowerLeg = createPart(-7, 57, 8, 22, 'leftLowerLeg');

  const rightUpperLeg = createPart(7, 34, 10, 24, 'rightUpperLeg');
  const rightLowerLeg = createPart(7, 57, 8, 22, 'rightLowerLeg');

  const dummyParts = {
    torso, head,
    leftUpperArm, leftLowerArm,
    rightUpperArm, rightLowerArm,
    leftUpperLeg, leftLowerLeg,
    rightUpperLeg, rightLowerLeg
  };

  // Add all bodies to the world
  World.add(world, Object.values(dummyParts));

  // Helper to create joints between body parts
  // Joints are revolute (length = 0, stiffness = 0.9)
  function createJoint(bodyA, bodyB, localA, localB, name) {
    const joint = Constraint.create({
      bodyA: bodyA,
      bodyB: bodyB,
      pointA: localA,
      pointB: localB,
      stiffness: 0.9,
      length: 0,
      render: { visible: false }
    });
    return { name, constraint: joint, partB: bodyB };
  }

  // Assemble joints
  const joints = [
    createJoint(torso, head, { x: 0, y: -24 }, { x: 0, y: 10 }, 'neck'),
    
    createJoint(torso, leftUpperArm, { x: -10, y: -18 }, { x: 5, y: -4 }, 'shoulderL'),
    createJoint(leftUpperArm, leftLowerArm, { x: -3, y: -9 }, { x: 2, y: 9 }, 'elbowL'),
    
    createJoint(torso, rightUpperArm, { x: 10, y: -18 }, { x: -5, y: -4 }, 'shoulderR'),
    createJoint(rightUpperArm, rightLowerArm, { x: 3, y: -9 }, { x: -2, y: 9 }, 'elbowR'),
    
    createJoint(torso, leftUpperLeg, { x: -7, y: 22 }, { x: 0, y: -12 }, 'hipL'),
    createJoint(leftUpperLeg, leftLowerLeg, { x: 0, y: 12 }, { x: 0, y: -11 }, 'kneeL'),
    
    createJoint(torso, rightUpperLeg, { x: 7, y: 22 }, { x: 0, y: -12 }, 'hipR'),
    createJoint(rightUpperLeg, rightLowerLeg, { x: 0, y: 12 }, { x: 0, y: -11 }, 'kneeR')
  ];

  // Add joint constraints to the world
  joints.forEach(j => World.add(world, j.constraint));

  // 2. Setup Grip to the Wheel
  // Position hands at the handle points on the wheel
  // Left hand tip is local (0, 10) on leftLowerArm
  // Right hand tip is local (0, 10) on rightLowerArm
  const worldLHand = localToWorld(leftLowerArm.position, leftLowerArm.angle, { x: 0, y: -10 });
  const worldRHand = localToWorld(rightLowerArm.position, rightLowerArm.angle, { x: 0, y: -10 });

  const wheelLAnchor = toLocal(wheel, worldLHand);
  const wheelRAnchor = toLocal(wheel, worldRHand);

  const leftGrip = Constraint.create({
    bodyA: wheel,
    pointA: wheelLAnchor,
    bodyB: leftLowerArm,
    pointB: { x: 0, y: -10 },
    stiffness: 0.95,
    length: 0,
    render: { visible: false }
  });

  const rightGrip = Constraint.create({
    bodyA: wheel,
    pointA: wheelRAnchor,
    bodyB: rightLowerArm,
    pointB: { x: 0, y: -10 },
    stiffness: 0.95,
    length: 0,
    render: { visible: false }
  });

  World.add(world, [leftGrip, rightGrip]);

  // Choose a retro name
  const name = DUMMY_NAMES[nextNameIndex % DUMMY_NAMES.length];
  nextNameIndex++;

  const dummyObj = {
    name: name,
    parts: dummyParts,
    joints: joints,
    grips: [
      { constraint: leftGrip, hand: leftLowerArm },
      { constraint: rightGrip, hand: rightLowerArm }
    ],
    gripStrength: 100, // 100% initial grip
    status: 'holding', // 'holding', 'flying', 'dismembered'
    color: '#ffcc00'
  };

  dummies.push(dummyObj);
}

// Reset the entire simulation
function resetSimulation() {
  // Clear all dummies from physics world
  dummies.forEach(dummy => {
    Object.values(dummy.parts).forEach(part => World.remove(world, part));
    dummy.joints.forEach(j => World.remove(world, j.constraint));
    dummy.grips.forEach(g => World.remove(world, g.constraint));
  });

  dummies = [];
  particles = [];
  shouts = [];

  // Reset the wheel speed
  Body.setAngle(wheel, 0);
  Body.setAngularVelocity(wheel, 0);
  Body.setVelocity(wheel, { x: 0, y: 0 });
  if (typeof gsap !== 'undefined') {
    gsap.set('#drag-overlay', { rotation: 0 });
  }

  // Spawn two initial dummies at opposite sides
  spawnDummy(0);
  spawnDummy(Math.PI);
}

// Setup GSAP Draggable for smooth rotation and flick/inertia physics
function setupMouseInteraction() {
  const dragOverlay = document.getElementById('drag-overlay');
  if (!dragOverlay) return;

  // Initialize GSAP Draggable to rotate the overlay circle
  Draggable.create(dragOverlay, {
    type: "rotation",
    onDragStart: function() {
      isDraggingWheel = true;
    },
    onDrag: function() {
      // Set the physical wheel's angle to match the GSAP element's rotation
      const radAngle = this.rotation * Math.PI / 180;
      Body.setAngle(wheel, radAngle);

      // getVelocity('rotation') returns degrees per second.
      // Convert to radians per frame (assuming 60 FPS) to match Matter.js angular velocity.
      const radPerSec = this.getVelocity('rotation') * Math.PI / 180;
      const radPerFrame = radPerSec / 60;
      Body.setAngularVelocity(wheel, radPerFrame);
    },
    onDragEnd: function() {
      isDraggingWheel = false;
    }
  });
}

// Particles (Splats and mechanical shards on collision)
function spawnCollisionParticles(x, y, count = 10) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 2;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 5 + 3,
      color: Math.random() > 0.4 ? '#ffcc00' : '#222222', // warning yellow & black
      life: 1.0, // fades out
      decay: Math.random() * 0.04 + 0.02
    });
  }
}

// Shouts (Comic text effects on letting go or crashing)
function spawnShout(x, y, text) {
  shouts.push({
    x: x,
    y: y,
    text: text,
    vx: (Math.random() - 0.5) * 2,
    vy: -Math.random() * 3 - 2,
    size: Math.floor(Math.random() * 8) + 18,
    angle: (Math.random() - 0.5) * 0.4,
    life: 1.0,
    decay: 0.02
  });
}

// Collision Listener: Dismemberment of joints on high velocity crashes
Events.on(engine, 'collisionStart', function(event) {
  const pairs = event.pairs;
  
  pairs.forEach(pair => {
    const bodyA = pair.bodyA;
    const bodyB = pair.bodyB;

    // Calculate relative speed of impact
    const vx = bodyA.velocity.x - bodyB.velocity.x;
    const vy = bodyA.velocity.y - bodyB.velocity.y;
    const impactSpeed = Math.sqrt(vx * vx + vy * vy);

    // Map joint strength slider to speed threshold
    // 1: Weak (7), 2: Normal (12), 3: Strong (19), 4: Indestructible (Infinity)
    let threshold = 12;
    if (jointStrength === 1) threshold = 7;
    else if (jointStrength === 2) threshold = 12;
    else if (jointStrength === 3) threshold = 19;
    else if (jointStrength === 4) threshold = Infinity;

    if (impactSpeed > threshold) {
      // Check if one of the bodies is a dummy part
      let hitPart = null;
      let hitDummy = null;

      // Scan all dummies to see if bodyA or bodyB belongs to one
      dummies.forEach(dummy => {
        Object.entries(dummy.parts).forEach(([partName, body]) => {
          if (body === bodyA) {
            hitPart = partName;
            hitDummy = dummy;
          } else if (body === bodyB) {
            hitPart = partName;
            hitDummy = dummy;
          }
        });
      });

      if (hitDummy) {
        // Find which joint to break based on the body part hit
        let jointToBreakName = null;

        const partToJointMap = {
          'head': 'neck',
          'leftLowerArm': 'elbowL',
          'leftUpperArm': 'shoulderL',
          'rightLowerArm': 'elbowR',
          'rightUpperArm': 'shoulderR',
          'leftLowerLeg': 'kneeL',
          'leftUpperLeg': 'hipL',
          'rightLowerLeg': 'kneeR',
          'rightUpperLeg': 'hipR'
        };

        if (hitPart === 'torso') {
          // If torso took a heavy impact, break neck or a random arm/leg joint
          const activeJoints = hitDummy.joints.filter(j => world.constraints.includes(j.constraint));
          if (activeJoints.length > 0) {
            const randomJoint = activeJoints[Math.floor(Math.random() * activeJoints.length)];
            jointToBreakName = randomJoint.name;
          }
        } else {
          jointToBreakName = partToJointMap[hitPart];
        }

        if (jointToBreakName) {
          const jointInfo = hitDummy.joints.find(j => j.name === jointToBreakName);
          if (jointInfo && world.constraints.includes(jointInfo.constraint)) {
            // Sever the joint constraint
            World.remove(world, jointInfo.constraint);
            hitDummy.status = 'dismembered';

            // Find collision coordinates for particles and text
            const contact = pair.activeContacts[0];
            const px = contact ? contact.vertex.x : hitDummy.parts.torso.position.x;
            const py = contact ? contact.vertex.y : hitDummy.parts.torso.position.y;

            // Spawn dismemberment effects
            spawnCollisionParticles(px, py, 15);
            
            const breakShouts = ["SNAP!", "CRACK!", "POP!", "OUCH!", "SPLIT!", "CRASH!"];
            spawnShout(px, py - 10, breakShouts[Math.floor(Math.random() * breakShouts.length)]);

            // Pop: apply a tiny radial force pushing the severed part away
            const partBody = jointInfo.partB;
            if (partBody) {
              const pushForce = Vector.mult(Vector.normalise(Vector.sub(partBody.position, hitDummy.parts.torso.position)), 0.05 * partBody.mass);
              Body.applyForce(partBody, partBody.position, pushForce);
              
              // Also release any grip constraint attached to this severed arm
              hitDummy.grips.forEach(g => {
                if (g.hand === partBody && world.constraints.includes(g.constraint)) {
                  World.remove(world, g.constraint);
                }
              });
            }
          }
        }
      }
    }
  });
});

// Update logic loop
function update() {
  // Sync GSAP overlay rotation with physical wheel rotation when spinning freely
  if (!isDraggingWheel && typeof gsap !== 'undefined') {
    const degAngle = wheel.angle * 180 / Math.PI;
    gsap.set('#drag-overlay', { rotation: degAngle });
  }

  // 1. Calculate velocity and G-Forces
  const omega = Math.abs(wheel.angularVelocity) * 60; // rad/sec
  const rMeters = 2.0; // 200px = 2 meters
  const gForce = (omega * omega * rMeters) / 9.8;
  const rpm = Math.abs(wheel.angularVelocity) * 572.957;

  // Record peak values
  if (rpm > maxRPMValue) maxRPMValue = rpm;
  if (gForce > maxGForceValue) maxGForceValue = gForce;

  // 2. Update telemetry HUD text
  document.getElementById('rpm-value').innerHTML = `${Math.round(rpm).toString().padStart(3, '0')}<span class="unit">RPM</span>`;
  document.getElementById('gforce-value').innerHTML = `${gForce.toFixed(1)}<span class="unit">G</span>`;
  document.getElementById('max-rpm').innerText = Math.round(maxRPMValue).toString().padStart(3, '0');
  document.getElementById('max-gforce').innerText = maxGForceValue.toFixed(1);

  // 3. Update speed segments (LEDs)
  const activeLeds = Math.min(numLeds, Math.floor((rpm / 180) * numLeds));
  ledSegments.forEach((led, idx) => {
    if (idx < activeLeds) led.classList.add('active');
    else led.classList.remove('active');
  });

  // 4. Update dummy grip meters and let-go logic
  // Grip strength limit based on slider (100 = 3 Gs limit)
  const baseGForceLimit = (gripMultiplier * 100) * 0.03;

  dummies.forEach(dummy => {
    if (dummy.status === 'holding') {
      // Dummies only experience centrifugal pull if they are still on the wheel
      if (gForce > baseGForceLimit) {
        // Drain grip: faster drain at higher G-force
        const drain = (gForce - baseGForceLimit) * 0.15;
        dummy.gripStrength -= drain;
      } else {
        // Slowly recover grip when safe
        dummy.gripStrength = Math.min(100, dummy.gripStrength + 0.2);
      }

      // Check if grip broke
      if (dummy.gripStrength <= 0) {
        dummy.gripStrength = 0;
        dummy.status = 'flying';
        
        // Remove hand grip constraints
        dummy.grips.forEach(g => {
          if (world.constraints.includes(g.constraint)) {
            World.remove(world, g.constraint);
          }
        });

        // Shout out on release
        const releaseShouts = ["AAAHHH!", "WEEEEE!", "BYE!", "HELP!", "FLING!", "YIKES!"];
        spawnShout(
          dummy.parts.torso.position.x, 
          dummy.parts.torso.position.y - 20, 
          releaseShouts[Math.floor(Math.random() * releaseShouts.length)]
        );
      }
    }
  });

  // 5. Update HTML status telemetry row-by-row
  const listEl = document.getElementById('dummies-list');
  listEl.innerHTML = '';
  dummies.forEach(dummy => {
    let statusText = '';
    let rowClass = '';
    let gripPercent = Math.max(0, Math.round(dummy.gripStrength));
    
    if (dummy.status === 'holding') {
      statusText = `HOLDING ON`;
      if (dummy.gripStrength < 30) {
        rowClass = 'danger';
      } else if (dummy.gripStrength < 70) {
        rowClass = 'slipping';
      }
    } else if (dummy.status === 'flying') {
      statusText = `FLYING!`;
      rowClass = 'flyoff';
    } else if (dummy.status === 'dismembered') {
      statusText = `BROKEN!`;
      rowClass = 'flyoff';
    }
    
    const rowHtml = `
      <div class="dummy-telemetry-row ${rowClass}">
        <span class="status-name">${dummy.name}</span>
        <div class="status-grip">
          <span>${dummy.status === 'holding' ? gripPercent + '%' : statusText}</span>
          <div class="grip-fill-container">
            <div class="grip-fill" style="width: ${gripPercent}%"></div>
          </div>
        </div>
      </div>
    `;
    listEl.innerHTML += rowHtml;
  });

  // 6. Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }

  // 7. Update shouts
  for (let i = shouts.length - 1; i >= 0; i--) {
    const s = shouts[i];
    s.x += s.vx;
    s.y += s.vy;
    s.life -= s.decay;
    if (s.life <= 0) {
      shouts.splice(i, 1);
    }
  }
}

// Render loop: Draw game objects using HTML5 Canvas 2D
function draw() {
  // Clear & Draw grid lines
  ctx.fillStyle = '#f0f0e6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Grid pattern
  ctx.strokeStyle = '#e2e2d6';
  ctx.lineWidth = 1;
  for (let x = 40; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 40; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw concentric warning circles in background
  ctx.strokeStyle = 'rgba(211, 18, 27, 0.04)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(400, 350, 240, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(400, 350, 320, 0, Math.PI * 2); ctx.stroke();

  // Draw Merry-Go-Round Wheel
  ctx.save();
  ctx.translate(wheel.position.x, wheel.position.y);
  ctx.rotate(wheel.angle);
  
  // Outer wheel base
  ctx.beginPath();
  ctx.arc(0, 0, 200, 0, Math.PI * 2);
  ctx.fillStyle = '#dfdfd5';
  ctx.fill();
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 5;
  ctx.stroke();
  
  // 8 Warning-striped colored sectors
  const colors = [
    '#ffcc00', '#222222', '#ff6600', '#222222', 
    '#ffcc00', '#222222', '#ff6600', '#222222'
  ];
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 196, (i * Math.PI) / 4, ((i + 1) * Math.PI) / 4);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // Inner metallic disc overlay
  ctx.beginPath();
  ctx.arc(0, 0, 140, 0, Math.PI * 2);
  ctx.fillStyle = '#b5b5ab';
  ctx.fill();
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Draw U-bar safety handles around the perimeter
  dummies.forEach((dummy, idx) => {
    // Left/Right handles on wheel
    dummy.grips.forEach(g => {
      ctx.beginPath();
      ctx.arc(g.constraint.pointA.x, g.constraint.pointA.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#777772';
      ctx.fill();
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  });

  // Center axle checker pattern
  ctx.save();
  drawTargetSymbol(0, 0, 26);
  ctx.restore();

  ctx.restore(); // wheel restore

  // Draw Dummies
  dummies.forEach(dummy => {
    const parts = dummy.parts;
    
    // Draw limbs (capsules)
    // Format: body, width, height, isTorso
    const rectParts = [
      { body: parts.leftLowerLeg, w: 8, h: 22 },
      { body: parts.leftUpperLeg, w: 10, h: 24 },
      { body: parts.rightLowerLeg, w: 8, h: 22 },
      { body: parts.rightUpperLeg, w: 10, h: 24 },
      { body: parts.leftLowerArm, w: 6, h: 20 },
      { body: parts.leftUpperArm, w: 8, h: 22 },
      { body: parts.rightLowerArm, w: 6, h: 20 },
      { body: parts.rightUpperArm, w: 8, h: 22 }
    ];

    rectParts.forEach(p => {
      if (!p.body) return;
      ctx.save();
      ctx.translate(p.body.position.x, p.body.position.y);
      ctx.rotate(p.body.angle);
      ctx.beginPath();
      ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 3);
      ctx.fillStyle = dummy.color;
      ctx.fill();
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      
      // Draw joint detail on limb
      ctx.fillStyle = '#222222';
      ctx.beginPath(); ctx.arc(0, -p.h/2 + 2, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, p.h/2 - 2, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    });

    // Draw Torso
    if (parts.torso) {
      ctx.save();
      ctx.translate(parts.torso.position.x, parts.torso.position.y);
      ctx.rotate(parts.torso.angle);
      ctx.beginPath();
      ctx.roundRect(-10, -24, 20, 48, 4);
      ctx.fillStyle = dummy.color;
      ctx.fill();
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Diagnostic chest target symbol
      drawTargetSymbol(0, -6, 7);

      // Warning belt stripe
      ctx.fillStyle = '#222222';
      ctx.fillRect(-10, 10, 20, 6);
      ctx.fillStyle = '#ffcc00';
      ctx.font = 'bold 8px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('TEST', 0, 15);
      ctx.restore();
    }

    // Draw Head
    if (parts.head) {
      ctx.save();
      ctx.translate(parts.head.position.x, parts.head.position.y);
      ctx.rotate(parts.head.angle);
      
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = dummy.color;
      ctx.fill();
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Draw head warning quadrant symbol on forehead
      drawTargetSymbol(0, -3, 5);

      // Eyes
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 1.8;
      if (dummy.status === 'flying' || dummy.status === 'dismembered') {
        // X X eyes
        ctx.beginPath();
        ctx.moveTo(-4, 3); ctx.lineTo(-1, 6);
        ctx.moveTo(-1, 3); ctx.lineTo(-4, 6);
        ctx.moveTo(1, 3); ctx.lineTo(4, 6);
        ctx.moveTo(4, 3); ctx.lineTo(1, 6);
        ctx.stroke();
      } else if (dummy.gripStrength < 40) {
        // Worried circular eyes
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(-3, 4, 2.5, 0, Math.PI*2); ctx.arc(3, 4, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#222222';
        ctx.beginPath(); ctx.arc(-3, 4, 1, 0, Math.PI*2); ctx.arc(3, 4, 1, 0, Math.PI*2); ctx.fill();
      } else {
        // Calm dot eyes
        ctx.fillStyle = '#222222';
        ctx.beginPath();
        ctx.arc(-3, 4, 1.2, 0, Math.PI * 2);
        ctx.arc(3, 4, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw active mechanical joint hinges as metal pins
    dummy.joints.forEach(j => {
      if (!j.constraint.bodyB || !world.constraints.includes(j.constraint)) return;
      const worldAnchor = localToWorld(j.constraint.bodyB.position, j.constraint.bodyB.angle, j.constraint.pointB);
      ctx.beginPath();
      ctx.arc(worldAnchor.x, worldAnchor.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

    // Draw Grip indicator floating above dummy head
    if (dummy.status === 'holding' && parts.head) {
      const hx = parts.head.position.x;
      const hy = parts.head.position.y - 20;
      const wBar = 40;
      const hBar = 5;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx - wBar / 2, hy, wBar, hBar);
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - wBar / 2, hy, wBar, hBar);

      // Grip color transition
      let barColor = '#27ae60'; // green
      if (dummy.gripStrength < 35) barColor = '#c0392b'; // red
      else if (dummy.gripStrength < 70) barColor = '#e67e22'; // orange

      ctx.fillStyle = barColor;
      ctx.fillRect(hx - wBar / 2, hy, wBar * (dummy.gripStrength / 100), hBar);
    }
  });

  // Draw particles
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Draw comic text shouts
  shouts.forEach(s => {
    ctx.save();
    ctx.globalAlpha = s.life;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.font = `bold ${s.size}px 'Permanent Marker', Impact, sans-serif`;
    ctx.textAlign = 'center';
    
    // Shadow backing
    ctx.fillStyle = '#222222';
    ctx.fillText(s.text, 2, 2);
    // Forefront yellow/orange
    ctx.fillStyle = '#f05a28';
    ctx.fillText(s.text, 0, 0);
    ctx.restore();
  });

  // Draw boundary safety hazard stripes
  const edge = 20;
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = edge;
  ctx.strokeRect(edge/2, edge/2, canvas.width - edge, canvas.height - edge);
  
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 3;
  ctx.beginPath();
  // Top Border diagonal lines
  for (let x = 0; x < canvas.width; x += 30) {
    ctx.moveTo(x, 0); ctx.lineTo(x + 15, edge);
  }
  // Bottom Border diagonal lines
  for (let x = 0; x < canvas.width; x += 30) {
    ctx.moveTo(x, canvas.height - edge); ctx.lineTo(x + 15, canvas.height);
  }
  // Left Border
  for (let y = 0; y < canvas.height; y += 30) {
    ctx.moveTo(0, y); ctx.lineTo(edge, y + 15);
  }
  // Right Border
  for (let y = 0; y < canvas.height; y += 30) {
    ctx.moveTo(canvas.width - edge, y); ctx.lineTo(canvas.width, y + 15);
  }
  ctx.stroke();
  
  // Inner solid line
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 3;
  ctx.strokeRect(edge, edge, canvas.width - edge*2, canvas.height - edge*2);

  // Warning text stamps in corner grid slots
  ctx.font = "bold 12px 'Share Tech Mono', monospace";
  ctx.fillStyle = "#888877";
  ctx.fillText("SECTOR 04B", 35, 45);
  ctx.fillText("TEST CELL A", canvas.width - 120, 45);

  requestAnimationFrame(draw);
}

// Event Listeners for controls and adjustments
function setupUIHandlers() {
  // Reset Button
  document.getElementById('btn-reset').addEventListener('click', () => {
    resetSimulation();
  });

  // Spawn Button
  document.getElementById('btn-spawn').addEventListener('click', () => {
    // Only allow spawning up to 6 dummies to prevent canvas overflow
    if (dummies.length >= 6) {
      alert("Test chamber maximum capacity reached! Reset to start new batch.");
      return;
    }
    // Spawn at a random angle on the wheel
    const angle = Math.random() * Math.PI * 2;
    spawnDummy(angle);
  });

  // Sliders
  const gripSlider = document.getElementById('grip-slider');
  const gripVal = document.getElementById('grip-val');
  gripSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    gripMultiplier = val / 100;
    gripVal.innerText = `${val}%`;
  });

  const weightSlider = document.getElementById('weight-slider');
  const weightVal = document.getElementById('weight-val');
  weightSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    dummyMass = val;
    weightVal.innerText = `${val} kg`;
    
    // Instantly update mass of existing dummies
    const densityVal = (dummyMass / 80) * 0.002;
    dummies.forEach(dummy => {
      Object.values(dummy.parts).forEach(part => {
        if (part) Body.setDensity(part, densityVal);
      });
    });
  });

  const jointSlider = document.getElementById('joint-slider');
  const jointVal = document.getElementById('joint-val');
  jointSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    jointStrength = val;
    const labels = ["WEAK", "NORMAL", "STRONG", "INDESTRUCTIBLE"];
    jointVal.innerText = labels[val - 1];
  });
}

// Start Game
function init() {
  buildWalls();
  buildWheel();
  setupMouseInteraction();
  setupUIHandlers();
  
  // Spin loop (physics state calculations)
  Events.on(engine, 'afterUpdate', update);

  // Initial spawn
  resetSimulation();

  // Start Canvas Render Frame loop
  draw();
}

// Initialize on page load
window.onload = init;
