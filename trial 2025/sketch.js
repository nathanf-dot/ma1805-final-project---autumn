/*
  Crown Shyness v7 — Deep Night Cycle + Title Card + Fullscreen (p5.js)
  ---------------------------------------------------------------------
  - 3-minute looping Day → Sunset → Night → Dawn cycle (crossfaded)
  - Fireflies at night, pollen by day
  - Ecological feedback: interaction disturbs wind/light; calm restores
  - Interactive camera drift toward cursor/touch
  - Title card that fades out on first interaction
  - Fullscreen toggle: F
*/

const CFG = {
  NUM_TREES: 9,
  LAYERS: 3,
  LEAVES_PER_TREE: [220, 280],
  GAP_RADIUS: 50,
  BASE_HEAL_PER_SEC: 18, // will be modulated by feedback
  WIND_SPEED: 0.15,
  WIND_STRENGTH: 1.8,    // base; modulated by feedback
  TRUNK_WEIGHT: [7, 11],
  TRUNK_HEIGHT: [0.46, 0.74],
  CROWN_RAD: [80, 185],
  CROWN_ECC_Y: [0.45, 0.65],
  CROWN_JITTER_Y: 48,
  LEAF_SIZE: [13, 26],
  LEAF_ASPECT: [0.65, 0.95],
  LEAF_ALPHA: [180, 235],
  LEAF_PALETTE: [
    [34,102,52],[42,122,64],[50,140,72],[62,150,82],[28,90,46]
  ],
  SKY_DAY_TOP:   [168,205,245], SKY_DAY_BOT:   [120,175,225],
  SKY_DUSK_TOP:  [230,170,120], SKY_DUSK_BOT:  [160,110,80],
  SKY_NIGHT_TOP: [24, 34, 68 ], SKY_NIGHT_BOT: [10, 18, 36],
  SKY_DAWN_TOP:  [200,180,150], SKY_DAWN_BOT:  [120,120,140],
  POLLEN_COUNT: 80,
  FIREFLY_COUNT: 60,
  HELP: true,
  FADE_SPEED: 0.6,
  CYCLE_SEC: 180 // 3-minute loop
};

// Global state
let forest, lightMask, windT = 0;
let gaps = [], particles = [], fireflies = [];
let lastMillis = 0;

let camShift = { x: 0, y: 0, targetX: 0, targetY: 0 };
let fade = { a: 255, target: 0 };
let breathing = 0;
let env = {
  disturb: 0,   // 0 calm → 1 disturbed
  cycleT: 0,    // 0..1 day-night cycle progress
  cycleTime: 0  // seconds
};
let mouseInfluence = { x: 0, y: 0 };

// Title card state
let showTitleCard = true;
let titleAlpha = 255;

// Helpers
function randIn([a,b]) { return random(a,b); }
function clamp(v,a,b) { return max(a,min(b,v)); }
function lerpRGB(a,b,t) { return [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)]; }

function skyGradient(y){
  const t = constrain(y/height, 0, 1);
  const p = env.cycleT; // 0..1 across day cycle
  let top, bot;

  if (p < 0.25) { // Day → Sunset
    const k = map(p, 0.00, 0.25, 0, 1);
    top = lerpRGB(CFG.SKY_DAY_TOP,  CFG.SKY_DUSK_TOP, k);
    bot = lerpRGB(CFG.SKY_DAY_BOT,  CFG.SKY_DUSK_BOT, k);
  } else if (p < 0.50) { // Sunset → Night
    const k = map(p, 0.25, 0.50, 0, 1);
    top = lerpRGB(CFG.SKY_DUSK_TOP, CFG.SKY_NIGHT_TOP, k);
    bot = lerpRGB(CFG.SKY_DUSK_BOT, CFG.SKY_NIGHT_BOT, k);
  } else if (p < 0.75) { // Night → Dawn
    const k = map(p, 0.50, 0.75, 0, 1);
    top = lerpRGB(CFG.SKY_NIGHT_TOP, CFG.SKY_DAWN_TOP, k);
    bot = lerpRGB(CFG.SKY_NIGHT_BOT, CFG.SKY_DAWN_BOT, k);
  } else { // Dawn → Day
    const k = map(p, 0.75, 1.00, 0, 1);
    top = lerpRGB(CFG.SKY_DAWN_TOP,  CFG.SKY_DAY_TOP, k);
    bot = lerpRGB(CFG.SKY_DAWN_BOT,  CFG.SKY_DAY_BOT, k);
  }

  const c = lerpRGB(top, bot, t);
  return color(c[0], c[1], c[2]);
}

function isNight(){ return (env.cycleT >= 0.45 && env.cycleT <= 0.70); }

// Classes
class Leaf{
  constructor(tree,x,y,layer){
    this.tree = tree;
    this.x0 = x; this.y0 = y;
    this.layer = layer;
    this.size = randIn(CFG.LEAF_SIZE) * this.depthScale();
    this.aspect = randIn(CFG.LEAF_ASPECT);
    this.color = this.pickColor();
    this.id = random(1000);
  }
  depthScale(){ return lerp(0.75,1.25,(this.layer+1)/CFG.LAYERS); }
  pickColor(){
    const base = random(CFG.LEAF_PALETTE);
    const d = (this.layer+1)/CFG.LAYERS;
    const shade = 0.85 + d*0.35 + random(-0.05,0.05);
    const a = randIn(CFG.LEAF_ALPHA);
    return color(base[0]*shade, base[1]*shade, base[2]*shade, a);
  }
  worldPos(){ return createVector(this.tree.crownX+this.x0, this.tree.crownY+this.y0); }
  inAnyGap(px,py){
    for (let g of gaps){
      const dx=px-g.x, dy=py-g.y;
      if (dx*dx+dy*dy <= g.r*g.r) return true;
    }
    return false;
  }
  draw(pg){
    const w = noise(this.id*0.31, windT*CFG.WIND_SPEED)*2-1;
    const dynWind = CFG.WIND_STRENGTH * (1 + env.disturb*0.9);
    const sway = w * (4 + this.layer*1.8) * dynWind;

    const p = this.worldPos();
    const px = p.x + sway + camShift.x + mouseInfluence.x*0.05;
    const py = p.y + sin(windT*0.9+this.id)*(1.2+this.layer*0.6) + camShift.y + mouseInfluence.y*0.03;

    if (this.inAnyGap(px,py)) return;

    const depthHaze = map(this.layer,0,CFG.LAYERS-1,0.35,1);
    const nightDim  = isNight()? 0.65 : 1.0;
    const vis = depthHaze * nightDim * (1 - env.disturb*0.08);

    pg.push();
    pg.translate(px,py);
    pg.noStroke();

    const ctx = pg.drawingContext;
    const r = this.size * 0.55;
    const grad = ctx.createRadialGradient(0,0,r*0.1, 0,0,r);
    const c = this.color.levels;

    grad.addColorStop(0, `rgba(${(c[0]*vis).toFixed(1)},${(c[1]*vis).toFixed(1)},${(c[2]*vis).toFixed(1)},${(c[3]/255).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${(c[0]*0.5*vis).toFixed(1)},${(c[1]*0.5*vis).toFixed(1)},${(c[2]*0.5*vis).toFixed(1)},${(c[3]/255*0.8).toFixed(3)})`);

    ctx.fillStyle = grad;

    const glint = noise(this.id, windT*0.3) > (isNight()?0.88:0.82) ? 1.35 : 1;
    pg.scale(glint);
    pg.ellipse(0,0,this.size,this.size*this.aspect);
    pg.pop();
  }
}

class Tree{
  constructor(xBase,heightFrac,index){
    this.index = index;
    this.baseX = xBase;
    this.trunkH = height * clamp(heightFrac,0.2,0.9);
    this.curve = {
      x1:this.baseX+random(-20,20), y1:height,
      x2:this.baseX+random(-40,40), y2:height-this.trunkH*0.55,
      x3:this.baseX+random(-25,25), y3:height-this.trunkH
    };
    this.crownX = this.curve.x3;
    this.crownY = this.curve.y3 + random(-CFG.CROWN_JITTER_Y,CFG.CROWN_JITTER_Y);
    this.crownR = randIn(CFG.CROWN_RAD);
    this.eccY   = randIn(CFG.CROWN_ECC_Y);
    this.leaves = [];

    const total = floor(randIn(CFG.LEAVES_PER_TREE));
    for (let i=0;i<total;i++){
      const layer = floor(random(CFG.LAYERS));
      const pos = this.sampleCrownPoint();
      this.leaves.push(new Leaf(this,pos.x,pos.y,layer));
    }
  }
  sampleCrownPoint(){
    const a = this.crownR*random(0.6,1.0);
    const b = a*this.eccY;
    const t = random(TWO_PI);
    const r = sqrt(random())*a;
    return createVector(cos(t)*r, sin(t)*r*(b/a));
  }
  drawTrunk(pg){
    const w0 = randIn(CFG.TRUNK_WEIGHT);
    const ctx = pg.drawingContext;
    const grad = ctx.createLinearGradient(
      this.baseX-6+camShift.x, height+camShift.y,
      this.baseX+6+camShift.x, height-this.trunkH+camShift.y
    );
    const nightTint = isNight()? 0.7 : 1.0;
    grad.addColorStop(0,`rgba(${70*nightTint},${45*nightTint},${22*nightTint},0.95)`);
    grad.addColorStop(1,`rgba(${95*nightTint},${65*nightTint},${35*nightTint},0.85)`);
    ctx.strokeStyle = grad;
    pg.noFill();
    pg.strokeWeight(w0);

    pg.bezier(
      this.curve.x1+camShift.x, this.curve.y1+camShift.y,
      this.curve.x2+camShift.x, this.curve.y2+camShift.y,
      this.curve.x2+random(-10,10)+camShift.x, this.curve.y2-random(10,30)+camShift.y,
      this.curve.x3+camShift.x, this.curve.y3+camShift.y
    );
  }
  drawLeaves(pg){
    for (let L=0; L<CFG.LAYERS; L++){
      for (let lf of this.leaves){
        if (lf.layer===L) lf.draw(pg);
      }
    }
  }
}

class Forest{
  constructor(){
    this.trunkBuffer = createGraphics(width,height);
    this.leafBuffer  = createGraphics(width,height);
    this.trees = [];
    this.init();
  }
  init(){
    this.trees.length = 0;
    for (let i=0;i<CFG.NUM_TREES;i++){
      const baseX=map(i+random(-0.2,0.2),0,CFG.NUM_TREES-1,width*0.06,width*0.94);
      const hfrac=randIn(CFG.TRUNK_HEIGHT);
      this.trees.push(new Tree(baseX,hfrac,i));
    }
    this.trunkBuffer.clear();
    for (let t of this.trees) t.drawTrunk(this.trunkBuffer);
    this.leafBuffer.clear();
    this.drawLeavesToBuffer();
  }
  drawLeavesToBuffer(){
    this.leafBuffer.clear();
    for (let t of this.trees) t.drawLeaves(this.leafBuffer);
  }
  draw(){
    breathing = sin(frameCount * 0.0025) * 0.02 + 1;

    const mx = (mouseX || width/2) - width/2;
    const my = (mouseY || height/2) - height/2;
    mouseInfluence.x = lerp(mouseInfluence.x, mx * 0.06, 0.05);
    mouseInfluence.y = lerp(mouseInfluence.y, my * 0.05, 0.05);

    camShift.targetX = sin(frameCount*0.00035)*45 + mouseInfluence.x*0.25;
    camShift.targetY = cos(frameCount*0.0005 )*28 + mouseInfluence.y*0.2;
    camShift.x = lerp(camShift.x, camShift.targetX, 0.02);
    camShift.y = lerp(camShift.y, camShift.targetY, 0.02);

    push();
    translate(width/2,height/2);
    scale(breathing);
    translate(-width/2,-height/2);

    // Sky
    noStroke();
    for (let y=0;y<height;y+=3){
      fill(skyGradient(y));
      rect(0,y,width,3);
    }

    // Shimmering light mask
    if (!lightMask) lightMask = createGraphics(width,height);
    lightMask.clear();
    lightMask.noStroke();
    const shimmerAmp = isNight()? 10 : 28;
    for (let y=0;y<height;y+=8){
      for (let x=0;x<width;x+=8){
        const n = noise(x*0.005,y*0.006,frameCount*0.005);
        const a = map(
          n,0,1,
          0,
          shimmerAmp + sin(frameCount*0.02)*shimmerAmp*0.4
        );
        lightMask.fill(255,255,240,a);
        lightMask.rect(x,y,8,8);
      }
    }

    // Leaves + trunks
    this.drawLeavesToBuffer();
    image(this.trunkBuffer,0,0);
    image(this.leafBuffer,0,0);

    // Light overlay
    blendMode(SCREEN);
    image(lightMask,0,0);
    blendMode(BLEND);

    pop();
  }
}

// Atmospherics: pollen (day), fireflies (night)
class Pollen{
  constructor(i){ this.seed=i; this.reset(); }
  reset(){
    this.x=random(width);
    this.y=random(height);
    this.s=random(1.5,3.5);
    this.a=random(18,40);
  }
  update(dt){
    const vx=(noise(this.seed,frameCount*0.005)-0.5)*20;
    const vy=-10*noise(this.seed+10,frameCount*0.005)+4;
    this.x+=(vx+8*sin(frameCount*0.01+this.seed))*dt*0.06;
    this.y+=vy*dt*0.06;
    if (this.y<-10||this.x<-10||this.x>width+10){
      this.reset(); this.y=height+10;
    }
  }
  draw(){
    noStroke();
    fill(255,255,210,this.a);
    ellipse(this.x,this.y,this.s,this.s);
  }
}

class Firefly{
  constructor(i){
    this.seed=i;
    this.x=random(width);
    this.y=random(height*0.25,height*0.95);
  }
  update(dt){
    this.x += (noise(this.seed, frameCount*0.001)-0.5)*20*dt;
    this.y += (noise(this.seed+5, frameCount*0.001)-0.5)*12*dt;
    if (this.x<-20||this.x>width+20) this.x=random(width);
    if (this.y<0||this.y>height) this.y=random(height*0.3,height);
  }
  draw(){
    const glow = map(noise(this.seed, frameCount*0.02),0,1,30,180);
    noStroke();
    fill(255,240,140, glow);
    ellipse(this.x,this.y,3.5,3.5);
  }
}

// p5 lifecycle
function setup(){
  createCanvas(windowWidth,windowHeight);
  pixelDensity(1);
  forest = new Forest();
  particles = Array.from({length:CFG.POLLEN_COUNT},(_,i)=>new Pollen(i));
  fireflies = Array.from({length:CFG.FIREFLY_COUNT},(_,i)=>new Firefly(i));
  lastMillis = millis();
}

function draw(){
  const now = millis();
  const dt = (now-lastMillis)/1000;
  lastMillis = now;
  windT += dt;

  // Day-night cycle advance
  env.cycleTime = (env.cycleTime + dt) % CFG.CYCLE_SEC;
  env.cycleT = env.cycleTime / CFG.CYCLE_SEC;

  // Ecological feedback decay
  env.disturb = max(0, env.disturb - dt*0.25);

  forest.draw();

  // Atmospherics depending on time of day
  if (isNight()) {
    for (let f of fireflies) { f.update(dt); f.draw(); }
  } else {
    for (let p of particles) { p.update(dt); p.draw(); }
  }

  drawGaps(dt);
  drawFade(dt);

  if (CFG.HELP) drawHelp();

  drawTitleCard();
}

// Fade
function drawFade(dt){
  fade.a = lerp(fade.a, fade.target, dt * CFG.FADE_SPEED);
  if (fade.a > 1) {
    noStroke();
    fill(0, fade.a);
    rect(0,0,width,height);
  }
}
function triggerFadeOut(){ fade.target = 255; }
function triggerFadeIn(){ fade.a = 255; fade.target = 0; }

// Title card
function drawTitleCard(){
  if (!showTitleCard && titleAlpha <= 0) return;

  if (!showTitleCard) {
    titleAlpha -= 6;
    if (titleAlpha < 0) titleAlpha = 0;
  }

  push();
  noStroke();
  fill(0, 180 * (titleAlpha/255));
  rect(0,0,width,height);

  fill(255, titleAlpha);
  textAlign(CENTER, CENTER);

  textSize(54);
  textStyle(BOLD);
  text("CROWN SHYNESS", width/2, height/2 - 40);

  textSize(26);
  textStyle(NORMAL);
  text("Deep Night Generative Canopy", width/2, height/2 + 10);

  textSize(16);
  text("Move, click, or drag to begin", width/2, height/2 + 60);
  pop();
}

// Interaction: gaps + feedback
function mousePressed(){
  if (showTitleCard) showTitleCard = false;
}
function mouseDragged(){
  if (showTitleCard) showTitleCard = false;
  const r=CFG.GAP_RADIUS*random(0.9,1.1);
  gaps.push({x:mouseX,y:mouseY,r});
  env.disturb = min(1, env.disturb + 0.08);
}
function touchStarted(){
  if (showTitleCard) showTitleCard = false;
}
function touchMoved(){
  if (showTitleCard) showTitleCard = false;
  const r=CFG.GAP_RADIUS*random(0.85,1.15);
  gaps.push({x:mouseX,y:mouseY,r});
  env.disturb = min(1, env.disturb + 0.08);
  return false;
}

function drawGaps(dt){
  const healRate = CFG.BASE_HEAL_PER_SEC * (0.75 + (1 - env.disturb)*0.75);
  const heal = healRate * dt;
  noFill();
  stroke(255,255,230, isNight()? 10 : 15);
  strokeWeight(10);
  for (let i=gaps.length-1;i>=0;i--){
    let g=gaps[i];
    g.r -= heal;
    if (g.r<=0){ gaps.splice(i,1); continue; }
    ellipse(g.x,g.y,g.r*2.0);
  }
}

// UI
function drawHelp(){
  if (showTitleCard) return; // hide help while title card is shown
  const pad=14;
  const lines=[
    "CROWN SHYNESS — Deep Night Cycle",
    "Drag: open gaps (heals over time; forest responds)",
    "R: regenerate   S: save PNG   H: toggle help   F: fullscreen"
  ];
  const w=440;
  const h=26*lines.length+pad*2;
  noStroke();
  fill(0,60);
  rect(18,18,w,h,12);
  fill(255);
  textSize(16);
  textStyle(BOLD);
  text(lines[0],26,46);
  textStyle(NORMAL);
  for(let i=1;i<lines.length;i++) text(lines[i],26,46+i*22);
}

function keyPressed(){
  if (key === 'F' || key === 'f') {
    let fs = fullscreen();
    fullscreen(!fs);
  }
  if (key === 'H' || key === 'h') CFG.HELP = !CFG.HELP;
  if (key === 'S' || key === 's') saveCanvas('crown-shyness','png');
  if (key === 'R' || key === 'r') {
    triggerFadeOut();
    setTimeout(()=>{
      gaps = [];
      forest = new Forest();
      triggerFadeIn();
    }, 900);
  }
}

function windowResized(){
  resizeCanvas(windowWidth,windowHeight);
  lightMask = null;
  forest = new Forest();
  particles = Array.from({length:CFG.POLLEN_COUNT},(_,i)=>new Pollen(i));
  fireflies = Array.from({length:CFG.FIREFLY_COUNT},(_,i)=>new Firefly(i));
  gaps = [];
}
