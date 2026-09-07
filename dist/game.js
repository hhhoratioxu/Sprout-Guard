(() => {
  "use strict";

  const ROWS = 5;
  const COLS = 8;
  const LEVEL_DURATION = 88;
  const STARTING_ENERGY = 250;
  const STORAGE_KEY = "sprout-guard-best-score";

  const PLANTS = {
    sunbloom: {
      name: "阳光花",
      cost: 50,
      cooldown: 4,
      maxHp: 145,
      atlas: "atlas-tl",
      actionEvery: 7.2,
    },
    podshot: {
      name: "豆荚炮",
      cost: 100,
      cooldown: 5,
      maxHp: 155,
      atlas: "atlas-tr",
      actionEvery: 1.25,
      damage: 24,
    },
    barkguard: {
      name: "木灵卫",
      cost: 75,
      cooldown: 8,
      maxHp: 620,
      atlas: "atlas-bl",
    },
    frostfern: {
      name: "冰晶蕨",
      cost: 150,
      cooldown: 10,
      maxHp: 170,
      atlas: "atlas-br",
      actionEvery: 1.85,
      damage: 15,
    },
  };

  const ENEMIES = {
    mothcap: {
      name: "伞帽怪",
      maxHp: 108,
      speed: 0.245,
      damage: 43,
      points: 100,
      atlas: "atlas-tl",
    },
    mossling: {
      name: "苔靴怪",
      maxHp: 72,
      speed: 0.42,
      damage: 31,
      points: 125,
      atlas: "atlas-tr",
    },
    stonebrute: {
      name: "藤石巨怪",
      maxHp: 310,
      speed: 0.145,
      damage: 78,
      points: 300,
      atlas: "atlas-bl",
    },
  };

  const board = document.querySelector("#board");
  const cellLayer = document.querySelector("#cellLayer");
  const safetyLayer = document.querySelector("#safetyLayer");
  const entityLayer = document.querySelector("#entityLayer");
  const energyValue = document.querySelector("#energyValue");
  const scoreValue = document.querySelector("#scoreValue");
  const bestValue = document.querySelector("#bestValue");
  const waveLabel = document.querySelector("#waveLabel");
  const progressFill = document.querySelector("#progressFill");
  const pauseButton = document.querySelector("#pauseButton");
  const pauseIcon = document.querySelector("#pauseIcon");
  const pauseLabel = document.querySelector("#pauseLabel");
  const soundButton = document.querySelector("#soundButton");
  const shovelButton = document.querySelector("#shovelButton");
  const plantCards = [...document.querySelectorAll("[data-plant]")];
  const gameHint = document.querySelector("#gameHint");
  const gameOverlay = document.querySelector("#gameOverlay");
  const overlayKicker = document.querySelector("#overlayKicker");
  const overlayTitle = document.querySelector("#overlayTitle");
  const overlayText = document.querySelector("#overlayText");
  const overlayTips = document.querySelector("#overlayTips");
  const overlayButton = document.querySelector("#overlayButton");
  const toast = document.querySelector("#toast");

  let nextId = 1;
  let animationFrame = 0;
  let toastTimer = 0;
  let overlayAction = () => {};
  let audioContext = null;
  let soundEnabled = true;

  const state = {
    running: false,
    paused: false,
    elapsed: 0,
    lastFrame: 0,
    wave: 1,
    energy: STARTING_ENERGY,
    score: 0,
    kills: 0,
    selected: null,
    spawnTimer: 2.4,
    skyTimer: 3.4,
    cooldowns: Object.fromEntries(Object.keys(PLANTS).map((key) => [key, 0])),
    plants: [],
    enemies: [],
    projectiles: [],
    drops: [],
    safeties: Array(ROWS).fill(true),
    safetyElements: [],
    best: loadBest(),
  };

  function loadBest() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function saveBest() {
    if (state.score <= state.best) return;
    state.best = state.score;
    try {
      localStorage.setItem(STORAGE_KEY, String(state.best));
    } catch {
      // The game remains fully playable when storage is unavailable.
    }
  }

  function buildCells() {
    const fragment = document.createDocumentFragment();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = `cell${(row + col) % 2 ? " is-alt" : ""}`;
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.setAttribute("aria-label", `第 ${row + 1} 行，第 ${col + 1} 格，空地`);
        fragment.append(cell);
      }
    }
    cellLayer.replaceChildren(fragment);
  }

  function buildSafeties() {
    const fragment = document.createDocumentFragment();
    state.safetyElements = [];
    state.safeties.forEach((available, lane) => {
      const spark = document.createElement("span");
      spark.className = `safety-spark${available ? "" : " is-used"}`;
      spark.style.top = `${(lane + 0.5) * 20}%`;
      fragment.append(spark);
      state.safetyElements.push(spark);
    });
    safetyLayer.replaceChildren(fragment);
  }

  function resetGame() {
    cancelAnimationFrame(animationFrame);
    entityLayer.replaceChildren();
    nextId = 1;
    Object.assign(state, {
      running: true,
      paused: false,
      elapsed: 0,
      lastFrame: 0,
      wave: 1,
      energy: STARTING_ENERGY,
      score: 0,
      kills: 0,
      selected: null,
      spawnTimer: 2.4,
      skyTimer: 3.4,
      cooldowns: Object.fromEntries(Object.keys(PLANTS).map((key) => [key, 0])),
      plants: [],
      enemies: [],
      projectiles: [],
      drops: [],
      safeties: Array(ROWS).fill(true),
    });
    buildSafeties();
    updateCellLabels();
    updateHud();
    updateCards();
    hideOverlay();
    pauseButton.disabled = false;
    setHint("选择一张守卫卡，再点击草地放置。键盘可按 1–4 快速选择。");
    playTone(520, 0.12, "sine", 0.05);
    animationFrame = requestAnimationFrame(gameLoop);
  }

  function gameLoop(now) {
    if (!state.running) return;
    if (!state.lastFrame) state.lastFrame = now;
    const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;

    if (!state.paused) {
      updateGame(dt);
    }

    if (state.running) animationFrame = requestAnimationFrame(gameLoop);
  }

  function updateGame(dt) {
    const previousWave = state.wave;
    state.elapsed = Math.min(LEVEL_DURATION, state.elapsed + dt);
    state.wave = state.elapsed < 27 ? 1 : state.elapsed < 58 ? 2 : 3;
    if (state.wave !== previousWave) {
      showToast(state.wave === 2 ? "第二波来袭：苔靴怪加入战场" : "最终波来袭：小心藤石巨怪");
      playTone(state.wave === 2 ? 360 : 280, 0.24, "sawtooth", 0.035);
    }

    Object.keys(state.cooldowns).forEach((key) => {
      state.cooldowns[key] = Math.max(0, state.cooldowns[key] - dt);
    });

    updateSpawning(dt);
    updatePlants(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateDrops(dt);
    cleanupEntities();
    updateHud();
    updateCards();

    if (state.elapsed >= LEVEL_DURATION && state.enemies.length === 0) {
      finishGame(true);
    }
  }

  function updateSpawning(dt) {
    state.skyTimer -= dt;
    if (state.skyTimer <= 0) {
      spawnEnergyDrop(0.35 + Math.random() * 7.05, 0.35 + Math.random() * 4.05);
      state.skyTimer = 5.5 + Math.random() * 1.8;
    }

    if (state.elapsed >= LEVEL_DURATION) return;
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;

    const type = chooseEnemyType();
    spawnEnemy(type, Math.floor(Math.random() * ROWS));
    const baseDelay = state.wave === 1 ? 3.45 : state.wave === 2 ? 2.55 : 1.85;
    state.spawnTimer = baseDelay * (0.82 + Math.random() * 0.38);
  }

  function chooseEnemyType() {
    const roll = Math.random();
    if (state.wave === 1) return roll < 0.84 ? "mothcap" : "mossling";
    if (state.wave === 2) return roll < 0.57 ? "mothcap" : roll < 0.89 ? "mossling" : "stonebrute";
    return roll < 0.39 ? "mothcap" : roll < 0.73 ? "mossling" : "stonebrute";
  }

  function updatePlants(dt) {
    state.plants.forEach((plant) => {
      if (plant.dead) return;
      const def = PLANTS[plant.type];
      if (!def.actionEvery) return;
      plant.actionTimer -= dt;
      if (plant.actionTimer > 0) return;

      if (plant.type === "sunbloom") {
        spawnEnergyDrop(plant.col + 0.22, plant.lane + 0.2, true);
        plant.actionTimer = def.actionEvery;
        plant.el.classList.add("is-hit");
        window.setTimeout(() => plant.el?.classList.remove("is-hit"), 120);
        return;
      }

      const hasTarget = state.enemies.some(
        (enemy) => !enemy.dead && enemy.lane === plant.lane && enemy.x > plant.col - 0.05,
      );
      if (!hasTarget) {
        plant.actionTimer = Math.min(0, plant.actionTimer);
        return;
      }

      spawnProjectile(plant, plant.type === "frostfern");
      plant.actionTimer = def.actionEvery;
    });
  }

  function updateEnemies(dt) {
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      const def = ENEMIES[enemy.type];
      enemy.slowTime = Math.max(0, enemy.slowTime - dt);
      enemy.el.classList.toggle("is-slowed", enemy.slowTime > 0);

      const target = state.plants
        .filter(
          (plant) =>
            !plant.dead &&
            plant.lane === enemy.lane &&
            enemy.x <= plant.col + 0.76 &&
            enemy.x >= plant.col - 0.24,
        )
        .sort((a, b) => b.col - a.col)[0];

      if (target) {
        target.hp -= def.damage * dt;
        target.el.classList.add("is-damaged");
        setHealth(target);
        if (target.hp <= 0) destroyPlant(target, true);
      } else {
        const speedFactor = enemy.slowTime > 0 ? 0.54 : 1;
        enemy.x -= def.speed * speedFactor * dt;
        enemy.el.style.left = `${(enemy.x / COLS) * 100}%`;
      }

      if (!enemy.dead && enemy.x < -0.56) breachLane(enemy.lane);
    }
  }

  function updateProjectiles(dt) {
    for (const projectile of state.projectiles) {
      if (projectile.dead) continue;
      projectile.x += 3.05 * dt;
      projectile.el.style.left = `${(projectile.x / COLS) * 100}%`;

      const hit = state.enemies
        .filter(
          (enemy) =>
            !enemy.dead &&
            enemy.lane === projectile.lane &&
            projectile.x >= enemy.x + 0.08 &&
            projectile.x <= enemy.x + 0.96,
        )
        .sort((a, b) => a.x - b.x)[0];

      if (hit) {
        damageEnemy(hit, projectile.damage, projectile.frost);
        projectile.dead = true;
        projectile.el.remove();
      } else if (projectile.x > COLS + 0.4) {
        projectile.dead = true;
        projectile.el.remove();
      }
    }
  }

  function updateDrops(dt) {
    state.drops.forEach((drop) => {
      if (drop.dead) return;
      drop.life -= dt;
      if (drop.life <= 0) {
        drop.dead = true;
        drop.el.remove();
      }
    });
  }

  function cleanupEntities() {
    state.plants = state.plants.filter((item) => !item.dead);
    state.enemies = state.enemies.filter((item) => !item.dead);
    state.projectiles = state.projectiles.filter((item) => !item.dead);
    state.drops = state.drops.filter((item) => !item.dead);
  }

  function spawnEnemy(type, lane) {
    const def = ENEMIES[type];
    const element = createSpriteEntity("enemy", def.atlas, "assets/invaders.png");
    const enemy = {
      id: nextId++,
      type,
      lane,
      x: COLS + 0.08,
      hp: def.maxHp,
      maxHp: def.maxHp,
      slowTime: 0,
      dead: false,
      el: element.root,
      healthFill: element.healthFill,
    };
    element.root.style.top = `${lane * 20}%`;
    element.root.style.left = `${(enemy.x / COLS) * 100}%`;
    element.root.setAttribute("aria-hidden", "true");
    entityLayer.append(element.root);
    state.enemies.push(enemy);
  }

  function spawnProjectile(plant, frost) {
    const element = document.createElement("span");
    element.className = `projectile${frost ? " is-frost" : ""}`;
    const projectile = {
      id: nextId++,
      lane: plant.lane,
      x: plant.col + 0.82,
      damage: PLANTS[plant.type].damage,
      frost,
      dead: false,
      el: element,
    };
    element.style.left = `${(projectile.x / COLS) * 100}%`;
    element.style.top = `${((plant.lane + 0.48) / ROWS) * 100}%`;
    entityLayer.append(element);
    state.projectiles.push(projectile);
    playTone(frost ? 760 : 610, 0.045, "sine", 0.015);
  }

  function spawnEnergyDrop(x, y, fromPlant = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "energy-drop";
    element.setAttribute("aria-label", "收集 25 点光能");
    element.style.left = `${(Math.min(7.35, x) / COLS) * 100}%`;
    element.style.top = `${(Math.min(4.35, y) / ROWS) * 100}%`;
    if (fromPlant) element.style.animationDelay = "-0.35s, 0s";

    const drop = {
      id: nextId++,
      life: 8.5,
      dead: false,
      el: element,
    };
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      collectEnergy(drop);
    });
    entityLayer.append(element);
    state.drops.push(drop);
  }

  function collectEnergy(drop) {
    if (drop.dead || !state.running || state.paused) return;
    drop.dead = true;
    state.energy += 25;
    drop.el.classList.add("is-collected");
    window.setTimeout(() => drop.el.remove(), 290);
    updateHud();
    updateCards();
    playTone(880, 0.08, "sine", 0.035);
  }

  function createSpriteEntity(kind, atlasClass, source) {
    const root = document.createElement("div");
    root.className = `entity ${kind}-entity`;

    const crop = document.createElement("span");
    crop.className = `sprite-crop ${kind === "plant" ? "plant-atlas" : "enemy-atlas"} ${atlasClass}`;
    const image = document.createElement("img");
    image.src = source;
    image.alt = "";
    image.draggable = false;
    crop.append(image);

    const healthTrack = document.createElement("span");
    healthTrack.className = "health-track";
    const healthFill = document.createElement("span");
    healthFill.className = "health-fill";
    healthTrack.append(healthFill);
    root.append(crop, healthTrack);
    return { root, healthFill };
  }

  function placePlant(type, lane, col) {
    const def = PLANTS[type];
    if (findPlant(lane, col)) {
      showToast("这格已经有守卫了");
      return;
    }
    if (state.energy < def.cost) {
      showToast(`还差 ${def.cost - state.energy} 点光能`);
      return;
    }
    if (state.cooldowns[type] > 0) {
      showToast(`${def.name}还在准备中`);
      return;
    }

    const element = createSpriteEntity("plant", def.atlas, "assets/defenders.png");
    const plant = {
      id: nextId++,
      type,
      lane,
      col,
      hp: def.maxHp,
      maxHp: def.maxHp,
      actionTimer: type === "sunbloom" ? 4 : 0.25,
      dead: false,
      el: element.root,
      healthFill: element.healthFill,
    };
    element.root.style.left = `${col * 12.5}%`;
    element.root.style.top = `${lane * 20}%`;
    entityLayer.append(element.root);
    state.plants.push(plant);
    state.energy -= def.cost;
    state.cooldowns[type] = def.cooldown;
    selectTool(null);
    updateCellLabels();
    updateHud();
    updateCards();
    playTone(type === "barkguard" ? 220 : 440, 0.085, "triangle", 0.035);
  }

  function destroyPlant(plant, byEnemy = false) {
    if (!plant || plant.dead) return;
    plant.dead = true;
    plant.el.animate(
      [
        { opacity: 1, transform: "scale(1) translateY(0)" },
        { opacity: 0, transform: "scale(.55) translateY(14%)" },
      ],
      { duration: 220, easing: "ease-in", fill: "forwards" },
    );
    window.setTimeout(() => plant.el.remove(), 225);
    updateCellLabels();
    if (byEnemy) playTone(145, 0.12, "sawtooth", 0.025);
  }

  function removePlantAt(lane, col) {
    const plant = findPlant(lane, col);
    if (!plant) {
      showToast("这里没有可以移除的守卫");
      return;
    }
    destroyPlant(plant, false);
    selectTool(null);
    setHint("守卫已移除。选择新卡片继续布置。");
  }

  function findPlant(lane, col) {
    return state.plants.find((plant) => !plant.dead && plant.lane === lane && plant.col === col);
  }

  function damageEnemy(enemy, amount, frost) {
    if (enemy.dead) return;
    enemy.hp -= amount;
    if (frost) enemy.slowTime = Math.max(enemy.slowTime, 2.75);
    enemy.el.classList.add("is-hit");
    window.setTimeout(() => enemy.el?.classList.remove("is-hit"), 90);
    setHealth(enemy);
    playTone(frost ? 410 : 300, 0.035, "square", 0.009);
    if (enemy.hp <= 0) defeatEnemy(enemy, true);
  }

  function defeatEnemy(enemy, awardPoints) {
    if (enemy.dead) return;
    enemy.dead = true;
    if (awardPoints) {
      const def = ENEMIES[enemy.type];
      state.score += def.points;
      state.kills += 1;
      if (Math.random() < 0.18) spawnEnergyDrop(enemy.x + 0.2, enemy.lane + 0.23);
    }
    enemy.el.animate(
      [
        { opacity: 1, transform: "translateY(0) rotate(0) scale(1)" },
        { opacity: 0, transform: "translateY(16%) rotate(-8deg) scale(.65)" },
      ],
      { duration: 250, easing: "ease-in", fill: "forwards" },
    );
    window.setTimeout(() => enemy.el.remove(), 255);
  }

  function setHealth(entity) {
    const ratio = Math.max(0, Math.min(1, entity.hp / entity.maxHp));
    entity.healthFill.style.transform = `scaleX(${ratio})`;
  }

  function breachLane(lane) {
    if (state.safeties[lane]) {
      state.safeties[lane] = false;
      const spark = state.safetyElements[lane];
      spark.classList.add("is-sweeping");
      state.enemies
        .filter((enemy) => !enemy.dead && enemy.lane === lane)
        .forEach((enemy) => {
          state.score += 25;
          defeatEnemy(enemy, false);
        });
      window.setTimeout(() => {
        spark.classList.remove("is-sweeping");
        spark.classList.add("is-used");
      }, 880);
      showToast(`第 ${lane + 1} 行的萤光屏障已触发，只能使用一次`);
      playSweepSound();
      return;
    }
    finishGame(false);
  }

  function finishGame(won) {
    if (!state.running) return;
    state.running = false;
    state.paused = false;
    cancelAnimationFrame(animationFrame);
    saveBest();
    pauseButton.disabled = true;
    pauseIcon.textContent = "Ⅱ";
    pauseLabel.textContent = "暂停";
    selectTool(null);
    updateHud();
    updateCards();

    if (won) {
      playVictorySound();
      showOverlay({
        kicker: "黎明已至",
        title: "花园守住了！",
        text: `你击退了 ${state.kills} 只暮影怪物，最终得分 ${state.score}。`,
        button: "再守一晚",
        tips: `<span><b>${state.kills}</b> 击退数量</span><span><b>${state.score}</b> 本局得分</span><span><b>${state.best}</b> 最佳纪录</span>`,
        action: resetGame,
      });
    } else {
      playTone(115, 0.4, "sawtooth", 0.04);
      showOverlay({
        kicker: "防线失守",
        title: "怪物闯进了花园",
        text: `本局得分 ${state.score}。优先补齐每一行的豆荚炮，再用木灵卫拖住巨怪。`,
        button: "重新挑战",
        tips: `<span><b>${state.kills}</b> 击退数量</span><span><b>${state.score}</b> 本局得分</span><span><b>${state.best}</b> 最佳纪录</span>`,
        action: resetGame,
      });
    }
  }

  function updateHud() {
    energyValue.textContent = String(Math.floor(state.energy));
    scoreValue.textContent = String(state.score);
    bestValue.textContent = String(Math.max(state.best, state.score));
    waveLabel.textContent = `第 ${state.wave} 波`;
    const progress = Math.min(100, (state.elapsed / LEVEL_DURATION) * 100);
    progressFill.style.width = `${progress}%`;
  }

  function updateCards() {
    plantCards.forEach((card) => {
      const type = card.dataset.plant;
      const def = PLANTS[type];
      const cooldown = state.cooldowns[type];
      const ratio = def.cooldown ? (cooldown / def.cooldown) * 100 : 0;
      const unavailable = !state.running || state.paused || cooldown > 0.03 || state.energy < def.cost;
      card.disabled = unavailable;
      card.classList.toggle("is-selected", state.selected === type);
      card.classList.toggle("is-poor", state.running && !state.paused && state.energy < def.cost);
      card.setAttribute("aria-pressed", String(state.selected === type));
      card.style.setProperty("--cooldown", `${ratio}%`);
      card.setAttribute(
        "aria-label",
        cooldown > 0.03
          ? `${def.name}，还需等待 ${Math.ceil(cooldown)} 秒`
          : `${def.name}，消耗 ${def.cost} 点光能`,
      );
    });
    shovelButton.disabled = !state.running || state.paused;
    shovelButton.classList.toggle("is-selected", state.selected === "shovel");
    shovelButton.setAttribute("aria-pressed", String(state.selected === "shovel"));
    board.classList.toggle("has-selection", Boolean(state.selected));
    board.classList.toggle("remove-mode", state.selected === "shovel");
  }

  function updateCellLabels() {
    [...cellLayer.children].forEach((cell) => {
      const lane = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const plant = findPlant(lane, col);
      cell.setAttribute(
        "aria-label",
        `第 ${lane + 1} 行，第 ${col + 1} 格，${plant ? PLANTS[plant.type].name : "空地"}`,
      );
    });
  }

  function selectTool(tool) {
    if (tool && (!state.running || state.paused)) return;
    state.selected = state.selected === tool ? null : tool;
    updateCards();
    if (!state.selected) {
      setHint("选择一张守卫卡，再点击草地放置。");
    } else if (state.selected === "shovel") {
      setHint("点击已有守卫的格子将它移除。");
    } else {
      setHint(`已选择${PLANTS[state.selected].name}，点击空地完成布置。`);
    }
  }

  function pauseGame() {
    if (!state.running || state.paused) return;
    state.paused = true;
    pauseIcon.textContent = "▶";
    pauseLabel.textContent = "继续";
    updateCards();
    showOverlay({
      kicker: "时间暂停",
      title: "花园正在等你",
      text: "怪物和守卫都已暂停。准备好后继续这场防守。",
      button: "继续游戏",
      tips: `<span><b>当前</b> 第 ${state.wave} 波</span><span><b>${state.score}</b> 本局得分</span>`,
      action: resumeGame,
    });
  }

  function resumeGame() {
    if (!state.running || !state.paused) return;
    state.paused = false;
    state.lastFrame = performance.now();
    pauseIcon.textContent = "Ⅱ";
    pauseLabel.textContent = "暂停";
    updateCards();
    hideOverlay();
  }

  function togglePause() {
    if (state.paused) resumeGame();
    else pauseGame();
  }

  function showOverlay({ kicker, title, text, button, tips, action }) {
    overlayKicker.textContent = kicker;
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayButton.textContent = button;
    overlayTips.innerHTML = tips;
    overlayAction = action;
    gameOverlay.classList.add("is-visible");
  }

  function hideOverlay() {
    gameOverlay.classList.remove("is-visible");
  }

  function setHint(message) {
    gameHint.textContent = message;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }

  function ensureAudio() {
    if (!soundEnabled) return null;
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioContext = new AudioCtor();
    }
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  }

  function playTone(frequency, duration, wave = "sine", volume = 0.025, delay = 0) {
    const context = ensureAudio();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startsAt = context.currentTime + delay;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, startsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + duration + 0.02);
  }

  function playSweepSound() {
    [220, 330, 495, 740].forEach((frequency, index) => {
      playTone(frequency, 0.18, "triangle", 0.025, index * 0.06);
    });
  }

  function playVictorySound() {
    [392, 494, 587, 784].forEach((frequency, index) => {
      playTone(frequency, 0.24, "sine", 0.035, index * 0.11);
    });
  }

  cellLayer.addEventListener("click", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || !state.running || state.paused) return;
    if (!state.selected) {
      showToast("先选择一张守卫卡");
      return;
    }
    const lane = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    if (state.selected === "shovel") removePlantAt(lane, col);
    else placePlant(state.selected, lane, col);
  });

  plantCards.forEach((card) => {
    card.addEventListener("click", () => selectTool(card.dataset.plant));
  });

  shovelButton.addEventListener("click", () => selectTool("shovel"));
  pauseButton.addEventListener("click", togglePause);
  overlayButton.addEventListener("click", () => {
    ensureAudio();
    overlayAction();
  });

  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.setAttribute("aria-label", soundEnabled ? "关闭音效" : "开启音效");
    soundButton.querySelector("span").textContent = soundEnabled ? "♪" : "×";
    if (soundEnabled) playTone(660, 0.08, "sine", 0.03);
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
      return;
    }
    if (event.key === "Escape") {
      selectTool(null);
      return;
    }
    const index = Number(event.key) - 1;
    if (index >= 0 && index < plantCards.length && !plantCards[index].disabled) {
      selectTool(plantCards[index].dataset.plant);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.running && !state.paused) pauseGame();
  });

  buildCells();
  buildSafeties();
  updateHud();
  updateCards();
  showOverlay({
    kicker: "暮色降临",
    title: "守住今晚的花园",
    text: "收集发光种子，选择守卫，再轻点草地完成布置。挡住三波暮影怪物就能获胜。",
    button: "开始守卫",
    tips: "<span><b>1–4</b> 选择守卫</span><span><b>空格</b> 暂停</span><span><b>✦</b> 点击收集</span>",
    action: resetGame,
  });
})();
